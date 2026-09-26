/**
 * Clinical Evaluation Harness Types (Phase 4 Remediated Architecture)
 *
 * Implements:
 * 1. Discriminated ExpectedClinicalFact aligned with Phase 3 FactValueTypeMap
 * 2. Case and transcript definitions
 * 3. 16-point ClinicalErrorType and 4-tier ClinicalErrorSeverity
 * 4. Strict Metrics (strictPrecision, strictRecall, strictF1 requiring 0 errors)
 * 5. Full safety error breakdown
 */

import type {
  ClinicalFact,
  ClinicalFactType,
  FactSpeaker,
  FactEvidenceType,
  FactStatus,
  FactTemporalContext,
  FactCertainty,
  DentalSurface,
  FactValueTypeMap
} from '../../types/clinicalFact';

// ============================================================================
// 1. EVALUATION TRANSCRIPT & CASE SPECIFICATION
// ============================================================================

export interface EvaluationTranscriptItem {
  readonly utteranceId?: string;
  readonly speaker: FactSpeaker | 'Dentist' | 'Patient' | 'Assistant' | string;
  readonly text: string;
  readonly startMs?: number;
  readonly endMs?: number;
}

export type EvaluationTranscript = ReadonlyArray<EvaluationTranscriptItem>;

/**
 * Discriminated ExpectedClinicalFact mapping type directly to canonical value payload.
 * Eliminates untyped Record<string, unknown> escapes.
 */
export type ExpectedClinicalFact = {
  [K in ClinicalFactType]: {
    readonly type: K;
    readonly speaker: FactSpeaker;
    readonly evidenceType: FactEvidenceType;
    readonly value: Partial<FactValueTypeMap[K]> | string;
    readonly status: FactStatus;
    readonly temporal: FactTemporalContext;
    readonly certainty: FactCertainty;
    readonly anatomy?: {
      readonly teeth?: ReadonlyArray<number>;
      readonly surfaces?: ReadonlyArray<DentalSurface>;
      readonly quadrant?: number;
      readonly arch?: 'maxillary' | 'mandibular';
      readonly sextant?: number;
      readonly softTissueSite?: string;
    };
    readonly negationScope?: string;
    readonly expectedEvidenceKeywords?: ReadonlyArray<string>;
    readonly notes?: string;
  }
}[ClinicalFactType];

export type CaseDifficulty = 'basic' | 'intermediate' | 'complex' | 'adversarial';

export type ClinicalEvaluationCategory =
  | 'speaker'
  | 'negation'
  | 'temporal'
  | 'anatomy'
  | 'dental_findings'
  | 'procedures'
  | 'anaesthesia'
  | 'medication'
  | 'consent'
  | 'clinical_ambiguity'
  | 'adversarial';

export interface ClinicalEvaluationCase {
  readonly id: string;
  readonly datasetVersion: string;
  readonly description: string;
  readonly category: ClinicalEvaluationCategory;
  readonly difficulty: CaseDifficulty;
  readonly isAdversarial: boolean;
  readonly clinicalDomain: string;
  readonly transcript: EvaluationTranscript;
  readonly expectedFacts: ReadonlyArray<ExpectedClinicalFact>;
  readonly expectedWarnings?: ReadonlyArray<string>;
  readonly tags?: ReadonlyArray<string>;
  readonly rationale?: string;
}

// ============================================================================
// 2. ERROR TAXONOMY & CLINICAL SEVERITY
// ============================================================================

export type ClinicalErrorType =
  | 'missed_fact'
  | 'hallucinated_fact'
  | 'wrong_fact_type'
  | 'wrong_speaker'
  | 'wrong_evidence_type'
  | 'wrong_anatomy'
  | 'wrong_surface'
  | 'wrong_status'
  | 'wrong_temporal_context'
  | 'wrong_certainty'
  | 'wrong_value'
  | 'wrong_negation'
  | 'unsupported_detail'
  | 'evidence_mismatch'
  | 'provenance_error'
  | 'structural_validation_error';

export type ClinicalErrorSeverity =
  | 'critical'
  | 'high'
  | 'moderate'
  | 'low';

export interface FactComparisonError {
  readonly errorType: ClinicalErrorType;
  readonly severity: ClinicalErrorSeverity;
  readonly message: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
  readonly field?: string;
}

// ============================================================================
// 3. COMPARISON & EVALUATION RESULTS
// ============================================================================

export interface FactMatchPair {
  readonly expectedIndex: number;
  readonly actualIndex: number;
  readonly expected: ExpectedClinicalFact;
  readonly actual: ClinicalFact;
  readonly isExactMatch: boolean;
  readonly errors: ReadonlyArray<FactComparisonError>;
}

export interface CaseEvaluationResult {
  readonly caseId: string;
  readonly datasetVersion: string;
  readonly passed: boolean;
  readonly matchedPairs: ReadonlyArray<FactMatchPair>;
  readonly missedFacts: ReadonlyArray<{ expectedIndex: number; fact: ExpectedClinicalFact }>;
  readonly hallucinatedFacts: ReadonlyArray<{ actualIndex: number; fact: ClinicalFact }>;
  readonly errors: ReadonlyArray<FactComparisonError>;
  readonly constructionErrors?: ReadonlyArray<string>;
  readonly metrics: CaseMetrics;
}

export interface CaseMetrics {
  readonly totalExpected: number;
  readonly totalActual: number;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  readonly strictTruePositives: number;
  readonly strictPrecision: number;
  readonly strictRecall: number;
  readonly strictF1: number;
}

// ============================================================================
// 4. AGGREGATED BENCHMARK METRICS & SAFETY DIMENSIONS
// ============================================================================

export interface DimensionAccuracy {
  readonly totalTested: number;
  readonly correctCount: number;
  readonly accuracy: number;
}

export interface BenchmarkMetrics {
  readonly datasetVersion: string;
  readonly totalCases: number;
  readonly totalExpectedFacts: number;
  readonly totalExtractedFacts: number;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;

  // Primary Clinical Safety Metrics (allowing low-severity non-clinical variances)
  readonly factPrecision: number;
  readonly factRecall: number;
  readonly factF1: number;

  // Strict Accuracy Metrics (requiring zero errors of any severity)
  readonly strictTruePositives: number;
  readonly strictPrecision: number;
  readonly strictRecall: number;
  readonly strictF1: number;

  // Dimension-Specific Accuracies
  readonly speakerAccuracy: DimensionAccuracy;
  readonly evidenceTypeAccuracy: DimensionAccuracy;
  readonly statusAccuracy: DimensionAccuracy;
  readonly temporalAccuracy: DimensionAccuracy;
  readonly anatomyAccuracy: DimensionAccuracy;
  readonly certaintyAccuracy: DimensionAccuracy;
  readonly typeAccuracy: DimensionAccuracy;
  readonly valueAccuracy: DimensionAccuracy;

  // Clinical Safety Severity Counts
  readonly criticalErrorCount: number;
  readonly highSeverityErrorCount: number;
  readonly moderateSeverityErrorCount: number;
  readonly lowSeverityErrorCount: number;

  // Safety Failure Specific Dimensions
  readonly hallucinationCount: number;
  readonly missedFactCount: number;
  readonly falsePositiveAssertions: number;
  readonly falseNegativeAssertions: number;
  readonly negationFailures: number;
  readonly temporalFailures: number;
  readonly anatomicalFailures: number;
  readonly provenanceFailures: number;
  readonly evidenceMismatchCount: number;
  readonly unsupportedDetailsCount: number;
  readonly structuralValidationErrorsCount: number;
  readonly wrongFactTypeCount: number;
}

export interface BenchmarkEvaluationReport {
  readonly datasetVersion: string;
  readonly timestamp: string;
  readonly metrics: BenchmarkMetrics;
  readonly caseResults: ReadonlyArray<CaseEvaluationResult>;
  readonly formattedSummary: string;
}
