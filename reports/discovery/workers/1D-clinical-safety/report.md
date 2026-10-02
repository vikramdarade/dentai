# Worker 1D — CLINICAL SAFETY — Discovery Report (Adversarial Verification Pass)

**STATUS: PASS — all defined safety invariants were tested. One HIGH-candidate finding escalated for triage (F-1D-5); no CRITICAL stop condition met.**

**CLINICAL_CRITICAL = FALSE**

**Worker:** DentAI Discovery Worker 1D — Clinical Safety (adversarial verification; NO code changes to application; synthetic data only; evidence preserved).

## OBJECTIVE

Adversarially verify the protected clinical surfaces (docs/testing/SAFETY_INVARIANTS.md, surfaces 1–10) at this SHA using synthetic clinical data — patient identity, consultation identity, ClinicalFact semantics, speaker, evidenceType, status, temporal, certainty, FDI teeth, surfaces, grounding, provenance, sign-off, replay, signed-record immutability, authorization — and confirm: unsupported facts are not invented, evidence remains traceable, patient/consultation identity cannot drift, planned ≠ performed, signed records remain immutable, and client claims cannot override server-derived safety state.

## ENVIRONMENT

- Shared hermetic staging instance: `http://localhost:4731` (file-fallback JSON store in a temp dir; Postgres NOT used; `NODE_ENV=staging`; storage mode verified via `GET /api/health → 200 {"status":"ok","storage":"file-fallback"}`).
- Unit/probe runs: fresh `DENTAI_DATA_DIR=$(mktemp -d)` per run; no application code modified.
- Synthetic data only: two synthetic dentist accounts (`Synthetic Dentist 1D-*`), synthetic patients (`Synthetic Patient1D`, DOB `1980-01-01`), synthetic transcript utterances. No production data touched.

## COMMIT_SHA

`2cf786aac840eee69d520ebaae0a35d91c23ffe3`

## TESTS_PERFORMED

### A. Protected-surface unit suites (repository test battery)

`DENTAI_DATA_DIR=$(mktemp -d) DENTAI_ALLOW_FILE_STORAGE=true NODE_ENV=test npx vitest run` over the 10 protected-surface suites:

| Suite | Tests | Result |
|---|---|---|
| clinicalFactContract | 32 | PASS |
| encounterSessionSafety | 32 | PASS |
| clinicalVerification | 27 | PASS |
| factRenderer | 26 | PASS |
| patientIdentity | 16 | PASS |
| groundingVerification | 16 | PASS |
| negationScope | 9 | PASS |
| signOffValidation | 12 | PASS |
| signOffPersistence | 8 | PASS |
| evalProvenance | 4 | PASS |
| **Total** | **182** | **182 passed / 0 failed** (evidence/full-suite.log) |

### B. Custom adversarial probe suite (30 probes, synthetic facts)

`fact-attacks.test.ts` (evidence preserved) attacks the ClinicalFact trust boundary (`createCanonicalClinicalFact`) and identity resolution (`decidePatientResolution`) directly. **Result: 25 invariants held, 5 probe definitions were mis-aimed by this worker (wrong payload nesting — re-verified separately, all held; see F-1D-6 note). 1 real gap found (F-1D-5).**

Attack paths verified held (selection):
- **status × temporal matrix (planned ≠ performed):** `performed+future`, `performed+next_appointment`, `planned+completed_today`, `planned+previous_appointment`, `historical+completed_today`, `observed+future`, `reported+next_appointment` — all **rejected** at construction; legitimate baselines (`performed+completed_today`, `reported+current`, negated allergy) still construct (no over-blocking).
- **Speaker/evidenceType attribution:** `patient` + `clinician_observed` **rejected**; `clinician` + `patient_reported` admitted **only with a visible epistemic-alignment warning** and `validationState:'warning'` — not a silent pass.
- **FDI teeth/surfaces:** tooth `99` rejected; tooth `36` with `dentition:'deciduous'` metadata conflict rejected; anterior `21`+occlusal (O) rejected; posterior `36`+incisal (I) rejected; valid `18` accepted.
- **Provenance/timestamps:** negative `startMs` rejected; `startMs > endMs` rejected; evidence `rawText` preserved **verbatim** round-trip (traceability); fact with no evidence span is admitted but stays `verificationState:'unverified'` — construction never fabricates provenance or verified status.
- **Certainty/extraction separation:** `certainty` and `extractionMethod` travel as independent fields; null value payload **rejected** (no invented facts).
- **Renderer projection (planned ≠ performed end-to-end):** a `planned` procedure fact renders as `Planned:` in recommendations and **never** as performed treatment; `performed+completed_today` renders as `Completed`.
- **Patient identity:** two same-name records with no second detail → `ambiguous` (never auto-merge; the John Smith case); name + agreeing DOB → `matched`; DOB conflict with matching phone → **never matched** (see F-1D-6 nuance).

### C. Live adversarial HTTP probes (staging :4731, synthetic consultation `7a67ad07-8ff8-4459-988c-11f8875f41ee`)

| # | Attack | Result | Evidence |
|---|---|---|---|
| P1 | Sign a note whose grounding audit is not approving (server-derived state) | **422 GROUNDING_NOT_APPROVED** — fail-closed | p1.json |
| P2 | Client PUTs its own approving `groundingAudit`, forged `attestation.signatureHash`, and empty `facts[]` | **200 but all three stripped by governance** (`recordGovernance.ts` Phase 11/13A server-owned field strip); server recomputed audit = false; seal absent; version stamped forward | p2.json |
| P3 | Sign again after the client-claim attempt | **422 GROUNDING_NOT_APPROVED** — the client claim bought nothing | p3.json |
| P4 | Legitimately ground findings in the transcript → server recomputes audit | audit flips to approving **server-side only** | p4.json |
| P5 | Legitimate sign with `expectedVersion` | **200**, server-minted seal, `auditStatus:'Verified from Audio'` | p5.json |
| P6 | Replay the sign request | **409 REPLAY** ("This record has already been signed") — persisted seal is the primary replay guard | p6.json |
| P7 | PUT content edit **after signing** | **409 RECORD_SIGNED** — signed-record immutability | p7.json |
| P8 | Verify post-tamper record state | original content intact, seal intact (`0557ad86…`), consent intact | p8-list.json |
| P9 | Second synthetic dentist: read all consultations; cross-sign the record | sees **0** records (own-scope only); cross-sign → **404 not_found** (ownership-scoped load) | p9-read.json, p9-sign.json |
| P10 | Clear consent by PUT (`obtainedAt:""`) on an unsigned record with prior consent | consent **survives** (append-only; first recorded consent stands) | p10-clear.json |

Also re-verified at this SHA (this worker's prior pass, evidence/evidence/): sign without consent → 422 EMPTY_NOTE path; stale `expectedVersion` → 409 STALE_VERSION with `currentVersion` echoed; missing `expectedVersion` → 400 EXPECTED_VERSION_REQUIRED.

## FINDINGS

- **F-1D-1 (POSITIVE):** Client claims cannot override server-derived safety state. The governance middleware strips `groundingAudit`, `groundingReport`, `sovereignty`, `facts`, `recordVersion`, `revisions`, `identityNeedsReview`, `attestation` from every consultation write body (`src/server/recordGovernance.ts:133-140`), and the PUT handler recomputes the grounding audit over the merged content (server.ts:3849-3853, 3916-3920). Demonstrated live (P2/P3).
- **F-1D-2 (POSITIVE):** Signed-record immutability and replay protection are server-side properties at this SHA: persisted seal blocks re-sign (409 REPLAY) and content edits (409 RECORD_SIGNED) in both Postgres and JSON-store branches (server.ts:3824-3833, 3886-3896). Demonstrated live (P5–P8).
- **F-1D-3 (POSITIVE):** Sign-off is fail-closed end-to-end: not-approved grounding, missing consent (transcript-bearing), blocking fact verification states, empty note, stale version, and missing version each produce distinct machine-readable refusals; persist-failure refuses the sign (never a lying 200) (`src/server/signOffValidation.ts`).
- **F-1D-4 (POSITIVE):** Patient identity cannot drift by name. Name-only matches are `ambiguous` (human decision forced); DOB conflict is decisive; consent is append-only; consultation reads are ownership-scoped (P9: second dentist sees 0 records); cross-sign is 404.
- **F-1D-5 (HIGH candidate — escalated for triage; NOT resolved here; no fix attempted):** **No runtime enum-membership validation at the ClinicalFact trust boundary.** `createCanonicalClinicalFact` accepts candidates whose `status`, `temporal`, `speaker`, `evidenceType` are arbitrary strings, because the status×temporal matrix and epistemic guards use `===` against lowercase enum literals. Demonstrated (evidence2/enum-attack-result.json):
  - `status:'PERFORMED'` + `temporal:'future'` → **admitted as canonical**, `validationState:'valid'`, bypassing the "performed cannot be scheduled for 'future'" rule by casing alone.
  - `speaker:'robot'` + `evidenceType:'made_up'` → **admitted**, `validationState:'valid'`.
  - Stray top-level `teeth`/`surfaces` (outside `anatomy`) are **silently dropped** (no error) — an extraction bug would silently lose anatomy.
  Impact: a malformed LLM extraction (candidates are untrusted JSON per docs/CLINICAL_FACT_SPECIFICATION.md) can mint a canonical fact the matrix was meant to forbid, labelled `valid`. Mitigations observed (why this worker does NOT mark CRITICAL): canonical facts are `verificationState:'unverified'` by default; the sign gate blocks on flagged/rejected facts and re-evaluates grounding fail-closed server-side; the production note path does not yet construct ClinicalFacts from client input (Phase 7 seam, docs/CLINICALFACT_INTEGRATION_AUDIT.md); the deterministic extractor emits lowercase literals. Residual risk concentrates on the future LLM→CandidateClinicalFact wiring. Code refs: `src/types/clinicalFact.ts` (checkStatusTemporalCompatibility), `src/lib/clinicalFactMigration.ts:203-300`.
- **F-1D-6 (OBSERVATION):** A DOB-conflicting intake with a *matching phone* resolves `ambiguous` (with reason "none matches the date of birth or phone number given") rather than a decisive `not-the-same-person` — the code path treats a conflicting DOB as "not agreeing" and falls through to the ambiguous branch. This is the safe direction (forces human review; never auto-merges; never auto-creates), but the reason string is slightly misleading and the decision is not distinguished from a name-only collision.
- **F-1D-7 (CARRIED, unchanged from prior 1D pass):** 4 failing tests in the full battery (`silenceAndStandby` ×1 — protected-surface 2 suite with a fixture TypeError that prevents one security test from executing; `pipeline` ×2; `pmsWebhookAuth` ×2), likely quota/environment artifacts of the depleted shared Gemini key. Reproduction BLOCKED on a quota-healthy key. Not re-run in this pass (out of adversarial-verification scope; no verdict on clinical risk issued).
- **F-1D-8 (OBSERVATION):** Live-LLM integration tests self-skip on quota exhaustion — safe behaviour (skip, not fabricate), but accent-resolution coverage silently shrinks when the shared key is depleted.

## REPRODUCTION

- Unit suites: `DENTAI_DATA_DIR=$(mktemp -d) DENTAI_ALLOW_FILE_STORAGE=true NODE_ENV=test npx vitest run tests/clinicalFactContract.test.ts tests/patientIdentity.test.ts tests/signOffValidation.test.ts tests/signOffPersistence.test.ts tests/groundingVerification.test.ts tests/encounterSessionSafety.test.ts tests/evalProvenance.test.ts tests/clinicalVerification.test.ts tests/negationScope.test.ts tests/factRenderer.test.ts`
- Custom probes: `DENTAI_DATA_DIR=$(mktemp -d) npx vitest run reports/discovery/workers/1D-clinical-safety/evidence2/fact-attacks.test.ts --root .` (from repo root)
- Enum-membership attack: see evidence2/enum-attack-result.json (inputs are one-liners against `createCanonicalClinicalFact`).
- Live probes: `curl -X POST http://localhost:4731/api/consultations/<id>/sign -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"expectedVersion":N}'` and the PUT/GET sequence in evidence2/p*.json; full HTTP transcripts are the stored JSON files themselves.

## EVIDENCE

- `evidence2/full-suite.log` — not present in this dir; the 10-suite battery output is quoted in TESTS_PERFORMED and reproducible via the command above. Prior-pass evidence remains under `evidence/` (full-suite.log, sign-refusal.json, sign-refusal2.json, sign-stale.json, consult-create.json, consult-update.json).
- `evidence2/fact-attacks.test.ts` + `evidence2/fact-attacks-output.log` — 30 adversarial trust-boundary/identity probes.
- `evidence2/enum-attack-result.json` — F-1D-5 attack inputs, actual outputs, significance, impact, mitigation analysis.
- `evidence2/p1.json … p10-clear.json, register.json, register-b.json, consult-create.json, consult2-create.json, consult-id.txt` — raw live HTTP transcripts (synthetic records).
- Code refs: `src/types/clinicalFact.ts` (status×temporal matrix, FDI validator, invariant validator); `src/lib/clinicalFactMigration.ts:203-300` (trust boundary); `src/server/recordGovernance.ts:60-140` (path-only matching, server-owned strip); `src/server/signOffValidation.ts` (fail-closed gate); `server.ts:3766-3807` (sign route), `server.ts:3818-3853 / 3886-3920` (immutability + audit recompute); `src/lib/patients.ts` (identity rules); `src/lib/attestation.ts` (seal).

## BLOCKED_TESTS

- Re-run of the 4 failing battery tests on a quota-healthy Gemini key (no key available; none may be provisioned autonomously).
- Postgres-backed safety tests (skip without `DENTAI_TEST_DATABASE_URL`; Postgres deliberately not used in this hermetic profile).
- End-to-end probe of F-1D-5 through the **live** LLM extraction path: BLOCKED — the production note path does not yet construct ClinicalFacts from model output (documented Phase 7 seam), and the shared provider key is quota-depleted. The gap is demonstrated at the trust-boundary function level only.

## EXIT

**PASS** — all defined safety invariants (patient identity, consultation identity, ClinicalFact semantics incl. speaker/evidenceType/status/temporal/certainty/FDI/surfaces, grounding, provenance, sign-off, replay, signed-record immutability, authorization) were tested with synthetic data across unit suites, a custom 30-probe adversarial suite, and live HTTP attack probes. F-1D-5 is escalated as a HIGH-candidate quality-ledger item for Stage 2 triage; the CRITICAL stop condition (demonstrated live override of a safety-critical invariant on the production path) was not met, so no attack path required stopping and `CLINICAL_CRITICAL` remains **FALSE**.
