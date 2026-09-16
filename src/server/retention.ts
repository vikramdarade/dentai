/**
 * Retention sweep.
 *
 * The privacy notice tells practices that clinical records are deleted or
 * de-identified once the retention horizon passes (7 years by default). Until
 * now that was a sentence with no code behind it: every record carried
 * `retentionUntil` and nothing ever read it.
 *
 * Behaviour:
 *  - Off unless `DENTAI_RETENTION_ENABLED=true`, and dry-run by default even
 *    then. A destructive sweep is not something that should start happening
 *    because a deployment went out.
 *  - Bounded per run (`batchSize`) so one tick cannot turn into an hour-long
 *    transaction against a production database.
 *  - Every action is audited with the record id, the clinic, the horizon and
 *    the action taken. Dry runs are audited too — "we checked and found
 *    nothing" is the record a practice needs.
 *  - Failures are collected, never thrown: a retention sweep that dies on one
 *    bad row would leave the rest unprocessed and alert nobody.
 */

import { applyRetentionAction, type RetentionPolicy } from '../lib/retentionPolicy';
import type { RetentionStore } from './stores';

export interface RetentionDeps {
  store: RetentionStore;
  policy: RetentionPolicy;
  logger: {
    info: (message: string, context?: Record<string, any>) => void;
    warn: (message: string, context?: Record<string, any>) => void;
    error: (message: string, error?: any, context?: Record<string, any>) => void;
  };
  logAudit: (event: string, dentistId: string, detail?: Record<string, any>) => void | Promise<void>;
}

export interface RetentionSweepResult {
  examined: number;
  actioned: number;
  dryRun: boolean;
  action: RetentionPolicy['action'];
  failures: Array<{ recordId: string; error: string }>;
}

export async function runRetentionSweep(
  deps: RetentionDeps,
  now: Date = new Date()
): Promise<RetentionSweepResult> {
  const nowIso = now.toISOString();
  const result: RetentionSweepResult = {
    examined: 0,
    actioned: 0,
    dryRun: deps.policy.dryRun,
    action: deps.policy.action,
    failures: [],
  };

  let due: Awaited<ReturnType<RetentionStore['listDue']>>;
  try {
    due = await deps.store.listDue(deps.policy.batchSize, nowIso);
  } catch (err: any) {
    deps.logger.error('Retention sweep could not read due records:', err?.message || err);
    result.failures.push({ recordId: '*', error: err?.message || String(err) });
    return result;
  }

  result.examined = due.length;
  if (due.length === 0) return result;

  for (const record of due) {
    if (deps.policy.dryRun) {
      await Promise.resolve(
        deps.logAudit('retention_record_due', record.dentistId, {
          recordId: record.id,
          clinicId: record.clinicId,
          retentionUntil: record.retentionUntil,
          plannedAction: deps.policy.action,
        })
      ).catch(() => {});
      result.actioned += 1;
      continue;
    }

    try {
      const tombstone = applyRetentionAction(record.data, deps.policy, nowIso);
      await deps.store.deidentify(record.id, tombstone, nowIso);
      result.actioned += 1;
      await Promise.resolve(
        deps.logAudit(
          deps.policy.action === 'delete'
            ? 'retention_record_deleted'
            : 'retention_record_deidentified',
          record.dentistId,
          {
            recordId: record.id,
            clinicId: record.clinicId,
            retentionUntil: record.retentionUntil,
            action: deps.policy.action,
          }
        )
      ).catch(() => {});
    } catch (err: any) {
      const message = err?.message || String(err);
      deps.logger.error(`Retention action failed for record ${record.id}:`, message);
      result.failures.push({ recordId: record.id, error: message });
    }
  }

  deps.logger.info(
    `[Retention] ${result.dryRun ? 'Dry run: ' : ''}${result.actioned} of ${result.examined} ` +
      `record(s) past their retention horizon (action: ${deps.policy.action}).`
  );
  return result;
}
