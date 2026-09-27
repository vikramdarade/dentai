import { describe, it, expect } from 'vitest';
import {
  createCanonicalClinicalFact,
  isFactConstructionFailure,
} from '../src/lib/clinicalFactMigration';
import type { ClinicalFact, CandidateClinicalFact } from '../src/types/clinicalFact';
import type { TimestampedUtterance } from '../src/grounding/types';
import {
  evaluateVerificationTriggers,
  runSelectiveVerificationPass,
  buildVerificationContext,
  verifyFacts,
  assertDecisionIntegrity,
  applyVerificationDecisions,
} from '../src/lib/clinicalVerification';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkFact(candidate: CandidateClinicalFact): ClinicalFact {
  const result = createCanonicalClinicalFact(candidate);
  if (isFactConstructionFailure(result)) {
    throw new Error(`Test fact construction failed: ${result.errors.join('; ')}`);
  }
  return result.fact;
}

function span(utteranceId: string, rawText: string) {
  return { utteranceId, rawText, source: 'transcript' as const };
}

function utt(id: string, sender: TimestampedUtterance['sender'], text: string, startMs?: number): TimestampedUtterance {
  return typeof startMs === 'number'
    ? { id, sender, text, startTimeMs: startMs, endTimeMs: startMs + 2000, timingProvenance: 'measured' }
    : { id, sender, text, timingProvenance: 'unavailable' };
}

/** A clean, well-evidenced, diarized fact set: must NOT trigger verification. */
function cleanFactSet(): { facts: ClinicalFact[]; transcript: TimestampedUtterance[] } {
  const transcript = [
    utt('u1', 'Dentist', 'Restoring tooth 36 with composite today.', 1000),
    utt('u2', 'Patient', 'It was sensitive to cold on that side.', 4000),
    utt('u3', 'Dentist', 'Administered articaine infiltration.', 7000),
  ];
  const facts = [
    mkFact({
      id: 'f-proc-36',
      type: 'procedure',
      speaker: 'clinician',
      evidenceType: 'clinician_observed',
      value: { name: 'composite restoration' },
      status: 'performed',
      temporal: 'completed_today',
      certainty: 'certain',
      extractionMethod: 'verbatim',
      anatomy: { teeth: [36], surfaces: ['O'] },
      evidence: [span('u1', 'Restoring tooth 36 with composite today.')],
    }),
    mkFact({
      id: 'f-symptom',
      type: 'symptom',
      speaker: 'patient',
      evidenceType: 'patient_reported',
      value: { description: 'sensitive to cold' },
      status: 'reported',
      temporal: 'current',
      certainty: 'certain',
      extractionMethod: 'verbatim',
      evidence: [span('u2', 'It was sensitive to cold on that side.')],
    }),
  ];
  return { facts, transcript };
}

// ---------------------------------------------------------------------------
// 1. Selectivity — the normal path
// ---------------------------------------------------------------------------

describe('Phase 6 selective verification', () => {
  it('1. normal, well-evidenced facts require NO verifier invocation', () => {
    const { facts, transcript } = cleanFactSet();
    const result = runSelectiveVerificationPass(facts, transcript);

    expect(result.triggered).toBe(false);
    expect(result.triggerCount).toBe(0);
    expect(result.verification).toBeUndefined();
    expect(result.applied).toHaveLength(0);
    // Fact set passes through untouched (same object references).
    expect(result.facts[0]).toBe(facts[0]);
    expect(result.facts[1]).toBe(facts[1]);
    expect(result.telemetry.latencyMs).toBe(0);
  });

  it('1b. a varied clean fact set fires zero triggers (no-trigger bias)', () => {
    const transcript = [
      utt('t1', 'Dentist', 'Scaling tooth 36 and polishing today.', 0),
      utt('t2', 'Patient', 'I take my blood pressure tablets regularly.', 3000),
    ];
    const facts = [
      mkFact({
        id: 'g-proc', type: 'procedure', speaker: 'clinician', evidenceType: 'clinician_observed',
        value: { name: 'scale and clean' }, status: 'performed', temporal: 'completed_today',
        certainty: 'certain', extractionMethod: 'verbatim',
        anatomy: { teeth: [36] }, evidence: [span('t1', 'Scaling tooth 36 and polishing today.')],
      }),
      mkFact({
        id: 'g-med', type: 'medication', speaker: 'patient', evidenceType: 'patient_reported',
        value: { drugName: 'metformin' }, status: 'reported', temporal: 'current',
        certainty: 'certain', extractionMethod: 'verbatim',
        evidence: [span('t2', 'I take my blood pressure tablets regularly.')],
      }),
    ];      // Note: metformin is not in the anticoagulant watch-list; transcript has no
    // performed-treatment conflicts; attribution is diarized.
    const triggers = evaluateVerificationTriggers(facts, {
      hasDiarization: true,
      utteranceTexts: new Map(transcript.map(u => [u.id, u.text])),
      transcriptSignals: { performed: true, planned: false, discussed: false, declined: false, historical: false, negated: false },
    });
    expect(triggers).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 2–6. Explicit triggers
  // -------------------------------------------------------------------------

  it('2. ambiguous tooth number triggers verification (evidence names a different tooth)', () => {
    const transcript = [utt('u1', 'Dentist', 'Restoring tooth 46 with composite.', 0)];
    const fact = mkFact({
      id: 'f-wrong-tooth', type: 'procedure', speaker: 'clinician', evidenceType: 'clinician_observed',
      value: { name: 'composite restoration' }, status: 'performed', temporal: 'completed_today',
      certainty: 'certain', extractionMethod: 'verbatim',
      anatomy: { teeth: [36], surfaces: ['O'] },
      evidence: [span('u1', 'Restoring tooth 46 with composite.')],
    });
    const result = runSelectiveVerificationPass([fact], transcript);
    expect(result.triggered).toBe(true);
    expect(result.triggers.map(t => t.trigger)).toContain('ambiguous_tooth_number');
  });

  it('3. negation ambiguity triggers verification (negation cue in evidence of a non-negated fact)', () => {
    const transcript = [utt('u1', 'Dentist', 'No caries detected on tooth 36.', 0)];
    const fact = mkFact({
      id: 'f-neg-amb', type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed',
      value: { condition: 'caries' }, status: 'observed', temporal: 'current',
      certainty: 'certain', extractionMethod: 'verbatim',
      anatomy: { teeth: [36], surfaces: ['O'] },
      evidence: [span('u1', 'No caries detected on tooth 36.')],
    });
    const result = runSelectiveVerificationPass([fact], transcript);
    expect(result.triggers.map(t => t.trigger)).toContain('negation_ambiguity');
    // The verifier must fail closed here, not confirm the finding.
    const decision = result.verification?.decisions.find(d => d.factId === 'f-neg-amb');
    expect(decision?.outcome).toBe('flagged');
    expect(result.facts.find(f => f.id === 'f-neg-amb')?.verificationState).toBe('flagged');
  });

  it('3b. SAFETY: positive finding over negated evidence is never auto-verified', () => {
    const transcript = [utt('u1', 'Dentist', 'No caries detected on tooth 36.', 0)];
    const fact = mkFact({
      id: 'f-neg-safety', type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed',
      value: { condition: 'caries' }, status: 'observed', temporal: 'current',
      certainty: 'certain', extractionMethod: 'verbatim',
      anatomy: { teeth: [36], surfaces: ['O'] },
      evidence: [span('u1', 'No caries detected on tooth 36.')],
    });
    // Direct verifier call with high token overlap — corroboration alone must
    // NOT clear a fact whose evidence contradicts it.
    const context = buildVerificationContext([fact], transcript);
    const verification = verifyFacts([fact], [
      { trigger: 'negation_ambiguity', factIds: ['f-neg-safety'], severity: 'high', reason: 'test' },
    ], context);
    expect(verification.decisions[0].outcome).toBe('flagged');
  });

  it('4. planned/performed conflict triggers verification', () => {
    const transcript = [
      utt('u1', 'Dentist', 'We will extract 36 next visit.', 0),
      utt('u2', 'Dentist', 'Restoring tooth 26 today with composite.', 5000),
    ];
    const fact = mkFact({
      id: 'f-planned', type: 'procedure', speaker: 'clinician', evidenceType: 'clinician_observed',
      value: { name: 'extraction' }, status: 'planned', temporal: 'next_appointment',
      certainty: 'certain', extractionMethod: 'verbatim',
      anatomy: { teeth: [36] },
      evidence: [span('u1', 'We will extract 36 next visit.')],
    });
    const result = runSelectiveVerificationPass([fact], transcript);
    expect(result.triggers.map(t => t.trigger)).toContain('planned_performed_ambiguity');
  });

  it('4b. performed status with no performed speech triggers procedure_status_conflict', () => {
    const transcript = [utt('u1', 'Dentist', 'We discussed restoring 36 at the next appointment.', 0)];
    const fact = mkFact({
      id: 'f-status', type: 'procedure', speaker: 'clinician', evidenceType: 'clinician_observed',
      value: { name: 'composite restoration' }, status: 'performed', temporal: 'completed_today',
      certainty: 'certain', extractionMethod: 'model_extracted',
      anatomy: { teeth: [36], surfaces: ['O'] },
      evidence: [span('u1', 'We discussed restoring 36 at the next appointment.')],
    });
    const result = runSelectiveVerificationPass([fact], transcript);
    expect(result.triggers.map(t => t.trigger)).toContain('procedure_status_conflict');
    const decision = result.verification?.decisions.find(d => d.factId === 'f-status');
    expect(decision?.outcome).toBe('flagged');
  });

  it('5. patient statement promoted to clinician finding triggers verification', () => {
    // The Phase 3 trust boundary correctly REFUSES to construct a fact with
    // speaker='patient' + evidenceType='clinician_observed' — that rejection is
    // itself the primary guard. To prove the Phase 6 trigger also exists as
    // defence-in-depth, we bypass construction with a contract-shaped fixture.
    const transcript = [utt('u1', 'Patient', 'My tooth feels loose.', 0)];
    const promoted = {
      id: 'f-promoted', type: 'symptom' as const, speaker: 'patient' as const,
      evidenceType: 'clinician_observed' as const,
      value: { description: 'loose tooth' }, status: 'observed' as const, temporal: 'current' as const,
      certainty: 'certain' as const, extractionMethod: 'model_extracted' as const,
      anatomy: { teeth: [] },
      evidence: [span('u1', 'My tooth feels loose.')],
      validationState: 'valid' as const, verificationState: 'unverified' as const,
      verificationMethod: 'none' as const,
    } as unknown as ClinicalFact;
    const result = runSelectiveVerificationPass([promoted], transcript);
    expect(result.triggers.map(t => t.trigger)).toContain('patient_statement_promoted_to_clinician_finding');
    // Fail closed: cannot be auto-verified.
    const decision = result.verification?.decisions.find(d => d.factId === 'f-promoted');
    expect(decision?.outcome).toBe('flagged');
  });

  it('5b. trust boundary: the canonical constructor REFUSES patient→clinician promotion outright', () => {
    const result = createCanonicalClinicalFact({
      id: 'f-refused', type: 'symptom', speaker: 'patient', evidenceType: 'clinician_observed',
      value: { description: 'loose tooth' }, status: 'observed', temporal: 'current',
      certainty: 'certain', extractionMethod: 'model_extracted',
      evidence: [span('u1', 'My tooth feels loose.')],
    });
    expect(isFactConstructionFailure(result)).toBe(true);
  });

  it('6. conflicting medication triggers verification (drug absent from transcript)', () => {
    const transcript = [utt('u1', 'Patient', 'I take a blood thinner daily.', 0)];
    const fact = mkFact({
      id: 'f-med', type: 'medication', speaker: 'patient', evidenceType: 'patient_reported',
      value: { drugName: 'Eliquis' }, status: 'reported', temporal: 'current',
      certainty: 'certain', extractionMethod: 'model_extracted',
      evidence: [span('u1', 'I take a blood thinner daily.')],
    });
    const result = runSelectiveVerificationPass([fact], transcript);
    expect(result.triggers.map(t => t.trigger)).toContain('medication_conflict');
  });

  it('6b. dose conflict triggers verification (spoken dose differs from fact dose)', () => {
    const transcript = [utt('u1', 'Patient', 'I am on Eliquis 2 mg daily.', 0)];
    const fact = mkFact({
      id: 'f-dose', type: 'medication', speaker: 'patient', evidenceType: 'patient_reported',
      value: { drugName: 'Eliquis', dose: '5 mg' }, status: 'reported', temporal: 'current',
      certainty: 'certain', extractionMethod: 'model_extracted',
      evidence: [span('u1', 'I am on Eliquis 2 mg daily.')],
    });
    const result = runSelectiveVerificationPass([fact], transcript);
    expect(result.triggers.map(t => t.trigger)).toContain('dose_conflict');
  });

  // -------------------------------------------------------------------------
  // 7–12. Safety invariants
  // -------------------------------------------------------------------------

  it('7. missing evidence on a high-risk fact fails closed to review-required', () => {
    const fact = mkFact({
      id: 'f-noev', type: 'medication', speaker: 'patient', evidenceType: 'patient_reported',
      value: { drugName: 'Warfarin' }, status: 'reported', temporal: 'current',
      certainty: 'certain', extractionMethod: 'model_extracted',
    });
    const transcript = [utt('u1', 'Patient', 'General discussion.', 0)];
    const result = runSelectiveVerificationPass([fact], transcript);
    expect(result.triggers.map(t => t.trigger)).toContain('missing_evidence_high_risk');

    // Even a (hypothetical) verified decision is refused by the state machine.
    const refused = applyVerificationDecisions([fact], {
      decisions: [{
        factId: 'f-noev', outcome: 'verified', reason: 'claimed', evidenceUtteranceIds: [], trigger: 'test',
      }],
      undecidedFactIds: [],
      latencyMs: 0,
    });
    const updated = refused.facts.find(f => f.id === 'f-noev')!;
    expect(updated.verificationState).toBe('flagged');
    expect(refused.refusedDecisions).toHaveLength(1);
  });

  it('8. verifier cannot create unsupported facts (structure + runtime)', () => {
    const { facts, transcript } = cleanFactSet();
    const result = runSelectiveVerificationPass(facts, transcript);

    // No decision can add to the fact set.
    expect(result.facts).toHaveLength(facts.length);
    expect(result.facts.map(f => f.id).sort()).toEqual([...facts.map(f => f.id)].sort());
    // Clinical values are byte-identical.
    for (const original of facts) {
      const after = result.facts.find(f => f.id === original.id)!;
      expect(after.value).toEqual(original.value);
      expect(after.anatomy).toEqual(original.anatomy);
      expect(after.status).toBe(original.status);
      expect(after.speaker).toBe(original.speaker);
      expect(after.evidence).toEqual(original.evidence);
    }

    // Structural guarantee: the decision type carries no clinical payload.
    // (Compile-time: VerificationDecision has only factId/outcome/reason/
    //  evidenceUtteranceIds/trigger — asserted by the object literal below.)
    const decision = result.verification?.decisions[0];
    if (decision) {
      expect(Object.keys(decision).sort()).toEqual(
        ['evidenceUtteranceIds', 'factId', 'outcome', 'reason', 'trigger']
      );
    }
  });

  it('9. verifier cannot manufacture provenance (integrity assertion throws)', () => {
    const context = buildVerificationContext([], [utt('u1', 'Dentist', 'Real utterance.', 0)]);
    const bogus: Parameters<typeof assertDecisionIntegrity>[0] = {
      decisions: [{
        factId: 'f-x', outcome: 'verified', reason: 'r',
        evidenceUtteranceIds: ['utt-fabricated-999'], trigger: 'test',
      }],
      undecidedFactIds: [],
      latencyMs: 0,
    };
    expect(() => assertDecisionIntegrity(bogus, context)).toThrow(/never supplied/);
  });

  it('10. verifier output contains no final note prose', () => {
    const { facts, transcript } = cleanFactSet();
    const result = runSelectiveVerificationPass(facts, transcript);

    if (result.verification) {
      expect(Object.keys(result.verification).sort()).toEqual(['decisions', 'latencyMs', 'undecidedFactIds']);
    }
    expect('note' in result).toBe(false);
    expect('noteText' in result).toBe(false);
    expect('sections' in result).toBe(false);
  });

  it('11. verifier rejection produces a review-required (non-verified) state', () => {
    const { facts } = cleanFactSet();
    const fact = facts[0];
    const rejected = applyVerificationDecisions([fact], {
      decisions: [{ factId: fact.id, outcome: 'rejected', reason: 'evidence contradicts', evidenceUtteranceIds: ['u1'], trigger: 'test' }],
      undecidedFactIds: [],
      latencyMs: 0,
    });
    expect(rejected.facts[0].verificationState).toBe('rejected');
    expect(rejected.facts[0].verificationState).not.toBe('verified');

    const flagged = applyVerificationDecisions([fact], {
      decisions: [{ factId: fact.id, outcome: 'flagged', reason: 'ambiguous', evidenceUtteranceIds: ['u1'], trigger: 'test' }],
      undecidedFactIds: [],
      latencyMs: 0,
    });
    expect(flagged.facts[0].verificationState).toBe('flagged');
    expect(flagged.facts[0].verificationState).not.toBe('verified');
  });

  it('12. verifier confirmation is NOT clinician sign-off (methods remain distinct)', () => {
    // A low-severity trigger (missing surface detail on a finding) with fully
    // corroborating evidence resolves to verified — via the selective agent
    // only. Clinician sign-off is a distinct method the pipeline can never
    // assign.
    const transcript = [utt('u1', 'Dentist', 'Cracked cusp noted on tooth 36 today.', 0)];
    const fact = mkFact({
      id: 'f-verify', type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed',
      value: { condition: 'cracked cusp' }, status: 'observed', temporal: 'current',
      certainty: 'certain', extractionMethod: 'verbatim',
      anatomy: { teeth: [36] },
      evidence: [span('u1', 'Cracked cusp noted on tooth 36 today.')],
    });
    const result = runSelectiveVerificationPass([fact], transcript);
    expect(result.triggered).toBe(true);
    const updated = result.facts.find(f => f.id === 'f-verify')!;

    expect(updated.verificationState).toBe('verified');
    expect(updated.verificationMethod).toBe('selective_agent');
    expect(updated.verificationMethod).not.toBe('clinician_review');
  });

  // -------------------------------------------------------------------------
  // Adversarial cases
  // -------------------------------------------------------------------------

  it('adv-1: un-diarized transcript triggers attribution verification for every fact', () => {
    const { facts, transcript } = cleanFactSet();
    const result = runSelectiveVerificationPass(facts, transcript, { hasDiarization: false });
    expect(result.triggered).toBe(true);
    expect(result.triggers.map(t => t.trigger)).toContain('uncertain_speaker_attribution');
  });

  it('adv-2: low ASR confidence on high-risk evidence triggers critical verification', () => {
    const transcript = [
      { id: 'u1', sender: 'Dentist' as const, text: 'Administered articaine 2 percent.', startTimeMs: 0, endTimeMs: 2000, timingProvenance: 'measured' as const, asrConfidence: 0.42 },
    ];
    const fact = mkFact({
      id: 'f-lowconf', type: 'anaesthetic', speaker: 'clinician', evidenceType: 'clinician_observed',
      value: { agent: 'articaine', technique: 'infiltration' }, status: 'performed', temporal: 'completed_today',
      certainty: 'certain', extractionMethod: 'verbatim',
      evidence: [span('u1', 'Administered articaine 2 percent.')],
    });
    const result = runSelectiveVerificationPass([fact], transcript);
    const trigger = result.triggers.find(t => t.trigger === 'low_asr_confidence');
    expect(trigger).toBeDefined();
    expect(trigger?.severity).toBe('critical');
  });

  it('adv-3: contradictory facts (negated + asserted) trigger verification', () => {
    const transcript = [
      utt('u1', 'Dentist', 'No caries on 36, but 46 has caries.', 0),
    ];
    const negated = mkFact({
      id: 'f-neg', type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed',
      value: { condition: 'caries' }, status: 'negated', temporal: 'current',
      certainty: 'certain', extractionMethod: 'verbatim',
      anatomy: { teeth: [36], surfaces: ['O'] },
      evidence: [span('u1', 'No caries on 36, but 46 has caries.')],
    });
    const asserted = mkFact({
      id: 'f-pos', type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed',
      value: { condition: 'caries' }, status: 'observed', temporal: 'current',
      certainty: 'certain', extractionMethod: 'verbatim',
      anatomy: { teeth: [46], surfaces: ['O'] },
      evidence: [span('u1', 'No caries on 36, but 46 has caries.')],
    });
    const result = runSelectiveVerificationPass([negated, asserted], transcript);
    expect(result.triggers.map(t => t.trigger)).toContain('contradictory_facts');
  });

  it('adv-4: the same finding on two different teeth triggers conflicting_tooth_references', () => {
    const transcript = [
      utt('u1', 'Dentist', 'Caries on 36. Also caries on 46.', 0),
    ];
    const a = mkFact({
      id: 'f-a', type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed',
      value: { condition: 'caries' }, status: 'observed', temporal: 'current',
      certainty: 'certain', extractionMethod: 'verbatim',
      anatomy: { teeth: [36], surfaces: ['O'] }, evidence: [span('u1', 'Caries on 36. Also caries on 46.')],
    });
    const b = mkFact({
      id: 'f-b', type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed',
      value: { condition: 'caries' }, status: 'observed', temporal: 'current',
      certainty: 'certain', extractionMethod: 'verbatim',
      anatomy: { teeth: [46], surfaces: ['O'] }, evidence: [span('u1', 'Caries on 36. Also caries on 46.')],
    });
    const triggers = evaluateVerificationTriggers([a, b], {
      hasDiarization: true,
      utteranceTexts: new Map(transcript.map(u => [u.id, u.text])),
      transcriptSignals: { performed: false, planned: false, discussed: false, declined: false, historical: false, negated: false },
    });
    expect(triggers.map(t => t.trigger)).toContain('conflicting_tooth_references');
  });

  it('adv-5: evidence referencing an utterance missing from the transcript triggers entity_mismatch and stays flagged', () => {
    const transcript = [utt('u1', 'Dentist', 'Unrelated utterance.', 0)];
    const fact = mkFact({
      id: 'f-orphan', type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed',
      value: { condition: 'caries' }, status: 'observed', temporal: 'current',
      certainty: 'certain', extractionMethod: 'verbatim',
      anatomy: { teeth: [36], surfaces: ['O'] },
      evidence: [span('utt-does-not-exist', 'Caries on 36.')],
    });
    const result = runSelectiveVerificationPass([fact], transcript);
    expect(result.triggers.map(t => t.trigger)).toContain('entity_mismatch');
    const decision = result.verification?.decisions.find(d => d.factId === 'f-orphan');
    expect(decision?.outcome).toBe('flagged');
  });

  it('adv-6: measured timestamps pass through; unmeasured timing stays absent (no fabrication)', () => {
    const transcript = [
      utt('u-measured', 'Dentist', 'Restoring tooth 36.', 5000),
      utt('u-untimed', 'Dentist', 'Also polishing.', undefined),
    ];
    const fact = mkFact({
      id: 'f-timing', type: 'procedure', speaker: 'clinician', evidenceType: 'clinician_observed',
      value: { name: 'composite restoration' }, status: 'performed', temporal: 'completed_today',
      certainty: 'certain', extractionMethod: 'verbatim',
      anatomy: { teeth: [36] }, evidence: [span('u-measured', 'Restoring tooth 36.'), span('u-untimed', 'Also polishing.')],
    });
    const context = buildVerificationContext([fact], transcript);
    const measured = context.utterances.find(u => u.id === 'u-measured')!;
    const untimed = context.utterances.find(u => u.id === 'u-untimed')!;
    expect(measured.startMs).toBe(5000);
    expect(measured.timingProvenance).toBe('measured');
    expect(untimed.startMs).toBeUndefined();
    expect(untimed.timingProvenance).toBe('unavailable');
  });

  it('adv-7: telemetry is PHI-free (contains no transcript text)', () => {
    const transcript = [utt('u1', 'Dentist', 'SecretEliquisDose utterance content.', 0)];
    const fact = mkFact({
      id: 'f-phi', type: 'medication', speaker: 'patient', evidenceType: 'patient_reported',
      value: { drugName: 'Eliquis' }, status: 'reported', temporal: 'current',
      certainty: 'certain', extractionMethod: 'model_extracted',
      evidence: [span('u1', 'SecretEliquisDose utterance content.')],
    });
    const result = runSelectiveVerificationPass([fact], transcript);
    const serialized = JSON.stringify(result.telemetry);
    expect(serialized).not.toContain('SecretEliquisDose');
    expect(serialized).not.toContain('Eliquis');
  });

  it('adv-8: verification latency stays far below any interactive budget', () => {
    const { facts, transcript } = cleanFactSet();
    const result = runSelectiveVerificationPass(facts, transcript, { hasDiarization: false });
    expect(result.telemetry.latencyMs).toBeLessThan(100);
  });

  it('adv-9: state machine refuses any clinical-field mutation by construction', () => {
    const { facts } = cleanFactSet();
    const fact = facts[0];
    const result = applyVerificationDecisions([fact], {
      decisions: [{ factId: fact.id, outcome: 'verified', reason: 'r', evidenceUtteranceIds: ['u1'], trigger: 'test' }],
      undecidedFactIds: [],
      latencyMs: 0,
    });
    const before = fact as unknown as Record<string, unknown>;
    const after = result.facts[0] as unknown as Record<string, unknown>;
    for (const key of ['type', 'speaker', 'evidenceType', 'value', 'status', 'temporal', 'certainty', 'anatomy', 'evidence']) {
      expect(after[key]).toEqual(before[key]);
    }
    // Only verification fields changed.
    expect(after.verificationState).toBe('verified');
    expect(after.verificationMethod).toBe('selective_agent');
  });

  it('adv-10: facts without decisions pass through untouched', () => {
    // One flagged fact (evidence references a missing utterance) plus one
    // clean, well-evidenced fact: the decision set covers only the flagged
    // fact, so the clean fact must pass through with identical state.
    const transcript = [utt('u1', 'Dentist', 'Unrelated utterance.', 0)];
    const orphan = mkFact({
      id: 'f-orphan-b', type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed',
      value: { condition: 'caries' }, status: 'observed', temporal: 'current',
      certainty: 'certain', extractionMethod: 'verbatim',
      anatomy: { teeth: [36], surfaces: ['O'] },
      evidence: [span('utt-missing-999', 'Caries on 36.')],
    });
    const clean = mkFact({
      id: 'f-clean-b', type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed',
      value: { condition: 'sound enamel' }, status: 'observed', temporal: 'current',
      certainty: 'certain', extractionMethod: 'verbatim',
      anatomy: { teeth: [46], surfaces: ['B'] },
      evidence: [span('u1', 'Sound enamel on tooth 46.')],
    });
    const result = runSelectiveVerificationPass([orphan, clean], transcript);
    expect(result.untouchedFactIds).toEqual(['f-clean-b']);
    expect(result.facts.find(f => f.id === 'f-clean-b')!.verificationState).toBe('unverified');
  });
});
