import { describe, it, expect } from 'vitest';
import {
  generateInviteCode,
  normalizeInviteCode,
  isGeneratedInviteCode,
  sanitizeClinicName,
  personalClinicName,
  INVITE_ALPHABET,
  INVITE_CODE_LENGTH
} from '../src/lib/clinics';

describe('invite code generation', () => {
  it('produces codes of the documented length from the safe alphabet', () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(INVITE_CODE_LENGTH);
    for (const ch of code) {
      expect(INVITE_ALPHABET).toContain(ch);
    }
  });

  it('never emits confusable characters (I, L, O, 1, 0)', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateInviteCode()).not.toMatch(/[ILO10]/);
    }
  });

  it('is deterministic when a randomInt source is injected (testability)', () => {
    const code = generateInviteCode(() => 0);
    expect(code).toBe(INVITE_ALPHABET[0].repeat(INVITE_CODE_LENGTH));
  });

  it('isGeneratedInviteCode round-trips generated codes and rejects others', () => {
    expect(isGeneratedInviteCode(generateInviteCode())).toBe(true);
    expect(isGeneratedInviteCode('SMILE42')).toBe(false);
    expect(isGeneratedInviteCode('SMILE4')).toBe(false);
    expect(isGeneratedInviteCode('SMILE42!')).toBe(false);
    expect(isGeneratedInviteCode('')).toBe(false);
  });
});

describe('normalizeInviteCode', () => {
  it('trims, uppercases and strips separators people actually type', () => {
    expect(normalizeInviteCode('  smile-42 ')).toBe('SMILE42');
    expect(normalizeInviteCode('smile 42')).toBe('SMILE42');
    expect(normalizeInviteCode('SMILE42')).toBe('SMILE42');
  });

  it('rejects non-strings and unusable input', () => {
    expect(normalizeInviteCode(42)).toBeNull();
    expect(normalizeInviteCode(null)).toBeNull();
    expect(normalizeInviteCode('')).toBeNull();
    expect(normalizeInviteCode('a')).toBeNull();
    expect(normalizeInviteCode('a'.repeat(20))).toBeNull();
  });

  it('accepts short codes (4-12 chars after cleaning)', () => {
    expect(normalizeInviteCode('abcd')).toBe('ABCD');
    expect(normalizeInviteCode('abcd-efgh-ijkl')).toBe('ABCDEFGHIJKL');
  });
});

describe('clinic name helpers', () => {
  it('sanitizes names: trims, collapses whitespace, strips angle brackets', () => {
    expect(sanitizeClinicName('  Parramatta   Dental  ')).toBe('Parramatta Dental');
    expect(sanitizeClinicName('<Smile Clinic>')).toBe('Smile Clinic');
    expect(sanitizeClinicName('   A   B   ')).toBe('A B');
  });

  it('rejects unusable names', () => {
    expect(sanitizeClinicName('')).toBeNull();
    expect(sanitizeClinicName('a')).toBeNull();
    expect(sanitizeClinicName('x'.repeat(81))).toBeNull();
    expect(sanitizeClinicName(42)).toBeNull();
  });

  it('builds the default personal clinic name from the dentist name', () => {
    expect(personalClinicName('Dr. Sarah Lee')).toBe('Dr. Sarah Lee — Solo Practice');
    expect(personalClinicName('  ')).toContain('— Solo Practice');
  });
});