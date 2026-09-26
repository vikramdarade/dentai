# DentAI — Phase 4 Exit Audit Remediation Report
**Document:** `docs/PHASE_4_REMEDIATION.md`  
**Date:** September 2026  
**Status:** Remediations Complete & Verified  
**Standard Enforced:** *No known path should allow a clinically meaningful error to appear as a clean True Positive.*

---

## 1. Executive Summary

Following the adversarial findings documented in `docs/PHASE_4_EXIT_AUDIT.md`, all 5 primary blockers (BLOCKER-1 to BLOCKER-5) and both architectural findings (CE-06 and CE-07) have been fully remediated.

The evaluation harness has transitioned from a permissive comparator into an uncompromising clinical evaluation boundary:
- **Canonical Typing:** `ExpectedClinicalFact.value` is strictly bound to `FactValueTypeMap[K]`.
- **Hallucination Detection:** Bidirectional property comparison catches extra unsupported clinical assertions.
- **Transcript Verification:** Grounding spans are cross-referenced against the case transcript (`utteranceId`, `rawText`, `speaker`).
- **Strict Metric Integrity:** Matched pairs with any error (`moderate` or higher, such as wrong surface or wrong certainty) are excluded from `strictTruePositives`.
- **Trust Boundary Runner:** `evaluateCandidateCase()` runs untrusted candidates through `createCanonicalClinicalFact()` to expose construction failures.

---

## 2. Remediated Findings Matrix

### [REMEDIATION CE-01] Gold Dataset Schema Alignment (BLOCKER 1)
- **Finding:** `ExpectedClinicalFact.value` was typed as `Record<string, unknown> | string` rather than using the Phase 3 canonical `FactValueTypeMap`. Multiple cases used informal property names (`procedure`, `medication`, `symptom`, `plannedProcedure`).
- **Root Cause:** Permissive type definition in `src/lib/clinicalEvaluation/types.ts`.
- **Change Made:**
  - Redefined `ExpectedClinicalFact` as a discriminated union over `ClinicalFactType` binding `value` to `Partial<FactValueTypeMap[K]> | string`.
  - Updated all cases in `src/lib/clinicalEvaluation/corpus.ts` to use canonical property names (`name` for procedures, `drugName` for medications, `description` for symptoms, `proposedProcedures` for treatment plans).
  - Version incremented to `v1.1.0`.
  - Removed all `as any` type workarounds from `tests/clinicalEvaluation.test.ts`.
- **Tests Added:** `Dataset Schema & Corpus Invariants` tests compile-time and runtime compliance across all cases.
- **Verification Result:** Clean TypeScript compilation with zero errors (`tsc -b --noEmit`).

---

### [REMEDIATION CE-02] Removal of Fabricated Percussion Finding (BLOCKER 2)
- **Location:** `case-golden-001` in `src/lib/clinicalEvaluation/corpus.ts`.
- **Problem:** Fact 3 asserted `vitality: { coldTest: 'exaggerated', percussion: 'negative' }`, but the transcript never tested or mentioned percussion.
- **Root Cause:** Over-specification during initial corpus authoring.
- **Change Made:** Removed `percussion: 'negative'` from Fact 3. The assertion now strictly asserts `vitality: { coldTest: 'exaggerated' }`.
- **Tests Added:** Explicit unit test in `tests/clinicalEvaluation.test.ts` verifying that `case-golden-001` does not contain `percussion`.
- **Verification Result:** PASS.

---

### [REMEDIATION CE-03] Bidirectional Value Comparison & Unsupported Details (BLOCKER 3)
- **Finding:** The comparator only checked `expObj -> actObj`. Extra, unsupported properties in `actObj` (e.g. hallucinated pulpal necrosis or severe bone loss) passed undetected with 0 errors.
- **Root Cause:** One-way loop over `Object.entries(expObj)` in `evaluator.ts`.
- **Change Made:**
  - Implemented `compareValueObjects()` with bidirectional comparison.
  - Added reverse loop over `Object.entries(actObj)`. Any clinical detail in `actObj` not present in `expObj` emits `unsupported_detail` with `severity: 'high'`.
  - Added recursive handling for nested objects and array value sets.
- **Tests Added:** Adversarial Test A (`Test A: detects unsupported extra clinical details in actual fact and fails strict F1`).
- **Verification Result:** PASS. Extra unsupported details are reliably classified and penalize strict F1.

---

### [REMEDIATION CE-04] Transcript Evidence Cross-Referencing (BLOCKER 4)
- **Finding:** Evidence grounding checks were disconnected from the transcript. Empty evidence arrays or completely fabricated quotes were ignored.
- **Root Cause:** `compareFactFields` did not have access to `caseDef.transcript`.
- **Change Made:**
  - Extended `compareFactFields` and `compareClinicalFacts` to accept `transcript?: EvaluationTranscript`.
  - If expected fact requires evidence, an empty `actual.evidence: []` emits `evidence_mismatch` (severity: `high`).
  - Verifies that `span.utteranceId` exists in the transcript; otherwise emits `evidence_mismatch` (severity: `critical`).
  - Verifies that `span.rawText` actually appears in the referenced utterance; otherwise emits `evidence_mismatch` (severity: `critical`).
  - Verifies speaker consistency between evidence and utterance; otherwise emits `wrong_speaker` (severity: `high`).
- **Tests Added:** Adversarial Tests B, C, D, and E.
- **Verification Result:** PASS.

---

### [REMEDIATION CE-05] Strict Metrics & False Positive Masking Elimination (BLOCKER 5)
- **Finding:** Moderate errors (such as `wrong_surface`: restoring `36 M` instead of `36 O`) were counted in `exactMatches` / True Positives, reporting 100% precision and F1.
- **Root Cause:** `exactMatches` only filtered out `critical` and `high` severity errors.
- **Change Made:**
  - Defined `strictTruePositives` requiring `errors.length === 0` (zero errors of any severity).
  - Exposing both `strictPrecision`, `strictRecall`, `strictF1` alongside clinical safety metrics in `CaseMetrics` and `BenchmarkMetrics`.
  - Formatted ASCII summary explicitly prints `[STRICT ACCURACY METRICS (0 Errors Required)]`.
- **Tests Added:** Adversarial Test F (`Test F: wrong_surface is detected and prevents strict F1 from reaching 1.0`).
- **Verification Result:** PASS.

---

### [REMEDIATION CE-06] Cross-Type Semantic Matching & Structural Validation State
- **Finding:** `computeSemanticAffinity` returned 0 for different fact types, so `wrong_fact_type` was dead code. Also `validationState: 'invalid'` was never inspected.
- **Root Cause:** Premature zero-score cutoff in affinity calculation; omitted validationState check.
- **Change Made:**
  - In `computeSemanticAffinity`, cross-type facts sharing the same tooth target receive affinity 25, allowing them to be paired if no same-type fact exists, emitting `wrong_fact_type` (severity: `critical` if crossing invasive domains).
  - In `compareFactFields`, if `actual.validationState === 'invalid'`, `structural_validation_error` (severity: `critical`) is emitted.
- **Tests Added:** Adversarial Tests G and H.
- **Verification Result:** PASS.

---

### [REMEDIATION CE-07] CandidateClinicalFact Evaluation Runner
- **Finding:** The evaluation harness had no runner accepting untrusted `CandidateClinicalFact[]`.
- **Root Cause:** Only `evaluateCase(caseDef, actualFacts: ClinicalFact[])` was exported.
- **Change Made:**
  - Implemented and exported `evaluateCandidateCase(caseDef, candidates: ReadonlyArray<CandidateClinicalFact>)`.
  - Passes candidates through `createCanonicalClinicalFact()`.
  - Traps construction failures and emits `structural_validation_error`.
- **Tests Added:** Adversarial Test J (`Test J: evaluateCandidateCase catches malformed CandidateClinicalFact construction errors`).
- **Verification Result:** PASS.

---

### [ANATOMICAL ENHANCEMENT] Quadrant, Arch, and Soft Tissue Site Comparison
- **Change Made:** `compareFactFields` now evaluates `anatomy.quadrant`, `anatomy.arch`, and `anatomy.softTissueSite`. Inverted quadrants or arches emit `wrong_anatomy` (severity: `critical`).
- **Tests Added:** Adversarial Test I (`Test I: detects wrong_anatomy when quadrant or arch differs`).
- **Verification Result:** PASS.

---

## 3. Verification Test Suite Results

```text
TypeScript Compiler (tsc -b --noEmit):      PASS (0 errors)
Phase 4 Evaluation Tests:                   16/16 PASS (tests/clinicalEvaluation.test.ts)
Phase 3 Contract Tests:                     32/32 PASS (tests/clinicalFactContract.test.ts)
Adversarial Tests A Through J:              10/10 PASS
Deterministic Benchmark Reproducibility:    PASS (Run 1 === Run 2)
```
