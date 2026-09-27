/**
 * Phase 10 remediation — F-2: evaluation provenance honesty.
 *
 * The gold-set harness used to label fixture-generated timing as 'measured'
 * and synthesize endMs (+3000 ms). Fixture timing is now labelled 'synthetic'
 * and the harness never invents an end time the fixture did not provide.
 */
import { describe, it, expect } from 'vitest';
import { toTimestamped } from '../src/lib/clinicalEvaluation/phase8Runner';
import type { ClinicalEvaluationCase } from '../src/lib/clinicalEvaluation/types';

function caseWith(transcript: ClinicalEvaluationCase['transcript']): ClinicalEvaluationCase {
  return {
    id: 'prov-1',
    clinicalDomain: 'test',
    category: 'representative',
    isAdversarial: false,
    appointmentType: 'examination',
    transcript,
    expectedFacts: [],
  } as unknown as ClinicalEvaluationCase;
}

describe('F-2: evaluation fixture provenance', () => {
  it('labels fixture-supplied timing as synthetic — never "measured"', () => {
    const utterances = toTimestamped(caseWith([
      { utteranceId: 'u1', speaker: 'Dentist', text: 'Caries on 36.', startMs: 1000, endMs: 4000 },
    ] as any));
    expect(utterances).toHaveLength(1);
    expect(utterances[0].timingProvenance).toBe('synthetic');
    expect(utterances[0].timingProvenance).not.toBe('measured');
  });

  it('does not fabricate an end time the fixture did not provide', () => {
    const utterances = toTimestamped(caseWith([
      { utteranceId: 'u1', speaker: 'Dentist', text: 'Caries on 36.', startMs: 1000 },
    ] as any));
    expect(utterances[0].timingProvenance).toBe('synthetic');
    expect((utterances[0] as { endTimeMs?: number }).endTimeMs).toBeUndefined();
  });

  it('keeps untimed fixture utterances honestly unavailable', () => {
    const utterances = toTimestamped(caseWith([
      { utteranceId: 'u1', speaker: 'Patient', text: 'It aches.' },
    ] as any));
    expect(utterances[0].timingProvenance).toBe('unavailable');
    expect((utterances[0] as { startTimeMs?: number }).startTimeMs).toBeUndefined();
  });

  it('no fixture utterance can ever claim measured provenance', () => {
    const utterances = toTimestamped(caseWith([
      { utteranceId: 'u1', speaker: 'Dentist', text: 'A.', startMs: 0, endMs: 100 },
      { utteranceId: 'u2', speaker: 'Dentist', text: 'B.', startMs: 200 },
      { utteranceId: 'u3', speaker: 'Dentist', text: 'C.' },
    ] as any));
    for (const u of utterances) {
      expect(u.timingProvenance).not.toBe('measured');
    }
  });
});
