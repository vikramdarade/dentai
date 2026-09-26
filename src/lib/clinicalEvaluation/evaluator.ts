/**
 * Deterministic Fact Comparison & Clinical Evaluation Engine (Phase 4 Remediated)
 *
 * Implements:
 * 1. Bipartite semantic fact matching with cross-type anchor detection (wrong_fact_type)
 * 2. Bidirectional property comparison (detects extra unsupported clinical details)
 * 3. Transcript evidence cross-referencing (utteranceId, rawText grounding, speaker match)
 * 4. Structural validation state inspection (structural_validation_error)
 * 5. Full anatomical comparison (teeth, surfaces, quadrant, arch, softTissueSite)
 * 6. Strict Metrics (strictPrecision, strictRecall, strictF1 requiring zero errors)
 * 7. CandidateClinicalFact trust-boundary evaluation runner (evaluateCandidateCase)
 */

import type {
  ClinicalFact,
  CandidateClinicalFact,
  DentalSurface,
  FactSpeaker,
  FactEvidenceType,
  FactStatus,
  FactTemporalContext,
  FactCertainty
} from '../../types/clinicalFact';
import { createCanonicalClinicalFact, isFactConstructionFailure } from '../clinicalFactMigration';
import type {
  ExpectedClinicalFact,
  ClinicalEvaluationCase,
  CaseEvaluationResult,
  CaseMetrics,
  FactMatchPair,
  FactComparisonError,
  ClinicalErrorType,
  ClinicalErrorSeverity,
  BenchmarkMetrics,
  BenchmarkEvaluationReport,
  DimensionAccuracy,
  EvaluationTranscript
} from './types';

// ============================================================================
// 1. DETERMINISTIC FIELD-LEVEL COMPARATORS & SEVERITY RULES
// ============================================================================

/**
 * Normalizes string representation for clinical value comparison.
 */
function normalizeString(val: unknown): string {
  if (typeof val === 'string') {
    return val.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  }
  return '';
}

/**
 * Computes semantic similarity between an expected fact and an actual fact
 * for bipartite matching candidate ranking.
 */
function computeSemanticAffinity(expected: ExpectedClinicalFact, actual: ClinicalFact): number {
  let score = 0;

  // 1. Fact Type agreement
  if (expected.type === actual.type) {
    score += 50;
  } else {
    // Cross-domain anchor: if they anchor to the exact same tooth or share significant semantic context
    const expTeeth = expected.anatomy?.teeth || [];
    const actTeeth = actual.anatomy?.teeth?.map(t => typeof t === 'number' ? t : t.tooth) || [];
    const sameTeeth = expTeeth.length > 0 && actTeeth.length > 0 && expTeeth.some(t => actTeeth.includes(t));

    if (sameTeeth) {
      score += 25; // Candidate for cross-type match (e.g. symptom vs procedure on same tooth)
    } else {
      return 0; // Completely unrelated
    }
  }

  // 2. Anatomical tooth agreement
  const expTeeth = expected.anatomy?.teeth || [];
  const actTeeth = actual.anatomy?.teeth?.map(t => typeof t === 'number' ? t : t.tooth) || [];
  if (expTeeth.length > 0 && actTeeth.length > 0) {
    const hasOverlap = expTeeth.some(t => actTeeth.includes(t));
    if (hasOverlap) score += 30;
    else score -= 20; // Explicitly different teeth
  } else if (expTeeth.length === 0 && actTeeth.length === 0) {
    score += 15;
  }

  // 3. Status agreement
  if (expected.status === actual.status) score += 10;

  // 4. Temporal agreement
  if (expected.temporal === actual.temporal) score += 10;

  return score;
}

/**
 * Recursively compares actual value object against expected value object bidirectionally.
 */
function compareValueObjects(
  expObj: Record<string, unknown>,
  actObj: Record<string, unknown>,
  prefix = 'value'
): FactComparisonError[] {
  const errors: FactComparisonError[] = [];

  // 1. Expected -> Actual (missing or mismatched expected properties)
  for (const [key, expVal] of Object.entries(expObj)) {
    const actVal = actObj[key];
    const fieldPath = `${prefix}.${key}`;

    if (expVal !== undefined && actVal === undefined) {
      errors.push({
        errorType: 'unsupported_detail',
        severity: 'high',
        message: `Missing expected detail in value payload: field '${fieldPath}'.`,
        expected: expVal,
        actual: undefined,
        field: fieldPath
      });
    } else if (expVal !== undefined && actVal !== undefined) {
      if (typeof expVal === 'string' && typeof actVal === 'string') {
        if (normalizeString(expVal) !== normalizeString(actVal)) {
          errors.push({
            errorType: 'wrong_value',
            severity: 'high',
            message: `Value mismatch in field '${fieldPath}': expected '${expVal}', received '${actVal}'.`,
            expected: expVal,
            actual: actVal,
            field: fieldPath
          });
        }
      } else if (Array.isArray(expVal) && Array.isArray(actVal)) {
        const normExp = expVal.map(v => typeof v === 'string' ? normalizeString(v) : JSON.stringify(v)).sort();
        const normAct = actVal.map(v => typeof v === 'string' ? normalizeString(v) : JSON.stringify(v)).sort();
        if (normExp.length !== normAct.length || !normExp.every((v, i) => v === normAct[i])) {
          errors.push({
            errorType: 'wrong_value',
            severity: 'high',
            message: `Array value mismatch in field '${fieldPath}'.`,
            expected: expVal,
            actual: actVal,
            field: fieldPath
          });
        }
      } else if (typeof expVal === 'object' && expVal !== null && typeof actVal === 'object' && actVal !== null) {
        errors.push(...compareValueObjects(expVal as Record<string, unknown>, actVal as Record<string, unknown>, fieldPath));
      } else if (expVal !== actVal) {
        errors.push({
          errorType: 'wrong_value',
          severity: 'moderate',
          message: `Value mismatch in field '${fieldPath}': expected '${String(expVal)}', received '${String(actVal)}'.`,
          expected: expVal,
          actual: actVal,
          field: fieldPath
        });
      }
    }
  }

  // 2. Actual -> Expected (REVERSE LOOP: detects hallucinated extra clinical details)
  for (const [key, actVal] of Object.entries(actObj)) {
    const expVal = expObj[key];
    const fieldPath = `${prefix}.${key}`;

    if (actVal !== undefined && actVal !== null && actVal !== false && expVal === undefined) {
      // Meaningful extra clinical assertions that have no basis in expected facts
      errors.push({
        errorType: 'unsupported_detail',
        severity: 'high',
        message: `Actual fact contains unsupported extra clinical detail '${fieldPath}': '${JSON.stringify(actVal)}'.`,
        expected: undefined,
        actual: actVal,
        field: fieldPath
      });
    }
  }

  return errors;
}

/**
 * Evaluates semantic field-level differences between an expected fact and an actual fact.
 * Cross-references against case transcript where available.
 */
export function compareFactFields(
  expected: ExpectedClinicalFact,
  actual: ClinicalFact,
  transcript?: EvaluationTranscript
): FactComparisonError[] {
  const errors: FactComparisonError[] = [];

  // --- 0. Structural Validation State ---
  if (actual.validationState === 'invalid') {
    errors.push({
      errorType: 'structural_validation_error',
      severity: 'critical',
      message: `Actual ClinicalFact has validationState: 'invalid' and failed domain invariants.`,
      expected: 'valid',
      actual: actual.validationState,
      field: 'validationState'
    });
  }

  // --- A. Fact Type ---
  if (expected.type !== actual.type) {
    const isCriticalCrossDomain =
      (expected.type === 'procedure' && actual.type !== 'procedure') ||
      (expected.type === 'allergy' && actual.type !== 'allergy') ||
      (expected.type === 'medication' && actual.type !== 'medication') ||
      (expected.type === 'symptom' && actual.type === 'procedure');

    errors.push({
      errorType: 'wrong_fact_type',
      severity: isCriticalCrossDomain ? 'critical' : 'high',
      message: `Expected fact type '${expected.type}', received '${actual.type}'.`,
      expected: expected.type,
      actual: actual.type,
      field: 'type'
    });
  }

  // --- B. Speaker Attribution ---
  if (expected.speaker !== actual.speaker) {
    const isPatientClinicianInversion =
      (expected.speaker === 'patient' && actual.speaker === 'clinician') ||
      (expected.speaker === 'clinician' && actual.speaker === 'patient');

    errors.push({
      errorType: 'wrong_speaker',
      severity: isPatientClinicianInversion ? 'critical' : 'moderate',
      message: `Speaker mismatch: expected '${expected.speaker}', received '${actual.speaker}'.`,
      expected: expected.speaker,
      actual: actual.speaker,
      field: 'speaker'
    });
  }

  // --- C. Evidence Type (Epistemic Role) ---
  if (expected.evidenceType !== actual.evidenceType) {
    const isEpistemicInversion =
      (expected.evidenceType === 'patient_reported' && actual.evidenceType === 'clinician_observed') ||
      (expected.evidenceType === 'clinician_observed' && actual.evidenceType === 'patient_reported');

    errors.push({
      errorType: 'wrong_evidence_type',
      severity: isEpistemicInversion ? 'critical' : 'high',
      message: `Evidence type mismatch: expected '${expected.evidenceType}', received '${actual.evidenceType}'.`,
      expected: expected.evidenceType,
      actual: actual.evidenceType,
      field: 'evidenceType'
    });
  }

  // --- D. Status & Negation ---
  if (expected.status !== actual.status) {
    const isNegationInversion =
      (expected.status === 'negated' && actual.status !== 'negated') ||
      (expected.status !== 'negated' && actual.status === 'negated');

    const isPlannedPerformedInversion =
      (expected.status === 'planned' && actual.status === 'performed') ||
      (expected.status === 'performed' && actual.status === 'planned');

    if (isNegationInversion) {
      errors.push({
        errorType: 'wrong_negation',
        severity: 'critical',
        message: `Negation failure: expected status '${expected.status}', received '${actual.status}'.`,
        expected: expected.status,
        actual: actual.status,
        field: 'status'
      });
    } else if (isPlannedPerformedInversion) {
      errors.push({
        errorType: 'wrong_status',
        severity: 'critical',
        message: `Dangerous clinical status inversion (planned vs performed): expected '${expected.status}', received '${actual.status}'.`,
        expected: expected.status,
        actual: actual.status,
        field: 'status'
      });
    } else {
      errors.push({
        errorType: 'wrong_status',
        severity: 'high',
        message: `Status mismatch: expected '${expected.status}', received '${actual.status}'.`,
        expected: expected.status,
        actual: actual.status,
        field: 'status'
      });
    }
  }

  // --- E. Temporal Context ---
  if (expected.temporal !== actual.temporal) {
    const isCompletedNextAppointmentInversion =
      (expected.temporal === 'completed_today' && actual.temporal === 'next_appointment') ||
      (expected.temporal === 'next_appointment' && actual.temporal === 'completed_today');

    errors.push({
      errorType: 'wrong_temporal_context',
      severity: isCompletedNextAppointmentInversion ? 'critical' : 'high',
      message: `Temporal context mismatch: expected '${expected.temporal}', received '${actual.temporal}'.`,
      expected: expected.temporal,
      actual: actual.temporal,
      field: 'temporal'
    });
  }

  // --- F. Epistemic Certainty ---
  if (expected.certainty !== actual.certainty) {
    errors.push({
      errorType: 'wrong_certainty',
      severity: 'moderate',
      message: `Certainty mismatch: expected '${expected.certainty}', received '${actual.certainty}'.`,
      expected: expected.certainty,
      actual: actual.certainty,
      field: 'certainty'
    });
  }

  // --- G. Anatomy (Teeth, Surfaces, Quadrant, Arch, Soft Tissue Site) ---
  const expTeeth = expected.anatomy?.teeth || [];
  const actTeeth = actual.anatomy?.teeth?.map(t => typeof t === 'number' ? t : t.tooth) || [];

  if (expTeeth.length > 0 || actTeeth.length > 0) {
    const sortedExp = [...expTeeth].sort((a, b) => a - b);
    const sortedAct = [...actTeeth].sort((a, b) => a - b);
    const teethMatch = sortedExp.length === sortedAct.length && sortedExp.every((t, i) => t === sortedAct[i]);

    if (!teethMatch) {
      errors.push({
        errorType: 'wrong_anatomy',
        severity: 'critical',
        message: `Tooth anatomy mismatch: expected [${sortedExp.join(', ')}], received [${sortedAct.join(', ')}].`,
        expected: sortedExp,
        actual: sortedAct,
        field: 'anatomy.teeth'
      });
    }
  }

  // Surfaces check
  const expSurfaces = expected.anatomy?.surfaces || [];
  const actSurfaces = actual.anatomy?.surfaces || [];
  if (expSurfaces.length > 0 || actSurfaces.length > 0) {
    const normExp = [...expSurfaces].map(s => s.toUpperCase()).sort();
    const normAct = [...actSurfaces].map(s => s.toUpperCase()).sort();
    const surfacesMatch = normExp.length === normAct.length && normExp.every((s, i) => s === normAct[i]);

    if (!surfacesMatch) {
      errors.push({
        errorType: 'wrong_surface',
        severity: 'moderate',
        message: `Tooth surface mismatch: expected [${normExp.join(', ')}], received [${normAct.join(', ')}].`,
        expected: normExp,
        actual: normAct,
        field: 'anatomy.surfaces'
      });
    }
  }

  // Quadrant check
  if (expected.anatomy?.quadrant !== undefined && actual.anatomy?.quadrant !== undefined) {
    if (expected.anatomy.quadrant !== actual.anatomy.quadrant) {
      errors.push({
        errorType: 'wrong_anatomy',
        severity: 'critical',
        message: `Anatomical quadrant mismatch: expected ${expected.anatomy.quadrant}, received ${actual.anatomy.quadrant}.`,
        expected: expected.anatomy.quadrant,
        actual: actual.anatomy.quadrant,
        field: 'anatomy.quadrant'
      });
    }
  }

  // Arch check
  if (expected.anatomy?.arch !== undefined && actual.anatomy?.arch !== undefined) {
    if (expected.anatomy.arch !== actual.anatomy.arch) {
      errors.push({
        errorType: 'wrong_anatomy',
        severity: 'critical',
        message: `Anatomical arch mismatch: expected ${expected.anatomy.arch}, received ${actual.anatomy.arch}.`,
        expected: expected.anatomy.arch,
        actual: actual.anatomy.arch,
        field: 'anatomy.arch'
      });
    }
  }

  // Soft tissue site check
  if (expected.anatomy?.softTissueSite !== undefined && actual.anatomy?.softTissueSite !== undefined) {
    if (normalizeString(expected.anatomy.softTissueSite) !== normalizeString(actual.anatomy.softTissueSite)) {
      errors.push({
        errorType: 'wrong_anatomy',
        severity: 'high',
        message: `Soft tissue site mismatch: expected '${expected.anatomy.softTissueSite}', received '${actual.anatomy.softTissueSite}'.`,
        expected: expected.anatomy.softTissueSite,
        actual: actual.anatomy.softTissueSite,
        field: 'anatomy.softTissueSite'
      });
    }
  }

  // --- H. Value Payload Semantics (Bidirectional Comparison) ---
  if (typeof expected.value === 'string' && typeof actual.value === 'string') {
    if (normalizeString(expected.value) !== normalizeString(actual.value)) {
      errors.push({
        errorType: 'wrong_value',
        severity: 'high',
        message: `Value mismatch: expected '${expected.value}', received '${actual.value}'.`,
        expected: expected.value,
        actual: actual.value,
        field: 'value'
      });
    }
  } else if (typeof expected.value === 'object' && expected.value !== null && typeof actual.value === 'object' && actual.value !== null) {
    errors.push(...compareValueObjects(expected.value as Record<string, unknown>, actual.value as Record<string, unknown>));
  }

  // --- I. Evidence Grounding & Provenance Safety Checks ---
  const expKeywords = expected.expectedEvidenceKeywords || [];
  const actualEvidence = actual.evidence || [];

  if (expKeywords.length > 0 && actualEvidence.length === 0) {
    errors.push({
      errorType: 'evidence_mismatch',
      severity: 'high',
      message: `Fact requires supporting evidence from transcript, but actual evidence is empty.`,
      expected: expKeywords,
      actual: [],
      field: 'evidence'
    });
  }

  for (const span of actualEvidence) {
    // 1. Timestamp validity
    if (span.startMs !== undefined && span.endMs !== undefined) {
      if (span.startMs < 0 || span.endMs < 0 || span.startMs > span.endMs) {
        errors.push({
          errorType: 'provenance_error',
          severity: 'critical',
          message: `Invalid timestamp bounds detected in evidence span (${span.startMs}ms - ${span.endMs}ms).`,
          expected: '0 <= startMs <= endMs',
          actual: { startMs: span.startMs, endMs: span.endMs },
          field: 'evidence.timestamps'
        });
      }
    }

    // 2. Synthetic data check
    if (span.rawText && span.rawText.includes('[synthetic]')) {
      errors.push({
        errorType: 'provenance_error',
        severity: 'critical',
        message: `Synthetic timestamp marker detected in evidence: '${span.rawText}'.`,
        field: 'evidence.synthetic'
      });
    }

    // 3. Transcript cross-referencing
    if (transcript && transcript.length > 0) {
      const matchingUtterance = transcript.find(u => u.utteranceId === span.utteranceId);
      if (!matchingUtterance) {
        errors.push({
          errorType: 'evidence_mismatch',
          severity: 'critical',
          message: `Referenced evidence utteranceId '${span.utteranceId}' does not exist in case transcript.`,
          expected: transcript.map(u => u.utteranceId),
          actual: span.utteranceId,
          field: 'evidence.utteranceId'
        });
      } else {
        // Verify rawText exists in the utterance
        const normUtterance = normalizeString(matchingUtterance.text);
        const normRaw = normalizeString(span.rawText);
        if (normRaw && !normUtterance.includes(normRaw)) {
          errors.push({
            errorType: 'evidence_mismatch',
            severity: 'critical',
            message: `Evidence rawText '${span.rawText}' does not appear in referenced utterance text.`,
            expected: matchingUtterance.text,
            actual: span.rawText,
            field: 'evidence.rawText'
          });
        }

        // Verify speaker consistency if both provide speaker
        if (span.speaker && matchingUtterance.speaker) {
          const normSpanSpk = normalizeString(span.speaker);
          const normUttSpk = normalizeString(matchingUtterance.speaker);
          if (normSpanSpk !== normUttSpk && !(normSpanSpk.includes('clinician') && normUttSpk.includes('dentist'))) {
            errors.push({
              errorType: 'wrong_speaker',
              severity: 'high',
              message: `Evidence speaker '${span.speaker}' does not match utterance speaker '${matchingUtterance.speaker}'.`,
              expected: matchingUtterance.speaker,
              actual: span.speaker,
              field: 'evidence.speaker'
            });
          }
        }
      }
    }
  }

  return errors;
}

// ============================================================================
// 2. CASE EVALUATION (BIPARTITE FACT MATCHING)
// ============================================================================

/**
 * Compares an array of expected facts against an array of actual extracted facts.
 */
export function compareClinicalFacts(
  expectedFacts: ReadonlyArray<ExpectedClinicalFact>,
  actualFacts: ReadonlyArray<ClinicalFact>,
  transcript?: EvaluationTranscript
): {
  matchedPairs: FactMatchPair[];
  missedFacts: Array<{ expectedIndex: number; fact: ExpectedClinicalFact }>;
  hallucinatedFacts: Array<{ actualIndex: number; fact: ClinicalFact }>;
  allErrors: FactComparisonError[];
} {
  const matchedPairs: FactMatchPair[] = [];
  const assignedExpected = new Set<number>();
  const assignedActual = new Set<number>();
  const allErrors: FactComparisonError[] = [];

  // 1. Build affinity matrix
  const candidates: Array<{ expIdx: number; actIdx: number; affinity: number }> = [];

  for (let e = 0; e < expectedFacts.length; e++) {
    for (let a = 0; a < actualFacts.length; a++) {
      const affinity = computeSemanticAffinity(expectedFacts[e], actualFacts[a]);
      if (affinity > 0) {
        candidates.push({ expIdx: e, actIdx: a, affinity });
      }
    }
  }

  // Sort descending by affinity
  candidates.sort((a, b) => b.affinity - a.affinity);

  // Greedy bipartite matching
  for (const cand of candidates) {
    if (!assignedExpected.has(cand.expIdx) && !assignedActual.has(cand.actIdx)) {
      assignedExpected.add(cand.expIdx);
      assignedActual.add(cand.actIdx);

      const exp = expectedFacts[cand.expIdx];
      const act = actualFacts[cand.actIdx];
      const errors = compareFactFields(exp, act, transcript);

      matchedPairs.push({
        expectedIndex: cand.expIdx,
        actualIndex: cand.actIdx,
        expected: exp,
        actual: act,
        isExactMatch: errors.length === 0,
        errors
      });

      allErrors.push(...errors);
    }
  }

  // 2. Collect missed facts (False Negatives)
  const missedFacts: Array<{ expectedIndex: number; fact: ExpectedClinicalFact }> = [];
  for (let e = 0; e < expectedFacts.length; e++) {
    if (!assignedExpected.has(e)) {
      missedFacts.push({ expectedIndex: e, fact: expectedFacts[e] });
      allErrors.push({
        errorType: 'missed_fact',
        severity: 'high',
        message: `Expected fact of type '${expectedFacts[e].type}' was not extracted.`,
        expected: expectedFacts[e],
        field: 'fact'
      });
    }
  }

  // 3. Collect hallucinated facts (False Positives)
  const hallucinatedFacts: Array<{ actualIndex: number; fact: ClinicalFact }> = [];
  for (let a = 0; a < actualFacts.length; a++) {
    if (!assignedActual.has(a)) {
      hallucinatedFacts.push({ actualIndex: a, fact: actualFacts[a] });
      allErrors.push({
        errorType: 'hallucinated_fact',
        severity: 'critical',
        message: `Extracted fact of type '${actualFacts[a].type}' has no basis in gold expectations.`,
        actual: actualFacts[a],
        field: 'fact'
      });
    }
  }

  return {
    matchedPairs,
    missedFacts,
    hallucinatedFacts,
    allErrors
  };
}

/**
 * Evaluates a single clinical evaluation case with strict and safety metrics.
 */
export function evaluateCase(
  caseDef: ClinicalEvaluationCase,
  actualFacts: ReadonlyArray<ClinicalFact>
): CaseEvaluationResult {
  const comparison = compareClinicalFacts(caseDef.expectedFacts, actualFacts, caseDef.transcript);

  // Strict true positives require ZERO errors of any severity
  const strictTruePositives = comparison.matchedPairs.filter(p => p.errors.length === 0).length;

  // Clinical safety true positives allow minor low-severity variances but forbid critical/high
  const safetyTruePositives = comparison.matchedPairs.filter(
    p => !p.errors.some(e => e.severity === 'critical' || e.severity === 'high')
  ).length;

  const totalExpected = caseDef.expectedFacts.length;
  const totalActual = actualFacts.length;

  // Strict Metrics
  const strictPrecision = totalActual > 0 ? strictTruePositives / totalActual : (totalExpected === 0 ? 1 : 0);
  const strictRecall = totalExpected > 0 ? strictTruePositives / totalExpected : 1;
  const strictF1 = (strictPrecision + strictRecall) > 0 ? (2 * strictPrecision * strictRecall) / (strictPrecision + strictRecall) : 0;

  // Safety Metrics
  const precision = totalActual > 0 ? safetyTruePositives / totalActual : (totalExpected === 0 ? 1 : 0);
  const recall = totalExpected > 0 ? safetyTruePositives / totalExpected : 1;
  const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const passed = comparison.allErrors.length === 0 &&
                 strictTruePositives === totalExpected &&
                 totalActual === totalExpected;

  return {
    caseId: caseDef.id,
    datasetVersion: caseDef.datasetVersion,
    passed,
    matchedPairs: comparison.matchedPairs,
    missedFacts: comparison.missedFacts,
    hallucinatedFacts: comparison.hallucinatedFacts,
    errors: comparison.allErrors,
    metrics: {
      totalExpected,
      totalActual,
      truePositives: safetyTruePositives,
      falsePositives: totalActual - safetyTruePositives,
      falseNegatives: totalExpected - safetyTruePositives,
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      f1: Number(f1.toFixed(4)),
      strictTruePositives,
      strictPrecision: Number(strictPrecision.toFixed(4)),
      strictRecall: Number(strictRecall.toFixed(4)),
      strictF1: Number(strictF1.toFixed(4))
    }
  };
}

/**
 * Evaluates candidate clinical facts by running them through the canonical
 * construction trust boundary (createCanonicalClinicalFact) before evaluation.
 */
export function evaluateCandidateCase(
  caseDef: ClinicalEvaluationCase,
  candidates: ReadonlyArray<CandidateClinicalFact>
): CaseEvaluationResult {
  const canonicalFacts: ClinicalFact[] = [];
  const constructionErrors: string[] = [];

  for (const candidate of candidates) {
    const result = createCanonicalClinicalFact(candidate);
    if (isFactConstructionFailure(result)) {
      constructionErrors.push(...result.errors);
      // Construct fallback invalid fact to preserve visibility of construction failures
      canonicalFacts.push({
        id: candidate.id || `candidate-fail-${Date.now()}`,
        type: candidate.type,
        speaker: candidate.speaker,
        evidenceType: candidate.evidenceType,
        value: candidate.value as any,
        status: candidate.status || 'observed',
        temporal: candidate.temporal || 'current',
        certainty: candidate.certainty || 'certain',
        extractionMethod: candidate.extractionMethod || 'model_extracted',
        anatomy: candidate.anatomy as any,
        evidence: candidate.evidence as any || [],
        validationState: 'invalid',
        verificationState: 'unverified',
        verificationMethod: 'none',
        validationWarnings: [...result.errors, ...result.warnings]
      } as unknown as ClinicalFact);
    } else {
      canonicalFacts.push(result.fact);
    }
  }

  const evalResult = evaluateCase(caseDef, canonicalFacts);

  // If there were construction errors, append them to errors list
  const additionalErrors: FactComparisonError[] = constructionErrors.map(err => ({
    errorType: 'structural_validation_error',
    severity: 'critical',
    message: `Candidate construction failed trust boundary validation: ${err}`,
    field: 'candidate'
  }));

  const allErrors = [...evalResult.errors, ...additionalErrors];

  return {
    ...evalResult,
    passed: evalResult.passed && constructionErrors.length === 0,
    errors: allErrors,
    constructionErrors
  };
}

// ============================================================================
// 3. BENCHMARK SUITE AGGREGATOR & REPORTING
// ============================================================================

function computeDimensionAccuracy(
  pairs: FactMatchPair[],
  errorType: ClinicalErrorType
): DimensionAccuracy {
  const totalTested = pairs.length;
  if (totalTested === 0) return { totalTested: 0, correctCount: 0, accuracy: 1 };
  const errorsCount = pairs.filter(p => p.errors.some(e => e.errorType === errorType)).length;
  const correctCount = totalTested - errorsCount;
  return {
    totalTested,
    correctCount,
    accuracy: Number((correctCount / totalTested).toFixed(4))
  };
}

/**
 * Aggregates results across a full benchmark run.
 */
export function aggregateBenchmarkMetrics(
  datasetVersion: string,
  results: ReadonlyArray<CaseEvaluationResult>
): BenchmarkMetrics {
  let totalExpectedFacts = 0;
  let totalExtractedFacts = 0;
  let totalTruePositives = 0;
  let totalFalsePositives = 0;
  let totalFalseNegatives = 0;
  let totalStrictTruePositives = 0;

  let criticalErrorCount = 0;
  let highSeverityErrorCount = 0;
  let moderateSeverityErrorCount = 0;
  let lowSeverityErrorCount = 0;

  let hallucinationCount = 0;
  let missedFactCount = 0;
  let negationFailures = 0;
  let temporalFailures = 0;
  let anatomicalFailures = 0;
  let provenanceFailures = 0;
  let evidenceMismatchCount = 0;
  let unsupportedDetailsCount = 0;
  let structuralValidationErrorsCount = 0;
  let wrongFactTypeCount = 0;
  let wrongAnatomyCount = 0;
  let wrongSurfaceCount = 0;
  let wrongSpeakerCount = 0;
  let wrongNegationCount = 0;
  let wrongTemporalCount = 0;

  const allPairs: FactMatchPair[] = [];

  for (const res of results) {
    totalExpectedFacts += res.metrics.totalExpected;
    totalExtractedFacts += res.metrics.totalActual;
    totalTruePositives += res.metrics.truePositives;
    totalFalsePositives += res.metrics.falsePositives;
    totalFalseNegatives += res.metrics.falseNegatives;
    totalStrictTruePositives += res.metrics.strictTruePositives;

    allPairs.push(...res.matchedPairs);

    for (const err of res.errors) {
      if (err.severity === 'critical') criticalErrorCount++;
      else if (err.severity === 'high') highSeverityErrorCount++;
      else if (err.severity === 'moderate') moderateSeverityErrorCount++;
      else if (err.severity === 'low') lowSeverityErrorCount++;

      if (err.errorType === 'hallucinated_fact') hallucinationCount++;
      if (err.errorType === 'missed_fact') missedFactCount++;
      if (err.errorType === 'wrong_negation') { negationFailures++; wrongNegationCount++; }
      if (err.errorType === 'wrong_temporal_context') { temporalFailures++; wrongTemporalCount++; }
      if (err.errorType === 'wrong_anatomy') { anatomicalFailures++; wrongAnatomyCount++; }
      if (err.errorType === 'wrong_surface') { anatomicalFailures++; wrongSurfaceCount++; }
      if (err.errorType === 'wrong_speaker') wrongSpeakerCount++;
      if (err.errorType === 'provenance_error') provenanceFailures++;
      if (err.errorType === 'evidence_mismatch') evidenceMismatchCount++;
      if (err.errorType === 'unsupported_detail') unsupportedDetailsCount++;
      if (err.errorType === 'structural_validation_error') structuralValidationErrorsCount++;
      if (err.errorType === 'wrong_fact_type') wrongFactTypeCount++;
    }
  }

  const factPrecision = totalExtractedFacts > 0
    ? Number((totalTruePositives / totalExtractedFacts).toFixed(4))
    : (totalExpectedFacts === 0 ? 1 : 0);

  const factRecall = totalExpectedFacts > 0
    ? Number((totalTruePositives / totalExpectedFacts).toFixed(4))
    : 1;

  const factF1 = (factPrecision + factRecall) > 0
    ? Number(((2 * factPrecision * factRecall) / (factPrecision + factRecall)).toFixed(4))
    : 0;

  const strictPrecision = totalExtractedFacts > 0
    ? Number((totalStrictTruePositives / totalExtractedFacts).toFixed(4))
    : (totalExpectedFacts === 0 ? 1 : 0);

  const strictRecall = totalExpectedFacts > 0
    ? Number((totalStrictTruePositives / totalExpectedFacts).toFixed(4))
    : 1;

  const strictF1 = (strictPrecision + strictRecall) > 0
    ? Number(((2 * strictPrecision * strictRecall) / (strictPrecision + strictRecall)).toFixed(4))
    : 0;

  return {
    datasetVersion,
    totalCases: results.length,
    totalExpectedFacts,
    totalExtractedFacts,
    truePositives: totalTruePositives,
    falsePositives: totalFalsePositives,
    falseNegatives: totalFalseNegatives,
    factPrecision,
    factRecall,
    factF1,
    strictTruePositives: totalStrictTruePositives,
    strictPrecision,
    strictRecall,
    strictF1,
    speakerAccuracy: computeDimensionAccuracy(allPairs, 'wrong_speaker'),
    evidenceTypeAccuracy: computeDimensionAccuracy(allPairs, 'wrong_evidence_type'),
    statusAccuracy: computeDimensionAccuracy(allPairs, 'wrong_status'),
    temporalAccuracy: computeDimensionAccuracy(allPairs, 'wrong_temporal_context'),
    anatomyAccuracy: computeDimensionAccuracy(allPairs, 'wrong_anatomy'),
    certaintyAccuracy: computeDimensionAccuracy(allPairs, 'wrong_certainty'),
    typeAccuracy: computeDimensionAccuracy(allPairs, 'wrong_fact_type'),
    valueAccuracy: computeDimensionAccuracy(allPairs, 'wrong_value'),
    criticalErrorCount,
    highSeverityErrorCount,
    moderateSeverityErrorCount,
    lowSeverityErrorCount,
    hallucinationCount,
    missedFactCount,
    falsePositiveAssertions: totalFalsePositives,
    falseNegativeAssertions: totalFalseNegatives,
    negationFailures,
    temporalFailures,
    anatomicalFailures,
    provenanceFailures,
    evidenceMismatchCount,
    unsupportedDetailsCount,
    structuralValidationErrorsCount,
    wrongFactTypeCount
  };
}

/**
 * Formats a clean ASCII summary report for CI / console outputs.
 */
export function formatEvaluationReport(
  report: BenchmarkMetrics,
  caseResults?: ReadonlyArray<CaseEvaluationResult>
): string {
  const lines: string[] = [
    '======================================================================',
    ` DentAI Clinical Extraction Evaluation Benchmark Report`,
    ` Dataset Version: ${report.datasetVersion} | Total Cases: ${report.totalCases}`,
    '======================================================================',
    '',
    ' [STRICT ACCURACY METRICS (0 Errors Required)]',
    `   Strict Precision:      ${(report.strictPrecision * 100).toFixed(1)}%`,
    `   Strict Recall:         ${(report.strictRecall * 100).toFixed(1)}%`,
    `   Strict F1 Score:       ${(report.strictF1 * 100).toFixed(1)}%`,
    '',
    ' [CLINICAL SAFETY METRICS (Critical/High Guardrails)]',
    `   Safety Precision:      ${(report.factPrecision * 100).toFixed(1)}%`,
    `   Safety Recall:         ${(report.factRecall * 100).toFixed(1)}%`,
    `   Safety F1 Score:       ${(report.factF1 * 100).toFixed(1)}%`,
    '',
    ' [DIMENSION ACCURACY]',
    `   Speaker Accuracy:      ${(report.speakerAccuracy.accuracy * 100).toFixed(1)}% (${report.speakerAccuracy.correctCount}/${report.speakerAccuracy.totalTested})`,
    `   Evidence Type:         ${(report.evidenceTypeAccuracy.accuracy * 100).toFixed(1)}% (${report.evidenceTypeAccuracy.correctCount}/${report.evidenceTypeAccuracy.totalTested})`,
    `   Status Accuracy:       ${(report.statusAccuracy.accuracy * 100).toFixed(1)}% (${report.statusAccuracy.correctCount}/${report.statusAccuracy.totalTested})`,
    `   Temporal Accuracy:     ${(report.temporalAccuracy.accuracy * 100).toFixed(1)}% (${report.temporalAccuracy.correctCount}/${report.temporalAccuracy.totalTested})`,
    `   Anatomical Accuracy:   ${(report.anatomyAccuracy.accuracy * 100).toFixed(1)}% (${report.anatomyAccuracy.correctCount}/${report.anatomyAccuracy.totalTested})`,
    `   Certainty Accuracy:    ${(report.certaintyAccuracy.accuracy * 100).toFixed(1)}% (${report.certaintyAccuracy.correctCount}/${report.certaintyAccuracy.totalTested})`,
    '',
    ' [CLINICAL SAFETY COUNTERS]',
    `   Critical Errors:       ${report.criticalErrorCount}`,
    `   High Severity Errors:  ${report.highSeverityErrorCount}`,
    `   Moderate Errors:       ${report.moderateSeverityErrorCount}`,
    `   Low Severity Errors:   ${report.lowSeverityErrorCount}`,
    '',
    ' [SAFETY INCIDENTS BREAKDOWN]',
    `   Hallucinated Facts:    ${report.hallucinationCount}`,
    `   Missed Facts:          ${report.missedFactCount}`,
    `   Negation Failures:     ${report.negationFailures}`,
    `   Temporal Inversions:   ${report.temporalFailures}`,
    `   Anatomical Failures:   ${report.anatomicalFailures}`,
    `   Evidence Mismatches:   ${report.evidenceMismatchCount}`,
    `   Unsupported Details:   ${report.unsupportedDetailsCount}`,
    `   Structural Errors:     ${report.structuralValidationErrorsCount}`,
    `   Wrong Fact Types:      ${report.wrongFactTypeCount}`,
    `   Provenance Violations: ${report.provenanceFailures}`,
    '======================================================================'
  ];

  if (caseResults) {
    const failedCases = caseResults.filter(c => !c.passed);
    if (failedCases.length > 0) {
      lines.push('', ' [CASE FAILURE DETAILS]');
      for (const fc of failedCases) {
        lines.push(`   Case: ${fc.caseId}`);
        for (const err of fc.errors) {
          lines.push(`     - [${err.severity.toUpperCase()}] ${err.errorType}: ${err.message}`);
        }
      }
      lines.push('======================================================================');
    }
  }

  return lines.join('\n');
}
