import { describe, it, expect } from 'vitest';
import { appendContradictionFlags, type FlagableGroundingReport } from '../src/lib/contradictionFlags';

function newReport(): FlagableGroundingReport {
  return {
    groundingScore: 100,
    isFullyGrounded: true,
    unverifiedClaims: []
  };
}

describe('Phase 5 flag-only contradiction detection (server seam)', () => {
  it('planned ≠ performed: note-asserted performed treatment with only planned speech is flagged unverified', () => {
    const report = newReport();
    appendContradictionFlags(report, {
      noteTreatmentText: ['Composite restoration placed on tooth 36 today.'],
      noteObjectiveText: [],
      transcript: [
        { sender: 'Dentist', text: 'We will restore 36 next visit.' }
      ]
    });

    expect(report.unverifiedClaims.length).toBe(1);
    expect(report.unverifiedClaims[0]).toMatch(/performed/i);
    expect(report.isFullyGrounded).toBe(false);
    expect(report.groundingScore).toBeLessThan(100);
  });

  it('negated ≠ performed: note-asserted performed treatment against negated speech is a conflict', () => {
    const report = newReport();
    appendContradictionFlags(report, {
      noteTreatmentText: ['Composite restoration placed on tooth 36 today.'],
      noteObjectiveText: [],
      transcript: [
        { sender: 'Dentist', text: 'No filling was placed on tooth 36 today.' }
      ]
    });

    expect(report.unverifiedClaims.length).toBe(1);
    expect(report.unverifiedClaims[0]).toMatch(/conflict/i);
    expect(report.isFullyGrounded).toBe(false);
    expect(report.groundingScore).toBe(69);
  });

  it('discussed ≠ performed: discussion-only speech does not support performed treatment', () => {
    const report = newReport();
    appendContradictionFlags(report, {
      noteTreatmentText: ['Extraction of tooth 38 performed.'],
      noteObjectiveText: [],
      transcript: [
        { sender: 'Dentist', text: 'We discussed extracting 38 at the next appointment.' }
      ]
    });

    expect(report.unverifiedClaims.length).toBe(1);
    expect(report.isFullyGrounded).toBe(false);
  });

  it('performed ≠ verified is preserved: performed speech triggers no flag but certifies nothing', () => {
    const report = newReport();
    appendContradictionFlags(report, {
      noteTreatmentText: ['Composite restoration placed on tooth 36 today.'],
      noteObjectiveText: [],
      transcript: [
        { sender: 'Dentist', text: 'Restoring tooth 36 with composite today.' }
      ]
    });

    expect(report.unverifiedClaims.length).toBe(0);
    // The module never SETS isFullyGrounded to true — it can only revoke it.
    expect(report.isFullyGrounded).toBe(true);
  });

  it('patient report ≠ clinician observation: echoed patient symptom in findings is flagged', () => {
    const report = newReport();
    appendContradictionFlags(report, {
      noteTreatmentText: [],
      noteObjectiveText: ['Tooth feels loose when chew on it.'],
      transcript: [
        { sender: 'Patient', text: 'My tooth feels loose when I chew on it.' }
      ]
    });

    expect(report.unverifiedClaims.length).toBe(1);
    expect(report.unverifiedClaims[0]).toMatch(/Attribution review/i);
    expect(report.isFullyGrounded).toBe(false);
  });

  it('patient report corroborated by clinician narration is not flagged', () => {
    const report = newReport();
    appendContradictionFlags(report, {
      noteTreatmentText: [],
      noteObjectiveText: ['Tooth feels loose when chew on it.'],
      transcript: [
        { sender: 'Patient', text: 'My tooth feels loose when I chew on it.' },
        { sender: 'Dentist', text: 'The tooth does feel loose when I chew on it for you, mobility evident.' }
      ]
    });

    expect(report.unverifiedClaims.length).toBe(0);
  });

  it('flag-only rule: never mutates clinical content inputs or unrelated report fields', () => {
    const report = newReport();
    const noteTreatment = ['Composite restoration placed on tooth 36 today.'];
    const noteObjective = ['Tooth feels loose.'];
    const transcript = [{ sender: 'Patient', text: 'My tooth feels loose.' }];
    const noteTreatmentSnapshot = [...noteTreatment];
    const noteObjectiveSnapshot = [...noteObjective];

    appendContradictionFlags(report, {
      noteTreatmentText: noteTreatment,
      noteObjectiveText: noteObjective,
      transcript
    });

    expect(noteTreatment).toEqual(noteTreatmentSnapshot);
    expect(noteObjective).toEqual(noteObjectiveSnapshot);
    // Void function: only the three designated report fields change.
    expect(Object.keys(report).sort()).toEqual(['groundingScore', 'isFullyGrounded', 'unverifiedClaims']);
  });

  it('un-diarized Dialogue transcripts are never flagged for attribution (conservative)', () => {
    const report = newReport();
    appendContradictionFlags(report, {
      noteTreatmentText: [],
      noteObjectiveText: ['Tooth feels loose.'],
      transcript: [
        { sender: 'Dialogue', text: 'My tooth feels loose.' }
      ]
    });

    expect(report.unverifiedClaims.length).toBe(0);
    expect(report.isFullyGrounded).toBe(true);
  });
});
