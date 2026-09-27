/**
 * Phase 10 remediation — F-3: negation scope at the extractor.
 *
 * "No pain at the moment" used to yield a POSITIVE symptom(pain) fact. The
 * extractor itself must now produce the correct assertion semantics: negated
 * forms carry status 'negated' (+ negationScope), positive forms do not — and
 * the two are always distinguishable without any downstream repair.
 */
import { describe, it, expect } from 'vitest';
import { extractBaselineFacts } from '../src/lib/clinicalEvaluation/deterministicExtractor';
import { createCanonicalClinicalFact, isFactConstructionFailure } from '../src/lib/clinicalFactMigration';
import { hasSemanticNegation } from '../src/lib/treatmentStatus';

function factsFor(speaker: 'Patient' | 'Dentist', text: string) {
  const cands = extractBaselineFacts([{ utteranceId: 'u-1', speaker, text }]);
  return cands
    .map(c => createCanonicalClinicalFact(c))
    .filter((r): r is Extract<typeof r, { success: true }> => !isFactConstructionFailure(r))
    .map(r => r.fact);
}

describe('F-3: extractor negation scope (regression)', () => {
  const negatedCases: Array<[string, 'Patient' | 'Dentist', string, RegExp]> = [
    ['no pain', 'Patient', 'No pain at the moment.', /pain/i],
    ['no sensitivity', 'Patient', 'No sensitivity to cold anymore.', /sensitiv/i],
    ['denies pain', 'Patient', 'I deny any pain in that tooth.', /pain/i],
    ['denies sensitivity', 'Patient', 'Denies sensitivity on brushing.', /sensitiv/i],
    ['no caries', 'Dentist', 'No caries on 36.', /caries/i],
    ['no swelling', 'Dentist', 'No swelling in the vestibule.', /swelling/i],
    ['no bleeding', 'Dentist', 'No bleeding on probing.', /bleeding/i],
  ];

  for (const [name, speaker, text, concept] of negatedCases) {
    it(`"${name}" yields a NEGATED assertion, never a positive one`, () => {
      expect(hasSemanticNegation(text)).toBe(true);
      const facts = factsFor(speaker, text);
      const relevant = facts.filter(f => concept.test(JSON.stringify(f.value)));
      if (relevant.length > 0) {
        // Where the extractor represents the concept at all, it must be negated.
        for (const f of relevant) {
          expect(f.status).toBe('negated');
          expect(f.negationScope).toBeTruthy();
        }
      }
      // And under no circumstances a positive clinical assertion.
      const positives = facts.filter(f =>
        (f.status === 'observed' || f.status === 'performed' || f.status === 'reported') &&
        concept.test(JSON.stringify(f.value)));
      expect(positives, JSON.stringify(facts)).toEqual([]);
    });
  }

  it('positive and negated forms are distinguishable for the same concept', () => {
    const positive = factsFor('Patient', 'Sharp pain in my lower jaw.').filter(f => f.type === 'symptom');
    const negated = factsFor('Patient', 'No pain in my lower jaw.').filter(f => f.type === 'symptom');
    expect(positive.length).toBeGreaterThan(0);
    expect(positive[0].status).not.toBe('negated');
    if (negated.length > 0) {
      expect(negated[0].status).toBe('negated');
    }
  });

  it('positive controls still extract positively (guard against over-negation)', () => {
    const findings = factsFor('Dentist', 'Caries on 36 and swelling in the vestibule.')
      .filter(f => f.type === 'tooth_finding' || f.type === 'periodontal_finding');
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.status).toBe('observed');
      expect(f.status).not.toBe('negated');
    }
  });
});
