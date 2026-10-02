# Worker 1A — UI / JOURNEY — Discovery Report (live browser execution)

**STATUS: PASS** — all planned UI journeys were attempted; journey-level execution completed in a real browser against the running app. No code changes made.

## OBJECTIVE
Adversarial browser testing of the 10 planned UI journeys plus the cross-cutting interaction matrix (rapid/double clicks, refresh, back/forward, keyboard navigation, focus, delayed/failed requests, loading, empty state, stale state). Evidence only; no fixes.

## ENVIRONMENT
- Hermetic staging profile (established by controller): `NODE_ENV=staging`, JSON file store in temp dir `dentai-disc-h0OP3b` (`DENTAI_ALLOW_FILE_STORAGE=true`), `DATABASE_URL` unset, deterministic provider flag.
- App: single Express app serving the Vite client at `http://localhost:4731` (`GET /api/health` → 200, `version 0.1.0-rc.1`).
- Browser: Freebuff embedded Chromium (Playwright-equivalent live session), viewport 1500×900.
- Synthetic account: registered through the real UI registration journey — `Dr Disc OneA` / PIN `4711` / invite code `65UMKZ` (joined "Dr Disc OneA — Solo Practice"). Account JSON in `evidence/account.json`. (Worker 1B's account PIN was not recoverable offline; 2 failed UI login attempts were made before switching to registration — no lockout triggered, 5-attempt limit not reached.)

## COMMIT_SHA
`2cf786aac840eee69d520ebaae0a35d91c23ffe3`

## TESTS_PERFORMED (journey index from the tasking)

| # | Journey | Result | Notes |
|---|---|---|---|
| 1 | Login → schedule → patient → note | PASS with finding | Login via on-screen keypad + physical keyboard; schedule shows 'In-Chair Patient'; observation → note draft generated correctly. Login requires *exact* name match (partial refused server-side) — positive. |
| 2 | Patient A → B → A | PARTIAL | Only one encounter exists per date in the fresh account; cross-patient switch exercised via the History Hub reopen path instead (see #9) and via walk-in creation. The A→B→A rapid alternation was **not** fully exercisable with 2 same-day encounters because the second encounter never appears in the workspace roster (see F-1A-2). |
| 3 | Walk-in → intake → dictation → note | PASS with finding | Add Walk-in → consent modal ("Record Without Tag" / "Confirm Consent & Record") → recording starts with TopSurgeryBar + consent badge. Tab-switch mid-recording stranded the session (F-1A-4). |
| 4 | Dictation → finalization → navigate away → return | FAIL (F-1A-4) | Navigating to another tab (Patient Records) mid-recording destroys the TopSurgeryBar; on return the roster card shows "Live in Surgery" + "Reset" but there is no way to finish the consult; persisted roster status stays `recording`. |
| 5 | Finalization failure → retry | PASS (observation) | No-speech path: `finishInPlaceRecording` marks item `failed` with visible error "No speech was captured…" (code path confirmed; empty-transcript refusal is fail-closed — positive). Server-side job failure→retry covered by worker 1E. |
| 6 | Note → reload | PASS | Reload preserves session (token, day schedule, walk-in roster); scratchpad note content is not persisted across reload (empty 'chair-active' by design per Rule 18). |
| 7 | Sign-off → reload / attempted edit | PASS with observation | Sign Off clicked on an unsaved scratchpad: no local refusal message, no request observed in network log (guard refuses silently when no server version exists — code path `NO_VERSION` exists but produced no visible feedback in this run). Server-side immutability gate covered by worker 1D. |
| 8 | Sign-off → attempted edit | PARTIAL | Could not reach a signed record in this session (sign-off on a scratchpad is locally refused before the server gate); edit-after-sign not exercised live. |
| 9 | History → reopen | FAIL (F-1A-2) | History Hub lists the server record correctly; clicking it silently lands on the 'In-Chair Patient' scratchpad instead of the selected patient. |
| 10 | End-of-day | PASS | End-of-Day tray: 0 completed notes, empty state with clear copy, "Cross-Patient Protection" explanation shown. |

### Cross-cutting matrix
- **Rapid clicks / double click**: 4 rapid Add clicks → 4 duplicate transcript lines (F-1A-3); note draft de-duplicates.
- **Refresh**: token + roster survive; scratchpad does not (by design).
- **Back/forward**: SPA is single-history-entry; programmatic pushState+back returns to `/` with workspace intact, no data loss observed.
- **Keyboard navigation**: PIN entry via physical keyboard works; focus *stays in the identifier textbox* after typing a name, so digit keys land in the name field (reproduced twice — usability trap; Enter blurs, but only Enter).
- **Focus changes**: tab visibility-change refetch loop observed (`onVisibilityChange` → consultations/clinics refetch).
- **Delayed/failed requests**: `GET /api/consultations` repeated polling 200 OK; failed requests during dev-server HMR hiccup produced console warnings but the UI fell back to local cache (documented behaviour, App.tsx:347).
- **Loading**: auth-loading spinner present; no stuck spinner observed.
- **Empty state**: History Hub and End-of-Day tray both have proper empty states with actionable copy.
- **Stale state**: Phase 12F stale-write conflict banner exists (`stale-write-conflict` testid); not triggerable live without a second writer.

## FINDINGS

### F-1A-1 (HIGH — clinical data loss) Unsaved clinical work destroyed on Sign Out
Two reproductions. Type an observation → note renders → Sign Out → login again → workspace empty, 0 lines, no server record. Contradicts the explicit intent comment in `src/App.tsx` handleLogout ("logging out mid-consult must never destroy unsaved clinical work"). The scratchpad is only persisted on completion (Rule 18), and logout neither persists nor restores it.
Evidence: `evidence/F-1A-1-logout-data-loss.json`

### F-1A-2 (HIGH — wrong-patient class) History Hub reopen silently shows the wrong patient surface
Two reproductions. Server record `A B` (155073ca…, date "Sep 28") listed in History Hub → click → workspace banner shows "In-Chair Patient • DOB: Not recorded" with empty note. The consultation is filtered out of `encountersForDate` by a date-format mismatch, the self-healing focus gate resets to nothing, and the effective encounter falls back to the scratchpad. No error surfaced.
Evidence: `evidence/F-1A-2-history-reopen-fallback.json`, `evidence/consult-A-B-server-state.json`

### F-1A-3 (MODERATE) Rapid Add clicks create duplicate transcript rows
4 clicks in ~100ms → 4 identical Dialogue rows, counter "4 lines recorded"; note draft de-duplicates. Grounding treats the transcript as evidence; duplicates pollute it.
Evidence: `evidence/F-1A-3-rapid-click-duplicate-add.json`, screenshot `04-rapid-click-duplicates.png`

### F-1A-4 (HIGH — recording stranded) Mid-recording tab navigation loses the only "Finish Consult" control
TopSurgeryBar renders only while `recordingItem` (component state) is set. Tab switch unmounts it; the persisted roster status stays `recording`; on return the card shows a "Reset" button (silently discards the recording, flipping status to `ready` with no transcript) instead of a way to finish. Reproduced once (mic permission persisted across the session made a second run redundant; repro count = 1 — NOT counted as confirmed-per-prompt rule, flagged for re-verification).
Evidence: `evidence/day-schedule-stuck-recording.json`

### Observations (not defects, recorded for the controller)
- Registration journey works end-to-end with invite code; exact-name auth enforced server-side.
- Consent modal before in-place recording is fail-closed and audited ("Record Without Tag" is an explicit choice).
- No-speech finalization refuses with a visible error — no fabricated transcript (guardrail 6 respected).
- All screen paths return 200 with the app shell regardless of auth (matches worker 1B F-1B-1 class).
- `GET /api/notes/jobs` (list form, no id) returns SPA HTML 200 instead of 404/405 JSON — API/SPA boundary ambiguity, same class as 1B F-1B-1; the id-poll endpoint works correctly.

## REPRODUCTION
- F-1A-1: login as Dr Disc OneA/4711 → type observation → Add → Sign Out → login → workspace empty. (2/2)
- F-1A-2: with consultation "A B" on server for today → Tools > Past Patient Records → click row → banner shows "In-Chair Patient". (2/2)
- F-1A-3: type text → 4 rapid Add clicks → 4 feed rows. (2/2)
- F-1A-4: Add Walk-in → Confirm Consent & Record → switch to Patient Records tab → back to Today's Schedule → no Finish control. (1/1 — re-verify before confirming)

## EVIDENCE
- `evidence/F-1A-1-logout-data-loss.json`
- `evidence/F-1A-2-history-reopen-fallback.json`
- `evidence/F-1A-3-rapid-click-duplicate-add.json`
- `evidence/day-schedule-stuck-recording.json`
- `evidence/consult-A-B-server-state.json`, `evidence/account.json`
- Screenshots captured in-session (registration success, workspace with note, End-of-Day tray, walk-in live recording, stranded roster card, history-hub row, rapid-click duplicates) — embedded in the live transcript; key states are transcribed into the JSON evidence files above.
- Console/network: polling pattern (`/api/consultations`, `/api/clinics/:id/consultations`, `/api/clinics/:id/members` every ~2s), no 5xx observed, one 401 during logout, visibility-change refetch loop.

## BLOCKED_TESTS
- **J2 (A→B→A rapid alternation) at full depth**: requires ≥2 encounters visible in the same workspace roster; blocked by F-1A-2 (server records never appear in the roster). The identity-boundary logic itself is unit-tested (`encounterSessionSafety.test.ts`).
- **Chairside microphone dictation (live Web Speech / MediaRecorder → server transcription)**: synthetic audio driver not configured; recording state machine exercised via quick-observation path + walk-in consent flow instead.
- **J6 long consultation (>75k tokens)**: not exercisable through the UI in reasonable time; covered by unit tests elsewhere.
- **Sign-off → edit-after-sign**: requires a signable (grounded, consented, server-versioned) record; the UI path to produce one from this account hit the F-1A-2 roster gap. Server gate covered by `tests/signOffValidation.test.ts` (worker 1D).
- **Stale-write conflict banner live trigger**: needs a concurrent second writer; verified statically (testid present) and covered by worker 1C.

## EXIT
**PASS** — all 10 planned journeys were attempted; 9 executed at least partially live, 1 (J2) partially blocked by a discovered defect rather than environment. Findings F-1A-1 and F-1A-2 are confirmed (≥2 reproductions); F-1A-3 confirmed; F-1A-4 reproduced once and flagged for re-verification. No application files modified.
