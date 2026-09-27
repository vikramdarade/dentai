# DentAI — Final Independent Clinical Safety & Architecture Audit (Phase 10)

**STATUS: `ARCHITECTURALLY COMPLETE`** (re-audit after remediation; original verdict was `NOT COMPLETE`)
**Re-audit date:** 2026-09-27 · **Original audit:** same document, preserved below for traceability.
**Remediation record:** `docs/PHASE_10_REMEDIATION_REPORT.md`.
**Auditor stance:** independent; every remediation was re-verified against the repository and live behaviour — the remediation report was treated as a claim, not a fact.

---

## Re-audit verification (post-remediation)

Each defect was re-checked in code and at runtime, not taken from the report:

| Item | Re-audit evidence | Verdict |
| --- | --- | --- |
| **B-1** macro fabrication | All 20 template generators replaced by one shared evidence-gated builder; repo grep for the audited phrases (`non-restorable`, `chronic apical`, `irreversible pulpitis`, `verbal informed consent`, `adequate anaesthesia`, `Bone gutter created`, `socket inspected`, `patient verbalised`, …) inside `australianClinicalMacros.ts` hits **only the guard's own forbidden-pattern list**. Load-time guard `assertMacroStructural` executes on import (verified live: 20 templates import cleanly) and **demonstrably throws on fabrication** — during the remediation it rejected the pre-fix templates across 10 test suites before the rewrite was complete. `generateMacroNote` output = structure + spoken evidence + notices only. | **PASS** |
| **B-2** recall default | `grep "6 Months"` over `server.ts` + `src/` (excluding fixtures): **zero hits**. Worker, `App.tsx` and `DayScheduleQueue.tsx` all persist/leave empty. Durable-path regression test asserts `recallRequirements === ''`. | **PASS** |
| **F-1** offline boilerplate | `generateOfflineDraft` verified evidence-only (verbatim filtered sentences, per-section gates); 4 templates × 3 sparse scenarios scanned with the boilerplate vocabulary — zero hits; evidence-preserved control still extracts complaint/tooth/treatment verbatim. | **PASS** |
| **F-2** eval provenance | `timingProvenance` union now includes `'synthetic'`; `toTimestamped` labels fixture timing synthetic, never synthesizes `endMs`; 4-test regression suite pins the contract. | **PASS** |
| **F-3** extractor negation | "No pain at the moment" now yields a `negated` symptom with `negationScope` at the extractor itself; `deny/denies` added to the vocabulary; tooth-finding branch carries `negationScope`. 9-test regression suite passes; positive controls confirm no over-negation. | **PASS** |
| **F-4** server-side sign-off | `POST /api/consultations/:id/sign` + `signOffValidation.ts` verified: ownership-scoped load, version check, replay/nonce guard, empty-note guard, fail-closed grounding re-evaluation (`isApprovedForSigning !== true` blocks), blocking fact states, consent gate, **server-minted** seal, audited refusals. 12 security tests cover every mandated unsafe attempt. | **PASS** |
| **F-5** quantity conversion | Parser preserves spoken `cartridges: 1`; `volumeMl` only from an explicitly spoken mL figure; renderers show the spoken count. Both directions regression-tested. | **PASS** (omission of derived volume, per remediation preference) |
| **Macro coverage** | `tests/macroSparseTranscript.test.ts`: **202 tests** — 20 templates × 10 scenarios (sparse, findings-only, treatment-only, negated, patient-only, planned, no-consent, no-anaesthetic, no-material, no-recall) + patient-only promotion guard + template-count check. Scans use the same `FORBIDDEN_WITHOUT_EVIDENCE` list the load-time guard enforces (suite and runtime cannot drift). | **PASS** |
| **Adversarial probe** | `scripts/phase10-audit-probe.ts` re-run post-remediation: **ALL CHECKS PASSED** (was 39/40; the F-3 fix closed the negation check). | **PASS** |

### Post-remediation verification battery (fresh runs)

- `npm run lint` / `tsc --noEmit`: clean.
- Full Vitest: **1067 passed / 19 skipped (postgres) / 0 failed**, 64 files.
- eval:notes 3/3 (1.000, 0 safety failures) · eval:benchmark 20/20 FULLY SATISFIED · eval:gold-set 217 cases, **0 critical-error ledger entries**, regression ALL PASS, metrics byte-identical across two runs (F1 53.1%, untouched per F-6).
- Repo-wide clinical-default sweep: re-run; **no unresolved unsafe production default** (full classification table in the remediation report).

### Documented release-environment gap (not a defect)

19 PostgreSQL tests skip because `DATABASE_URL` is unavailable in this environment. The suite is complete only where a production-like database is configured; JSON-fallback paths are fully exercised here. This must be closed in a database-enabled environment before release — it is an environment gap, not an architectural one.

---

## Completion conditions — re-audit verdict

All 30 conditions of the original audit now hold. The three that failed are re-verified as follows:

- **8. Unsupported defaults are eliminated** — PASS (B-1/B-2/sweep; macro output now evidence+structure+notices only).
- **26. No known critical safety defect remains open** — PASS (B-1 and B-2 eliminated and regression-guarded by the load-time fabrication contract and the 202-case macro matrix).
- **30. No Phase 5–9 exit criterion has been bypassed** — PASS (the refuted Phase 7 macro-safety claim is now true: the templates satisfy NOTE_RENDERING_CONTRACT §2/§5 as remediated).

Conditions 1–7 and 9–29 re-verified unchanged (canonical ClinicalFact model, evidence spans, FDI/status×temporal validation, deterministic validation, selective verification, monotonic fact rendering, attribution, negation, temporality, planned/performed, evidence-bound medications, hallucination controls, fail-closed sign-off — now also server-gated — safe offline/provider failure, PHI-free observability, complete audit chain, repeatable gold set, measured critical errors, regression suite, full suites green, no hidden shortcuts in any direction).

---

## Residual risks & limitations (accepted, non-blocking)

- Hosted LLM path remains a Rule-13-bound verbaliser over narrative output, gated by grounding + contradiction flags + fail-closed (now server-side) sign-off; the canonical fact path does not yet feed it.
- Gold-set F1 53.1% / surface 25.6% / diagnosis 1.1% reflect the deliberately conservative extractor (omission-biased — the safe direction). Macro output is no longer measured by accuracy metrics because it asserts nothing beyond spoken evidence; the macro matrix measures fabrication instead.
- Sign-off seal remains client-visible as an integrity mechanism; authority now sits with the server gate (F-4 closed).
- Postgres test coverage requires a database-enabled environment (gap above).

## Blockers

**None.** The exact list from the original audit (B-1, B-2) is closed with regression protection; F-1–F-6 are resolved as detailed above.

---

# Original audit (verdict `NOT COMPLETE`) — preserved

**Auditor stance:** independent; every prior phase exit report treated as a claim and re-verified against the repository and live runtime behaviour. No features were implemented during this audit.
**Date:** 2026-09-27 · **Method:** code inspection of every safety seam, fresh full test/eval runs, and adversarial transcripts executed against the real extraction → verification → rendering pipeline (`scripts/phase10-audit-probe.ts`, retained as audit evidence).

## Architecture verdict (original)

The **canonical fact pipeline is real, sound, and safe**: ClinicalFact is a discriminated assertion model with evidence spans, a status×temporal compatibility matrix, FDI metadata integrity, and anti-fabricated-timestamp rules; deterministic validation, selective verification (fail-closed, payload-free decisions), and the fact renderer are wired and tested; sign-off was fail-closed client-side and nothing auto-signed.

However, the audit **refuted one core Phase 7 claim**: the extraction-family macro templates (`src/lib/australianClinicalMacros.ts`) fabricated diagnoses, findings, consent attestations and a default anaesthetic — in a path reachable from both the server's deterministic provider and the chairside UI. The Phase 7 exit audit's "remaining 17 templates are proven-safe by construction" was **not true for the surgical/simple-extraction family**. Because the mandated evaluation suites never executed these templates, the defect was invisible to every gate that currently passed. *(Remediated — see re-audit above.)*

## Data flow (as actually wired, verified in code)

```
Audio ──► /api/beacon upload (chunk store, caps) ──► ASR (createAudioTranscriber,
│           inline ≤10MB / Files API, timeouts, provider-side delete)      │
│                                                                         ▼
│                              diarized transcript (+provenance: chunks, gaps,
│                              speakerCounts, warnings; partial ASR flagged)
│                                                                         │
│            ┌───────────────────────────────────────────────────────────┤
│            ▼                                                           ▼
│  CANONICAL FACT PATH (authoritative)                    HOSTED LLM PATH (verbaliser)
│  extractBaselineFacts → CandidateClinicalFact           prompt bound by Rule 13:
│  → createCanonicalClinicalFact (trust boundary,           "only express facts supported
│    validates status×temporal, FDI metadata,               by the transcript… empty section
│    timestamps, confidence)                                is safer than an invented one"
│  → deterministic validation                              → normalizeTemplateOutput
│  → selective verification (trigger matrix;               → finalizeHostedNoteOutput:
│    verifier decisions carry NO clinical payload;           verifyTranscriptGrounding +
│    critical triggers always flag; provenance               contradiction flags (flag-only) +
│    integrity asserted)                                     verifyNoteGrounding (label only)
│  → renderClinicalNote (monotonic: facts→note,            (MACRO PATH, remediated:
│    no clinical knowledge inside)                          structure + spoken evidence
│            │                                              + notices; load-time guard)
│            ▼                                                           │
│              clinician review / correction (recordGovernance: append-only
│              revisions, consent append-only, optimistic concurrency)
│                             │
│                             ▼
│              SIGN-OFF: client-held SHA-256 seal (integrity) + SERVER-SIDE
│              REVALIDATION GATE (F-4): ownership, version, content hash,
│              grounding approval re-evaluated fail-closed, blocking fact
│              states, consent; server mints seal + audit event
│                             │
│                             ▼
│              hash-chained audit trail (auditChain.ts) + PHI-free telemetry
```

**No hidden transcript→note, note→verification, or engine-identity→verification shortcut exists** — re-verified in the re-audit (the remediation added none).

## Audit results (original run — all twelve executed independently)

| # | Audit | Result |
|---|---|---|
| 1 | Data flow | **PASS** — canonical pipeline verified end-to-end; shortcut hunt clean. |
| 2 | Hallucination | **PASS with one qualifier** — live probes: zero invented facts from findings-only/vague transcripts. Qualifier: macro templates fabricated (B-1, now remediated). |
| 3 | Negation | **PASS on the safety-critical direction** — zero positive-from-negation conversions; explicit negatives preserved ("No caries. #36."). Defect found: patient "No pain" yielded a positive symptom fact, mitigated by verification flags. *(F-3 remediated at the extractor.)* |
| 4 | Attribution | **PASS** — patient/assistant statements never promoted; history vs performed correctly separated. |
| 5 | Temporality | **PASS** — historical/current/planned/completed-today preserved; "today" rule deterministic; matrix blocks impossible states. |
| 6 | Dental anatomy | **PASS** — invalid FDI refused; age/dose never became teeth; exclusion context honoured; all references valid ISO 3950. |
| 7 | Provenance | **PASS on runtime; one measurement-tool defect** (F-2 mislabeled synthetic timing, now remediated). |
| 8 | Verification | **PASS** — selective invocation, payload-free decisions, provenance integrity asserted, critical triggers always flag, no auto-anything. |
| 9 | Renderer | **PASS for the fact renderer; FAIL for the platform** on macro templates (B-1, remediated) and recall default (B-2, remediated). |
| 10 | Sign-off | **PASS (fail-closed)**; gap: client-side authority without server re-verification (F-4, now closed server-side). |
| 11 | Failure modes | **PASS** — all mandated modes fail safely (re-executed fresh). |
| 12 | Evaluation | **PASS on structure, honest on results**; gap: no macro-template coverage (now added: 202 tests). |

## Critical error results (original gold-set run — unchanged by remediation, per F-6)

217 cases (17 adversarial, 5 regression) · 0 critical-error ledger entries · regression ALL PASS · F1 53.1% (conservative) · eval:notes 3/3 · eval:benchmark 20/20.

## Test & evaluation results (original)

lint/tsc clean · 824 passed / 19 skipped / 0 failed · all three eval gates green.

## Safety invariants — original verdicts

1–7, 9–25, 27–29 **TRUE**; 8 **FALSE**; 26 **FALSE**; 30 **FALSE** (B-1/B-2). *(All now TRUE per re-audit.)*

## Original blockers (preserved for traceability)

**B-1 (CRITICAL):** macro templates fabricated diagnoses, findings, anaesthetic defaults, sutures/haemostats, consent attestations and patient-understanding claims in a server- and UI-reachable path, passing through `templateGenerator` unsanitized — invisible to every eval gate. **Remediated.**

**B-2 (HIGH):** `recallRequirements || '6 Months (Standard)'` invented a recall plan in the durable worker record. **Remediated** (three instances total).

**Non-blocking findings:** F-1 offline boilerplate *(verified absent)*, F-2 harness provenance *(fixed)*, F-3 extractor negation scope *(fixed)*, F-4 client-side sign-off authority *(server gate added)*, F-5 cartridge→mL conversion *(omitted; spoken count preserved)*, F-6 metrics *(deliberately untouched)*.

---

## Verdict

**`ARCHITECTURALLY COMPLETE`.** Every blocker and finding from the original audit is remediated with regression protection; all 30 completion conditions hold; no critical blocker remains. Release/staging work may proceed once the documented environment gap (Postgres-enabled test run) is closed in the target environment.

*Audit artifacts: `scripts/phase10-audit-probe.ts` (ALL CHECKS PASSED), `tests/macroSparseTranscript.test.ts` (202 tests), `tests/signOffValidation.test.ts` (12), `tests/negationScope.test.ts` (9), `tests/evalProvenance.test.ts` (4), `tests/recallAndOfflineDefaults.test.ts` (14), load-time macro fabrication guard in `src/lib/australianClinicalMacros.ts`.* Stop.
