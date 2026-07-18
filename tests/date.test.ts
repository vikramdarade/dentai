import { describe, it, expect } from 'vitest';
import { maskDobInput, parseDobToIso, isValidDob } from '../src/utils/date';

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
});
