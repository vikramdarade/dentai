# Funding path for a solo founder

> **Correction (added after the memo's provenance was clarified).** The "VC memo" was **Antigravity role-playing a VC partner** — it is not a real investor's verdict. An earlier version of this document treated its "$750K SAFE today" as an offer on the table. **It is not an offer, and there is no cheque.** §0 and §6 below have been rewritten accordingly.
>
> What survives is everything that was **checked against the code** — those findings are facts about this repository regardless of who wrote them, and they are the same findings a real reviewer would reach. What does not survive is the **market verdict**: the TAM, the CAC, the DSO-distribution and PMS-gatekeeper assertions are an LLM's confident prior, not evidence.
>
> Read the rest of this document as an **internal roadmap**, not as a term sheet.

**Written against** `main` @ `027a934`. Every number below is derived from a file in this repo or arithmetic on one, and the derivation is shown so it can be checked.

---

## 0. What an AI-roleplayed VC is actually good for

Told to be a VC, an LLM produced a confident, structured, well-formatted verdict. It also, within minutes, made four **factually false** claims about this codebase — that consent stamping is mandatory, that retention purges are automated, that the AU data boundary is sovereign, and that recovered production is tracked on the practice's ledger. It repeated your demo script back to you as a strength.

That is not a reason to discard the exercise. It is the most useful thing in it, because **a real reviewer will do exactly the same thing.** They will read the landing page, the demo script and the docs, believe them, and form a view — or they will check, and find them false. The roleplay is a **diligence rehearsal**, and it failed in an instructive direction: it believed your materials.

Three consequences, in order of importance:

1. **Your materials are the attack surface, not your code.** The rehearsal got four claims wrong because the *documents* assert them. Fix the documents and the rehearsal's verdict changes; leave them and the next reviewer reaches the same place with more at stake.
2. **Do not take this memo to a real investor.** It is full of claims your code contradicts. If they check — and a good one will — you are negotiating from a false position on the first meeting.
3. **The three conditions are still the right business milestones.** Reprice, one real PMS bridge, prove the recall number from a practice's own books. They are correct because they are correct, not because a fictional partner demanded them. The difference is that you now do them on evidence, on your own schedule, and without a deadline invented by a roleplay.

**What the rehearsal cannot tell you, at all:** whether a real investor would fund this, what a dental practice will pay, how the DSO channel behaves, or what Australia's TAM is. Those require real conversations, and no amount of prompt engineering substitutes for them.

---

## 1. The memo's "two structural economic flaws" are not both real — and one is unproven in a way that helps you

The memo says it would fund if you "fix two structural economic flaws": pricing, and gross margin.

### 1.1 The margin flaw is a genuine risk, and the arithmetic is in your own repo

Nobody has the answer. The repo asserts **"1–3 cents per appointment"** (`docs/reviews/vc-investment-review.md:161`) with no derivation, and that document is also stale — it describes the free tier as "60k tokens" while `plans.ts` now says `150_000`. The memo asserts **"margins collapse below 60%"** with no derivation either. **Two unsourced numbers pointing opposite ways.**

What *is* checkable is that your plan's two caps disagree with the code's own capacity statement:

| Source | Value |
|---|---|
| `plans.ts:83` — `dailyNotes` | 200 notes/day |
| `plans.ts:85` — `dailyTokens` | 2,000,000 tokens/day |
| **Implied budget per note** | **10,000 tokens** |
| `PROJECT_CONTEXT.md:104` — documented capacity for one long appointment | **up to 75,000 tokens** |

So a single long appointment can consume **7.5× the per-note token budget the plan assumes**. At the documented ceiling, the practice plan's *effective* allowance is ~26 notes/day, not the 200 it advertises. The memo's own assumption (25–30k tokens/consult) sits 2.5–3× above your plan's assumption and below your code's ceiling.

**This is the whole margin question, and it collapses to one multiplication:**

```
tokens per note  ×  your blended model price per token  ×  notes per month
                 =  cost of goods per clinic per month
```

You already shipped kind-aware token metering (PR #5) — `getTokensUsedToday` runs per clinic per day and `dailyTokens` is enforced. So **one week of real pilot usage produces the actual number**, and the argument ends.

> **Do this before you reprice, not after.** The price is the output of this calculation, not an input.

### 1.2 The pricing flaw is correct, and it is the easy one

Confirmed in `plans.ts:80-94`: flat `A$149` for up to 6 seats = **A$24.83 per clinician per month**. The memo is right that this reads as a toy price for clinical infrastructure, and right that revenue must scale with the practice.

But note the sequence: **reprice *after* you measure §1.1.** If your cost per note turns out to be 0.4c, you can defend A$99–149/chair. If it turns out to be 12c at the long-appointment ceiling, the correct answer is a chair price *plus* an explicit token allowance in the contract — and you'd rather know that before signing five clinics at the wrong number.

### 1.3 Correction: the memo's three conditions are not equally shippable by one person

Ranked by **what you control**, **what a VC accepts as proof**, and **what you can do while being the only engineer**:

| Memo's condition | Risk | What it actually is | Who owns it |
|---|---|---|---|
| Reprice per chair | Low | A day of code in `plans.ts` — gated on §1.1 | You + agents |
| Prove the recall ledger in 5 clinics | **Mis-specified — and that helps you** | See §2 | You, with no engineering |
| Close 1 real PMS integration | High | **BD with an engineering tail** | A partner clinic's willingness |

The memo hides the PMS cost. It says "pick Cliniko or a D4W/EXACT bridge" as though those were equivalent:

- **Cliniko** — REST API, documented, feasible. This is the realistic one.
- **D4W / EXACT** — desktop Windows installs, hostile gatekeepers, API tariffs. This is a **partnership negotiation**, not a sprint. It took Henry Schein decades to become the gatekeeper; you do not out-negotiate them as a solo founder on a pre-seed.

And both require something you don't have: **a partner practice willing to grant API access.** That is a sales conversation, and it is the honest reason the pre-seed exists.

---

## 2. The condition you can close without writing code

The memo's condition 3 — *"Show me 5 practice owners who testify: 'DentAI's recall roster recovered $8,000 in appointments this month that our front desk forgot to call.'"*

**You cannot prove this with the software.** I verified it: `recallEngine.ts` contains no monetary value at all (due dates, urgency, a message string), and the dollars come from `GET /api/pipeline/roi` (`server.ts:3866-3946`), which sums **the AI's `estimatedFee`** for items **the clinic itself** marked `booked`, and divides by `const subscriptionCost = 149` — a hardcoded constant. "PMS-verified" means a human **typed** an appointment ID into a modal.

But here is the thing the memo missed and you should not: **you don't need the software to prove it.**

> One friendly practice. Their recall list as it exists today. You or their receptionist makes the calls for four weeks. Count the bookings. Read the dollars off **the practice's own ledger** — not your product's estimate.

That is ~4–6 weeks of phone calls, **zero engineering**, and it produces exactly the artifact the memo asked for in the form it will actually believe: a number that came from the practice's books. It is also simultaneously:

- your first **paid case study**,
- your first **testimonial quote**,
- your first **retention proof** (the practice won't churn after it sees its own ledger),
- and the **only honest ROI number you will ever be able to put on the landing page.**

It is the highest-value thing on this list and it costs you no code.

---

## 3. The highest-leverage single change: fix edit rate

Here is the connection the memo missed, and it is the reason to do this first.

The memo evaluates you on **edit rate per note ≤ 12%**. The pilot dentist's feedback was **"notes were not accurate."** These are the same question. And I verified that today **the metric cannot answer it**:

- The note worker persists with **no `revisions` field at all** (`server.ts:1519` — direct `dbInsertConsultation`).
- The clinician's **first** save appends revision #1 → `revisions.length === 1` (`recordGovernance.ts:237-249`).
- The funnel counts `length > 1` (`server.ts:878`) → **not an edit**.

So a dentist who deletes the entire AI draft, rewrites it, and signs reports an **edit rate of 0%** — on the memo's own scale, "indispensable, under 10%."

That single line is why:

1. You cannot tell the pilot dentist whether accuracy actually improved.
2. You cannot tell the VC the number they will ask for first.
3. If you *do* show them a number before fixing it, it will be a flattering fabrication — and **the first thing a technical diligence person does is try to falsify your headline metric.**

**Fix edit rate and you fix the pilot, the diligence, and the roadmap at once.** Compare the saved note against the generated draft (or count `>= 1`), and you finally know whether the product works.

---

## 4. The asset you are undervaluing — and it is currently false

The memo's §1A calls the compliance layer a moat and lists four things as built. I verified all four, and **three are off or soft by default**:

| Claim | Reality |
|---|---|
| "Mandatory consent stamping" | `DENTAI_REQUIRE_CONSENT` defaults **off** (`server.ts:402`) |
| "Automated retention purges" | **Off** unless enabled; dry-run otherwise (`retentionPolicy.ts:43`). `configCheck.ts:137` admits the 7-year notice promise "stays unexecuted" |
| "Sovereign AU data boundaries" | **A default, not a control** — `GCP_REGION \|\| 'australia-southeast1'`, with a **global endpoint fallback** (`server.ts:532-536`) when `GCP_PROJECT_ID` is unset. Not `fatal`, so the app boots and runs non-AU |
| "Append-only cryptographic revision chaining" | True (real SHA-256 chain) — but the module's own header says tamper-*evident* only, and detection needs the chain head **witnessed off-platform**, which **no code path does** |

**This is your fastest route to a credible pre-seed, and it is entirely within your control**: no clinic's permission, no partner, no negotiation. Roughly two weeks of code turns

> "we have compliance features"

into

> "we can prove who accessed which record, in an Australian region that the application refuses to leave, under a consent gate that cannot be bypassed, with a tamper-evident chain whose head we publish daily."

That last sentence is what a DSO's procurement questionnaire asks for, and it is a **defensible** pre-seed story — because a legacy PMS vendor building a mediocre built-in scribe **will not build it.** It is also the one thing the memo praised, so closing it converts the memo's weakest pillar into its strongest.

---

## 5. The plan

### Days 1–14 — make the claims true (no external dependency)
1. **Fix edit rate** (§3). Highest leverage on the list.
2. **Make the compliance claims real** (§4): `GCP_PROJECT_ID` fatal in production + refuse the global fallback; consent on by default; retention enabled; witness the audit-chain head.
3. **Fix `upgraded`** (`server.ts:897`) — it currently counts the **free** `solo` plan as a paid upgrade, so every funnel chart overstates conversion.
4. **Delete the fabricated demo-script claims** (`demoScript.ts:215-217`): "verify bookings directly in D4W, EXACT, or Cliniko" and "**over 100x return on investment**" — false (there is no integration; the ROI denominator is a hardcoded `149`). A demo script is *spoken aloud* to a pilot dentist. This is the claim most likely to end a relationship.
5. **Rename the ROI labels** — "Verified Recovered Revenue" / "PMS-verified" describe a self-reported number with a human-typed ID. Call it "Reported booked value" until there's a real link.

### Days 15–30 — measure, then price
6. **Run the arithmetic in §1.1** on real pilot usage. One multiplication.
7. **Reprice** on that evidence: per-chair above the base, token allowance stated in the contract.

### Weeks 4–10 — the proof that needs no code
8. **The manual recall ledger** (§2), one practice, their own books.
9. **Fix note quality until edit rate is defensible** — the pilot dentist's actual complaint. You now have the instrument.
10. **One Cliniko pilot** — one practice willing to grant API access. Treat it as BD, and start the conversation in week 4, because it is the longest lead time.

### In parallel, from day 1 — the non-code items only you can do
These are on the critical path and no agent can touch them: **ABN/GST registration and an accountant** (the tax invoice path now sends real Stripe figures, but a human must confirm what you're registered to charge); **Stripe live activation**; **insurance that actually covers clinical software**; a **privacy policy + DPA + data-flow map** that match the *fixed* code rather than the intended code; and **dentist conversations** — which is the only thing on this list that compounds.

---

## 6. What to say to a real investor — a memo template

**First: do not send them the roleplayed memo.** It asserts four things about this product that its own code contradicts, and a reviewer who checks will find them. Lead with your numbers instead.

What survives from the rehearsal is a useful shape: **state where each of the real milestones stands, with a source for every number.**

> *1. Unit economics — measured cost per note is [X] (tokens/note × model price × notes/month). The plan's two caps currently imply 10,000 tokens/note while the transcript path allows up to 75,000, so the per-clinic allowance is now stated explicitly in the contract.*
> *2. Pricing — [per-chair] model, from [date], because the flat rate worked out to ~A$25 per clinician per month.*
> *3. PMS — the honest answer is that this is BD, not a sprint. D4W/EXACT are desktop gatekeepers; Cliniko is reachable and the conversation with [practice] is at [stage]. Today the product exports via a PMS-formatted clipboard, and I am not going to describe that as an integration.*
> *4. Recovered revenue — I am not going to prove this with my own software, because our ROI figure is a self-reported estimate divided by a hardcoded constant and you would be right to discount it. Here is one practice's real recall list, the calls made, and the bookings read off their own ledger: [A$X].*
> *5. Accuracy — our edit rate is measured properly at [Y]%. Clarify whether this means 'edited at all' or 'edited after review'; the instrument currently tracks the former.*
> *6. Compliance — consent is now enforced, retention is enabled, generation cannot leave the AU region, and the audit-chain head is published daily: [link].*

The difference between this and the roleplayed memo is that **every line is checkable**, and none of it requires the reader to trust a claim about a ledger nobody has looked at.

That is a fundable update, because **every number in it has a source**, and it pre-empts the two places a diligence process would have caught the gap.

---

## 7. What will lose you the money

1. **Showing the funnel before you fix it.** Edit rate reads 0% for a clinic that rewrites everything; `upgraded` counts free clinics. A diligence person's job is to break your headline number.
2. **Saying "sovereign AU data"** while `GEMINI_API_KEY` remains the fallback. One question about regions and the answer is on file.
3. **Saying "mandatory consent" or "automated retention."** Both off by default. In an Australian health context this is the sentence a clinic's lawyer circles.
4. **Letting the demo script's "100x ROI" reach a dentist.** If their ledger doesn't show it — and it won't — that's the trust event that closes clinical companies.
5. **Chasing the Series A.** The memo already told you it's a sales-organisation test. You have no sales organisation. Raise the check that buys one.
6. **Confusing surface for evidence** — the memo's own error, and the easiest to inherit. A billing module, a recall engine and an ROI endpoint looked like a revenue story; the ROI is a self-report over a hardcoded constant.

---

## 8. The one-line version

**You do not currently have a funding problem; you have a measurement problem.** The memo is describing a company that has not been measured yet, using metrics that would today agree with it. Fix the instrument (days), measure the unit economics (a week), make the compliance claims true (two weeks), and prove the recall ledger by hand from one practice's books (six weeks, no code) — and you have the pre-seed the memo already offered, on evidence instead of assertions, while it buys the distribution function that a solo founder cannot be.
