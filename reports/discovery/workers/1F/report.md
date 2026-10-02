# Worker 1F — STATIC ARCHITECTURE — Discovery Report

**STATUS: PASS**

## OBJECTIVE
Static inspection of source only (no code modified, no server run). Trace the canonical
flows UI → state → API → server → persistence → response → UI, and surface architectural
observations: duplicated state, duplicated rules, client-side authority, unsafe persistence,
ClinicalFact bypasses, status-semantics drift, unsafe transitions, dead paths, duplicated
validation, reachable legacy code, UI-derived truth, missing error handling, missing
concurrency protection. Per the brief, every item below is labelled **static observation**
unless a prior worker's live evidence confirms it (each cross-reference is noted).

## ENVIRONMENT
- Tree inspected at commit `2cf786aac840eee69d520ebaae0a35d91c23ffe3` (same base as workers 1A–1E).
- Files read in full or in relevant part: `src/App.tsx`, `src/components/ChairsideWorkspace.tsx`
  (4,066 lines, all sections), `DayScheduleQueue.tsx`, `TopSurgeryBar.tsx`, `HistoryHub.tsx`,
  `ClinicalNoteEditorPanel.tsx`, `LiveConversationPanel.tsx`, `server.ts` (persistence layer,
  governance wiring, consultation CRUD, sign route, note-job worker), `api/index.ts`,
  `src/lib/db.ts` (all 1,006 lines), `src/server/recordGovernance.ts`,
  `src/server/signOffValidation.ts`, `src/server/transcriptionRoutes.ts` (persist path),
  `src/server/chairSessionStore.ts` (header), `src/lib/attestation.ts`, `src/lib/uiVerification.ts`,
  `src/lib/encounterSession.ts`, `src/lib/dayScheduleStorage.ts`, `src/lib/noteJobs.ts`,
  `src/lib/signOffClient.ts`, `src/utils/storage.ts`, `src/types.ts`, `src/types/clinicalFact.ts`,
  `src/grounding/index.ts`, `src/lib/clinicalVerification/index.ts`.

## COMMIT_SHA
`2cf786aac840eee69d520ebaae0a35d91c23ffe3`

## FLOW TRACES (as-built)

### T1 — Chairside transcript append (happy path)
`LiveConversationPanel` / SpeechRecognition → `handleAppendTranscriptText`
(ChairsideWorkspace) → optimistic `localLiveTranscripts` state + dedupe/stitch heuristics →
debounced 2s `pendingSaveConsultationRef` → `flushPendingConsultationSave` →
`App.handleSaveConsultation` → PUT `/api/consultations/:id` (expectedVersion = local
`recordVersion`) → recordGovernance middleware (strip server-owned fields, consent,
revision append, optimistic-version gate) → PUT handler (signed-immutability guard, clinic
scope, patient re-link, `verifyNoteGrounding` recompute) → Postgres JSONB / JSON file →
response replaces list entry (`syncedList`) → roster re-derives. Observed: single canonical
write path; the optimistic-version gate is server-side (confirmed live by worker 1C).

### T2 — Finalization
`handleNextPatient` / `handleFinalizeNote` → snapshot transcript+note →
`executeBackgroundNoteFinalization` → sync in-flight ref guard (`finalizationInFlightRef`)
→ server transcription attempt (`requestTranscription`) → `chooseNoteTranscript` → direct
POST `/api/generate-notes` (server-side per-consultation lock; 409 defer) → fallback POST
`/api/notes/jobs` + 25s poll → offline macro/draft engine as last tier → merged findings
(note content only; no fabrication fallbacks remain) → `onSaveConsultation` → same write
path as T1. Concurrency guarded client-side (ref) and server-side (409 + durable-job
idempotency; worker 1B confirmed idempotent duplicate job submission live).

### T3 — Sign-off
`ClinicalNoteEditorPanel` button → `handleSignOffActiveNote` → version from
`serverRecordVersions` (populated only from server responses) or `consultations[].recordVersion`
→ `requestSignOff` POST `/api/consultations/:id/sign` → server re-derives every approval
condition (version, replay, content digest, grounding audit, fact states, consent) → mints
seal → `persistSeal` onto the canonical record BEFORE the response → UI updates seal/error
maps. Client never asserts approval (confirmed live by workers 1B/1C: 409 replay, 409 stale,
422 GROUNDING_NOT_APPROVED / CONSENT_MISSING). **BUT** — see S-2 and S-3 for the two
static gaps that remain in this path's durability.

### T4 — Consultation create (walk-in / schedule import)
`buildWalkInIntake` / daysheet parser → local `Consultation` with client-minted id →
`onSaveConsultation` → POST `/api/consultations` (server stamps clinic scope, patient link,
grounding audit, governance fields) → **server overwrites stored record on id collision
without conflict check** (confirmed live by worker 1B FINDING-1B-202) — see S-4.

### T5 — Grounding / canonical record write
Note generation (`/api/generate-notes` and the durable worker) → deterministic grounding
(`verifyTranscriptGrounding` + contradiction flags + `verifyNoteGrounding`) → `groundingAudit`
stamped server-side; governance middleware strips client copies of
`groundingAudit/groundingReport/sovereignty/facts/recordVersion/revisions/identityNeedsReview/attestation`
on every write; PUT recomputes the audit over merged content. This is a genuine
server-authority invariant and holds on the inspected paths.

---

## FINDINGS (static observations unless noted)

### S-1 (HIGH, static — partially confirmed live by 1A) Encounters are a UI-derived projection; the roster is rebuilt from scratch on every render
`patientEncounters` (ChairsideWorkspace.tsx:246-404) re-derives every encounter from
`consultations` plus **ephemeral client sets** (`copiedEncounterIds`, `failedEncounterIds`,
`backgroundFinalizingIds`, `localLiveTranscripts`, `activePatientId`, mic state). The
`ScheduleItemStatus` shown to the clinician (`ready | recording | processing | recreate |
note_generated | done`) is therefore a function of *this browser's* memory:
- `failedEncounterIds` is client-only — a generation failure recorded in one browser is
  invisible in a second browser or after reload (the roster card reverts to `ready`).
- `copiedEncounterIds` → `done` conflates "clinician pressed ⌘C" with clinical completion.
- Encounter `status` never persists; the server's `Consultation.status`
  (`'Completed' | 'In Review'`, types.ts:263) carries only 2 of the 6+ roster states.
This is the structural root of worker 1A's confirmed F-1A-4 (stranded `recording` state
persisted in the roster while the only Finish control was unmounted) and F-1A-2 (roster
date-filter fallback). Confirmed as a class by live evidence; the per-field mechanics above
are static.

### S-2 (HIGH, static) Sign-off version source can silently fall back to client-held state
The Phase 12E contract says sign-off versions come ONLY from server responses
(ChairsideWorkspace.tsx:597-600 comment). The implementation honours that for
`serverRecordVersions`, but `signOffTargetVersion` and `handleSignOffActiveNote` both fall
back to `consultations.find(...)?.recordVersion` — i.e. whatever version the **last server
list/save response** delivered, cached in client state and mirrored to localStorage via
`saveLocalConsultations`. Between two 3.5s/30s polls, this can be stale; the failure mode is
benign (server refuses 409 STALE_VERSION and the refusal updates the map), so this is a
contract-inconsistency observation, not a confirmed defect. Note also the mirror writes the
version into the **localStorage cache** — a second browser reads a stale version offline
(no auth → no refresh) and gets a predictable 409 rather than a guess; acceptable but worth
a verifier's attention.

### S-3 (HIGH, static) Record-write path has no revision/audit recomputation for server-side writers; the worker and transcription route bypass governance
`recordGovernance` covers only `POST/PUT /api/consultations` and the two read routes
(recordGovernance.ts:69-80). Three server-side writers bypass it:
1. **Durable note worker** (server.ts:1801-1858) — deliberately replicates governance
   stamping (version, revisions, retention, consent, grounding audit) inline; correct today
   but a duplicated business rule that will drift (see S-7).
2. **Transcription persist** (transcriptionRoutes.ts:425-444) — overwrites
   `consultation.transcript` + provenance via `deps.updateConsultation` (→ `dbUpdateConsultation`)
   with **no recordVersion bump, no revision append, no groundingAudit recompute, no
   signed-immutability check**. Consequences (static):
   - The transcript can be replaced on a record whose `groundingAudit` was computed over the
     OLD transcript — approval state and content silently diverge until the next client PUT.
   - It can write over a **signed** record's transcript; the PUT guard refuses client edits
     to signed records, but this path does not. The seal's contentDigest covers findings, not
     the transcript, so the seal still verifies — but a signed record's evidentiary basis can
     change post-attestation without any audit event.
   - Concurrent transcription + clinician edit: last-writer-wins on the whole JSONB document
     (no version check in `dbUpdateConsultation`).
   No behavioural confirmation attempted (would require a live server); flagged for
   DETERMINISTIC_TESTER as the highest-value behavioural re-verification in this report.

### S-4 (MEDIUM, confirmed live by 1B FINDING-1B-202) POST /api/consultations silently overwrites on id collision; client actively creates collisions
Server POST (server.ts:3729-3737 JSON path; `ON CONFLICT DO NOTHING` in Postgres
`dbInsertConsultation` — note the two storage modes **disagree**: JSON overwrites, Postgres
ignores). Client callers mint ids like `sched-${Date.now()}-${i}`,
`chairside-${Date.now()}`, `consult-${Date.now()}` (ChairsideWorkspace.tsx:1029, 2016, 2543;
App.tsx:397) while walk-ins correctly use `crypto.randomUUID` (§16 remediation). Two
browsers importing a daysheet in the same millisecond mint the same id; JSON-mode POST then
replaces the existing record with 201 (no version/ownership check). Walk-ins were hardened;
daysheet import and chairside quick-start were not — inconsistent application of the same
rule.

### S-5 (MEDIUM, static) Two duplicate, divergent canonical-content digest implementations
`signOffValidation.ts:66-97` (`canonicalContent`) and `attestation.ts:37-90`
(`buildCanonicalTextDigest`) implement the same canonicalization with a real divergence:
`attestation.ts` includes `ADA_CODES` (code:tooth, sorted) in the digest;
`signOffValidation.ts` does not. Today the seal is created via `createAttestationSeal`
(ADA-aware) and self-checked with `verifyAttestationSeal` (same function), so nothing
breaks — but the sign gate's `contentDigest()` is used for the empty-note check only. If
anyone ever compares a sign-gate digest against a seal digest (the function names invite
it), records whose only distinguishing content is ADA codes will compare equal. One
canonicalization should own both call sites.

### S-6 (MEDIUM, static) In-memory replay-nonce set: unbounded growth + per-instance semantics
`signOffValidation.ts:163` — `consumedNonces: Set<string>` never evicts (memory growth) and
is per-process (a sign-off attempted twice across two serverless instances skips the
nonce check). Mitigated structurally by the persisted-seal primary guard (checked BEFORE the
nonce path) — the seal makes cross-instance replay fail 409 anyway. Also note the order
(1B FINDING-1B-201, confirmed live): nonce consumed *before* the attestation crash in
`attestation.ts:37`-adjacent unguarded `.trim()` — replay guard burns the nonce on a
request that never produced a seal. Static mechanism; behavioural evidence exists (1B).

### S-7 (MEDIUM, static) Governance rules duplicated across three implementations (drift already visible)
Consent/revision/version stamping exists in: (a) `recordGovernance.ts` (client writes),
(b) the durable worker (server.ts:1822-1840), (c) `persistSeal` (server.ts:434-458 — sets
`status: 'In Review' → 'Completed'` on signing, which neither of the others does). The
worker's inline copy already omits the clinic-scope resolution and `identityNeedsReview`
recompute differs subtly (`if (link.identityNeedsReview)` vs
`identityNeedsReview = Boolean(link.identityNeedsReview)` — the worker never *clears* the
flag; the PUT path does). Any future governance change must be made three times; the
flag-clearing difference is a live inconsistency today.

### S-8 (MEDIUM, static) `expectedVersion` semantics differ between PUT and sign; the client sends it as a top-level body field on PUT
PUT's optimistic gate reads `body.expectedVersion` and **deletes it** before merging
(recordGovernance.ts:239-241), so it never lands in the stored record — good. But the gate
accepts a request with **no** expectedVersion (older-client compat, documented) meaning every
path that forgets to send it silently degrades to last-write-wins. `App.handleSaveConsultation`
only sends `expectedVersion` when `updatedWithDentist.recordVersion` is a number — which is
absent on locally-constructed consultations (daysheet imports, chairside quick-start) until
the first server round-trip. The concurrent-import race in S-4 therefore also bypasses the
stale-write guard entirely. Fail-open by design; worth an explicit decision.

### S-9 (MEDIUM, static) `encountersForDate` date matching is a four-way heuristic — the root cause of confirmed F-1A-2
ChairsideWorkspace.tsx:407-431 matches records to the visible day by comparing
`c.date` against `currentDateStr` (ISO), `shortDate` ("Sep 28"), `fullDate`, a
`startsWith(shortDate)` prefix, and a `formatClinicDate(d)` round-trip fallback. Records
created by the walk-in path store ISO (`getClinicTodayIso()`); daysheet imports store
`currentDateStr` (ISO via en-CA); legacy/server records may store "Sep 28". The filter
silently drops anything that matches none — confirmed live twice by worker 1A (F-1A-2: the
server record filtered out, focus self-healed onto the scratchpad, wrong-patient surface).
Static confirmation of mechanism; live evidence exists.

### S-10 (MEDIUM, static) Status vocabulary: four overlapping state machines, none authoritative
- `Consultation.status`: `'Completed' | 'In Review'` (types.ts:263) — server-persisted.
- `ScheduleItemStatus`: 8 values (dayScheduleStorage.ts:3-13) — localStorage roster.
- Chairside roster projection: re-derives 6 statuses from client sets (S-1), and
  additionally treats `c.status === 'Completed' || hasActualGeneratedNote` as
  `note_generated`.
- `EncounterLifecycleState` (encounterSession.ts): 6 states with a strict transition
  table — **never called from any component** (`encounterTransition` /
  `projectLifecycleState` are referenced only by their own tests).
The sign-off flow sets `status: 'In Review' → 'Completed'` in `persistSeal` but nothing
represents `SIGNED` in `Consultation.status` — signed-ness is solely `attestation` presence,
and the one UI consumer of status-as-Signed is ChairsideWorkspace.tsx:3057
(`target.status === 'Completed' || target.status === 'Signed'`) — **`'Signed'` is not a
member of the status union** (dead comparison). Signed-record immutability is enforced by
`attestation.signatureHash` alone (PUT guard), so safety holds, but the unused state machine
plus the dead comparison is exactly where a future edit reintroduces an invalid transition.

### S-11 (MEDIUM, static — related live evidence 1B FINDING-1B-206) Free-text `findings` shapes bypass the sign-gate digest
The sign gate digests a fixed list of findings keys. A PUT-supplied record whose clinical
content lives in an unexpected field (or nested structure) passes grounding (which scans
all string values) yet contributes nothing to the content digest — permanently un-signable
with misleading EMPTY_NOTE. Confirmed behaviourally by 1B (206). Static root: two different
definitions of "the clinical content" (grounding: any string; digest: 8 fixed keys +
customSections).

### S-12 (MEDIUM, static) JSON fallback store: read-modify-write with cross-request in-memory cache and no locking
`readDb/writeDb` (server.ts:2183-2233): every write is a full-file `fs.writeFileSync` of the
entire collection, guarded by an in-memory `dbCache` that is also served to readers. Two
concurrent requests interleave read→modify→write and lose records (classic lost-update; the
10-way concurrent PUT test in 1B passed on **Postgres**, which has its own version gate; the
JSON path's gate is inside the same race window). Also: `readConsultationsDb()` returns
`{ consultations: [] }` when `dbEnabled` (server.ts:2267) — every JSON-path branch in the
consultation handlers is dead in Postgres mode by construction (see S-14), but in JSON mode
the lost-update window is real. Mitigating context: single-process deployments only; but
nothing enforces single-process.

### S-13 (LOW, static) ClinicalFact canonical layer is written but unreachable
The entire Phase 3/6 canonical-fact stack — `types/clinicalFact.ts` (709 lines),
`clinicalFactMigration.ts` (640), `clinicalVerification/*` (triggers/context/verifier/
factUpdater/pipeline) — is consumed **only** by `scripts/phase10-audit-probe.ts`,
`scripts/phase11-e2e-flow.ts`, `clinicalEvaluation/*`, and `tests/clinicalVerification.test.ts`.
Nothing in the serving path ever sets `consultation.facts` (governance even strips client
supplied `facts`), yet:
- the sign gate checks `hasBlockingVerificationState` against `consultation.facts`
  (signOffValidation.ts:111-119) — this gate can never fire on any record a real client can
  produce (defence-in-depth that is dead in practice);
- `ClinicalNoteEditorPanel` renders `deriveFactsForDisplay` — the facts strip is
  permanently empty in production.
Not a safety defect (the pipeline is fail-closed by absence) but the canonical ClinicalFact
invariant the architecture claims is currently an island; the note pipeline still
round-trips prose `findings`, which is the actual authority.

### S-14 (LOW, static) Dead paths in Postgres mode
`readConsultationsDb()` short-circuits to an empty array under `dbEnabled`; consequently all
JSON-path consultation logic in handlers (e.g. server.ts:3744-3776, 3880-3931) is
unreachable in Postgres deployments — while being the **only** reachable path in the
hermetic staging profile (which is how 1B found the JSON-only POST overwrite). The two
branches have already diverged (S-4). Consider either deleting one or generating both from
one function.

### S-15 (LOW, static) Client-side "clinical" regexes remain a duplicated rule source
`parseClinicalAlerts` (ChairsideWorkspace.tsx:144-166) re-implements anticoagulant /
antiresorptive / allergy detection by regex over findings+transcript, duplicating
`pharmacologySafetyEngine.ts` and `dentalLibrary` categories. UI-only (alert chips), but it
is UI-derived clinical truth of exactly the class the Phase 12 contract forbids — a
"MRONJ Risk" chip can appear from a transcript mention without any server-verified fact
(see S-13: there are no verified facts). Also `getReferralText` /
`getPostOpText` (ChairsideWorkspace.tsx:3186-3260) inject fixed clinical sentences when SOAP
is empty ("Emergency pain relief and temporisation provided.", the full post-op template) —
safe defaults for a *letter*, but they originate client-side and never touch grounding.

### S-16 (LOW, static) `handleApplyMacro` client-side engine stamp
Phase 12A moved engine stamps server-side for generated notes, but `handleApplyMacro`
(ChairsideWorkspace.tsx:2586-2600) still sets `noteOrigin.engine = 'australian-clinical-macro'`
client-side and PUTs it. Governance strips `groundingAudit`/`attestation` but NOT
`noteOrigin` — so the client asserts the note's provenance label for macro-finalized
records. The badge derivation (`uiVerification.deriveGroundingBadge`) special-cases exactly
this engine string from the (client-supplied) stored value. Tamper impact is limited to
badge cosmetics (the sign gate re-evaluates the audit server-side), but provenance-of-record
is client-asserted.

### S-17 (LOW, static) `logout` clears server-synced consultation state while claiming to preserve work
`App.handleLogout` (App.tsx:329-348) keeps the comment "logging out mid-consult must never
destroy unsaved clinical work" and deliberately preserves the sessionStorage transcript —
but immediately `setConsultations([])`, `setSelectedConsultation(null)`, and sets view to
`'history'`. Unsaved work attached to a real consultation id (debounced save still in
`pendingSaveConsultationRef` at ChairsideWorkspace unmount — that ref DOES flush on
unmount) survives via the unmount flush; work on the `'chair-active'` scratchpad that has
not been finalized is preserved only via the (undocumented here) sessionStorage transcript
restore path. Worker 1A confirmed live (F-1A-1: data loss) — the static code shows the
preservation claim is only partially implemented.

### S-18 (LOW, static) Duplicated transcript-shape normalization (5 sites)
Mapping `{sender|role|speaker} → 'Dentist'|'Patient'|'Dialogue'` is implemented in
ChairsideWorkspace (patientEncounters mapping, finalization, `handleNextPatient` snapshot,
`handleApplyMacro`), `encounterSession.normalizeTranscriptItem`, and
`grounding/index.ts` sender validation, each with slightly different membership rules
(e.g. 'Clinical Comment' collapses differently per site; the finalization sanitizer allows
'Clinical Comment' while the transcript type union includes it, but grounding coerces it to
'Dialogue'). One canonical normalizer exists (`encounterSession.ts`) and is bypassed by
most call sites.

### S-19 (INFORMATIONAL) Positives worth keeping
- Governance strip of server-owned fields + server-side audit recompute on every write is
  genuinely fail-closed and confirmed live (1B: client audit forgery stripped).
- Optimistic concurrency is enforced server-side on PUT and sign (live-confirmed 1C).
- Note generation has three tiers with a server-side per-consultation lock and idempotent
  durable jobs (live-confirmed 1B).
- Walk-in intake (`encounterSession.buildWalkInIntake`) is collision-safe, explicit-type,
  no fabricated speech — a model the daysheet import path (S-4) should be migrated to.
- `db.ts` job claiming uses `FOR UPDATE SKIP LOCKED`; recovery tokens are single-use in the
  UPDATE predicate; credential changes bump session epochs. Concurrency where it matters.

---

## COVERAGE MATRIX (brief → observations)

| Brief item | Covered by |
|---|---|
| duplicated state | S-1, S-7, S-10, S-18 |
| duplicated business rules | S-5, S-7, S-11, S-18 |
| client-side authority | S-2, S-8, S-15, S-16 |
| unsafe direct persistence | S-3, S-4, S-12 |
| bypasses around canonical ClinicalFact | S-13 (canonical layer unreachable; prose findings remain the authority) |
| inconsistent status semantics | S-1, S-10 (incl. dead `'Signed'` comparison) |
| unsafe state transitions | S-10 (unused state machine), S-3 (signed-record write via transcription route) |
| dead paths | S-14 (JSON branch under Postgres), S-13, S-10 |
| duplicated validation | S-5, S-8, S-18 |
| legacy code still reachable | DayScheduleQueue/TopSurgeryBar remain reachable via HistoryHub schedule tab (parallel recording pipeline with its own job-poll and status writes to localStorage — coexists with ChairsideWorkspace's roster; duplicate finalization path) |
| UI-derived clinical truth | S-1, S-15, S-16 |
| missing error handling | S-3 (persist failure still returns transcript), S-17 |
| missing concurrency protection | S-4, S-8, S-12, S-6 |

Also inspected per brief: grounding (T5, S-13, S-15), schedule (S-9, S-10, DayScheduleQueue
legacy path), consultation lifecycle (T1-T4), canonical adapters (`src/lib/pms/*` read-only
renderers; `toPmsEncounter` pure; no server authority — no findings beyond S-15's note
origination), finalization (T2, S-18), sign-off (T3, S-2, S-3, S-5, S-6, S-11).

## LIMITATIONS
- Static inspection only; no server was started and no request was issued by this worker.
  Every "confirmed" cross-reference cites the live evidence of workers 1A/1B/1C.
- `src/lib/pms/adapters/*` and the beacon/ops/billing/mfa route modules were reviewed at
  wiring level only; deep line-by-line review of those was not in scope for 1F.
- `src/sovereignty/*` reviewed only at its single import site (`purgeAudioPayload`).

## EVIDENCE
All observations cite file:line in the sections above. No new evidence files are required
(nothing was executed); line references are against commit
`2cf786aac840eee69d520ebaae0a35d91c23ffe3`.

## RECOMMENDED BEHAVIOURAL RE-VERIFICATION (for DETERMINISTIC_TESTER)
1. S-3: transcribe a consultation concurrently with a clinician PUT, and transcribe against
   a signed record — assert version/revision/immutability behaviour.
2. S-4: two near-simultaneous daysheet imports with colliding ids on JSON fallback mode.
3. S-9: server record with `"Sep 28"`-style date vs ISO — roster visibility (already 2/2
   live via 1A; re-run after any date-normalization change).

## EXIT
**PASS** — all critical architectural paths (UI state → API → governance → persistence →
response → UI; finalization; sign-off; grounding; schedule; consultation lifecycle; canonical
adapters) inspected statically. No application files modified; only this report written.
