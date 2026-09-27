# Phase 10 Remediation Report — Eliminating Remaining Clinical-Content Bypasses

**Date:** 2026-09-27
**Input:** `docs/FINAL_CLINICAL_SAFETY_AUDIT.md` (Phase 10 independent audit, verdict **NOT COMPLETE**)
**Scope:** Remediate blockers B-1/B-2 and findings F-1–F-5, add full macro adversarial coverage and server-side sign-off revalidation, run the mandated repository-wide clinical-default search, then re-run the independent audit.
**Rule observed:** the canonical ClinicalFact architecture was preserved — no redesign; only the audited defects were removed.

---

## Remediation summary

| Item | Status | Where |
| --- | --- | --- |
| B-1 macro fabrication | **ELIMINATED** | `src/lib/australianClinicalMacros.ts` (rewritten) + load-time fabrication guard |
| B-2 recall default | **ELIMINATED** | `server.ts` worker + `src/App.tsx` + `src/components/DayScheduleQueue.tsx` |
| F-1 offline boilerplate | **ELIMINATED (verified absent)** | `generateOfflineDraft` proved evidence-only by regression suite |
| F-2 eval provenance | **FIXED** | `phase8Runner.toTimestamped` + `src/grounding/types.ts` ('synthetic' provenance) |
| F-3 extractor negation | **FIXED** | `deterministicExtractor` + `treatmentStatus` ('deny') + regression suite |
| F-4 server-side sign-off | **CLOSED** | `src/server/signOffValidation.ts` + `POST /api/consultations/:id/sign` + 12 security tests |
| F-5 quantity conversion | **RESOLVED (omission preferred)** | `clinicalEntityParser` preserves spoken cartridges; derived mL removed |
| Macro coverage | **ADDED — 202 tests** | `tests/macroSparseTranscript.test.ts` |
| Repo-wide search | **COMPLETE — 0 unresolved unsafe** | see classification below |

---

## B-1 — Macro templates: fabrication eliminated, contract enforced

All **20** template generators (the file ships 20 families, not 18; all covered) were replaced by a single shared evidence-gated builder. Every generator now:

- renders **only** variables extracted from spoken evidence by `parseClinicalEntities` (teeth, surfaces, spoken LA fields, spoken material brands, spoken ADA codes, spoken canals count);
- emits an **empty string** for any field without validated evidence (diagnosis, findings, history, complaint, recall);
- reports missing data through `missingProtocolNotices` (diagnosis completion, consent-not-heard, aftercare-not-heard, chief-complaint, history, findings);
- contains **zero** hard-coded diagnoses, findings, symptoms, treatments, teeth, surfaces, medications, doses, anaesthetic agents/concentrations/volumes, materials, shades, sutures, haemostats, consent attestations, patient-understanding claims, risk discussions, post-operative prose, recall intervals or clinical outcomes.

Consent and aftercare receive notices when absent, but even when *spoken* the templates render only the neutral fact (`Post-operative instructions provided (spoken).`) — the attestation language remains the clinician's.

**Runtime enforcement (cannot regress silently):** `assertMacroStructural` executes every template at module load against an EMPTY evidence set and a provenance set, and throws on import if a template emits unsourced clinical vocabulary (`FORBIDDEN_WITHOUT_EVIDENCE` — the authoritative exported pattern list), an unspoken tooth, or an unspoken ADA code. Importing the module proves the contract.

**Server path:** `generateMacroNote` output now consists solely of spoken evidence + structure + notices; it can no longer introduce clinical content that bypasses fact validation because there is nothing left to bypass. The deterministic provider remains enabled on this basis (the "disable the provider" fallback was not needed).

**Chairside UI:** `CHAIRSIDE_MACRO_OPTIONS` retained as a structural shortcut only; the shared builder guarantees selection cannot create unsupported clinical content.

## B-2 — Recall default removed everywhere it existed

- `server.ts` worker: `recallRequirements || '6 Months (Standard)'` → `recallRequirements || ''` (absent stays absent in the durable record).
- Sweep found two more instances of the same class, also fixed: `src/App.tsx` new-consult default and `src/components/DayScheduleQueue.tsx` `nextVisit: jobResult.nextVisit || '6 Months Recall'` (plus the adjacent invented `'Maintain regular oral hygiene.'` post-op default). Regression-tested via the durable worker path.

## F-1 — Offline drafts: proven evidence-only

Inspection + regression: `generateOfflineDraft` fills sections only with **verbatim transcript sentences** passing per-section gates (completed-action verbs for treatment, non-inquiry for findings, non-disclaimer for diagnosis); it synthesizes no prose. The boilerplate the audit cited lived in the macro templates (removed with B-1). Sparse-transcript scans across 4 templates × 3 sparse scenarios find **zero** fabricated assertions; the evidence-preserved control case still extracts patient complaint, tooth and treatment verbatim.

## F-2 — Evaluation provenance honesty

- `TimestampedUtterance.timingProvenance` union extended to `'measured' | 'unavailable' | 'synthetic'`.
- `phase8Runner.toTimestamped` now labels fixture timing `'synthetic'`, passes `endMs` through **only** when the fixture supplied it, and never synthesizes the former `+3000 ms` span; untimed fixtures stay `'unavailable'`.
- `tests/evalProvenance.test.ts` (4 tests) pins the contract; `docs/GOLD_SET_SPECIFICATION.md` semantics unchanged — the harness measures the same pipeline, now with honest labels.

## F-3 — Negation scope fixed at the extractor

- Patient symptom branch: `hasSemanticNegation(text)` now sets `status: 'negated'` (+ `negationScope`) instead of a positive symptom — "No pain at the moment" can no longer yield `symptom(pain)` as `reported`.
- Clinician gingival branch: same fix ("no bleeding on probing" cannot become a positive periodontal finding).
- Clinician tooth-finding branch: carries `negationScope` when negated (status handling pre-dated the fix).
- `treatmentStatus`: negation vocabulary extended to first-person `deny/denies/denied/denying`.
- `tests/negationScope.test.ts` (9 tests): negated forms of pain/sensitivity/caries/swelling/bleeding (incl. "denies …") are distinguishable from positives, positive controls still extract as `observed` (no over-negation).

## F-4 — Server-side sign-off revalidation (client no longer authoritative)

New `src/server/signOffValidation.ts` + `POST /api/consultations/:id/sign`:

1. ownership-scoped load (cross-owner ⇒ `not_found`);
2. optimistic concurrency (`expectedVersion` mismatch ⇒ 409 `stale_version` + server copy);
3. replay guard: already-signed records and consumed request nonces ⇒ 409 `replay`;
4. empty-note guard;
5. grounding/approval conditions **re-evaluated server-side**, fail-closed (`grounding_not_approved`);
6. blocking fact verification states (`flagged`/`rejected`) ⇒ `verification_blocking_state`;
7. consent required on transcript-bearing records;
8. seal **minted server-side** (client never supplies it), self-verified, audited via `consultation_signed_off` on the hash-chained audit log; every refusal emits its own audit event.

`tests/signOffValidation.test.ts` (12 tests) attempts exactly the mandated unsafe cases — unverified, contradictory/flagged facts, stale version, modified note, offline-style empty content, missing consent, after-correction re-sign, replay, duplicate sign-off, cross-owner — all fail safely.

## F-5 — Spoken quantity preserved, derived volume omitted

`parseClinicalEntities` no longer converts "one cartridge" → `2.2 mL`. The spoken count is preserved as `cartridges: 1`; `volumeMl` is set **only** from an explicitly spoken millilitre figure. Renderers show `1 cartridge(s)` — a spoken quantity — never a computed volume presented as spoken. Regression-tested both ways (cartridge → no `volumeMl`; spoken mL → kept).

## F-6 — Metrics untouched

No evaluation definition was changed. Gold-set numbers are byte-identical to the audit's fresh run (F1 53.1%, omission 49.9%, hallucination 43.5%, surface 25.6%, diagnosis 1.1%, ledger 0). Repeatability re-confirmed: two consecutive runs produced identical metrics.

---

## Repository-wide clinical-default search (mandated terms)

Every occurrence classified; result: **no unsafe production default remains.**

| Term | Classification |
| --- | --- |
| Articaine / Lignocaine / adrenaline / 2.2 / A3 / Prolene / Gelatemp | (1) fixtures & lexicons (`benchmark/goldenSet.ts` transcripts+expectations, `clinicalEvaluation/corpus.ts`), (2) detection vocabulary (`subsecondAlignment` drug list, parser brand map, macro keywords), (3) guard patterns (`FORBIDDEN_WITHOUT_EVIDENCE`), (4) guard test fixture `UNRELATED_VARS` (spoken evidence in the provenance run). Template prose eliminated. |
| informed/verbal consent | LLM prompt instructions (Rule 7/8: "never invent…"), grounding gate messages, UI consent-capture labels (real consent actions, not assertions). Template attestations eliminated. |
| understood / reviewed with patient | 0 production occurrences remain. |
| postoperative | Fact-type taxonomy + gold-set expectations (type names), not content. |
| 6 Months | **Was unsafe — fixed** in all three locations (worker, App.tsx, DayScheduleQueue.tsx). Remaining hit: `benchmark/goldenSet.ts:215` fixture transcript ("healed for 6 months") = valid fixture. |
| non-restorable / chronic apical / periapical / gross caries / TTP | Guard patterns, fixtures, prompt examples (Rule 10 sample note text), template-field *placeholders* for clinicians (empty-string defaults, clinician-completed). |
| recall | Guard patterns, engine keywords (detection only), fixture mentions. Defaults removed. |

## Evaluation coverage note

The mandated "every one of the 18 macro templates" coverage is implemented over all **20** template families that actually ship — a superset. The adversarial-macro matrix (20 templates × 10 scenarios = 200 cases + guards) lives in `tests/macroSparseTranscript.test.ts` and scans with the same pattern list the load-time guard enforces.

---

## Verification record

| Check | Result |
| --- | --- |
| `npm run lint` / `tsc --noEmit` | clean |
| Full Vitest | **1067 passed / 19 skipped (postgres, no DATABASE_URL) / 0 failed** — 64 files |
| eval:notes | 3/3, score 1.000, 0 safety failures |
| eval:benchmark | 20/20 FULLY SATISFIED (WER 0.00%, FDI 100%, 1.9 ms) |
| eval:gold-set | 217 cases, **0 critical-error entries**, regression ALL PASS; identical across two runs (F1 53.1%) |
| Phase 10 adversarial probe | **ALL CHECKS PASSED** (39/40 pre-remediation → 40/40; the F-3 fix closed the last check) |
| New suites | macroSparseTranscript 202 · signOffValidation 12 · negationScope 9 · evalProvenance 4 · recallAndOfflineDefaults 14 |

**Release-environment gap (documented, not hidden):** 19 PostgreSQL tests are skipped because `DATABASE_URL` is absent in this environment. The suite is complete only where a production-like database is configured; the JSON-fallback store paths are fully exercised, the Postgres paths are not run here.

## Exit criteria (mandated 1–18)

1–7, 12–17: **PASS** (evidence above). 8: PASS — all 20 (superset of 18) templates covered. 9–11: PASS — zero fabricated assertions in sparse macro/offline/recall scans. 18: PASS — sweep complete, 0 unresolved unsafe results (three found during remediation were fixed in-place).

Next step per the audit protocol: independent Phase 10 re-audit → `docs/FINAL_CLINICAL_SAFETY_AUDIT.md`.
