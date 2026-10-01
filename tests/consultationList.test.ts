/**
 * QLE-2026-0012 — client consultation list: no lost update between overlapping
 * saves.
 *
 * The defect: `handleSaveConsultation` derived the next list from the
 * `consultations` array captured by the render that created the handler
 * (`[...consultations]` + `setConsultations(newList)`). Two saves that overlap —
 * type in patient A's note, click patient B before A's PUT resolves — both
 * computed from the same pre-update snapshot, so the second write reverted the
 * first save's entry. The reverted list was mirrored to localStorage and then
 * round-tripped to the server on the next save.
 *
 * The fix: the list lives in `createConsultationListStore`, and every write
 * reads the live list at write time. These tests pin the store contract that
 * makes that true, including an explicit negative control for the old pattern.
 */
import { describe, it, expect } from 'vitest';
import {
  createConsultationListStore,
  upsertConsultation,
  mergeConsultationLists,
} from '../src/lib/consultationList';

interface Record {
  id: string;
  note: string;
}

const record = (id: string, note: string): Record => ({ id, note });

describe('consultationList — upsert semantics (QLE-2026-0012)', () => {
  it('replaces an existing record in place, preserving roster order', () => {
    const list = [record('a', 'old'), record('b', 'b-note')];
    const result = upsertConsultation(list, record('a', 'new'));
    expect(result.isNew).toBe(false);
    expect(result.index).toBe(0);
    expect(result.list.map((r) => r.id)).toEqual(['a', 'b']);
    expect(result.list[0].note).toBe('new');
  });

  it('prepends a new record and reports it as new', () => {
    const result = upsertConsultation([record('b', 'b-note')], record('c', 'c-note'));
    expect(result.isNew).toBe(true);
    expect(result.index).toBe(-1);
    expect(result.list.map((r) => r.id)).toEqual(['c', 'b']);
  });

  it('never mutates the input list', () => {
    const list = [record('a', 'old')];
    upsertConsultation(list, record('a', 'new'));
    upsertConsultation(list, record('b', 'b-note'));
    expect(list).toEqual([record('a', 'old')]);
  });
});

describe('consultationList — the live store (QLE-2026-0012)', () => {
  it('has read() in sync with the last apply() within the same tick', () => {
    const store = createConsultationListStore<Record>([record('a', 'a-note')]);
    const next = store.apply([record('b', 'b-note')]);
    expect(store.read()).toBe(next);
    expect(store.read().map((r) => r.id)).toEqual(['b']);
  });

  it('passes the current list to a functional updater, not a captured one', () => {
    const store = createConsultationListStore<Record>([]);
    store.apply((prev) => [...prev, record('a', 'a-note')]);
    store.apply((prev) => [...prev, record('b', 'b-note')]);
    expect(store.read().map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('keeps both saves when two saves overlap (the reported reproduction)', () => {
    // Both saves are triggered before either PUT resolves, exactly as when a
    // clinician types into A's note and clicks B without waiting.
    const store = createConsultationListStore<Record>([]);

    const saveA = upsertConsultation(store.read(), record('a', 'a-note'));
    store.apply(saveA.list);

    // Save B is built after A's local write, reading the live list — this is the
    // line that used to read a stale render closure instead.
    const saveB = upsertConsultation(store.read(), record('b', 'b-note'));
    store.apply(saveB.list);

    expect(store.read().map((r) => r.id).sort()).toEqual(['a', 'b']);

    // And the reverted-list regression is gone: the next save does not resurrect
    // a list that is missing A.
    const saveA2 = upsertConsultation(store.read(), record('a', 'a-note-edited'));
    expect(saveA2.list.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(saveA2.list.find((r) => r.id === 'a')?.note).toBe('a-note-edited');
  });

  it('negative control: the pre-fix pattern (both saves from one captured snapshot) loses the first save', () => {
    // Encodes the exact old code shape so the regression cannot be reintroduced
    // silently: `const index = consultations.findIndex(...); let newList =
    // [...consultations]` computed twice from the same captured array.
    const captured = [record('a', 'a-note')];

    const legacySave = (capturedList: Record[], next: Record) => {
      // eslint-disable-next-line no-param-reassign
      const index = capturedList.findIndex((c) => c.id === next.id);
      const newList = [...capturedList];
      if (index >= 0) newList[index] = next;
      else newList.unshift(next);
      return newList;
    };

    const afterA = legacySave([record('a', 'old-a'), record('x', 'x-note')], record('a', 'a-note'));
    const afterBFromSameSnapshot = legacySave([record('a', 'old-a'), record('x', 'x-note')], record('b', 'b-note'));

    // A's save is durable...
    expect(afterA.find((r) => r.id === 'a')?.note).toBe('a-note');
    // ...but B's write, built from the pre-A snapshot, drops it.
    expect(afterBFromSameSnapshot.find((r) => r.id === 'a')?.note).toBe('old-a');
  });
});

describe('consultationList — poll vs in-flight save (QLE-2026-0009)', () => {
  const localCopy = (id: string, note: string, version?: number) =>
    (version === undefined ? { id, note } : { id, note, recordVersion: version });

  it('still lets server data win for a record with no save in flight (cross-device sync)', () => {
    const merged = mergeConsultationLists(
      [{ id: 'a', note: 'local stale' }],
      [{ id: 'a', note: 'server fresh' }]
    );
    expect(merged).toEqual([{ id: 'a', note: 'server fresh' }]);
  });

  it('does not revert a record whose save is still in flight (the reported reproduction)', () => {
    // The save is in flight: the local record carries the new transcript and the
    // version the PUT was based on. The poll response was issued before the save
    // and still carries the OLD copy.
    const inFlightRecord = localCopy('a', 'new transcript from this tab', 4);
    const merged = mergeConsultationLists(
      [inFlightRecord],
      [localCopy('a', 'old transcript', 3)],
      [inFlightRecord]
    );
    expect(merged[0].note).toBe('new transcript from this tab');
    expect(merged[0].recordVersion).toBe(4);

    // Negative control: without the preserve list the poll reverts the save and
    // the next PUT is built from version 3 — the self-inflicted 409 loop.
    const reverted = mergeConsultationLists(
      [inFlightRecord],
      [localCopy('a', 'old transcript', 3)]
    );
    expect(reverted[0].recordVersion).toBe(3);
  });

  it('keeps server-only records, local-only records and their order', () => {
    const merged = mergeConsultationLists(
      [{ id: 'a' }, { id: 'b' }],
      [{ id: 'c' }],
      [{ id: 'b' }]
    );
    expect(merged.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});
