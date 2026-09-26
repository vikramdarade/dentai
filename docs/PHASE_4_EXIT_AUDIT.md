# DentAI — Phase 4 Independent Architecture & Safety Exit Audit
**Document:** `docs/PHASE_4_EXIT_AUDIT.md`  
**Date:** September 2026  
**Auditor:** Antigravity Senior Engineering Agent  
**Scope:** Phase 4 Deterministic Clinical Evaluation Harness & Accuracy Benchmark  
**Standard:** *Can DentAI now reliably measure whether clinical extraction is correct, clinically meaningful, evidence-grounded, and safe enough to use as the baseline for future development?*

---

## 1. Executive Conclusion

### **PHASE 4 EXIT STATUS: PASS WITH REQUIRED FIXES**
### **PHASE 5 READY: NO**

The foundational architecture of Phase 4 is conceptually sound: the bipartite semantic comparison engine, case representation schema, 16-point error taxonomy, 4-tier severity model, metric aggregator, and reporting pipelines are implemented, fully tested, and cleanly integrated. The suite passes 667/667 Vitest tests with 0 TypeScript errors.

However, this adversarial exit audit has identified **7 structural defects and blind spots** in the evaluation harness and gold dataset. If unaddressed, these flaws would allow clinically invalid, hallucinated, or ungrounded assertions to pass the benchmark with 100% precision and F1 scores. Specifically:
1. The gold dataset in `corpus.ts` uses untyped/informal field names (`procedure`, `medication`, `symptom`) that contradict the canonical `ClinicalFact` discriminated type system established in Phase 3.
2. The primary golden case (`case-golden-001`) contains an invented, clinically unsupported assertion (`percussion: 'negative'`) never spoken in the transcript.
3. The comparison engine only verifies fields present in the expected fact; it completely ignores extra, hallucinated clinical details present in the actual extracted fact.
4. The evaluation comparator has no access to the transcript and does not verify whether evidence spans are authentic, non-empty, or spoken by the attributed speaker.
5. In the current scoring formulation, facts with `moderate` errors (e.g. drilling or restoring the wrong dental surface `O` vs `M`) are counted as True Positives, artificially inflating precision, recall, and F1.

Phase 5 cannot begin until the blocking fixes identified in Section 9 are completed.

---

## 2. Verified Implementation

The following files and components were inspected line-by-line:

| Component | File Path | Verified Capabilities |
|---|---|---|
| **Domain Types** | `src/types/clinicalFact.ts` | Discriminated `FactValueTypeMap`, separated extraction method/certainty, separated validation/verification states, ISO 3950 redundancy validator, central status × temporal matrix. |
| **Controlled Construction** | `src/lib/clinicalFactMigration.ts` | `createCanonicalClinicalFact`, `isFactConstructionFailure`, tooth reference factory, bidirectional legacy adapters. |
| **Evaluation Types** | `src/lib/clinicalEvaluation/types.ts` | `ClinicalEvaluationCase`, `ExpectedClinicalFact`, 16-point `ClinicalErrorType`, 4-tier `ClinicalErrorSeverity`, `BenchmarkMetrics`. |
| **Comparison Engine** | `src/lib/clinicalEvaluation/evaluator.ts` | `computeSemanticAffinity`, `compareFactFields`, `compareClinicalFacts`, `evaluateCase`, `aggregateBenchmarkMetrics`, `formatEvaluationReport`. |
| **Benchmark Corpus** | `src/lib/clinicalEvaluation/corpus.ts` | `CLINICAL_EVALUATION_CORPUS_V1` containing 17 cases (11 adversarial) covering 10 clinical domains. |
| **Contract & Benchmark Tests** | `tests/clinicalEvaluation.test.ts` | 15 unit and benchmark tests verifying error classification, metrics calculations, golden cases, and determinism. |
| **Legacy Contracts** | `tests/clinicalFactContract.test.ts` | 32 contract tests verifying Phase 2 & Phase 3 safety invariants. |

---

## 3. Test & Verification Results

```text
TypeScript Compiler (tsc -b --noEmit):      PASS (0 errors, 0 warnings)
Vitest Test Suite:                          PASS (51 test files passed, 1 skipped)
Total Tests:                                667 passed, 19 skipped (686 total)
Duration:                                   72.70 seconds
Regression Count:                           0 regressions
Phase 4 Specific Tests:                     15/15 passed (tests/clinicalEvaluation.test.ts)
Phase 3 Contract Tests:                     32/32 passed (tests/clinicalFactContract.test.ts)
Deterministic Reproducibility:              Verified (consecutive runs yield identical byte-level metrics)
```

---

## 4. Benchmark Statistics

- **Corpus Version:** `v1.0.0`
- **Total Evaluation Cases:** 17
- **Total Expected ClinicalFacts:** 27
- **Adversarial Cases:** 11 (64.7% of corpus — exceeding the 30% mandate)
- **Clinical Domains Covered (10):**
  1. Speaker attribution (patient vs clinician relay)
  2. Negation vs diagnostic uncertainty
  3. Temporal context (planned, performed, previous visit, historical)
  4. Anatomical bounds (ISO 3950 FDI numbers, anterior vs posterior surfaces)
  5. Dental findings (caries, existing restorations, vitality)
  6. Procedures (restorations, surgical extractions)
  7. Anaesthesia (drug, volume, vasoconstrictor, technique)
  8. Pharmacology (anticoagulants, denial of blood thinners)
  9. Informed consent & treatment refusal
  10. Clinical ambiguity & differential diagnosis
- **Current Benchmark Metrics (on perfect mock pass):**
  - Fact Precision: 100.0%
  - Fact Recall: 100.0%
  - Fact F1 Score: 100.0%
  - Critical Errors: 0
  - High Severity Errors: 0
  - Moderate Errors: 0
  - Low Severity Errors: 0

---

## 5. Critical Findings

### Finding CE-01 (Severity: CRITICAL)
- **Location:** `src/lib/clinicalEvaluation/types.ts` (lines 35–55) and `src/lib/clinicalEvaluation/corpus.ts` (cases 7, 8, 10, 11, 13, 14).
- **Problem:** `ExpectedClinicalFact.value` is typed as `Record<string, unknown> | string` rather than being typed with the Phase 3 discriminated `FactValueTypeMap`. Consequently, the benchmark corpus uses informal field names:
  - `case-temporal-001`: `value: { procedure: 'composite restoration' }` instead of `{ name: 'composite restoration' }`.
  - `case-med-001`: `value: { medication: 'Eliquis' }` instead of `{ drugName: 'Eliquis' }`.
  - `case-speaker-001`: `value: { symptom: 'pain on biting' }` instead of `{ description: 'pain on biting' }`.
  - `case-temporal-002-adv`: `value: { plannedProcedure: 'extraction' }` instead of `{ proposedProcedures: ['extraction'] }`.
- **Why It Matters:** The prompt explicitly stated: *"The expected output must be expressed using the same canonical domain concepts as production. Do not create a separate informal expected-output schema that duplicates ClinicalFact semantics."* If a production model emits a schema-compliant `ProcedureValue` (`{ name: 'composite restoration' }`), the evaluator flags a missing detail error because it is looking for `{ procedure: ... }`.
- **Evidence:** In `tests/clinicalEvaluation.test.ts` lines 463 and 468, the test author had to write `value: ef.value as any` and `} as ClinicalFact` because TypeScript rejected the gold cases as invalid `ClinicalFact`s.
- **Required Action:** Enforce `FactValueTypeMap` on `ExpectedClinicalFact` and align all gold corpus cases with the canonical value property names (`name`, `drugName`, `description`, `proposedProcedures`).

---

### Finding CE-02 (Severity: CRITICAL)
- **Location:** `src/lib/clinicalEvaluation/corpus.ts` (lines 73–74, `case-golden-001`).
- **Problem:** Fact 3 asserts `vitality: { coldTest: 'exaggerated', percussion: 'negative' }`.
- **Why It Matters:** The transcript states only: *"Tooth 36 is sensitive to cold but there is no lingering pain. I can see an MOD carious lesion. We'll restore it at the next visit."* Percussion was **never tested, spoken, or mentioned**. The gold standard itself contains an invented clinical finding. This directly violates Section 21 of the prompt (*"The gold standard should only assert clinically supported facts... The evaluation dataset itself must be protected against hallucinated expectations"*).
- **Evidence:** Utterance `u2` contains 0 mentions of percussion or tapping.
- **Required Action:** Remove `percussion: 'negative'` from `case-golden-001`.

---

### Finding CE-03 (Severity: HIGH)
- **Location:** `src/lib/clinicalEvaluation/evaluator.ts` (lines 269–304).
- **Problem:** The comparator loops only over `Object.entries(expObj)` to check if actual fields match expected fields. It **never loops over `Object.entries(actObj)`** to detect extra, unsupported fields present in the actual fact.
- **Why It Matters:** If the gold standard expects `{ condition: 'caries' }` on tooth 36, and the actual extracted fact contains `{ condition: 'caries', depth: 'pulpal_involvement', boneLoss: 'severe', necrosis: true }`, the evaluator detects **zero errors**. The extra fabricated clinical details are completely ignored.
- **Evidence:** `evaluator.ts` lines 269–304: No loop over keys in `actObj` that do not exist in `expObj`.
- **Required Action:** Add a reverse property comparison loop over `actObj` keys. Any property in `actObj` not supported by `expObj` must emit `unsupported_detail` (severity: `high`).

---

### Finding CE-04 (Severity: HIGH)
- **Location:** `src/lib/clinicalEvaluation/evaluator.ts` (lines 306–330).
- **Problem:** Evidence grounding is disconnected from the transcript:
  1. `compareFactFields` does not receive the consultation transcript.
  2. It only checks whether numerical timestamps (if present) are non-negative, or if rawText contains `'[synthetic]'`.
  3. If `actual.evidence` is empty (`[]`), the loop does not execute, and **zero errors** are emitted.
  4. It does not verify whether `utteranceId` exists in the transcript, whether `rawText` appears in the transcript, or whether the speaker matches.
- **Why It Matters:** An extraction model could output a completely ungrounded assertion or quote a completely invented sentence, and the evaluation harness reports 100% evidence accuracy.
- **Evidence:** `compareFactFields` signature: `(expected: ExpectedClinicalFact, actual: ClinicalFact)`. No `transcript` parameter.
- **Required Action:** Pass `caseDef.transcript` into `evaluateCase` / `compareClinicalFacts`. Emit `evidence_mismatch` if evidence is missing when expected, if `utteranceId` is invalid, or if `rawText` does not match the source utterance.

---

### Finding CE-05 (Severity: HIGH)
- **Location:** `src/lib/clinicalEvaluation/evaluator.ts` (lines 375–385).
- **Problem:** Moderate severity errors (such as `wrong_surface`, `wrong_certainty`, and `unsupported_detail`) are filtered out when determining True Positives:
  ```typescript
  const exactMatches = comparison.matchedPairs.filter(
    p => !p.errors.some(e => e.severity === 'critical' || e.severity === 'high')
  ).length;
  ```
- **Why It Matters:** If an extraction model places a filling on the **Mesial (`M`)** surface instead of the **Occlusal (`O`)** surface, `compareFactFields` emits `wrong_surface` (severity: `moderate`). Because the error is moderate, it is considered an `exactMatch`, counted as a `truePositive`, and reported as **Precision: 1.0, Recall: 1.0, F1: 1.0**.
- **Evidence:** `evaluator.ts` line 375: `exactMatches` only checks `e.severity === 'critical' || e.severity === 'high'`.
- **Required Action:** For a fact to count as a True Positive in strict precision/recall, it must have **zero errors of any severity** (`p.errors.length === 0`). Introduce a distinct `strictF1` (requiring 0 errors) alongside a `clinicalSafetyF1` (allowing minor low-severity notes).

---

### Finding CE-06 (Severity: MODERATE)
- **Location:** `src/lib/clinicalEvaluation/evaluator.ts` (lines 52–56 and 320–355).
- **Problem:** `computeSemanticAffinity` returns `0` if `expected.type !== actual.type`. Consequently:
  - Facts of different types are never matched as candidates in bipartite matching.
  - A mismatched type (e.g. model outputting `procedure` instead of `symptom`) is always split into 1 `missed_fact` + 1 `hallucinated_fact`.
  - The error type `wrong_fact_type` is **never emitted** in `evaluateCase`.
  - Furthermore, `structural_validation_error` is never emitted because `validationState` is never inspected.
- **Why It Matters:** The error taxonomy defines `wrong_fact_type` and `structural_validation_error`, but the matching logic makes them dead code.
- **Evidence:** Grep search in `evaluator.ts` confirms `wrong_fact_type` only exists in `compareFactFields`, which is never called for cross-type pairs.
- **Required Action:** Allow high-affinity anatomical matches of differing types (e.g. matching tooth 36) to pair when no same-type fact exists, emitting `wrong_fact_type`. Check `actual.validationState === 'invalid'` and emit `structural_validation_error`.

---

### Finding CE-07 (Severity: MODERATE)
- **Location:** `src/lib/clinicalEvaluation/index.ts` and `src/lib/clinicalEvaluation/evaluator.ts`.
- **Problem:** The evaluation harness accepts only `ClinicalFact[]`. It does not accept `CandidateClinicalFact[]` or test the canonical construction pathway (`createCanonicalClinicalFact`) during an evaluation run.
- **Why It Matters:** The evaluation layer currently assumes canonical facts have already been created. It does not evaluate whether untrusted candidate facts can safely pass through normalisation and validation without error.
- **Evidence:** `evaluateCase(caseDef: ClinicalEvaluationCase, actualFacts: ReadonlyArray<ClinicalFact>)`.
- **Required Action:** Export an `evaluateCandidateCase(caseDef, candidates)` helper that passes candidates through `createCanonicalClinicalFact` before comparison, reporting boundary construction errors.

---

## 6. Clinical Safety Findings by Domain

### A. Anatomy
- **Tooth Numbering:** Reliably catches wrong teeth (`wrong_anatomy`, critical severity, e.g. #36 vs #46).
- **Tooth Surfaces:** Catches wrong surfaces (`wrong_surface`), but masks the error by counting the fact as a True Positive in precision/recall (Finding CE-05).
- **Quadrant & Arch:** Does not compare `quadrant` or `arch` in `compareFactFields`. If an assertion targets quadrant 1 instead of quadrant 3, it produces 0 errors unless teeth numbers are also present.

### B. Negation
- **Direct Negation vs Observed:** Inverting `status: 'negated'` to `observed` (or vice-versa) is correctly classified as `wrong_negation` with `critical` severity.
- **Uncertainty vs Negation:** Handled cleanly in `case-negation-003-adv` (`certainty: 'uncertain'` vs `status: 'negated'`).

### C. Temporal Context
- **Planned vs Performed:** Inversions (e.g. `planned` vs `performed`) are correctly classified as `wrong_status` with `critical` severity.
- **Historical vs Completed Today:** Inverting `previous_appointment` to `completed_today` is correctly classified as `wrong_temporal_context` with `critical` severity.

### D. Speaker Attribution
- **Patient vs Clinician Inversion:** Correctly classified as `wrong_speaker` with `critical` severity.
- **Evidence Type Inversion:** Inverting `patient_reported` to `clinician_observed` is correctly classified as `wrong_evidence_type` with `critical` severity.

### E. Medication & Allergy
- **Pharmacology:** Discriminated `MedicationValue` and `AllergyValue` interfaces exist, but gold cases use `medication` instead of `drugName` (Finding CE-01).

### F. Procedures & Consent
- **Undecided Deliberation:** `case-consent-001-adv` cleanly tests treatment discussion without consent.
- **Procedure Values:** Gold cases use `procedure` instead of `name` (Finding CE-01).

### G. Evidence & Provenance
- **Timestamp Bounds:** Correctly checks `0 <= startMs <= endMs`.
- **Synthetic Markers:** Rejects `[synthetic]`.
- **Grounding Disconnect:** Fails to verify evidence spans against the transcript (Finding CE-04).

---

## 7. Evaluation Weaknesses & Blind Spots

The following table summarizes conditions under which the evaluation system would report success (`PASS` or `Precision: 100%`) despite a clinically meaningful error:

| Scenario | Actual Model Behavior | Evaluator Output | Root Cause |
|---|---|---|---|
| **Hallucinated Clinical Severity** | Model adds `necrosis: true`, `boneLoss: severe` to a simple caries finding | **0 errors, F1: 100%** | Evaluator only loops over expected properties (Finding CE-03). |
| **Wrong Tooth Surface** | Model restores `36 M` instead of `36 O` | **F1: 100%** | Moderate errors are included in `exactMatches` (Finding CE-05). |
| **Ungrounded Fact** | Model outputs a fact with `evidence: []` | **0 errors, F1: 100%** | Empty evidence array bypasses the validation loop (Finding CE-04). |
| **Fabricated Quote** | Model invents a sentence not in the transcript | **0 errors, F1: 100%** | Evaluator does not cross-reference `caseDef.transcript` (Finding CE-04). |
| **Invalid Domain State** | Fact has `validationState: 'invalid'` | **0 errors, F1: 100%** | Evaluator never inspects `validationState` (Finding CE-06). |
| **Wrong Quadrant/Arch** | Arch-level symptom attributed to Maxilla instead of Mandible | **0 errors, F1: 100%** | Evaluator only compares `teeth` and `surfaces`, ignoring `quadrant` and `arch`. |

---

## 8. Missing Benchmark Scenarios

The current 17 cases provide strong initial coverage of core concepts, but the following high-risk dental scenarios are not yet represented:
1. **Multi-Unit Bridge / Crown Fixed Prosthodontics:** e.g. 3-unit bridge from 14 to 16 with 15 pontic.
2. **Pediatric Deciduous Exfoliation & Pulpotomy:** e.g. tooth 54 pulpotomy vs permanent premolar.
3. **Implant Fixture vs Healing Abutment:** Placement of implant fixture (ADA 661) vs stage 2 uncover and healing abutment (ADA 684).
4. **Allergy History with Cross-Reactivity:** Patient allergic to Penicillin; clinician discussing Amoxicillin avoidance vs Cephalosporin caution.
5. **Periodontal Full-Mouth BPE Charting:** Sextants with BPE scores 0–4 and furcation involvement.

---

## 9. Phase 5 Blockers

The following items are **hard blockers** that must be resolved before Phase 5 can commence:

1. **[BLOCKER-1] Fix Gold Dataset Schema Alignment:**
   Update `ExpectedClinicalFact.value` to enforce the Phase 3 discriminated `FactValueTypeMap`. Correct property names in `corpus.ts` (`name` for procedures, `drugName` for medications, `description` for symptoms, `proposedProcedures` for treatment plans). Eliminate all `as any` typecasts in `tests/clinicalEvaluation.test.ts`.
2. **[BLOCKER-2] Fix Hallucinated Percussion in Golden Case 1:**
   Remove `percussion: 'negative'` from `case-golden-001` in `corpus.ts`.
3. **[BLOCKER-3] Implement Reverse Property Comparison in Evaluator:**
   In `compareFactFields`, loop over `Object.entries(actObj)`. Any property present in `actObj` that is not defined in `expObj` must emit `unsupported_detail` (severity: `high`).
4. **[BLOCKER-4] Implement Transcript Evidence Cross-Referencing:**
   Provide `caseDef.transcript` to `evaluateCase`. Require non-empty evidence when expected, verify that `utteranceId` exists in the transcript, and verify that `rawText` exists within the attributed utterance.
5. **[BLOCKER-5] Fix Precision/Recall Severity Masking:**
   Require `errors.length === 0` for a matched pair to count as a True Positive in `strictPrecision`, `strictRecall`, and `strictF1`. Surface `moderate` errors (like wrong surface) as failures in strict accuracy.

---

## 10. Recommended Fixes Prioritization

### Priority 1: Must Fix Before Phase 5 (Blockers)
- Resolve BLOCKER-1 through BLOCKER-5 above.

### Priority 2: Should Fix Before Phase 5
- Extend anatomical comparison in `compareFactFields` to check `quadrant`, `arch`, and `softTissueSite`.
- Add `evaluateCandidateCase(caseDef, candidates)` to test candidate-to-canonical construction during evaluation.
- Inspect `actual.validationState` and emit `structural_validation_error` if `validationState === 'invalid'`.

### Priority 3: Can Defer to Future Iterations
- Expand corpus from 17 to 50+ cases covering implants, multi-unit prosthodontics, and pediatric pulpotomies.
- Add Levenshtein fuzzy matching with calibrated thresholds for long clinician explanations.

---

## 11. Final Recommendation

```text
PHASE 4 EXIT STATUS: PASS WITH REQUIRED FIXES

PHASE 5 READY: NO

BLOCKERS:
1. Gold dataset schema mismatch: Align ExpectedClinicalFact.value with Phase 3 FactValueTypeMap (name, drugName, description).
2. Fabricated finding in Golden Case 1: Remove unmentioned 'percussion: negative' from case-golden-001.
3. One-way property checking: Add reverse loop over actual fact properties to catch hallucinated extra clinical details (unsupported_detail).
4. Evidence grounding disconnect: Pass transcript into evaluation engine and verify utteranceId, rawText existence, and speaker match.
5. False Positive inflation: Enforce errors.length === 0 for True Positives so moderate errors (e.g. wrong surface) do not report 100% F1.

NON-BLOCKING IMPROVEMENTS:
1. Add quadrant and arch comparison for non-tooth anatomical assertions.
2. Add evaluateCandidateCase() helper to evaluate CandidateClinicalFact construction.
3. Expand benchmark corpus to include fixed prosthodontic bridges, implants, and pediatric pulpotomies.
```
