import { describe, it, expect } from 'vitest';
import { maskDobInput, parseDobToIso, isValidDob, formatClinicDate, formatClinicTime, getClinicTodayIso, clinicDayKeyOfStoredDate } from '../src/utils/date';

describe('Date Utilities', () => {
  describe('maskDobInput', () => {
    it('should format clean numeric input correctly', () => {
      expect(maskDobInput('1')).toBe('1');
      expect(maskDobInput('12')).toBe('12');
      expect(maskDobInput('120')).toBe('12/0');
      expect(maskDobInput('1204')).toBe('12/04');
      expect(maskDobInput('12041')).toBe('12/04/1');
      expect(maskDobInput('12041988')).toBe('12/04/1988');
      expect(maskDobInput('1204198899')).toBe('12/04/1988'); // max 8 digits
    });

    it('should strip out alphabetical characters', () => {
      expect(maskDobInput('12a04b199c0')).toBe('12/04/1990');
    });
  });

  describe('parseDobToIso', () => {
    it('should convert DD/MM/YYYY to YYYY-MM-DD', () => {
      expect(parseDobToIso('12/04/1988')).toBe('1988-04-12');
      expect(parseDobToIso('01/01/2000')).toBe('2000-01-01');
    });
  });

  describe('isValidDob', () => {
    it('should approve valid past dates', () => {
      expect(isValidDob('12/04/1988')).toBe(true);
      expect(isValidDob('29/02/2020')).toBe(true); // leap year
    });

    it('should reject invalid formatting or length', () => {
      expect(isValidDob('12/4/1988')).toBe(false);
      expect(isValidDob('12/04/88')).toBe(false);
      expect(isValidDob('12041988')).toBe(false);
    });

    it('should reject invalid calendar dates', () => {
      expect(isValidDob('29/02/2021')).toBe(false); // not a leap year
      expect(isValidDob('31/04/1988')).toBe(false); // April only has 30 days
      expect(isValidDob('12/13/1988')).toBe(false); // 13th month
    });

    it('should reject future dates', () => {
      const futureYear = new Date().getFullYear() + 2;
      expect(isValidDob(`12/04/${futureYear}`)).toBe(false);
    });

    it('should reject pre-1900 dates', () => {
      expect(isValidDob('12/04/1899')).toBe(false);
    });
  });

  describe('Clinic Timezone & Clock Formatting', () => {
    it('should format clinic dates cleanly in target timezones', () => {
      const iso = '2026-09-19';
      const formattedNy = formatClinicDate(iso, undefined, 'America/New_York');
      expect(formattedNy).toContain('Sep 19, 2026');

      const formattedSyd = formatClinicDate(iso, undefined, 'Australia/Sydney');
      expect(formattedSyd).toContain('Sep 19, 2026');
    });

    it('should format 12-hour clinic clock times correctly', () => {
      const date = new Date('2026-09-19T14:30:00Z');
      const timeNy = formatClinicTime(date, undefined, 'America/New_York');
      expect(timeNy).toMatch(/10:30\s?AM/i);

      const timeUtc = formatClinicTime(date, undefined, 'UTC');
      expect(timeUtc).toMatch(/2:30\s?PM/i);
    });

    it('should return valid YYYY-MM-DD for clinic today iso', () => {
      const isoNy = getClinicTodayIso('America/New_York');
      expect(isoNy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  /**
   * QLE-2026-0002 — a record's stored day must resolve to one canonical clinic
   * day key, so an unfamiliar-but-valid format cannot silently drop the record
   * out of the roster (and, before, move the clinician to another patient).
   */
  describe('clinicDayKeyOfStoredDate', () => {
    it('resolves every stored date shape to the same clinic-day key', () => {
      const year = new Date().getFullYear();
      expect(clinicDayKeyOfStoredDate('2026-09-28')).toBe('2026-09-28');
      expect(clinicDayKeyOfStoredDate(' 2026-09-28 ')).toBe('2026-09-28');
      expect(clinicDayKeyOfStoredDate('Sep 28')).toBe(`${year}-09-28`);
      expect(clinicDayKeyOfStoredDate('Sep 28, 2026')).toBe('2026-09-28');
      expect(clinicDayKeyOfStoredDate('September 28 2026')).toBe('2026-09-28');
      expect(clinicDayKeyOfStoredDate('28/09/2026')).toBe('2026-09-28');
      expect(clinicDayKeyOfStoredDate('2026-09-28T10:00:00.000Z', 'UTC')).toBe('2026-09-28');
    });

    it('returns null rather than guessing at an uninterpretable date', () => {
      expect(clinicDayKeyOfStoredDate('')).toBeNull();
      expect(clinicDayKeyOfStoredDate(undefined)).toBeNull();
      expect(clinicDayKeyOfStoredDate('   ')).toBeNull();
      expect(clinicDayKeyOfStoredDate('next Tuesday')).toBeNull();
      expect(clinicDayKeyOfStoredDate('2026-02-30')).toBeNull();
    });
  });
});

