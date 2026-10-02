# DentAI Safety Invariants (Protected Surfaces)

**Authority:** This document is the canonical definition of protected clinical surfaces for the DentAI control plane. It is referenced by `.control/agent-state.json` and every agent contract in `docs/agents/`.
**Created:** 2026-09-28 by FREEBUFF bootstrap · **Sources:** `.agents/AGENTS.md`, `PROJECT_CONTEXT.md` guardrails, `docs/FINAL_CLINICAL_SAFETY_AUDIT.md`, `docs/CLINICAL_FACT_SPECIFICATION.md`.

## 1. Protected surfaces

Agents may **not** weaken any of the following autonomously. Any change touching them requires CLINICAL_VERIFIER assessment and HUMAN_REVIEW before merge.

| # | Surface | What must never happen | Key code / tests |
|---|---|---|---|
| 1 | **Patient identity** | Resolve/merge/display history from a name match; invent a DOB; fall back to name when `patientId` missing | `src/lib/patients.ts`; `tests/patientIdentity.test.ts` |
| 2 | **Consultation identity** | Cross-consultation transcript buffer bleed; persisting `chair-active` scratchpads with completed findings | `.agents/AGENTS.md` rule 14/18; `tests/encounterSessionSafety.test.ts` |
| 3 | **ClinicalFact semantics** | Changing status×temporal matrix, FDI integrity, evidence spans, attribution, negation scope outside the spec | `docs/CLINICAL_FACT_SPECIFICATION.md`; `tests/clinicalFactContract.test.ts` |
| 4 | **Evidence / provenance** | Synthesising transcript utterances or identity data; mislabeling synthetic timing; losing `transcriptProvenance` | `.agents/AGENTS.md` rule 12/16; `tests/evalProvenance.test.ts` |
| 5 | **Grounding** | Reporting a note as verified when nothing recognisable matched; loose extraction clearing a hallucination; bare 2-digit numbers as teeth | `src/lib/transcriptGrounding.ts`; `tests/groundingVerification.test.ts` |
| 6 | **Sign-off** | Auto-signing; client-side authority without server re-validation; signing with grounding unapproved, blocking facts, or missing consent | `signOffValidation.ts`; `tests/signOffValidation.test.ts` |
| 7 | **Signed record immutability** | Mutating a signed record; append-only revision history bypass | `recordGovernance.ts` |
| 8 | **Authorization** | Governance middleware matched on `req.originalUrl`; in-memory session maps; hand-minted session tokens; missing epoch | `.agents/AGENTS.md` rules 1/10/11 |
| 9 | **Audit / seal** | Audit events without server minting on sign-off; PHI in logs/telemetry; broken hash chain | `auditChain.ts`; `tests/securityControls.test.ts` |
| 10 | **Concurrency controls** | Removing optimistic concurrency or append-only gates; bypassing SKIP LOCKED claims | `recordGovernance.ts`; `tests/postgres.test.ts` |

## 2. Additional standing clinical rules (non-exhaustive; `.agents/AGENTS.md` is authoritative)

- **Never synthesise clinical evidence or identity** — absent stays absent; a daysheet row is an appointment, not a record.
- **Contraindication supremacy** — contraindicated/avoided/refused/deferred procedures suppress generated billing and operative sections.
- **No anatomical fabrication in macro defaults** — `[Tooth #]` / `[Surfaces]` placeholders until spoken.
- **Horizon filter is a heuristic** — never document it as preserving everything; aftercare vocabulary belongs in `AFTERCARE_TRIGGER_REGEX`.
- **Clinic local time always** — `src/utils/date.ts`; never host-clock stamping.
- **Data minimisation** — raw audio deleted once transcript persisted; no "backup" of clinical voice.
- **Anti-jargon UI copy** — approved terms only (e.g. "Verified from Audio", never "100% grounded").

## 3. Change protocol

1. A change is *protected* if it edits code on any surface above or its tests.
2. The implementing agent flags it in its report (`RISKS` field) and marks the ledger/PR entry.
3. `CLINICAL_VERIFIER` must re-derive the safety argument from evidence, not from the implementer's claims.
4. `SECURITY_REVIEWER` must review surfaces 8–10.
5. Merge requires HUMAN_REVIEW. No autonomous merge path exists, ever.

## 4. Drift handling

Any observed weakening (code, test, doc) becomes a quality-ledger entry with `category: SAFETY_INVARIANT_DRIFT`, `engineeringSeverity` per impact, `clinicalRisk` assessed by CLINICAL_VERIFIER, and status `HUMAN_REVIEW` — autonomous remediation of protected surfaces is forbidden even when the fix seems obvious.
