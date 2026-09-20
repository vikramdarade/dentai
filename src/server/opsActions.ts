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
import {
  createOpsSession,
  OPS_SESSION_COOKIE,
  OPS_SESSION_TTL_MS,
  readCookie,
  verifyOpsSession,
} from './opsRoutes';
import type { RetentionSweepResult } from './retention';

/**
 * The console sign-in screen.
 *
 * Served to anyone who can reach the URL (it holds no data), and it posts the
 * secret in a request body — never in the query string, which is where a secret
 * ends up in browser history, in `Referer` headers and in platform access logs.
 */
function consoleSignInPage(message: string, disabled = false): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>DentAI Operator Sign-In</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 420px; margin: 80px auto; padding: 0 20px; line-height: 1.5; color: #1e293b; background: #f8fafc; }
    h1 { font-size: 1.25rem; margin-bottom: 0.25rem; color: #0f172a; }
    p { color: #64748b; font-size: 0.9rem; }
    .card { background: white; border-radius: 8px; border: 1px solid #e2e8f0; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    label { display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 6px; }
    input, button { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 0.95rem; }
    button { background: #0f172a; color: white; border: none; font-weight: 600; cursor: pointer; margin-top: 14px; }
    button:hover { background: #334155; }
    .error { color: #b91c1c; font-size: 0.85rem; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>DentAI Operator Console</h1>
    <p>Operator access only. The secret is exchanged for a short-lived session cookie and is never stored in the page or in the URL.</p>
    <form id="signin-form">
      <label for="secret">Operator secret</label>
      <input type="password" id="secret" name="secret" autocomplete="off" required ${disabled ? 'disabled' : ''}>
      <button type="submit" ${disabled ? 'disabled' : ''}>Sign in</button>
    </form>
    <div class="error" id="error">${message}</div>
  </div>
  <script>
    var form = document.getElementById('signin-form');
    form.onsubmit = async function (event) {
      event.preventDefault();
      var errorBox = document.getElementById('error');
      errorBox.textContent = '';
      // Plain fetch: this page has no session yet, so it has no use for the
      // console's session-aware wrapper (which is defined on the console page
      // only). Calling it here would be a reference to a function that does not
      // exist on this page.
      var res = await fetch('/api/ops/console/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: document.getElementById('secret').value })
      });
      if (!res.ok) {
        var data = null;
        try { data = await res.json(); } catch (err) { data = null; }
        errorBox.textContent = (data && data.error) || ('Sign-in failed (' + res.status + ')');
        return;
      }
      document.getElementById('secret').value = '';
      window.location.replace('/api/ops/console');
    };
  </script>
</body>
</html>`;
}

export interface FunnelMetrics {
  stages: {
    signups: number;
    generatedFirstNote: number;
    savedFirstNote: number;
    day2Return: number;
    invitedColleague: number;
    upgraded: number;
  };
  qualitySignals: {
    totalNotes: number;
    generatedNotes: number;
    editedNotes: number;
    editRate: number;
    browserLiveNotes: number;
    serverDiarizedNotes: number;
    liveFallbackShare: number;
  };
}

export interface OpsActionDeps {
  logger: {
    info: (message: string, context?: Record<string, any>) => void;
    warn: (message: string, context?: Record<string, any>) => void;
    error: (message: string, error?: any, context?: Record<string, any>) => void;
  };
  /** Operator guard, shared with registerOpsRoutes. */
  requireOps: (req: any, res: any, next: (err?: any) => void) => any;
  /** Constant-time comparison, shared with createOpsGuard and the console sign-in. */
  constantTimeEquals: (a: string, b: string) => boolean;
  /** Durable per-address limiter, applied to every operator route (see opsRoutes). */
  createRateLimit: (options: {
    name: string;
    windowMs?: number;
    max?: number;
    message?: string;
  }) => (req: any, res: any, next: (err?: any) => void) => any;
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
  funnelMetrics?: () => Promise<FunnelMetrics>;
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
  /**
   * Operator routes are throttled per address, before authentication.
   *
   * The console sign-in accepts a shared secret, so an unthrottled endpoint is a
   * brute-force target. The ceiling is generous because the console loads several
   * endpoints per page view.
   */
  const opsRateLimit = deps.createRateLimit({
    name: 'ops-actions',
    windowMs: 60_000,
    max: process.env.NODE_ENV === 'test' ? 10_000 : 60,
    message: 'Too many operator requests from this address. Wait a moment and try again.',
  });

  app.get('/api/ops/config', opsRateLimit, opsRateLimit, deps.requireOps, (_req: any, res: any) => {
    // Values are never returned — only whether a variable is set and what its
    // absence costs. This endpoint is how a founder checks a deployment from a
    // phone without a terminal.
    res.json(deps.configuration);
  });

  app.get('/api/ops/clinics', opsRateLimit, deps.requireOps, async (_req: any, res: any) => {
    try {
      const clinics = await deps.clinicOverview();
      res.json({ clinics, count: clinics.length });
    } catch (err: any) {
      deps.logger.error('Ops clinics overview failed:', err?.message || err);
      res.status(500).json({ error: 'Could not build the clinic overview.' });
    }
  });

  app.get('/api/ops/funnel', opsRateLimit, deps.requireOps, async (_req: any, res: any) => {
    try {
      if (!deps.funnelMetrics) {
        return res.status(501).json({ error: 'Funnel analytics not available in this environment.' });
      }
      const funnel = await deps.funnelMetrics();
      res.json(funnel);
    } catch (err: any) {
      deps.logger.error('Ops funnel calculation failed:', err?.message || err);
      res.status(500).json({ error: 'Could not compute the adoption funnel.' });
    }
  });

  /**
   * Console sign-in: exchanges the operator secret for a short-lived session.
   *
   * The secret arrives in a request body and is never accepted from the query
   * string. The cookie is HttpOnly (no script can read it), SameSite=Strict (a
   * cross-site POST cannot borrow it), scoped to /api/ops, and signed with the
   * operator secret — so it cannot be forged or edited, it expires on its own,
   * and rotating DENTAI_OPS_SECRET revokes every existing session.
   */
  app.post('/api/ops/console/session', opsRateLimit, async (req: any, res: any) => {
    const expected = process.env.DENTAI_OPS_SECRET || '';
    if (!expected) {
      return res.status(503).json({
        error: 'Operational endpoints are disabled. Set DENTAI_OPS_SECRET to enable them.',
        code: 'OPS_DISABLED',
      });
    }
    const provided = typeof req.body?.secret === 'string' ? req.body.secret.trim() : '';
    if (!provided || !deps.constantTimeEquals(provided, expected)) {
      deps.logger.warn('Rejected operator console sign-in', { url: req.originalUrl });
      return res.status(401).json({
        error: 'That operator secret is not correct.',
        code: 'OPS_SECRET_REQUIRED',
      });
    }
    const { token, expiresAt } = createOpsSession(expected);
    res.cookie(OPS_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/api/ops',
      maxAge: OPS_SESSION_TTL_MS,
    });
    await Promise.resolve(
      deps.logAudit('ops_console_session_started', deps.operatorName(req), {
        expiresAt: new Date(expiresAt).toISOString(),
      })
    ).catch(() => {});
    return res.json({ ok: true, expiresAt: new Date(expiresAt).toISOString() });
  });

  /** Ends the operator session early, without waiting for the cookie to expire. */
  app.post('/api/ops/console/logout', opsRateLimit, (_req: any, res: any) => {
    res.clearCookie(OPS_SESSION_COOKIE, { path: '/api/ops' });
    res.json({ ok: true });
  });

  /** The console markup, returned only to a caller holding a valid session. */
  const consoleHtml = (): string => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>DentAI Operator Console</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; line-height: 1.5; color: #1e293b; background: #f8fafc; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; color: #0f172a; }
    .card { background: white; border-radius: 8px; border: 1px solid #e2e8f0; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
    .metric { padding: 12px; border-radius: 6px; background: #f1f5f9; }
    .metric span { display: block; font-size: 0.75rem; font-weight: 600; color: #64748b; text-transform: uppercase; }
    .metric strong { font-size: 1.5rem; color: #0f172a; }
    label { display: block; font-size: 0.85rem; font-weight: 600; margin-top: 10px; margin-bottom: 4px; }
    input, select, button { width: 100%; box-sizing: border-box; padding: 8px 12px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 0.9rem; }
    button { background: #0f172a; color: white; border: none; font-weight: 600; cursor: pointer; margin-top: 12px; }
    button:hover { background: #334155; }
    .danger-btn { background: #b91c1c; }
    .danger-btn:hover { background: #991b1b; }
    pre { background: #0f172a; color: #f8fafc; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 0.8rem; }
  </style>
</head>
<body>
  <h1>DentAI Operator Console</h1>
  <p style="color: #64748b; font-size: 0.9rem; margin-top: 0;">
    Operational actions & quality telemetry. All actions audited.
    <button type="button" id="btn-signout" style="width: auto; margin-top: 6px; padding: 4px 10px; font-size: 0.75rem; background: #64748b;">Sign out</button>
  </p>

  <div class="card">
    <h2 style="font-size: 1.1rem; margin-top: 0;">Adoption Funnel & Quality Signals</h2>
    <div id="funnel-container"><p style="color: #64748b;">Loading metrics...</p></div>
  </div>

  <div class="card">
    <h2 style="font-size: 1.1rem; margin-top: 0;">Plan Activation (Manual)</h2>
    <form id="activate-form">
      <label>Clinic ID</label>
      <input type="text" name="clinicId" required placeholder="clinic-...">
      <label>Plan</label>
      <select name="plan">
        <option value="solo">Solo Clinician</option>
        <option value="practice" selected>Practice (6 chairs)</option>
        <option value="enterprise">Enterprise</option>
      </select>
      <label>Period Days</label>
      <input type="number" name="periodDays" value="30" required>
      <button type="submit">Activate Plan</button>
    </form>
    <div id="activate-result"></div>
  </div>

  <div class="card">
    <h2 style="font-size: 1.1rem; margin-top: 0;">Single-Use Recovery Token</h2>
    <form id="recovery-form">
      <label>Dentist ID</label>
      <input type="text" name="dentistId" required placeholder="dentist-...">
      <label>Valid Hours</label>
      <input type="number" name="hours" value="24" required>
      <button type="submit">Issue Token</button>
    </form>
    <div id="recovery-result"></div>
  </div>

  <div class="card">
    <h2 style="font-size: 1.1rem; margin-top: 0;">Retention Sweep</h2>
    <p style="font-size: 0.85rem; color: #64748b;">Deletes expired audio and consults past retention window.</p>
    <button type="button" id="btn-retention-dry">Run Dry Run (Count Only)</button>
    <button type="button" id="btn-retention-confirm" class="danger-btn">Run Confirmed Deletion</button>
    <div id="retention-result"></div>
  </div>

  <script>
    const headers = { 'Content-Type': 'application/json' };
    // The operator session is an HttpOnly cookie, so no secret is ever placed in
    // a URL, in this page, or in storage the page can read.
    async function opsFetch(url, init) {
      const res = await opsFetch(url, init);
      if (res.status === 401 || res.status === 503) {
        document.body.innerHTML = '<h1>Operator session ended</h1><p><a href="/api/ops/console">Sign in again</a></p>';
        throw new Error('Operator session ended. Sign in again at /api/ops/console');
      }
      return res;
    }
    var signOut = document.getElementById('btn-signout');
    if (signOut) {
      signOut.onclick = async function () {
        await opsFetch('/api/ops/console/logout', { method: 'POST', headers: headers, body: '{}' });
        window.location.replace('/api/ops/console');
      };
    }

    async function loadFunnel() {
      try {
        const res = await opsFetch('/api/ops/funnel', { headers });
        if (!res.ok) {
          document.getElementById('funnel-container').innerHTML = '<p style="color:red">Failed to load funnel (' + res.status + ')</p>';
          return;
        }
        const data = await res.json();
        const s = data.stages || {};
        const q = data.qualitySignals || {};
        document.getElementById('funnel-container').innerHTML = \`
          <div class="grid">
            <div class="metric"><span>Signups</span><strong>\${s.signups ?? 0}</strong></div>
            <div class="metric"><span>1st Note Gen</span><strong>\${s.generatedFirstNote ?? 0}</strong></div>
            <div class="metric"><span>1st Note Saved</span><strong>\${s.savedFirstNote ?? 0}</strong></div>
            <div class="metric"><span>Day 2 Return</span><strong>\${s.day2Return ?? 0}</strong></div>
            <div class="metric"><span>Invited Colleague</span><strong>\${s.invitedColleague ?? 0}</strong></div>
            <div class="metric"><span>Upgraded</span><strong>\${s.upgraded ?? 0}</strong></div>
          </div>
          <h3 style="font-size: 0.95rem; margin-top: 16px; margin-bottom: 8px;">Quality Signals</h3>
          <div class="grid">
            <div class="metric"><span>Edit Rate</span><strong>\${((q.editRate ?? 0) * 100).toFixed(1)}%</strong></div>
            <div class="metric"><span>Live-Fallback Share</span><strong>\${((q.liveFallbackShare ?? 0) * 100).toFixed(1)}%</strong></div>
            <div class="metric"><span>Server Diarized</span><strong>\${q.serverDiarizedNotes ?? 0}</strong></div>
            <div class="metric"><span>Browser Live</span><strong>\${q.browserLiveNotes ?? 0}</strong></div>
          </div>
        \`;
      } catch (e) {
        document.getElementById('funnel-container').innerHTML = '<p style="color:red">Error: ' + e.message + '</p>';
      }
    }
    loadFunnel();

    document.getElementById('activate-form').onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target;
      const body = { clinicId: form.clinicId.value, plan: form.plan.value, periodDays: Number(form.periodDays.value) };
      const res = await opsFetch('/api/ops/billing/activate', { method: 'POST', headers, body: JSON.stringify(body) });
      const data = await res.json();
      document.getElementById('activate-result').innerHTML = '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
    };

    document.getElementById('recovery-form').onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target;
      const body = { dentistId: form.dentistId.value, hours: Number(form.hours.value) };
      const res = await opsFetch('/api/ops/support/recovery', { method: 'POST', headers, body: JSON.stringify(body) });
      const data = await res.json();
      document.getElementById('recovery-result').innerHTML = '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
    };

    async function triggerRetention(confirm) {
      const res = await opsFetch('/api/ops/retention/run', { method: 'POST', headers, body: JSON.stringify({ confirm }) });
      const data = await res.json();
      document.getElementById('retention-result').innerHTML = '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
    }
    document.getElementById('btn-retention-dry').onclick = () => triggerRetention(false);
    document.getElementById('btn-retention-confirm').onclick = () => {
      if (confirm('Are you sure you want to permanently delete records past retention?')) triggerRetention(true);
    };
  </script>
</body>
</html>`;

  /**
   * The console screen.
   *
   * Deliberately NOT behind `deps.requireOps`: a browser navigation cannot send
   * a custom header, which is why this route reads the session cookie itself and
   * renders the sign-in form when there is no valid session. It carries no data
   * of its own — every metric behind it is still guarded.
   */
  app.get('/api/ops/console', opsRateLimit, (req: any, res: any) => {
    const expected = process.env.DENTAI_OPS_SECRET || '';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!expected) {
      return res
        .status(503)
        .send(consoleSignInPage('Operational endpoints are disabled: set DENTAI_OPS_SECRET.', true));
    }
    const session = readCookie(req.headers || {}, OPS_SESSION_COOKIE);
    if (!verifyOpsSession(session, expected)) {
      deps.logger.warn('Operator console loaded without a valid session', { url: req.originalUrl });
      return res.send(consoleSignInPage(''));
    }
    return res.send(consoleHtml());
  });

  app.get('/api/ops/audit', opsRateLimit, deps.requireOps, async (req: any, res: any) => {
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
  app.get('/api/ops/audit/verify', opsRateLimit, deps.requireOps, async (req: any, res: any) => {
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

  app.post('/api/ops/retention/run', opsRateLimit, deps.requireOps, async (req: any, res: any) => {
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

  app.post('/api/ops/billing/activate', opsRateLimit, deps.requireOps, async (req: any, res: any) => {
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

  app.post('/api/ops/support/recovery', opsRateLimit, deps.requireOps, async (req: any, res: any) => {
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

  app.post('/api/ops/support/lock', opsRateLimit, deps.requireOps, async (req: any, res: any) => {
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
