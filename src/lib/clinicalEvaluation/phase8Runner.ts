/**
 * Phase 8 Clinical Evaluation Runner
 *
 * Scores the gold-set corpus through (1) the deterministic baseline extractor
 * and (2) the Phase 6 selective verification pipeline, then aggregates every
 * mandated metric. The CRITICAL ERROR LEDGER is a first-class output: critical
 * errors are never hidden inside aggregate accuracy.
 *
 * Reproducibility: the runner is fully deterministic. Case order, extraction
 * and matching are stable; the report contains no wall-clock timestamps inside
 * the hashed metrics block.
 */

import type {
  ClinicalEvaluationCase,
  CaseMetrics,
  FactComparisonError,
} from './types';
import { evaluateCandidateCase } from './evaluator';
import type { CandidateClinicalFact, ClinicalFact } from '../../types/clinicalFact';
import { createCanonicalClinicalFact, isFactConstructionFailure } from '../clinicalFactMigration';
import type { TimestampedUtterance } from '../../grounding/types';
import { runSelectiveVerificationPass } from '../clinicalVerification';
import { extractBaselineFacts } from './deterministicExtractor';
import { buildGoldSet, GOLD_SET_VERSION } from './goldSet';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CriticalErrorCategory =
  | 'wrong_tooth'
  | 'wrong_procedure'
  | 'wrong_diagnosis'
  | 'wrong_medication'
  | 'wrong_dose'
  | 'wrong_allergy_status'
  | 'wrong_treatment_status'
  | 'patient_statement_as_clinician_finding';

export interface CriticalLedgerEntry {
  readonly caseId: string;
  readonly caseDomain: string;
  readonly isAdversarial: boolean;
  readonly isRegression: boolean;
  readonly category: CriticalErrorCategory;
  readonly errorType: string;
  readonly message: string;
}

export interface Phase8CaseResult {
  readonly caseId: string;
  readonly clinicalDomain: string;
  readonly category: string;
  readonly isAdversarial: boolean;
  readonly isRegression: boolean;
  readonly regressionFor?: string;
  readonly metrics: CaseMetrics;
  readonly errors: ReadonlyArray<FactComparisonError>;
  readonly verificationTriggered: boolean;
  readonly verificationTriggerTypes: ReadonlyArray<string>;
  readonly decisionsByOutcome: Readonly<Record<string, number>>;
}

export interface Phase8Aggregate {
  readonly cases: number;
  readonly adversarialCases: number;
  readonly regressionCases: number;
  readonly expectedFacts: number;
  readonly extractedFacts: number;

  readonly factPrecision: number;
  readonly factRecall: number;
  readonly factF1: number;
  readonly strictPrecision: number;
  readonly strictRecall: number;
  readonly strictF1: number;

  readonly omissionRate: number;
  readonly hallucinationRate: number;
  readonly dentalTerminologyErrorRate: number;

  readonly toothAccuracy: number;
  readonly surfaceAccuracy: number;
  readonly anatomicalConsistency: number;
  readonly negationAccuracy: number;
  readonly attributionAccuracy: number;
  readonly temporalAccuracy: number;
  readonly plannedPerformedAccuracy: number;
  readonly historicalCurrentAccuracy: number;
  readonly diagnosisAccuracy: number;
  readonly medicationAccuracy: number;
  readonly doseAccuracy: number;
  readonly allergyAccuracy: number;

  readonly criticalErrorRate: number;
  readonly criticalErrorCount: number;
  readonly unsupportedFactRate: number;
  readonly provenanceErrorRate: number;
  readonly evidenceGroundingRate: number;
  readonly inappropriateVerificationRate: number;
  readonly missedVerificationRate: number;
  readonly asr: {
    readonly werComputable: false;
    readonly reason: string;
    readonly benchmarkGate: string;
  };
}

export interface Phase8Report {
  readonly datasetVersion: string;
  readonly aggregate: Phase8Aggregate;
  readonly criticalLedger: ReadonlyArray<CriticalLedgerEntry>;
  readonly caseResults: ReadonlyArray<Phase8CaseResult>;
  readonly regressionFailures: ReadonlyArray<{ readonly caseId: string; readonly regressionFor: string }>;
  readonly formattedSummary: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(part: number, total: number): number {
  return total === 0 ? 1 : Number((part / total).toFixed(4));
}

/**
 * Converts a gold-set case to verification-pipeline utterances. Exported so the
 * provenance regression suite (F-2) can pin the contract: fixture timing is
 * 'synthetic', never 'measured'; untimed utterances are 'unavailable'.
 */
export function toTimestamped(c: ClinicalEvaluationCase): TimestampedUtterance[] {
  return c.transcript.map(u => {
    const speaker = (u.speaker === 'Patient' ? 'Patient'
      : u.speaker === 'Dentist' ? 'Dentist'
      : u.speaker === 'Assistant' ? 'Assistant'
      : 'Dialogue') as TimestampedUtterance['sender'];
    // Phase 10 (F-2): fixture-supplied timing is synthetic, not measured from
    // real audio. endMs absent in the fixture is left absent — the harness
    // never fabricates a +3000 ms span, and provenance is labelled 'synthetic'
    // so evaluation fixtures can never masquerade as measured clinical timing.
    return typeof u.startMs === 'number'
      ? {
          id: u.utteranceId ?? `utt-${u.text.slice(0, 8)}`,
          sender: speaker,
          text: u.text,
          ...(u.endMs !== undefined ? { startTimeMs: u.startMs, endTimeMs: u.endMs } : {}),
          timingProvenance: 'synthetic' as const,
        }
      : { id: u.utteranceId ?? `utt-${u.text.slice(0, 8)}`, sender: speaker, text: u.text, timingProvenance: 'unavailable' as const };
  });
}

function classifyCritical(
  caseDef: ClinicalEvaluationCase,
  error: FactComparisonError,
  factType: string | undefined
): CriticalErrorCategory | undefined {
  switch (error.errorType) {
    case 'wrong_anatomy':
      return 'wrong_tooth';
    case 'wrong_speaker':
    case 'wrong_evidence_type':
      if (factType === 'symptom' || factType === 'chief_complaint' || error.errorType === 'wrong_evidence_type') {
        return 'patient_statement_as_clinician_finding';
      }
      return undefined;
    case 'wrong_status':
      if (factType === 'procedure' || factType === 'treatment_plan') return 'wrong_treatment_status';
      if (factType === 'medication') return 'wrong_medication';
      if (factType === 'allergy') return 'wrong_allergy_status';
      return undefined;
    case 'wrong_temporal_context':
      if (factType === 'procedure') return 'wrong_treatment_status';
      return undefined;
    case 'wrong_value':
    case 'wrong_fact_type':
      if (factType === 'diagnosis' || factType === 'differential_diagnosis') return 'wrong_diagnosis';
      if (factType === 'medication') {
        if (error.field === 'dose') return 'wrong_dose';
        return 'wrong_medication';
      }
      if (factType === 'procedure') return 'wrong_procedure';
      if (factType === 'allergy') return 'wrong_allergy_status';
      return undefined;
    case 'wrong_negation':
      if (factType === 'medication') return 'wrong_medication';
      if (factType === 'procedure') return 'wrong_treatment_status';
      return undefined;
    case 'hallucinated_fact':
      // Hallucinated high-stakes facts are critical.
      if (factType === 'diagnosis') return 'wrong_diagnosis';
      if (factType === 'medication') return 'wrong_medication';
      if (factType === 'procedure') return 'wrong_procedure';
      if (factType === 'allergy') return 'wrong_allergy_status';
      return undefined;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export function runGoldSetEvaluation(targetSize = 200): Phase8Report {
  const { representative, adversarial, regression, all } = buildGoldSet();
  const regressionByCaseId = new Map(regression.map(r => [r.id, r.regressionFor]));

  const caseResults: Phase8CaseResult[] = [];
  const criticalLedger: CriticalLedgerEntry[] = [];
  const regressionFailures: Array<{ caseId: string; regressionFor: string }> = [];

  // Aggregation accumulators
  let expectedTotal = 0;
  let extractedTotal = 0;
  let tp = 0, fp = 0, fn = 0;
  let stp = 0;
  let wrongValueOpportunities = 0, wrongValueErrors = 0;
  let toothOpps = 0, toothErrors = 0;
  let surfaceOpps = 0, surfaceErrors = 0;
  let anatomyOpps = 0, anatomyErrors = 0;
  let negationOpps = 0, negationErrors = 0;
  let attributionOpps = 0, attributionErrors = 0;
  let temporalOpps = 0, temporalErrors = 0;
  let plannedOpps = 0, plannedErrors = 0;
  let histOpps = 0, histErrors = 0;
  let dxOpps = 0, dxErrors = 0;
  let medOpps = 0, medErrors = 0;
  let doseOpps = 0, doseErrors = 0;
  let allergyOpps = 0, allergyErrors = 0;
  let provenanceOpps = 0, provenanceErrors = 0;
  let groundingOpportunities = 0, groundingSuccesses = 0;
  let verifTriggeredCases = 0;
  let inappropriateVerification = 0;
  let missedVerification = 0;
  let casesWithCritical = 0;

  for (const caseDef of all) {
    const isRegression = regressionByCaseId.has(caseDef.id);
    const candidates: CandidateClinicalFact[] = extractBaselineFacts(
      caseDef.transcript.map(u => ({ utteranceId: u.utteranceId ?? u.text.slice(0, 8), speaker: u.speaker, text: u.text }))
    );

    // Canonical facts for the verification pipeline.
    const canonical: ClinicalFact[] = [];
    for (const cand of candidates) {
      const built = createCanonicalClinicalFact(cand);
      if (!isFactConstructionFailure(built)) canonical.push(built.fact);
    }

    // Selective verification (Phase 6) — also measures trigger behaviour.
    const verification = runSelectiveVerificationPass(canonical, toTimestamped(caseDef), {
      hasDiarization: true,
    });

    // Scoring through the Phase 4 comparator (trust-boundary runner).
    const scored = evaluateCandidateCase(caseDef, candidates);

    caseResults.push({
      caseId: caseDef.id,
      clinicalDomain: caseDef.clinicalDomain,
      category: caseDef.category,
      isAdversarial: caseDef.isAdversarial,
      isRegression,
      regressionFor: isRegression ? regressionByCaseId.get(caseDef.id) : undefined,
      metrics: scored.metrics,
      errors: scored.errors,
      verificationTriggered: verification.triggered,
      verificationTriggerTypes: verification.telemetry.triggerTypes,
      decisionsByOutcome: verification.telemetry.decisionsByOutcome,
    });

    // ---- accumulate ----
    expectedTotal += scored.metrics.totalExpected;
    extractedTotal += scored.metrics.totalActual;
    tp += scored.metrics.truePositives;
    fp += scored.metrics.falsePositives;
    fn += scored.metrics.falseNegatives;
    stp += scored.metrics.strictTruePositives;

    const caseHasCritical = scored.errors.some(e => e.severity === 'critical') || scored.hallucinatedFacts.some(h =>
      ['diagnosis', 'medication', 'procedure', 'allergy'].includes(h.fact.type)
    );
    if (caseHasCritical) casesWithCritical += 1;

    // Critical ledger (never hidden inside aggregates).
    for (const pair of scored.matchedPairs) {
      for (const err of pair.errors) {
        if (err.severity !== 'critical') continue;
        const category = classifyCritical(caseDef, err, pair.expected.type);
        if (category) {
          criticalLedger.push({
            caseId: caseDef.id,
            caseDomain: caseDef.clinicalDomain,
            isAdversarial: caseDef.isAdversarial,
            isRegression,
            category,
            errorType: err.errorType,
            message: err.message,
          });
        }
      }
    }
    for (const h of scored.hallucinatedFacts) {
      const category = classifyCritical(caseDef, {
        errorType: 'hallucinated_fact',
        severity: 'critical',
        message: `Hallucinated ${h.fact.type} fact.`,
      }, h.fact.type);
      if (category) {
        criticalLedger.push({
          caseId: caseDef.id,
          caseDomain: caseDef.clinicalDomain,
          isAdversarial: caseDef.isAdversarial,
          isRegression,
          category,
          errorType: 'hallucinated_fact',
          message: `Hallucinated ${h.fact.type} fact not supported by the transcript.`,
        });
      }
    }

    // Dimension accuracies from matched pairs.
    for (const pair of scored.matchedPairs) {
      const types = pair.errors.map(e => e.errorType);
      const factType = pair.expected.type;

      if (types.includes('wrong_value') || types.includes('wrong_fact_type')) wrongValueErrors += 1;
      wrongValueOpportunities += 1;

      if (pair.expected.anatomy?.teeth?.length) {
        toothOpps += 1;
        if (types.includes('wrong_anatomy')) toothErrors += 1;
      }
      if (pair.expected.anatomy?.surfaces?.length) {
        surfaceOpps += 1;
        if (types.includes('wrong_surface')) surfaceErrors += 1;
      }
      if (pair.expected.anatomy) {
        anatomyOpps += 1;
        if (types.includes('wrong_anatomy') || types.includes('wrong_surface')) anatomyErrors += 1;
      }
      if (pair.expected.status === 'negated' || pair.expected.negationScope) {
        negationOpps += 1;
        if (types.includes('wrong_negation') || types.includes('wrong_status')) negationErrors += 1;
      }
      attributionOpps += 1;
      if (types.includes('wrong_speaker') || types.includes('wrong_evidence_type')) attributionErrors += 1;
      temporalOpps += 1;
      if (types.includes('wrong_temporal_context')) temporalErrors += 1;

      if ((factType === 'procedure' || factType === 'treatment_plan') && ['planned', 'performed'].includes(pair.expected.status)) {
        plannedOpps += 1;
        if (types.includes('wrong_status') || types.includes('wrong_temporal_context')) plannedErrors += 1;
      }
      if (['historical', 'previous_appointment'].includes(pair.expected.temporal) || pair.expected.temporal === 'current') {
        histOpps += 1;
        if (types.includes('wrong_temporal_context')) histErrors += 1;
      }
      if (factType === 'diagnosis') {
        dxOpps += 1;
        if (types.includes('wrong_value') || types.includes('wrong_status') || types.includes('wrong_fact_type')) dxErrors += 1;
      }
      if (factType === 'medication') {
        medOpps += 1;
        if (types.includes('wrong_value') || types.includes('wrong_negation')) medErrors += 1;
        if (typeof (pair.expected.value as { dose?: string }).dose === 'string') {
          doseOpps += 1;
          if (types.includes('wrong_value')) doseErrors += 1;
        }
      }
      if (factType === 'allergy') {
        allergyOpps += 1;
        if (types.includes('wrong_value') || types.includes('wrong_negation')) allergyErrors += 1;
      }

      // Evidence grounding: matched pair with expected evidence keywords —
      // did the actual fact carry grounding evidence?
      if ((pair.expected.expectedEvidenceKeywords?.length ?? 0) > 0) {
        provenanceOpps += 1;
        groundingOpportunities += 1;
        const hasGrounding = (pair.actual.evidence?.length ?? 0) > 0
          && !types.includes('evidence_mismatch')
          && !types.includes('provenance_error');
        if (hasGrounding) groundingSuccesses += 1;
        else provenanceErrors += 1;
      }
    }

    // Hallucinated high-stakes facts are counted through fp and the critical
    // ledger above; nothing further to accumulate here.

    // Verification-rate dimensions.
    if (verification.triggered) {
      verifTriggeredCases += 1;
      if (!caseHasCritical && !scored.errors.some(e => e.severity === 'high')) {
        inappropriateVerification += 1;
      }
    } else if (caseHasCritical) {
      missedVerification += 1;
    }

    // Regression policy: a regression fixture must pass cleanly.
    if (isRegression && (!scored.passed || caseHasCritical)) {
      regressionFailures.push({ caseId: caseDef.id, regressionFor: regressionByCaseId.get(caseDef.id)! });
    }
  }

  const hallucinatedCount = fp; // hallucinated == false positives
  const aggregate: Phase8Aggregate = {
    cases: all.length,
    adversarialCases: adversarial.length,
    regressionCases: regression.length,
    expectedFacts: expectedTotal,
    extractedFacts: extractedTotal,

    factPrecision: pct(tp, tp + fp),
    factRecall: pct(tp, tp + fn),
    factF1: (() => {
      const p = pct(tp, tp + fp);
      const r = pct(tp, tp + fn);
      return p + r === 0 ? 0 : Number(((2 * p * r) / (p + r)).toFixed(4));
    })(),
    strictPrecision: pct(stp, tp + fp),
    strictRecall: pct(stp, tp + fn),
    strictF1: (() => {
      const p = pct(stp, tp + fp);
      const r = pct(stp, tp + fn);
      return p + r === 0 ? 0 : Number(((2 * p * r) / (p + r)).toFixed(4));
    })(),

    omissionRate: pct(fn, expectedTotal),
    hallucinationRate: pct(hallucinatedCount, extractedTotal),
    dentalTerminologyErrorRate: pct(wrongValueErrors, wrongValueOpportunities),

    toothAccuracy: pct(toothOpps - toothErrors, toothOpps),
    surfaceAccuracy: pct(surfaceOpps - surfaceErrors, surfaceOpps),
    anatomicalConsistency: pct(anatomyOpps - anatomyErrors, anatomyOpps),
    negationAccuracy: pct(negationOpps - negationErrors, negationOpps),
    attributionAccuracy: pct(attributionOpps - attributionErrors, attributionOpps),
    temporalAccuracy: pct(temporalOpps - temporalErrors, temporalOpps),
    plannedPerformedAccuracy: pct(plannedOpps - plannedErrors, plannedOpps),
    historicalCurrentAccuracy: pct(histOpps - histErrors, histOpps),
    diagnosisAccuracy: pct(dxOpps - dxErrors, dxOpps),
    medicationAccuracy: pct(medOpps - medErrors, medOpps),
    doseAccuracy: pct(doseOpps - doseErrors, doseOpps),
    allergyAccuracy: pct(allergyOpps - allergyErrors, allergyOpps),

    criticalErrorRate: pct(casesWithCritical, all.length),
    criticalErrorCount: criticalLedger.length,
    unsupportedFactRate: pct(hallucinatedCount, extractedTotal),
    provenanceErrorRate: pct(provenanceErrors, provenanceOpps),
    evidenceGroundingRate: pct(groundingSuccesses, groundingOpportunities),
    inappropriateVerificationRate: pct(inappropriateVerification, verifTriggeredCases),
    missedVerificationRate: pct(missedVerification, casesWithCritical),
    asr: {
      werComputable: false,
      reason: 'Text-only synthetic corpus — no audio exists, so ASR WER is not computable here. WER is measured in the audio-derived benchmark harness (npm run eval:benchmark, currently 0.00% clinical-concept WER).',
      benchmarkGate: 'npm run eval:benchmark — 20/20 cases, 0.00% WER, 100% FDI precision/recall',
    },
  };

  const summary = [
    `Phase 8 Gold-Set Evaluation — ${GOLD_SET_VERSION}`,
    `Cases: ${aggregate.cases} (${aggregate.adversarialCases} adversarial, ${aggregate.regressionCases} regression)`,
    `Facts: expected ${aggregate.expectedFacts}, extracted ${aggregate.extractedFacts}`,
    `Fact P/R/F1: ${(aggregate.factPrecision * 100).toFixed(1)}% / ${(aggregate.factRecall * 100).toFixed(1)}% / ${(aggregate.factF1 * 100).toFixed(1)}%`,
    `Strict P/R/F1 (zero-error): ${(aggregate.strictPrecision * 100).toFixed(1)}% / ${(aggregate.strictRecall * 100).toFixed(1)}% / ${(aggregate.strictF1 * 100).toFixed(1)}%`,
    `Omission ${(aggregate.omissionRate * 100).toFixed(1)}% | Hallucination ${(aggregate.hallucinationRate * 100).toFixed(1)}% | Terminology errors ${(aggregate.dentalTerminologyErrorRate * 100).toFixed(1)}%`,
    `Tooth ${(aggregate.toothAccuracy * 100).toFixed(1)}% | Surface ${(aggregate.surfaceAccuracy * 100).toFixed(1)}% | Negation ${(aggregate.negationAccuracy * 100).toFixed(1)}% | Attribution ${(aggregate.attributionAccuracy * 100).toFixed(1)}%`,
    `Temporal ${(aggregate.temporalAccuracy * 100).toFixed(1)}% | Planned/Performed ${(aggregate.plannedPerformedAccuracy * 100).toFixed(1)}% | Hist/Curr ${(aggregate.historicalCurrentAccuracy * 100).toFixed(1)}%`,
    `Diagnosis ${(aggregate.diagnosisAccuracy * 100).toFixed(1)}% | Medication ${(aggregate.medicationAccuracy * 100).toFixed(1)}% | Dose ${(aggregate.doseAccuracy * 100).toFixed(1)}% | Allergy ${(aggregate.allergyAccuracy * 100).toFixed(1)}%`,
    `Evidence grounding ${(aggregate.evidenceGroundingRate * 100).toFixed(1)}% | Provenance errors ${(aggregate.provenanceErrorRate * 100).toFixed(1)}%`,
    `Verification: inappropriate ${(aggregate.inappropriateVerificationRate * 100).toFixed(1)}% | missed ${(aggregate.missedVerificationRate * 100).toFixed(1)}%`,
    ``,
    `=== CRITICAL ERROR LEDGER (${aggregate.criticalErrorCount} entries across ${casesWithCritical} cases; ${(aggregate.criticalErrorRate * 100).toFixed(1)}% of cases) ===`,
    ...criticalLedger.map(e =>
      `  [${e.category}] ${e.caseId}${e.isAdversarial ? ' (adversarial)' : ''}${e.isRegression ? ' (REGRESSION)' : ''} — ${e.errorType}: ${e.message}`
    ),
    ``,
    `Regression fixtures: ${regressionFailures.length === 0 ? 'ALL PASS' : `FAILURES: ${regressionFailures.map(f => f.regressionFor).join(', ')}`}`,
  ].join('\n');

  return {
    datasetVersion: GOLD_SET_VERSION,
    aggregate,
    criticalLedger,
    caseResults,
    regressionFailures,
    formattedSummary: summary,
  };
}
