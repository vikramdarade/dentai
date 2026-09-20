# Review — `fix/billing-gst-governance-hardening`

**Commit reviewed:** `496d459` — *"fix(billing): resolve subscription activation, GST compliance, transcription pre-flight metering, and ops telemetry"*
**Base:** `origin/main` @ `3b429f2` (branch is **0 behind / 1 ahead**)
**Date:** 2026-09-20

## 0. Status of the "PR"

**There is no pull request.** `gh pr list --state all` returns nothing for head `fix/billing-gst-governance-hardening`
(grep for `billing|gst|governance` across all PR states → no match). The branch is pushed but has no PR open.
This review is of the branch contents. Note also that `remote.origin.fetch` in this workspace is scoped to `main`
only, so `git fetch` alone does not bring this branch down — it needs an explicit refspec.

## 1. What I actually ran (not read)

| Check | Command | Result |
|---|---|---|
| Typecheck | `bun tsc -b --noEmit` | exit 0, no diagnostics |
| Full suite (branch) | `bun run test` | **362 passed / 22 skipped** (26 files; main is 354) |
| Regression proof | new tests run against **main's source** | **8 tests fail** — see §3 |

The regression proof matters most: I detached to `origin/main`, pulled in only the branch's `tests/`, and ran them.
They fail. So this branch contains **real regression tests**, not tests written to match the implementation.

Failures on main (verbatim):

```
FAIL tests/billingSuite.test.ts > fulfils checkout.session.completed ... flips entitlements to Practice (6 seats)
AssertionError: expected undefined to be 'clinic-north-sydney-1'
FAIL tests/billingSuite.test.ts > refuses to default to free solo plan when plan is missing or invalid ...
FAIL tests/billingSuite.test.ts > generates an Australian GST-compliant tax invoice email on invoice.paid
FAIL tests/billingSuite.test.ts > handles signed HTTP POST /api/billing/webhook and flips clinic entitlements
FAIL tests/productionHardening.test.ts > prevents reintroduction of invented marketing metrics ...
FAIL tests/transcription.test.ts > refuses transcription and avoids calling AI model when clinic is at quota limit
FAIL tests/billingSuite.test.ts > defines Solo as Free Forever ... expected 60000 to be 150000
FAIL tests/billingSuite.test.ts > defines Practice Tier ... expected 750000 to be 2000000
```

## 2. Verdict

**This is the most valuable commit in the repo's history so far.** It closes the payment-fulfilment defect that
made revenue impossible, it deletes the four invented marketing constants, and unlike every previous change in this
thread it ships tests that demonstrably fail on `main`.

It is **not mergeable as-is.** Four things block it:

1. The **ops console cannot be opened** — the telemetry exists but no human can see it (§4.1).
2. The **tax invoice states GST computed as `amount ÷ 11`**, not the tax Stripe charged, and discards the customer
   ABN that checkout explicitly collects (§4.2).
3. The transcription quota gate **denies capture at roughly half the advertised volume and names the wrong cause**,
   and it fails **open** where the existing gate fails **closed** (§4.3).
4. Making `plan` **mandatory** in subscription metadata means any subscription without it now **throws on every
   `customer.subscription.updated`**, returns 500, and is retried by Stripe forever — so status transitions
   (dunning, mid-term cancellation, `cancel_at_period_end`) are silently never recorded (§4.4).

## 3. What is genuinely fixed (verified)

| Defect (from the earlier review) | Evidence it is fixed |
|---|---|
| **A paid checkout granted the free plan.** Write was `metadata[clinic_id]`, read was `metadata?.clinicId` → always empty → returned before writing any subscription. | `clinicIdFromObject()` now reads `clinic_id` **or** `clinicId` **or** `client_reference_id` (billing.ts ~248–262). Flipping the entitlement end-to-end is now covered by a signed-webhook test that fails on main. |
| **Silent free fallback.** `planFromMetadata(object, 'solo')` defaulted a paid checkout to free. | `planFromMetadata` returns `null` when unresolvable; the checkout case throws instead of defaulting (billing.ts ~315–347). |
| **Subscription lifecycle events could not resolve the clinic.** No `subscription_data` metadata existed on main (verified by grep). | `subscription_data[metadata][clinic_id|dentist_id|plan]` is now sent at checkout (billing.ts ~599–632). |
| **`receiptEmail()` existed but was never called.** | Wired through `deps.sendReceiptEmail` → `invoice.paid` (billing.ts:409–430) → `emailer.send` (server.ts:943). |
| **Fabricated ABN on a "TAX INVOICE".** | The hardcoded `'83 671 294 102'` is gone; the ABN now comes from `DENTAI_ABN` (email.ts:235) and the header omits it when unset. `DENTAI_ABN` is registered as a required config item (configCheck.ts:71–75). |
| **Four invented landing constants.** `$34,800`, `$18,400`, `123.5x`, `52.8%`. | Deleted, replaced with qualitative workflow claims (Landing.tsx ~406–445). A CI-able guard test bans their return. |
| **False "14-day" trial claim** (there was never a trial clock). | Removed from `PLANS.trial.features` and from the landing CTA ("Start Free Evaluation"). |
| **PMS write-back overclaim** ("verifies confirmed bookings directly in your PMS appointment book"). | Retracted to "tracks confirmed bookings directly in your clinical appointment workflow". |
| **Transcription metered only after spend, so the cap could not cap the most expensive call.** | Pre-flight check added before the model call (transcriptionRoutes.ts ~271–308); the new test asserts `getClient` is never called. |
| **Drain ran once daily.** | Cron moved to hourly (vercel.json:20) — but see §5.6. |

Raising the token ceilings (trial/solo 60k → 150k, practice 750k → 2M) narrows the ceiling-versus-promise gap.
It does not close it. Using the repo's own stated assumption — *"Gemini bills audio input at roughly 32 tokens per
second"* (src/lib/transcription.ts:82) — a 15-minute appointment is ≈28,800 input tokens:

* **Free/Solo: 150,000 ÷ 28,800 ≈ 5 long appointments, advertised as 15 notes/day.**
* **Practice: 2,000,000 ÷ 28,800 ≈ 69, advertised as 200 notes/day.**

## 4. Blocking findings

### 4.1 🔴 The operator console cannot be opened by a human — and would leak the secret if it could

The new `/api/ops/console` (opsActions.ts:124) is a full console UI: adoption funnel, quality signals, plan
activation, recovery tokens, retention sweep. It is registered behind `deps.requireOps`, which is
`createOpsGuard` (server.ts:578 → 980). That guard reads the secret from **headers only**:

```ts
// src/server/opsRoutes.ts:54-61
export function readOpsSecret(headers: Record<string, any>): string {
  return (headers['x-dentai-ops-secret'] as string | undefined) ||
         (headers['x-cron-secret'] as string | undefined) ||
         ((headers['authorization'] as string | undefined) || '').replace(/^Bearer\s+/i, '') || '';
}
```

The console's own JavaScript expects a **query parameter** and appends it to every call:

```js
const secret = new URLSearchParams(window.location.search).get('secret') || '';
fetch('/api/ops/funnel' + (secret ? '?secret=' + encodeURIComponent(secret) : ''), ...)
```

`grep -rn "query.secret"` across the repo → **no matches**. So:

* A browser navigation to `/api/ops/console?secret=…` carries no custom header → **401**. The page is unreachable.
* The API calls it makes would also 401, because the header it sets is built from a query string the guard
  never received.

Two consequences. First, the funnel and quality telemetry — the whole point of "run the business on edit rate and
live-fallback share" — is invisible, so the PR delivers the data and no way to look at it. Second, if the guard
were ever relaxed to accept the query parameter, the ops secret would land in browser history, Vercel access logs
and `Referer` headers. The console is simultaneously broken and (would-be) insecure.

**Why the tests missed it:** the new ops test does not use the real guard. It hand-rolls a stub
(`tests/operations.test.ts:489–497`) that re-implements the check as `req.headers['x-dentai-ops-secret']`, so it
validates a fake while the real guard is never exercised.

**Fix:** serve the console to an authenticated clinic owner (the app already has sessions and `RequireAuth`), or
issue a short-lived signed cookie from an ops endpoint. Delete the `?secret=` handling entirely.

### 4.2 🔴 The "GST compliant" tax invoice reports tax the code guessed, and drops the ABN Stripe collected

```ts
// src/server/email.ts (receiptEmail)
const gst = params.gstAud !== undefined ? params.gstAud : +(params.amountAud / 11).toFixed(2);
const subtotal = +(params.amountAud - gst).toFixed(2);
```

The invoice's GST line is `total ÷ 11` — an assumption that every invoice is 10% GST-inclusive. It is not read
from Stripe. Three separate problems:

1. **`gstAud` is never supplied.** The parameter exists for exactly this purpose, and `server.ts:943` never passes
   it. So the derived value is always used, even though the checkout enables `automatic_tax[enabled]=true` and
   Stripe therefore *knows* the real tax (`total_tax`). If Stripe Tax computes $0 — not GST-registered, or the
   customer is not in Australia — the invoice still asserts **A$14.90 GST collected**. That is a false tax invoice.
2. **The customer ABN is collected and thrown away.** Checkout now sends `tax_id_collection[enabled]=true`, so
   Stripe collects the practice's ABN. `receiptEmail` supports `customerAbn` and the new test passes it — but
   `sendReceiptEmail` never populates it, so the field is always absent on a document labelled TAX INVOICE.
3. **A hardcoded amount is a fallback.**

   ```ts
   // src/server/billing.ts:409-412 (invoice.paid)
   const amountPaidCents = Number(object.amount_paid ?? object.total ?? 16390);
   ```

   An invoice object with neither field yields a receipt for **A$163.90 that nobody paid**.

**Fix:** pass Stripe's `total_tax` and `amount_paid` through, pass `customer_tax_ids`, and **fail closed** — do not
send a document labelled TAX INVOICE when the tax figures are not known. Delete `?? 16390`.

### 4.3 🔴 The transcription quota gate denies the accuracy path at half the advertised volume, and fails open

The new pre-flight (transcriptionRoutes.ts ~271–308) reads the counter the *note* gate uses:

```ts
const usedNotes = await deps.getUsageCountToday(scopeId);
if (usedNotes >= limits.notes) { /* 429 QUOTA_DAILY */ }
```

But that counter is a raw event count, not a note count, in **both** stores:

```ts
// server.ts:1107-1112 (JSON store)
return data.events.filter((e) => e.scopeId === scopeId && e.day === day).length;
// src/lib/db.ts:652-658 (Postgres)
SELECT COUNT(*)::int FROM usage_events WHERE scope_id = … AND day = …
```

Events recorded include `ai_note` (server.ts:1394), `ai_note_sync` (server.ts:372) and `ai_transcription`
(transcriptionRoutes.ts:338). A normal appointment **transcribes and generates** — two events. So on a
Free/Solo clinic (15) the dentist reaches the cap after roughly **7–8 appointments**, and the refusal reads:

> "This clinic has reached its daily allowance of 15 AI notes. Audio transcription is paused…"

…when as few as 7 notes may exist. This inversion — the counter that is supposed to bound *cost* instead denying
the *accuracy* path, with a message that misstates the cause — is the worst kind of failure for this product.

The second half is the failure policy. When metering itself breaks, the two gates disagree:

* **Existing note gate** (`src/server/aiMetering.ts:117-124`): returns **503 `METERING_UNAVAILABLE`** — fails closed.
* **New transcription gate**: `catch (meterErr) { deps.logger.error(...); }` and then **proceeds to the model call**
  — fails **open**, on the most expensive call in the system, with no alert.

**Fix:** count note events only (or introduce a distinct transcription allowance); align the failure policy and
make it explicit; route the 429 to the same paywall the note path uses (see §5.1).

### 4.4 🔴 Making `plan` mandatory turns a permanent data condition into an endless retry, and can freeze subscription status

```ts
// src/server/billing.ts:353-360 (customer.subscription.created/updated/deleted)
const plan = planFromMetadata(object);
if (!plan && event.type !== 'customer.subscription.deleted') {
  deps.logger.error('Subscription event has no valid plan in metadata.', …);
  throw new Error(`Subscription event ${event.id} has no resolvable plan`);
}
```

The throw is deliberate, and the webhook route's catch documents the intent:

```ts
// src/server/billing.ts:773-777
// 500 asks Stripe to retry, which is what we want for a transient fault.
return res.status(500).json({ error: 'Webhook processing failed.' });
```

But a missing plan is **not** transient. Stripe retries for up to three days; the event is never marked processed;
the subscription row is never written. For `customer.subscription.updated` that means **dunning, mid-term
cancellation and `cancel_at_period_end` never reach the clinic record** — the clinic keeps its last stored status,
which for an active subscriber is `active`, and `resolveEntitlements` grants full access for `active`
(src/lib/plans.ts:191). A practice that has stopped paying keeps full paid access, silently.

This is not hypothetical for the migration: **every subscription created before this commit has no
`subscription_data` metadata** (I verified main never set it), so the first `updated` event for each of them takes
this path. Before this ships, either existing subscription rows must be backfilled with `metadata.plan`, or the
plan must be derived from `items.data[0].price.id` with metadata as an override. The latter is the correct design —
it is also what makes a second price tier (or a portal-driven plan change) work at all, since **Stripe does not
rewrite subscription metadata when the Price changes**.

## 5. Medium findings

1. **A billing message is persisted into the clinical record.** `ChairsideWorkspace.tsx:1368` appends the server's
   error to `transcriptionWarnings` for any code that is not `NO_AUDIO` / `AUDIO_TOO_SMALL` / `NOT_FOUND`. A quota
   refusal has code `QUOTA_DAILY`, so *"This clinic has reached its daily allowance of 15 AI notes…"* is written to
   `transcriptProvenance.warnings` (:1456) on the saved Consultation (`src/types.ts:278`) and echoed back to the
   client (transcriptionRoutes.ts:240). That field means "the recording was incomplete". A quota message also gets
   the *passive warning* treatment while the note path opens the **BillingModal** on `QUOTA_DAILY`
   (App.tsx:757) — so the one moment you want to sell is the moment the transcribe path goes quiet.
2. **`currentPeriodEnd` is stamped from a Checkout Session's `expires_at`.** The fallback chain at the checkout case
   is `current_period_end → expires_at → now + 30d`. `current_period_end` is not a Checkout Session field;
   `expires_at` is the **session's** 24-hour expiry. `currentPeriodEnd` is consumed by `resolveEntitlements`
   (`periodValid = periodEnd > now`, plans.ts:175–176). Today this is benign for `active` (it still
   `grantFull('period_ended')`) but it becomes a downgrade clock for `canceled` / `past_due`, which fall to
   `lapsed(...)`. The branch is untested — the new test's payload contains no `expires_at`. Null already means
   "valid"; stop inventing a period end at checkout.
3. **`STRIPE_PRICE_PRACTICE` is undocumented and silently changes what is charged.** Referenced only at
   billing.ts:603. `docs/operations/environment-reference.md` lists `STRIPE_SECRET_KEY` and
   `STRIPE_WEBHOOK_SECRET` but not this. Note also that when it is set, `tax_behavior` is **not** sent (it is only
   set on the `price_data` branch) while `automatic_tax[enabled]=true` still is — so the inc-GST guarantee is
   delegated to how that Price was created in the Stripe dashboard. **Unverified against the live API**; a
   test-mode checkout is what settles it. Do not remove `automatic_tax` if GST is owed.
4. **The four promoted config severities are declarative, and the operator is not told.** `assertStartupConfiguration`
   throws only on `fatal` (configCheck.ts:277–284), so promoting `GCP_PROJECT_ID`,
   `DENTAI_DISABLE_PROFILE_DIRECTORY`, `DENTAI_REQUIRE_CONSENT` and `DENTAI_ABN` to `required` **cannot brick a
   deploy** — good news, and worth stating because it looks like it would. But no `docs/` file was touched by this
   PR (see diffstat), so a deploy will suddenly report four BLOCKING items with no explanation of why, and
   `DENTAI_ABN` genuinely changes receipt behaviour.
5. **The published legal entity still shows a placeholder.** `LegalPage.tsx:19` is
   `abn: 'ABN to be inserted before commercial use'`, rendered at `:81` — on the same site whose billing modal says
   "Australian GST Compliant" and whose invoices now use `DENTAI_ABN`. Two sources of truth for the supplier
   identity on tax documents.
6. **`vercel.json` hourly cron.** Vercel Hobby permits only once-per-day crons; `0 * * * *` requires Pro.
   Confirm the plan tier before deploying this, or the change fails validation with no obvious cause.
7. **The funnel's "Upgraded" counts free clinics.**
   `subscriptions.filter(s => s.plan !== 'trial' && s.status === 'active')` (server.ts ~computeFunnelMetrics)
   includes `solo`, whose price is **0** (`PLANS.solo.monthlyAudExGst === 0`) and which the ops console's own
   activation form offers. The single number the business is to be run on overstates paying conversions.
8. **"1st Note Gen" is not a generated-note stage.** `generatorDentistIds` takes every consultation owner plus any
   AI usage event, while `isGenerated` correctly tests `noteOrigin`. A clinic that saved a manually written note
   counts as having generated one.
9. **"Edit rate" cannot measure editing — it measures re-saving.** Revisions are appended on every governance write
   (`recordGovernance.ts:237-249`, `systemGenerated: false`), but the worker persists its generated consultation
   through a **direct store insert that carries no `revisions` field** (`grep revisions src/lib/db.ts src/server/stores.ts` → no
   matches; written at server.ts:1449-1455). So a worker-generated note finalised once has `revisions.length === 1`
   and is **not** counted as edited; only a further save after finalisation is. The metric designed to answer "is
   the output usable?" cannot see the most common edit — the dentist fixing the draft before signing. Compare the
   worker's generated `findings` against the finalised ones, or stamp a revision when the worker persists.
10. **The landing page's new absolute claim is contradicted by the metric this PR adds.** Landing.tsx now reads
    *"Every clinical note is grounded directly in recorded room audio and verified by the attending dentist"*, while
    the same commit adds `liveFallbackShare` / `browserLiveNotes` to measure notes that are **not** from recorded
    audio (and `chooseNoteTranscript` prefers the live transcript whenever diarized text is absent — which the
    quota path guarantees). "Every" is the word to drop.
11. **Funnel computation is unindexed and in-memory.** `computeFunnelMetrics` iterates every clinic and lists its
    consultations (N+1), then loads all usage events in one go, on every request. Fine at pilot scale; it needs
    aggregation when there are hundreds of clinics.

## 6. Low findings

1. **The claims guard is a source-text assertion.** `tests/productionHardening.test.ts` reads `Landing.tsx` and
   asserts the absence of nine specific strings. It cannot catch a *new* invented number (`$47,000`, `87%`, `3.2x`);
   `/\$\d{2,},\d{3}/` only matches 5+ digits with a comma. It passes only because someone typed those literals into
   a list. Real value, but do not mistake it for substantiation enforcement.
2. **`retryable` is dead code and mis-classifies quota.** `transcribeClient.ts:35` computes it; `grep -rn retryable src/`
   shows **no consumer**. It also marks `429` as retryable, which for a *quota* 429 is wrong (retrying cannot
   succeed until tomorrow). Harmless today only because nothing reads it.
3. **The ops test mutates `process.env.DENTAI_OPS_SECRET` without restoring it** (`tests/operations.test.ts:521-525`),
   making it order-dependent within its worker.
4. **The token-cap branch is untested.** The new transcription test covers `QUOTA_DAILY` only; `QUOTA_TOKENS`
   (transcriptionRoutes.ts:297) has no coverage.
5. **The receipt path is untested end to end.** `sendReceiptEmail` appears nowhere in `tests/`. The new "GST invoice"
   test calls `receiptEmail()` directly with hand-fed params, bypassing `applyStripeEvent` → the `invoice.paid`
   dispatch. So the defect being fixed ("`receiptEmail` is never called") is now *called* but unverified, including
   the silent no-op when `customerEmail` is missing (server.ts:944 returns with no log or audit).
6. **`/api/transcribe/audio` is not quota-gated**, so a capped clinic can still upload audio chunks without bound
   (storage growth, no spend).
7. **Trial `features` copy still sells "Full note generation"** while the token cap allows ≈5 long appointments/day.

## 7. What I did not verify (do not treat as confirmed)

* **No live Stripe call was made.** §4.2's tax behaviour and §5.3's `tax_behavior`/Price interaction are read from
  source plus Stripe's documented semantics. The test-mode checkout in the remediation plan's task 1.6 is what
  converts these from findings into facts.
* **No live model calls, no browser.** The UI was not eyeballed; the ops console finding is from the guard
  implementation, not from clicking it.
* **Postgres path not executed** (19 tests skip locally without `DATABASE_URL`). CI runs them, and the branch's own
  CI has not run because there is no PR.
* I reviewed `496d459` and `origin/main` as they are now; I did not re-verify against any later remote state.

## 8. Fix order

**Must precede merge**

1. §4.1 make the ops console reachable and secret-free — the telemetry is worthless otherwise, and the test must use
   the real `createOpsGuard`.
2. §4.4 backfill or derive the plan from the Price; never 500 on a permanent condition (record the event, alert, do
   not retry forever).
3. §4.2 pass actual tax (`total_tax`, `amount_paid`, `customer_tax_ids`) or refuse to issue the invoice; delete
   `?? 16390`.
4. §4.3 count notes rather than events; align the failure policy; route the refusal to the paywall.

**Immediately after**

5. §5.1 keep billing state out of `transcriptProvenance`; §5.2 stop inventing `currentPeriodEnd`; §5.7 fix the
   `upgraded` numerator; §5.9 make edit rate mean editing; §5.10 drop "Every".
6. §5.3 document `STRIPE_PRICE_PRACTICE`; §5.4 update the environment reference for the four promoted keys;
   §5.5 put the real ABN on the legal page.

**Then** the merge. Note the branch is 0 behind `main`, so it will rebase cleanly — but nothing here should ship
before §4.1–§4.4, because three of the four are money-or-trust failures that the tests cannot see.

## 9. Conformance against the remediation prompt

This branch is the output of `docs/reviews/antigravity-remediation-prompt.md` (the brief I wrote for Antigravity).
Measured against that brief, task by task:

| Prompt task | Status | Evidence |
|---|---|---|
| §1 P0 payment fulfilment | **Done, and proven** | `clinicIdFromObject` accepts `clinic_id` / `clinicId` / `client_reference_id`; `subscription_data` metadata added; free fallback removed. Signed-webhook test fails on main. Residual risk in §4.4 (legacy subscriptions + retry-forever). |
| §2 P0 tax | **Partial** | Receipt is now actually sent and the ABN is externalised to `DENTAI_ABN`. But GST is derived as `amount ÷ 11` rather than read from Stripe, the customer ABN collected by `tax_id_collection` is discarded, `?? 16390` can fabricate an amount, and neither `DENTAI_ABN` nor `STRIPE_PRICE_PRACTICE` reached `docs/operations/environment-reference.md`. |
| §3 P1 ceiling integrity | **Partial** | Token caps raised (60k→150k, 750k→2M) and metering moved before the spend — both correct in direction. But the note limit is still counted as raw usage *events*, so the ceiling still cannot express the promise (≈5 long appointments vs 15 notes/day), and the new gate fails **open** where the existing one fails closed. |
| §4 P1 instrument the business | **Partial** | The funnel and both quality signals are computed from real data and the metrics route is gated. But the console is unreachable (§4.1), `upgraded` counts free Solo clinics (§5.7), and edit rate cannot see the edit it exists to measure (§5.9). `liveFallbackShare` is correct — it reads `transcriptProvenance.source`. |
| §5 P1 claims | **Done — best-executed section** | All four invented constants deleted (`$34,800`, `$18,400`, `123.5x`, `52.8%`), the ROI-multiple copy replaced, the false 14-day claims removed from both `PLANS.trial.features` and the landing CTA, the PMS appointment-book claim retracted, and a guard test added that fails on main. Residual: one new absolute claim (§5.10). |
| §6 P1 resilience / compliance | **Not started** | `.github/workflows/ci.yml` is untouched, so the accuracy gate is still `bun run eval:notes --offline --min-score 0.9` (ci.yml:131) on recorded fixtures — it cannot catch a regression. Consent, retention and residency remain opt-in; only their *severity strings* changed in `configCheck.ts`. No hourly-to-live eval, no NDB runbook. Hourly drain is the only item done (vercel.json:20). |
| §7 P2 growth mechanics | **Not started** | No per-chair pricing above 6 seats, no PMS write-back (only `formatNoteForPmsClipboard`), no trial clock, no first-run self-test. |

**Discipline the brief asked for, and whether it was followed.** Two of the three hard requirements were met well:
*Reproduce before fixing* — met, and unusually so: the new tests genuinely fail on `main`, and the audit trail is real.
*Never invent a number* — met: the response to unsubstantiated figures was to delete them, not to replace them with
new ones, and the one added claim is qualitative rather than numeric. *Evidence per claim* — partly met: the work is
accurate on the paths it tested, but the two claims most likely to be taken on trust (a working tax invoice, a
metered transcription path) are the two that are untested or tested only against a stub.

**The pattern to note for the next pass.** Every section that could be verified by a unit test is done to a high
standard; every section that requires touching CI, docs, or an operational default is untouched. That is the natural
shape of agent-written work, and it is why §6 and §7 — the renewal and trust work — still need a human in the loop.
