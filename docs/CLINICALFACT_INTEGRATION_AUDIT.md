# ClinicalFact → Live Path Integration Audit

**Status:** Audit complete — no code changes made.
**Verdict:** Confirmed. The canonical ClinicalFact pipeline is lab-verified (contract tests, gold-set gate, deterministic renderer) but is **not connected to the production note path**. The live UI path runs a prose-first generation pipeline that never constructs a `ClinicalFact` in production.

---

## 1. Executive Summary

Two pipelines exist in this repository:

| | Canonical ClinicalFact pipeline | Live production path |
|---|---|---|
| **Entry** | Transcript utterances (`EvaluationTranscript`) | POST `/api/generate-notes` and `/api/notes/jobs` |
| **Extraction** | `extractBaselineFacts` / LLM candidates → `CandidateClinicalFact` | `buildNotePrompt` prose prompt (server.ts:4467 carries Rule 13 as *prompt text only*) |
| **Trust boundary** | `createCanonicalClinicalFact` (deterministic, fail-closed) | `normalizeTemplateOutput` (schema shape only, no clinical invariants) |
| **Validation** | `validateClinicalFactInvariants` (status×temporal, FDI, anti-fabricated-timestamp) | `verifyTranscriptGrounding` + `appendContradictionFlags` (string-level) |
| **Verification** | `runSelectiveVerificationPass` (fail-closed, payload-free decisions) | `groundingReport` flags surfaced as a badge |
| **Rendering** | `renderClinicalNote(facts)` — monotonic: *a missing fact renders as a missing line, never as invented content* | `finalizeHostedNoteOutput` passes LLM prose through verbatim |
| **Consumers** | `scripts/phase10-audit-probe.ts`, `scripts/phase11-e2e-flow.ts`, 130+ tests | `ChairsideWorkspace.tsx` → `ClinicalNoteEditorPanel` → PMS export |

The canonical pipeline has **zero imports in `src/components/`**. The only trace of it on the live path is a dead metric branch: `server.ts:1618` checks `Array.isArray(output.facts)` — but no code path ever asks a model to emit facts, so `recordCaseWithFacts()` never fires in production.

The repository's own audits agree: `docs/PHASE_6_EXIT_AUDIT.md` flagged the integration seam ("facts there are still derived post-hoc from note fields"), and `docs/CLINICAL_EVALUATION_REPORT.md` lists "wire the production transcript → ClinicalFact extraction layer" as an open item.

---

## 2. Lab-Verified Inventory (what Antigravity is praising)

All of the following exist, are deterministic, and are covered by tests:

| Artifact | Role | Guardrails |
|---|---|---|
| `src/types/clinicalFact.ts` | Discriminated `ClinicalFact` union, `FactValueTypeMap`, `validateClinicalFactInvariants` | Status×temporal compatibility, FDI integrity, anti-fabricated-timestamp rules |
| `src/lib/clinicalFactMigration.ts` | `createCanonicalClinicalFact` trust boundary; `adaptFactsToLegacyFindings` / `adaptLegacyFindingsToFacts` | Construction failures are typed results, never partial facts |
| `src/lib/factRenderer.ts` | `renderClinicalNote(facts)` → `RenderedClinicalNote` | Monotonicity: no clinical defaults, no invention; attribution, negation, temporality, FDI preserved |
| `src/lib/clinicalVerification/` | `runSelectiveVerificationPass(facts, transcript, input)` | Trigger matrix, conservative evidence-bound policy, `assertDecisionIntegrity` unconditional |
| `src/lib/clinicalEvaluation/` | Evaluator, `extractBaselineFacts`, Phase 8 runner | 16-point error taxonomy, 4-tier severity, regression fixtures as a **hard gate** (`npm run eval:gold-set` exits 1) |
| `tests/clinicalFactContract.test.ts`, `tests/factRenderer.test.ts`, `tests/clinicalVerification.test.ts`, `tests/negationScope.test.ts`, `tests/goldSetEvaluation.test.ts` | Contract coverage | 132 test files detected in repo |

---

## 3. The Live Path, Traced

```
ChairsideWorkspace.tsx:2234  POST /api/generate-notes        (Tier 1, sync)
ChairsideWorkspace.tsx:2264  POST /api/notes/jobs            (Tier 2, queue + 25s poll)
        │
        ▼
server.ts:1326 runHostedGeneration
  ├─ provider 'macro' → generateMacroNote (deterministic, but NOT fact-based)
  ├─ OpenAI-compatible (Groq / Ollama) → prose prompt
  └─ Gemini Vertex → dev key → secondary key → OpenAI failover
        │  prompt built by buildNotePrompt: prose sections, Rule 13 as text
        ▼
server.ts:1554 finalizeHostedNoteOutput
  ├─ verifyTranscriptGrounding (string-level, not fact-level)
  ├─ appendContradictionFlags (flag-only)
  ├─ verifyNoteGrounding (unified audit)
  └─ server.ts:1618  `if (Array.isArray(output.facts) …)` ← DEAD: nothing emits facts
        │
        ▼
ChairsideWorkspace.tsx:2342  updatedFindings: 8 legacy ClinicalFindings fields
        ▼
Consultation record → ClinicalNoteEditorPanel (groundingBadge) → PMS clipboard/export
```

Nothing in this chain constructs a `ClinicalFact`. The `updatedFindings` mapping at ChairsideWorkspace.tsx:2342 consumes raw prose sections with `||` fallbacks — the note text **is** the primary data model on the live path, which is precisely what Phase 7's exit criterion ("the note is a rendering, not the data model") was meant to eliminate.

---

## 4. Integration Plan (Phase 13): Three Seams

### Seam 1 — Extraction (server, `runHostedGeneration`)

Refactor the model contract from prose sections to structured `CandidateClinicalFact[]`:

- Prompt requests the canonical schema (type, value per `FactValueTypeMap`, status, temporality, FDI anatomy, evidence spans referencing utterance ids). Rule 13 becomes *schema-enforced* rather than *prompt-asked*.
- Every candidate passes through `createCanonicalClinicalFact` **server-side**. Construction failures are counted (`llmMalformedFact` metric, PHI-free) and dropped, never coerced.
- The deterministic macro path already has a native fact source: `extractBaselineFacts` — route it through the same boundary instead of `generateMacroNote`'s prose output.
- Provider variance is the risk here (Groq/Ollama schema adherence). Mitigation: run the gold-set gate per provider; the Phase 8 harness is deliberately model-agnostic.

**Exit criteria:** every provider path emits validated facts; gold-set extraction cases (the currently-missing piece per `CLINICAL_EVALUATION_REPORT.md`) score against live-shaped output.

### Seam 2 — Rendering & Validation (server, `finalizeHostedNoteOutput`)

- Run `runSelectiveVerificationPass(facts, transcript)` then `renderClinicalNote(validatedFacts)`.
- Project to the legacy payload via `adaptFactsToLegacyFindings` so `ChairsideWorkspace.tsx`, PMS export, and existing persistence keep working unchanged during migration.
- Persist `output.facts` (canonical, with verification state) on the consultation record for the UI and audit chain.
- Fail-closed rule: if no facts survive validation, the note renders empty + flagged — prose is never silently trusted.
- **Stage A (shadow mode):** compute, verify, persist, and *audit* facts while the prose note remains the displayed authority. Compare prose vs rendered output PHI-free (drift metrics only). Switch displayed authority to the rendered note (Stage B) only after shadow metrics are clean. `NOTE_RENDERING_CONTRACT.md` already declares the renderer authoritative — this makes it true in production.

### Seam 3 — UI (client, `ChairsideWorkspace` + `ClinicalNoteEditorPanel`)

- Consume `payload.facts` when present: per-fact verification state surfaced in the editor panel (Phase 6's selective-verification UI contract: verify/reject with decisions applied only through `applyVerificationDecisions`).
- Legacy consultations lift on load via `adaptLegacyFindingsToFacts` (tested, marks `extractionMethod: 'normalized'`).
- The sign-off gate consumes fact verification state; `groundingBadge` becomes fact-derived once Stage B lands.

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| Structured extraction quality regression vs prose | Gold-set gate per provider; regression fixtures already a hard exit-1 gate |
| Latency of schema-bound generation | Transcript compaction already enforced server-side; measure `extraction` stage (Phase 9 metrics exist) |
| Double representation drift (facts vs prose) during Stage A | Prose stays authoritative until shadow metrics clean; renderer switch is a flag |
| Legacy records without facts | `adaptLegacyFindingsToFacts` lifts deterministically; no backfill needed to ship |
| Job-queue payload growth (facts are PHI-bearing) | Facts live in the consultation record per Phase 9 retention policy; queue payloads keep ids only |
| PMS auto-copy rendering from legacy fields | Switch to rendered note text when Stage B activates |

## 6. Acceptance Criteria

1. `npm run eval:gold-set` green **including** transcript→facts extraction cases from a live-shaped payload.
2. New integration test: `runHostedGeneration → finalizeHostedNoteOutput` round-trips validated facts and renders a note identical to the fact set (monotonicity holds on live path).
3. New UI test: editor panel renders verification state and rejects/verifies through the decision pipeline only.
4. `phase12-rollback-check` extended: flag-off restores legacy prose behavior exactly.
5. `pipelineMetrics.recordCaseWithFacts()` fires on real traffic (the currently-dead branch becomes meaningful).

---

*Prepared as a read-only audit. No production code was modified.*
