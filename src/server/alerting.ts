/**
 * Threshold alerting.
 *
 * The existing outbound webhook only fires when something already threw an
 * ERROR. The two conditions that actually end a clinic's day are quieter than
 * that:
 *
 *   - **The queue is not draining.** Notes sit queued, nobody sees an error,
 *     and the clinician assumes the product is slow. This is the failure the
 *     durable-job work was supposed to make impossible — so it needs a detector.
 *   - **The database is unreachable.** Every request 500s; if error logs are the
 *     only signal, you find out when a dentist calls.
 *
 * Rather than depend on a paid error tracker, the checks run as part of the
 * scheduled drain tick (which already runs every minute) and report through the
 * existing ERROR webhook — so alerting works with the same single environment
 * variable, and works on a free plan.
 *
 * Everything in here is pure except `createAlerter`, so thresholds are unit
 * tested rather than tuned in production.
 */

export interface AlertThresholds {
  /** Errors as a percentage of requests before alerting. */
  errorRatePercent: number;
  /** Minimum requests in the window before an error rate is meaningful. */
  minRequestsForRate: number;
  /** Open (queued + processing) jobs that count as a backlog. */
  openJobsBacklog: number;
  /** A job waiting longer than this is a stall, not a queue. */
  stalledAfterMs: number;
  /** Re-alert suppression window per alert kind. */
  repeatAfterMs: number;
}

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  // 1% of a clinic's traffic failing is already visible to them; below that we
  // would be crying wolf on a normal morning.
  errorRatePercent: 1,
  minRequestsForRate: 50,
  openJobsBacklog: 10,
  stalledAfterMs: 10 * 60 * 1000,
  repeatAfterMs: 30 * 60 * 1000,
};

export function thresholdsFromEnv(env: Record<string, string | undefined> = process.env): AlertThresholds {
  const num = (key: string, fallback: number) => {
    const value = Number(env[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    errorRatePercent: num('DENTAI_ALERT_ERROR_RATE_PERCENT', DEFAULT_THRESHOLDS.errorRatePercent),
    minRequestsForRate: num('DENTAI_ALERT_MIN_REQUESTS', DEFAULT_THRESHOLDS.minRequestsForRate),
    openJobsBacklog: num('DENTAI_ALERT_QUEUE_BACKLOG', DEFAULT_THRESHOLDS.openJobsBacklog),
    stalledAfterMs: num('DENTAI_ALERT_STALL_MS', DEFAULT_THRESHOLDS.stalledAfterMs),
    repeatAfterMs: num('DENTAI_ALERT_REPEAT_MS', DEFAULT_THRESHOLDS.repeatAfterMs),
  };
}

export interface HealthSnapshot {
  /** Requests observed in this process instance. */
  requests: number;
  errors: number;
  /** Queue depth, when known. */
  openNoteJobs: number | null;
  /** Age of the oldest queued job in milliseconds, when known. */
  oldestQueuedMs: number | null;
  dbEnabled: boolean;
  dbOk: boolean;
  /** Number of audit-chain or retention failures seen this tick, optionally. */
  extraProblems?: string[];
}

export interface Alert {
  kind: 'error_rate' | 'queue_backlog' | 'queue_stalled' | 'database_unavailable' | 'migration_failed';
  severity: 'critical' | 'warning';
  message: string;
  detail: Record<string, any>;
}

/**
 * Decides which alerts are warranted. Pure: no IO, no state, so the thresholds
 * can be exercised directly in tests.
 */
export function evaluateAlerts(
  snapshot: HealthSnapshot,
  thresholds: AlertThresholds = DEFAULT_THRESHOLDS
): Alert[] {
  const alerts: Alert[] = [];

  if (snapshot.dbEnabled && !snapshot.dbOk) {
    alerts.push({
      kind: 'database_unavailable',
      severity: 'critical',
      message: 'Database is unreachable — the product cannot store or read records.',
      detail: { storage: 'postgres' },
    });
  }

  if (snapshot.requests >= thresholds.minRequestsForRate) {
    const rate = (snapshot.errors / snapshot.requests) * 100;
    if (rate >= thresholds.errorRatePercent) {
      alerts.push({
        kind: 'error_rate',
        severity: rate >= thresholds.errorRatePercent * 5 ? 'critical' : 'warning',
        message: `Error rate ${rate.toFixed(2)}% over the last ${snapshot.requests} requests.`,
        detail: { errors: snapshot.errors, requests: snapshot.requests, rate },
      });
    }
  }

  if (snapshot.openNoteJobs !== null && snapshot.openNoteJobs >= thresholds.openJobsBacklog) {
    alerts.push({
      kind: 'queue_backlog',
      severity: 'warning',
      message: `${snapshot.openNoteJobs} note job(s) outstanding — check the queue is still draining.`,
      detail: { openNoteJobs: snapshot.openNoteJobs },
    });
  }

  if (snapshot.oldestQueuedMs !== null && snapshot.oldestQueuedMs >= thresholds.stalledAfterMs) {
    alerts.push({
      kind: 'queue_stalled',
      severity: 'critical',
      message: `A queued note has been waiting ${Math.round(snapshot.oldestQueuedMs / 60000)} minutes.`,
      detail: { oldestQueuedMs: snapshot.oldestQueuedMs },
    });
  }

  for (const problem of snapshot.extraProblems || []) {
    alerts.push({
      kind: 'migration_failed',
      severity: 'warning',
      message: problem,
      detail: {},
    });
  }

  return alerts;
}

export interface AlerterDeps {
  thresholds: AlertThresholds;
  logger: {
    info: (message: string, context?: Record<string, any>) => void;
    error: (message: string, error?: any, context?: Record<string, any>) => void;
  };
  /** Injectable clock for tests. */
  now?: () => number;
  /** How alerts leave the process. Defaults to logger.error (webhook-aware). */
  emit?: (alert: Alert) => void;
}

export interface Alerter {
  /** Evaluates a snapshot and emits only alerts that are due. */
  report(snapshot: HealthSnapshot): Alert[];
}

/**
 * De-duplicates alerts so a sustained problem does not send a hundred messages
 * (which is how alerting gets muted and then ignored).
 */
export function createAlerter(deps: AlerterDeps): Alerter {
  const now = deps.now || (() => Date.now());
  const lastSentAt = new Map<Alert['kind'], number>();

  const emit =
    deps.emit ||
    ((alert: Alert) =>
      deps.logger.error(`[Alert] ${alert.message}`, undefined, {
        alertKind: alert.kind,
        severity: alert.severity,
        ...alert.detail,
      }));

  return {
    report(snapshot) {
      const due: Alert[] = [];
      for (const alert of evaluateAlerts(snapshot, deps.thresholds)) {
        const previous = lastSentAt.get(alert.kind) ?? 0;
        if (now() - previous < deps.thresholds.repeatAfterMs) continue;
        lastSentAt.set(alert.kind, now());
        due.push(alert);
        emit(alert);
      }
      return due;
    },
  };
}
