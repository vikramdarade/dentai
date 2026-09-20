# Antigravity remediation prompt — DentAI

**How to use:** paste §0–§9 into Antigravity as-is, before any other instruction. Everything in it
was verified against `origin/main` and carries a `file:line`. Section 10 is context for prioritisation
(what actually makes this business grow), not work to do in the same pass.

---

## §0. Prime directive — no hallucination

You are fixing a **clinical records product that takes money from dental practices**. A wrong claim
costs a practice; a wrong fix costs a customer. Obey these rules absolutely:

1. **Sync first.** The local working tree is behind the remote default branch. Before touching
   anything: `git fetch origin --prune && git checkout main && git pull --ff-only`. Every line number
   below was verified on `origin/main` @ `3b429f2`. If a cited line does not match, **stop and report
   the mismatch** — do not guess.
2. **Evidence per claim.** Every finding you act on must be reproduced: show the file, the line, and
   the command or test that demonstrates the behaviour. "It looks like" is not a finding.
3. **Reproduce before you fix, and prove after.** For every defect: write a test that **fails on
   current `main`**, make it pass, then run the full suite. Paste the actual command output. If you
   cannot produce a failing test, say so and downgrade the item to "unverified".
4. **Never fabricate a result.** Do not write "all tests pass" unless you ran them and pasted the
   summary line. Do not invent API endpoints, Stripe fields, environment variables, or library
   methods. If you need an API you have not verified, say so and check the docs.
5. **Do not invent product or accuracy numbers.** No metric, benchmark, ROI figure, or accuracy
   percentage may be added to any user-facing surface without a measured source you can name and
   date. If a surface needs a number you do not have, remove the number.
6. **Do not silently change scope.** If you discover something outside this list, add it to an
   "additional findings" section with evidence; do not fix it in this pass.
7. **Ask before destructive or irreversible actions.** No production Stripe charges, no deletion of
   clinical data, no live-mode keys.

**Stack (verify, don't assume):** Bun; Express + Node ≥ 22 server (`server.ts` is 4,846 lines and is
both the HTTP API and the note-job worker); React 19 + Vite client; PostgreSQL via
`@neondatabase/serverless`; Gemini for generation/transcription; Vitest; Vercel with `vercel.json`.

**Verification commands (use these, paste their output):**
`bun run lint` · `bun run test` · `bun run eval:notes` · `bun run test:postgres` (needs a database) ·
`bun run db:migrate` · `bun run build`

**Definition of done for every task:** failing test first (where a defect exists) → minimal fix →
that test passes → full suite passes → `bun run lint` clean → one-commit-sized diff → a written note
of what could still be wrong.

---

## §1. P0 — a paying customer does not receive the paid plan

**Verified:** checkout writes snake_case metadata and the webhook reads camelCase, so a completed
payment is ignored.

- Written: `src/server/billing.ts:532-534` → `metadata[clinic_id]`, `metadata[dentist_id]`,
  `metadata[plan]` (plus `client_reference_id` = clinic id at `:531`).
- Read: `src/server/billing.ts:293` → `object.metadata?.clinicId` (camelCase) → empty → the handler
  logs *"Stripe checkout completed without a clinicId in metadata; ignoring."* and returns **before
  writing any subscription**.
- `git grep -n "subscription_data" src/server/billing.ts` → **no matches**, so Subscription lifecycle
  events inherit no clinic metadata.
- The `byStripeCustomerId` fallback at `:313+` needs a `stripe_customer_id` row that only the write
  above would have created — so a first-time customer cannot be recovered by it either.
- Fallback plan is `'solo'` (free): `planFromMetadata(object, 'solo')` at `:302`, `:307`.
- The customer is redirected to `success_url` = `/#/billing?status=success…` (`:529`), so the UI tells
  them payment succeeded while entitlements never change.

**Tasks**

1.1 Write a failing regression test first: a signed `checkout.session.completed` event carrying
exactly the metadata the checkout creates must result in a subscription row
(`plan='practice'`, `status='active'`, `seats=6`, `stripeCustomerId`, `stripeSubscriptionId`) and
entitlements flipping to Practice. Confirm it fails on current `main`, then fix.

1.2 Use **one key convention** on both sides. Prefer `clinic_id`/`plan` everywhere, read snake_case,
and keep `client_reference_id` as the durable fallback when metadata is missing.

1.3 Set `subscription_data[metadata][clinic_id]` and `subscription_data[metadata][plan]` at checkout
so `customer.subscription.created/updated/deleted` can resolve the clinic directly. Verify
`current_period_end` is persisted, because `resolveEntitlements` depends on it
(`src/lib/plans.ts`, `EntitlementInput.currentPeriodEnd`).

1.4 Remove the free-plan fallback for a **paid** checkout path. If `plan` is genuinely unresolvable,
fail loudly (log at error level, keep the event for replay) rather than granting `solo`.

1.5 Add idempotency coverage: the same event id delivered twice must not double-write.

1.6 **Then** run one end-to-end test-mode checkout (Stripe test keys, Stripe CLI or a captured real
event) and paste: the event type, the subscription row written, and the entitlements response. If you
cannot run it, say so explicitly — do not claim fulfilment works.

**Acceptance:** the log no longer says "ignoring"; entitlement flips to Practice/6 seats automatically;
the regression test exists and fails without the fix.

---

## §2. P0 — the displayed price, the charged price and the invoice disagree

**Verified:**

- UI claims GST-inclusive pricing: `src/components/BillingModal.tsx:279` renders
  `'ex GST ($163.90 inc GST)'`; `:220` renders `'Australian GST Compliant'`.
- Checkout charges **A$149.00** with no tax handling: `src/server/billing.ts:526`
  `unit_amount = '14900'`; `git grep` for `automatic_tax`, `invoice_creation`, `tax_behavior` in
  `billing.ts` → **no matches**.
- `receiptEmail()` (`src/server/email.ts:225`) accepts an `abn` (defaulting to `DENTAI_ABN`) but
  `git grep -n "receiptEmail(" src server.ts` → **definition only, never called**. Its body shows a
  total with no GST line and the header reads "PAYMENT RECEIPT", not "TAX INVOICE".
- `src/lib/plans.ts:35` documents `monthlyAudExGst` as *excluding* GST — so the customer-facing
  $149 is ex-GST while the screen implies inclusive.

**Tasks**

2.1 Decide and document one of: (a) charge GST-inclusive $163.90 with Stripe Tax
(`tax_behavior: 'inclusive'`), or (b) charge $149 ex-GST and show the GST line at checkout. Make the
displayed price equal the charged price in all states.

2.2 Move from inline `price_data` to **Stripe Price objects** so prices have history and promo codes
are possible; enable Stripe Tax for AU.

2.3 Send a compliant **tax invoice / receipt** from the webhook on `invoice.paid`: supplier identity
including ABN, the GST amount, the total, and the words "Tax invoice" (or a receipt that still shows
GST). Fix the em-dash/entity corruption in the current header string if present.

2.4 Make `DENTAI_ABN` a **required** variable in production (`src/server/configCheck.ts`), so a
deployment without an ABN cannot silently bill customers.

**Acceptance:** a test asserts the invoice body contains the ABN, a GST amount and a total; the
displayed price equals the Stripe amount; `receiptEmail` has a caller.

---

## §3. P1 — the allowance on the card is not the allowance that is enforced

**Verified:** free tiers advertise 15 AI notes/day and cap 60,000 tokens/day
(`src/lib/plans.ts:41-66`); Practice advertises 200 notes/day and caps 750,000 (`:69-80`). Because
recorded audio is transcribed server-side before note generation, a 15-minute appointment is on the
order of 28–30k tokens, so the token cap binds after roughly **two long appointments** on the free
tier. Treat that figure as an estimate to confirm against `usage_events`, not as a fact.

**Tasks**

3.1 Query real `usage_events` (kind, tokens, day) and compute the **observed** tokens per consult by
appointment length. Use that to set the token caps so the note count on the card is the note count
that is granted.

3.2 Meter transcription **before** the spend, not after. Currently
`src/server/transcriptionRoutes.ts:304` records usage after the model call and there is no
`resolveDailyLimits` pre-check in that file, so a clinic at its cap still spends (and then is refused
the note). Add the pre-flight check and a test proving no model call is made when the cap is reached.

3.3 Do not let a usage-write failure silently under-count spend; record the outcome and surface it.

**Acceptance:** a test proves a capped clinic is refused *before* transcription is attempted; caps
are consistent with the published note counts; the quota message tells the clinician exactly what
happened and what still works (offline draft).

---

## §4. P1 — you cannot see whether the product works, so you cannot grow it

**Verified:** the legacy `/api/telemetry` is retired with a 401 by design
(`src/server/opsRoutes.ts:13-16`); the only replacement is queue depth at
`/api/ops/telemetry` (`:131`). There is no record of signups → first note → first note **saved** →
return on day two → invited a colleague → upgraded. `usage_events` and the hash-chained `audit_logs`
already exist and contain what is needed.

**Tasks**

4.1 One operator-only endpoint deriving the funnel from existing tables. **No new vendor, no patient
data, no PHI in the response.** Add it to the sub-processor/legal docs only if you introduce a vendor
(you should not).

4.2 Compute and display two clinical-quality metrics: **edit rate per generated note** (how much the
dentist changed before saving) and **live-fallback share** (notes built from browser speech instead
of diarized recorded audio — the honest accuracy signal, see `transcriptProvenance`).

4.3 A minimal ops view so plan activation, recovery tokens and retention do not require a terminal.

**Acceptance:** the endpoint returns the funnel from real data; a test asserts it exposes no patient
identifiers and requires ops auth.

---

## §5. P1 — remove invented claims from the customer-facing product

**Verified, `src/components/Landing.tsx`:** `$34,800` (`:421`), `$18,400` (`:425`), `123.5x` (`:430`,
now labelled "Modeled on $149/mo plan" although no model exists), `52.8%` (`:435`), "100x+ practice
ROI" (`:205`), "40x–100x+" (`:544`). All are hardcoded constants. `/api/pipeline/roi` computes real
per-clinic figures, so these will contradict the customer's own dashboard.

The word "Verified" was already removed from the panel labels — keep it that way.

**Tasks**

5.1 Delete the four constants, or replace the panel with an explicitly labelled illustrative example
(dated, with its basis stated) — and drive any real figure from the API.

5.2 Remove or substantiate "100x+ practice ROI" and "40x–100x+". For a clinical audience, an
unsubstantiated performance claim is a regulatory exposure (AHPRA advertising rules, ACCC) and a
credibility risk with the one audience that knows their own numbers.

5.3 Replace the ROI panel with the proof this product can actually produce: one real consultation,
the generated note, and what the dentist changed before signing.

5.4 Add a CI guard (a simple checked pattern or lint) that fails when a bare currency/percentage/ROI
constant is added to `Landing.tsx`, so this cannot come back.

**Acceptance:** no unsubstantiated number remains on any customer-facing surface; the guard fails if
one is reintroduced.

---

## §6. P1 — resilience, safety net and compliance defaults

**Verified:** queue drain is once daily (`vercel.json` → `0 2 * * *`); the clinical eval in CI is
offline only (`--offline --min-score 0.9`, `.github/workflows/ci.yml:131`) so it cannot catch a model
or prompt regression; these variables are merely `recommended` in `src/server/configCheck.ts`:
`GCP_PROJECT_ID`, `ERROR_WEBHOOK_URL`, `DENTAI_DISABLE_PROFILE_DIRECTORY`, `DENTAI_REQUIRE_CONSENT`,
`DENTAI_DAILY_NOTE_LIMIT`, `DENTAI_DAILY_TOKEN_LIMIT`; the retention sweep is dry-run unless
`DENTAI_RETENTION_ENABLED=true`.

**Tasks**

6.1 Make the queue drain run at least hourly (and document why the platform limit forces the
schedule you choose).

6.2 Add a **scheduled live** eval — the `--live` path in `scripts/eval-notes.ts` already exists and is
unused — and record the score over time so a regression is visible. Add more fixtures; three cannot
support an accuracy claim.

6.3 Add production **defaults that match the published privacy notice**: Australian region
(`GCP_PROJECT_ID` + `australia-southeast1`), consent required, retention enabled after a reviewed dry
run, staff directory hidden. Defaults that contradict the notice are a governance failure even when
the code exists.

6.4 Write a **notifiable data breach runbook** with a rehearsal (who assesses, within what period, who
notifies, what evidence is preserved).

6.5 Error tracking and a security pack (threat model summary + penetration test report) suitable for a
practice's security questionnaire.

---

## §7. P2 — growth mechanics that need code

7.1 **Per-chair pricing above 6 seats.** Practice is a flat A$149/month for 6 seats; a 12-chair
practice pays the same as a 2-chair practice and hits `SEAT_LIMIT_REACHED` (`server.ts:2753,2781`).
Add a paid seat add-on rather than a queue of manual exceptions.

7.2 **One real PMS write-back.** Outbound is currently copy/print. Pick one vendor and write the
completed note back into the patient record; verify the vendor's current API terms before committing.

7.3 **Recall → measured revenue.** `src/lib/recallEngine.ts` already derives due dates, urgency and
outreach copy. Surface "due this week" per clinic and connect an outbound reminder channel (verify the
provider and add it to the sub-processor list before sending anything).

7.4 **First-run self-test:** record 30 seconds, play it back, show the transcript. This removes a large
share of first-week support load.

7.5 **Either implement the 14-day trial or delete the claim.** `src/lib/plans.ts:51` advertises
"14-day evaluation, one clinician" and there is no trial clock anywhere in the codebase (grep for
`trialEndsAt|trialStartedAt|trialPeriodDays` → nothing). Trial and Solo have identical limits, so the
only difference is the wording.

7.6 Restrict self-serve signup during the pilot (`DENTAI_ALLOW_SELF_SIGNUP=false`) or require an
invite code: every new account is its own metering scope with its own free allowance on the shared
model key (`src/server/signupGuard.ts`).

---

## §8. Do not do in this pass

- Do not add an analytics, SMS or error-tracking vendor without adding it to the sub-processor
  register and the practice DPA first.
- Do not add AI features, change the note-generation prompt, or alter the model id
  (`src/lib/noteModelConfig.ts`) — accuracy is capture-limited, and those changes invalidate the eval
  baseline.
- Do not refactor `server.ts` wholesale; extract only what you touch.
- Do not weaken the fail-closed behaviours (metering, Stripe webhook signature, consent gate).
- Do not touch the retention sweep's delete path beyond making it configurable.

---

## §9. Reporting format (required)

Return a table plus a short narrative:

| # | Finding | Evidence (file:line) | Test that proves the fix | Status |
|---|---|---|---|---|

Then, separately and explicitly:

- **Unverified:** anything you could not reproduce, with the reason.
- **Additional findings:** discovered but not fixed, with evidence.
- **Migrations/data changes:** what ran, and how to reverse it.
- **What could still be wrong:** the honest residual risk after your change.

A task is only "done" when the test exists, passes, and the full suite and typecheck pass on `main`.

---

## §10. Context — what actually makes this thrive (prioritisation only)

This section is background so you sequence work correctly. It is not a task list, and nothing in it
may be turned into a marketing claim.

**The uncomfortable truth:** note generation is becoming a commodity, and a note is a **cost** the
dentist bears (compliance paperwork). Practices do not renew software because it saves them typing;
they renew because it either (a) recovers revenue they can see in their own books, or (b) removes a
compliance risk they are personally liable for. Every dollar of durable growth in this product comes
from one of those two, which means:

1. **Billing that works is the precondition for everything else.** A product that charges a practice
   and grants free entitlements is not a business yet; fix §1 before any growth work.
2. **The recall worklist is the revenue story** (§7.3): it turns the note from paperwork into
   recovered production, and it is the only ROI claim that can be made honestly — from the practice's
   own data.
3. **The compliance record is the moat** (audit chain, append-only revisions, consent, provenance,
   executing retention). It is genuinely hard to copy and it is what makes a practice choose this
   over a cheaper scribe. Protect those properties; do not trade them for features.
4. **Free Solo is the distribution engine — but only if it does not break on appointment two.**
   §3 is therefore a retention fix, not a cost fix: a free clinician who is cut off mid-morning
   becomes a detractor in a small, tight professional community.
5. **Revenue must scale with the practice, not with the logo** (§7.1), because the Australian market
   is small relative to a venture outcome at A$149/month per clinic. Plan the compliance layer to be
   parameterised per jurisdiction early if multi-country expansion is the strategy.
6. **Trust is the tail risk.** In clinical software one breach story ends the company — which is why
   §6's defaults, runbook and security pack are growth work, not hygiene.
7. **The two numbers to run the business on** (§4.2): **edit rate per generated note** (is the output
   actually usable?) and **live-fallback share** (is capture good enough?). Everything else — signups,
   notes generated — is vanity until those two are measured. Any accuracy statement made to a
   practice or an investor must be traceable to them.
