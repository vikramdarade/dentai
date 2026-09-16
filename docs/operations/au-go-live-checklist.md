# AU go-live checklist

Two lists: what the code now does (so you know what you are relying on), and what
only you can do. Then a candid list of what is still missing, because a solo
founder needs to know which promises they are currently unable to keep.

## 1. Code — what is now true

| Control | Where |
|---|---|
| No universal/master PIN; per-account credentials only | `src/lib/authPolicy.ts`, `/api/auth/*` |
| PINs stored as salted PBKDF2 hashes; weak PINs rejected; constant-time comparison | `authPolicy.ts`, `server.ts` |
| Durable login lockout (shared across instances) and audited credential changes | `authPolicy.ts`, `logAudit` |
| Single-use, expiring, audited recovery codes instead of profile deletion | `/api/auth/recovery/*`, `scripts/issue-recovery-token.ts`, `CredentialScreen.tsx` |
| Session revocation across devices (`revoke-all`, PIN change rotates sessions) | `src/server/sessionSecurity.ts` |
| Profile deletion requires a session **for that account** plus the PIN | `server.ts` |
| Public profile directory can be switched off | `DENTAI_DISABLE_PROFILE_DIRECTORY` |
| All generation paths metered with per-clinic note **and** token ceilings; fails closed | `src/server/aiMetering.ts`, `server.ts` |
| Durable queue with atomic claims, plus a scheduler route so notes finish with no browser open | `src/lib/noteJobs.ts`, `src/server/opsRoutes.ts`, `vercel.json` |
| Consent captured at intake and stored on the record with the disclosure version | `PatientIntake.tsx`, `src/lib/compliance.ts`, `recordGovernance.ts` |
| Note revisions are append-only; record reads/writes are audited | `src/server/recordGovernance.ts` |
| Model provenance on every note (`noteOrigin`, `needsReview` for fallbacks) | `server.ts`, `ClinicalSummary.tsx` |
| Patient data no longer tracked in Git (`data/` ignored) | `.gitignore`, `git rm --cached data/*` |
| Production refuses silent file storage | `src/lib/db.ts` |
| Health endpoint, operator-only telemetry, error webhook | `src/server/opsRoutes.ts`, `logger.ts` |
| Account creation throttled (5/hour per address) and closable in one env flag, since each account carries its own AI allowance | `src/server/signupGuard.ts` |
| Privacy notice, terms, and AI disclosure reachable from landing and sign-in | `src/components/LegalPage.tsx`, `Landing.tsx`, `Login.tsx` |
| Queue drains with no browser open, requeues stuck jobs, shared-secret protected | `/api/cron/drain`, `src/server/opsRoutes.ts`, `vercel.json` |
| Error-rate, stalled-queue and database alerts pushed to a webhook | `src/server/alerting.ts`, `/api/health` |
| Retention enforced on a schedule, every deletion audited | `src/lib/retentionPolicy.ts`, `src/server/retention.ts`, `/api/ops/retention/run` |
| Practice-level terms/DPA acceptance recorded with versions | `src/server/practiceAgreement.ts`, `practice_acceptances` |
| Clinic can self-serve export its records (audited) | `src/server/clinicExport.ts`, `/api/clinic/export` |
| Real TOTP second factor, enforced at sign-in, with recovery codes | `src/lib/totp.ts`, `src/server/mfa.ts`, `Login.tsx` |
| Audit log hash-chained and verifiable | `src/lib/auditChain.ts`, `/api/ops/audit/verify` |
| Schema is versioned, with a rehearsed down path | `src/lib/migrations.ts`, `scripts/migrate.ts` |
| Production queries, claims, tenancy and migrations run in CI against real Postgres | `tests/postgres.test.ts`, `postgres` job in CI |
| Backup and restore rehearsal are scripts, not a habit | `scripts/ops/backup-database.sh`, `scripts/ops/restore-database.sh` |
| Note quality gated on a fixture set before a prompt/model change ships | `scripts/eval-notes.ts`, `docs/runbooks/clinical-eval.md` |
| Billing signature-verified with idempotent events; manual activation for invoice payers | `src/server/billing.ts`, `/api/ops/billing/activate` |

## 2. Founder — do these before the first real patient record

**Identity and cover**
- [ ] Entity name + ABN inserted into `LegalPage.tsx` (`LEGAL_ENTITY`)
- [ ] Professional indemnity and cyber liability insurance in place
- [ ] A support email address you monitor; a password manager for secrets
- [ ] `docs/legal/practice-agreement-checklist.md` sent, signed, and filed for the first practice

**Infrastructure**
- [ ] `DATABASE_URL` set; Neon project in **Sydney**; backups confirmed on
- [ ] Vercel (or host) deployment region **Sydney**
- [ ] `SESSION_SECRET`, `DENTAI_OPS_SECRET`, `CRON_SECRET` set to long random values
- [ ] `DENTAI_DISABLE_PROFILE_DIRECTORY=true`, `DENTAI_REQUIRE_CONSENT=true`
- [ ] `DENTAI_DAILY_NOTE_LIMIT` / `DENTAI_DAILY_TOKEN_LIMIT` set and priced into the plan
- [ ] `ERROR_WEBHOOK_URL` set; you have seen a test alert arrive on your phone
- [ ] `bun run db:migrate:status` shows every migration applied against the **production** database
- [ ] Scheduler hitting `/api/cron/drain` every minute (cron or external pinger) and returning `ok:true`
- [ ] Uptime monitor on `/api/health`
- [ ] `bun run ops:backup` scheduled nightly, writing to encrypted storage you control
- [ ] **One restore rehearsed** with row counts recorded
  (`sh ./scripts/ops/restore-database.sh <dump> --target <scratch-url>`)

**Product**
- [ ] One full consultation recorded on the practice's own hardware, in their room, with their clinician
- [ ] Offline draft path exercised deliberately (disconnect the AI key in a staging env) and the review banner explained to the clinician
- [ ] Printed patient letter and saved note checked against the practice's existing format
- [ ] Invoice/plan confirmed in writing — including what happens at the daily AI ceiling
- [ ] Decided whether self-serve signup stays open (`DENTAI_ALLOW_SELF_SIGNUP`); for a first cohort, onboarding by hand with it closed is the safer default

## 3. Known limitations — be honest about these

These are real gaps, in priority order. Do not claim the capability until the
item is closed.

1. **No staging environment.** You currently test on preview deployments against
   shared data, so a migration rehearsal there is not free of consequence. *Fix:* a
   second database (Neon branch) wired to preview builds.
2. **Telemetry is per-instance** and resets on cold start. Alerting is a webhook,
   not a metrics platform; there is no error-rate history to look at after the
   fact. *Fix:* ship logs to a queryable sink.
3. **The clinical gate is a regression detector, not validation.** Synthetic
   fixtures with keyword expectations catch an invented diagnosis and a broken
   field; they cannot tell you a note is clinically sound, and they do not cover
   speech-to-text errors. *Fix (before scale):* a reviewed sample of real,
   consented cases. See `docs/runbooks/clinical-eval.md`.
4. **Migrations are untested at production size.** They are proven on empty and
   small databases (`tests/postgres.test.ts`); the first migration on a large
   `audit_logs` table has not been timed for lock duration. *Mitigation:* rehearse
   against a restored copy of production first (`bun run ops:restore` into a
   scratch database), then apply.
5. **Billing does not charge a card yet.** Entitlements, plans and a
   signature-verified webhook exist, but until the Stripe keys are set and a real
   test-mode checkout is run, invoicing is manual.
6. **Speech-to-text quality and residency depend on the browser.** Where the
   browser engine is used, audio handling is the browser vendor's and the accuracy
   is theirs too. Typing the transcript is always available; say so to practices
   with strict residency requirements.
7. **PMS integration does not exist.** Notes are copied into the practice's
   system manually. This is the most common follow-up request; price the effort
   before promising it.
8. **Support is you.** Business hours only; the runbook defines what you promise,
   and the operator console is an API rather than a screen, so a phone-based fix is
   still a terminal-based fix.

## 4. The first 30 days after go-live

- Week 1: sit with the clinician after every session. Fix what they say first —
  their tolerance for friction is your retention.
- Week 2: measure notes per clinician per day and cost per note. If cost per note
  is above roughly 10% of what the clinic pays, fix the model path before adding
  anyone.
- Week 3: complete the first monthly restore rehearsal and review the access log.
- Week 4: only then consider a second practice — the second clinic is where
  multi-tenancy assumptions (clinic scope, colleague records, invite codes) get
  tested for real.
