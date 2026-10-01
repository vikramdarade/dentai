/**
 * The clinical-content rule, in one place (src/lib/clinicalContent.ts).
 *
 * The rule exists because `findings.customSections` carries both note text and
 * seating/intake bookkeeping, and reading the latter as clinical content is how
 * a blank walk-in appointment was approved for signing and badged "Verified
 * from Audio". These tests pin the boundary: the three known bookkeeping keys
 * never count, an unknown key always does (fail toward review), and patient
 * identity is deliberately not consulted.
 */
import { describe, it, expect } from 'vitest';
import {
  NON_CLINICAL_SECTION_KEYS,
  clinicalNoteSections,
  hasClinicalContent,
} from '../src/lib/clinicalContent';

describe('clinical content rule', () => {
  it('does not count seating/intake bookkeeping as note content', () => {
    expect(hasClinicalContent({
      customSections: {
        operatory: 'Room 1',
        priorNoteDate: '2026-09-01',
        intakeNote: 'Walk-in encounter created at intake for Test Walkin',
      },
    })).toBe(false);
  });

  it('counts an unknown custom section as clinical (fails toward review)', () => {
    expect(hasClinicalContent({ customSections: { periodontalChart: 'Pocketing 4mm on 16.' } })).toBe(true);
  });

  it('keeps clinical sections alongside bookkeeping', () => {
    const sections = clinicalNoteSections({
      operatory: 'Room 1',
      intakeNote: 'Walk-in encounter created at intake for Test Walkin',
      periodontalChart: 'Pocketing 4mm on 16.',
    });
    expect(Object.keys(sections)).toEqual(['periodontalChart']);
  });

  it('finds content in ordinary findings fields and ignores empty ones', () => {
    expect(hasClinicalContent({ chiefComplaint: '', toothFindings: '   ', adaCodes: [] })).toBe(false);
    expect(hasClinicalContent({ toothFindings: 'MO composite on 16' })).toBe(true);
    expect(hasClinicalContent({ adaCodes: ['23311'] })).toBe(true);
  });

  it('treats a missing or malformed findings object as empty, never as content', () => {
    expect(hasClinicalContent(undefined)).toBe(false);
    expect(hasClinicalContent(null)).toBe(false);
    expect(hasClinicalContent('tooth 16 caries')).toBe(false);
    expect(clinicalNoteSections('Room 1')).toEqual({});
  });

  it('exposes exactly the three bookkeeping keys', () => {
    expect([...NON_CLINICAL_SECTION_KEYS].sort()).toEqual(['intakeNote', 'operatory', 'priorNoteDate']);
  });
});
