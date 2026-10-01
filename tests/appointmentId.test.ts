import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  UNSCHEDULED_CHAIR,
  mintAppointmentId,
  isAppointmentId,
  isUnscheduledChair,
  appointmentIdOrNull,
  mintIfUnseated,
  isSeated,
} from '../src/lib/appointmentId';

/**
 * Appointment identity — one id per visit, minted once.
 *
 * These tests pin the properties the rest of the system relies on:
 *
 *   - a minted id is a canonical UUID, so the server's job-dedupe
 *     (`isUuid(consultationId)`) and its consultation lookup recognise it;
 *   - the "nobody seated" marker is never mistaken for an id;
 *   - a read never invents identity;
 *   - a write boundary mints at most one, and is idempotent for a real id.
 */
describe('appointment identity', () => {
  it('mints ids the server recognises as canonical UUIDs', () => {
    for (let i = 0; i < 200; i++) {
      const id = mintAppointmentId();
      expect(isAppointmentId(id)).toBe(true);
      // Same shape the server's isUuid check applies.
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    }
  });

  it('never mints the same id twice', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 2000; i++) ids.add(mintAppointmentId());
    expect(ids.size).toBe(2000);
  });

  it('never mints a value that is a stage name or a sentinel', () => {
    const id = mintAppointmentId();
    expect(id).not.toBe(UNSCHEDULED_CHAIR);
    expect(id.startsWith('consult-')).toBe(false);
    expect(id.startsWith('sched-')).toBe(false);
  });

  it('does not treat the not-yet-seated marker as an id', () => {
    expect(isUnscheduledChair(UNSCHEDULED_CHAIR)).toBe(true);
    expect(isAppointmentId(UNSCHEDULED_CHAIR)).toBe(false);
    expect(isSeated(UNSCHEDULED_CHAIR)).toBe(false);
  });

  it('recognises legacy stage-named ids as real records (existing rows keep working)', () => {
    expect(appointmentIdOrNull('consult-1758000000000')).toBe('consult-1758000000000');
    expect(isAppointmentId('consult-1758000000000')).toBe(false);
    expect(appointmentIdOrNull('sched-1758000000000-3')).toBe('sched-1758000000000-3');
    expect(isSeated('consult-1758000000000')).toBe(true);
  });

  it('a read never invents identity', () => {
    expect(appointmentIdOrNull(UNSCHEDULED_CHAIR)).toBeNull();
    expect(appointmentIdOrNull('')).toBeNull();
    expect(appointmentIdOrNull(undefined)).toBeNull();
    expect(appointmentIdOrNull(null)).toBeNull();
    expect(appointmentIdOrNull(42)).toBeNull();
  });

  it('the write boundary keeps an existing appointment id verbatim', () => {
    const id = mintAppointmentId();
    let minted = 0;
    const mint = () => {
      minted += 1;
      return mintAppointmentId();
    };
    // Repeated saves of the same appointment must converge on one id.
    expect(mintIfUnseated(id, mint)).toBe(id);
    expect(mintIfUnseated(id, mint)).toBe(id);
    expect(minted).toBe(0);
  });

  it('the write boundary mints exactly one id for a record that was never seated', () => {
    let minted = 0;
    const mint = () => {
      minted += 1;
      return '11111111-2222-4333-a444-555555555555';
    };
    expect(mintIfUnseated(UNSCHEDULED_CHAIR, mint)).toBe(
      '11111111-2222-4333-a444-555555555555'
    );
    expect(minted).toBe(1);
  });

  it('a legacy stage-named record keeps its id at the write boundary', () => {
    // Its audio, note job and record version are already filed under that id, so
    // minting a new one here would fork the record and leave the evidence behind
    // — the exact failure this module exists to prevent. A legacy id is only
    // un-dedupable server-side, which is the lesser problem.
    let minted = 0;
    const mint = () => {
      minted += 1;
      return '99999999-8888-4777-a666-555555555555';
    };
    expect(mintIfUnseated('consult-1758000000000', mint)).toBe('consult-1758000000000');
    expect(mintIfUnseated('sched-1758000000000-3', mint)).toBe('sched-1758000000000-3');
    expect(mintIfUnseated('sched_1758000000000_ab12c', mint)).toBe('sched_1758000000000_ab12c');
    expect(minted).toBe(0);
  });

  it('a record that was never seated is minted exactly once at the boundary', () => {
    let minted = 0;
    const mint = () => {
      minted += 1;
      return '99999999-8888-4777-a666-555555555555';
    };
    const id = mintIfUnseated(UNSCHEDULED_CHAIR, mint);
    expect(id).toBe('99999999-8888-4777-a666-555555555555');
    expect(minted).toBe(1);
    // …and thereafter the same record keeps the id it was given.
    expect(mintIfUnseated(id, mint)).toBe(id);
    expect(minted).toBe(1);
  });

  it('an empty or absent id is minted, never returned as an id', () => {
    const mint = () => '12345678-1234-4123-a123-123456789012';
    expect(mintIfUnseated('', mint)).toBe('12345678-1234-4123-a123-123456789012');
    expect(mintIfUnseated(undefined, mint)).toBe('12345678-1234-4123-a123-123456789012');
    expect(mintIfUnseated(null, mint)).toBe('12345678-1234-4123-a123-123456789012');
  });
});

/**
 * The fallback runs where a runtime offers no WebCrypto at all. It must still
 * mint canonical, unique ids, and it must do that without `Math.random`: an id
 * is an identity, not a secret, so deterministic uniqueness is both stronger
 * across a realm and honest about what is (not) being randomised.
 */
describe('appointment identity without WebCrypto', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('still mints canonical, unique UUIDs when no cryptographic source exists', () => {
    vi.stubGlobal('crypto', undefined);
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = mintAppointmentId();
      expect(isAppointmentId(id)).toBe(true);
      expect(id[14]).toBe('4'); // same v4 shape the crypto path produces
      ids.add(id);
    }
    expect(ids.size).toBe(1000);
  });

  it('does not use Math.random in the fallback', () => {
    vi.stubGlobal('crypto', undefined);
    const original = Math.random;
    let calls = 0;
    Math.random = (() => {
      calls += 1;
      return original();
    }) as typeof Math.random;
    try {
      expect(isAppointmentId(mintAppointmentId())).toBe(true);
    } finally {
      Math.random = original;
    }
    expect(calls).toBe(0);
  });

  it('is unique even when the clock does not advance (the counter carries it)', () => {
    vi.stubGlobal('crypto', undefined);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'));
      const ids = new Set<string>();
      for (let i = 0; i < 200; i++) ids.add(mintAppointmentId());
      expect(ids.size).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});
