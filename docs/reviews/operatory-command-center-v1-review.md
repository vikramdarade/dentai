# Review: `preview/operatory-command-center-v1` — Findings, Recommendations, Gotchas

**Branch:** `origin/preview/operatory-command-center-v1` @ `722f487`
**Merge-base with `main`:** `0f3deef` (the commit reviewed in `production-readiness-review.md`)
**Size:** 71 commits, 230 files, **+48,140 / −2,757** lines
**Reviewed against:** the P0/P1 requirements in `production-readiness-review.md`
**Repository visibility (checked via GitHub API):** **PUBLIC** — `https://github.com/vikramdarade/dentai`

---

## 0. Read this first (stop-work items)

Two findings on this branch are not code-quality issues. They are live exposure and legal exposure, and they should be handled before any further feature work.

### 0.1 There is a universal master PIN in the login path

```ts
// server.ts (branch)
function verifyPinComprehensive(rawPin, dentist) {
  // Universal master/recovery PIN: '1234' is accepted for all practitioners
  // so no clinician is ever locked out of their clinical records.
  if (pin === '1234') return true;
```

And there is an unauthenticated endpoint that resets **any** account's PIN to `1234`:

```
POST /api/auth/reset-pin   { identifier: "<any dentist name or id>", newPin: "1234" }
```

`Login.tsx` exposes this as a button labelled **"Reset PIN to 1234 & Sign In"** (line 443), and the E2E helper `loginAsDentist()` signs in as a named dentist by tapping 1-2-3-4. The endpoint is not authenticated, does not verify the current PIN, does not require an email, token, or owner approval, has no lockout, and returns the new PIN in the response body (and logs it).

The attack chain needs no cracking at all:

1. `GET /api/auth/profiles` (public) → list every dentist's `id`, `name`, `specialty`.
2. `POST /api/auth/login` with any of those names + PIN `1234` → valid session token.
3. `GET /api/consultations` → that clinician's patients, transcripts, DOB, notes. `GET /api/clinics/:id/consultations` → every note in a clinic they own.
4. Or `DELETE /api/auth/profiles/:id` with PIN `1234` → delete any clinician's account (also unauthenticated).

`verifyPinComprehensive` additionally accepts a long list of candidate salts (including hardcoded literals and the legacy constant `dentai-secure-workstation-session-secret`) and `verifyPinHash` now accepts plaintext equality, MD5, unsalted SHA-256/512, HMAC, and eight different PBKDF2 iteration counts. Credential verification no longer establishes anything; it is written to make *any* attempt succeed.

### 0.2 Patient data sits in a public repository, and the deployment bundles it

`git ls-files data` on this branch:

| File | Size in branch | Contents |
|---|---|---|
| `data/schedules.json` | 32 KB | `patientName`, procedure text, ADA items, `consentObtained`/`consentCapturedAt`, pre-op briefs |
| `data/consultations.json` | 24 KB | `firstName`/`lastName`, `dob`, full transcripts, findings, patient summaries |
| `data/audit.json` | 100 KB | event log, dentist ids |
| `data/note_jobs.json` | 15 KB | queued job payloads containing transcripts |
| `data/users.json` | 1.4 KB | `pinHash` + `salt` for every account |
| `data/clinics.json` | 4 KB | clinic records incl. invite codes |

10 commits have written into `data/`. `.gitignore` still does not exclude `data/`. And `vercel.json` now does this:

```json
"functions": { "api/index.ts": { "includeFiles": "data/**" } }
```

so the same files are shipped inside the serverless function bundle on every deploy — including preview deployments, which are exactly the deployments people paste into Slack.

**What to do about it (in order, today):**

1. Take the repository **private** (it is public right now).
2. Determine whether any of that data is real patient or real clinician data. If yes, this is very likely a **Notifiable Data Breach** under the Privacy Act 1988 (NDB scheme) — get advice and follow the OAIC/individual notification path. Synthetic seed data changes the legal answer but not the security answer.
3. Remove `data/` from tracking, purge it from history (`git filter-repo`), force-push, and treat every credential in the repo as compromised: `SESSION_SECRET` (its hardcoded fallback is in the code, so tokens are forgeable even without the env), `GEMINI_API_KEY`/fallback key, the GCP service-account key, Neon credentials, Vercel tokens, and the Stripe keys once added.
4. Because PIN hashes and salts are public **and** the master PIN bypasses hashing entirely, assume every account is compromised: invalidate all sessions, remove the master PIN, and force every clinician to set a new credential.
5. If the deployment at `dentai-one.vercel.app` (the demo pipeline's default target) is live with real data, disable it until 0.1 is fixed. Do not "fix forward" in place.

---

## 1. Are the earlier P0/P1 findings fixed on this branch?

| # | Finding from the main-branch review | Status on this branch |
|---|---|---|
| P0.1 | PHI tracked in git | **Worse.** `schedules.json`, `note_jobs.json`, `clinics.json`, `tickets.json`, `feedback.json` are now tracked too, and `vercel.json` bundles `data/**` into the deployed function. |
| P0.2 | Storage must fail closed if `DATABASE_URL` is missing | **Not fixed.** JSON-file mode is still a silent fallback, and `setInterval`-based features assume a long-lived process. |
| P0.3 | Retire/instrument the unmetered `/api/generate-notes` | **Not fixed.** Still no `getUsageCountToday`/`usageSnapshotFor` call anywhere in the handler (±260 lines). |
| P0.4 | Real authentication | **Regressed catastrophically.** Login is now name-searchable *and* has a universal PIN, plus an unauthenticated PIN-reset endpoint. "MFA" was added but verifies nothing (§2.5). |
| P0.5 | Credential change/recovery inside the product | **Implemented unsafely** — recovery exists, but as an unauthenticated reset of anyone's PIN. |
| P0.6 | A scheduler for the note-job worker | **Not fixed.** `tickNoteJobs` is still called only from submit (server.ts:714), poll (:727) and the manual route (:787). No `crons` in `vercel.json`. A `setInterval` was added — but for the company-briefing cycle, not the clinical queue. |
| P1.1 | Error visibility / health endpoint | **Partially.** `/api/telemetry` and `/api/speech/status` exist but are unauthenticated and per-instance. No error tracking or alerting. |
| P1.4 | Postgres-path coverage in CI | **Not fixed.** `tests/server.test.ts:25` still forces `DATABASE_URL = ''`, so the production persistence path remains untested. |
| P1.6 | Note versioning / audit of reads | **Not fixed.** `/api/audit/verify` was added (good instinct), but `PUT /api/consultations/:id` still overwrites the record wholesale and reads are still unaudited. |
| P1.11 | Demo/test paths must not write to production | **Not fixed, and widened.** `test:e2e:prod`, dynamic `BASE_URL`, `VERCEL_AUTOMATION_BYPASS_SECRET`, and `loginAsDentist()` with PIN 1234 mean the E2E suite can drive the production app as a real clinician. `data/schedules.json` contains `sched_demo_*` sample-day entries, so sample data has already reached the committed store. |
| P1.12 | Bundle hygiene | **Better for the demo** (demo is still static, but `App.tsx` is now a shell), **worse overall**: the mono-server grew from 2,172 to **5,500 lines** with 67 routes. |

Net: **one P0 shifted from "unfixed" to "actively dangerous".**

---

## 2. New findings on this branch, ranked

### 2.1 CRITICAL — Unauthenticated billing webhook can grant a free paid tier

`POST /api/billing/webhook` (server.ts:4890) does **no signature verification** — a repo-wide search for `constructEvent`, `stripe-signature`, or `STRIPE_WEBHOOK_SECRET` returns nothing. It trusts the request body:

```ts
const event = req.body;
if (event.type === 'checkout.session.completed') {
  const clinicId = session?.client_reference_id || session?.metadata?.clinicId;
  const tier = session?.metadata?.tier || 'clinic_pro';
  ... await dbSaveSubscription({ clinicId, tier, status: 'active', seats: ... });
```

Anyone can POST a hand-written JSON body to self-provision `clinic_pro` or `enterprise` for any `clinicId`. This is the revenue-integrity hole, and it is the one that makes the billing work actively harmful rather than merely incomplete.

Related billing gotchas:
- **`stripe` is not in `package.json` dependencies.** The live path does `await (new Function("m", "return import(m)")('stripe'))` on a package that `npm ci` will never install. Deployed with a real `STRIPE_SECRET_KEY`, checkout throws; without one, `isMock` silently returns a fake "success" URL — so the pricing flow *appears* to work while collecting nothing.
- `handleWebhook` is not idempotent (no event-id dedupe), and it constructs `currentPeriodEnd` as now+30 days rather than reading the subscription's real period.
- No `customer.subscription.updated`, `invoice.payment_failed`, or trial-ending events, so dunning and plan changes do not exist.

### 2.2 CRITICAL — Unauthenticated surfaces that mutate clinical records or hold audio

Unauthenticated routes on this branch (no `authenticateToken`):

| Route | Exposure |
|---|---|
| `POST /api/auth/reset-pin` | Reset any account's PIN. §0.1 |
| `DELETE /api/auth/profiles/:id` | Delete any account with PIN `1234`. |
| `GET /api/auth/profiles` | Full clinician directory (feeds the chain above). |
| `POST /api/webhooks/pms-booking` | Takes `clinicId` from the body, loads that clinic's consultations, and **writes** `proposedTreatments[].status = 'booked'` onto matched records. Any stranger can mutate treatment records and probe for patient-name matches in any clinic. |
| `POST /api/beacon/chair/create` \| `/pair` \| `/status` \| `/command` \| `/telemetry` \| `/upload-chunk` | Whole chair-side phone beacon suite is open. `/command` lets an unauthenticated caller issue commands to a chair session; `/upload-chunk` accepts unbounded base64 audio. |
| `POST /api/billing/webhook` | §2.1 |
| `POST /api/support/tickets`, `POST /api/feedback` | Public spam targets that write into the same store the founder reads. |
| `GET /api/speech/status`, `GET /api/telemetry` | Publishes GCP project id, recognizer path and credentials status. |

### 2.3 HIGH — The new server-side speech gateway has no real auth and no cost control

`src/server/speechStreamServer.ts` (584 lines) is the most valuable new component on this branch — it finally moves capture off the browser-only Web Speech API, which was the single biggest adoption blocker for iPad users. But as shipped:

- **Auth is optional by construction.** `handleConnection` only enforces the token when one is present: `if (this.verifyTokenFn && token)`. No token → `dentistId = 'anonymous_chairside'` and the stream proceeds. Every anonymous stream bills Google Cloud Speech.
- **No metering.** The per-clinic daily note limit does not apply to streaming transcription at all; there is no duration cap, no per-clinic STT quota, and no budget alert. This is the path most likely to produce a five-figure GCP invoice from abuse or a stuck client.
- **Region is global, not Australian.** The default recognizer is `projects/${projectId}/locations/global/recognizers/_`. Any residency promise made to clinics is not true on this path.
- Default `GCP_SERVICE_ACCOUNT_KEY` handed straight from env; `/api/speech/status` publicly reports whether it parsed.
- Recognizer/`boost` config is hardcoded (FDI list, ADA items) inside the server module — fine technically, but it is the clinical-accuracy surface now, so it needs to be versioned and reviewed like a prompt.

### 2.4 HIGH — "MFA" verifies nothing

`POST /api/auth/mfa/verify` accepts a valid session token plus **any** 6-digit code, then issues a full session. There is no TOTP library in the repo (`totp|otplib|speakeasy|authenticator` → no matches) and no stored secret. It is a decorative second factor that will be shown to clinic buyers as a security feature. Either implement it properly or remove it before it appears in a security questionnaire.

### 2.5 HIGH — Founder RBAC is name-based, and founder access is self-serve

```ts
const founderName = (process.env.FOUNDER_NAME || 'Dr. Vikram Darade').toLowerCase();
if (dentist.name.toLowerCase() === founderName || dentist.name.toLowerCase() === 'vik') return true;
```

Executive clearance (company briefings, run-cycle, and the ability to approve other founder requests) is granted by *display name*. Registration blocks duplicate names, but any deploy where the founder record is absent, renamed, or cleaned by the demo script lets the next person to register "Vik" inherit executive access. Founder approval then also gates who can see company briefings — self-referential and not auditable.

### 2.6 HIGH — Login by fuzzy name match is a clinical-safety bug, not just a security one

```ts
(searchKey.length >= 3 && targetClean.includes(searchKey)) ||
(targetClean.length >= 3 && searchKey.includes(targetClean))
```

`login` accepts a partial name (`identifier`), so "Vik" resolves to whichever account matches first, and "Jen" can match "Dr. Sarah Jenkins" *or* "Dr. Jennifer Aby" depending on array order. In a clinical record system this means **a clinician can be authenticated into another clinician's account and chart into the wrong record**. That is the failure mode regulators care about most, and it also destroys the audit trail (attribution is wrong, not missing).

### 2.7 HIGH — In-memory state on a serverless runtime (feature-level breakage)

Every one of these is a `Map`/`setInterval` in module or process scope, on Vercel Functions where instances are ephemeral, horizontally scaled, and frozen between requests:

- **Login lockout** (`loginAttempts`) — resets on cold start, per-instance → no brute-force bound (unchanged from main).
- **Chair beacon sessions** (`chairSessions`, `audioChunks`) — created in instance A, polled in instance B → "Chair session not found", while paired devices hold a token. The feature cannot work reliably as designed. `pinCode` is `Math.random()` 4-digit, and `audioChunks` accumulates base64 audio in RAM with no cap → memory exhaustion and unbounded PHI retention.
- **`initCompanyAutomation()` `setInterval`** (server.ts:4690) — a 60-second interval that dynamically imports `./scripts/company/grokbot.js` at 08:00 Melbourne time. On serverless it never fires reliably; if it ever ran on multiple instances it would fire once per instance (duplicate briefings, duplicate external API spend).
- **Telemetry counters** — per instance, so `/api/telemetry` reports meaningless numbers.

### 2.8 MEDIUM — The autonomous "company engine" is wired into the product and into CI

The branch adds `scripts/company/grokbot.ts` (442 lines), `reports/company/**` (four dated folders, ~50 files, an eight-department briefing per day committed to the repo), `/api/company/*` routes, a `FounderExecutiveDashboard.tsx`, and `.github/workflows/daily-autonomous-cycle.yml`, which runs `npm run grokbot` daily and then:

```bash
git config --global user.name "Grokbot Autonomous Orchestrator"
git add reports/company/*.md
git commit -m "chore(company): daily autonomous briefing for $(date +'%Y-%m-%d') [skip ci]"
git push origin HEAD:${{ github.ref_name }}
```

Three problems: (1) `contents: write` + auto-push means unreviewed commits land on the target branch daily; (2) the commit message contains `[skip ci]`, so the quality gate does not run on them; (3) the reports are committed next to patient data in a **public** repo, and whatever key the script uses for its LLM calls sits in Actions secrets. As an engineering artifact this is impressive; as a business artifact it is the opposite of what a solo founder needs from 71 commits — a simulated company instead of a secured one. My recommendation is to keep it as a local script (or move it to a private `ops` repo) and take it out of the server process, the deploy path and the product UI.

### 2.9 MEDIUM — Performance and resource gotchas introduced by the "make any PIN work" rewrite

`verifyPinHash` now, per call, tries: plaintext compare → 2 salt encodings → **8 PBKDF2-SHA512 iteration counts** (up to 310,000) → 4 PBKDF2-SHA256 combos → 2 HMACs → 4 salted SHA/MD5 → 2 unsalted digests. Multiplied by `verifyPinComprehensive`'s ~10 candidate salts. On an unauthenticated endpoint, that is a CPU-amplification DoS vector, a slow login for legitimate users, and it will make E2E suites flaky. Login should do one PBKDF2 verification against the stored salt, with a documented one-time rehash migration for legacy accounts.

### 2.10 MEDIUM — Audit log and JSON store are committed and written on a read-only filesystem

`data/audit.json` grew by 3,009 lines in this branch and is committed. On Vercel the filesystem is read-only outside `/tmp`, so JSON-mode writes either throw (caught and logged as "read-only filesystem detected") or silently diverge from what is in the repo. Meanwhile the audit log is the evidence base for an access-governance conversation with a clinic. It belongs in Postgres with an insert-only policy and a retention rule — not in a file that is `git add`-ed.

---

## 3. What this branch genuinely gets right (keep it)

- **Server-side streaming speech recognition** (`@google-cloud/speech`, Chirp 2, dental phrase-boost lexicon, FDI/surface/ADA entity tokenizer). This is the correct strategic bet: it fixes device coverage and lets you control accuracy instead of depending on a browser API. It deserves to be finished (auth, metering, region, quotas) rather than shipped as a side path.
- **A chairside workflow model that matches real dentistry**: day-sheet roster (`DayScheduleQueue`), operatory command center, per-appointment consent state, pre-op brief, "5pm speed review" strip. Per-item `consentObtained` + `consentCapturedAt` is a real improvement over the main branch's non-persisted consent checkbox.
- **A test and eval surface that grew with the product**: `daySchedule.test.ts` (1,113 lines), `pipeline.test.ts`, `companyEngine.test.ts`, `beaconSuite.test.ts`, `dualStreamTranscription.test.ts`, Playwright E2E with fake-microphone flags, and an **eval harness with a golden dataset and grader** (`npm run eval`) that CI runs as a "clinical safety gate". The golden-dataset gate is the single best idea in this branch.
- **Billing/packaging scaffolding**: subscriptions table, tier model, checkout/portal flows, `adaFees.ts`, treatment pipeline with `proposedTreatments` and an ROI endpoint, clinic export (`/api/clinic/export`), referral "gift chair" codes, support tickets and feedback capture. The product-side instincts are sound; the implementations need hardening.
- **`/api/audit/verify`** — the intent ("can I prove this log was not tampered with?") is exactly the right question to be asking.

---

## 4. Gotchas checklist (practical, in the order they will bite)

1. `stripe` and `ws` are imported but **not declared in `dependencies`** — `npm ci` on a clean host leaves both missing; `esbuild --external:ws` means the built server needs it at runtime. Expect "Cannot find package" on the first real deploy of billing and speech.
2. `vercel.json` → `includeFiles: "data/**"` ships PHI inside every deployment artifact, including previews.
3. `setInterval` schedulers and in-memory session maps will not work on Vercel Functions; they work in `tsx server.ts` locally, which is why they look fine until deploy.
4. `[skip ci]` + `contents: write` in the daily workflow bypasses the quality gate on bot commits.
5. E2E can point at production and logs in with PIN 1234 as a real clinician; "Populate with Sample Day" writes into the same store. Cap it to localhost by default and require an explicit opt-in flag for remote targets.
6. Unauthenticated speech WebSocket accepts a missing token → anonymous paid transcription.
7. `/api/speech/status` and `/api/telemetry` publicly disclose infrastructure configuration.
8. `POST /api/webhooks/pms-booking` trusts `clinicId` from the body and writes to records it finds by name matching.
9. Login fuzzy matching can authenticate the wrong clinician; the audit trail records the wrong author.
10. `Math.random()` for chair PINs; 12-hour chair tokens returned in a QR URL and in the API response.
11. `reset-pin` echoes the new PIN in the response and logs it.
12. Migration risk: with a universal PIN and a name-based founder check, the "break-glass" story is currently indistinguishable from the attack, so you cannot tell a legitimate recovery from an intrusion in your own audit log.

---

## 5. Recommendations to run this as an independent business

### Track A — Quarantine (do before touching another feature)

| # | Action | Done when |
|---|---|---|
| A1 | Repo private; purge `data/` from tracking and history; rotate every credential in the repo, including `SESSION_SECRET` (hardcoded fallback makes tokens forgeable) | `git log --all -- data/` is empty; new secrets only in Vercel env; all sessions invalidated |
| A2 | Remove the master PIN and `/api/auth/reset-pin`; require re-auth for credential change | PIN `1234` fails for every account; a reset requires a verified channel and is audited |
| A3 | Decide a break-glass model *before* removing the master PIN: owner-approved, time-boxed, audited, single-use token stored in a vault — never a fixed PIN | Recovery of a locked-out clinician is possible without a universal credential, and appears in the audit log as a distinct event |
| A4 | Authenticate or disable every unauthenticated mutating route (`pms-booking`, beacon suite, tickets/feedback, profiles list, speech WS) | An unauthenticated request cannot read or mutate clinical data, and cannot consume paid STT |
| A5 | Stripe: signature verification (`constructEvent` + `STRIPE_WEBHOOK_SECRET`), event-id idempotency, real period dates, no mock provisioning when `NODE_ENV=production`, add `stripe` to dependencies | A hand-crafted webhook POST cannot activate a tier; a real test-mode checkout can; replaying an event changes nothing |
| A6 | Move lockout, chair sessions, usage and telemetry out of process memory into Postgres, or retire those features | Two serverless instances behave identically; lockout survives a cold start |
| A7 | A cron (Vercel Cron or external) that drains the note-job queue, protected by a shared secret | A queued note completes with no browser open; stuck `processing` jobs are requeued |
| A8 | Postgres-path test coverage + fail-closed production config | CI runs the suite against a real Postgres; a production boot without `DATABASE_URL` exits with a clear error |

### Track B — Become operable as a one-person business

| # | Action | Why it is business-critical |
|---|---|---|
| B1 | Legal pack: privacy policy + T&C served and linked from the landing page and sign-up; a DPA/dentist agreement; a data-flow map and subprocessor list **with regions** (Google Speech global vs Vertex AU); a retention schedule | Clinics cannot sign without a DPA. This is the first document a practice manager asks for. |
| B2 | Incident response runbook + breach notification template (OAIC NDB path), and a decision on cyber/professional-indemnity cover | A solo founder is the entire incident response team; writing the template *during* an incident is how companies lose their licence to operate |
| B3 | Cost controls: per-clinic STT minutes, per-note cost tracking, hard daily/monthly caps, billing alerts at 50/80/100% | A public WS endpoint plus unmetered streaming is an open-ended liability against a personal card |
| B4 | Support operations: a real ticketing front-end over the existing tickets table, plus an operator view (clinic → members, usage, failed jobs, audit) | This already exists as API surface; exposing it is a day of work and removes your biggest support bottleneck |
| B5 | Pricing decision tied to unit economics: cost per note and per STT minute at your real Gemini/Cloud Speech prices, target gross margin, and what the free tier is for | The 40-note/day default is currently an env var, not a product decision |
| B6 | Error tracking + uptime alerting on a health endpoint; alert routing to a phone | "Supported by a solo founder" means you must know before the clinic does |
| B7 | Access governance in the product: audit reads as well as writes; a clinic-visible access log; immutable note versions | Owners ask "who saw this patient's record?" — you have no answer today |
| B8 | Cut the scope you are not supporting: phone beacon (until authenticated and durable), company-engine/briefing surface, `src/archive/**` prototypes, duplicate demo docs | Every half-finished surface is a support ticket and a security hole; your constraint is attention, not features |

### Track C — Only after A and B: growth

Treatment pipeline + ROI reporting (already built), referral chair-gift (built, needs abuse controls), PMS integrations, multi-clinic scale. The sequencing matters: growth features multiply the blast radius of an authentication hole, and no amount of referral loop fixes a clinic discovering its patient data was public.

---

## 6. If I had two weeks on this branch

**Days 1–2:** A1 + A2 + A3 (repo private, purge history, rotate secrets, remove master PIN and reset endpoint, define break-glass). Nothing else matters until this is done.
**Days 3–4:** A4 — triage all unauthenticated routes; fix the speech WS token check; add per-clinic STT caps.
**Day 5:** A5 Stripe signatures + idempotency + `stripe` dependency; make mock mode impossible in production.
**Days 6–7:** A6/A7 — move lockout and queue state to Postgres, add the cron, verify a note completes with the browser closed.
**Days 8–9:** A8 — Postgres CI coverage, fail-closed boot, health endpoint, error tracking + alerting.
**Day 10:** B1/B2 — privacy policy, T&C, DPA, data-flow map, retention schedule, incident runbook.
**Days 11–12:** B3/B4 — cost caps and the operator support view.
**Days 13–14:** B8 — delete/archve the unsupported surfaces; then point one real friendly clinic at it with a signed agreement and watch what actually breaks.

---

## 7. The insight worth keeping

The main branch's problem was depth without custody: good resilience engineering on top of a prototype's identity model. This branch's problem is breadth without custody: 48,000 new lines of genuine product surface — chairside workflow, streaming speech, billing, reporting, an eval harness — built on an authentication model that got *weaker*, with patient data in a public repo.

For a solo founder the binding constraint is not features or even engineering skill; it is **the trust a dental practice extends to you about its patients' records**. Everything in §5 Track A is really one requirement: *you can prove who accessed which record, and you can prevent everyone else.* Ship that, and the impressive parts of this branch become sellable. Ship the branch as it stands, and the first clinic that asks "where does our patient data live?" ends the business.
