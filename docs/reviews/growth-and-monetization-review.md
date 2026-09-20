# Growth & monetization review — how to get more dentists using this, and paying

**Reviewed at:** commit `8f6c453` (`main`)
**Scope:** the commercial and activation surface — plans, entitlements, billing,
metering, trials, seats, onboarding, the acquisition funnel, and the features a
practice owner would actually pay for.
**Method:** static review of the code and existing docs. No application code was
changed by this review. Not runtime-verified (no preview run).

**Read this first:** the engineering is ahead of the business. Billing signatures,
entitlements, metering, DPA acceptance, export and retention are all real. What is
missing is almost entirely *commercial plumbing* — the parts that let a willing
dentist pay you, and the parts that make the free tier a funnel instead of a
liability. That is cheaper to fix than anything already built.

---

## 1. What already exists

| Capability | Where | State |
|---|---|---|
| Plans & entitlements | `src/lib/plans.ts` | Defined: trial / solo / practice / enterprise |
| Stripe checkout + signed webhook | `src/server/billing.ts` | **API only — no client calls it** |
| Usage metering (fail-closed, notes **and** tokens, per clinic) | `src/server/aiMetering.ts` | Live on every generation path |
| Live usage pill for the clinician | `LiveRecording.tsx` → `/api/usage/today` | Live |
| Transactional email (Resend) | `src/server/email.ts` | Welcome / invite / recovery / receipt templates |
| Practice terms + DPA acceptance, versioned | `src/server/practiceAgreement.ts` | Live |
| Self-serve clinic export | `/api/clinic/export` | Live, audited |
| Treatment pipeline + ROI | `TreatmentPipeline.tsx`, `/api/pipeline`, `/api/pipeline/roi` | Live, computed from real consultations |
| PMS booking webhook | `/api/webhooks/pms-booking` (defaults to `cliniko`) | **Inbound only** |
| Invite codes + owner approval | `/api/clinics/join`, `/api/clinics/:id/members/.../approve` | Live |
| Narrated product demo | `src/demo/DemoMovie.tsx` | Live |
| Operator console | `/api/ops/*` | **API only — no UI** |
| Legal pack | `docs/legal/*` | Written (data flow, sub-processors, retention) |

This is a genuinely good position: the hard, unglamorous compliance work is done,
and the metering is honest (it fails closed rather than giving the product away).

---

## 2. Findings, ranked by effect on adoption and revenue

Each finding states what is wrong, the evidence, why it costs dentists or dollars,
and the fix.

### G1 — 🔴 The product promises "free forever for solo", the code charges $149/month

The recorded demo says, verbatim:

> "DentAI is **free forever for solo clinicians** with full ambient charting. Clinic
> owners upgrade to the Practice Tier for ninety-nine to one hundred forty-nine
> dollars a month…"
> — `src/demo/demoScript.ts:264-265`, echoed on-screen at `src/demo/Scenes.tsx:1705,1782`

The landing page says "Free to try · No card · No setup fee" (`Landing.tsx:813`),
and the approved intent document specifies a **"Free Solo Tier (Free Forever)"**
against a paid Practice tier at $99–$149 (`docs/intent/growth_loop_and_monetization_demo.md`).

The entitlement engine implements a different business: `PLANS` in
`src/lib/plans.ts` is **trial (10 notes/day, 14-day evaluation) → Solo A$149/mo →
Practice A$399/mo (6 seats)**, with no free tier at all.

Why this is the most damaging finding: the growth model in your own intent doc
depends on the solo associate/locum as the distribution engine — they are who
takes it to the practice owner, the study club and the locum handover. Your demo
sells them free-forever, and your code will ask them for a credit card after ten
notes a day. In a profession of a few thousand people who all talk to each other,
that is a word-of-mouth liability, not a pricing opinion.

**Fix:** decide, then make the demo, the landing page and `plans.ts` agree. My
recommendation is to honour the recorded promise — a genuinely free solo tier is
the cheapest distribution you will ever buy — and monetise the practice
(seats, governance, audit, template standards, priority queue). If instead you
charge solo, re-record the demo, because shipping both is worse than either.

### G2 — 🔴 There is no way to pay inside the product

`GET /api/billing/status` and `POST /api/billing/checkout` exist
(`src/server/billing.ts:459,484`) and **no client file references either**
(verified by grep across `src/`). There is no plan screen, no upgrade prompt, no
trial status, no invoice link, no "manage billing", and no public pricing section
on the landing page (its anchors are `top`, `how-it-works`, `revenue-engine`,
`features`, `formats`, `trust` — there is no `pricing`).

Consequence: a dentist who wants to pay you **cannot**, except by emailing the
founder. Every other lever in this document is worth less until this is fixed.

**Fix:** a Plans screen (current plan, usage this month, seat count, upgrade),
an upgrade CTA on the trial/quota-exhausted states — the quota response is
already user-friendly, it just has no next step — and a Stripe billing portal
link so cancellations and card updates do not need you.

### G3 — 🔴 You pay for the product after a successful payment lands on a dead end

The checkout `success_url` is `/#/dashboard?billing=success`
(`src/server/billing.ts`), but:
- `#/dashboard` is not a route — `parseRoute()` in `src/App.tsx` recognises
  `demo`, `landing`, `privacy`, `terms`, `recover`, `roadmap-prototype`, `beacon`
  and returns `null` for anything else;
- the string `billing=success` is **read nowhere in the client** (verified by grep).

So a practice owner who has just paid is dropped into the app with no
confirmation, no receipt, no plan shown, and no indication anything happened.
For a first payment from a practice, that silence is where refund requests and
"is this thing even on?" emails come from.

**Fix:** a real post-checkout confirmation (plan active, what they now have,
receipt link), and a `#/billing` route rather than a hash query the app ignores.

### G4 — 🟠 Seats are sold but never enforced

`PLANS[].seats` is stored on the subscription (`src/server/stores.ts:646`) and
quoted in the Stripe line item ("6 clinician seat(s)", `src/server/billing.ts:524`),
but neither `POST /api/clinics/join` nor the owner-approval route checks the
practice's seat count (verified: no seat check in either handler).

Consequence: a Practice subscription (A$399 for 6 clinicians) can onboard forty
clinicians. That is a direct revenue leak, and it makes the packaging story untrue
the first time an owner tests it.

**Fix:** enforce the limit at **approval**, not at join — a pending request is
harmless, and approval is already the owner's gate. Return a clear
"practice is at its seat limit; upgrade or free a seat" message, and surface the
same number on the Plans screen.

### G5 — 🟠 The trial never ends

`plans.ts` promises a "14-day evaluation" in the trial plan's feature list, but
there is no `trialEndsAt`, `trial_ends_at` or equivalent anywhere in the codebase
(verified by grep). The trial is therefore an unbounded free tier at 10 notes/day.

That is a legitimate model — but it is not the one described to customers, and it
removes the single cheapest conversion mechanism a SaaS has: a deadline. Either
implement the expiry (with emails at day 10 and day 14, and a graceful
downgrade to the free tier rather than a hard stop, because a clinician mid-patient
must never be blocked) or delete the claim from the plan copy.

Note this was already raised as an open product decision in
`docs/reviews/production-readiness-review.md` (§150, §199) and
`docs/reviews/operatory-command-center-v1-review.md` (B5): *is the daily note cap
a product number or an env default?* It is still unresolved, and it is now
load-bearing for G1, G2 and G5 together.

### G6 — 🟠 The landing page's ROI numbers are hardcoded while the API computes real ones

`Landing.tsx` (≈421–430) displays "$18,400", "123.5x", "52.8% recapture rate",
"24 active treatment plans", "12 PMS-verified bookings" and "**Verified** on
$149/mo plan" as static text. Meanwhile `/api/pipeline/roi` computes ROI from the
clinic's actual consultations.

Two problems. First, credibility: a practice owner who asks "verified by whom?"
has no answer, and the numbers will not match their own dashboard on day one.
Second — and specific to Australia — AHPRA's advertising guidelines prohibit
misleading claims and tightly restrict testimonials about clinical care; "verified"
production-recovery figures with no stated basis are the kind of claim that is
commented on in a complaint, not just a sales conversation.

**Fix:** either label the panel clearly as an illustrative example dataset (and
keep it obviously fictional), or drive it from real aggregate data with a stated
basis and date. Drop the word "verified" unless something actually verified it.

### G7 — 🟠 Nothing measures the funnel, so none of the above can be tuned

`/api/telemetry` is deliberately retired (`src/server/opsRoutes.ts:204` returns 401)
and `/api/ops/telemetry` is per-instance queue depth. There is no durable record of
how many clinicians signed up, reached a first note, came back the next day,
invited a colleague, or upgraded. Every recommendation in this document is
therefore an opinion rather than a measurement.

The good news: you already persist what is needed — `usage_events` and the
hash-chained `audit_logs` — so the funnel can be **derived** rather than built,
with no new vendor and no patient data leaving the system (important: a new
analytics sub-processor would have to be added to
`docs/legal/data-flow-and-subprocessors.md` and every practice's DPA).

**Fix:** one operator endpoint plus a small ops view computing the funnel in §4.
This is the highest-leverage cheap piece of work here, because it turns the rest of
this list into decisions you can check.

### G8 — 🟠 The revenue moat is half-built: recall

Every note captures `recallRequirements` (`src/App.tsx:635`,
`src/components/ClinicalSummary.tsx:521-568`, default "6 Months (Standard)"), and
`PatientRoadmapPrototype.tsx:374` claims a "smart recall engine" — but there is no
recall worklist, no due-date surface and no outbound. The treatment pipeline
(`TreatmentPipeline.tsx`, `/api/pipeline`) is the other half, and it is real.

This matters commercially more than any accuracy improvement: the note is a
*cost* the dentist bears (compliance paperwork). A recall worklist converts it into
*revenue* (recovered production), which is what an owner actually signs a cheque
for. It is also the natural home for the ROI claims in G6 — because it would be
real.

**Fix:** derive recall due dates from saved notes, show a per-clinic "due this
week" list, and let the practice send a reminder (SMS/email) — see §6.

### G9 — 🟠 PMS integration is inbound-only, and hand-copying is the #1 attrition reason

There is an inbound webhook (`POST /api/webhooks/pms-booking`, default
`pmsType: 'cliniko'`) but the outbound path is copy/print/plain text
(`src/lib/noteExport.ts`). "I still have to paste it into my software" is the most
common reason a chairside tool gets abandoned, and it is the one integration every
practice will ask for in the first meeting.

**Fix:** pick **one** PMS and do a real write-back of the completed note (and
recall) into the patient's file. Cliniko is the pragmatic first choice because the
webhook already assumes it and it is common in Australian practices; verify current
market share and API terms before committing, and price it as a Practice/Group
feature rather than a freebie. A single deep integration also becomes your
strongest lock-in and a referral channel through each vendor's own community.

### G10 — 🟡 You cannot charge money in Australia with the current receipts

`receiptEmail()` in `src/server/email.ts` states the amount ex GST but contains no
ABN, no GST amount and no "Tax invoice" wording. For B2B supply in Australia a tax
invoice must identify the supplier (including ABN), show the GST amount and be
labelled as a tax invoice — otherwise your customers' accountants will chase you,
and practices that claim GST credits cannot.

Related: `POST /api/billing/checkout` builds prices **inline** via
`price_data` rather than referencing Stripe Price objects. That means no Stripe
Tax (AU GST handling), no promo/discount codes, and no price history — so a study
club trial offer or a price change is a code change rather than a dashboard
action, and every checkout mints a new price.

**Fix:** real Stripe Products/Prices, Stripe Tax enabled for AU, and a compliant
tax-invoice path (Stripe's hosted invoices cover this if you use them).

### G11 — 🟡 Pricing is inverted against your own growth loop

At list prices, **Solo is A$149 for one clinician** while **Practice is A$399 for
six** — A$66.50 per clinician. The individual advocate (a locum, an associate, the
person who actually evangelises in a study club) pays more than double per seat
than the practice that adopts it afterwards.

**Fix:** if the free tier exists (G1), price Solo as a deliberately low bridge and
make Practice the margin product, per seat or per chair so revenue scales with the
practice rather than being capped at $399 for a 60-patient-a-day clinic.

### G12 — 🟡 Adoption friction: no first-run path, no sample consultation

Onboarding today is a welcome email and a narrated video. There is no first-run
checklist (verified: no checklist/first-run surface in `src/components`), no
"try a sample consultation without signing up" path, and sign-in requires a name
plus a 4-digit PIN, so every clinician in a practice needs their own profile before
the practice gets value.

**Fix:** three things that each raise trial→activation: a labelled sample
consultation usable with no account (no real patient data, so no consent problem),
a 3-step first-run checklist (set PIN → record a 30-second test → save your first
note), and an invite-code-first journey for associates/locums so a second clinician
joins in under a minute.

---

## 3. The decision that blocks everything else

Before G2 is worth building, answer this:

| Question | Why it gates everything |
|---|---|
| **Is the solo tier free, or A$149?** | Determines the demo, the landing page, the trial (G5), the seat rules (G4) and the funnel targets (G7). Your demo and your intent doc say *free solo*; your code says *$149 solo*. |
| **What is the free/entry cap, as a product number?** | 10 notes/day forever is generous enough to never convert and tight enough to annoy. The number should come from cost per note and gross-margin target, not an env default. |
| **Per clinic or per seat?** | Per clinic caps revenue on big practices; per seat penalises adoption. Pick one and enforce it (G4). |

My recommendation, given the intent doc and the demo already recorded:
**free solo (a real, usable daily cap) → paid practice per seat**, with the solo
tier explicitly positioned as the distribution engine, not the revenue engine.

---

## 4. Metrics to instrument (the definition of "working")

Derive from existing `usage_events` + `audit_logs`; no new vendor, no PHI.

**North star:** notes *saved* per active clinician per week. Saved, not generated —
generation is our output, saved is the clinician's acceptance. It is the only
number that captures both adoption and quality.

Supporting funnel, each a single query:

1. profile created → 2. first note generated → 3. **first note saved** (the real
activation event) → 4. returned on day 2 → 5. 5+ notes in a week → 6. invited a
colleague → 7. owner accepted terms → 8. subscribed.

Also worth watching from day one: **edit rate per generated note** (how much the
dentist changes), and **provenance split** (diarized transcript vs live fallback —
already recorded on each record since the transcription work). A high live-fallback
share means accuracy is still capture-limited, which is the honest signal to watch
before promising anything to a practice.

---

## 5. Roadmap

**Next 2 weeks — remove the blockers (all small, no new vendors)**

1. Decide §3, then make demo + landing + `plans.ts` tell one story (G1, G5).
2. Plans/billing UI: current plan, usage, seats, upgrade CTA, manage-billing link (G2).
3. Real post-checkout confirmation and a `#/billing` route (G3).
4. Enforce seats at approval with an upgrade message (G4).
5. Funnel endpoint + ops view from `usage_events`/`audit_logs` (G7).

**Next 30 days — make it worth paying for**

6. Recall worklist derived from saved notes, with a due-date view (G8) — this is
   the feature that turns a cost into revenue.
7. Compliant tax invoices, Stripe Prices + GST (G10).
8. Fix the landing ROI panel; remove unsourced "verified" claims (G6).
9. First-run checklist + no-account sample consultation (G12).
10. Practice "privacy & security pack" as a downloadable sales asset — most of it
    already exists in `docs/legal/`, but it is not packaged for a practice manager
    or a security questionnaire.

**60–90 days — distribution and lock-in**

11. One real PMS write-back (G9), priced into the Practice tier.
12. Peer referral with a real incentive (the invite-code plumbing exists; what is
    missing is a *referral* code with a benefit, which is the loop the intent doc
    asks for — and it must be professional, not gimmicky).
13. Ops console UI (`docs/operations/build-backlog.md` P2.3) — this is what lets
    one founder serve thirty practices without a terminal.
14. Multi-site/group packaging on top of the existing `ClinicSwitcher`.

---

## 6. Services to wire when the time comes

| Need | Service | Credentials you would provide |
|---|---|---|
| Recall/follow-up reminders by SMS (AU numbers, alphanumeric sender ID) | **Twilio** | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` |
| Product analytics, *if* you outgrow the in-house funnel | **June** (B2B SaaS product analytics) | its API key — and it must be added to the sub-processor list and the DPA, and must receive no patient data |
| Payments (already chosen) | **Stripe** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |

My recommendation is to build the funnel in-house first (G7). A clinical product
should not add a fourth party holding usage data unless it demonstrably pays for
itself in the DPA and the practice questionnaire.

---

## 7. What not to build yet

- **A native mobile app.** The chairside flow and the phone *beacon* already cover
  the two shapes that matter.
- **Broad PMS integrations.** One deep integration beats five shallow ones; the
  second and third PMS connectors are a later decision, made with a paying
  practice funding them.
- **Self-serve enterprise signup.** Group practices need a conversation, a DPA and
  a security review; automating that mostly creates work for you.
- **More AI features before capture is settled.** The transcription review already
  showed the dominant accuracy limit is upstream capture (no diarization on live
  input, filled pauses dropped). More generation cleverness will not fix a tooth
  number that was never transcribed — measure, don't add.
- **A public "accuracy guarantee".** Do not put a number in marketing until the
  funnel (G7) gives you a real edit-rate baseline.

---

## 8. One-line version

The engine room is done and the compliance work is ahead of schedule; what is
missing is the storefront. Decide whether solo is free or $149, then build the plan
screen, stop selling seats you do not enforce, confirm the payment you took, and
instrument the funnel — and turn the recall interval already sitting in every note
into a worklist, because recovered production is what an owner pays for and
faster notes alone rarely is.
