# Build backlog — what is missing, in priority order

**How to read this.** P0 = do not put a real patient record in the system until
it is done. P1 = needed within the first 30 days of a clinic actually paying.
P2 = needed to run this as a business. P3 = later, when volume justifies it.
Sizes are rough founder-days.

The security and compliance foundations are already in place (`docs/operations/au-go-live-checklist.md`
section 1). This list is everything that is still missing to *operate* it.

---

## Status

Last worked: 2026-09-16. Verified with `bun tsc -b --noEmit` (clean) and
`bun run test` (183 passing, 22 skipped locally — the Postgres suite and three
environment-dependent cases run in CI). What is left is almost all *your* actions:
secrets, the Sydney database, insurance, and the restore rehearsal.

| # | Item | Status | Where it lives now |
|---|---|---|---|
| P0.1 | Unify the package manager | **Done** (Bun end to end) | `package.json`, `.github/workflows/ci.yml`, `.husky/pre-commit`, `bun.lock` |
| P0.2 | Deploy target runs the API | **Docs done, deploy is yours** | `docs/operations/environment-reference.md` §Platform placement, `vercel.json` |
| P0.3 | Production environment and region | **Tooling done, values are yours** | `src/server/configCheck.ts`, `docs/operations/environment-reference.md` |
| P0.4 | Scheduler actually running | **Code done, scheduler is yours** | `/api/cron/drain` in `src/server/opsRoutes.ts`, `vercel.json` |
| P0.5 | Backups + a rehearsed restore | **Scripts and runbook done, rehearsal is yours** | `scripts/ops/backup-database.sh`, `scripts/ops/restore-database.sh`, `docs/runbooks/backup-and-restore.md` |
| P1.1 | Postgres-backed tests | **Done** | `tests/postgres.test.ts`, `postgres` CI job |
| P1.2 | Versioned migrations with a down path | **Done** | `src/lib/migrations.ts`, `scripts/migrate.ts` |
| P1.3 | Staging environment | **Not started** — needs a second database and a preview wiring decision | — |
| P1.4 | Alerting on error rate, queue depth, db down | **Done** (webhook-based) | `src/server/alerting.ts`, `/api/health`, drain tick |
| P1.5 | Practice accepted the terms/DPA | **Done** | `src/server/practiceAgreement.ts`, `practice_acceptances` table, `docs/legal/practice-agreement-checklist.md` |
| P1.6 | Retention enforced, not just stored | **Done** | `src/lib/retentionPolicy.ts`, `src/server/retention.ts`, `/api/ops/retention/run` |
| P1.7 | Durable rate limiting | **Done** | `src/server/durableRateLimit.ts`, `rate_limit_counters` table |
| P1.8 | Self-serve clinic export | **Done** | `src/server/clinicExport.ts`, `/api/clinic/export` |
| P1.9 | Clinical accuracy gate | **Done** | `src/lib/clinicalEval.ts`, `scripts/eval-notes.ts`, `tests/fixtures/clinical-eval/`, `docs/runbooks/clinical-eval.md` |
| P2.1 | Billing entitlements, verified webhook | **Done** (no card charging in production until Stripe keys are set) | `src/server/billing.ts`, `src/lib/plans.ts`, `subscriptions`/`billing_events` tables |
| P2.2 | Transactional email | **Done** (needs a provider key) | `src/server/email.ts`, `clinic_invites` table |
| P2.3 | Operator support console | **Done** (API; a UI is not built) | `src/server/opsRoutes.ts`, `src/server/opsActions.ts`, `/api/ops/*` |
| P2.4 | PMS handoff | **Improved** (copy/print/plain-text); no integration, by design | `src/lib/noteExport.ts`, `ClinicalSummary.tsx` |
| P2.5 | Repo and pitch hygiene | **Done** | `docs/marketing/archive/`, `docs/assets/screenshots/` |
| P3.1 | MFA (TOTP) | **Done** | `src/lib/totp.ts`, `src/server/mfa.ts`, credential screen |
| P3.2 | Audit-log integrity | **Done** | `src/lib/auditChain.ts`, `/api/ops/audit/verify` |
| P3.3 | Load and abuse testing | **Partly** (payload bounds, prompt-injection and concurrency cases; no load test) | `tests/abuse.test.ts`, `src/server/payloadValidation.ts` |
| P3.4 | Offline-sync conflict rule | **Done** (optimistic concurrency, audited) | `src/server/recordGovernance.ts` |
| P3.5 | Accessibility and device pass | **Not started** — deliberately deferred, see below | — |

### What each change was, and why

**P0.1 — one package manager.** Two lockfiles were committed (`package-lock.json`
with `npm ci`, plus `bun.lock` with the preview's `bun install`), so CI and the
preview could disagree about the dependency tree. Bun is now the only package
manager: CI uses `oven-sh/setup-bun` and `bun install --frozen-lockfile`, husky
calls bun, `package-lock.json` is deleted, and `package.json` carries a comment
saying not to reintroduce an npm lockfile. `bun audit` still runs but can no
longer fail a clinic's deploy — a new transitive advisory is reported as a build
artifact instead of blocking at 8am, with a monthly review instead.

**P0.2 / P0.3 — a deploy that can actually run the API, and the config it needs.**
The product is an Express API plus a Vite client, so a static-only host serves the
landing page and 404s every `/api/*` call. Nothing changed in the *shape* of the
deployment (Vercel was already wired through `vercel.json` + `api/index.ts`), but
the two viable paths are now written down with the exact commands, the region
decision (Sydney) and the fallback (`node server.js` with
`DENTAI_QUEUE_INTERVAL_MS=60000`). `src/server/configCheck.ts` validates the
environment at boot and tells you which key is missing rather than failing on the
first patient request.

**P0.4 — the queue drains without a browser.** The note queue was only ticked by
"another dentist submits a note" or "the browser polls". A note submitted on a
closed laptop could sit queued indefinitely. `GET|POST /api/cron/drain`
(`CRON_SECRET`, constant-time comparison) drains and requeues stuck jobs, and
`vercel.json` schedules it every minute. The client poll is also resilient now:
the queue is authoritative, so a dropped request retries rather than abandoning
the note.

**P0.5 — backups as a script, not a habit.** `scripts/ops/backup-database.sh`
writes a custom-format `pg_dump`, refuses to write when `DATABASE_URL` is absent,
fails if the dump is implausibly small (an empty database is the failure that
otherwise looks like success), and does *not* upload anywhere — clinical data must
not travel to a destination chosen by a script. `scripts/ops/restore-database.sh`
requires an explicit `--target`, refuses to restore over the live database without
`DENTAI_CONFIRM_DESTRUCTIVE=true`, and prints the row counts and newest record
afterwards, which is the evidence the runbook asks you to record.

**P1.1 / P1.2 — the production persistence path is now tested, and reversible.**
Every test ran with `DATABASE_URL=''`, so queries, indexes, `SKIP LOCKED` claims,
tenancy scoping and migrations were only ever exercised in the mode production
does not use. `tests/postgres.test.ts` runs the real statements against a
disposable Postgres (via a small TCP seam, `setSqlExecutorForTests`, so the code
under test is the production code) and CI's `postgres` job starts a real database,
applies the migrations, rehearses a rollback, and runs the suite. Schema changes
moved from cold-start `CREATE TABLE IF NOT EXISTS` into numbered migrations with a
recorded checksum and a **required** down path: `scripts/migrate.ts` gives
`up`/`down`/`status`, boot still applies forward-only migrations, and editing an
already-applied migration is refused unless `DENTAI_MIGRATION_FORCE=true`.

**P1.4 — you find out before the clinic does.** `src/server/alerting.ts` pushes to
`ERROR_WEBHOOK_URL` (Slack/Teams/Discord) on error-rate spikes, a stalled queue
(depth is a busy morning; *age* is a broken worker), and a failed database probe.
`/api/health` reports `alerting: true|false` so a misconfigured webhook is visible
rather than assumed.

**P1.5 — evidence that the practice agreed.** Per-patient consent was stored, but
nothing recorded that the *practice* accepted a version of the terms and the data
terms. `practice_acceptances` stores clinic, terms/privacy/DPA versions, who
accepted and when, with re-acceptance when a version changes — the document a
practice manager asks for.

**P1.6 — retention is behaviour.** `retentionUntil` used to be written and never
read. `src/lib/retentionPolicy.ts` defines the schedule (7 years for clinical
records), `src/server/retention.ts` sweeps expired records on the drain tick, and
`/api/ops/retention/run` runs it deliberately. Every deletion is audited.

**P1.7 — rate limits that survive a cold start.** In-process counters are
per-instance on serverless, so they bounded nothing. `rate_limit_counters` in
Postgres now backs the limiter, with the in-memory store kept as the development
fallback the tests use.

**P1.8 — a clinic can take its records.** Export is no longer a `psql` job for
you: `/api/clinic/export` returns the clinic's records, and the history view can
download a single consultation as structured JSON or plain text for a practice's
own system. Exports are audited.

**P1.9 — a gate on note quality.** A synthetic-transcript fixture set, a scorer,
and `bun run eval:notes` run in CI on every change: keyword expectations per
field, required fields, forbidden text (an invented diagnosis fails the run), and
fabricated clinical codes. `docs/runbooks/clinical-eval.md` states plainly what it
does *not* prove, because a keyword check is not clinical validation.

**P2.1 — billing that cannot be self-provisioned.** `src/server/billing.ts`
verifies the Stripe signature, de-duplicates by event id, reads the real period
from the subscription, and refuses to activate in production without a configured
key. Manual activation exists for the first cohort who pay by invoice.

**P2.2 — email for the messages that matter.** `src/server/email.ts` covers
invitations, recovery codes and receipts, with the provider key read at send time
so a missing key produces a clear operator error rather than a silent no-op.
`clinic_invites` records who invited whom.

**P2.3 — an operator view.** `/api/ops/*` (behind `DENTAI_OPS_SECRET`) lists
clinics with member counts and plan, queue depth, recent audit entries, and the two
routine actions — issue a recovery code, force a drain — plus locking an account
and verifying the audit chain. It is an API today; the UI is a follow-up.

**P3.1 — MFA that verifies something.** Real TOTP (`src/lib/totp.ts`) with
recovery codes, enforced at sign-in: the login route is wrapped so a correct PIN
returns `401 { mfaRequired: true }` and no session until a valid code (or a
single-use recovery code) is presented. Enrolment, re-issue and disable live on the
credential screen and each is audited.

**P3.2 / P3.4 — the record can be trusted afterwards.** Audit entries are hash
chained (`prev_hash`/`hash`), so `/api/ops/audit/verify` can distinguish "this log
is intact" from "someone edited the database". Consultation saves are versioned:
a stale write is rejected instead of silently overwriting a colleague's correction.

**P3.3 — the obvious abuse cases are tested.** Bounded payloads, oversized arrays,
prompt-injection strings against the template path, and concurrent claims for the
same job. What is *not* done: real load testing and edge-level bot protection.

**Also fixed, from the same review.** No universal/master PIN and exact-name login
(`src/lib/authPolicy.ts`), salted PBKDF2 with weak-PIN rejection and constant-time
comparison, durable login lockout, single-use expiring audited recovery codes
instead of deleting a profile, cross-device session revocation
(`src/server/sessionSecurity.ts`), account-creation throttling and a
one-flag close of self-serve signup (`src/server/signupGuard.ts`), metering that
fails closed on every generation path (`src/server/aiMetering.ts`), append-only
note revisions with audited reads (`src/server/recordGovernance.ts`), consent
captured at intake and stored with its disclosure version, patient data untracked
from Git, production refusing silent file storage, the demo pipeline unable to
write to a non-local target without `DEMO_ALLOW_REMOTE=true`, and a privacy
notice / terms / AI disclosure page linked from the landing page and sign-in.

### Still genuinely open (do not claim these)

1. **No staging environment** (P1.3). Preview deployments run against shared data,
   so a migration rehearsal there is not free of consequence. Fix: a Neon branch
   wired to preview builds.
2. **Accessibility and iPad pass** (P3.5). The clinician screens have never been
   through a WCAG review or used on a tablet at a chair.
3. **No load test.** Concurrency on note generation is untested beyond the claim
   race in `tests/postgres.test.ts`.
4. **Migrations are not yet exercised against a production-sized database.** They
   are correct on empty and small databases; the first real migration on a large
   `audit_logs` table is untested for lock time.
5. **No support console UI**, only the API. Support is still you, at a terminal,
   or curl.
6. **`.env.example` is stale by design.** Writing that file is blocked in this
   workspace (it is treated as a secret), so
   `docs/operations/environment-reference.md` is the source of truth. Treat the
   in-repo `.env.example` as historical and do not copy it into production.
7. **Nothing here is a substitute for one real clinic.** Every item above is
   opinion until a clinician uses it on a patient with the practice's consent.

---

## P0 — before the first real patient record (est. 2–3 days)

### P0.1 Unify the package manager and lockfiles
**Missing.** Two lockfiles are committed and two tools are used: `package-lock.json`
with `npm ci` / `npm run lint|test|build` in `.github/workflows/ci.yml` and
`.husky/pre-commit`, plus `bun.lock` with the `bun install` / `bun run dev`
preview command. The two trees can drift, so "green in CI" and "works in the
preview" can stop meaning the same thing.
**Done when.** One package manager end to end. Either (a) Bun everywhere:
`oven-sh/setup-bun`, `bun install --frozen-lockfile`, `bun run …`, delete
`package-lock.json`; or (b) npm everywhere: delete `bun.lock`, change the preview
command to `npm run dev` and the install command to `npm ci`.
**Also in this item.** `npm audit --audit-level=high` currently fails the build on
any new high-severity transitive advisory, with no triage path. Make it advisory
(report, do not fail) plus a monthly manual review, or pin and review instead.
**Size.** 0.5 day.

### P0.2 Confirm the deploy target actually runs the API
**Missing.** This is not a static Vite site: the product is an Express API
(`server.ts`, `api/index.ts`) plus a Vite client. A static-only host (including
Freebuff-managed hosting, which builds `dist/` and serves files) will serve the
landing page and return 404 for every `/api/*` call — including `/api/health` and
sign-in. The cron I added also assumes a scheduler-capable host.
**Done when.** A production URL is live and verified: `/api/health` returns
`{"status":"ok","storage":"postgres","database":"ok"}`, sign-in works, a note
generates. Either deploy on Vercel (the `vercel.json` + `api/index.ts` path is
already wired, and Vercel Cron drives `/api/cron/drain`) or run `node server.js`
on a container with `DENTAI_QUEUE_INTERVAL_MS=60000`.
**Size.** 0.5 day.

### P0.3 Production environment, region and secrets
**Missing.** Nothing in production is configured yet — and the sandbox values are
not production values.
**Done when.** Set in the production environment: `DATABASE_URL` (Neon **Sydney**),
`SESSION_SECRET`, `GEMINI_API_KEY`, `DENTAI_OPS_SECRET`, `CRON_SECRET`,
`ERROR_WEBHOOK_URL`, `DENTAI_DISABLE_PROFILE_DIRECTORY=true`,
`DENTAI_REQUIRE_CONSENT=true`, `DENTAI_DAILY_NOTE_LIMIT`,
`DENTAI_DAILY_TOKEN_LIMIT`, and the host's deployment region set to Sydney. Then
verify `/api/health` (`storage: postgres`, `alerting: true`) and that a deliberate
test error reaches your phone.
**Size.** 0.5 day.

### P0.4 The scheduler is actually running in production
**Missing.** The cron route exists but nothing calls it in production. On Vercel's
Hobby plan a `*/1` cron only runs daily — a queue that drains once a day is not
durable enough to sell. Freebuff-managed hosting runs no scheduled jobs at all.
**Done when.** Every minute, something calls `POST /api/cron/drain` with
`CRON_SECRET` and gets `ok:true`, verified by submitting a note, closing the tab
immediately, and finding it complete two minutes later.
**Size.** 0.5 day (Pro plan, or an external pinger from `docs/runbooks/queue-scheduling.md`).

### P0.5 Backups on, and one restore actually rehearsed
**Missing.** No evidence backups are configured, and no restore has been run.
**Done when.** Neon history/PITR confirmed for the plan, a nightly `pg_dump` to
encrypted storage, and one restore into a scratch database with row counts
recorded (`docs/runbooks/backup-and-restore.md`).
**Size.** 0.5 day.

---

## P1 — within 30 days of the first paying clinic (est. 2–3 weeks)

### P1.1 The test suite never touches Postgres
**Missing.** `tests/server.test.ts` forces `DATABASE_URL=''`, so the entire suite
runs against the JSON store. Queries, indexes, transactions, `FOR UPDATE SKIP
LOCKED` claims and migrations are all untested, and CI has no database service.
Everything the queue gets right structurally is asserted only in the mode
production does not use.
**Done when.** CI runs the suite twice — JSON store and a disposable Postgres
(GitHub Actions service container or a Neon branch) — and a tenancy matrix proves
clinic A cannot read clinic B's consult, member, job, usage or audit rows.
**Size.** 2–3 days.

### P1.2 Migrations have no version and no down path
**Missing.** Schema is created by `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE …
IF NOT EXISTS` running on cold start. There is no version table, no ordering
guarantee, no record of what ran, and no rollback. A bad change requires a restore.
**Done when.** A `schema_migrations` table, numbered migration files applied
deliberately (a script, not a side effect of the first request), each with a
stated reverse operation, and one migration rolled back in staging to prove it.
**Size.** 2 days.

### P1.3 No staging environment
**Missing.** Every test currently happens against either local files or the
environment a clinic is using. The demo pipeline now defaults to localhost, which
helps, but there is still nowhere to rehearse a migration or a model change.
**Done when.** A second database (Neon branch) wired to preview deployments, with
the demo pipeline pointed at it.
**Size.** 1 day.

### P1.4 Nothing surfaces an error unless someone is looking
**Missing.** `ERROR_WEBHOOK_URL` exists, telemetry is per-instance and resets on
cold start, and there is no uptime monitor or error tracker. There is no alert on
the two conditions that matter most: error rate above ~1%, and `openNoteJobs`
climbing and not draining.
**Done when.** Uptime monitor on `/api/health`; an error tracker or log sink
receiving stack traces; alerts on error rate, queue depth and database
unavailability; each alert proven once by breaking it on purpose.
**Size.** 1–2 days.

### P1.5 No record that a practice accepted the terms
**Missing.** Disclosures are versioned (`AI_DISCLOSURE_VERSION`,
`PRIVACY_NOTICE_VERSION`) and consent is stored per consultation, but nothing
records the *practice* accepting a specific version of the terms or the DPA. That
is the first document a dispute or a due-diligence review asks for.
**Done when.** Signup/clinic creation records `{termsVersion, privacyVersion,
acceptedAt, acceptedByName, acceptedByEmail}` and it is visible to the practice
owner; changing either document's version requires re-acceptance.
**Size.** 1 day.

### P1.6 Retention is policy but not behaviour
**Missing.** Every consultation carries `retentionYears`/`retentionUntil`
(7 years by default) and `docs/legal/retention-and-deletion.md` promises deletion
or de-identification after that. Nothing enforces it — the promise is currently
untested and unexecuted.
**Done when.** A scheduled job reports records past `retentionUntil` and performs
the configured action (de-identify or delete) with an audit entry, run manually
approved the first time.
**Size.** 1 day.

### P1.7 Rate limits are per instance
**Missing.** `apiLimiter` / `credentialLimiter` store counters in process memory.
On serverless, each instance keeps its own counters, so IP-based limits are
best-effort. (The per-account lockout *is* durable — that is the important one.)
**Done when.** Limiter counters live in Postgres or Redis/Upstash, or the limits
are documented as best-effort with the durable lockout as the real control.
**Size.** 1 day.

### P1.8 No export a practice can run itself
**Missing.** Data portability is a documented promise, but export is a `psql`
command in a runbook. Every patient access request becomes a manual task for you,
and a practice leaving has to ask you for its own records.
**Done when.** A practice owner can export their clinic's records (JSON/CSV) from
the app, and the export is audited.
**Size.** 1–2 days.

### P1.9 No clinical-accuracy gate on model or prompt changes
**Missing.** Nothing measures whether a prompt, model or template change made
notes better or worse. The controls are schema shape, the "never fabricate"
rule, and mandatory review — none of which is a regression test.
**Done when.** A fixed set of synthetic transcripts with expected findings, a
score recorded per run, and a rule that a change which lowers the score cannot ship.
**Size.** 2–3 days.

---

## P2 — to run this as a business (est. 4–6 weeks)

### P2.1 Billing and entitlement enforcement
**Missing.** A `subscriptions` table exists in the schema (with
`stripe_subscription_id`) but nothing reads or writes it, no card is charged, and
nothing suspends a clinic. The daily ceilings cap cost; they do not collect revenue.
**Done when.** A plan per clinic, entitlements enforced server-side, invoicing or
card charging, and a defined behaviour at the ceiling (degrade to offline draft —
already implemented — rather than silently failing).
**Size.** 5–8 days.

### P2.2 Transactional email
**Missing.** There is no email path at all: invites are copied out of the UI,
recovery codes are read aloud by you, and there is no receipt or onboarding
sequence. This also blocks self-serve PIN recovery.
**Done when.** A transactional provider sends invitations, recovery codes,
onboarding and receipts, from a domain with SPF/DKIM/DMARC set up.
**Size.** 2–3 days.

### P2.3 Support console
**Missing.** Operating means `curl` against `/api/ops/*` and running scripts. That
does not scale past a handful of clinics, and it cannot be done from a phone.
**Done when.** An operator-only view: clinics and their usage, queue depth, recent
audit events, and buttons for the two routine actions (issue recovery code, force
drain) — reusing `DENTAI_OPS_SECRET`.
**Size.** 3–4 days.

### P2.4 PMS handoff
**Missing.** Notes are copied into the practice's system by hand. This is the most
commonly requested follow-up and the honest answer today is "we don't integrate".
**Done when.** Either a documented, fast copy/print flow that a practice accepts,
or one real integration, priced before it is promised.
**Size.** 1 day (copy/print polish) to 3+ weeks (a real integration).

### P2.5 Repo and pitch hygiene
**Missing.** `OUTREACH_CAMPAIGN.md` pitches this codebase as an ANZ *banking* case
study, and a stray `dentai_vercel_demo_*.webp` sits at the root. A clinic doing
due diligence on a clinical product will read both.
**Done when.** Marketing artefacts are moved under `docs/marketing/` or removed,
and the root reads as one product.
**Size.** 1 hour.

---

## P3 — later, when volume justifies it (est. 3–4 weeks)

- **P3.1 MFA (TOTP)** for clinician accounts — needed to answer clinic security
  questionnaires; not needed for correctness. 2–3 days.
- **P3.2 Audit-log integrity** — hash-chain or WORM storage so the access log
  cannot be altered by anyone with database access. 2 days.
- **P3.3 Load and abuse testing** — concurrency on note generation, prompt-injection
  attempts against the template path, and IP/bot protection at the edge. 2–3 days.
- **P3.4 Offline sync review** — local-first notes with a return-to-network sync
  need an explicit conflict rule ("last write wins" is a silent data-loss bug for
  a clinical record). 2 days.
- **P3.5 Accessibility and device pass** — iPad/tablet capture at the chair, plus
  a WCAG pass on the clinician-facing screens. 3–5 days.

---

## The one-line version

To *build and support* this today: unify the package manager, decide where the
Express API actually runs, configure production (Sydney database, secrets, ops
secret, cron, alerting), confirm a scheduler is draining the queue, and rehearse a
restore. Everything after that is Postgres-backed tests, real migrations, staging,
alerting and a terms-acceptance record — then billing and email.
