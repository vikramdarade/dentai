import { describe, it, expect } from 'vitest';
import {
  detectTreatmentStatus,
  hasSemanticNegation,
  collectStatusSignals,
  type TreatmentStatus,
} from '../src/lib/treatmentStatus';

describe('Deterministic Treatment Status Primitive (Phase 5)', () => {
  describe('negation handling (spec §10)', () => {
    const negated = [
      'No pain on percussion.',
      'No swelling present.',
      'No bleeding noted.',
      'No caries detected.',
      'No mobility.',
      'No filling was placed.',
      'No treatment performed today.',
      'Patient denies sensitivity.',
      'No allergy reported.',
      'Composite restoration ruled out for today.',
      'Extraction not done today.',
    ];

    it.each(negated)('classifies negated phrase as negated: "%s"', (text) => {
      expect(detectTreatmentStatus(text)).toBe('negated');
      expect(hasSemanticNegation(text)).toBe(true);
    });

    it('never promotes a negated procedure to performed', () => {
      // The exact audit example: "no filling was placed" must never match the
      // "placed" completed-verb path as a positive finding.
      expect(detectTreatmentStatus('No filling was placed on tooth 36 today.')).toBe('negated');
    });

    it('does not flag innocuous sentences containing "no" as part of clinical narration', () => {
      expect(hasSemanticNegation('Restoring tooth 26 with composite resin.')).toBe(false);
    });
  });

  describe('planned vs performed (spec §9 / §26)', () => {
    it('classifies next-appointment discussion as planned, not performed', () => {
      expect(detectTreatmentStatus('We will restore 36 next visit.')).toBe('planned');
      expect(detectTreatmentStatus('We discussed extracting 36 at the next appointment.')).toBe('planned');
      expect(detectTreatmentStatus('Extraction planned for the next appointment.')).toBe('planned');
      expect(detectTreatmentStatus('The tooth is to be extracted next week.')).toBe('planned');
    });

    it('classifies today-completed procedures as performed', () => {
      expect(detectTreatmentStatus('The composite restoration was completed today.')).toBe('performed');
      expect(detectTreatmentStatus('36 was restored today.')).toBe('performed');
      expect(detectTreatmentStatus('Composite resin restoration placed on tooth 36 MO today.')).toBe('performed');
      expect(detectTreatmentStatus('Restoring tooth 26 with composite.')).toBe('performed');
    });

    it('classifies explicit refusal as declined', () => {
      expect(detectTreatmentStatus('Patient declined extraction today.')).toBe('declined');
      expect(detectTreatmentStatus('The patient refused root canal treatment.')).toBe('declined');
    });
  });

  describe('historical vs current (spec §11 / §26)', () => {
    it('classifies past treatment as historical, not performed today', () => {
      expect(detectTreatmentStatus('The patient had a crown placed on 36 last year.')).toBe('historical');
      expect(detectTreatmentStatus('Root canal completed two years ago by previous dentist.')).toBe('historical');
      expect(detectTreatmentStatus('Existing crown on tooth 46.')).toBe('historical');
    });
  });

  describe('discussed vs performed', () => {
    it('classifies deliberation as discussed', () => {
      expect(detectTreatmentStatus('We discussed the option of a crown versus a large filling.')).toBe('discussed');
      expect(detectTreatmentStatus('Considering whether 36 needs a root canal.')).toBe('discussed');
    });
  });

  describe('safety bias (constraint 4/9)', () => {
    it('returns unknown for ambiguous or empty text — never defaults to performed', () => {
      expect(detectTreatmentStatus('')).toBe('unknown');
      expect(detectTreatmentStatus('   ')).toBe('unknown');
      expect(detectTreatmentStatus('Tooth 36.')).toBe('unknown');
      expect(detectTreatmentStatus('Patient seems anxious about treatment.')).toBe('unknown');
    });

    it('negation outranks every other signal (precedence check)', () => {
      expect(detectTreatmentStatus('No extraction planned next visit.')).toBe('negated');
    });
  });

  describe('status-signal aggregation (server seam input)', () => {
    it('collects signals across transcript utterances', () => {
      const signals = collectStatusSignals([
        'No filling was placed today.',
        'We will restore 36 next visit.',
        'Restoring tooth 26 with composite.',
        undefined,
        '',
      ]);
      expect(signals).toEqual({
        performed: true,
        planned: true,
        discussed: false,
        declined: false,
        historical: false,
        negated: true,
      });
    });

    it('is typed as TreatmentStatus (compile-level guard on taxonomy)', () => {
      const s: TreatmentStatus = detectTreatmentStatus('x');
      expect(['performed', 'planned', 'discussed', 'declined', 'historical', 'negated', 'unknown']).toContain(s);
    });
  });
});
