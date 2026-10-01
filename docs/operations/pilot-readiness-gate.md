# Pilot readiness gate

**Created:** 2026-10-01 · **Answers one question:** may a clinician use this build on a real patient, in this practice, tomorrow?

This is the third gate, and it does not replace the other two:

| Gate | Question it answers | Where |
|---|---|---|
| Release gate | Is this software releasable? (CI, ledger, eval, rollback) | `docs/continuous/RELEASE_POLICY.md`, `.control/release-state.json` |
| Go-live checklist | What does the code actually do, and what can only the founder do? | `docs/operations/au-go-live-checklist.md` |
| **Pilot gate (this file)** | May a real patient be seen on it, at this site, with these people? | evidence → `reports/pilot/<date>/gate.md` |

## How to use it

- **G0 is a precondition, not a formality.** The release gate must hold at the pilot SHA. A green local suite is never evidence for any check below.
- Every check resolves to `PASS | FAIL | NOT_RUN | WAIVED`. **`NOT_RUN` on a blocking check is a `FAIL`.** A `WAIVED` needs a named human and a written reason in the go/no-go record — the same rule the release gate applies to open `HIGH` items.
- Each check names the **command or procedure**, what it **verifies**, the **evidence artifact**, and the **role that signs it** (`docs/agents/`). Agents produce evidence; **the go/no-go is a human decision**.
- Evidence lives under `reports/pilot/<YYYY-MM-DD>/` and **never contains patient data** — record ids, status codes, screenshots with names masked. Anything found becomes a `.control/quality-ledger.json` entry (`journey`/`screen`/`API` ids from `docs/testing/`).
- Checks marked **★** are the ones that will plausibly bite first; several are open right now (see *Status at 2026-10-01* at the end).

---

## G0 — Software gate at the pilot SHA (blocking)

| # | Check | Verifies | Evidence | Signs |
|---|---|---|---|---|
| 0.1 | `git rev-parse HEAD` recorded; CI jobs `quality-gate`, `postgres`, `clinical-eval` green **at that SHA** (`.github/workflows/ci.yml`) | The build under test is identified and its gates actually ran there | CI run URLs + SHA | RELEASE_ENGINEER |
| 0.2 | `bun run lint && bun run test && bun run build` | Local battery reproduces CI; no type or build drift | pasted tails | RELEASE_ENGINEER |
| 0.3 | `bun run eval:notes` → score ≥ 0.9, 0 safety failures; `bun run eval:gold-set`, `bun run eval:benchmark` deltas explained | A prompt/model change has not degraded note quality | eval output | CLINICAL_VERIFIER |
| 0.4 | Ledger query (below) → no open `clinicalRisk: CRITICAL`, no `P0`; every open `HIGH` has a written human acceptance | Nothing known-critical is being taken into patients | `docs/continuous/ISSUE_SCHEMA.md`-shaped query output | RELEASE_ENGINEER + HUMAN |

```bash
node -e "const l=require('./.control/quality-ledger.json');const e=l.entries||l;const open=e.filter(x=>!['RELEASED','VERIFIED','REJECTED','DUPLICATE','WONT_FIX'].includes(x.status));console.log(JSON.stringify(open.map(x=>({id:x.id,cat:x.category,sev:x.engineeringSeverity,risk:x.clinicalRisk,st:x.status,owner:x.owner})),null,1));"
```

## G1 — Environment, data and recovery

| # | Check | Verifies | Evidence | Signs |
|---|---|---|---|---|
| 1.1 | Against the **production** URL: `DATABASE_URL=<prod> bun run db:migrate:status` → every migration applied | Production is a real database, not the file store (release policy §4: JSON-fallback green is not a release state; `src/lib/db.ts` fails closed in prod) | command output | RELEASE_ENGINEER |
| 1.2 ★ | `DENTAI_TEST_DATABASE_URL=<db> bun run test:postgres` → 19 tests **run**, 0 skipped | Tenancy, claims, migrations and queries are proven against real Postgres. In a JSON-fallback workspace this suite self-skips — a skipped count of 19 is a FAIL, not a pass | test run | DETERMINISTIC_TESTER |
| 1.3 | Rollback rehearsal on a **restored copy**: `DENTAI_E2E_DATABASE_URL=<copy> tsx scripts/phase12-rollback-check.ts` (or `bun run db:migrate:down` then `up`), with lock duration noted for the largest table | The down path works and is not a guess at production size | timings + output | RELEASE_ENGINEER |
| 1.4 | `bun run ops:backup`, then `sh ./scripts/ops/restore-database.sh <dump> --target <scratch-url>` with **row counts recorded** | A record can be recovered after a real loss | dump metadata + row counts | HUMAN + RELEASE_ENGINEER |
| 1.5 | Data and app region is Sydney; STT residency limits restated to the practice in writing | AU data-residency expectations match reality | written statement | HUMAN |
| 1.6 ★ | Set paths in place (`DATABASE_URL`, `SESSION_SECRET`, `DENTAI_OPS_SECRET`, `CRON_SECRET`, `DENTAI_DISABLE_PROFILE_DIRECTORY=true`, `DENTAI_REQUIRE_CONSENT=true`) and prove them **behaviourally**: save a transcript with no consent → `400 CONSENT_REQUIRED`; a public profile lookup → refused | Consent is enforced at this site, not merely capturable; the directory is off | `reports/` HTTP transcripts | SECURITY_REVIEWER + CLINICAL_VERIFIER |
| 1.7 | `curl -s -X POST -H "x-cron-secret: $CRON_SECRET" $PROD/api/cron/drain` → `ok:true`; `curl -s $PROD/api/health` → ready; `curl -s -H "x-dentai-ops-secret: $DENTAI_OPS_SECRET" $PROD/api/ops/telemetry`; fire a deliberate test alert and **see it arrive** | Notes finish with no browser open, and someone would find out if they stop | responses + phone screenshot | HUMAN + RELEASE_ENGINEER |
| 1.8 | `tsx scripts/phase13-production-smoke.ts https://<pilot-host>` | The deployed surface answers the product's own smoke script | script output | E2E_TESTER |

## G2 — Identity and cross-patient safety (highest clinical risk)

| # | Check | Verifies | Evidence | Signs |
|---|---|---|---|---|
| 2.1 ★ | Reopen a record from **History Hub** and select an appointment from the **day schedule**. The patient banner must show *that* patient's name and DOB and the canvas must be *that* record — never `In-Chair Patient`. Include a record whose stored `date` is a non-ISO shape (`Sep 28`) and a walk-in today | Journey **J2/J3**: no wrong-patient surface. This has already been observed failing (`reports/discovery/workers/1A-ui-journey/evidence/F-1A-2-history-reopen-fallback.json`) — a refusal to waive | screenshots per case + record ids | E2E_TESTER + CLINICAL_VERIFIER |
| 2.2 ★ | Start/view an appointment **from the day schedule** (both entry points: the chairside day-schedule column and the History Hub queue). It must open *that* appointment's encounter, be linked back to the row (`scheduleItemId`), and carry forward the consent the day sheet captured | Journey **J2**. Implemented on `fix/qle-2026-0042…` (2026-10-02): day-sheet import reuses the slot's existing row (`findScheduleItemBySlot`, no duplicate) and links both ways — `Consultation.scheduleItemId` ↔ `DayScheduleItem.consultationId`; opening an appointment adopts the row's captured consent and persists it onto the record (`consentFromCapture` — never invented: a capture-free row opens with none); `src/App.tsx` `handleStartScheduledConsultation` mints a real appointment id, stamps the link, carries consent and persists the encounter; the History Hub queue's Record opens the linked encounter (`onViewConsultation`) or starts it through `onStartRecording`. Live-verified in the JSON store 2026-10-02: Nova `a51c7633…` ↔ `sched_1790889276920_53fk4` with server consent `2026-10-01T21:19:10.965Z / Dr Review` (recordVersion 3); Peta `84462c77…` ↔ `sched_probe_peta_…` carrying `2026-10-01T22:00:00.000Z`; re-import → no duplicate; capture-free row (Rhea) → no consent claim. Pilot-stack restage + E2E sign-off outstanding | screenshots + the resulting record JSON | E2E_TESTER |
| 2.3 ★ | `curl -s -H "Authorization: Bearer $TOK" "$PROD/api/patients?clinicId=$CLINIC"` → every non-empty `dob` is a real calendar date; type `99/99/9999` into the walk-in DOB and the induction DOB → both refuse with a fixable message and write nothing | Identity data is real, and the field is where a typo is caught (`src/utils/date.ts` `dobFieldError`). Note: the **automatic** patient-link path still stores the intake string verbatim — re-check before waiving anything about DOB | HTTP output + screenshots | CLINICAL_VERIFIER |
| 2.4 | Identity resolution run: ambiguous name/DOB ⇒ human confirms; mismatched DOB decisive even when other details agree; nothing links on name alone (`tsx scripts/phase10-audit-probe.ts`) | Journey **J3** | probe output | CLINICAL_VERIFIER |

## G3 — Verification integrity (what the screen claims)

| # | Check | Verifies | Evidence | Signs |
|---|---|---|---|---|
| 3.1 ★ | Enumerate records where the **stored** `groundingAudit.isApprovedForSigning === true` but the record has no clinical content (non-clinical `customSections` keys only — the shape produced by blank walk-ins). Their badge must **not** read `Verified from Audio`; re-audit those records or re-derive the badge from the current content digest. Blocking until the count is zero | A verification claim on screen is supported by the record. Pre-fix records still render a stale approval (`src/lib/uiVerification.ts` projects the stored verdict; signing is blocked but the badge lies) | list + before/after badges | CLINICAL_VERIFIER |
| 3.2 ★ | On the pilot stack (Postgres, `DENTAI_REQUIRE_CONSENT=true`), trigger each refusal **once**: `EMPTY_NOTE`, `GROUNDING_NOT_APPROVED`, `CONSENT_REQUIRED`, `STALE_VERSION`/`REPLAY` — then a success that mints a seal, then an edit attempt on the signed record | Journey **J5**: the sign-off gate holds on the real stack, and the clinician sees a specific reason each time (`src/server/signOffValidation.ts`) | HTTP transcripts + refusal text | DETERMINISTIC_TESTER + CLINICAL_VERIFIER |
| 3.3 | Edit the content of a previously-approved record and re-read the audit: `isApprovedForSigning` must change when the grounding no longer supports the new text | An approval cannot outlive the content it described | audit before/after | CLINICAL_VERIFIER |

## G4 — Failure modes the clinician will actually meet

| # | Check | Verifies | Evidence | Signs |
|---|---|---|---|---|
| 4.1 ★ | In staging, invalidate the AI key (or exhaust the daily allowance) → note generation must fail **visibly**, offer the offline draft, and mark it `needsReview` (journey **J4**); queued jobs surface `failed` with retry, never spin | A dead provider is a visible downgrade, not a stuck queue. On 2026-10-01 the schedule-vision path logged a hard `402 prepayment credits are depleted` and live cases flapped on `429`s — that must not be how a clinic discovers it | screenshots + job states + queue depth | DETERMINISTIC_TESTER |
| 4.2 ★ | Hold a record on the device (kill the session or point at an unreachable origin), then: the app says **which** records are not in the clinic system, the roster labels them, and signing in again uploads them | The dentist can tell local-only work from clinic-saved work. The queue exists (`src/App.tsx` `flushPendingSync`) and the banner exists; the labelling does not | screenshots + resulting server records | E2E_TESTER |
| 4.3 | Expire the token → the app must offer re-authentication without discarding unsaved clinical work, and queued records survive a reload | Session lapse is recoverable in place (403 is now detected; Sign Out → sign in is still the only re-auth path) | screenshots | E2E_TESTER |
| 4.4 | Hit `DENTAI_DAILY_NOTE_LIMIT` / `DENTAI_DAILY_TOKEN_LIMIT` in staging → a clear refusal, no partial note; and the plan's ceiling behaviour confirmed with the practice in writing | Cost ceilings stop work honestly, and the practice knows when | refusals + signed plan | HUMAN + RELEASE_ENGINEER |

## G5 — Operative rehearsal (the only checks that make "tomorrow" real)

| # | Check | Verifies | Evidence | Signs |
|---|---|---|---|---|
| 5.1 | One full consultation on the practice's **own hardware, in their room, by the clinician**: consent → record → note → review → sign-off, then copy/print the note into their existing format and have them check it against what they would have written | Journey **J1** end to end, on the real chair, with the real fonts and the real printer | note + clinician's written comment | CLINICAL_VERIFIER + HUMAN |
| 5.2 | One simulated clinic day (8–12 encounters incl. a walk-in, a pasted day sheet, an empty day, a mid-action reload) with the clinician watching; **every** stumble written down, unfixed ones opened as ledger entries | The flows a careless human actually performs, not the flows a test asserts | `reports/pilot/<date>/stumbles.md` | E2E_TESTER + HUMAN |
| 5.3 | Clinician reads back, in their own words, what the grounding badge, a refusal message and the consent chip mean | The screen's claim survives contact with its reader (`.agents/AGENTS.md` rule 9: no jargon on clinical screens) | verbatim quote | CLINICAL_VERIFIER + HUMAN |

## G6 — Accountability

| # | Check | Verifies | Evidence | Signs |
|---|---|---|---|---|
| 6.1 | Ledger: zero open CRITICAL/P0; HIGH items have written human acceptance; every pilot finding has an entry with `journey`/`screen`/`API` ids | Known risk is visible and owned | ledger query (G0.4) | RELEASE_ENGINEER + HUMAN |
| 6.2 | Practice agreement / DPA signed with versions recorded (`src/server/practiceAgreement.ts`, `docs/legal/practice-agreement-checklist.md`) | The practice has agreed to the terms it is relying on | signed doc + recorded version | HUMAN |
| 6.3 | `curl -s -H "x-dentai-ops-secret: $DENTAI_OPS_SECRET" $PROD/api/ops/audit/verify` → chain intact | The audit trail is intact before patients, not after | output | SECURITY_REVIEWER |
| 6.4 | **Stop rule written down**: any CRITICAL/HIGH found during the pilot stops patient use immediately; the previous deployment is pinned and reachable (`vercel --prod` rollback is a human action); records created during the pilot are exportable (`/api/clinic/export`) | There is a way out, and someone has the authority to use it | runbook + rehearsal | HUMAN + RELEASE_ENGINEER |

## Record of the decision

- File: `reports/pilot/<YYYY-MM-DD>/gate.md` — every check id with `PASS | FAIL | NOT_RUN | WAIVED(<who>, <why>)`, evidence paths, the pilot SHA, and **the human approver's handle**.
- Findings become `.control/quality-ledger.json` entries. If the pilot proceeds with a `HIGH` open, the acceptance is quoted in the record — no silent waivers.
- Real release (not pilot) still appends to `.control/release-state.json` per the release policy. **No agent deploys.**

## What this gate does not prove

- **That a note is clinically sound.** The eval suite is a regression detector over synthetic fixtures with keyword expectations; it catches an invented diagnosis and a broken field, not a well-written wrong note, and it does not cover speech-to-text error. See `docs/operations/au-go-live-checklist.md` §3.3.
- **That speech recognition is accurate.** Where the browser engine is used, both accuracy and audio handling are the browser vendor's.
- **That the practice's workflow is unchanged.** PMS integration does not exist — the note is copied by hand.
- **That a pilot equals general availability.** Support is one person on business hours; the second clinic is where multi-tenancy assumptions get tested for real.

## Status at 2026-10-01 (updated 2026-10-02; this tree, not a release)

Honest starting position for the first use of this file. Nothing is deployed; the pilot SHA does not exist yet.

| Gate area | State |
|---|---|
| G0 | **FAILS on 0.4 today.** `tsc -b --noEmit` clean; local suite 73 files / **1231 passed, 19 skipped (Postgres), 0 failed** (2026-10-02). CI at a pilot SHA: not run; no release record (`.control/release-state.json` `releases: []`). Ledger as of 2026-10-01: **48 entries, 47 open — 7 × `P0`, 13 × `P1`; `clinicalRisk` 15 HIGH, 13 MODERATE, 15 LOW, 1 UNKNOWN, 3 NONE; 0 CRITICAL**. The release gate forbids open `P0`, so the 7 open P0 entries block a pilot on their own; the `UNKNOWN` one forces `HUMAN_REVIEW` by schema. |
| G1 | Not satisfiable in this workspace: no production database, no Docker, `test:postgres` self-skips (19), no production URL reachable. |
| G2 | **2.3 half-closed** — both human-typed DOB fields now refuse impossible dates (verified live 2026-10-01); the automatic patient-link path still stores the intake string verbatim. **2.2 implemented 2026-10-02** and live-verified in the JSON store (row↔encounter link both ways; desk consent carried and persisted; re-import produces no duplicate) — pilot-stack restage + E2E sign-off outstanding. **2.1 open** — History Hub reopen is correct, but the in-chair card still mints an empty chart while another patient is focused (observed 2026-10-01). |
| G3 | **3.1 open** — stale approving audits still render `Verified from Audio` on pre-fix records; signing is correctly refused. 3.2/3.3 verified only in the JSON store, not on Postgres with consent enforced. |
| G4 | **4.1 partially observed failing** (provider credits depleted → 402s). 4.2/4.3 improved today (session expiry and pending records are now on screen) but not yet labelled per-record. |
| G5, G6 | Not started: no clinician, no practice, no signed agreement, no support rota. |

**Verdict today: not pilot-ready.** The shortest honest path is G0 (a real release SHA with CI) → G1 (Postgres, migrations, one restore) → G3.1 (retire the lying badge) → G2.1 (the in-chair card's empty chart) and a pilot-stack restage of 2.2 → G5.1 (one consultation in the room).
