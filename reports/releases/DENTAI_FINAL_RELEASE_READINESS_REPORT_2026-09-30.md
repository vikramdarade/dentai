# DENTAI FINAL RELEASE READINESS REPORT

**Run:** 2026-09-30 · **Branch:** `fix/qle-2026-0042-api-error-json` (HEAD
`bf07bb8`, plus uncommitted working-tree changes) · **Engineer:** Freebuff
(autonomous implementation worker)
**Evidence:** `reports/releases/HARDENING-RUN-2026-09-30-GATE-EVIDENCE.md`,
`reports/releases/PRODUCTION-PROBE-2026-09-30.md`,
`.control/quality-ledger.json`

---

## OVERALL STATUS

```
BLOCKED
```

Nothing in this run was committed, pushed, reviewed by a second agent, or
deployed. Furthermore the P0/HIGH clinical-risk backlog (QLE-2026-0004…
0013) is still open and unfixed, the Postgres-backed paths are unverified in
this environment, and the production deployment does not contain any of this
run's work. The product therefore cannot be described as dentist-ready, with or
without approval.

---

## DEFECT TABLE

`REPRO?` = was the defect reproduced/confirmed in this run with evidence.

| ID | Sev / risk | Current status | Reproduced? | Root cause | Fixed? | Tested? | Reviewed? | Released? | Prod verified? | Human action? |
|---|---|---|---|---|---|---|---|---|---|---|
| QLE-2026-0001 | P0 / HIGH | Implemented, uncommitted (`HUMAN_REVIEW`) | Yes — 2/2 in the discovery evidence; failure point re-read in `App.tsx`/`ChairsideWorkspace.tsx` | Logout clears in-memory state while the scratchpad is only persisted on completion; the "preserved" comment was wrong | **Partially** — explicit discard confirmation + honest copy; scratchpad is NOT preserved | Manual path only; no automated client test exists | **No** (CLINICAL_VERIFIER/Hermes not run) | No | No | **Yes** — decide persist-vs-confirm-discard |
| QLE-2026-0002 | P0 / HIGH | Implemented, uncommitted (`HUMAN_REVIEW`) | Root cause confirmed by static read of the focus effect and `activeEncounter` resolution | Stored dates compared as raw strings against the clinic day key; the focus effect cleared/switched the active patient when the record existed but was not on the selected day | **Yes** — canonical clinic-day matching + focus guard that never switches patient silently | `tests/date.test.ts` (13 new assertions) + `phase12-ui-smoke` roster cases | **No** | No | No | **Yes** — review (protected surfaces 1–2) |
| QLE-2026-0003 | P0 / HIGH | Implemented, uncommitted (`HUMAN_REVIEW`) | Yes — server reproduction path traced; the unguarded `.trim()` and pre-persistence nonce burn were read directly | Unguarded name fields in the seal digest builder; nonce consumed before the seal was persisted | **Yes** | `tests/signOffValidation.test.ts` (4 tests) + `tests/uiSafety.test.ts` T8/T8b | **No** | No | No | **Yes** — review (sign-off surface) |
| QLE-2026-0014 | P2 / MODERATE | Implemented, uncommitted (`HUMAN_REVIEW`) | Yes — route read; new tests pin the contract | `POST /api/consultations` accepted a body with neither patient nor content | **Yes** — 400 `CONSULTATION_REQUIRED_FIELDS` (narrow gate) | `tests/server.test.ts` (5 tests) | **No** | No | No | **Yes** — confirm the required-field set |
| QLE-2026-0015 | P1 / MODERATE | Implemented, uncommitted (`HUMAN_REVIEW`) | Yes — JSON path overwrote by index; Postgres silently ignored | JSON store replaced the record with the same id and answered 201; Postgres `ON CONFLICT DO NOTHING` diverged in the opposite direction | **Yes** — 409 `CONSULTATION_ID_CONFLICT` in both modes + first-write-wins backstop | `tests/server.test.ts` | **No** | No | No | **Yes** — 409 vs upsert decision; see §Remaining work on the QLE-0006 interaction |
| QLE-2026-0016 | P2 / MODERATE | Implemented, uncommitted (`HUMAN_REVIEW`) | Yes — route read (`dob` only, no validation) | Route read `dob` only; a submitted `dateOfBirth` was silently dropped; any string was accepted | **Yes** — accepts both field names, strict `YYYY-MM-DD` real-date check, 400 `INVALID_DOB` | `tests/patientIdentity.test.ts` | **No** | No | No | **Yes** — review (patient identity) |
| QLE-2026-0026 | P3 / LOW | Implemented, uncommitted (`HUMAN_REVIEW`) | Yes — `agreeingDetail` read; new tests pin the behaviour | A phone match was accepted even when the intake asserted a DOB the stored chart did not have | **Yes** — becomes `ambiguous` (human review) instead of a phone-only link | `tests/patientIdentity.test.ts` | **No** | No | No | **Yes** — review (patient identity) |
| QLE-2026-0018 | P2 / MODERATE | Implemented, uncommitted (`PR_READY`) | Yes — 25s client deadline vs 45s server first backoff read in source | Client abandoned a queued job before the server's first retry could complete it | **Partially** — shared 95s/2s poll budget derived from the retry ladder; editor reconciliation with a late-completing durable job is still open | `tests/noteJobs.test.ts` (3 tests) | **No** | No | No | No |
| QLE-2026-0017 | P2 / MODERATE | Unchanged (`REPRODUCING`) | **No** — no concurrent probe was run | Ledger confidence 0.5; sequential duplicate submission cannot double-count (metering is on completion) | No | No | No | No | No | No — evidence first, per the ledger |
| QLE-2026-0022 | P2 / LOW | `VERIFIED` | Yes — 4 production probes | No terminal `/api` 404; the SPA catch-all answered instead | Yes (PR #7, `23768f8`) | `tests/server.test.ts` + production probes | Yes (prior run) | Yes | **Yes — re-verified 2026-09-30** | No |
| QLE-2026-0042 | P2 / LOW | Implemented + tested, uncommitted (`PR_READY`) | Yes — handler read; and **production probe 8 shows it live in production** | No 4-arity error handler, so Express's default HTML error page answered malformed JSON and oversized bodies | Yes (commit `bf07bb8`) | `tests/server.test.ts` (5 tests) | **No** | **No** | **No — defect still live in production** | Yes — commit/push/PR/deploy |

### Not addressed in this run (open, unchanged)

| ID | Sev / risk | Why it was not changed |
|---|---|---|
| QLE-2026-0004 | P0 / HIGH | Recording stranded with no finish path when the dentist navigates away mid-recording. The ledger's own next action is *re-verify live (2nd reproduction), then move state out of component state* — an architectural change on protected surface 2. One reproduction on file. Not fixed. |
| QLE-2026-0005 | P1 / HIGH | No enum-membership validation at the ClinicalFact trust boundary; casing bypasses the status×temporal matrix. Protected surface 3 — any change to `clinicalFactMigration.ts` needs CLINICAL_VERIFIER assessment first. Not fixed. |
| QLE-2026-0006 | P1 / HIGH | Duplicate clinical records: the job id is derived from the client consultation id only when UUID-shaped, and the durable record is persisted under the job id, so `consult-<ts>` / `chair-active` never converge. **Re-analysed this run**: the fix needs both a client id-minting change and a decision on the client save path, because the new QLE-2026-0015 409 gate would make a converged record collide on POST. Not fixed. |
| QLE-2026-0007 | P1 / HIGH | Server-side writers (transcription persist) bypass record governance: no version bump, no revision, no grounding recompute, no signed-record check. Static-only evidence; corroborating dynamic evidence required first. Not fixed. |
| QLE-2026-0008 | P1 / HIGH | Sign-off seal persistence is a read-modify-write that a concurrent PUT can clobber (seal loss = immutability loss). Concurrency control is protected surface 10; needs a probe and an atomic-write design. Not fixed. |
| QLE-2026-0009 | P1 / HIGH | 30s roster poll replaces the whole consultation array and can revert an in-flight save. Static-only. Not fixed. |
| QLE-2026-0010 | P1 / HIGH | Two-tab lost update on the shared `localStorage` mirror (no `storage` event reconciliation). Not fixed. |
| QLE-2026-0011…0013 | P1 / MODERATE | Not analysed in this run (unchanged, `OBSERVED`). |
| QLE-2026-0019…0021, 0023…0025, 0027…0041 | P2–P3 / LOW-NONE | Not analysed in this run. Notable: QLE-2026-0023 (`expectedVersion` optional → last-write-wins on first-round-trip records) was deliberately **not** tightened, because making it mandatory changes an API contract used by six existing tests and by `scripts/phase12-rollback-check.ts`; it needs a product decision, not a silent edit. |
| QLE-2026-0029, 0032 | — / UNKNOWN | `BLOCKED` in the ledger (no evidence available). |

---

## CHANGES

**Nothing is committed, pushed or deployed.** All of the following is in the
working tree only; branch `fix/qle-2026-0042-api-error-json`.

| File | Purpose |
|---|---|
| [server.ts](server.ts) | `consultationHasMinimums` gate (QLE-0014), id-collision 409 (QLE-0015), `insertConsultationDeduped` on the JSON path (QLE-0015), `/api` JSON error handler (QLE-0042, commit `bf07bb8`), `/api` JSON 404 (QLE-0022, merged) |
| [src/lib/db.ts](src/lib/db.ts) | `dbConsultationExistsById` — collision check on the primary key, not per dentist (QLE-0015) |
| [src/server/signOffValidation.ts](src/server/signOffValidation.ts) | Nonce consumed only after the seal is durably persisted (QLE-0003) |
| [src/lib/attestation.ts](src/lib/attestation.ts) | Guard absent patient names in the canonical digest (QLE-0003) |
| [src/server/patientRoutes.ts](src/server/patientRoutes.ts) | `parsePatientDob` — `dob`/`dateOfBirth`, strict real-date validation, 400 `INVALID_DOB` (QLE-0016) |
| [src/lib/patients.ts](src/lib/patients.ts) | `agreeingDetail` refuses a phone-only match when the intake asserts a DOB the chart lacks (QLE-0026) |
| [src/utils/date.ts](src/utils/date.ts) | `clinicDayKeyOfStoredDate` — one canonical clinic-day key for every stored date shape (QLE-0002) |
| [src/components/ChairsideWorkspace.tsx](src/components/ChairsideWorkspace.tsx) | Canonical day matching, focus guard, `activeEncounter` from the selected record, unsaved-work logout confirmation, shared poll budget |
| [src/components/DayScheduleQueue.tsx](src/components/DayScheduleQueue.tsx) | Shared poll budget instead of a local 85s literal (QLE-0018) |
| [src/lib/noteJobs.ts](src/lib/noteJobs.ts) | `NOTE_JOB_CLIENT_POLL` derived from the worker retry ladder (QLE-0018) |
| [src/App.tsx](src/App.tsx) | `handleLogout` comment corrected to state what actually happens (QLE-0001) |
| [tests/server.test.ts](tests/server.test.ts) | +82 lines: consultation-create contract (0014/0015), API error contract (0042) |
| [tests/date.test.ts](tests/date.test.ts) | +28 lines: `clinicDayKeyOfStoredDate` |
| [tests/patientIdentity.test.ts](tests/patientIdentity.test.ts) | +52 lines: DOB parsing (0016), phone-only match guard (0026) |
| [tests/signOffValidation.test.ts](tests/signOffValidation.test.ts) | +51 lines: nameless sign-off, nonce not burned on refusal, genuine replay still refused (0003) |
| [tests/uiSafety.test.ts](tests/uiSafety.test.ts) | T8 rewritten to the corrected contract + T8b added. **This is a contract change, not a weakened test**: the old assertion encoded the defect ("consuming on attempt is the fail-closed behaviour") which the ledger's expected behaviour explicitly repudiates; the anti-replay property is still asserted (a genuine duplicate is refused 409 REPLAY) |
| [tests/noteJobs.test.ts](tests/noteJobs.test.ts) | +23 lines: client poll budget vs retry ladder (0018) |

Ledger: 11 entries updated (0001, 0002, 0003, 0014, 0015, 0016, 0018, 0026,
0042, 0022, and 0006 re-analysed), 42 entries total, validated against
`.control/quality-ledger.schema.json` field/status sets.

---

## TEST RESULTS

Exact commands and outputs: `reports/releases/HARDENING-RUN-2026-09-30-GATE-EVIDENCE.md`.

| Gate | Result |
|---|---|
| TypeScript (`tsc -b --noEmit`) | **PASS** — exit 0 |
| Unit + integration (`vitest run`) | **PASS** — 66 files passed, 1 skipped; **1153 tests passed, 19 skipped, 0 failed**, 66.7s |
| Integration (`tests/server.test.ts`) | **PASS** — 65 tests |
| API E2E (`scripts/phase11-e2e-flow.ts`) | **PASS** — ALL CHECKS PASSED |
| Browser smoke (`scripts/phase12-ui-smoke.ts`) | **PASS** — ALL SMOKE CHECKS PASSED (Cases A–G, real Chromium) |
| Encounter-safety smoke (`scripts/phase13a-encounter-safety-smoke.ts`) | **PASS** — ALL ENCOUNTER-SAFETY CHECKS PASSED (H1–H4, two browser contexts) |
| Clinical evaluation (`eval-notes --offline --min-score 0.9`) | **PASS** — 3/3 fixtures, average score 1.000, 0 safety failures |
| Benchmark (`run-clinical-benchmark`) | **PASS** — 20/20, CWER 0.00%, FDI P/R 100%, pharmacology 100%, latency 1.9ms |
| Gold set (`eval-gold-set`) | **PASS (with poor extraction scores)** — 0 critical errors, regression fixtures ALL PASS, but offline F1 53.1% (omission 49.9%) |
| Production build (`vite build` + `esbuild`) | **PASS** — `dist/` + `server.js` (928.0 kB) |
| Postgres suite | **NOT RUN** — no Postgres/Docker in this environment (19 tests self-skip) |
| Scheduled jobs / migration rollback | **NOT RUN** — `phase12-rollback-check` needs `DENTAI_E2E_DATABASE_URL` |
| Live-model note generation | **NOT RUN** — Gemini key depleted (`RESOURCE_EXHAUSTED`); cases self-skip |
| External Hermes review | **NOT RUN** — no second agent was invoked from this environment |

---

## PRODUCTION

| Item | Value |
|---|---|
| Release commit | `23768f8` (Merge PR #7, `fix/qle-2026-0022`) — an ancestor of HEAD |
| Deployment | Vercel production, https://dentai-one.vercel.app |
| Deployment status | **Unknown / not retrievable** — no `vercel` CLI or token in this environment, so no deployment record or build log could be read |
| Smoke method | Real Chromium session on the production origin (direct `curl` is answered by the Vercel edge Security Checkpoint: HTTP 429, `X-Vercel-Mitigated: challenge`) |
| Smoke results | 8 probes, see `reports/releases/PRODUCTION-PROBE-2026-09-30.md` |
| QLE-2026-0022 verification | **PASS** — `GET /api/nope-2026` → 404 `application/json` `{"error":"API endpoint not found","code":"API_NOT_FOUND"}`; same for POST and for a nested unknown path; `GET /api/consultations` without a token → 401 JSON; `/` and `/chairside` → 200 HTML |
| QLE-2026-0042 verification | **FAIL (expected)** — `POST /api/consultations` with `{"broken":` returns **400 `text/html`** `<pre>Bad Request</pre>`, i.e. the defect is still live in production. The fix is on an unmerged branch. |
| All other 2026-09-30 fixes | **Not deployed, therefore not production-verified.** |

No claim is made about the production build behind the Vercel deployment, about
GitHub CI conclusions for `bf07bb8` or the working tree, or about any
environment other than the one exercised above.

---

## SAFETY

| Invariant | Result |
|---|---|
| Wrong patient | **No regression observed.** `phase13a` H1/H2 pass: an external walk-in never moves focus, keyboard navigation locks focus, and the operatory banner keeps the active patient. The QLE-0002 change makes the reopen path *more* conservative (it keeps focus and warns). |
| Grounding | **No regression.** `phase12-ui-smoke` A–G and `phase11-e2e-flow` pass; an ungrounded note still refuses sign-off 422 `GROUNDING_NOT_APPROVED` (asserted at unit, API and browser level). |
| Sign-off | **Changed deliberately (QLE-0003)**: a *refused* sign-off no longer consumes the request nonce, so the clinician can retry; a successful sign-off still consumes it and a re-sign of a sealed record is still 409 `REPLAY`. Server re-derivation of every approval condition is untouched. |
| Signed-record immutability | **No regression.** `phase13a` H4: content edit to a signed record → 409 `RECORD_SIGNED`; duplicate sign-off → 409 `REPLAY`; the seal survives a fresh browser context. |
| ClinicalFact semantics / provenance | **Untouched.** No file under `src/lib/clinicalFact*`, `transcriptGrounding.ts` or the extractor was modified. |
| Consultation identity | **Tightened, not loosened**: QLE-0014 refuses empty shells; QLE-0015 refuses an id collision instead of overwriting (or silently ignoring). |
| Consent / audit / retention / FDI / medication | **Untouched** by this run; covered by the passing suites. |

**Unresolved safety findings:** QLE-0004…0010 (see the table above) remain open,
several at HIGH clinical risk. QLE-0003's residual: the consumed-nonce set is
in-memory per instance, so a multi-instance deploy still relies on the durable
persisted-seal check as the primary replay defence (unchanged behaviour). The
`tests/uiSafety.test.ts` change is the one place where an existing test's
expectation was rewritten; the security property it guarded is still asserted,
and the rewrite is required by the ledger's own stated expectation for
QLE-0003.

---

## HUMAN ACTION REQUIRED

1. **Clinical review + merge decision for the protected-surface changes** (QLE-0001, 0002, 0003, 0014, 0015, 0016, 0026). Per `docs/testing/SAFETY_INVARIANTS.md` §3.5 there is no autonomous merge path: CLINICAL_VERIFIER must re-derive the safety argument from the evidence, and HUMAN_REVIEW is required before merge.
2. **QLE-0001 product decision:** must an in-progress chairside scratchpad survive Sign Out (persist/flush), or is the implemented confirm-and-discard the accepted behaviour?
3. **QLE-0014 product decision:** confirm the clinical minimum for a consultation body (implemented gate: patient identity OR transcript/patientSummary/note/findings).
4. **QLE-0015 product decision:** 409-refuse on an id collision (implemented) vs upsert-on-collision — this also gates the QLE-0006 duplicate-record fix.
5. **QLE-0006 implementation decision:** approve the two-sided convergence change (client mints one stable encounter id before generation; server persists the durable record under it) plus the client save-path change it forces with the 0015 gate.
6. **QLE-0004 / 0008 / 0009 / 0010 approvals:** each is an architectural change on protected surfaces (consultation identity, concurrency, clinical content integrity). QLE-0004 also needs a second live reproduction before implementation.
7. **QLE-0005 approval:** adding enum-membership validation at the ClinicalFact trust boundary changes ClinicalFact construction semantics (surface 3) and needs CLINICAL_VERIFIER assessment.
8. **Release engineering:** commit, push, PR, deploy, and read the Vercel/CI records (no CLI or token exists in this environment).
9. **Provide a disposable Postgres** (`DENTAI_E2E_DATABASE_URL`) so the Postgres-backed paths and the migration-rollback rehearsal can be verified.

Not listed: routine engineering steps (run the suite, rebuild, update the ledger)
— all of those were done.

---

## REMAINING WORK

**P0**
- QLE-2026-0004 — recording stranded with no finish path after mid-recording navigation (needs a second live reproduction, then state ownership moved out of component state).

**P1 / HIGH clinical risk**
- QLE-2026-0005 — ClinicalFact trust-boundary enum validation.
- QLE-2026-0006 — one record per encounter for non-UUID ids (job/durable/client convergence).
- QLE-2026-0007 — route every server-side writer through record governance.
- QLE-2026-0008 — atomic seal persistence / re-check immutability inside the PUT write.
- QLE-2026-0009 — poll response must not replace in-flight saves.
- QLE-2026-0010 — cross-tab reconciliation of the local consultation mirror.
- QLE-2026-0011…0013 — unanalysed in this run.
- Release path for the eight fixes implemented here (review → merge → deploy → production verification).

**Safe deferred**
- QLE-2026-0018 residual: editor reconciliation when a durable job completes after the client deadline.
- QLE-2026-0023 (`expectedVersion` optional → last-write-wins) — needs a contract decision; tightening it touches six existing tests and a release script.

**Evidence required**
- QLE-2026-0017 — concurrent duplicate-submission probe (exactly one usage increment); also a concurrency question about double-processing a shared queued job.
- QLE-2026-0004 — second live reproduction.
- QLE-2026-0007 / 0008 / 0009 — behavioural probes to replace static-only reasoning.
- QLE-2026-0029 / 0032 — `BLOCKED` with no evidence available.

**Non-blocking observations**
- Postgres suite and migration-rollback rehearsal unrunnable here (no DB).
- Live-model note generation unverified (Gemini key depleted).
- Gold-set offline extraction quality is low (F1 53.1%, omission 49.9%) with 0 critical errors; flagged as an observation, not a regression assertion, since no pre-change baseline exists.
- SPA bundle 1,006 kB (268 kB gzip) with a >500 kB chunk warning — pre-existing.
- This environment cannot read GitHub CI conclusions or Vercel deployment records.

---

## FINAL VERDICT

Demonstrated in this run, with first-hand evidence:

- **QLE-2026-0022 is fixed and live in production** — four production probes on
  `https://dentai-one.vercel.app` returned 404 `application/json`
  `API_NOT_FOUND` for unknown, POST and nested `/api/*` requests, with the known
  route still 401 JSON and `/` and `/chairside` still SPA 200.
- **QLE-2026-0042 is still broken in production** — a malformed JSON POST is
  answered with an HTML 400 page. Its fix exists only in the working tree.
- **Eight further defects have implemented, regression-tested fixes in the
  working tree**: QLE-0001 (partial), 0002, 0003, 0014, 0015, 0016, 0018
  (partial), 0026 — plus QLE-0042. Typecheck, the full 1153-test unit and
  integration suite, the production build, the clinical evaluation, the
  benchmark, the API E2E flow, the browser UI-safety smoke and the
  encounter-safety browser smoke all pass on the current working tree.
- **Nothing was committed, pushed, reviewed by a second agent, or deployed.**
  No production verification exists for any of the 2026-09-30 fixes.
- **QLE-2026-0004…0013 remain open**, several at P0/P1 with HIGH clinical risk,
  and QLE-2026-0017 and QLE-2026-0029/0032 still lack the evidence their own
  ledger entries demand.
- **Two verifications could not be performed at all** in this environment: the
  Postgres-backed suite (and the migration-rollback rehearsal), and live-model
  note generation.

This is not a dentist-ready release. It is a working tree whose local gates pass,
whose protected-surface changes are ready for clinical review, and whose release
is blocked until the P0/P1 clinical-risk backlog is resolved, the implemented
changes are reviewed, merged and deployed, and the fixes are re-verified against
the deployment that actually carries them.
