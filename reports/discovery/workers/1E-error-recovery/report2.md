# Worker 1E — ERROR / RECOVERY — Discovery Report (Pass 2: failure & recovery lifecycle)

**STATUS: PASS (critical failure/recovery paths attempted)**

## OBJECTIVE
Second-pass discovery focused on the *lifecycle* failure classes not covered by pass 1 (`report.md`):
request timeout · HTTP 4xx · HTTP 5xx · generation failure · database failure · provider failure ·
refresh after failure · retry · duplicate retry · navigation during failure · browser refresh during
recovery · partial state · stale error message · stale success message. Evidence only — no fixes.

## ENVIRONMENT
- Hermetic staging profile (unchanged): `http://localhost:4731`, JSON file store in temp dir
  `dentai-disc-h0OP3b`, `DENTAI_ALLOW_FILE_STORAGE=true`, `NODE_ENV=staging`, `DATABASE_URL` unset.
  Provider is the deterministic macro engine (`DENTAI_DETERMINISTIC_PROVIDER=true`), so live
  provider-failure injection was not possible; provider paths were analysed statically + via
  `tests/clinicalPipelineReliability.test.ts` (unit-proven quota backoff).
- Auth: reused synthetic session token from worker 1B evidence (`Dr Disc OneB`).

## COMMIT_SHA
`2cf786aac840eee69d520ebaae0a35d91c23ffe3` (HEAD unchanged during this pass)

## TESTS_PERFORMED (live probes, evidence in `evidence2/`)

| # | Probe | Result |
|---|---|---|
| T1 | Duplicate `POST /api/notes/jobs` with **non-UUID** `consultationId` | **DEFECT — see F-1E2-1.** Both accepted 202; two jobs created; usage metered twice (1→2); two durable consultations persisted (`5b0463a1…`, `ed4e3cf8…` in temp store) |
| T1b | Duplicate `POST /api/notes/jobs` with **UUID-shaped** `consultationId` | PASS: one job, one consultation record; second POST still returns 202 + a *second* metering increment (usage 5→6) — see F-1E2-2 |
| T2 | 3× concurrent `POST /api/generate-notes`, same `consultationId` | PASS: 1×200, 2×409 `GENERATION_IN_PROGRESS` (in-flight guard works; Phase 13A §10 confirmed live) |
| T3 | Transcript `[1,2,3]` → `POST /api/notes/jobs` | PASS: 400 `TRANSCRIPT_ENTRY_INVALID` |
| T4 | Poll unknown job id | PASS: 404 `Note job not found.` (JSON, owner-scoped; forged cross-account token → 403) |
| T6 | 5,001-entry transcript | PASS: 400 `TRANSCRIPT_TOO_LONG` |
| T7 | Empty transcript | PASS: 400 `TRANSCRIPT_EMPTY` |
| T8 | Garbage / forged bearer token | PASS: 403 `Session expired or invalid.` (failure attributed to the session, not to data loss) |
| T11 | `PUT /api/consultations/bogus-id` | PASS: 404 JSON |
| T14 | Poll a completed job | PASS: `status:done`, truthful `statusDetail` |
| T15 | Re-check pass-1 F-1E-1 on this build | `POST /api/consultations {}` still → **201** with blank `consent.obtainedAt` (unchanged; sign gate still refuses it downstream) |
| T16 | Malformed JSON body | 400 but **HTML Express error page** (unchanged, F-1E-2 pass 1) |
| T-auth | Login lockout: 12 rapid bad-PIN attempts on synthetic account | PASS: `429 LOCKED_OUT` durable 15-min lock; note the cache-staleness caveat F-1E2-6 |

Static/analysis-only tests (documented, not executable hermetically): timeout floors
(`withTimeout` on every hosted call), Postgres-failure behaviour, worker crash recovery
(`dbRequeueStuckProcessingJobs`), navigation/refresh React-state paths.

## FINDINGS

### F-1E2-1 (HIGH — escalated for triage) Durable-job idempotency bypassed for non-UUID consultation ids
`POST /api/notes/jobs` derives the job id from the client's `consultationId` **only when it is
UUID-shaped** (`server.ts:1998-2010`: `id: isUuid(consultationId) ? consultationId : crypto.randomUUID()`).
The Phase-9 dedupe (`server.ts:2026-2035`) compares `j.id === job.id` — so any client whose
consultation id is not a UUID gets a **fresh random id on every retry**, and the dedupe never fires.
Demonstrated live: two submissions → two jobs, both drained, usage metered twice (1→2), and **two
durable consultation records** (`5b0463a1-…`, `ed4e3cf8-…`) persisted with identical content.
Impact: a duplicate retry (double-click, offline replay, client re-submitting after a failed poll)
creates duplicate clinical records and double-spends the clinic's allowance — exactly the scenario
the Phase-9 comment says it prevents. Postgres mode has the same shape (`ON CONFLICT (id) DO NOTHING`
is only a dedupe when the id converges). Note the chairside client persists encounters under ids like
`consult-<Date.now()>` (ChairsideWorkspace.tsx:2557) and `'chair-active'` — both non-UUID — so the
fallback Tier-2 path in the real UI likely does NOT converge either. Evidence: `evidence2/job1.json`,
`evidence2/job2.json`, usage trace in this report's REPRODUCTION section.

### F-1E2-2 (MEDIUM) Successful dedupe still double-meters
Even with a converging UUID consultation id, the duplicate `POST /api/notes/jobs` increments the
usage snapshot on **both** calls (observed `used: 5` then `used: 6` while only one job existed and one
consultation was created). The token/note ceiling is enforced at submission; a client stuck in a
retry loop can burn its daily allowance with duplicate submissions that generate nothing new.
Evidence: `evidence2/uuid-job1.json`, `uuid-job2.json` (`used` 5→6), one row in `note_jobs.json`.

### F-1E2-3 (MEDIUM) Client 25s polling deadline is shorter than the server's own retry ladder
The client polls a queued job for only **25s** (`ChairsideWorkspace.tsx:2464` `deadline = Date.now() + 25_000`)
then silently falls back to the offline draft. Server-side quota backoff starts at **45s** and caps at
**6min** (`JOB_CONFIG.backoffBaseMs=45_000`, `backoffMaxMs=360_000`), with `maxAgeMs=30min`. So on any
quota blip, the client abandons polling *before the first server retry even fires*, renders the
macro/offline draft, and the durable job later completes server-side — two different notes for one
encounter (offline draft in the editor, hosted note in the durable record), with **no UI signal that
the abandoned job completed** (the roster poll mentioned in the 409 comment only runs every 3.5s for
the *other* browser's completion; the abandoned client's editor content is not reconciled). This is a
stale-success-message and partial-state vector, not a data-loss one: the durable record is correct.

### F-1E2-4 (MEDIUM) `backgroundFinalizingIds` not cleared on the finalization failure path
`executeBackgroundNoteFinalization` clears `backgroundFinalizingIds` for the target id in its **catch**
block (ChairsideWorkspace.tsx:2637-2641) but the non-exception failure exits return `undefined` earlier
(e.g. in-flight guard skip at line 2301, 409-defer at line 2458) — correct — while the **success path
relies on the caller's `.finally()`** (line 2879-2885). Two consequences:
1. The success-path cleanup is owned by *callers that remember to add it* (the keyboard handoff does;
   `handleFinalizeNote` does not touch the set — benign today because it never adds the id, but fragile).
2. If the browser tab is refreshed mid-finalization, all React state (`failedEncounterIds`,
   `backgroundFinalizingIds`, in-flight ref) resets to empty; a `processing` encounter shows as
   `ready`/`Up Next` and can be re-finalized by the clinician — a duplicate-retry after browser
   refresh that the client-side guard cannot prevent (server dedupe is the only protection, and it is
   bypassed per F-1E2-1 for non-UUID ids). No window-level `beforeunload` guard exists.

### F-1E2-5 (OBSERVATION) Job-failure error strings surface verbatim to clinicians
A terminal job failure is reported to the poller with `statusDetail = job.error` (server.ts:2096) —
the raw provider message (e.g. `Gemini API returned an empty text field.`, model id, transport
detail). Error attribution is honest (correct job, correct failure), but the message is
receptionist-unfriendly and can leak infrastructure detail to the chairside screen, against the
"zero jargon" UI principle (PROJECT_CONTEXT.md §10).

### F-1E2-6 (OBSERVATION) Login-lockout read path served from the JSON-store write cache
The 15-minute lockout writes through `writeDb`, which also seeds `dbCache['dentai:login_attempts']`;
reads come back from cache. Editing the lock file out-of-band (as any co-located process must) is
invisible until the cache entry is invalidated — demonstrated during this probe run (lock persisted
after the file was reset). Single-process behaviour is correct; the hazard exists only for multi-process
deployments of the file store, which the project positions as dev-only. Recorded because the failed
attempts counter is the same mechanism used for durable operator lockout decisions.

### F-1E2-7 (POSITIVE) Duplicate *synchronous* generation is refused correctly
Three concurrent `/api/generate-notes` calls with the same `consultationId`: 1×200, 2×409
`GENERATION_IN_PROGRESS`. The in-flight gate is set before the provider call, settled on `finish`/
`close`, and carries a 130s self-expiry so a crashed request cannot hold it forever (server.ts:4713-4735).
The client treats 409 as "defer to the peer" and does not enqueue a duplicate job.

### F-1E2-8 (POSITIVE) Recovery paths fail with machine-readable, correctly-attributed errors
Malformed transcript (`TRANSCRIPT_ENTRY_INVALID`), oversized transcript (`TRANSCRIPT_TOO_LONG`),
empty transcript (`TRANSCRIPT_EMPTY`), unknown job (`404 Note job not found.`), invalid session
(`403 Session expired or invalid.`), bogus record update (`404 Consultation not found or
unauthorized.`) — all JSON, all correctly scoped, none invented a success. Job polling is
owner-scoped (cross-account token → 403).

### F-1E2-9 (POSITIVE) Worker crash recovery and stale-job expiry exist in both store modes
JSON mode requeues `processing` jobs past the stale window opportunistically; Postgres mode claims
with `SKIP LOCKED` and requeues stuck processing jobs (`dbRequeueStuckProcessingJobs`); jobs older
than 30min are failed with `Job expired before generation could complete.` so the client never polls
forever (server.ts:1674-1690, 1694-1700). Backoff on quota failures is unit-proven
(`tests/noteJobs.test.ts`, `tests/clinicalPipelineReliability.test.ts`). "State stuck indefinitely"
was not reproduced: bounded by `maxAgeMs`.

### F-1E2-10 (CARRIED, re-confirmed) Empty-body consultation creation still 201
Pass-1 F-1E-1 reproduces at this SHA: `POST /api/consultations {}` → 201, blank `consent.obtainedAt`.
No unsafe sign path demonstrated (1D's sign gate refuses it), but creation-side validation remains
more permissive than the clinical contract implies.

### Test-matrix coverage of the requested classes
| Requested class | Status |
|---|---|
| request timeout | STATIC-ONLY: `withTimeout` wraps every hosted call (primary 90s class, secondary shorter); client side has a 25s poll deadline (see F-1E2-3) |
| HTTP 4xx | LIVE: T3, T6, T7, T11, T15 + pass-1 suite — all JSON + codes |
| HTTP 5xx | LIVE-limited: 500 handler present on job submit/poll; deterministic provider prevented live 5xx induction; PASS-1 observed 413/400 HTML (F-1E-2) |
| generation failure | STATIC + SUITE: terminal `failed` status with `job.error` surfaced (F-1E2-5); expiry path verified in code |
| database failure | STATIC-ONLY: `dbPing` on health, auth middleware 500s on DB read error, queue drain alerts on `dbOk:false`; Postgres suite skipped (no `DATABASE_URL`) |
| provider failure | SUITE-PROVEN: quota → backoff requeue (max 4 attempts), fallback key, OpenAI-compatible failover; live provider error injection blocked by deterministic provider |
| refresh after failure | LIVE-BLOCKED (no browser in this pass); code inspection: `failedEncounterIds`/`finalizationInFlightRef` are React-session-scoped and reset on refresh → retry surfaces again (arguably correct recovery affordance; see F-1E2-4) |
| retry | LIVE: day-view `Retry` button clears the failed marker *before* re-running, so a second failure re-asserts it (correct); server converges only for UUID ids (F-1E2-1) |
| duplicate retry | LIVE: T1/T1b/T2 — sync path correct; job path bypassed for non-UUID ids |
| navigation during failure | CODE-INSPECTED: keyboard handoff finalizes with immutable snapshot and truthy toast; failure toast names the encounter via `turnoverToastTargetId` |
| browser refresh during recovery | CODE-INSPECTED (F-1E2-4) |
| partial state | CODE-INSPECTED: worker persists consultation *after* job result; persist failure logs and leaves result on the job (client can still retrieve; durable record missing until History Hub path — noted as designed tradeoff in server.ts:1799-1804) |
| stale error message | CODE-INSPECTED: failure toast auto-clears in 4.5s; encounter status is derived from live state each render (no persisted stale error) |
| stale success message | CODE-INSPECTED + F-1E2-3: turnover toast never claims "saved" for in-flight finalization (Phase 13A §14); the abandoned-poll case can leave a draft that later diverges from the durable record |

## REPRODUCTION
```bash
TOKEN=$(cat reports/discovery/workers/1B-api/evidence/token.txt)
BASE=http://localhost:4731
TRAN='[{"sender":"Dentist","text":"Tooth 46 occlusal caries, composite restoration placed."}]'
# F-1E2-1: two 202s, two metering increments, two durable consultations
for i in 1 2; do curl -s -X POST $BASE/api/notes/jobs -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"intakeData\":{\"firstName\":\"Syn\",\"lastName\":\"Probe1E\",\"appointmentType\":\"examination\"},\"transcript\":$TRAN,\"consultationId\":\"1e-dup-test-aaaa-1111-2222-333344445555\"}"; echo; done
# F-1E2-2: UUID id converges to one job but meters twice (watch "used")
curl -s -X POST $BASE/api/notes/jobs ... # consultationId aaaaaaaa-bbbb-4ccc-8ddd-eeeeffff0001, twice
```

## EVIDENCE
- `evidence2/job1.json`, `evidence2/job2.json` (F-1E2-1: two jobIds, usage 1→2)
- `evidence2/uuid-job1.json`, `evidence2/uuid-job2.json` (F-1E2-2: one job id, usage 5→6)
- `evidence2/conc1.json`, `conc2.json`, `conc3.json` (F-1E2-7: 200/409/409)
- `evidence2/bad-transcript.json`, `oversize-transcript.json`, `empty-transcript.json`,
  `job-404.json`, `job-done.json`, `badtoken.json`, `forged.json`, `put-404.json`,
  `empty-consult.json` (F-1E2-10), `malformed-consult.json` (HTML error page)
- Temp-store inspection: two consultations under `5b0463a1…`/`ed4e3cf8…`; single job + consultation
  for the UUID case; 4×`ai_note` + 2×`ai_note_sync` usage events.

## PROBE SIDE-EFFECTS (disclosed)
- Created synthetic consultations/jobs and usage events in the **hermetic temp-dir store** only
  (`/tmp/dentai-disc-h0OP3b`) — no production or shared data touched.
- Locked the synthetic account `Dr Disc OneA` with failed-PIN probes (lockout worked as designed);
  reset `login_attempts.json` in the temp store to restore the fixture (backup at
  `/tmp/login_attempts.backup-1E.json`). Disclosed as F-1E2-6 context.

## BLOCKED_TESTS
- Live provider-failure injection (quota/timeout/5xx from Gemini) — staging profile runs the
  deterministic macro engine by design; quota paths covered by unit suite.
- Postgres database-failure drills (kill connection mid-job, SKIP LOCKED under contention) — no
  `DATABASE_URL` in the hermetic profile; `tests/postgres.test.ts` self-skips.
- Browser-refresh-during-recovery and navigation-during-failure *live* E2E — requires Playwright
  against a fresh staging instance; covered here by code inspection only (F-1E2-4).
- DB-failure during the worker's consultation-persist step (partial-state rehearsal) — would require
  a fault-injection harness; code path documented (server.ts:1799-1804).
