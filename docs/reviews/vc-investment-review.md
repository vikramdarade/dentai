# DentAI — investment review (VC lens) — corrected for `main`

**Reviewed:** `origin/main` @ **`3b429f2`** (fetched and pinned during this review).
**Previous revision of this document was wrong.** It was written against the local working tree
(`da92040`), which is **14 commits behind `main`** and does not contain the merged monetisation work.
The correction log below records exactly what changed, because the pattern in it is itself a diligence
finding.

| Earlier claim (first pass) | What `main` actually has | Status |
|---|---|---|
| "No path from a dentist to a dollar; no storefront" | `src/components/BillingModal.tsx` — plan/usage/seats screen, `/api/billing/checkout`, `/api/billing/portal` (Stripe customer portal), post-checkout status feedback, routed in `App.tsx:1184` | **Withdrawn** |
| "Seat limits are unenforced promises" | Enforced: `SEAT_LIMIT_REACHED` in `server.ts:2753,2781` via `dbCountActiveMembers` + entitlements | **Withdrawn** |
| "Recall is the unpriced, unbuilt asset" | `src/lib/recallEngine.ts` (due dates, urgency tiers, outreach copy, clamped month arithmetic, no mock timestamps) + worklist surfaced in the UI; sold in the Practice plan | **Withdrawn** |
| "The odontogram reads prose as tooth findings" | Fixed: prefix-anchored regex (`tooth|teeth|#|fdi|site`) + dental-term suffix + explicit unit blacklist (`weeks, minutes, %, mg, $` …) | **Withdrawn** |
| "$399 practice / $149 solo" | **Solo is free forever**; Practice is **A$149/mo ex GST** for 6 seats | **Corrected** |
| "Landing calls invented numbers 'Verified'" | "Verified Recovered Production" → "Recovered Production"; "PMS-verified" → "booked treatments"; "Verified on $149/mo" → "Modeled on $149/mo". The **numbers are still invented constants** | **Partially stands** |
| "No trial clock" | Still true — "14-day evaluation" has no implementation | **Stands** |
| "No GST/tax invoice, receipt never sent" | Still true, and now sharper (see §1.3) | **Stands** |
| Unit-economics ceiling and transcription metering order | Unchanged on main | **Stands** |

**The process finding:** a review computed from the working tree rather than the remote default
branch produced a document that confidently described a product that no longer exists. The same
mistake in an investor memo or a bear case would have been expensive. Any future claim about "the
codebase" must be pinned to a fetched `origin/main` SHA. My executed test numbers (342 passing) were
run against the **stale tree**; I have **not** run `main`'s suite.

---

## Verdict (revised)

**The business-model objection I opened with largely dissolves.** Main has a real storefront, real
seat enforcement, a real recall engine, and a coherent commercial position: free Solo as the
distribution engine, A$149/mo Practice as the margin product. That is a business, not a demo.

**The investment objection narrows to one thing:** there is a **critical fulfilment defect in the paid
path** (§1.1). A practice can pay A$149/month today and receive free-tier entitlements, silently,
with the server logging that it *ignored* the event. Until that is fixed and proven end-to-end with a
live (test-mode) Stripe transaction, the product cannot convert a paying customer, and no revenue
figure produced by this system should be trusted.

Everything else is remediation, not rejection.

---

## 1. The money path

### 1.1 🔴 CRITICAL — a paid checkout does not grant the paid plan

The checkout session writes metadata under **snake_case** keys:

```js
// src/server/billing.ts:532-534 (checkout body)
params.append('metadata[clinic_id]', clinic.clinicId);
params.append('metadata[dentist_id]', req.dentist.id);
params.append('metadata[plan]', plan);
```

The webhook looks for a **camelCase** key:

```js
// src/server/billing.ts:293 (checkout.session.completed)
const clinicId = String(object.metadata?.clinicId || '');
if (!clinicId) {
  deps.logger.warn('Stripe checkout completed without a clinicId in metadata; ignoring.', ...);
```

`object.metadata.clinicId` is therefore always `undefined`, `clinicId` is `''`, and the handler
**breaks out before writing any subscription**. The customer is charged A$149/month and remains on
Solo entitlements (15 notes/day, 1 seat, no recall, no team audit trail).

Three compounding faults make this worse rather than self-healing:

1. **No `subscription_data[metadata]` is set at checkout.** Session metadata is not inherited by the
   Subscription object, so `customer.subscription.created` / `.updated` also cannot resolve the clinic
   by metadata.
2. **The customer-lookup fallback cannot work either.** Those handlers fall back to
   `byStripeCustomerId(object.customer)` — but that mapping is only written *inside* the subscription
   write that never happened. A first-time customer has no row to find.
3. **The plan fallback is `'solo'`** (`planFromMetadata(object, 'solo')`), i.e. the free plan — so even
   a partially-successful metadata read would grant the free tier.

**Net effect: paying customers are silently downgraded, and the only recovery is the operator
console** (`activateManually`, ops-only, `server.ts:859`). Revenue survives only because a human
notices. `success_url` points at `#/billing?status=success`, so the customer is *told* the payment
succeeded while the entitlements never change — the worst possible combination for trust.

**Fix:** use one casing on both sides; set `subscription_data[metadata][clinic_id]` and
`[plan]`; keep `client_reference_id` as the durable key; and add the missing regression test — a
signed `checkout.session.completed` fixture asserting the subscription row is written. Then run one
test-mode Stripe checkout end-to-end and watch entitlements flip. This is hours of work and it is the
single highest-value change in this entire document.

### 1.2 Seat enforcement and packaging are now real — but note what the price buys

`SEAT_LIMIT_REACHED` is enforced on approval in both the Postgres and JSON paths. Practice is
6 seats / 200 notes/day / 750k tokens for A$149. Solo and Trial are both 1 seat, 15 notes/day,
60k tokens, A$0. That is a clean, defensible funnel.

The commercial risk it creates: **the revenue product is capped at A$149/month per clinic regardless
of size.** A 12-chair practice pays the same as a 2-chair practice, and the seat gate means the
12-chair clinic must either accept 6 clinicians on the tool or negotiate. Per-clinic pricing with a
6-seat cap will surface as a pricing conversation in every practice with more than six chairs — the
segment most able to pay. Consider a per-chair add-on above 6 seats before this becomes a wave of
manual exceptions.

### 1.3 🔴 Tax: the displayed price and the charged price disagree, and no tax invoice exists

- The UI states the price **including GST**: `'ex GST ($163.90 inc GST)'` and
  `'Australian GST Compliant'` (`BillingModal.tsx:279, 220`).
- Stripe is asked to charge **A$149.00** with no tax handling at all:
  `unit_amount = '14900'`, and `grep` for `automatic_tax`, `invoice_creation` and `tax_behavior`
  in `billing.ts` returns **nothing**.
- So the practice is charged **$149.00**, not the $163.90 the screen implies. Either:
  - you are GST-registered and **A$13.55/month of every subscription is GST you must remit out of
    collected revenue** (revenue leakage plus a reconciliation problem), or
  - you are not registered, in which case "Australian GST Compliant" and an inc-GST figure are
    **misleading statements to a business customer**.
- `receiptEmail()` (`src/server/email.ts:225`) now accepts an ABN and is labelled "PAYMENT RECEIPT",
  but it is **never called anywhere** (`git grep "receiptEmail("` → definition only), and its body
  carries a **total with no GST line**. An Australian B2B tax invoice must identify the supplier
  (ABN), show the GST amount and be labelled as a tax invoice. As built, none of that reaches the
  customer; the practice's bookkeeper cannot claim the GST credit they are entitled to.

**Fix:** Stripe Prices + Stripe Tax with `tax_behavior: inclusive`, `invoice_creation` enabled, and a
real "TAX INVOICE" template including ABN and GST amount; then actually send it from the webhook.
Set `DENTAI_ABN` — and note that the receipt falls back to a header with **no ABN at all** when that
variable is unset, which is the default.

### 1.4 The advertised allowance and the enforced allowance describe different days

Both free tiers promise **15 AI notes/day** and cap **60,000 tokens/day**. With recorded audio
transcribed server-side at roughly 32 tokens/second, a 15-minute appointment is in the region of
**28,000–30,000 tokens**. On that estimate the token cap binds after **~2 long appointments** — a
tenth of the advertised allowance. Practice is the same shape: 200 notes/day advertised against
750k tokens ≈ **25 long appointments**.

Assume-list is stated because it is an estimate, not a measurement: 32 tok/s audio, a 15-minute
appointment, metering counting transcription plus generation. Even at half that cost the ceiling
binds far earlier than the number on the card. A free user who is cut off on their second long
consultation on a day the card promised 15 will conclude the product is broken, not that they hit a
limit. **Express the cap in notes at realistic lengths, or measure `usage_events` and set the token
cap from data.**

### 1.5 The ceiling cannot prevent the most expensive call

Transcription usage is recorded **after** the model call:

```js
// src/server/transcriptionRoutes.ts:304
await deps.recordUsageEvent(scopeId, dentistId, 'ai_transcription', outcome.approxTokens);
```

There is no pre-flight check against `resolveDailyLimits` on that route (`grep` for
`resolveDailyLimits` in the file returns nothing), and the write sits in `try { … } catch { warn }`.
So a clinic already at its cap still spends on transcription and is *then* refused the note: the cost
is incurred, the value is not delivered, and under-counting is silent. Meter transcription **before**
spending, and treat it as the primary cost object.

### 1.6 Unit economics and concentration

Model cost per appointment remains roughly **1–3 cents** against A$149/month — margin is not the
problem, and the free tier's cost is bounded by the 60k/day cap. Two risks stand:

- **One shared model key funds every clinic**: one project quota, one throttling event, one key
  rotation, and no per-clinic cost attribution. A Group-tier security questionnaire will ask whether
  keys are per-tenant.
- **TAM discipline (assumption — verify):** at A$149/month, A$1M ARR requires roughly **6,700
  practices**. Australia's dental practice population is plausibly in the several-thousands range, so
  the free-Solo + paid-Practice model may need either per-chair expansion or multi-jurisdiction
  portability (UK/IE/NZ/CA) to reach venture scale. Search tooling was rate-limited during this
  review; treat the count as a hypothesis to test first, not a finding.

### 1.7 Free-tier abuse

Signup defaults open (`selfSignupAllowed()` → true unless explicitly `'false'`), limited to 5 accounts
per hour per address. Each account is its own metering scope with its own 60k free tokens/day, on the
founder's key. Address-limited, not identity-limited. Closing signup during the pilot, or requiring an
invite code, is a one-line change with the lever already built.

---

## 2. Product architecture

Real and notably strong:

- **Two-store parity enforced by the suite** (JSON path under test, Postgres path in CI). A Postgres-only
  feature is a feature with no tests — this is the best structural decision in the repo.
- **Durable queue**: `FOR UPDATE SKIP LOCKED` claiming, stale-`processing` requeue, priority ordering,
  durable completion so a note survives a closed laptop; multi-instance safe by construction.
- **Stateless, epoch-versioned sessions** (no in-memory session map on serverless).
- **Versioned migrations with a rehearsed `down` path** in CI.
- **Hash-chained audit log** that documents its own branch risk instead of pretending to a transaction
  it does not have.
- **Configuration as a contract** (`configCheck.ts`): declared variables, consequences, and a boot
  refusal on fatal findings; health reports counts, never values.
- **Recall engine** quality stands out for its caution: it refuses to synthesise a missing interval,
  clamps month-end arithmetic (31 Aug + 6mo → 28 Feb) and refuses `new Date()` fallbacks.

Structural risks:

- **`server.ts` is the API *and* the note worker in one ~4.8k-line file.** Domain logic is well
  extracted; the monolith remains the concentration of bus factor and incident risk.
- **Per-instance caches** (entitlements 60s TTL, alerter de-duplication) mean a plan change can apply
  instantly in one instance and a minute later in another. Acceptable — but it should be a written
  decision. Note this compounds §1.1: a partial success would propagate inconsistently across instances.
- **Capture remains the accuracy ceiling.** Recorded audio (beacon or cockpit mic) with server-side
  diarization, live Web Speech as a labelled fallback, provenance recorded per note — the right
  architecture. But nothing reports the **share of notes built from the live fallback**, which is the
  honest accuracy signal, and no surface reports **edit rate per generated note**.
- **Region compliance is opt-in.** The Vertex `australia-southeast1` path exists and is used when
  `GCP_PROJECT_ID` is set; the default is the global developer endpoint. For an Australian clinical
  product the compliant path should be the default and leaving it should be deliberate.

---

## 3. Stability and resilience

| Dimension | Assessment |
|---|---|
| Suite | 29 test files on main (incl. `billingSuite`, 11 tests). **Not executed by me against main.** |
| CI | typecheck → tests → build, plus Postgres job (migrations + rollback rehearsal) and clinical eval. Blocking. |
| Accuracy gate | `bun run eval:notes --offline --min-score 0.9` (`ci.yml:131`) — **recorded outputs, no model call**. |
| Backups | Scripted (`scripts/ops/backup-database.sh`, `restore-database.sh`). |
| Alerting | Error rate / queue backlog / queue stall / DB down, de-duplicated, via the ERROR webhook. Requires `ERROR_WEBHOOK_URL`. |
| Degraded modes | Model failure → deterministic offline draft flagged for review (good). Metering store failure → **fail closed** (refuses to spend), harsh mid-consult but correct for cost. |
| Scheduling | `vercel.json` cron drains the queue **once daily at 02:00 UTC**. |
| Observability | Logs + webhook. No error tracker, APM, tracing or SLO. |

**The accuracy gate cannot detect an accuracy regression.** `--offline` scores committed recordings of
past generations, so a model deprecation, provider behaviour change, or a prompt edit that degrades
output **passes**. Three fixtures cannot support an accuracy claim in any case. The team documents this
plainly — the risk is that "clinical eval passes" gets repeated externally as evidence, which it is not.
Add a scheduled **live** eval (the `--live` path already exists and is unused in CI) against a real
deployment, and record the score over time.

**Resilience gaps that would bite a real practice:** daily-only queue drain (a note submitted at 10:00
waits until 02:00 unless a signed-in client polls — the durability architecture supports better than
this); no load/soak/chaos test (concurrency is reasoned about, never measured); no penetration test,
threat model, or dependency vulnerability gate (`bun audit` is `continue-on-error`); and no funnel
telemetry at all — `/api/telemetry` is deliberately retired (401) and only queue depth remains, so
activating a customer, retaining them, or proving an accuracy improvement is currently unmeasurable.

---

## 4. Claims versus evidence (what survives on main)

The copy pass removed the word "Verified" — a genuine improvement. The **numbers remain invented
constants**, and one new wording implies a model that does not exist:

| Surface (`src/components/Landing.tsx`) | Value | Current label | Problem |
|---|---|---|---|
| `:421` | `$34,800` | "Unscheduled Pipeline" / "24 active treatment plans" | Hardcoded; `/api/pipeline/roi` computes real per-clinic figures. |
| `:425` | `$18,400` | "Recovered Production" / "12 booked treatments" | Hardcoded. |
| `:430` | `123.5x` | "Modeled on $149/mo plan" | **"Modeled" implies a model.** Nothing in the repo computes this. |
| `:435` | `52.8%` | "Avg booking velocity < 48 hrs" | Hardcoded; no velocity metric exists. |
| `:205` | "100x+ practice ROI" | hero trust row, unlabelled | Unsubstantiated performance claim next to "No card needed". |
| `:544` | "40x–100x+" | "every single month" | Unsubstantiated, repeated as a monthly outcome. |

The exposure is regulatory (AHPRA's advertising rules prohibit misleading claims; the ACCC is not
lenient on unsubstantiated performance figures) and commercial — this audience is small and tight, and
one owner asking "modelled on what data?" costs a reference group. The repository already contains the
honest alternative: real grounded notes, `needsReview` flags, append-only revisions, per-record
provenance, and `usage_events` full of edit-rate data. **Show one real consultation and what the
dentist changed before signing.** Delete the four constants.

---

## 5. Compliance defaults (AU)

Present and credible: consent gate, append-only revisions, read auditing, executing 7-year retention
with tombstones, `patientId` identity policy, sub-processor register (`docs/legal/`), practice
acceptance ledger, operator lockout and recovery tokens, MFA.

**Still opt-in on main** (verified severity `recommended`, i.e. not enforced): `GCP_PROJECT_ID`
(Australian region), `DENTAI_REQUIRE_CONSENT`, `DENTAI_DISABLE_PROFILE_DIRECTORY`,
`ERROR_WEBHOOK_URL`, `DENTAI_DAILY_NOTE_LIMIT`, `DENTAI_DAILY_TOKEN_LIMIT`, and the retention sweep
(`DENTAI_RETENTION_ENABLED`, dry-run by default). Shipping defaults that contradict the published
privacy notice is a governance gap even when the code exists — the notice describes behaviour the
default deployment does not perform. `DENTAI_DISABLE_PROFILE_DIRECTORY` unset means every clinician
name and id is enumerable from the public sign-in screen.

Also missing: a **notifiable-data-breach runbook and rehearsal** (the duty is statutory: assess and
notify, on the clock, with one person on call); independent security assurance (no pen test, threat
model, or vuln gate); and confirmation that retention handles minors ("until age 25"-style
state-based rules) before a paediatric practice onboards.

---

## 6. Solo-founder sustainability

- **Bus factor 1**, with a ~4.8k-line file at the centre of the incident surface.
- **No ops console UI**: activating a plan, issuing a recovery token, locking an account, running
  retention are authenticated endpoints with no interface. Serving 30 practices is a terminal session
  per customer event — and §1.1 makes this path load-bearing for revenue, not just support.
- **No product metrics** (§3): activation, retention and edit rate are all invisible, so pricing and
  roadmap decisions are opinions. Derivable from `usage_events` + `audit_logs` without a new vendor or
  any patient data leaving the system.
- **Support load is inherent**: chairside audio fails in repeated, specific ways (mic permission,
  Bluetooth routing, noisy surgery, phone sleep). A first-run self-test — record 30 seconds, hear it
  back, see the transcript — would remove a large share of first-week tickets.

---

## 7. Conditions I would attach

1. **Fix fulfilment and prove it with a live test-mode checkout** (§1.1) — assert the subscription row
   and an entitlement flip. Nothing else on this list matters until money changes entitlements.
2. **Make the price true**: Stripe Prices + Stripe Tax (inclusive), a real tax invoice with ABN, sent
   from the webhook. Reconcile the $149 vs $163.90 discrepancy explicitly (§1.3).
3. **Delete the four invented landing constants** (§4), or label them as an illustrative example with
   a stated basis and date.
4. **Align the ceiling with the promise**, and meter transcription before spend (§1.4, §1.5).
5. **Instrument the funnel** and publish two internal metrics: edit rate per note, live-fallback share.
6. **Either implement the 14-day trial or delete the claim** (§5/copy).
7. **Compliance defaults flipped** (region AU, consent required, retention live, staff directory
   hidden) plus an NDB runbook with a rehearsal.
8. **Resilience proof**: at-least-hourly queue drain, load/soak test of a synthetic morning, error
   tracking, and a penetration test report packaged for practices.
9. **Per-chair expansion above 6 seats** before the >6-chair segment becomes a queue of manual
   exceptions.

**Diligence questions that would decide it:** how many pilots have run a full clinical week without
the founder in the room? What is the edit rate per generated note and the live-fallback share? Has a
single live Stripe checkout ever produced the Practice entitlements automatically? And who wrote the
$18,400, and what was it for?

---

## 8. What I did not verify

- **I did not run `main`'s test suite.** My executed result (342 passing, 22 skipped) came from the
  stale working tree. Main has 29 test files including `billingSuite`; CI runs them, but I did not
  execute them here.
- The Postgres path was not exercised in this environment (no `DATABASE_URL`); tenancy and concurrency
  claims are reasoned from code, not observed.
- The UI was not eyeballed (no dev server started); landing and billing copy was read from source.
- No live model calls were made; nothing here measures note quality, only the gate and the pipeline.
- §1.1, §1.3 and §1.5 conclusions are read from source, not from a live transaction. A test-mode
  Stripe webhook with a captured event body would settle §1.1 in minutes and should be the first
  thing done.
- TAM figures are an unverified assumption (search tooling rate-limited). No vulnerability scan was run.
