# Phase 13A — Encounter Session Safety Hardening

**Date:** 2026-09-28 · **Status:** `READY_FOR_PHASE_13_RELEASE` (pending the CI Postgres gate, §9) · **Base:** `main` @ `efea8ba`

---

## 1. Source-of-truth reconciliation (per the phase charter)

All investigation and implementation occurred against the **main checkout** (`git worktree list` →
`C:/Users/swati/Downloads/dentai efea8ba [main]`; branch `main`; the `.worktrees/origin` worktree
@ `92d2ba2` is a stale detached checkout and was treated as read-only history).

Every finding from the prior (stale-worktree) analysis was re-verified against the main tree
before any code was written. Findings that did **not** exist in the main checkout were rejected,
not "fixed":

| Prior (stale-worktree) claim | Verdict on main @ `efea8ba` |
|---|---|
| "Production sign-off does not exist; only a prototype" | **REJECTED.** Phase 12E server-authoritative sign-off is fully implemented: `POST /api/consultations/:id/sign`, `src/server/signOffValidation.ts`, `src/lib/signOffClient.ts`, fail-closed refusals, server-minted seal, 12-test suite. |
| "Replay guard is dead code" | **PARTIALLY CONFIRMED.** The gate existed but depended on an in-process nonce set + a client nonce unique by construction. The *persisted-seal* replay guard added in this phase (§8) makes it a durable server property. |
| "Seal is never persisted; Signed evaporates on reload" | **CONFIRMED** (S1). Fixed in this phase. |
| "Seal identity is a placeholder ('Practitioner')" | **CONFIRMED** (S3). Fixed in this phase. |
| "Focus hijack during active sessions" | **CONFIRMED** — auto-focus effect could move `activePatientId` mid-session; keyboard navigation never set the manual-selection lock. Fixed. |
| "Double finalization race on rapid next/prev" | **CONFIRMED** at the client and the synchronous API path (the durable job path was already idempotent). Fixed at both remaining layers. |
| "Server transcript ignored by the nothing-captured decision" | **CONFIRMED.** Fixed. |
| "Silent `chair-active` scratchpad wipe at end of roster" | **CONFIRMED.** Fixed (wipe only when genuinely empty). |
| "Walk-in `Date.now()` id, forced emergency template, fabricated transcript line" | **CONFIRMED** (workspace flow). Fixed. |
| "Single-key time sort; 9999 sentinel reorders the day" | **CONFIRMED.** Replaced with a shared deterministic comparator. |
| "Finalization failure invisible; 'Prior note saved' toast lied" | **CONFIRMED.** Fixed. |
| "Legacy `DayScheduleQueue` unreachable" | **REJECTED.** It is production-reachable via `HistoryHub.tsx:324`; its status semantics were corrected and its dormancy documented. |

## 2. Changes made

**New module — `src/lib/encounterSession.ts`** (the deterministic safety core; no I/O):

- `encounterTransition` / `projectLifecycleState` — explicit lifecycle state machine (§4 below).
- `decidePatientSwitch` — the ONE canonical patient-switch gate; manual sources always win,
  external sources are refused while a session is live (`external-focus-lock`).
- `resolveSubstantiveContent` — the "is there anything to finalize" decision, considering local
  transcript, **server transcript**, server-diarized transcript, note text, findings and
  in-flight finalization. Normalizes every transcript shape actually present in the codebase;
  never invents a line.
- `buildWalkInIntake` / `generateWalkInId` — collision-safe UUID ids, no fabricated speech,
  explicit-or-safe-generic appointment type.
- `compareEncounters` / `sortEncounters` / `parseEncounterTimeMinutes` — deterministic ordering
  (time → createdAt → name → id) tolerant of `9 AM`, `09:00`, `9:00 AM`, `Now (3:45 pm)`.

**`src/components/ChairsideWorkspace.tsx`** (targeted edits; no rewrite):

- Auto-focus effect rebuilt on `decidePatientSwitch`: a live session (mic active or finalization
  in flight) or an established manual lock makes external switching impossible; a refused
  suggestion surfaces as a toast ("New walk-in added: … — not switching (session active)").
- ⌘→ / ⌘← / walk-in-creation all set `hasUserManuallySelectedRef` (§7) and route through the gate.
- `handleNextPatient` uses `resolveSubstantiveContent` (server transcript now counts) and wipes
  the `chair-active` scratchpad only when content is genuinely empty.
- Truthful turnover toasts ("Finalizing prior note in background…", never "saved" prematurely);
  failures are visible and retryable (`failedEncounterIds` + Retry control; synchronous
  in-flight guard via `finalizationInFlightRef`).
- Sign-off: server-persisted seal rehydrated (`effectiveSeals`), deterministic nonce
  `${id}:${version}`, signed/unsigned badge in the turnover toast.

**Server (`server.ts`, `src/server/signOffValidation.ts`, `src/server/recordGovernance.ts`):**

- `persistSeal` dependency: the minted seal is written onto the canonical record (both Postgres
  and JSON stores) before the response leaves; a persistence failure fails the sign-off CLOSED.
- Persisted-seal replay guard: an already-sealed record is refused `REPLAY` before any other
  condition — signed survives reload, restart and a second browser.
- Practitioner identity: the sign route passes the authenticated session's `name` and AHPRA
  number per request; the seal attests WHO, not a placeholder.
- Signed-record immutability: content edits to a sealed record are refused `409 RECORD_SIGNED`
  on both storage paths (seal + server-owned integrity fields preserved).
- `attestation` added to the governance strip: a client can never POST/PUT its own seal.
- Synchronous generation mutex: `/api/generate-notes` refuses a duplicate in-flight generation
  per consultation id (`409 GENERATION_IN_PROGRESS`); the client sends `consultationId` and
  defers to the in-flight request on 409. The durable job path keeps its Phase 9 dedupe.

**`src/components/DayScheduleQueue.tsx`** (legacy, reachable): walk-ins are created
`scheduled` (no phantom "note ready"), default type is the safe generic intake, dormancy notice
retained.

**Smoke harnesses (`scripts/phase12-ui-smoke.ts`, new `scripts/phase13a-encounter-safety-smoke.ts`):**
seeds now use the app's own `getClinicTodayIso()` — a UTC-date seed silently broke every
roster-dependent case when the run crossed local midnight in a clinic-timezone-ahead-of-UTC
environment (exactly the day-boundary hazard flagged in the prior review).

## 3. State-transition model (§11/§24)

```
SCHEDULED → IN_CHAIR → FINALIZING → READY → SIGNED (terminal)
                FINALIZING → FAILED → FINALIZING (retry edge)
```

- Invalid transitions are rejected, not coerced (`encounterTransition` returns a reason).
- **SIGNED is terminal:** no edge out through normal client operations.
- **Completed ≠ Signed:** `status: 'Completed'` is a workflow flag; only the server-persisted
  `attestation` seal yields the SIGNED projection (`projectLifecycleState`).
- The projection is a pure function of server state + client tracking sets; the client never
  asserts SIGNED on its own authority.

## 4. Patient-switch invariants (§5–§8, §21)

1. While `mic live OR finalization in flight OR manual lock set`, external roster events never
   move `activePatientId` — they may suggest (badge/toast) only.
2. Every switch source (card click, ⌘→, ⌘←, walk-in creation, initial selection, self-healing
   fallback) passes through `decidePatientSwitch`; manual sources set the manual lock.
3. Wrong-patient protection: the same consultation id flows through active-encounter →
   transcription target → finalization target → sign-off target; the switch gate is the single
   point that could desynchronize them, and it is unit-tested.

## 5. Finalization idempotency (§10/§15)

| Layer | Mechanism |
|---|---|
| React render cycle | `finalizationInFlightRef` (synchronous set; released in `finally`) — two calls within one render cycle cannot both start. |
| Durable job path | Phase 9 server dedupe: job id = consultation UUID; `ON CONFLICT DO NOTHING` (Postgres) / duplicate check (JSON). |
| Synchronous path | `/api/generate-notes` per-consultation in-flight gate; duplicates get `409 GENERATION_IN_PROGRESS` and the client defers to the peer's result. |
| Client observability | The 3.5s roster poll surfaces the peer's/save's result; the client IIFE is no longer the only source of completion (cron drain remains the durable backstop). |

Finalization states are distinguishable end-to-end: `FINALIZING` (`backgroundFinalizingIds`),
`FAILED` (`failedEncounterIds`, Retry control), `READY` (generated note), `SIGNED` (persisted
seal) — never a boolean.

## 6. Walk-in provenance (§16–§18)

- `walkin-${crypto.randomUUID()}` (entropy-carrying fallback in insecure contexts) — collision-safe
  across browsers, and the UUID form enables the durable job's id convergence.
- Transcript seeded EMPTY; the old fabricated line ("Emergency walk-in encounter started for…")
  is gone. Intake context lives in `findings.customSections.intakeNote` (metadata, not speech).
- Type picker on the workspace walk-in card; empty = safe generic (`examination`/`standard`);
  `emergency`/`soap` only on explicit selection. The appointment type drives metadata and
  template selection only — it never fabricates findings.

## 7. Legacy schedule (§19)

`DayScheduleQueue.tsx` **is** production-reachable (`HistoryHub.tsx:324`). It cannot create
conflicting encounters (separate localStorage day-schedule domain; the workspace's encounter
stream is server consultations), and its status semantics no longer claim a note exists before
one does (`scheduled` on creation; `ready` reserved for generated notes). The existing dormancy
notice marks it for future consolidation into `ChairsideWorkspace`.

## 8. Sign-off persistence (§22/§23)

- The Phase 12E endpoint was **not** redesigned — it gained one dependency (`persistSeal`) and
  one earlier guard (persisted-seal replay). The server remains the only sign-off authority; no
  client-side state machine bypasses `POST /api/consultations/:id/sign`.
- Signed state now persists on the record (`attestation`), is rehydrated by every client
  (`effectiveSeals` merge of server seals + in-session mirror), survives reload/restart/second
  browser, and is protected by `409 RECORD_SIGNED`.
- Turnover exposes signed/unsigned state (toast badge) so the clinician leaves each patient
  knowing what still awaits sign-off.

## 9. Test results (executed on this tree)

| Gate | Command | Result |
|---|---|---|
| TypeScript | `npx tsc -b --noEmit` | **0 errors** |
| Unit/integration | `npm test` | **1123 passed / 19 skipped (postgres) / 0 failed** — includes 40 new Phase 13A tests |
| New: state machine, focus gate, content resolution, walk-ins, ordering | `tests/encounterSessionSafety.test.ts` | **32/32** |
| New: seal persistence, replay-after-reload, fail-closed persistence, session identity | `tests/signOffPersistence.test.ts` | **8/8** |
| Clinical eval | `npm run eval:notes` | **3/3**, avg 1.000, 0 safety failures |
| Benchmark | `npm run eval:benchmark` | **20/20**, FDI 100%/100%, pharmacology 100% — AHPRA & DBA satisfied |
| Gold set | `npm run eval:gold-set` | **0 critical-error ledger entries**; evidence grounding 100.0%, provenance errors 0.0%; regression ALL PASS |
| Browser smoke (Phase 12, regression) | `npx tsx scripts/phase12-ui-smoke.ts` | **16/16 PASS** (after the clinic-day seed fix) |
| Browser safety smoke (Phase 13A, new) | `npx tsx scripts/phase13a-encounter-safety-smoke.ts` | **17/17 PASS** — focus invariant under external injection, keyboard manual-lock, back/forth stability, sign-off persistence across a fresh browser, `RECORD_SIGNED` immutability, `REPLAY` refusal, `GROUNDING_NOT_APPROVED` control |
| API E2E (Phase 11, regression) | `npx tsx scripts/phase11-e2e-flow.ts` | **ALL CHECKS PASSED** (durable job, facts, stale-write 409, fail-closed sign-off, replay refusal, PHI-free audit) |
| Build | `npm run build` | **success** |
| Postgres | `npm run test:postgres` | **skips cleanly locally** (no disposable DB in this environment); the 19-test suite runs in CI on every push (`.github/workflows/ci.yml`), same arrangement the Phase 13 release recorded. The persisted-seal write path is storage-shape-identical in both modes (same in-record field), so CI's run exercises the Postgres branch of `persistSeal`. |

## 10. Known remaining risks

1. **Postgres gate is CI-verified, not locally run** — no disposable database in this environment.
   CI's next run on this tree is the authoritative §27 execution.
2. **Live-mic branch of the focus gate is unit-tested, not browser-tested** — headless Chromium
   has no microphone, so `getUserMedia` cannot be exercised in the smoke; the manual-lock and
   idle-suggestion branches ARE browser-verified, and the live-session refusal shares the same
   `decidePatientSwitch` gate.
3. **Seal revocation/re-correction flow is out of scope** — a signed record can only be corrected
   by superseding revision machinery that does not exist yet (the error message says so). Until
   then, signed means final.
4. **`persistSeal` is a read-modify-write** (load, merge, update) — same concurrency class as the
   rest of the JSON-store path; the optimistic `recordVersion` gate keeps the sign endpoint
   itself safe, and the Postgres path runs inside a single UPDATE.
5. **The direct-generation mutex is per-instance** (in-memory map) — correct for the synchronous
   request's lifetime on one instance; cross-INSTANCE duplication on Vercel is bounded by the
   durable job path's id dedupe (and multi-instance concurrent identical sync requests for the
   same consultation require two clinicians working the same record simultaneously).

## 11. Deferred architecture work (§29 — deliberately NOT implemented)

Multi-operatory support · offline reconciliation of interrupted finalization · manual
drag/pin scheduling · a "now" marker on the roster · 5-second undo for turnover · full
append-only event-log redesign. None is required to satisfy the §30 release boundary; all are
candidates for the post-release architecture track.

---

## PHASE 13A RESULT

```
PHASE 13A RESULT
================

MAIN CHECKOUT: verified (main @ efea8ba; stale worktree excluded)
HEAD: efea8ba515aab69ed226ec25bdb8ae5e70f2a9d4 (base; Phase 13A is uncommitted work on main)

CONFIRMED FINDINGS: focus hijack; keyboard ≠ manual selection; client-only finalization
  race; server transcript ignored; silent chair-active wipe; invisible finalization
  failure; walk-in id collision; fabricated walk-in speech; forced emergency template;
  sentinel-based ordering; seal never persisted; replay guard non-durable; placeholder
  practitioner identity; legacy schedule status semantics; smoke harness UTC-day seeding.

STALE-WORKTREE FINDINGS REJECTED: "sign-off does not exist in production" (Phase 12E is
  fully implemented on main); "DayScheduleQueue is unreachable" (reachable via HistoryHub).

P0 FIXES: focus invariant via canonical switch gate; keyboard = manual selection;
  synchronous + server-side finalization idempotency; server transcript counts; no silent
  scratchpad discard; truthful turnover toasts; collision-safe walk-ins; fabricated speech
  removed; seal persisted + replay-durable; signed records immutable; session-derived
  practitioner identity.

P1 FIXES: finalization states visible (FINALIZING/FAILED/READY/SIGNED) with Retry;
  turnover exposes signed/unsigned; legacy schedule status semantics; tolerant
  deterministic ordering; smoke harness clinic-day fix.

STATE MACHINE: SCHEDULED → IN_CHAIR → FINALIZING → READY → SIGNED (terminal);
  FAILED → FINALIZING retry edge; invalid transitions rejected; Completed ≠ Signed.

TESTS: 1123 passed / 19 skipped (postgres) / 0 failed; +40 new deterministic tests;
  evals 3/3, 20/20 benchmark, gold set 0 critical errors; build success.

POSTGRES: suite skips cleanly locally (no disposable DB); CI runs it on push — the
  persisted-seal path is storage-shape-identical across both stores.

BROWSER: phase12-ui-smoke 16/16; NEW phase13a-encounter-safety-smoke 17/17 (focus
  invariant, keyboard lock, navigation stability, sign persistence, immutability, replay).

REMAINING RISKS: CI Postgres gate pending; live-mic branch unit-tested only (headless
  has no mic); no seal revocation flow yet (signed = final); per-instance sync mutex
  (durable path remains the cross-instance authority).

DEFERRED ARCHITECTURE: multi-operatory; offline reconciliation; drag/pin; now-marker;
  turnover undo; append-only event log.

RELEASE STATUS: READY_FOR_PHASE_13_RELEASE
```

Do not push to production from Phase 13A; the final release phase follows this gate.
