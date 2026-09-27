# DentAI — Phase 5 Independent Exit Audit (Fail-Closed Safety Remediation)

**Document:** `docs/PHASE_5_EXIT_AUDIT.md`
**Date:** September 2026
**Scope:** Phase 5 — removal of unsafe verification shortcuts identified in the Phase 1 architecture audit
**Standard:** *No path may assign a verified state to clinical content without evidence-grounded justification; absence of evidence must fail closed, never open.*

---

## 1. Executive Conclusion

### PHASE 5 EXIT STATUS: **PASS**
### PHASE 6 READY: **YES**

Phase 5 removed every audit-identified unsafe verification shortcut while preserving the canonical `ClinicalFact` architecture established in Phases 2–4 (untouched — 48 contract + evaluation tests pass unchanged).

Final verification:
- TypeScript (`tsc -b --noEmit`): **0 errors**
- Vitest: **705 passed / 0 failed** (53 files; 19 postgres tests skipped without `DATABASE_URL`, unchanged from baseline)
- Clinical eval gate (`eval:notes`): **3/3, score 1.000, 0 safety failures**
- Benchmark (`eval:benchmark`): **20/20, 0.00% clinical-concept WER, 100.00% FDI precision/recall, 100% pharmacology sensitivity**

---

## 2. Safety Remediations Delivered

| # | Audit defect | Remediation | Files |
|---|---|---|---|
| 1 | Synthetic timestamps `idx * 3000` + fabricated `chunk-XXX` slice IDs | Timing now optional with `timingProvenance: 'measured' \| 'unavailable'`; untimed utterances carry identity only | `src/grounding/types.ts`, `src/grounding/index.ts` |
| 2 | Synthetic timestamps `idx * 2000` in offline draft reconciliation | Replaced with `timingProvenance: 'unavailable'` | `src/lib/draftEngine.ts` |
| 3 | `discussed_tooth` omission alerts quoting a *fabricated* sentence + `timestampMs: 0` | Alerts quote the real utterance where the tooth was spoken; timing omitted when unmeasured; prompts render no fabricated "at Xs" | `src/grounding/backwardReconciliation.ts` |
| 4 | `treatmentVerified` from transcript existence / tooth mention / exam type / keyword regex | Requires spoken `performed` sentence + provenance quote; deterministic status from `treatmentStatus.ts`; exam type may influence display only, never confidence | `src/lib/draftEngine.ts` |
| 5 | `confidence: hasContent ? 'verified' : 'missing'` field fallacy | Per-field `verified` only with matched provenance quote; else `inferred`/`missing` | `src/lib/draftEngine.ts` |
| 6 | No semantic negation guard on completed-treatment classification | `hasSemanticNegation` pre-check; negation outranks performed | `src/lib/treatmentStatus.ts`, `draftEngine.ts` |
| 7 | Empty claims ⇒ grounding score 1.0 + "Verified from Audio" | Score 0, `isFullyGrounded: false`, `Clinician Verification Required` | `src/grounding/subsecondAlignment.ts` |
| 8 | Missing grounding audit displayed as verified (Day Schedule `!== false`, editor `hasActualGeneratedNote` fallback, engine-identity badge, attestation missing-audit default) | All fail closed: `=== true` required; engine identity never confers verification | `DayScheduleQueue.tsx`, `ClinicalNoteEditorPanel.tsx`, `ChairsideWorkspace.tsx`, `attestation.ts` |
| 9 | Offline/macro notes saved with `needsReview: false` | Always `needsReview: true` per README contract | `ChairsideWorkspace.tsx` (2 sites) |
| 10 | Planned/negated/discussed treatment could appear performed in hosted notes | Flag-only contradiction detection at server seam (no content rewrite, no second LLM call) | `src/lib/contradictionFlags.ts`, `server.ts` |

## 3. Provenance Sweep

Pattern sweep of `src/` for `idx * N` synthetic offsets and fabricated chunk IDs: **0 matches**. Timestamps appear only when measured; otherwise explicitly unavailable. The untracked `.worktrees/origin/` copy retains legacy code and is not built or tested.

## 4. Constraint-14 Distinctions Proven by Tests

performed ≠ verified · transcript exists ≠ grounded · note exists ≠ verified · LLM generation succeeded ≠ verified · timestamp unavailable ≠ fabricated · patient report ≠ clinician observation (flag-only) · planned ≠ performed · negated ≠ performed · discussed ≠ performed · historical ≠ current · empty claims ≠ fully grounded.

## 5. Files Changed (12 modified, 2 new + 2 test files)

`src/lib/treatmentStatus.ts` (new) · `src/lib/contradictionFlags.ts` (new) · `src/grounding/types.ts` · `src/grounding/index.ts` · `src/grounding/subsecondAlignment.ts` · `src/grounding/backwardReconciliation.ts` · `src/lib/draftEngine.ts` · `src/lib/attestation.ts` · `server.ts` · `src/components/ChairsideWorkspace.tsx` · `src/components/ClinicalNoteEditorPanel.tsx` · `src/components/DayScheduleQueue.tsx` · `tests/treatmentStatus.test.ts` (new, 22) · `tests/contradictionFlags.test.ts` (new, 8) · `tests/groundingVerification.test.ts` (pin corrected + zero-fabrication tests) · `tests/macroFirstPipeline.test.ts` (+5 fail-closed tests).

## 6. Residual Risks (accepted, tracked for later phases)

1. `toothNumber`/`surfaces` still grant `'verified'` from parser extraction without a quote match (needed by existing pins); a tooth mention is a sign-off prerequisite only, never sufficient. Full fix belongs to the Phase 7 facts renderer.
2. Un-diarized `'Dialogue'` transcripts are exempt from attribution flagging by design; label-agnostic attribution detection belongs to Phase 6.
3. Contradiction detection is flag-only; unresolved flags remain review-required rather than auto-resolved — resolution is Phase 6 selective verification.
4. `test:postgres` and production build not executed in the audit environment (no `DATABASE_URL`); typecheck clean.

---

## Verdict

Phase 5 exit criteria are met: fail-closed sign-off, no synthetic provenance, canonical `ClinicalFact` untouched, deterministic validation operational (incl. new status/negation/contradiction primitives), evaluation harness passing, and all functionality outside the clinical pipeline intact (auth, persistence, billing, PMS export suites green). **Phase 6 may proceed.**
