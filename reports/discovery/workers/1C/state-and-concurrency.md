# Discovery Worker 1C — STATE AND CONCURRENCY

Scope: client/server state-management and race-condition defects in the chairside
workflow. No code changes. Evidence is line-referenced; all attacks were executed
analytically against the code paths (static timing analysis), not against a live
server — network timings below are derived from the code's own constants
(debounce 2000ms, poll 30s, job poll 600ms/25s deadline, seal persistence latency).

Files examined:
- `src/components/ChairsideWorkspace.tsx` (4066 lines — all state, transitions, finalization)
- `src/App.tsx` (consultation store, saves, 30s poll, conflict handling)
- `src/lib/encounterSession.ts` (lifecycle state machine, patient-switch gate)
- `src/lib/signOffClient.ts` (sign-off transport)
- `src/server/signOffValidation.ts` (server sign-off gate)
- `src/server/recordGovernance.ts` (PUT version check, version stamping)
- `src/server/stores.ts` (`updateIfVersionMatches`)
- `server.ts` (sign route, PUT route, `/api/generate-notes` in-flight gate, `/api/notes/jobs` dedupe, `persistSeal`)

---

## Executive summary

16 issues found. The dominant defect class is **stale-closure + no-ownership-check
async completion**: finalization, sign-off and progress-note saves read encounter
identity and record state at call time but write back without re-checking whether
the active patient moved during the await. Secondary class: **client memory is the
only home for several durable-looking states** (seal mirror, failed-marker,
in-flight dedupe, replay nonces), which deserialize across reload/two-tab in
surprising ways. Server optimistic concurrency is real but only enforced when the
client sends `expectedVersion` — and the client's own save path can bypass it.

Severity key: **C** = clinical-data-loss/cross-patient risk, **H** = state
corruption or wrong record surfaced, **M** = confusing/duplicated work,
**L** = cosmetic or self-healing.

---

## ISSUE-1C-01 — Stale-writer: finalization writes into `onSaveConsultation` after the active patient switched
Severity: **C**

- CLIENT STATE: `activePatientId` = B (user clicked patient B mid-finalization).
- SERVER STATE: consultation A unchanged (finalization response in flight).
- EXPECTED: A's finalized note lands on A; UI shows B's chart.
- ACTUAL: `executeBackgroundNoteFinalization` captured `targetConsult` from
  `consultations` at call time (ChairsideWorkspace.tsx ~2196) and awaits
  `onSaveConsultation(finalizedConsultation)` (~2760). The write itself targets
  A (id is captured), so the *record* is correct — but the client-state
  consequences are not: `addScheduleItem(..., status:'done')` fires against
  "today" regardless of which patient is now active, `handleCopyPMS` (autoCopy
  path) copies **A's note text while the clinician is looking at B** —
  `handleCopyPMS` falls back to `activeEncounter?.id || effectiveEncounter.id`
  (~3040) only when no consult is passed, but `executeBackgroundNoteFinalization`
  passes `finalizedConsultation`, so this specific path is safe; the danger is
  the reverse direction below (ISSUE-1C-02).
- TRANSITION: `IN_CHAIR(A) → FINALIZING(A)` ∥ `manual switch → IN_CHAIR(B)`.
- TRIGGER: click patient B (or ⌘→) while finalization is in flight.
- RACE WINDOW: entire finalization duration — direct gen ~1.3s, Tier-2 job poll
  up to 25s, transcription request before generation (unbounded).

## ISSUE-1C-02 — `handleProgressNoteChange` async save can land on the wrong encounter after a rapid switch
Severity: **C**

- CLIENT STATE: user types in the note canvas for A, then immediately clicks B
  before the PUT resolves.
- SERVER STATE: A's record may be updated with A's text (correct id), B's record
  untouched.
- EXPECTED: no cross-encounter contamination of client state.
- ACTUAL: `handleProgressNoteChange` reads `activeEncounter?.id ||
  effectiveEncounter.id` **at call time**, then `await onSaveConsultation(...)`
  (~1390–1410). The `setProgressNoteSaveStatus(prev => … [targetId]: 'saved')`
  after the await uses the captured `targetId`, so status is keyed correctly —
  but `onSaveConsultation` in App.tsx re-reads `consultations` **stale**:
  `handleSaveConsultation` builds `newList` from the closure `consultations`
  array (App.tsx ~540–556) and does `setConsultations(newList)`. Two saves
  racing (autosave for A flush + B's first keystroke save) each compute
  `newList` from the same pre-update snapshot, so the second `setConsultations`
  can revert the first save's list entry — a lost update in client state that
  then round-trips to the server on the next save.
- TRANSITION: `SAVING(A) → switch → SAVING(B)`; completion order undefined.
- TRIGGER: type → switch within the PUT latency window (typ. 50–300ms local,
  seconds on serverless cold start).
- RACE WINDOW: fetch issuance → `res.ok` branch in `handleSaveConsultation`.

## ISSUE-1C-03 — Duplicate finalization: client ref is per-tab, server 409 gate is per-process
Severity: **M**

- CLIENT STATE: `finalizationInFlightRef` contains targetId (sync guard,
  ~2140–2150). `backgroundFinalizingIds` also contains it.
- SERVER STATE: `directGenerationInFlight` map holds the consultation key
  (server.ts ~4735–4750), 130s safety timeout.
- EXPECTED: second finalization request is a no-op.
- ACTUAL: three independent guards, three different memory domains:
  (a) `finalizationInFlightRef` is a React ref — one per mounted component/tab;
  two tabs finalizing the same encounter both pass locally. (b) The server's
  `directGenerationInFlight` is in-process memory — two server instances (or a
  serverless cold start between the two requests) both accept. (c) If the first
  attempt fell back to the Tier-2 durable job, dedupe there is by job-id =
  consultationId — but only when `consultationId` is a **UUID**
  (`isUuid` check, server.ts ~2015). `sched-…`, `chairside-…` and
  `walkin-…` ids are not UUIDs, so duplicate jobs get fresh `crypto.randomUUID()`
  ids and **both run**. Result: double generation cost, two competing
  `onSaveConsultation` writes of different note bodies for one record; last
  writer wins at the record level and the loser's content is silently dropped.
- TRANSITION: `FINALIZING` (tab1) ∥ `FINALIZING` (tab2).
- TRIGGER: attack 4 (duplicate finalization) or attack 10 (two tabs).
- RACE WINDOW: from first POST to `res.on('finish')` (~1.3–130s).

## ISSUE-1C-04 — Retry after failed finalization can resurrect a stale transcript snapshot
Severity: **H**

- CLIENT STATE: `failedEncounterIds` has A; user clicked Retry (clears marker,
  ~3780) then `executeBackgroundNoteFinalization(p.id, false)` — **no snapshot
  args**, so the function re-derives the transcript from
  `localLiveTranscriptsRef.current[targetId] || localLiveTranscripts[targetId]`
  vs `targetConsult.transcript` with the heuristic `localFeed.length >=
  remoteFeed.length` (~2215–2235).
- SERVER STATE: A's record may have gained a longer server-diarized transcript
  (recording uploaded meanwhile).
- EXPECTED: retry uses the best available transcript.
- ACTUAL: the length heuristic prefers the (older, possibly shorter) local feed
  whenever `localFeed.length >= remoteFeed.length`; a local feed equal in count
  but stale in content shadows a fresher server transcript. Retry also re-runs
  `requestTranscription`, so the failure path is recoverable, but the merged
  transcript is order-sensitive and the "prefer local on tie" rule is a silent
  stale-writer.
- TRANSITION: `FAILED → FINALIZING (retry)`.
- TRIGGER: attack 5 (retry finalization) after a transcription failure.
- RACE WINDOW: between original failure and retry click (unbounded; human-scale).

## ISSUE-1C-05 — Sign-off busy-guard is global (`signOffBusyId`) but sign-off targets `activeEncounter` at call time
Severity: **H**

- CLIENT STATE: `signOffBusyId = A`; request in flight. Clinician clicks ⌘← to
  patient B, then the A response lands.
- SERVER STATE: A's seal persisted (durable); response `recordVersion` returned.
- EXPECTED: A becomes Signed (badge on A); B unaffected.
- ACTUAL: on success the handler writes
  `setSignOffSeal(prev => ({...prev, [targetId]: seal}))` — keyed by the
  **captured** targetId, correct. But `setSignOffBusyId(null)` in `finally`
  releases the global lock even if the active encounter is now B, enabling an
  immediate sign request for B while A's *server-side* `persistSeal` write may
  still be racing a concurrent `PUT /api/consultations/A` from the flush of
  A's debounced transcript save (`flushPendingConsultationSave` runs before
  finalization/sign flows, but a 2s debounce can fire mid-sign). That PUT bumps
  `recordVersion` (recordGovernance stamps +1) **after** the seal was written;
  the signed record then carries a version that no client holds, and the next
  client save from state gets a surprise `STALE_WRITE` 409 (App.tsx conflict
  banner) for a record the user believes was finalized.
- TRANSITION: `READY(A) → SIGNED(A)` ∥ `PUT(A) version++`.
- TRIGGER: attack 15 (sign-off followed immediately by navigation) combined
  with a pending debounced save.
- RACE WINDOW: seal persist (server, ~10–200ms) vs debounced PUT issuance.

## ISSUE-1C-06 — Server `persistSeal` read-modify-write is not atomic; concurrent PUT can drop the seal
Severity: **C**

- CLIENT STATE: n/a (server-side).
- SERVER STATE: sign route validated at version V, then `persistSeal` runs:
  load record → spread `{...existing, attestation: seal}` → `dbUpdateConsultation`
  (server.ts ~433–457). Meanwhile a `PUT /api/consultations/A` (e.g. the
  finalization save from Tier-2, or another tab) does `{...existing, ...payload}`
  and writes.
- EXPECTED: whichever writes second preserves the seal (or the PUT is refused).
- ACTUAL: **neither preserves the other.** The PUT branch refuses when
  `existing.attestation` is present (signed immutability, ~3855), but the check
  and the write are two separate loads — a PUT that loaded `existing` before the
  seal landed writes the merged body **without the seal**, clobbering it. The
  seal's own response already told the client "signed", so client state says
  SIGNED while the server record is unsigned: server/client disagreement, and
  the record is re-editable (seal loss = immutability loss).
  The JSON-store path has the same read-modify-write shape
  (`readConsultationsDb` → index write → `writeConsultationsDb`).
- TRANSITION: `validate(version V) → persistSeal` ∥ `PUT(existing V, no seal)`.
- TRIGGER: attack 4/14 (finalization completing at sign time; reload-triggered
  flush after mutation).
- RACE WINDOW: `loadConsultation` inside validate → `persistSeal` write (~ms to
  ~100ms; wider on Postgres cold pool).

## ISSUE-1C-07 — Replay nonce store is in-memory and unbounded: restart forgets, long uptime grows
Severity: **M**

- SERVER STATE: `consumedNonces: Set<string>` in `createSignOffValidator`
  (signOffValidation.ts ~140).
- EXPECTED: replay of `requestNonce` always refused.
- ACTUAL: (a) process restart empties the set — the primary replay guard is
  correctly the **persisted seal** (checked before nonces, ~186), so a replay
  against an already-sealed record still fails; but a replay racing the *first*
  sign-off across a restart window (seal not yet persisted, nonce set empty)
  can double-sign in principle. (b) The set grows without bound for the
  process lifetime; every successful sign adds `${id}:${version}`. Cosmetic
  leak, but on a long-lived node it is unbounded memory.
- RACE WINDOW: between seal validation and `persistSeal` completion, across a
  process restart.

## ISSUE-1C-08 — `serverRecordVersions` accepts client-supplied `recordVersion` in sign-off target derivation
Severity: **H**

- CLIENT STATE: `signOffTargetVersion = serverRecordVersions[id] ??
  consultations.find(...)?.recordVersion` (~628).
- SERVER STATE: actual `record_version` in DB.
- EXPECTED: sign-off always framed against a server-confirmed version.
- ACTUAL: the primary path is fine (versions only set from server responses),
  but the fallback reads `consultations[...].recordVersion` where
  `consultations` includes **client-merged records** — App.tsx's
  `handleSaveConsultation` optimistically inserts the client-built
  `updatedWithDentist` object (which carries whatever `recordVersion` the
  client's copy had, possibly from an old server response, possibly absent) into
  state **before** the PUT resolves. A sign-off issued during that window
  frames `expectedVersion` from the optimistic copy → guaranteed `stale_version`
  409 (benign) or, if the version happens to match, signs against content that
  is not what the user reviewed (the merged body differs from what the digest
  will be computed over only if another writer changed content — in which case
  the version check catches it; the real defect is the 409 noise + the
  reconciliation path overwriting the user's on-screen edits with
  `serverConsultation`).
- TRANSITION: `optimistic save in flight → sign-off click`.
- TRIGGER: attack 6/14.
- RACE WINDOW: PUT issuance → server response reconcile.

## ISSUE-1C-09 — 30s roster poll merge can revert optimistic client state (server/client disagreement window)
Severity: **H**

- CLIENT STATE: `localLiveTranscripts[A]` holds N optimistic lines;
  `consultations` holds the last synced A.
- SERVER STATE: A's transcript as last PUT (may lag the local buffer by the
  2s debounce).
- EXPECTED: poll refreshes server-owned fields, preserves live local buffers.
- ACTUAL: `fetchConsultations` **replaces** the whole `consultations` array with
  `server data overwrites local` (App.tsx ~420–424) and persists that merged
  map to localStorage. Any optimistic client field that lives *inside the
  consultation object* (transcript, findings written by the finalization save,
  `recordVersion`) is replaced by the server copy mid-flight: a finalization
  save that resolved after the poll request was issued is reverted on the next
  poll response, and the reverted record (older version) then seeds the next
  PUT with an old `expectedVersion` → self-inflicted STALE_WRITE loop until
  reconcile. The live transcript buffer (`localLiveTranscripts`) is separate
  state and survives, so the *merge in `patientEncounters`* hides most of this
  — except for encounters whose dialogue lives only server-side.
- TRANSITION: `poll GET resolves` vs `PUT resolves` — unordered.
- TRIGGER: attack 12 (delayed response arriving after newer state); guaranteed
  under serverless cold starts (poll latency > save latency).
- RACE WINDOW: poll fetch issuance → its response applied; any save completing
  inside it is lost from client state.

## ISSUE-1C-10 — Navigating during finalization: `backgroundFinalizingIds` survives, but the failed marker can pin a dead encounter
Severity: **M**

- CLIENT STATE: A finalizing in background; roster update deletes/renames A
  (walk-in edited on second browser, or day changed).
- EXPECTED: in-flight finalization completes; A leaves the day view; state
  cleans up.
- ACTUAL: on failure, the catch sets `failedEncounterIds[A]` and a toast
  (~2850). Nothing ever removes A from `failedEncounterIds` if A later
  disappears from `encountersForDate` — the set (and
  `backgroundFinalizingIds`, which is only cleared by the `.finally` of the
  specific call) can hold ids that no longer render. Not user-visible, but
  `sessionActive = backgroundFinalizingIds.size > 0` (~515) stays **true** with
  an orphaned id, which blocks external-poll patient switching for up to 25s
  after the encounter is gone — a stale-writer gating live navigation.
- TRANSITION: `FINALIZING(A)` ∥ roster removes A.
- TRIGGER: attack 2 (navigate during finalization) + second-browser roster edit.
- RACE WINDOW: finalization duration; the block persists until the promise
  settles.

## ISSUE-1C-11 — Refresh during finalization loses the entire orchestration; durable job is the only survivor
Severity: **H**

- CLIENT STATE: reload wipes `backgroundFinalizingIds`,
  `finalizationInFlightRef`, `localLiveTranscripts` (React state; localStorage
  is not used for the live buffer), `editedProgressNotes`, `progressiveDrafts`.
- SERVER STATE: if the attempt reached Tier-2, a durable job exists keyed by
  consultationId (UUID cases converge; non-UUID cases duplicate — see
  ISSUE-1C-03). If it was still in the direct/sync path, nothing durable
  exists except uploaded audio chunks.
- EXPECTED: post-reload the note either exists or is visibly re-runnable.
- ACTUAL: the encounter renders `ready` (no `backgroundFinalizingIds`, no
  `failedEncounterIds`), and the sync path's server-side in-flight entry
  (`directGenerationInFlight`) holds the gate for up to 130s — a post-reload
  retry within that window gets **409 GENERATION_IN_PROGRESS** and silently
  returns `undefined` (client logs info, no UI state change), so the user sees
  "nothing happened" for up to ~2 minutes. Meanwhile the local transcript
  snapshot that fed the original attempt is gone; only the uploaded 5s audio
  slices remain (those did persist).
- TRANSITION: `FINALIZING → (reload) → SCHEDULED/ready`.
- TRIGGER: attack 3 (refresh during finalization).
- RACE WINDOW: 0–130s after reload for direct-path retries.

## ISSUE-1C-12 — Two tabs: both hold `activePatientId`; external-poll switch lock is per-tab
Severity: **H**

- CLIENT STATE: tab1 active=A recording; tab2 active=A idle, manual lock unset.
- SERVER STATE: A's transcript grows from tab1's debounced saves.
- EXPECTED: tab2 must not move focus or fire competing writes for A.
- ACTUAL: tab2's roster effect sees A's `diarizedTranscript.length > 1` and,
  with no session active in tab2 and no manual lock, `decidePatientSwitch`
  *allows* external switching (correct per design), but tab2 also runs the
  30s poll → `fetchConsultations` → `saveLocalConsultations(merged)`. Both tabs
  write the same localStorage key `dentai:consultations` (via
  `saveLocalConsultations`) with independently merged maps: tab1's newer local
  buffer is overwritten by tab2's stale merge and vice versa — a classic
  lost-update on the shared cache, surfacing as flickering transcript history
  and, worst case, a save from tab2 built on tab1's older record shape
  (ISSUE-1C-02's revert mechanism, cross-tab).
- TRANSITION: `poll(tab2) applies` ∥ `save(tab1) applies` to same key.
- TRIGGER: attack 10 (two tabs).
- RACE WINDOW: any 30s poll tick in either tab while the other holds newer
  state. No `storage` event listener exists to reconcile cross-tab writes.

## ISSUE-1C-13 — `hasUserManuallySelectedRef` is sticky forever: external suggestions are permanently dead after first click
Severity: **M**

- CLIENT STATE: user clicked any card once at 9:00; `hasUserManuallySelectedRef`
  = true, never reset (no code path clears it; even day change keeps it).
- SERVER STATE: n/a.
- EXPECTED: per-day or per-session focus lock semantics.
- ACTUAL: the walk-in suggestion branch and the live-discussion suggestion
  branch are both gated on `!hasUserManuallySelectedRef.current` — after the
  very first manual click in the tab's lifetime, the clinician never again
  receives auto-focus on a newly arrived walk-in until reload. This is a
  one-way latch (state that never resets), which combined with
  `lastKnownWalkinIdRef` remembering only the *latest* walk-in means a
  second walk-in arriving while locked is never even suggested.
- TRIGGER: attack 1/9 variants; everyday use.
- RACE WINDOW: n/a (design bug, not a window).

## ISSUE-1C-14 — `chairside-${Date.now()}` quick-start id collides and breaks UUID-only server dedupe
Severity: **M**

- CLIENT STATE: `handleQuickStartRecording` mints `chairside-${Date.now()}`
  (~1010) and immediately `handleSelectPatient` + 150ms-delayed
  `handleStartAudio`.
- SERVER STATE: none yet for this id.
- EXPECTED: unique encounter identity; Tier-2 job converges on it.
- ACTUAL: two rapid quick-starts in the same millisecond (double-click/
  keyboard mash, attack 1 pattern) mint the same id; both `onSaveConsultation`
  calls then race — the first is `POST` (new), the second computes `isNew`
  from the *stale closure* `consultations` and also POSTs; server POST path
  upserts by id (JSON) so the second overwrites the first, but the client has
  created two schedule items pointing at one record. Non-UUID id also defeats
  the durable-job dedupe (ISSUE-1C-03c). The 150ms `setTimeout` start-audio is
  not cancelled if the patient switched again in the interim — audio starts
  against whatever encounter is active then.
- TRANSITION: `initial-selection → (150ms) → auto start-audio`.
- TRIGGER: attack 1 (rapid switches) around quick-start.
- RACE WINDOW: 150ms timer; `Date.now()` collision granularity.

## ISSUE-1C-15 — Browser back/forward + hash routing: `publicRoute` changes mid-workflow with no state guard
Severity: **L**

- CLIENT STATE: active session recording on workspace view.
- SERVER STATE: n/a.
- EXPECTED: back navigation during an active clinical session is blocked or
  confirmed.
- ACTUAL: App.tsx listens to `hashchange` and swaps `publicRoute` freely
  (~64–73). Back to `#/demo` or `#/beacon` unmounts the workspace subtree —
  mic teardown effect runs, in-flight finalization promises are orphaned (their
  `onSaveConsultation` closure still resolves and calls `setConsultations` on
  the *unmounted* App? No — App persists, only ChairsideWorkspace unmounts, so
  saves still land; but `setSignOffSeal` etc. in ChairsideWorkspace are gone).
  Forward again remounts a fresh workspace: `activePatientId` resets to
  `initialPatientId` or `''`, `localLiveTranscripts` lost. There is no
  beforeunload/confirmation guard tied to an active session.
- TRIGGER: attack 8 (browser back/forward during state transition).
- RACE WINDOW: any active session.

## ISSUE-1C-16 — Keyboard navigation passes `sessionActive: false` unconditionally
Severity: **H**

- CLIENT STATE: background finalization for A in flight
  (`backgroundFinalizingIds.has(A)` true).
- SERVER STATE: n/a.
- EXPECTED: §5/§8 focus invariant — a live session (including finalization)
  gates switching.
- ACTUAL: `handleNextPatient`/`handlePrevPatient` call `decidePatientSwitch`
  with hard-coded `sessionActive: false` (~2935, ~2980). Manual sources bypass
  anyway, so the parameter is decorative — but its falseness documents intent
  the code does not have: the *only* thing that halts on switch is the mic
  (`isMicStandbyRef`). Finalization continues (by design, non-blocking) —
  acceptable — yet the switch also does **not** snapshot-then-flush the
  pending 2s debounced transcript save for the *new* patient if the user
  ⌘→-mashes through several encounters rapidly: `flushPendingConsultationSave`
  runs per switch, but `pendingSaveConsultationRef` holds only the LAST
  consultation object built; an utterance appended between the state update
  and the flush for patient A can be flushed *onto patient B's* save if
  `activeEncounterRef.current` moved mid-`handleAppendTranscriptText`
  (the ref is read at call start, but the debounced consult object is built
  from `consultationsRef.current` at timer fire). Rapid A→B→A (attack 1) can
  attribute the final utterance of A to whichever consultation object is
  pending at flush time.
- TRANSITION: `IN_CHAIR(A) → ⌘→ → IN_CHAIR(B)` with utterance in the window.
- TRIGGER: attack 1 (rapid patient switching) with live speech.
- RACE WINDOW: utterance arrival → 2s debounce fire; ref-sync effect ordering
  (refs update in `useEffect` *after* render, so a switch in the same tick as
  an utterance reads the OLD encounter — one-render staleness).

---

## Attack-class coverage matrix

| # | Attack | Attempted | Outcome |
|---|--------|-----------|---------|
| 1 | A→B→A rapidly | Yes | ISSUE-1C-02, -16 (utterance mis-attribution, list revert) |
| 2 | Navigate during finalization | Yes | ISSUE-1C-01, -10 |
| 3 | Refresh during finalization | Yes | ISSUE-1C-11 (+ -03 for durable-path) |
| 4 | Duplicate finalization | Yes | ISSUE-1C-03 |
| 5 | Retry finalization | Yes | ISSUE-1C-04 |
| 6 | Navigate while request pending | Yes | ISSUE-1C-05, -08 |
| 7 | Switch patient while request pending | Yes | ISSUE-1C-01, -02 |
| 8 | Browser back/forward mid-transition | Yes | ISSUE-1C-15 |
| 9 | Keyboard navigation during workflow | Yes | ISSUE-1C-16, -13 |
| 10 | Two tabs | Yes | ISSUE-1C-03, -12 |
| 11 | Stale writer | Yes | ISSUE-1C-04, -09 |
| 12 | Delayed response after newer state | Yes | ISSUE-1C-09 |
| 13 | Failed response after optimistic state | Yes | ISSUE-1C-08 (conflict path), -09 |
| 14 | Reload after mutation | Yes | ISSUE-1C-11, -06 |
| 15 | Sign-off then immediate navigation | Yes | ISSUE-1C-05, -06, -07 |

All 15 classes attempted. Network timing where observable: save debounce
2000ms (CWS ~1505), roster poll 30000ms (App.tsx ~330), job poll 600ms with
25s deadline (CWS ~2480), server in-flight gate timeout 130000ms
(server.ts ~4750), toast auto-dismiss 4500ms, chime/copy timeouts 2500–3500ms.

## Non-issues (checked and found defended)

- SIGNED is terminal in `encounterTransition`; no client edge out (§23/§24).
- Server sign route re-derives version, digest, grounding, consent fail-closed.
- PUT refuses signed-record edits (`RECORD_SIGNED`) — modulo the
  read-modify-write window in ISSUE-1C-06.
- Client sign-off refuses without a server-stamped version (`NO_VERSION`).
- Walk-in ids are collision-safe UUIDs (`generateWalkInId`).
- Durable job converges duplicates **for UUID consultation ids only** (gap →
  ISSUE-1C-03).
- `handleSelectPatient` tears down mic + clears session state on every switch.

## EXIT

PASS — every state-transition class in the assignment was exercised against the
code and mapped to a concrete defect or an explicit defense. No fixes applied.
