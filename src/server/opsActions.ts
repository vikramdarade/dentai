/**
 * Operator actions.
 *
 * Supporting a product from a phone, at 7am, before a clinic opens, is a
 * different job from building it. The operator surface used to be `curl`
 * against a few endpoints plus shelling into scripts — which does not work on a
 * phone and does not scale past a handful of practices.
 *
 * This module adds the endpoints; src/components/OpsConsole.tsx is the screen
 * that uses them. Everything here is authenticated with DENTAI_OPS_SECRET, and
 * every action that changes state writes an audit event with the fact that an
 * operator did it — an operator action and a clinician action must remain
 * distinguishable forever.
 *
 * Endpoints:
 *   GET  /api/ops/config             — the configuration report (no secret values)
 *   GET  /api/ops/clinics            — practices, plans, usage, queue depth
 *   GET  /api/ops/audit              — recent access-log entries
 *   GET  /api/ops/audit/verify       — hash-chain verification of the access log
 *   POST /api/ops/retention/run      — retention sweep (dry run unless confirmed)
 *   POST /api/ops/billing/activate   — set a practice's plan without Stripe
 *   POST /api/ops/support/recovery   — issue a single-use recovery token
 *   POST /api/ops/support/lock       — lock an account / sign out all devices
 */

import { verifyAuditChain } from '../lib/auditChain';
import { isPlanId, PLANS, type PlanId } from '../lib/plans';
import type { RetentionSweepResult } from './retention';

export interface OpsActionDeps {
  logger: {
    info: (message: string, context?: Record<string, any>) => void;
    warn: (message: string, context?: Record<string, any>) => void;
    error: (message: string, error?: any, context?: Record<string, any>) => void;
  };
  /** Operator guard, shared with registerOpsRoutes. */
  requireOps: (req: any, res: any, next: (err?: any) => void) => any;
  configuration: {
    environment: string;
    readiness: string;
    summary: string;
    blocking: Array<{ key: string; impact: string; howTo: string }>;
    advisories: Array<{ key: string; impact: string; howTo: string }>;
    configured: string[];
  };
  /** Clinic/usage overview rows. */
  clinicOverview: () => Promise<Array<Record<string, any>>>;
  auditEntries: (limit: number) => Promise<Array<Record<string, any>>>;
  runRetention: (options: { confirm: boolean }) => Promise<RetentionSweepResult>;
  activatePlan: (input: {
    clinicId: string;
    plan: PlanId;
    periodDays: number;
    operator: string;
  }) => Promise<Record<string, any>>;
  issueRecoveryToken: (input: {
    dentistId: string;
    hours: number;
    operator: string;
  }) => Promise<{ token: string; expiresAt: string; dentistName: string }>;
  lockAccount: (input: {
    dentistId: string;
    hours: number;
    unlock: boolean;
    operator: string;
  }) => Promise<{ epoch: number; lockedUntil: string | null }>;
  logAudit: (event: string, dentistId: string, detail?: Record<string, any>) => void | Promise<void>;
  /** Identifier recorded on every operator action (from a header or config). */
  operatorName: (req: any) => string;
}

export function registerOpsActionRoutes(app: any, deps: OpsActionDeps): void {
  app.get('/api/ops/config', deps.requireOps, (_req: any, res: any) => {
    // Values are never returned — only whether a variable is set and what its
    // absence costs. This endpoint is how a founder checks a deployment from a
    // phone without a terminal.
    res.json(deps.configuration);
  });

  app.get('/api/ops/clinics', deps.requireOps, async (_req: any, res: any) => {
    try {
      const clinics = await deps.clinicOverview();
      res.json({ clinics, count: clinics.length });
    } catch (err: any) {
      deps.logger.error('Ops clinics overview failed:', err?.message || err);
      res.status(500).json({ error: 'Could not build the clinic overview.' });
    }
  });

  app.get('/api/ops/audit', deps.requireOps, async (req: any, res: any) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
      const events = await deps.auditEntries(limit);
      res.json({ events, count: events.length });
    } catch (err: any) {
      deps.logger.error('Ops audit read failed:', err?.message || err);
      res.status(500).json({ error: 'Could not read the access log.' });
    }
  });

  /**
   * Verifies the access-log hash chain so an operator can *show* a practice
   * that the record is intact, rather than assert it.
   */
  app.get('/api/ops/audit/verify', deps.requireOps, async (req: any, res: any) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 20000, 1), 100000);
      const entries = await deps.auditEntries(limit);
      // The chain is verified oldest-first.
      const ordered = [...entries].sort(
        (a, b) => Date.parse(String(a.createdAt)) - Date.parse(String(b.createdAt))
      );
      const verification = verifyAuditChain(
        ordered.map((entry) => ({
          event: entry.event,
          dentistId: entry.dentistId ?? null,
          detail: entry.detail ?? {},
          createdAt: entry.createdAt,
          prevHash: entry.prevHash ?? null,
          hash: entry.hash ?? null,
        }))
      );
      res.json({
        ...verification,
        oldestChecked: ordered[0]?.createdAt ?? null,
        newestChecked: ordered[ordered.length - 1]?.createdAt ?? null,
        note:
          'A branch is the normal signature of two writers appending at the same moment. ' +
          'A tampered or brokenLink finding is a real problem: compare headHash with the value witnessed off-platform.',
      });
    } catch (err: any) {
      deps.logger.error('Audit chain verification failed:', err?.message || err);
      res.status(500).json({ error: 'Could not verify the access log.' });
    }
  });

  app.post('/api/ops/retention/run', deps.requireOps, async (req: any, res: any) => {
    try {
      const confirm = req.body?.confirm === true;
      const result = await deps.runRetention({ confirm });
      res.json({
        ...result,
        confirmed: confirm,
        note: confirm
          ? 'Records past their retention horizon have been actioned.'
          : 'Dry run only: nothing was changed. Send {"confirm": true} to apply.',
      });
    } catch (err: any) {
      deps.logger.error('Retention sweep failed:', err?.message || err);
      res.status(500).json({ error: 'Retention sweep failed.' });
    }
  });

  app.post('/api/ops/billing/activate', deps.requireOps, async (req: any, res: any) => {
    try {
      const { clinicId, plan } = req.body || {};
      if (typeof clinicId !== 'string' || !clinicId.trim()) {
        return res.status(400).json({ error: 'clinicId is required.' });
      }
      if (!isPlanId(plan)) {
        return res.status(400).json({
          error: `plan must be one of: ${Object.keys(PLANS).join(', ')}.`,
        });
      }
      const periodDays = Math.min(Math.max(Number(req.body?.periodDays) || 30, 1), 730);
      const operator = deps.operatorName(req);
      const subscription = await deps.activatePlan({ clinicId, plan, periodDays, operator });
      await deps.logAudit('billing_plan_activated_by_operator', clinicId, {
        plan,
        periodDays,
        operator,
      });
      res.json({ ok: true, subscription });
    } catch (err: any) {
      deps.logger.error('Manual plan activation failed:', err?.message || err);
      res.status(500).json({ error: 'Could not activate the plan.' });
    }
  });

  app.post('/api/ops/support/recovery', deps.requireOps, async (req: any, res: any) => {
    try {
      const { dentistId } = req.body || {};
      if (typeof dentistId !== 'string' || !dentistId.trim()) {
        return res.status(400).json({ error: 'dentistId is required.' });
      }
      const hours = Math.min(Math.max(Number(req.body?.hours) || 1, 1), 24);
      const operator = deps.operatorName(req);
      const issued = await deps.issueRecoveryToken({ dentistId, hours, operator });
      await deps.logAudit('recovery_token_issued', dentistId, {
        operator,
        channel: 'ops_console',
        expiresAt: issued.expiresAt,
      });
      res.json({
        ok: true,
        ...issued,
        instructions:
          'Share this token only with that clinician, over a channel you trust. It works once, expires, and signs out their other devices when used.',
      });
    } catch (err: any) {
      deps.logger.error('Recovery token issue failed:', err?.message || err);
      res.status(err?.message?.includes('not found') ? 404 : 500).json({
        error: err?.message || 'Could not issue a recovery token.',
      });
    }
  });

  app.post('/api/ops/support/lock', deps.requireOps, async (req: any, res: any) => {
    try {
      const { dentistId, unlock } = req.body || {};
      if (typeof dentistId !== 'string' || !dentistId.trim()) {
        return res.status(400).json({ error: 'dentistId is required.' });
      }
      const hours = Math.min(Math.max(Number(req.body?.hours) || 24, 1), 24 * 30);
      const operator = deps.operatorName(req);
      const result = await deps.lockAccount({
        dentistId,
        hours,
        unlock: unlock === true,
        operator,
      });
      await deps.logAudit(
        unlock === true ? 'account_unlocked_by_operator' : 'account_locked_by_operator',
        dentistId,
        { operator, hours, channel: 'ops_console', epoch: result.epoch }
      );
      res.json({
        ok: true,
        ...result,
        note: 'Every existing session for this account has been retired.',
      });
    } catch (err: any) {
      deps.logger.error('Account lock action failed:', err?.message || err);
      res.status(500).json({ error: 'Could not change the account lock state.' });
    }
  });
}
