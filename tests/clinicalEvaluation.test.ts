/**
 * DentAI Phase 4 Clinical Evaluation Harness Contract & Benchmark Tests (Remediated)
 *
 * Validates:
 * 1. Dataset schema and metadata invariants (v1.1.0, >=30% adversarial cases)
 * 2. Section 20 Golden Multi-Fact Benchmark Case (without fabricated percussion)
 * 3. Deterministic semantic fact matching (bipartite pairing, ID-invariant)
 * 4. 16-point Error Taxonomy & 4-tier Severity Classification
 * 5. Strict Precision, Recall, and F1 calculations (requiring 0 errors)
 * 6. Hard safety metrics (negation, temporal, anatomical, provenance, hallucination)
 * 7. Evidence evaluation & synthetic timestamp rejection
 * 8. Transcript evidence cross-referencing (utteranceId, rawText, speaker)
 * 9. Bidirectional property comparison (detects unsupported extra details)
 * 10. CandidateClinicalFact evaluation pathway (evaluateCandidateCase)
 * 11. All 10 Adversarial Regression Tests (Tests A through J)
 */

import { describe, it, expect } from 'vitest';
import {
  CLINICAL_EVALUATION_CORPUS_V1,
  CLINICAL_EVALUATION_CORPUS_VERSION,
  compareFactFields,
  compareClinicalFacts,
  evaluateCase,
  evaluateCandidateCase,
  aggregateBenchmarkMetrics,
  formatEvaluationReport,
  type ExpectedClinicalFact
} from '../src/lib/clinicalEvaluation';
import { createToothReference } from '../src/lib/clinicalFactMigration';
import type { ClinicalFact, CandidateClinicalFact } from '../src/types/clinicalFact';

describe('DentAI Phase 4: Deterministic Clinical Evaluation Harness (Remediated)', () => {

  // =========================================================================
  // 1. DATASET SCHEMA & ADVERSARIAL RATIO INVARIANTS
  // =========================================================================
  describe('Dataset Schema & Corpus Invariants', () => {
    it('verifies dataset versioning and non-empty corpus', () => {
      expect(CLINICAL_EVALUATION_CORPUS_VERSION).toBe('v1.1.0');
      expect(CLINICAL_EVALUATION_CORPUS_V1.length).toBeGreaterThanOrEqual(10);
      for (const c of CLINICAL_EVALUATION_CORPUS_V1) {
        expect(c.datasetVersion).toBe(CLINICAL_EVALUATION_CORPUS_VERSION);
        expect(c.id).toBeTruthy();
        expect(c.transcript.length).toBeGreaterThan(0);
        expect(c.expectedFacts.length).toBeGreaterThan(0);
      }
    });

    it('enforces that at least 30% of cases are explicitly adversarial', () => {
      const total = CLINICAL_EVALUATION_CORPUS_V1.length;
      const adversarialCount = CLINICAL_EVALUATION_CORPUS_V1.filter(c => c.isAdversarial).length;
      const ratio = adversarialCount / total;

      expect(ratio).toBeGreaterThanOrEqual(0.30);
      expect(adversarialCount).toBeGreaterThanOrEqual(4);
    });

    it('covers all required clinical categories', () => {
      const categories = new Set(CLINICAL_EVALUATION_CORPUS_V1.map(c => c.category));
      expect(categories.has('speaker')).toBe(true);
      expect(categories.has('negation')).toBe(true);
      expect(categories.has('temporal')).toBe(true);
      expect(categories.has('anatomy')).toBe(true);
      expect(categories.has('medication')).toBe(true);
      expect(categories.has('consent')).toBe(true);
      expect(categories.has('anaesthesia')).toBe(true);
      expect(categories.has('clinical_ambiguity')).toBe(true);
      expect(categories.has('adversarial')).toBe(true);
    });
  });

  // =========================================================================
  // 2. SECTION 20 GOLDEN BENCHMARK CASE
  // =========================================================================
  describe('Section 20 Golden Benchmark Case', () => {
    const goldenCase = CLINICAL_EVALUATION_CORPUS_V1.find(c => c.id === 'case-golden-001')!;

    it('finds and validates the structure of the golden case without fabricated percussion', () => {
      expect(goldenCase).toBeDefined();
      expect(goldenCase.expectedFacts.length).toBe(4);
      expect(goldenCase.expectedFacts[0].type).toBe('symptom');
      expect(goldenCase.expectedFacts[1].type).toBe('tooth_finding');
      expect(goldenCase.expectedFacts[2].type).toBe('tooth_finding');
      expect(goldenCase.expectedFacts[3].type).toBe('treatment_plan');

      // BLOCKER 2 Verification: Percussion was not tested in transcript and must not be in expected facts
      const vitalityFact = goldenCase.expectedFacts[2];
      if (typeof vitalityFact.value === 'object' && vitalityFact.value !== null) {
        const valObj = vitalityFact.value as Record<string, unknown>;
        if (valObj.vitality && typeof valObj.vitality === 'object') {
          expect((valObj.vitality as Record<string, unknown>).percussion).toBeUndefined();
        }
      }
    });

    it('evaluates perfect canonical extraction for golden case with 100% strict precision, recall, and F1', () => {
      const actualFacts: ClinicalFact[] = [
        {
          id: 'act-1',
          type: 'symptom',
          speaker: 'patient',
          evidenceType: 'patient_reported',
          status: 'reported',
          temporal: 'current',
          certainty: 'certain',
          extractionMethod: 'model_extracted',
          value: { description: 'sensitivity around the lower left molar', patientPhrase: "I've had sensitivity around the lower left molar." },
          anatomy: { teeth: [], quadrant: 3, arch: 'mandibular' },
          evidence: [{ utteranceId: 'u1', rawText: "I've had sensitivity around the lower left molar.", speaker: 'patient', source: 'transcript' }],
          validationState: 'valid',
          verificationState: 'unverified',
          verificationMethod: 'none'
        },
        {
          id: 'act-2',
          type: 'tooth_finding',
          speaker: 'clinician',
          evidenceType: 'clinician_observed',
          status: 'observed',
          temporal: 'current',
          certainty: 'certain',
          extractionMethod: 'model_extracted',
          anatomy: { teeth: [createToothReference(36)], surfaces: ['M', 'O', 'D'] },
          value: { condition: 'caries' },
          evidence: [{ utteranceId: 'u2', rawText: 'I can see an MOD carious lesion.', speaker: 'clinician', source: 'transcript' }],
          validationState: 'valid',
          verificationState: 'unverified',
          verificationMethod: 'none'
        },
        {
          id: 'act-3',
          type: 'tooth_finding',
          speaker: 'clinician',
          evidenceType: 'clinician_observed',
          status: 'observed',
          temporal: 'current',
          certainty: 'certain',
          extractionMethod: 'model_extracted',
          anatomy: { teeth: [createToothReference(36)] },
          value: { condition: 'vitality test', vitality: { coldTest: 'exaggerated' } },
          evidence: [{ utteranceId: 'u2', rawText: 'Tooth 36 is sensitive to cold but there is no lingering pain.', speaker: 'clinician', source: 'transcript' }],
          validationState: 'valid',
          verificationState: 'unverified',
          verificationMethod: 'none'
        },
        {
          id: 'act-4',
          type: 'treatment_plan',
          speaker: 'clinician',
          evidenceType: 'instruction',
          status: 'planned',
          temporal: 'next_appointment',
          certainty: 'certain',
          extractionMethod: 'model_extracted',
          anatomy: { teeth: [createToothReference(36)] },
          value: { proposedProcedures: ['composite restoration'] },
          evidence: [{ utteranceId: 'u2', rawText: "We'll restore it at the next visit.", speaker: 'clinician', source: 'transcript' }],
          validationState: 'valid',
          verificationState: 'unverified',
          verificationMethod: 'none'
        }
      ];

      const result = evaluateCase(goldenCase, actualFacts);
      expect(result.passed).toBe(true);
      expect(result.metrics.strictPrecision).toBe(1.0);
      expect(result.metrics.strictRecall).toBe(1.0);
      expect(result.metrics.strictF1).toBe(1.0);
      expect(result.metrics.strictTruePositives).toBe(4);
      expect(result.metrics.falsePositives).toBe(0);
      expect(result.metrics.falseNegatives).toBe(0);
      expect(result.errors.length).toBe(0);
    });
  });

  // =========================================================================
  // 3. ADVERSARIAL REGRESSION TESTS (TESTS A THROUGH J)
  // =========================================================================
  describe('Adversarial Regression Suite (Tests A Through J)', () => {

    // Test A — Extra clinical detail (Bidirectional check)
    it('Test A: detects unsupported extra clinical details in actual fact and fails strict F1', () => {
      const expected: ExpectedClinicalFact = {
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'observed',
        temporal: 'current',
        certainty: 'certain',
        anatomy: { teeth: [36] },
        value: { condition: 'caries' }
      };

      const actual: ClinicalFact = {
        id: 'act-extra',
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'observed',
        temporal: 'current',
        certainty: 'certain',
        extractionMethod: 'model_extracted',
        anatomy: { teeth: [createToothReference(36)] },
        value: {
          condition: 'caries',
          depth: 'pulpal_involvement', // Extra unsupported detail
          details: 'severe bone loss and pulpal necrosis' // Extra unsupported detail
        },
        evidence: [],
        validationState: 'valid',
        verificationState: 'unverified',
        verificationMethod: 'none'
      };

      const errors = compareFactFields(expected, actual);
      const unsupportedErrors = errors.filter(e => e.errorType === 'unsupported_detail');

      expect(unsupportedErrors.length).toBeGreaterThanOrEqual(1);
      expect(unsupportedErrors.some(e => e.severity === 'high')).toBe(true);
    });

    // Test B — Empty evidence when expected
    it('Test B: flags evidence_mismatch when actual fact provides empty evidence array', () => {
      const expected: ExpectedClinicalFact = {
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'observed',
        temporal: 'current',
        certainty: 'certain',
        anatomy: { teeth: [36] },
        expectedEvidenceKeywords: ['caries detected'],
        value: { condition: 'caries' }
      };

      const actual: ClinicalFact = {
        id: 'act-no-evidence',
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'observed',
        temporal: 'current',
        certainty: 'certain',
        extractionMethod: 'model_extracted',
        anatomy: { teeth: [createToothReference(36)] },
        value: { condition: 'caries' },
        evidence: [], // Empty evidence!
        validationState: 'valid',
        verificationState: 'unverified',
        verificationMethod: 'none'
      };

      const errors = compareFactFields(expected, actual);
      const evErr = errors.find(e => e.errorType === 'evidence_mismatch');
      expect(evErr).toBeDefined();
      expect(evErr!.severity).toBe('high');
    });

    // Test C — Fabricated evidence utteranceId
    it('Test C: detects fabricated utteranceId not present in transcript', () => {
      const expected: ExpectedClinicalFact = {
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'observed',
        temporal: 'current',
        certainty: 'certain',
        anatomy: { teeth: [36] },
        value: { condition: 'caries' }
      };

      const transcript = [
        { utteranceId: 'u1', speaker: 'clinician', text: 'I see a carious lesion on 36.' }
      ];

      const actual: ClinicalFact = {
        id: 'act-fabricated-u',
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'observed',
        temporal: 'current',
        certainty: 'certain',
        extractionMethod: 'model_extracted',
        anatomy: { teeth: [createToothReference(36)] },
        value: { condition: 'caries' },
        evidence: [{
          utteranceId: 'u999', // Does not exist!
          rawText: 'I see a carious lesion on 36.',
          source: 'transcript'
        }],
        validationState: 'valid',
        verificationState: 'unverified',
        verificationMethod: 'none'
      };

      const errors = compareFactFields(expected, actual, transcript);
      const evErr = errors.find(e => e.errorType === 'evidence_mismatch' && e.field === 'evidence.utteranceId');
      expect(evErr).toBeDefined();
      expect(evErr!.severity).toBe('critical');
    });

    // Test D — Fabricated quote
    it('Test D: detects evidence rawText that does not appear in referenced utterance', () => {
      const expected: ExpectedClinicalFact = {
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'observed',
        temporal: 'current',
        certainty: 'certain',
        anatomy: { teeth: [36] },
        value: { condition: 'caries' }
      };

      const transcript = [
        { utteranceId: 'u1', speaker: 'clinician', text: 'Tooth 36 has a shallow groove.' }
      ];

      const actual: ClinicalFact = {
        id: 'act-fabricated-text',
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'observed',
        temporal: 'current',
        certainty: 'certain',
        extractionMethod: 'model_extracted',
        anatomy: { teeth: [createToothReference(36)] },
        value: { condition: 'caries' },
        evidence: [{
          utteranceId: 'u1',
          rawText: 'The tooth is completely non-vital and necrotic.', // Fabricated quote!
          source: 'transcript'
        }],
        validationState: 'valid',
        verificationState: 'unverified',
        verificationMethod: 'none'
      };

      const errors = compareFactFields(expected, actual, transcript);
      const evErr = errors.find(e => e.errorType === 'evidence_mismatch' && e.field === 'evidence.rawText');
      expect(evErr).toBeDefined();
      expect(evErr!.severity).toBe('critical');
    });

    // Test E — Wrong speaker evidence
    it('Test E: detects speaker mismatch between evidence span and transcript utterance', () => {
      const expected: ExpectedClinicalFact = {
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'observed',
        temporal: 'current',
        certainty: 'certain',
        anatomy: { teeth: [36] },
        value: { condition: 'caries' }
      };

      const transcript = [
        { utteranceId: 'u1', speaker: 'patient', text: 'My tooth feels sore.' }
      ];

      const actual: ClinicalFact = {
        id: 'act-wrong-spk',
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'observed',
        temporal: 'current',
        certainty: 'certain',
        extractionMethod: 'model_extracted',
        anatomy: { teeth: [createToothReference(36)] },
        value: { condition: 'caries' },
        evidence: [{
          utteranceId: 'u1',
          rawText: 'My tooth feels sore.',
          speaker: 'clinician', // Contradicts patient utterance!
          source: 'transcript'
        }],
        validationState: 'valid',
        verificationState: 'unverified',
        verificationMethod: 'none'
      };

      const errors = compareFactFields(expected, actual, transcript);
      const spkErr = errors.find(e => e.errorType === 'wrong_speaker');
      expect(spkErr).toBeDefined();
      expect(spkErr!.severity).toBe('high');
    });

    // Test F — Wrong surface fails strict F1
    it('Test F: wrong_surface is detected and prevents strict F1 from reaching 1.0', () => {
      const caseDef: any = {
        id: 'case-test-f',
        datasetVersion: 'v1.1.0',
        transcript: [{ utteranceId: 'u1', speaker: 'clinician', text: 'Restored 36 O.' }],
        expectedFacts: [{
          type: 'procedure',
          speaker: 'clinician',
          evidenceType: 'clinician_observed',
          status: 'performed',
          temporal: 'completed_today',
          certainty: 'certain',
          anatomy: { teeth: [36], surfaces: ['O'] },
          value: { name: 'composite restoration' }
        }]
      };

      const actualFacts: ClinicalFact[] = [{
        id: 'act-wrong-surf',
        type: 'procedure',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'performed',
        temporal: 'completed_today',
        certainty: 'certain',
        extractionMethod: 'model_extracted',
        anatomy: { teeth: [createToothReference(36)], surfaces: ['M'] }, // M vs O
        value: { name: 'composite restoration' },
        evidence: [{ utteranceId: 'u1', rawText: 'Restored 36 O.', source: 'transcript' }],
        validationState: 'valid',
        verificationState: 'unverified',
        verificationMethod: 'none'
      }];

      const res = evaluateCase(caseDef, actualFacts);
      expect(res.errors.some(e => e.errorType === 'wrong_surface')).toBe(true);
      expect(res.metrics.strictTruePositives).toBe(0);
      expect(res.metrics.strictF1).toBe(0);
      expect(res.passed).toBe(false);
    });

    // Test G — Invalid canonical fact emits structural_validation_error
    it('Test G: structurally invalid ClinicalFact emits structural_validation_error', () => {
      const expected: ExpectedClinicalFact = {
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'observed',
        temporal: 'current',
        certainty: 'certain',
        anatomy: { teeth: [36] },
        value: { condition: 'caries' }
      };

      const actual: ClinicalFact = {
        id: 'act-invalid',
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'observed',
        temporal: 'current',
        certainty: 'certain',
        extractionMethod: 'model_extracted',
        anatomy: { teeth: [createToothReference(36)] },
        value: { condition: 'caries' },
        evidence: [],
        validationState: 'invalid', // Explicit domain failure!
        verificationState: 'unverified',
        verificationMethod: 'none'
      };

      const errors = compareFactFields(expected, actual);
      const structErr = errors.find(e => e.errorType === 'structural_validation_error');
      expect(structErr).toBeDefined();
      expect(structErr!.severity).toBe('critical');
    });

    // Test H — Wrong fact type detection via cross-type semantic anchor
    it('Test H: detects wrong_fact_type when semantic anchor exists on same tooth', () => {
      const expected: ExpectedClinicalFact = {
        type: 'symptom',
        speaker: 'patient',
        evidenceType: 'patient_reported',
        status: 'reported',
        temporal: 'current',
        certainty: 'certain',
        anatomy: { teeth: [36] },
        value: { description: 'pain' }
      };

      const actual: ClinicalFact = {
        id: 'act-wrong-type',
        type: 'procedure', // Model classified symptom as procedure!
        speaker: 'patient',
        evidenceType: 'patient_reported',
        status: 'reported',
        temporal: 'current',
        certainty: 'certain',
        extractionMethod: 'model_extracted',
        anatomy: { teeth: [createToothReference(36)] },
        value: { name: 'pain' },
        evidence: [],
        validationState: 'valid',
        verificationState: 'unverified',
        verificationMethod: 'none'
      };

      const comp = compareClinicalFacts([expected], [actual]);
      expect(comp.matchedPairs.length).toBe(1);
      const typeErr = comp.allErrors.find(e => e.errorType === 'wrong_fact_type');
      expect(typeErr).toBeDefined();
      expect(typeErr!.severity).toBe('critical');
    });

    // Test I — Wrong quadrant / arch comparison
    it('Test I: detects wrong_anatomy when quadrant or arch differs', () => {
      const expected: ExpectedClinicalFact = {
        type: 'symptom',
        speaker: 'patient',
        evidenceType: 'patient_reported',
        status: 'reported',
        temporal: 'current',
        certainty: 'certain',
        anatomy: { quadrant: 3, arch: 'mandibular' },
        value: { description: 'pain' }
      };

      const actual: ClinicalFact = {
        id: 'act-wrong-quad',
        type: 'symptom',
        speaker: 'patient',
        evidenceType: 'patient_reported',
        status: 'reported',
        temporal: 'current',
        certainty: 'certain',
        extractionMethod: 'model_extracted',
        anatomy: { teeth: [], quadrant: 1, arch: 'maxillary' }, // Inverted quadrant & arch!
        value: { description: 'pain' },
        evidence: [],
        validationState: 'valid',
        verificationState: 'unverified',
        verificationMethod: 'none'
      };

      const errors = compareFactFields(expected, actual);
      const quadErr = errors.filter(e => e.errorType === 'wrong_anatomy');
      expect(quadErr.length).toBeGreaterThanOrEqual(1);
      expect(quadErr.some(e => e.field === 'anatomy.quadrant')).toBe(true);
      expect(quadErr.some(e => e.field === 'anatomy.arch')).toBe(true);
    });

    // Test J — Candidate construction failure via evaluateCandidateCase
    it('Test J: evaluateCandidateCase catches malformed CandidateClinicalFact construction errors', () => {
      const caseDef: any = {
        id: 'case-test-j',
        datasetVersion: 'v1.1.0',
        transcript: [{ utteranceId: 'u1', speaker: 'clinician', text: 'Tooth 99 has decay.' }],
        expectedFacts: [{
          type: 'tooth_finding',
          speaker: 'clinician',
          evidenceType: 'clinician_observed',
          status: 'observed',
          temporal: 'current',
          certainty: 'certain',
          anatomy: { teeth: [16] },
          value: { condition: 'caries' }
        }]
      };

      const malformedCandidates: CandidateClinicalFact[] = [
        {
          id: 'cand-bad',
          type: 'tooth_finding',
          speaker: 'patient', // Epistemic contradiction: patient + clinician_observed
          evidenceType: 'clinician_observed',
          value: { condition: 'caries' },
          status: 'observed',
          temporal: 'current',
          certainty: 'certain',
          extractionMethod: 'model_extracted',
          anatomy: { teeth: [99] }, // Invalid FDI tooth!
          confidence: -5 // Invalid negative confidence!
        }
      ];

      const res = evaluateCandidateCase(caseDef, malformedCandidates);

      expect(res.passed).toBe(false);
      expect(res.constructionErrors).toBeDefined();
      expect(res.constructionErrors!.length).toBeGreaterThanOrEqual(1);
      expect(res.errors.some(e => e.errorType === 'structural_validation_error')).toBe(true);
    });
  });

  // =========================================================================
  // 4. AGGREGATED BENCHMARK METRICS & REPRODUCIBILITY
  // =========================================================================
  describe('Aggregated Benchmark Metrics & Strict Reporting', () => {
    it('reports strict metrics and proves deterministic reproducibility', () => {
      const run1 = CLINICAL_EVALUATION_CORPUS_V1.slice(0, 3).map(caseDef => {
        const actuals: ClinicalFact[] = caseDef.expectedFacts.map((ef, idx) => ({
          id: `act-${caseDef.id}-${idx}`,
          type: ef.type,
          speaker: ef.speaker,
          evidenceType: ef.evidenceType,
          status: ef.status,
          temporal: ef.temporal,
          certainty: ef.certainty,
          extractionMethod: 'model_extracted',
          anatomy: {
            teeth: (ef.anatomy?.teeth || []).map(t => createToothReference(t)),
            surfaces: ef.anatomy?.surfaces,
            quadrant: ef.anatomy?.quadrant,
            arch: ef.anatomy?.arch
          },
          value: ef.value as any,
          evidence: caseDef.transcript.map(u => ({
            utteranceId: u.utteranceId || 'u1',
            rawText: u.text,
            speaker: u.speaker as any,
            source: 'transcript' as const
          })),
          validationState: 'valid',
          verificationState: 'unverified',
          verificationMethod: 'none'
        } as ClinicalFact));
        return evaluateCase(caseDef, actuals);
      });

      const metrics1 = aggregateBenchmarkMetrics(CLINICAL_EVALUATION_CORPUS_VERSION, run1);
      const metrics2 = aggregateBenchmarkMetrics(CLINICAL_EVALUATION_CORPUS_VERSION, run1);

      expect(metrics1).toEqual(metrics2);
      expect(metrics1.strictPrecision).toBe(1.0);
      expect(metrics1.strictRecall).toBe(1.0);
      expect(metrics1.strictF1).toBe(1.0);

      const reportStr = formatEvaluationReport(metrics1, run1);
      expect(reportStr).toContain('STRICT ACCURACY METRICS (0 Errors Required)');
      expect(reportStr).toContain('Strict Precision:      100.0%');
    });
  });
});
