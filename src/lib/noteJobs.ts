/**
 * Async note-generation job fabric — domain logic shared by the server
 * endpoints. Pure and testable: no IO, no framework.
 *
 * The pivot: instead of one synchronous request-per-note against a single
 * Gemini key, generation becomes a durable job the server drains with backoff
 * and per-clinic fair-share metering. The client submits a job and polls for
 * the result, so quota pressure on one clinic can never starve or dead-end
 * another.
 */

export type NoteJobStatus = 'queued' | 'processing' | 'done' | 'failed' | 'metered';

export type NoteJobPriority = 'emergency' | 'urgent' | 'routine';

/** Higher number = drained earlier by the worker. */
export const PRIORITY_WEIGHT: Record<NoteJobPriority, number> = {
  emergency: 3,
  urgent: 2,
  routine: 1
};

/**
 * Maps an appointment type to a priority class. Emergency/pain sessions jump
 * the queue; routine hygiene waits its turn. Everything else is routine.
 */
export function priorityForAppointmentType(appointmentType: string): NoteJobPriority {
  if (appointmentType === 'emergency') return 'emergency';
  if (appointmentType === 'endodontic' || appointmentType === 'surgical') return 'urgent';
  return 'routine';
}

/** Job-fabric tuning. */
export const JOB_CONFIG = {
  /** Max attempts before the job is marked failed (client keeps the transcript). */
  maxAttempts: 4,
  /** Base delay for exponential backoff on quota (429) failures. */
  backoffBaseMs: 45_000,
  /** Hard cap on a single job's backoff so worst-case latency stays bounded. */
  backoffMaxMs: 6 * 60_000,
  /** Jobs older than this are failed as stale so the client never polls forever. */
  maxAgeMs: 30 * 60_000,
  /** How many jobs one worker tick drains at most. */
  maxJobsPerTick: 3
};

/** Delay before the next attempt for a rate-limited attempt count (1-based). */
export function backoffDelayMs(attempt: number): number {
  const delay = JOB_CONFIG.backoffBaseMs * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(delay, JOB_CONFIG.backoffMaxMs);
}

/** True when the error from the hosted AI is a quota/rate-limit class error. */
export function isQuotaError(err: { status?: number; message?: string }): boolean {
  const msg = (err.message || '').toLowerCase();
  return (
    err.status === 429 ||
    msg.includes('quota') ||
    msg.includes('resource_exhausted') ||
    msg.includes('exhausted') ||
    msg.includes('rate limit') ||
    msg.includes('rate-limit')
  );
}

// --- Per-clinic daily metering -------------------------------------------------

/** Free-tier daily AI note allowance per clinic (soft limit). */
export const DEFAULT_CLINIC_DAILY_LIMIT = 40;

export interface UsageSnapshot {
  /** Clinic (or dentist fallback) the usage belongs to. */
  scopeId: string;
  /** ISO date (UTC) the counters belong to. */
  day: string;
  /** AI generations consumed today. */
  used: number;
  /** Configured daily allowance. */
  limit: number;
  /** True when the clinic has exhausted its daily allowance. */
  exceeded: boolean;
}

/** Current UTC day in YYYY-MM-DD — the metering bucket key. */
export function meteringDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function usageSnapshotFor(scopeId: string, used: number, limit = DEFAULT_CLINIC_DAILY_LIMIT, now = new Date()): UsageSnapshot {
  return {
    scopeId,
    day: meteringDay(now),
    used,
    limit,
    exceeded: used >= limit
  };
}

/** Removes stale terminal jobs — the JSON/inline job store keeps itself small. */
export function isJobStale(createdAt: string, now = Date.now()): boolean {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return true;
  return now - created > JOB_CONFIG.maxAgeMs;
}

/** Chooses the next job to drain: highest priority first, then oldest. */
export function pickNextJob<T extends { status: NoteJobStatus; priority: NoteJobPriority; createdAt: string }>(
  jobs: T[]
): T | undefined {
  const ready = jobs.filter((j) => j.status === 'queued');
  if (ready.length === 0) return undefined;
  return ready.sort((a, b) => {
    const pw = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
    if (pw !== 0) return pw;
    return Date.parse(a.createdAt) - Date.parse(b.createdAt);
  })[0];
}
