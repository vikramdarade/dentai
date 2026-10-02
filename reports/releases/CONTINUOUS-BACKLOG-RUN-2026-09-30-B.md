# DENTAI — CONTINUOUS BACKLOG EXECUTION, RUN B (2026-09-30)

Branch `fix/qle-2026-0042-api-error-json` · HEAD `bf07bb8` + uncommitted working-tree
changes · Node v24.21.0 · repository tooling from `node_modules/.bin` (no Bun
install in this environment, so each `package.json` script was invoked through its
underlying binary with identical arguments).

This run continues [RUN A](DENTAI_FINAL_RELEASE_READINESS_REPORT_2026-09-30.md) and
supersedes its counts where they differ. Nothing was committed, pushed or deployed.

## OVERALL STATUS

`BLOCKED`

Blocked on the same two things RUN A was blocked on, not on engineering work:
no reviewer role (CLINICAL_VERIFIER / DETERMINISTIC_TESTER / E2E_TESTER /
SECURITY_REVIEWER) could be executed in this environment, and the release channel
(GitHub + Vercel) is unreachable from it. Both are classified "human action
required" below; neither is a code problem.

---

## 1. ORIGINAL BACKLOG COUNT

42 ledger entries in [.control/quality-ledger.json](.control/quality-ledger.json).

| Status | Count | Ids |
|---|---|---|
| VERIFIED | 1 | 0022 |
| IMPLEMENTED, awaiting review (`PR_READY` / `HUMAN_REVIEW`) | 12 | 0001, 0002, 0003, 0005, 0009, 0012, 0014, 0015, 0016, 0018, 0026, 0042 |
| Untouched (engineering or evidence work outstanding) | 29 | see §5 |
| Blocked on unavailable infrastructure | 2 | 0029, 0032 (also inside the 29) |

## 2. ITEMS COMPLETED THIS RUN

Three defects moved from `OBSERVED`/`REPRODUCING` to implemented + regression-tested.

**QLE-2026-0005 — ClinicalFact trust boundary had no enum-membership check (P1, HIGH).**
The status × temporal matrix and the epistemic guards compare lowercase literals with
`===`, so `status: 'PERFORMED'` + `temporal: 'FUTURE'` matched no rule, fell through
the whole matrix and was minted as a canonical fact with `validationState: 'valid'`;
`speaker: 'robot'` / `evidenceType: 'made_up'` were admitted the same way.
Fix: membership tables declared `Record<Union, true>` (the compiler now fails the
build if a union member is added or removed without the table) plus
`checkFactEnumMember`, enforced in `createCanonicalClinicalFact` **before** the matrix.
A recognised case/whitespace variant is normalised to the canonical member — so a real
assertion is not discarded and the matrix then applies to it — and an unknown value is
refused, fail closed. [clinicalFact.ts](src/types/clinicalFact.ts) ·
[clinicalFactMigration.ts](src/lib/clinicalFactMigration.ts) ·
[clinicalFactContract.test.ts](tests/clinicalFactContract.test.ts) (+4 cases).

**QLE-2026-0009 — the 30s roster poll reverted saves that had not settled (P1, HIGH).**
`fetchConsultations` rebuilt the list as (local cache + server records, server last)
and replaced state unconditionally. A response resolving while a save was in flight
reverted that record's transcript/findings/`recordVersion` to the server's older copy,
and the reverted record then supplied a stale `expectedVersion` to the next PUT — a
self-inflicted 409 STALE_WRITE loop. Fix: `mergeConsultationLists(local, server,
preserve)` states the rule and `src/App.tsx` tracks ids whose save has not settled
(`inFlightSaveIdsRef`, added before the PUT/POST, released in a `finally` so a 409, a
queue-for-retry, a thrown error and an early return all release it). Server data still
wins for every record without an in-flight save, which is what makes cross-device sync
work. [consultationList.ts](src/lib/consultationList.ts) · [App.tsx](src/App.tsx) ·
[consultationList.test.ts](tests/consultationList.test.ts) (+3 cases).

**QLE-2026-0012 — two overlapping saves lost one of them (P1, MODERATE).**
`handleSaveConsultation` derived the next list from the `consultations` array captured
by the render that created the handler (`[...consultations]` + `setConsultations`), and
the localStorage mirror plus the post-save server echo were computed from the same
captured value. Two writes whose handlers shared a render started from the same
pre-update snapshot; the second reverted the first, and the reverted list was mirrored
to localStorage and round-tripped to the server on the next save. Fix: the list now
lives in `createConsultationListStore`, all eleven list writes go through
`applyConsultations`, and the save path reads the live list at write time (`upsert`).
Verified by a negative control that encodes the old snapshot pattern.
[consultationList.ts](src/lib/consultationList.ts) · [App.tsx](src/App.tsx) ·
[consultationList.test.ts](tests/consultationList.test.ts) (+7 cases).

## 3. ITEMS IMPLEMENTED BUT AWAITING REVIEW

All 12 implemented fixes are in the working tree, uncommitted, unreviewed and
unreleased. Full per-defect detail is in the ledger entries themselves, which now
carry the reproduction, root cause, regression test and residual risk for each.

| Id | Sev / risk | What is on disk | Regression test | Review | Released |
|---|---|---|---|---|---|
| 0001 logout vs unsaved scratchpad | P0 / HIGH | confirm-discard modal + `hasUnsavedClinicalWork()` (explicit-discard branch only) | manual | no | no |
| 0002 reopen → wrong patient surface | P0 / HIGH | canonical day-key comparison + focus/active-record guard | `tests/date.test.ts` + UI smoke | no | no |
| 0003 sign-off 500 + burned nonce | P0 / HIGH | guarded name digest; nonce consumed only after the seal persists | `tests/signOffValidation.test.ts` | no | no |
| 0005 ClinicalFact enum membership | P1 / HIGH | membership tables + pre-matrix guard (this run) | `tests/clinicalFactContract.test.ts` | no | no |
| 0009 poll vs in-flight save | P1 / HIGH | `mergeConsultationLists` + in-flight id set (this run) | `tests/consultationList.test.ts` | no | no |
| 0012 overlapping saves | P1 / MODERATE | live list store (this run) | `tests/consultationList.test.ts` | no | no |
| 0014 empty consultation body | P2 / MODERATE | minimum-content gate → 400 `CONSULTATION_REQUIRED_FIELDS` | `tests/server.test.ts` | no | no |
| 0015 id collision silent overwrite | P1 / MODERATE | 409 `CONSULTATION_ID_CONFLICT`; JSON store first-write-wins | `tests/server.test.ts` | no | no |
| 0016 patient DOB alias/malformed | P2 / MODERATE | `parsePatientDob`; 400 `INVALID_DOB` | `tests/patientIdentity.test.ts` | no | no |
| 0018 25s poll vs 45s backoff | P2 / MODERATE | client poll budget derived from the server ladder | `tests/noteJobs.test.ts` | no | no |
| 0026 phone-only match on a DOB-less chart | P3 / LOW | asserted-but-uncorroborated DOB → ambiguous | `tests/patientIdentity.test.ts` | no | no |
| 0042 malformed JSON → HTML | P2 / LOW | 4-arity `/api` error handler (`bf07bb8`) | `tests/server.test.ts` | no | **no — still live in production** |

## 4. ITEMS RELEASED AND PRODUCTION-VERIFIED

**QLE-2026-0022 only.** Released as PR #7 (`origin/main` @ `23768f8`) and verified
against production with a real browser session on the production origin:
`GET/POST /api/<unknown>` and a nested unknown path all return
`404 application/json {"error":"API endpoint not found","code":"API_NOT_FOUND"}`,
while `GET /api/consultations` still answers 401 and `/` and `/chairside` still answer
the SPA. Evidence: [PRODUCTION-PROBE-2026-09-30.md](reports/releases/PRODUCTION-PROBE-2026-09-30.md).

QLE-2026-0042 is the counter-example and was re-confirmed live in the same session:
`POST /api/consultations` with a malformed body returns Express's HTML
`Bad Request` page, not `{"code":"INVALID_JSON"}`.

## 5. REMAINING UNTOUCHED ITEMS (29)

| Priority | Ids | Note |
|---|---|---|
| P0 | **0004** | recording state lives only in an unmounting component; needs a second live reproduction and a persistence decision |
| P1 | 0006, 0007, 0008, 0010, 0011, 0013 | all HIGH except 0011/0013 (MODERATE) |
| P2 | 0017, 0019, 0020, 0021, 0023, 0024, 0025, 0029*, 0031, 0032* | *blocked (see §6) |
| P3 | 0027, 0028, 0030, 0033, 0034, 0035, 0036, 0037, 0038, 0039, 0040, 0041 | incl. four non-defect observations (0030, 0032, 0039, 0041) |

## 6. BLOCKED ITEMS AND EXACT BLOCKERS

- **0029** (clinical-risk verdict withheld, 4 red tests) and **0032** (Postgres
  `SKIP LOCKED` / rollback rehearsal never executed): both need infrastructure that
  does not exist here — a quota-healthy Gemini key and a Postgres instance.
- **0006** (durable-job id derived from the client id only when UUID-shaped): the
  convergence fix needs a decision that is not mine to make — with the new
  QLE-2026-0015 409 gate, a converged record would make the client POST collide, so
  409-vs-upsert has to be settled first. Recorded, not implemented.
- **0007** (three server-side writers bypass `recordGovernance`): the fix is to route
  every writer through one governance path. That is a refactor of the write path for
  signed records; I did not start it rather than leave it half-applied.
- **0013** (utterance attributed to the wrong encounter): `handleAppendTranscriptText`
  already binds each utterance to the encounter id at capture time, but the *persisted*
  transcript is accumulated as `[...consultation.transcript, newUtterance]` from a base
  that is one render behind, and `pendingSaveConsultationRef` holds only one pending
  record — so a save for encounter A is discarded when B speaks inside the 2s window.
  A correct fix has to bind pending saves per encounter id **and** fold the live overlay
  at flush time; getting that wrong converts a lost utterance into a duplicated one, so
  it needs its own change with its own tests.
- **0010** (two tabs, one localStorage key, no reconciliation): the fix is a merge
  policy across tabs. QLE-2026-0009 now bounds the damage inside one tab; choosing
  between storage-event reconciliation, BroadcastChannel and dropping the mirror is a
  product decision.
- **0031** (a stray `DATABASE_URL` in `.env.local` silently selects the remote
  persistence mode — `.env.local` in this checkout does contain one): the guard needs a
  decision about the default for a developer's own database, because the safe direction
  (ignore a file-sourced `DATABASE_URL` outside production) changes local `npm run dev`
  from Postgres to the JSON store. Not implemented unilaterally.
- **0011** (silent 409 `GENERATION_IN_PROGRESS` after a mid-finalization refresh): the
  deferral to the peer request is deliberate and correct; making it *visible* needs UI
  work in a 4,170-line component with no DOM test runner in this environment, and
  auto-adopting the peer's note is the wrong answer (it would silently replace content).

## 7. HIGH CLINICAL-RISK ITEMS REQUIRING HUMAN APPROVAL

Ledger entries 0001–0010 are HIGH clinical risk, i.e. inside the non-negotiable list
from the brief. Of these, **0001, 0002, 0003, 0005, 0009** are implemented and tested
but must not be deployed before the clinical sign-off the brief reserves for a human;
**0004, 0006, 0007, 0008, 0010** have no code change at all.

`HUMAN_SAFETY_REVIEW_REQUIRED` — 0001, 0002, 0003, 0005, 0009.

## 8. TESTS EXECUTED AND RESULTS (this run, on this tree)

| Gate | Command (binaries, not the bun scripts) | Result |
|---|---|---|
| TypeScript | `node_modules/.bin/tsc -b --noEmit` | exit 0 |
| Full unit + integration suite | `node_modules/.bin/vitest run --fileParallelism=false --test-timeout=60000` | **67 files passed, 1 skipped; 1,167 tests passed, 19 skipped; 63.15s** |
| Production build | `node_modules/.bin/vite build` + `esbuild server.ts --bundle --platform=node` | exit 0 / exit 0 (only the pre-existing >500 kB chunk warning) |
| Clinical evaluation | `tsx scripts/eval-notes.ts --offline --min-score 0.9` | 3/3 PASS, average score 1.000, safety failures 0, exit 0 |
| Clinical benchmark | `tsx scripts/run-clinical-benchmark.ts` | 20/20 cases, WCER 0.00%, FDI precision/recall 100%, pharmacology sensitivity 100%, 2.0 ms, exit 0 |
| Gold set | `tsx scripts/eval-gold-set.ts` | 0 critical errors across 7 cases; regression fixtures ALL PASS; exit 0 |
| API end-to-end flow | `tsx scripts/phase11-e2e-flow.ts` | `=== RESULT: ALL CHECKS PASSED ===` exit 0 |
| Browser smoke (real Chromium) | `tsx scripts/phase12-ui-smoke.ts` | `=== RESULT: ALL SMOKE CHECKS PASSED ===` exit 0 |
| Encounter-safety smoke (two browser contexts) | `tsx scripts/phase13a-encounter-safety-smoke.ts` | `=== RESULT: ALL ENCOUNTER-SAFETY CHECKS PASSED ===` exit 0 |

The 1 skipped file is `tests/postgres.test.ts` (19 tests) — it self-skips without a
database. The 19 individual skips include the live-Gemini integration cases, which
self-skip on `RESOURCE_EXHAUSTED`. So: **Postgres-backed paths and live-model
generation are not verified by this run.**

The three phase gates were re-run after the `src/App.tsx` and `clinicalFactMigration.ts`
changes, because those changes sit on paths the smokes exercise. Their pass is the
evidence that the dentist journey (focus invariant, sign-off refusal, server-minted
seal, signed-record immutability after reload, 409 `RECORD_SIGNED`, 409 `REPLAY`) is
intact on the current tree — not just that unit tests are green.

## 9. REVIEWER-ROLE OUTCOMES

None executed. `docs/agents/HERMES_CONTRACT.md` describes HERMES as a relay role, not
the reviewer: independent verification belongs to CLINICAL_VERIFIER / ARCHITECT /
DETERMINISTIC_TESTER / E2E_TESTER / SECURITY_REVIEWER, whose output is a report block
plus `reports/continuous/hermes-log.md`. No such log or review artifact exists in this
checkout (the directory contains only `.gitkeep`), and no runner for those roles is
available in this environment. Therefore:

- **every one of the 12 implemented fixes is UNREVIEWED**, including the nine from
  RUN A, and
- per the repository's own separation (IMPLEMENTED ≠ REVIEWED ≠ RELEASED ≠ VERIFIED),
  none of them may be released on the strength of this run's tests alone.

Claiming otherwise would be fabricated evidence.

## 10. PRODUCTION VERIFICATION RESULTS

| Target | Result |
|---|---|
| Release commit in production | `origin/main` @ `23768f8` (PR #7) |
| QLE-2026-0022 contract | PASS (4 unknown-path probes, nested path included) |
| Invariants alongside it | PASS — known route still 401, `/` and `/chairside` still SPA 200 |
| QLE-2026-0042 | **FAIL — still live in production** (HTML `Bad Request`) |
| Vercel deployment record / CI conclusions | **not obtained** — no `vercel` or `gh` CLI and no tokens in this environment |
| Probes 2–10 (the other fixes) | not applicable — none of them is deployed |

Direct `curl` to the production origin is still answered by the Vercel edge Security
Checkpoint (429, `X-Vercel-Mitigated: challenge`), so the probes were issued as
same-origin `fetch` calls from a real Chromium session. No request mutated data.

## 11. EXACT NEXT HUMAN ACTIONS

1. **Decide the release vehicle for the 12 uncommitted fixes.** They are all in one
   working tree on one branch. The narrowest safe path is to split them into the
   fewest reviewable commits that keep clinical-risk items separate from the rest
   (suggested: 0042 + 0014 + 0015 + 0016 + 0026 as one API/contract commit; 0003 as its
   own; 0005 as its own; 0009 + 0012 as one; 0018 as its own; 0001 + 0002 as their own).
2. **Commission the independent reviews** that gate the HIGH-risk items: 0003 and 0005
   (sign-off / ClinicalFact semantics), then 0001 and 0002 (identity and clinical
   content), then 0009 (in-flight clinical state).
3. **Answer the three product questions** this run explicitly did not decide: does an
   in-progress scratchpad have to survive logout (0001); is 409 or upsert correct on a
   consultation id collision (0015 / 0006); and what should a file-sourced
   `DATABASE_URL` do outside production (0031).
4. **Deploy QLE-2026-0042 first once reviewed** — it is the only already-fixed defect
   whose fix is confirmed *absent* from production, and it is P2 / LOW risk.
5. **Decide the vehicle for 0013 / 0010 / 0011** (transcript attribution, cross-tab
   reconciliation, visible generation conflict) before they are implemented, because
   each has a wrong-but-plausible fix that would convert lost content into duplicated
   or silently replaced content.

## REMAINING WORK BY CLASS

- **P0:** 0004.
- **P1:** 0006, 0007, 0008, 0010, 0011, 0013 (0005, 0009, 0012 now implemented).
- **HIGH clinical risk, no code change yet:** 0004, 0006, 0007, 0008, 0010.
- **Safe deferred:** 0021, 0023, 0024, 0025, 0027, 0030, 0033, 0035, 0037, 0038, 0039,
  0040, 0041.
- **Evidence required:** 0017 (concurrent probe), 0019 (duplicate-transcript source),
  0029 (quota-healthy key), 0032 (a Postgres instance), plus a second live
  reproduction for 0004.
- **Non-blocking observations:** 0030, 0032, 0039, 0041.

## FINAL VERDICT

Demonstrated: QLE-2026-0022 fixed, released and production-verified; QLE-2026-0042
confirmed still broken in production; twelve defects (three of them from this run) with
implemented, regression-tested fixes in the working tree; and every gate that can run
offline on this tree green — typecheck, 1,167 unit/integration tests, production build,
clinical eval, benchmark, gold set, API E2E, browser smoke and the two-browser
encounter-safety smoke.

Not demonstrated, and not claimed: independent review of any of the twelve; any
deployment, merge or commit; Postgres-backed behaviour; live-model note generation; and
any production verification for defects other than QLE-2026-0022. Twenty-nine findings
still have no code change, five of them HIGH clinical risk. This is a working tree ready
for review, not a dentist-ready release.
