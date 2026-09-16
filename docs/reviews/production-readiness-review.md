# DentAI — Architecture Review & Production-Readiness Requirements

**Scope reviewed:** `main` @ `0f3deef` (HEAD) and its two predecessors `c616592` (demo) and `1e1d7bb` (job fabric), plus the whole application architecture as it stands.
**Verified locally:** `bun tsc -b --noEmit` passes (exit 0). Test suite was **not** run — it mutates the tracked `data/*.json` files (see §2.1), and there were uncommitted user edits in `data/`, `server.ts`, `src/components/ClinicalSummary.tsx`, `src/lib/draftEngine.ts` at review time.
**Verdict:** a strong prototype with genuinely good resilience work, but it is **not production-ready for patient data**. The blockers are concentrated in four places: PHI in git, a 4-digit PIN as the only credential, an unmetered legacy generation endpoint, and a background worker that only runs when a browser is watching it.

---

## 1. The latest commits, reviewed

### `0f3deef` — fix(login): stack demo CTA below the card on mobile

One-line change: `flex items-center justify-center` → `flex flex-col items-center justify-center` on the `Login.tsx` root.

**Correct.** The demo CTA (`Login.tsx:637`) is a sibling of the `AnimatePresence` card block, and the previous row layout placed it beside the card on every breakpoint, not just mobile. `flex-col` + the button's own `mx-auto` centres it underneath as intended.

**Residual nit (not a bug):** there is no `md:flex-row` counterpart, so desktop now also stacks. That reads fine and is arguably better, but it silently changes the desktop composition — worth a deliberate decision rather than a side effect.

### `c616592` — feat(demo): narrated product demo

Ships a `#/demo` theater (`DemoMovie.tsx` 484 lines, `Scenes.tsx` 1,474 lines, `demoScript.ts` 270 lines) imported **statically** in `App.tsx:12`, plus a Playwright recording pipeline in `scripts/demo/`.

Blind spots in this commit specifically:

1. **~2.2k lines of demo-only UI are in the main bundle for every real user.** There is no `React.lazy`/dynamic `import()`; the demo also renders fake clinical screens that duplicate real component logic and will drift.
2. **The recording pipeline writes to production.** `scripts/demo/config.ts` defaults `LIVE_URL` to `https://dentai-one.vercel.app`, registers two accounts, then asks the operator to remember `bun run demo:cleanup`. The demo PINs are committed (`2468`, `1357`). If cleanup is skipped — one forgotten command — there are known-name, known-PIN accounts inside real production data.
3. **Narration overstates the product** ("the conversation is transcribed live") without the caveat that live capture is Chrome/Edge-only via the Web Speech API (§2.5).

### `1e1d7bb` — feat(scale): durable async note jobs

The best-engineered commit in the history. Atomic `FOR UPDATE SKIP LOCKED` claims, priority classes, exponential backoff, per-clinic metering, consultation persisted server-side on completion, id convergence so the client and worker land on one record. See §2.4 for why the durability claim is still not true in production.

---

## 2. Blind spots (by severity)

### 2.1 CRITICAL — Patient data and PIN hashes are committed to git

`data/users.json`, `data/consultations.json`, and `data/audit.json` are tracked (`git ls-files data` confirms), and `.gitignore` does not exclude `data/`. The consultations file contains real patient identifying information — first/last name, DOB, full clinical transcripts with tooth-level findings. The users file contains `pinHash` + `salt` for every account. `data/clinics.json` and `data/note_jobs.json` are untracked today but will be swept into the next `git add -A`; `note_jobs.json` already holds full transcripts.

Compounding problem: `tests/server.test.ts` backs up, overwrites, and restores those exact files (`tests/server.test.ts:640-670`) — that is why the working tree shows `data/*.json` as modified. So **running the test suite mutates production-shaped data files**, and any crash mid-run leaves them corrupted.

Also: `.env*` is ignored but `.env.example` is tracked — fine — and `server.js` (the compiled 421 KB bundle) is correctly ignored.

### 2.2 CRITICAL — A 4-digit PIN is the entire security model, and it can be brute-forced

- `GET /api/auth/profiles` is **public** and returns `{id, name, specialty}` for every dentist on the platform. That is a cross-tenant directory, and it hands an attacker the exact `dentistId` the login endpoint needs.
- `POST /api/auth/login` then only needs `dentistId` + a 4-digit PIN: 10,000 candidates.
- The lockout (`LOGIN_MAX_ATTEMPTS = 5`, 15 min) lives in an **in-memory `Map`** (`server.ts:889`). On Vercel/serverless there is one process per instance and cold starts clear it, so it is per-instance and ephemeral — it does not bound a real attack.
- `DELETE /api/auth/profiles/:id` is **unauthenticated**, takes an arbitrary `dentistId` + PIN, has **no lockout at all**, and does not record failed attempts. Wrong guesses are only slowed by the global 100 requests/15 min limiter, which is per-IP and trivially distributed, and which also means a PIN guessing campaign can exhaust a real clinic's shared NAT IP.
- `verifyToken` compares signatures with `!==` (`server.ts:938`) instead of `crypto.timingSafeEqual`.
- Tokens last 7 days, have no `jti`, no server-side revocation list, and `POST /api/auth/logout` returns `204` without invalidating anything. A lost clinic workstation stays authenticated for a week.

And the recovery story is worse than the attack story: **there is no change-PIN, reset, or recovery flow anywhere in the codebase** (grep for `change-pin|reset-pin|forgot|recover` finds only unrelated comments). The only documented recovery is `scripts/delete-profile.ts`, which deletes the dentist *and all their consultations* — for a clinician who forgot a PIN, the support path is data destruction.

Consent/authorisation gaps that follow: `pinHash` verification accepts legacy 1,000-iteration hashes forever with no rehash-on-login, and destructive operations have no step-up auth, no re-auth, and no owner notification.

### 2.3 CRITICAL — The quota and durability model can be bypassed

`POST /api/generate-notes` (server.ts:1883) is still live, authenticated but **completely unmetered**: no `getUsageCountToday`, no `usageSnapshotFor`, no daily cap, no priority queue, no server-side job, and no server-side consultation persistence. Everything §2.4 was built to guarantee is bypassable by calling the old route. It also duplicates the entire Gemini→Vertex→fallback-key routing and prompt-building logic that `runHostedGeneration` now owns, so the two copies will drift (they already differ: the sync path has no transcript compaction).

`GET /api/telemetry` is unauthenticated, and its counters live in module scope in `logger.ts` — per-instance and reset on every cold start. On serverless this endpoint reports numbers that are not merely useless, they are misleading (the `ROLLOUT_PLAYBOOK.md` gates production promotion on them).

### 2.4 HIGH — "Durable" jobs are only durable while a browser is polling

`tickNoteJobs()` is triggered from (a) `POST /api/notes/jobs` via `void tickNoteJobs(true)` — fire-and-forget inside a serverless request, which can be frozen the moment the response is sent — and (b) client polls of `GET /api/notes/jobs/:id`.

Consequences:

- If the dentist closes the tab (appointment over, laptop closed, crash) and no other user submits or polls, **nothing drains the queue**. The job waits until someone else's traffic happens to tick the worker. `vercel.json` has no `crons` entry, and the manual `/api/notes/jobs/tick` endpoint is authenticated as *any* dentist, so it is not a usable operator lever.
- The same dependency breaks crash recovery: `dbRequeueStuckProcessingJobs` and the `maxAgeMs` expiry sweep only run inside a tick, so a job orphaned by an instance death can sit in `processing` indefinitely.
- The comment in `App.tsx:537` ("the dentist will find it in the History Hub even if they leave now") is therefore not guaranteed. It is the right design intent; the scheduler for it is missing.
- 90 s client polling deadline vs `backoffBaseMs = 45 s` and a 6 min backoff cap: on a real quota event the client gives up long before the job resolves, so the user-visible failure is "still generating on the server" rather than a result.

Other job-fabric gaps: `note_jobs` retains the full transcript payload with no pruning (failed jobs accumulate forever); `usage_events` is an append-only event log counted with `COUNT(*)` per checkout; the declared `'metered'` status is never written; `dbNextReadyNoteJob`, `isJobStale` and `pickNextJob` are unused duplicates of live logic.

### 2.5 HIGH — Clinical workflow realities that block paid adoption

- **Capture is Chrome/Edge-only.** `LiveRecording.tsx` uses `webkitSpeechRecognition`. No Safari, no Firefox, and on most browsers the audio is streamed to Google for recognition. Dentists chart on iPads — the primary device class is unsupported, and the privacy disclosure for third-party audio processing is not something the clinic can point at today.
- **The residency claim is only true on one of three routes.** Vertex with `australia-southeast1` is sovereign; the immediate fallback in the same function is a global Gemini developer key, and the Web Speech path is global too. A clinic relying on the "Australian sovereign clinical processing" log line has no guarantee it is what actually served their note.
- **The note has no version history.** `PUT /api/consultations/:id` spreads `...updatedPayload` over the stored record. There is no diff, no "who changed what", no immutability after sign-off, and no model/version provenance stamped on the record — for an auditable clinical document that is a gap, not a nicety.
- **Consent is not evidence.** The intake checkbox (`PatientIntake.tsx:346`) is UI validation only; nothing about the consent state, its timestamp, or the AI disclosure is persisted with the consultation.
- **No PMS path.** The output is a note the dentist retypes into Dentex/Cliniko/their practice software. Without copy-to-clipboard/print/export quality or a PMS integration, the time saving is smaller than the pitch claims.

### 2.6 HIGH — Nothing observes, alerts, or recovers

- No error tracking (no Sentry/equivalent), no alerting, no health endpoint, no uptime probe, no request IDs.
- Schema is created by `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` at cold start. There is no migration tool, no versioned migration, and no down path — the first destructive schema change has no rollback, while `ROLLOUT_PLAYBOOK.md` promises `< 3 minutes` recovery.
- No staging environment or staging database is described anywhere; `ROLLOUT_PLAYBOOK.md` assumes Vercel previews are the staging tier without separating preview credentials from production ones (`SESSION_SECRET`, `DATABASE_URL`).
- **The production persistence path is untested in CI.** `tests/server.test.ts:24` forces `DATABASE_URL = ''`, so every test runs the JSON fallback while Postgres is what production uses. All the `db*.ts` functions, the atomic claim, and metering have no automated coverage.
- Secret rotation is undocumented; rotating `SESSION_SECRET` silently logs out every clinic (acceptable, but it should be a documented, deliberate event).

### 2.7 MEDIUM — Multi-tenant and data-governance gaps

- Owners can read every note in clinics they own (`/api/clinics/:id/consultations`); reads are **not audited** — only writes are. For clinical access governance, "who viewed this record" matters as much as "who changed it".
- `GET /api/clinics/:id/members` is owner-only, so a member cannot see who they are working alongside — likely intended, but it means the switcher UI depends on `memberNames` fetched elsewhere.
- No patient-level record continuity (a patient visiting two sites has two records); no patient deletion/export path (`scripts/delete-profile.ts` deletes the *dentist*, cascading away their patients' notes); no retention policy; no documented processor list (Google/Gemini, Neon, Vercel) or DPA template for clinics.
- `express.json({ limit: '8mb' })` is registered for `/api/day/import-screenshot` — a route that **does not exist** (server.ts:103). The middleware is dead code, and 8 MB exceeds Vercel's request body ceiling anyway.
- Dead code that misleads future readers: unused `DEMO_SCENES` import in `server.ts:79` (pulls the demo script into the server bundle), the "JSON database file paths" comment repeated three times, `Provider`-era leftovers.
- JSON/KV fallback mode does read-modify-write on a whole store with no locking: two concurrent saves lose one. Acceptable for a demo, dangerous the moment it is someone's data — and the fallback activates silently whenever `DATABASE_URL` is unset, including a misconfigured production deploy.
- Global limiter `100 req / 15 min` per IP is applied to *all* `/api` routes. A clinic behind one NAT IP shares that budget across every dentist and every poll; the job-poll exempt-regex covers only `GET /api/notes/jobs/:id`.

### 2.8 LOW — Docs, positioning, and drift

- `OUTREACH_CAMPAIGN.md` targets ANZ banking executives with APRA framing. It has nothing to do with dental practice software and reads as a leftover from a different project. Remove or replace it.
- `demo/README.md` and `docs/demo/README.md` duplicate each other.
- `README.md` calls the app "production-grade" while the gaps above exist, tells users to `npm install` in a repo that ships `bun.lock`, and does not mention the job fabric, metering, offline draft tiers' limits, or that `data/` must never be committed.
- `.env.example` lists keys but the deploy path's required set (`SESSION_SECRET`, `DATABASE_URL`, `GEMINI_API_KEY`, optional fallback/Vertex vars) is not validated at boot beyond `SESSION_SECRET`.

---

## 3. Requirements to become production-ready

Prioritised for one person with finite hours. **P0 blocks the first real patient record.** P1 blocks the first paying clinic. P2 is the first 90 days.

### P0 — Do not put real patient data through this until these are done

| # | Requirement | Acceptance criteria |
|---|---|---|
| P0.1 | **Purge PHI from the repo and prevent recurrence.** Remove `data/` from git, add `data/` to `.gitignore` (keeping an empty `data/.gitkeep` if needed), and stop tests from touching tracked files. | `git ls-files data` is empty; `git log --all -- data/` history is purged or the repo is treated as compromised and rotated; tests write to a temp dir or an in-memory store; two consecutive `npm test` runs leave the working tree clean. |
| P0.2 | **Make the storage engine explicit and fail-closed.** A production deploy with no `DATABASE_URL` must refuse to start rather than silently using JSON files. | `NODE_ENV=production` + missing `DATABASE_URL` → process exits with a clear message; JSON mode is reachable only in dev/test. A boot log line states the active engine and region. |
| P0.3 | **Retire `POST /api/generate-notes`,** or wrap it in the same metering + job fabric. | The route either 410s or routes through the shared core; one implementation of Gemini/Vertex/fallback routing remains; a test proves quota is enforced on every generation path. |
| P0.4 | **Real authentication.** Replace "public dentist directory + 4-digit PIN" with per-user credentials, and move lockout to durable storage. | `/api/auth/profiles` requires auth (or is reduced to a non-enumerating lookup); login uses email-or-user + password/passkey (or PIN + a durable, DB-backed attempt counter with a global (not per-instance) lockout); `DELETE /api/auth/profiles/:id` requires a valid session *and* re-auth, and records every attempt; `verifyToken` uses `timingSafeEqual`; tokens carry a `jti` and can be revoked (logout invalidates server-side); failed deletion attempts are audited. |
| P0.5 | **Account recovery and PIN/credential change inside the product.** | Self-service change-credential flow; recovery via verified email or an owner-issued one-time code; recovery never deletes consultations; `scripts/delete-profile.ts` is documented as an operator last resort only. |
| P0.6 | **A scheduler for the job worker.** A cron (Vercel Cron, or any external scheduler) hits the drain endpoint on a fixed interval, and that endpoint is protected by a shared secret rather than any authenticated dentist. | A job enqueued with no client polling afterwards reaches `done` and is persisted within N minutes; a job orphaned in `processing` is requeued and completed without any user traffic; the tick endpoint rejects normal user tokens. |
| P0.7 | **Fix the client/job timing mismatch.** | Either the server's first retry delay is inside the client's polling window, or the UI hands off cleanly ("we'll finish this in the background — it will appear in the History Hub") and notifies the dentist when done. Tested with a simulated quota failure. |
| P0.8 | **Log hygiene and PHI boundaries.** | No patient identifiers, transcripts, or prompt bodies in logs or error payloads; a documented list of exactly what is logged; log retention set on the platform. |
| P0.9 | **Consent and disclosure are persisted, not just clicked.** | The consultation stores consent state, timestamp, the AI disclosure version shown, and the engine/model used (`noteOrigin` extended with model id + version + timestamp). |
| P0.10 | **Residency is honest or enforced.** | Either the Vertex-only sovereign path is enforced for clinic data (fallback keys route through a same-region/contracted endpoint, or the app states clearly that fallback is a different region), or the "Australian sovereign" claim is removed from logs, README and marketing. The Web Speech path's third-party audio processing is disclosed to the clinic. |

### P1 — Required to onboard a paying clinic

| # | Requirement | Acceptance criteria |
|---|---|---|
| P1.1 | **Fail-safe error visibility.** Error tracking with alerting (email/Slack) on 5xx, quota exhaustion, failed jobs, and auth failures; `/api/health` reporting DB reachability, migration version, and queue depth. | A deliberately broken fake dependency triggers an alert to the founder within minutes; the health endpoint is what uptime monitoring watches. |
| P1.2 | **Versioned migrations with a down path.** Introduce a migration runner (plain SQL files or a tool) and run migrations as a deploy step. | A destructive change can be rolled back and verified on staging; cold-start DDL is gone. |
| P1.3 | **A staging environment with separate credentials and a separate database.** | Preview/staging uses its own `DATABASE_URL` + `SESSION_SECRET`; the deploy playbook names the promotion gate; a seeded staging dataset exists for QA. |
| P1.4 | **Postgres-path test coverage in CI.** | The suite runs against a throwaway Postgres (service container) with tests for atomic claim, metering, stuck-job requeue, and cross-tenant authorisation. |
| P1.5 | **Tenancy and access-control test matrix.** | Automated tests assert: a dentist cannot read/modify another dentist's consultation; a pending member sees nothing; a non-owner cannot approve/rotate/rename; a dentist cannot stamp a note into a clinic they are not active in (this one exists — keep it); owners' read access is audited. |
| P1.6 | **Note immutability and versioning.** | Every save creates a version with author, timestamp, engine and diff; a signed/final note cannot be silently overwritten; the audit log records reads as well as writes. |
| P1.7 | **Backups and a rehearsed restore.** | PITR enabled on the database; a restore has actually been performed into staging and documented; RPO/RTO stated in the runbook. |
| P1.8 | **Legal/paperwork surface.** | Privacy policy + T&C pages served by the app and linked from the landing page and sign-up; a DPA/dentist agreement template; a named processor list (Google, Neon, Vercel) with regions; a stated retention period and a patient-data deletion/export procedure (documented, even if manual at this stage). |
| P1.9 | **Abuse and cost controls.** | Per-clinic request/rate limits (not per-IP) so one clinic cannot exhaust another's budget; hard per-clinic daily token/cost cap with billing alerts; generation output size ceiling; metering counts successful generations and attempts separately. |
| P1.10 | **Support tooling for one person.** | A read-only operator view (or documented SQL) for: a clinic's members, usage, recent jobs, failed jobs with reasons, and audit events; a documented "customer says X is broken" checklist; deletion/rotation actions documented step-by-step. |
| P1.11 | **Production write paths are not scripts.** Remove the default `LIVE_URL` production target from the demo pipeline, gate demo accounts behind a non-production environment, and delete committed demo PINs. | `bun run demo` cannot touch production without an explicit env override; no credentials live in the repo. |
| P1.12 | **Bundle hygiene.** | The demo theater is lazily imported (or moved out of the app bundle); the unused `DEMO_SCENES` server import and dead routes/middleware are deleted. |

### P2 — First 90 days

1. **Billing.** Stripe (subscription per clinic/seat) with a trial, invoicing for practices, and a quota that maps to plan. Decide the free tier's daily note limit as a *product* number, not an env var default of 40.
2. **Transactional email.** Verification, recovery, join approvals, "your note is ready" notifications, receipts — a provider like Resend/Postmark. This is also what makes the invite-code growth loop finish (an owner currently has to watch the app for join requests).
3. **Analytics for the growth thesis.** The invite table is claimed as the analytics; instrument it (code → join → approve → active) and actually look at it weekly.
4. **Broader capture support.** Safari/iPad path: either accept manual typing + offline draft as the documented fallback, or add a server-side transcription provider; measure how often capture is unavailable in real clinics.
5. **PMS handoff.** Copy/print/export quality first (a note the dentist can paste into Dentex without reformatting), then an integration only if practices ask twice.
6. **Patient record continuity and patient-level deletion/export.**
7. **Cost model.** Per-note Gemini cost, per-clinic margin, and what the daily cap must be for the pricing to work. Track it before the first invoice.
8. **Clinical safety review.** A documented review with a dentist of the output on a set of real (de-identified) cases, plus a written "AI is an assistive draft; the clinician owns the record" statement in-product.

### Explicitly do not build yet

- Referral rewards, leaderboards, or gamified invites — the strategy doc already says so; hold that line.
- PMS integrations before the copy/paste path is measured.
- Additional note templates or treatment types; the template library is not the bottleneck.
- A multi-clinic owner dashboard beyond what exists until the invite loop shows real usage.
- Microservices, queues-as-a-service, or a rewrite. The current single-process design is appropriate for this stage — it needs a scheduler, tests, and migrations, not a new architecture.

---

## 4. Solo-founder operating model (what "supported" has to mean)

| Concern | Minimum viable answer for one person |
|---|---|
| Alerting | Error tracker + uptime check on `/api/health`, both routed to a phone-visible channel. If it does not page, it does not exist. |
| Triage | One page of runbook: symptoms → likely cause → action. Include "queue is backed up", "Gemini key exhausted", "job stuck in processing", "a clinic hit the daily cap". |
| Customer support | In-app issue reporting that attaches a request ID, plus the read-only operator view. Never ask a dentist to describe a console error. |
| Finance | Cost per note tracked, a hard daily spend cap per clinic, and billing alerts at 50/80/100% of the monthly Gemini budget. |
| Data handling | A written, one-page data-handling statement per clinic (where data lives, who processes it, how long it is kept, how it is deleted). Publish it — it closes sales and reduces support questions. |
| Security | Credential rotation calendar; dependency updates on a schedule (`npm audit` already runs in CI — act on it); one password manager vault for `SESSION_SECRET`, `DATABASE_URL`, and provider keys. |
| Release | Staging → smoke test → canary → promote, with the existing playbook; add the migration step and a post-deploy job-fabric check to it. |
| Roadmap discipline | Weekly: is the demo → signup → first-note funnel working? Monthly: does one clinic still use it after 30 days? That is the only signal that matters before feature work. |

---

## 5. What is genuinely good (keep it)

- The **tiered fallback chain** (Vertex → dev key → secondary key → offline rule-based draft → on-device WebLLM) with `noteOrigin.needsReview` surfaced in the UI and *zero fabrication* as an explicit rule is the best thinking in this codebase. It is the right clinical stance: never invent a diagnosis, always mark the draft.
- **Atomic job claims** with `FOR UPDATE SKIP LOCKED`, priority classes, and server-side backoff are correctly implemented and unusual to see at this stage.
- **Id convergence** (client-generated consultation id sent with the job so the worker's durable write and the client's save land on one record) plus `insertConsultationDeduped` is a real distributed-systems detail done right.
- **Point lookups instead of table scans** in auth, indexed clinic scoping, and the `consultation_clinic_id` backfill-compatible query.
- Honest engineering comments throughout — most of the rationale I needed was already written down by whoever built it.
- `bun tsc -b --noEmit` is clean and there is a real (if JSON-mode-only) test suite.

---

## 6. Open decisions that need the founder, not an engineer

1. **Credentials model:** keep a clinic-friendly PIN (it is genuinely good at the chairside) but move it behind real identity — e.g. email + PIN with a device-bound session and a durable lockout — or go full password/passkey? Chairside speed vs. audit defensibility.
2. **Residency:** is Australian-only processing a promise or a nice-to-have? It determines whether the fallback-key tier (and any cloud speech recognition) may touch clinic data at all.
3. **Free tier:** is the 40-notes/day cap a product decision or just an env default? It is currently the latter.
4. **Device target:** if iPads are the real chairside device, fund capture on Safari or make "type/offline draft on iOS" an explicit, tested workflow.
5. **Positioning:** delete `OUTREACH_CAMPAIGN.md` (banking) and replace with a dental-specific one-pager, or accept that the repo's docs are ahead of the go-to-market.
