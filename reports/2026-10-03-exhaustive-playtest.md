# DENTAI EXHAUSTIVE PLAYTEST REPORT

**Date:** 2026-10-03 · **Target:** `vikramdarade/dentai` @ `3ca78b9` (fix/qle-2026-0042-api-error-json)
**Operator:** Freebuff (playtest role) · **Verdict:** `EXHAUSTIVE_COVERAGE_NOT_ACHIEVED` (see §22)

---

## 1. Test environment

- Windows 11 host, Git Bash; Node v24.21.0; **Bun not installed** (all scripts run via `node_modules/.bin/*`).
- Dev server: `DATABASE_URL='' PORT=4322 DENTAI_DATA_DIR=<temp> DISABLE_HMR=true node_modules/.bin/tsx server.ts`; JSON file fallback (Postgres unavailable locally); isolated throwaway data dir, so no real records touched.
- Browser: Freebuff embedded Chromium (`playwright` library, no `@playwright/test`). Single browser only.
- Console/network read via the preview panel; screenshots and rAF-driven animation are unavailable in this panel (no compositing) — recorded as environment limits.
- Unit suite: `vitest run --fileParallelism=false --test-timeout=60000` → **1246 passed / 19 skipped / 0 failed** (74 files; the 19 skips are the Postgres suite without `DENTAI_TEST_DATABASE_URL`).
- E2E: `vitest run --config vitest.e2e.config.ts` → **1/1 passed** (11.8 s) after the fix in §18/QLE-2026-0054.

## 2. Commit/build tested

`3ca78b9` (HEAD at playtest start). Working tree fixes made during the playtest: `src/components/HistoryHub.tsx`, `src/components/workspace/ContextTab.tsx`, `src/components/ClinicalWorkspace.tsx`, `e2e/smoke.e2e.ts`, `.control/quality-ledger.json`. Typecheck (`tsc --noEmit`) green after every edit; both suites re-run green at the end.

## 3. Application URL

`http://127.0.0.1:4322` (isolated dev instance; left running for inspection). Other streams' servers were left untouched (`:3000` Postgres-backed, `:4318`).

## 4. Scenario inventory count

| Group | Enumerated |
|---|---|
| Screens/routes discovered | 22 (14 reachable, 8 documented-but-unreachable/missing) |
| Public hash routes | 8 + unknown-path fallback |
| API endpoints discovered (server.ts + src/server) | ~78 |
| API/security scenarios executed | 87 (82 + 5 consent-enforced) |
| UI scenarios executed (controls, states, journeys) | ~45 |
| Total explicitly executed | ~132 |

## 5–9. Executed / PASS / FAIL / BLOCKED / NOT_APPLICABLE

- PASS **~111** · FAIL **6** (4 of them now fixed where non-protected; 2 raised as HUMAN_REVIEW) · BLOCKED **~13** · NOT_APPLICABLE **2** (documented screens with no component: `PatientIntake.tsx`, `PhoneBeaconMode.tsx` do not exist).

## 10. Overall scenario coverage %

**~72 %** of the explicitly enumerated 132 scenarios reached a terminal state *within the enumerated set*; the set itself is not the whole application (see §20–21). No claim of 100 %.

## 11–20. Category coverage (of enumerated)

| Category | % | Basis |
|---|---|---|
| Screen | ~55 % (12/22) | Reachable screens render-tested; orphaned screens blocked (import-graph evidence) |
| Control | ~45 % (≈35/75) | Click/type/disabled/keyboard on core controls; full double/rapid/wrong-state matrix not run on every control |
| API/Route | ~70 % (≈55/78 endpoints with ≥1 matrix cell) | 87 scenarios; full 8-cell per-endpoint matrix not complete |
| Golden journey | 50 % (4/8 terminal: J2, J3, J8 PASS; J4 FAIL; J1/J5 partial; J6/J7 BLOCKED) |
| Error-path | ~50 % | AI-offline, 409 conflict, session expiry, malformed/oversize; queue/network-partial paths not exercised |
| Security | ~75 % | Auth matrix, tamper, epoch, tenancy, consent query-bypass, JSON error contract; MFA + rate-limit exhaustion + multi-instance untested |
| Clinical-safety | ~65 % | All safety unit suites green; live fabrication/identity/consent/immutability probes; prompt-injection/tooth/surface live cases not run |
| Persistence | ~60 % | Note create→server→reload; idempotent shell retry; queue durability BLOCKED |
| Concurrency | ~55 % | Duplicate POST 409, stale version 409, post-sign immutability/replay; two-tab and queue races not re-exercised live |
| Responsive | ~25 % | Workspace at 390 px structurally clean; other screens/mobile interactions unverified; screenshots blocked |

## CRITICAL FINDINGS

**QLE-2026-0049 — server sign-off gate seals an ungrounded, fabricated note (P0, HIGH clinical risk, HUMAN_REVIEW).**
Repro: create a consultation with a one-line transcript ("hello") + consent, click **Create note** (live AI, 200), then `POST /api/consultations/:id/sign` with the returned version and a fresh nonce.
Actual: `groundingAudit.isApprovedForSigning: true`, `blockingReasons: []`, while `alignments.isFullyGrounded: false`, `unverifiedCount: 1`, badge "Unverified Claims Detected"; sign returns **200 + seal 28528967d70754d3** for a note asserting "Full clinical examination performed; no carious lesions", "Extra-oral WNL", "Medical History: Reviewed, no known drug allergies" — none from the transcript.
Root cause: `src/grounding/index.ts:96-113` — the low-grounding blocking reason requires `overallGroundingScore < 0.85` **and** `unverifiedCount > 2`, so 1–2 unverified claims are non-blocking.
Post-sign immutability (409) and replay (409 REPLAY) are correct. **Protected surface: evidence only — no autonomous fix.**

**QLE-2026-0050 — hardcoded fabricated default note displayed, copied, prompted and persisted (P1, HIGH, HUMAN_REVIEW).**
Any record with no `clinicalProgressNote` renders "Medical History: Reviewed. Nil known drug allergies.", "Extraoral: WNL…", "Consultation and clinical examination.", ADA 014 — from `src/components/ClinicalWorkspace.tsx:216-227 / 441-449`. It is sent as `currentNote` in the copilot prompt (contaminating generation), copied by **Copy to PMS**, and persisted on the first edit (observed: stored note + `PT-EDIT-MARKER`, version 4, `isApprovedForSigning: true`). **Protected surface: evidence only.**

**QLE-2026-0051 — HistoryHub render crash blanked the app (P0 engineering, MODERATE, PR_READY — fixed).**
Opening the hub with a stored record lacking `findings`/`appointmentType` threw `Cannot read properties of undefined (reading 'toLowerCase')` and unmounted the whole app (white screen). No `ErrorBoundary` is mounted in `App.tsx` despite the component existing. Fixed with defensive field access; hub verified rendering afterwards.

## HIGH FINDINGS

**QLE-2026-0054 — the e2e CI gate was red on HEAD (P1, NONE, PR_READY — fixed).**
The NoteTab redesign (`9869c2c`) made the formatted view the default; the smoke test waited for the raw textarea and timed out. Fixed to assert the rendered note, open the **Edit** toggle for value checks, and re-assert after reload. `npm run test:e2e` → 1/1 (11.8 s).

**QLE-2026-0056 — degraded AI is indistinguishable from success (P1, MODERATE, HUMAN_REVIEW).**
With `/api/copilot/ask` blocked, **Create note** shows "Note formatted with template." — no AI-unavailable message, no `noteOrigin`/needsReview flag, nothing saved, and the fallback is seeded with the fabricated default note. J4 fails at the UI layer. **Provenance-adjacent: evidence only.**

**QLE-2026-0057 — the live surface has no sign-off/grounding/consent UI (P2, MODERATE, OBSERVED).**
`ClinicalWorkspace.tsx` + `workspace/*` contain no sign-off, seal, grounding banner, or intake/consent control; those exist only in the unreferenced `ChairsideWorkspace.tsx` and its panels (`LiveConversationPanel`, `OperatoryPatientBanner`, `ClinicalNoteEditorPanel`, `ClinicalSummary`, `DayGuideModal`). J1's sign-off leg and J5's refusal UI are unreachable in the shipped app (verified server-side by API only). Documented screens `chairside-workspace`, `live-conversation-panel`, `clinical-note-editor-panel`, `operatory-patient-banner`, `clinical-summary`, `day-guide-modal`, `phone-beacon-mode`, `patient-intake` are orphaned or missing as components.

## MODERATE FINDINGS

**QLE-2026-0052 — Context tab infinite render loop (P2, LOW, PR_READY — fixed).** `attachments = []` default parameter minted a new array identity each render; the `[attachments]` effect set state → ~440 "Maximum update depth exceeded" per New session click. Stable constant fix; 0 errors after.

**QLE-2026-0055 — documented public routes unreachable (P2, NONE, OBSERVED).** `#/landing`, `#/demo`, `#/roadmap-prototype` all render Login; Login's own "Product overview & features" / "Watch narrated demo" buttons lead to those hashes, so they are dead ends. `Landing` is imported but has no render branch; `PatientRoadmapPrototype` is imported nowhere.

**QLE-2026-0059 — client PUT can assert `status: 'Signed'` (P2, MODERATE, HUMAN_REVIEW).** `recordGovernance` strips `attestation` but not `status`; the stored record then shows a "Signed" badge in HistoryHub with no server seal. Immutability/replay keys on `attestation`, so no seal can be forged — the risk is a misrepresented record status. **Protected surface: evidence only.**

## LOW FINDINGS

**QLE-2026-0053 — recording timer never reset (P3, LOW, PR_READY — fixed).** After recording patient A (~22 s) and switching to patient B, the shared AudioBar still showed A's `00:22`; `setRecordingSeconds` was only written by the recorder tick. Reset added in `handleStopAudio`; J2 switch now shows `00:00`.

**QLE-2026-0058 — invalid clinic invite code silently ignored (P3, NONE, OBSERVED).** Registering with `ZZZZZZ` succeeds into "Solo Practice" with no notice, while a valid code creates a pending join request.

## GOLDEN JOURNEY RESULTS

- **J1 Chair-side live scribing — PARTIAL/BLOCKED.** Recording start/pause/stop, live "Listening & taking notes chairside…", speech-service-unavailable toast, transcript scoping, note generation via live AI (200), note persist→reload (e2e) all PASS. Sign-off leg: no UI control exists → tested via API (works, but see QLE-2026-0049). Audio upload/server diarization: no real speech service in this environment → BLOCKED.
- **J2 Cross-patient boundary — PASS (after QLE-2026-0053 fix).** Switching patient mid-recording stops capture ("Consultation recording finalized."), resets the timer to 00:00, keeps transcripts isolated (0-utterance session shows empty state; no bleed), never auto-starts recording. Rapid A→B→A→B completed without state corruption. Speech-buffer contamination can't be proven without a working recogniser → noted.
- **J3 Patient identity — PASS (API).** Name-only → `ambiguous` ("Records share that name…"), conflicting DOB → not matched, name+agreeing DOB → `matched` same patient; consultation linking leaves `identityNeedsReview: true` without a second detail; malformed DOB → 400 `INVALID_DOB`; `dateOfBirth` alias stored; cross-tenant patient history 404. Name alone never establishes identity.
- **J4 Offline/degraded AI — FAIL (QLE-2026-0056).** Failure is masked as "Note formatted with template."; no origin/review flag; fallback keeps fabricated seed content.
- **J5 Sign-off refusal — PARTIAL.** Explicit refusals verified: missing `expectedVersion` → 400; unknown id → 404; no consent → 422 `CONSENT_MISSING`; post-sign PUT → 409; replay → 409; forged client seal stripped. **But** grounding does not block 1–2 unverified claims → sign-off approved an ungrounded note (QLE-2026-0049), and the UI offers no sign-off path (QLE-2026-0057).
- **J6 Long consultation — BLOCKED.** No UI upload path exists for a >75k-token recording; capacity/horizon behaviour is covered only by unit suites (`transcriptTrim`, `runawayAudio`), not live.
- **J7 Queue durability — BLOCKED.** The live UI never enqueues note jobs; the API job contract requires `intakeData`+`transcript` shapes not exercised (validation refused the probe body). Known entries QLE-0006/0017 remain the reference.
- **J8 Session epoch/revocation — PASS (API).** `revoke-all` → old token 403, re-login works, new token carries epoch > 0; PIN change retires the old token (403), old PIN 401, new PIN 200, weak new PIN refused; five wrong PINs → 429 `LOCKED_OUT` and the correct PIN stays locked; bogus recovery token → 400.

## UNTESTED / BLOCKED (exact reasons)

1. Audio upload + server-side diarized transcription — no working microphone/speech service in this environment (Web Speech `network` error; requests never reach a provider).
2. Silence auto-sleep (2 m 30 s → STANDBY) — requires 2.5 min of real audio level data; the preview panel does not deliver rAF frames reliably.
3. Postgres storage mode, SKIP LOCKED claims, migrations — no local Postgres; suite self-skips (19 tests).
4. Queue drain / cron (`/api/ops/drain`, `/api/cron/drain`) — cron disabled (503) and no ops secret configured; JSON fallback only.
5. MFA enrollment/verification, ops-console secret routes, billing webhook success path — credentials/stateful side effects intentionally not created.
6. Rate-limit exhaustion (credential/signup limiters) — deliberately avoided to keep the environment usable; headers/limits verified by code only.
7. Multi-tab / two-device concurrency on one record — single browser profile; QLE-0010/0012 remain the reference for two-tab localStorage races.
8. Offline persistence queue (banner "Records held on this device only") — needs a reachable-then-unreachable server window; not exercised end-to-end.
9. Visual/responsive verification of screenshots — panel produces no frames (compositing unavailable); only structural DOM checks at 390 px for the workspace.
10. Prompt-injection, correction ("I said 16, actually 26"), tooth-lists, deciduous teeth, surface codes, pharmacology adversarials — covered by passing unit suites (`negationScope`, `macroSparseTranscript` 202 cases, `fdiNotationEngine`, `clinicalFactContract`, `pharmacologySafetyEngine`), not live-driven.

## COVERAGE GAPS

- The 24-state × screen matrix was not executed for every screen; refresh/back/forward/direct-nav/duplicate-entry/rapid-click were spot-checked, not systematically run per screen.
- The ~78-route API matrix is incomplete: no full per-endpoint `validation / not-found / conflict / rate-limit / server-error` sweep; several route families (ops, billing, MFA, clinic export variants) only got auth-failure cells.
- Orphaned screens (ChairsideWorkspace family) were audited by import graph, not driven.
- Clinical extraction semantics are evidenced by unit tests rather than live end-to-end audio; nothing about them is disproven, but the live path (speech → persist → ground → sign) has a gap between "no speech service" and "unit fixture".
- No second device/tab, no Postgres, no Bun in this environment.

## FINAL VERDICT

**`EXHAUSTIVE_COVERAGE_NOT_ACHIEVED`**

Evidence summary: 132 scenarios reached terminal states (~72 % of the enumerated set); the application surface is larger than what one session can exhaust (24-state protocols per screen, full per-endpoint API matrices, live audio, Postgres, multi-device). Two protected-surface findings (QLE-2026-0049/0050) mean the sign-off/grounding model needs CLINICAL_VERIFIER + HUMAN_REVIEW before this work can be described as exhaustively validated; four non-protected defects found by the playtest were fixed and re-verified (QLE-2026-0051/0052/0053/0054), and the overall gate suite is green (1246 unit + 1 e2e).
