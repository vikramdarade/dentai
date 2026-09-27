# DentAI — Phase 6 Exit Audit (Selective Clinical Verification)

**Document:** `docs/PHASE_6_EXIT_AUDIT.md`
**Date:** September 2026
**Scope:** Selective verification layer over canonical `ClinicalFact[]`
**Standard:** *Verification is an exception path, consumes facts and evidence only, can neither invent clinical content nor provenance, and fails closed.*

---

## 1. Executive Conclusion

### PHASE 6 EXIT STATUS: **PASS**
### PHASE 7 READY: **YES** (renderer migration may proceed; none was started)

Final verification:
- TypeScript (`tsc -b --noEmit`): **0 errors**
- Vitest: **732 passed / 0 failed** (54 files; 19 postgres skipped without `DATABASE_URL`, unchanged)
- Clinical eval (`eval:notes`): **3/3, score 1.000**
- Benchmark (`eval:benchmark`): **20/20, 0.00% WER, 100% FDI P/R, 100% pharmacology sensitivity**
- Normal-path verification frequency: **0/1000 runs** on a clean fact set
- Added normal-path latency: **~0.027 ms/run** (deterministic trigger scan only)

Entry criteria: `docs/PHASE_5_EXIT_AUDIT.md` was missing at Phase 6 start and was remediated first (written from verified Phase 5 evidence; criteria 2–8 re-proven with fresh lint/test/eval runs before any Phase 6 work began).

---

## 2. Verification Architecture

```
ClinicalFact[] ─┐
transcript ─────┤
                ▼
  [1] evaluateVerificationTriggers   (deterministic, ~0.03 ms, NO LLM)
                │ triggers.length === 0 → fast path: facts pass through untouched
                ▼ (only when triggered)
  [2] buildVerificationContext       (narrow windows: span ± 2 utterances)
                ▼
  [3] verifyFacts                    (evidence-grounded structured decisions)
                │ assertDecisionIntegrity (provenance invariant, throws)
                ▼
  [4] applyVerificationDecisions     (state machine, fail-closed, immutable clinical fields)
                ▼
  ClinicalFact[] with updated verificationState/verificationMethod only
```

Files: `src/lib/clinicalVerification/{triggers,context,verifier,factUpdater,pipeline,index}.ts` (all new; nothing existing was modified).

## 3. Trigger Matrix (18 explicit, all testable)

| Trigger | Severity | Condition (abridged) |
|---|---|---|
| `missing_evidence_high_risk` | critical | medication/allergy/diagnosis/procedure with empty evidence |
| `uncertain_speaker_attribution` | high | un-diarized transcript or `speaker: 'unknown'` |
| `low_asr_confidence` | critical (high-risk+anaesthetic) / moderate | ASR confidence < 0.60 on evidence |
| `ambiguous_tooth_number` | critical | evidence names an FDI tooth absent from fact anatomy |
| `uncertain_surface` | low | tooth finding on a tooth with no surface detail |
| `unclear_material_or_anaesthetic` | moderate | anaesthetic missing agent/technique; material missing name |
| `diagnosis_inferred_not_supported` | critical | diagnosis with `extractionMethod: 'inferred'` |
| `negation_ambiguity` | high | negation cue in evidence of a non-negated fact |
| `patient_statement_promoted_to_clinician_finding` | critical | patient speaker with clinician evidenceType |
| `procedure_status_conflict` | critical | performed but transcript signals negated/declined, or no performed speech |
| `planned_performed_ambiguity` | high | planned fact while transcript has performed treatment |
| `historical_current_ambiguity` | high | historical fact while transcript has performed treatment |
| `medication_conflict` | critical | anticoagulant/antiplatelet drug absent from transcript |
| `dose_conflict` | critical | fact dose ≠ dose spoken near the drug mention |
| `allergy_conflict` | critical | known allergen absent from transcript |
| `contradictory_facts` | critical | same fact type with both negated and asserted members |
| `conflicting_tooth_references` | critical | same finding condition attributed to multiple teeth |
| `entity_mismatch` | high | evidence utterance id absent from the transcript |

No trigger fires on fact existence alone (proven by tests 1 and 1b).

## 4. Input / Output Schemas

**Input to verifier (minimal):** per-fact evidence spans, ±2 utterances of context (`VerificationUtterance { id, sender, text, startMs?, endMs?, timingProvenance, asrConfidence? }`), deterministic triggers, and transcript status signals. The full appointment transcript is never sent; timestamps pass through only when measured.

**Output (structured only):** `VerificationDecision { factId, outcome: verified|flagged|rejected, reason, evidenceUtteranceIds, trigger }` plus `VerificationResult { decisions, undecidedFactIds, latencyMs }` and a PHI-free telemetry block `{ triggered, triggerTypes, decisionsByOutcome, latencyMs }`.

**State machine:** only `verificationState`, `verificationMethod`, `validationWarnings` may change; outcomes map `verified→verified`, `flagged→flagged`, `rejected→rejected`; `flagged`/`rejected` decisions are review-required by definition. Clinician sign-off remains `verificationMethod: 'clinician_review'` — unreachable by the pipeline.

## 5. Safety Invariants (all enforced + test-proven)

1. **No invention:** `VerificationDecision` has no clinical payload field; the state machine deep-equality-checks every clinical field and throws on mutation (tests 8, adv-9).
2. **No provenance manufacture:** decisions referencing utterances absent from the supplied context throw (`assertDecisionIntegrity`, test 9).
3. **No note production:** verifier output contains no note/section text (test 10).
4. **Fail-closed high-risk:** evidence-less medication/allergy/diagnosis/procedure can never verify — a `verified` decision is refused and downgraded (test 7).
5. **Negation safety:** evidence containing a negation cue can never corroborate a positively-asserted fact (tests 3, 3b).
6. **Patient→clinician:** blocked at the Phase 3 trust boundary (construction refuses — test 5b) and flagged by a Phase 6 defence-in-depth trigger if ever present (test 5).
7. **Planned ≠ performed / contradictions:** procedure-status triggers + Phase 5 sign-off state machine keep review-required (tests 4, 4b, adv-3).
8. **PHI-free telemetry:** serialized telemetry asserted to contain no transcript text (adv-7).

## 6. Measurements (30-utterance simulated appointment, 1000 runs each, deterministic verifier)

| Path | Verification frequency | Wall clock/run | Verifier latency/run | LLM calls added |
|---|---|---|---|---|
| Normal (clean facts) | **0/1000** | 0.027 ms | — | 0 |
| Exception (conflicted facts) | 1000/1000 (by construction) | 0.033 ms | 0.003 ms | 0 |

The verification layer is deterministic; no LLM call exists anywhere in the pipeline. A future LLM-backed verifier must reuse the same decision schema and pass `assertDecisionIntegrity`.

## 7. Tests

`tests/clinicalVerification.test.ts` — **27 tests**: the 12 mandated distinctions (normal path needs no verifier; ambiguous tooth; negation ambiguity; planned/performed conflict; patient-vs-clinician; medication conflict (+dose); missing evidence fails closed; no fact invention; no provenance invention; no note output; rejection ⇒ review-required; confirmation ≠ clinician sign-off) plus trigger-bias, trust-boundary, PHI, latency and 10 adversarial cases.

## 8. Residual Risks

1. **Decision policy is deterministic/lexical** (conservative corroboration). It errs toward `flagged`; semantically richer verification would need an LLM behind the same contract — deliberately not introduced.
2. **Trigger lexicons are curated, not exhaustive** (anticoagulants, allergens, negation cues). Unknown drug names bypass `medication_conflict` but remain covered by evidence requirements and the extraction layer.
3. **`uncertain_surface` is low-severity by design** — missing surface detail resolves to verified when evidence corroborates; raising it would over-trigger routine appointments.
4. **Diarization-dependent triggers** (`uncertain_speaker_attribution`) fire on every fact for un-diarized transcripts — correct fail-closed behaviour, but noisy until ASR diarization coverage improves.
5. **Integration seam:** the pipeline is not yet wired into `finalizeHostedNoteOutput` (facts there are still derived post-hoc from note fields); wiring it is the first step of Phase 7, where extraction produces facts natively.
6. Postgres suite and production build not executable in this environment (no `DATABASE_URL`); typecheck clean.

---

## Verdict

All 17 Phase 6 exit criteria are met. Verification is selective (0/1000 normal-path invocations), evidence-bound, invention-proof, provenance-safe, fail-closed, auditable, and PHI-free in telemetry, with ~0.03 ms added latency and zero added LLM calls. **STOP as instructed: no Phase 7 renderer work has been introduced.**
