/**
 * Appointment identity — the single answer to "what is this visit called?".
 *
 * ## Why this module exists
 *
 * Before it, one visit wore up to three different names during its life:
 *
 *   `sched-<ts>-<i>`  →  `chair-active`  →  `consult-<ts>`
 *
 * Everything that belongs to the visit is filed under that name — the recorded
 * audio (`consult:<id>`), the durable note job, the transcript buffer, the
 * record version, the attestation seal. So a rename does not just relabel the
 * record, it detaches its evidence:
 *
 *   - audio recorded under one id was transcribed under another (and the
 *     server refuses audio for a consultation it has never seen);
 *   - `isUuid(consultationId) ? consultationId : randomUUID()` on the server
 *     meant a non-UUID id could never converge on one note job;
 *   - a record whose id changes has no server-stamped `recordVersion`, so it
 *     cannot be signed at all.
 *
 * The rule is therefore: **mint the appointment id once, when the patient is
 * seated, and carry it verbatim for the rest of the visit.** Nothing re-mints
 * it and nothing derives it from a lifecycle stage.
 *
 * ## The one exception, kept deliberately
 *
 * `UNSCHEDULED_CHAIR` is the marker for "no appointment has been seated yet".
 * It is a *state of the workspace*, never the identity of a record — so it must
 * never reach a persisted field, a storage key or a request body. Seating a
 * patient replaces it with a minted id.
 *
 * This module is pure: no storage, no clock, no randomness except through
 * `mintAppointmentId`, so every rule here is testable in isolation.
 */

/**
 * Workspace state: nobody is seated in the chair yet.
 *
 * NOT an id. Consumers must check `isUnscheduledChair` and seat an appointment
 * before using it as one — see `appointmentIdOrNull` / `mintIfUnseated`.
 */
export const UNSCHEDULED_CHAIR = 'chair-active';

/** Canonical UUIDv4 shape, matching the server's `isUuid` check. */
const APPOINTMENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mint an appointment id.
 *
 * A UUID, so the server's job-dedupe (`isUuid`) and its consultation lookup
 * both recognise it without a special case. `crypto.randomUUID` is unavailable
 * in insecure contexts, so the fallback keeps the UUID *shape* (a v4-shaped
 * value built from `getRandomValues`, or as a last resort a timestamp and
 * counter) — identity that is merely unique is still enough, but a value that
 * fails the shape check is not, because it would be treated as legacy.
 */
export function mintAppointmentId(): string {
  const cryptoObj = typeof crypto !== 'undefined' ? (crypto as Crypto) : undefined;

  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    try {
      return cryptoObj.randomUUID();
    } catch {
      // fall through — some runtimes expose the function but refuse to use it
    }
  }

  const hex: string[] = [];
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    try {
      const bytes = new Uint8Array(16);
      cryptoObj.getRandomValues(bytes);
      for (let i = 0; i < bytes.length; i++) {
        hex.push(bytes[i].toString(16).padStart(2, '0'));
      }
    } catch {
      // fall through
    }
  }

  if (hex.length !== 32) {
    // Deterministic-but-unique: good enough to be a key, never mistaken for a
    // shared constant.
    const seed = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
    hex.length = 0;
    for (let i = 0; i < 32; i++) {
      hex.push(seed[(i * 7 + 3) % seed.length] || '0');
    }
  }

  const joined = hex.join('');
  return [
    joined.slice(0, 8),
    joined.slice(8, 12),
    `4${joined.slice(13, 16)}`,
    `a${joined.slice(17, 20)}`,
    joined.slice(20, 32),
  ].join('-');
}

/** True when `value` is a minted appointment id (a canonical UUID). */
export function isAppointmentId(value: unknown): value is string {
  return typeof value === 'string' && APPOINTMENT_ID_PATTERN.test(value);
}

/** True when `value` is the "nobody seated yet" marker rather than an id. */
export function isUnscheduledChair(value: unknown): boolean {
  return value === UNSCHEDULED_CHAIR;
}

/**
 * The id of a record that already exists, or `null`.
 *
 * A read must never invent identity — that is how one patient's record ends up
 * filed under another's id. Legacy non-UUID ids (`sched-…`, `consult-…`) are
 * returned as-is so existing rows keep working; only the marker yields `null`.
 */
export function appointmentIdOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  return isUnscheduledChair(value) ? null : value;
}

/**
 * The write boundary: the id this appointment must be persisted under.
 *
 * ANY value that is an id — a minted UUID or an older stage-named id
 * (`consult-…`, `sched_…`, `walkin-…`) — is carried verbatim, because that id
 * is already the name its recorded audio (`consult:<id>`), its note job and its
 * server-stamped record version are filed under. Re-minting at a write boundary
 * does not rename a record; it forks it, and the fork is the record with an id
 * nobody has evidence under. Legacy ids are only "wrong" in that the server's
 * job-dedupe treats them as un-dedupable, which is a smaller problem than a
 * second chart.
 *
 * Only a value that is not an id at all — the un-seated marker, an empty or
 * absent value — mints one, exactly once. That case is a record with no
 * identity yet, so there is nothing to detach.
 */
export function mintIfUnseated(
  value: unknown,
  mint: () => string = mintAppointmentId
): string {
  return appointmentIdOrNull(value) ?? mint();
}

/**
 * True while a visit is still the un-seated workspace scratchpad.
 *
 * Callers that previously compared against the literal `'chair-active'` should
 * use this so the check is expressed as "not seated" rather than "named this".
 */
export function isSeated(value: unknown): boolean {
  const id = appointmentIdOrNull(value);
  return Boolean(id);
}
