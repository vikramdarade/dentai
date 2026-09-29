/**
 * Live consultation list — QLE-2026-0012.
 *
 * The client used to keep the consultation list in React state only, and every
 * save handler computed the next list from the `consultations` value captured
 * by the render it was created in:
 *
 *     const index = consultations.findIndex(...)
 *     let newList = [...consultations]
 *     setConsultations(newList)
 *
 * Two saves that overlap — type in patient A's note, click patient B before A's
 * PUT resolves — are created in DIFFERENT renders only if React has re-rendered
 * in between. When it has not (the common case: both handlers come from the same
 * render, or the second fires before the first's `await` resolves), both start
 * from the same pre-update snapshot and the second `setConsultations` reverts the
 * first save's entry. That reverted list was then mirrored to localStorage and
 * round-tripped to the server on the next save, so the lost update became
 * durable.
 *
 * `createConsultationListStore` holds the list outside React and, on `apply`,
 * passes the *current* list to the updater — the same guarantee a ref gives,
 * but as a value the app and the tests share. `read()` is always in sync with
 * the most recent `apply()` call, synchronously, within the same tick.
 *
 * This is deliberately NOT a ref that an effect syncs: a ref written in
 * `useEffect` is itself one render behind, which is the sibling defect
 * (QLE-2026-0013) in the transcript-flush path.
 */

export interface ConsultationListStore<T> {
  /** The list as it stands right now — never a render behind. */
  read(): T[];
  /**
   * Replaces the list (or derives it from the current list) and returns the new
   * value, so callers that need to mirror it elsewhere (localStorage) do not
   * have to re-read.
   */
  apply(next: T[] | ((prev: T[]) => T[])): T[];
}

export function createConsultationListStore<T>(initial: T[]): ConsultationListStore<T> {
  let current = initial;
  return {
    read: () => current,
    apply: (next) => {
      current = typeof next === 'function' ? (next as (prev: T[]) => T[])(current) : next;
      return current;
    },
  };
}

/**
 * Merge a roster/poll response over the local list — QLE-2026-0009.
 *
 * The 30s poll used to replace the whole array with (local cache + server
 * records), server last. A response resolving while a save was in flight
 * therefore reverted that save's fields (transcript, findings, recordVersion)
 * to the server's older copy, and the reverted record then seeded the next PUT
 * with an old `expectedVersion` — a self-inflicted 409 STALE_WRITE loop until
 * the clinician re-applied the work.
 *
 * Server data still wins for every record without an in-flight save (that is
 * what makes cross-device sync work). `preserve` carries the records whose save
 * has not settled yet; they win over the server copy because their write is
 * still authoritative in this tab.
 */
export function mergeConsultationLists<T extends { id: string }>(
  local: T[],
  server: T[],
  preserve: T[] = []
): T[] {
  const map = new Map<string, T>();
  local.forEach((c) => map.set(c.id, c));
  server.forEach((c) => map.set(c.id, c));
  // Re-setting an existing key keeps the original insertion order, so the
  // roster order is stable and unchanged from the pre-existing behaviour.
  preserve.forEach((c) => map.set(c.id, c));
  return Array.from(map.values());
}

export interface UpsertResult<T> {
  list: T[];
  /** Index of the replaced record, or -1 when the record was new. */
  index: number;
  isNew: boolean;
}

/**
 * Insert-or-replace by id, without mutating the input list. A replaced record
 * keeps its position (order is meaningful to the roster UI); a new record is
 * prepended, matching the previous behaviour.
 */
export function upsertConsultation<T extends { id: string }>(list: T[], record: T): UpsertResult<T> {
  const index = list.findIndex((candidate) => candidate.id === record.id);
  if (index >= 0) {
    const next = [...list];
    next[index] = record;
    return { list: next, index, isNew: false };
  }
  return { list: [record, ...list], index: -1, isNew: true };
}
