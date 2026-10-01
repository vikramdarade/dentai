/**
 * Date-of-birth normalisation (QLE-2026-0043).
 *
 * `/api/generate-notes` required `YYYY-MM-DD` and answered everything else with
 * a 400. The chairside schedule parser stores the date of birth exactly as the
 * pasted day sheet wrote it — in Australia `11/10/1976` — and the operatory
 * banner renders that same raw string, so the value the product displays as a
 * valid date of birth was the value the note path refused. Every note for such a
 * patient silently left the synchronous path for the durable job queue, which
 * never validated the field, so nothing surfaced to the clinician.
 *
 * The cases below pin both halves of the fix: the clinic formats that must be
 * understood for prompt context, and the refusal that must survive for patient
 * identity, where a two-way date would attach a record to the wrong chart.
 */

import { describe, expect, it } from 'vitest';
import { normalizeDob } from '../src/lib/dob';

/** Fixed clock so year pivots and the future-birth rule are deterministic. */
const NOW = new Date('2026-09-30T00:00:00Z');

describe('date of birth normalisation — clinic policy (note generation)', () => {
  it('passes an ISO date through unchanged, including a unpadded month/day', () => {
    expect(normalizeDob('1976-10-11', { now: NOW })).toEqual({ value: '1976-10-11', ambiguous: false });
    expect(normalizeDob('1976-1-1', { now: NOW })).toEqual({ value: '1976-01-01', ambiguous: false });
    expect(normalizeDob('1976/10/11', { now: NOW })).toEqual({ value: '1976-10-11', ambiguous: false });
  });

  it('reads the day-sheet form that production was rejecting (DD/MM/YYYY)', () => {
    // The exact value on the operatory banner in the reported failure.
    expect(normalizeDob('11/10/1976', { now: NOW })).toEqual({ value: '1976-10-11', ambiguous: true });
    expect(normalizeDob('11-10-1976', { now: NOW })).toEqual({ value: '1976-10-11', ambiguous: true });
    expect(normalizeDob('11.10.1976', { now: NOW })).toEqual({ value: '1976-10-11', ambiguous: true });
  });

  it('reads a date only one way can be read without calling it ambiguous', () => {
    // 14 cannot be a month, so this is unambiguously 14 May.
    expect(normalizeDob('14/05/1988', { now: NOW })).toEqual({ value: '1988-05-14', ambiguous: false });
    // 14 cannot be a day in the first position if it is second... it is the month.
    expect(normalizeDob('05/14/1988', { now: NOW })).toEqual({ value: '1988-05-14', ambiguous: false });
  });

  it('reads a named month, in either order', () => {
    expect(normalizeDob('11 Oct 1976', { now: NOW })).toEqual({ value: '1976-10-11', ambiguous: false });
    expect(normalizeDob('11-October-1976', { now: NOW })).toEqual({ value: '1976-10-11', ambiguous: false });
    expect(normalizeDob('Oct 11 1976', { now: NOW })).toEqual({ value: '1976-10-11', ambiguous: false });
    expect(normalizeDob('Oct 11, 1976', { now: NOW })).toEqual({ value: '1976-10-11', ambiguous: false });
  });

  it('pivots a two-digit year on the current century, because this is a date of birth', () => {
    expect(normalizeDob('11/10/76', { now: NOW })).toEqual({ value: '1976-10-11', ambiguous: true });
    expect(normalizeDob('11/10/05', { now: NOW })).toEqual({ value: '2005-10-11', ambiguous: true });
  });

  it('never invents a date of birth from an absent or empty value', () => {
    expect(normalizeDob(undefined, { now: NOW })).toEqual({ value: null, ambiguous: false });
    expect(normalizeDob(null, { now: NOW })).toEqual({ value: null, ambiguous: false });
    expect(normalizeDob('', { now: NOW })).toEqual({ value: null, ambiguous: false });
    expect(normalizeDob('   ', { now: NOW })).toEqual({ value: null, ambiguous: false });
  });
});

describe('date of birth normalisation — strict policy (patient identity)', () => {
  it('refuses a date that could be read two ways rather than guessing a chart', () => {
    const result = normalizeDob('04/05/1980', { policy: 'strict', now: NOW });
    expect(result.value).toBeNull();
    expect(result.ambiguous).toBe(true);
    expect(result.error).toContain('ambiguous');
  });

  it('accepts a clinic-format date that can only be read one way, and canonicalises it', () => {
    expect(normalizeDob('14/05/1988', { policy: 'strict', now: NOW })).toEqual({
      value: '1988-05-14',
      ambiguous: false
    });
    expect(normalizeDob('11 Oct 1976', { policy: 'strict', now: NOW })).toEqual({
      value: '1976-10-11',
      ambiguous: false
    });
  });
});

describe('date of birth normalisation — impossible dates', () => {
  it('refuses a date that does not exist on the calendar', () => {
    expect(normalizeDob('1980-02-30', { now: NOW }).value).toBeNull();
    expect(normalizeDob('1980-13-01', { now: NOW }).value).toBeNull();
    expect(normalizeDob('31/02/1980', { now: NOW }).value).toBeNull();
    expect(normalizeDob('00/00/1980', { now: NOW }).value).toBeNull();
    expect(normalizeDob('1980-04-31', { now: NOW }).value).toBeNull();
  });

  it('accepts a leap day only in a leap year', () => {
    expect(normalizeDob('2000-02-29', { now: NOW }).value).toBe('2000-02-29');
    expect(normalizeDob('1900-02-29', { now: NOW }).value).toBeNull();
    expect(normalizeDob('1980-02-29', { now: NOW }).value).toBe('1980-02-29');
  });

  it('refuses a future date of birth and an implausible year', () => {
    expect(normalizeDob('2099-01-01', { now: NOW }).value).toBeNull();
    expect(normalizeDob('1899-12-31', { now: NOW }).value).toBeNull();
    expect(normalizeDob('2026-09-30', { now: NOW }).value).toBe('2026-09-30');
  });

  it('refuses text it cannot read instead of storing it', () => {
    expect(normalizeDob('yesterday', { now: NOW }).error).toBeTruthy();
    expect(normalizeDob('11 Junk 1976', { now: NOW }).error).toBeTruthy();
    expect(normalizeDob('19800504', { now: NOW }).error).toBeTruthy();
    expect(normalizeDob({}, { now: NOW }).error).toBeTruthy();
  });

  it('only ever returns a canonical YYYY-MM-DD value or nothing at all', () => {
    const inputs = [
      '1976-10-11',
      '11/10/1976',
      '11/10/76',
      '14/05/1988',
      '11 Oct 1976',
      'Oct 11, 1976',
      '1980-02-30',
      'yesterday',
      '',
      '0/0/0'
    ];
    for (const input of inputs) {
      const result = normalizeDob(input, { now: NOW });
      if (result.value === null) continue;
      expect(result.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // A value the parser returns must round-trip through it unchanged.
      expect(normalizeDob(result.value, { now: NOW }).value).toBe(result.value);
    }
  });
});
