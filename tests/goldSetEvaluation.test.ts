import { describe, it, expect } from 'vitest';
import {
  buildGoldSet,
  buildExpandedGoldSet,
  REPRESENTATIVE_CASES,
  ADVERSARIAL_CASES,
  REGRESSION_CASES,
  GOLD_SET_VERSION,
} from '../src/lib/clinicalEvaluation/goldSet';
import { runGoldSetEvaluation } from '../src/lib/clinicalEvaluation/phase8Runner';
import { extractBaselineFacts } from '../src/lib/clinicalEvaluation/deterministicExtractor';

const ALL_ADVERSARIAL_TAGS = [
  'negation', 'double_negation', 'patient_speculation', 'patient_questions',
  'clinician_questions', 'indirect_speech', 'historical_events', 'future_plans',
  'cancelled_treatment', 'declined_treatment', 'performed_elsewhere',
  'ambiguous_tooth_numbers', 'similar_sounding_teeth', 'fdi_vs_nonfdi',
  'surface_ambiguity', 'dose_ambiguity', 'multiple_speakers',
  'overlapping_dialogue', 'background_speech', 'corrections_mid_sentence',
  'self_corrections', 'contradictory_statements', 'low_asr_confidence',
];

const REPRESENTATIVE_DOMAINS = [
  'routine_examination', 'emergency', 'restorative', 'endodontic', 'periodontal',
  'prosthodontic', 'oral_surgery', 'implant', 'paediatric', 'orthodontic',
  'hygiene_preventive', 'referral', 'recall', 'medical_history', 'medications',
  'allergies', 'consent', 'treatment_plans', 'declined_treatment',
  'historical_treatment', 'postoperative_instructions',
];

describe('Phase 8 gold-set corpus', () => {
  it('covers all 21 representative clinical domains', () => {
    const domains = new Set(REPRESENTATIVE_CASES.map(c => c.clinicalDomain));
    for (const d of REPRESENTATIVE_DOMAINS) {
      expect(domains.has(d)).toBe(true);
    }
    expect(REPRESENTATIVE_DOMAINS).toHaveLength(21);
  });

  it('covers all 23 adversarial categories via tags', () => {
    const tags = new Set(ADVERSARIAL_CASES.flatMap(c => c.tags ?? []));
    for (const t of ALL_ADVERSARIAL_TAGS) {
      expect(tags.has(t)).toBe(true);
    }
    expect(ALL_ADVERSARIAL_TAGS).toHaveLength(23);
  });

  it('every adversarial case is flagged adversarial with a rationale or tags', () => {
    for (const c of ADVERSARIAL_CASES) {
      expect(c.isAdversarial).toBe(true);
      expect(c.difficulty).toBe('adversarial');
    }
  });

  it('every expected fact is grounded in its transcript (no invented gold)', () => {
    const corpus = buildGoldSet();
    for (const c of corpus.all) {
      for (const f of c.expectedFacts) {
        for (const kw of f.expectedEvidenceKeywords ?? []) {
          const norm = kw.toLowerCase().replace(/\s+/g, ' ').trim();
          const found = c.transcript.some(u => u.text.toLowerCase().includes(norm));
          if (!found) {
            throw new Error(`Case ${c.id} (${c.clinicalDomain}): evidence keyword "${kw}" not found in transcript`);
          }
        }
      }
    }
  });

  it('expands deterministically to the target size (byte-identical across builds)', () => {
    const a = JSON.stringify(buildExpandedGoldSet(220));
    const b = JSON.stringify(buildExpandedGoldSet(220));
    expect(a).toBe(b);
    const parsed = JSON.parse(a);
    expect(parsed.representative).toHaveLength(220);
  });

  it('full corpus reaches the 200+ target with regression fixtures', () => {
    const corpus = buildGoldSet();
    expect(corpus.all.length).toBeGreaterThanOrEqual(200);
    expect(corpus.regression.length).toBeGreaterThanOrEqual(5);
    expect(corpus.adversarial.length).toBe(ADVERSARIAL_CASES.length);
  });

  it('regression fixtures encode every shipped-phase defect', () => {
    const markers = REGRESSION_CASES.map(c => c.regressionFor);
    expect(markers).toContain('phase5-negated-treatment-status');
    expect(markers).toContain('phase5-planned-vs-performed');
    expect(markers).toContain('phase5-patient-vs-clinician-attribution');
    expect(markers).toContain('phase7-macro-default-injection');
    expect(markers).toContain('phase5-empty-note-false-grounding');
  });
});

describe('Phase 8 baseline extractor', () => {
  it('never emits a fact without evidence provenance', () => {
    const corpus = buildGoldSet();
    for (const c of corpus.all.slice(0, 60)) {
      const candidates = extractBaselineFacts(
        c.transcript.map(u => ({ utteranceId: u.utteranceId!, speaker: u.speaker, text: u.text }))
      );
      for (const cand of candidates) {
        expect(cand.evidence.length).toBeGreaterThan(0);
        expect(cand.evidence[0].rawText.length).toBeGreaterThan(0);
        expect(cand.evidence[0].utteranceId).toBeTruthy();
      }
    }
  });

  it('preserves uncertainty on unclear ASR spans instead of guessing', () => {
    const facts = extractBaselineFacts([
      { utteranceId: 'u1', speaker: 'Patient', text: 'I take my [unclear — sounds like eliquis?] blood thinner daily.' },
    ]);
    const med = facts.find(f => f.type === 'medication');
    expect(med).toBeDefined();
    expect(med?.certainty).toBe('uncertain');
    expect(String((med?.value as { drugName?: string }).drugName)).toMatch(/unclear/i);
  });

  it('applies the self-correction rule (last spoken dose wins)', () => {
    const facts = extractBaselineFacts([
      { utteranceId: 'u1', speaker: 'Patient', text: 'I take warfarin 5 mg... no wait, it is 3 mg now, the dose changed.' },
    ]);
    const med = facts.find(f => f.type === 'medication');
    expect((med?.value as { dose?: string }).dose).toBe('3 mg');
  });
});

describe('Phase 8 evaluation runner', () => {
  const report = runGoldSetEvaluation(200);

  it('measures every mandated metric with bounded values', () => {
    const a = report.aggregate;
    for (const value of [
      a.factPrecision, a.factRecall, a.factF1, a.omissionRate, a.hallucinationRate,
      a.toothAccuracy, a.surfaceAccuracy, a.negationAccuracy, a.attributionAccuracy,
      a.temporalAccuracy, a.plannedPerformedAccuracy, a.historicalCurrentAccuracy,
      a.diagnosisAccuracy, a.medicationAccuracy, a.doseAccuracy, a.allergyAccuracy,
      a.criticalErrorRate, a.unsupportedFactRate, a.provenanceErrorRate,
      a.evidenceGroundingRate, a.inappropriateVerificationRate, a.missedVerificationRate,
    ]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(a.asr.werComputable).toBe(false);
  });

  it('is reproducible across runs (deterministic metrics)', () => {
    const r2 = runGoldSetEvaluation(200);
    expect(JSON.stringify(r2.aggregate)).toBe(JSON.stringify(report.aggregate));
    expect(JSON.stringify(r2.criticalLedger)).toBe(JSON.stringify(report.criticalLedger));
  });

  it('reports the critical error ledger separately from aggregates', () => {
    // The ledger is a first-class output; it exists even when zero-length.
    expect(Array.isArray(report.criticalLedger)).toBe(true);
    for (const entry of report.criticalLedger) {
      expect(['wrong_tooth', 'wrong_procedure', 'wrong_diagnosis', 'wrong_medication',
        'wrong_dose', 'wrong_allergy_status', 'wrong_treatment_status',
        'patient_statement_as_clinician_finding']).toContain(entry.category);
      expect(entry.caseId).toBeTruthy();
    }
  });

  it('measures ClinicalFact precision/recall through the trust-boundary comparator', () => {
    expect(report.aggregate.expectedFacts).toBeGreaterThan(500);
    expect(report.aggregate.extractedFacts).toBeGreaterThan(400);
    expect(report.aggregate.factPrecision).toBeGreaterThan(0);
    expect(report.aggregate.factRecall).toBeGreaterThan(0);
  });

  it('measures evidence grounding and provenance safety', () => {
    // The baseline extractor always cites evidence — grounding must be perfect,
    // and any provenance error must be visible rather than silently accepted.
    expect(report.aggregate.evidenceGroundingRate).toBe(1);
    expect(report.aggregate.provenanceErrorRate).toBe(0);
  });

  it('all regression fixtures pass (regression policy gate)', () => {
    expect(report.regressionFailures).toHaveLength(0);
  });

  it('verification rates are measured and verification stays selective', () => {
    const triggered = report.caseResults.filter(r => r.verificationTriggered).length;
    // Selective principle: not every case should invoke verification.
    expect(triggered).toBeLessThan(report.aggregate.cases);
    expect(report.aggregate.inappropriateVerificationRate).toBeLessThanOrEqual(0.05);
  });

  it('produces a PHI-free formatted summary', () => {
    expect(report.formattedSummary).toContain(GOLD_SET_VERSION);
    // Synthetic names never appear (the corpus contains none, so assert none
    // of a probe set of common name strings leak into the summary).
    for (const name of ['John', 'Smith', 'patient record', 'DOB']) {
      expect(report.formattedSummary).not.toContain(name);
    }
  });

  it('exposes the WER boundary honestly (no fabricated audio metrics)', () => {
    expect(report.aggregate.asr.werComputable).toBe(false);
    expect(report.aggregate.asr.reason).toMatch(/no audio|not computable/i);
  });
});
