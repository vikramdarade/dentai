# PR review — `feature/apple-medical-ui-and-monetization`

**Reviewed at:** branch tip `d096784`, base `main` @ `c5f82a6`
**Branch contents:** 2 commits, no divergence from `main` (fast-forwardable)

| Commit | Scope |
|---|---|
| `353d8d6` | `feat(billing): add practice monetization, self-serve billing, recall engine and seat management` |
| `d096784` | `feat(ui): elevate chairside operatory to Apple Medical Grade with FDI odontogram and dynamic audio island` |

**Diff:** 17 files, +1857/−113
**Measured against:** `docs/reviews/growth-and-monetization-review.md` (findings G1–G12, roadmap §5)
**Method:** static review plus the branch checked out and executed.
**Verification performed:** `bun tsc -b --noEmit` clean · `bun run test` → **351 passed, 22 skipped** (25 files) · plus targeted runtime probes of the new odontogram and recall logic and an ABN checksum check (evidence in §6).

> **There is no pull request.** `gh pr list --state all` returns four PRs and none is this branch; `gh pr view feature/apple-medical-ui-and-monetization` → *"no pull requests found"*. What exists is a pushed branch two commits ahead of `main`. Reviewing it as a PR is fine, but nothing is blocked in a review queue — it can be merged at any time, including by accident.

---

## 1. Verdict

This is a **genuinely good commercial PR with three things that must not ship as-is.** It closes the two worst findings in the growth review (there is now a way to pay inside the product; the free-solo promise is now the code's default) and adds the recall worklist, which was the single highest-value missing feature. The build is clean and the suite passes.

But it also (a) makes the paid plan's headline benefit — six seats — available free, so the seat enforcement it adds has nothing to enforce against; (b) puts a **fabricated ABN on a document labelled "TAX INVOICE"** and computes GST that Stripe never charges; and (c) ships a flagship clinical UI that reads ordinary prose ("16 weeks ago", "45 years old", "24 units") as FDI tooth findings and shows them back to the dentist as *"Identified in current consultation"*.

None of those are hard to fix. Two are one-file changes. The third is a deletion.

| | Count |
|---|---|
| Plan findings closed | 3 of 12 (G2, G8, G11) |
| Plan findings partially addressed | 3 (G1, G3, G6) |
| Plan findings untouched | 6 (G4-inert, G5, G7, G9, G10, G12) |
| New defects introduced | 4 high, 5 medium |

---

## 2. Conformance against the existing plan

### Closed ✅

**G2 — "There is no way to pay inside the product."** Fixed properly. `BillingModal.tsx` (435 lines) reads `/api/billing/status`, shows current plan, seat count, daily notes, a two-card comparison, and upgrades through `/api/billing/checkout`; `HistoryHub` gains a **Plan & Billing** button; the quota-exhausted path in `App.tsx` now opens the modal (`setShowBillingModal(true)` on 429/`QUOTA_DAILY`) instead of only explaining the limit. That last line is the highest-value change in the PR — the moment a dentist hits the ceiling is the moment to offer the upgrade, and it previously had no next step.

**G8 — "The revenue moat is half-built: recall."** `src/lib/recallEngine.ts` derives due dates from each note's `recallRequirements`, classifies routine / periodontal / urgent, sorts overdue-first, and `TreatmentPipeline` gains a **Patient Recall Worklist** tab with four metric cards, status filters, search, and a copy-to-clipboard patient reminder. Correctly implemented as *copy*, not auto-send — no patient contact is initiated, so no Spam Act 2003 consent question is opened yet.

**G11 — "Pricing is inverted against your own growth loop."** Practice is now A$149 for 6 seats (A$24.83/seat) with Solo free, so the individual advocate is no longer paying 2× the practice that adopts afterwards.

### Partially addressed ⚠️

**G1 — free solo vs A$149 solo.** The words now agree: `PLANS.solo.monthlyAudExGst = 0`, the landing page says "Free forever for solo practitioners and locums", the demo script already said it, and checkout refuses anything but `practice` ("Solo is free forever…"). **But the free tier the code actually gives a clinic is not `solo` — it is `trial`**, and nothing ever assigns `solo` (see defect N1). Details in §3.

**G3 — post-payment dead end.** Real progress: checkout `success_url` moves from `/#/dashboard?billing=success` (a route that does not exist) to `/#/billing?status=success`, `parseRoute()` recognises `billing`, and the modal shows a success or cancellation banner. **But the confirmation is a client-side string, not a verification.** It asserts "Payment received! Your Practice Plan is now active. Tax receipt sent to your email" purely because `window.location.hash.includes('status=success')` — it is true even if the Stripe redirect was replayed by hand, and it is false about the receipt (N2). Nothing polls for the webhook, so if `checkout.session.completed` has not landed when the modal first fetches, the same screen simultaneously shows the green "active" banner and "Solo Plan (Free Forever)". Confirmation should come from `/api/billing/status` after a short poll, not from the URL.

**G6 — hardcoded ROI with "Verified" claims.** A disclaimer was added under the scorecard ("*Illustrative practice recovery model based on average Australian ADA fee benchmarks…"), which is the right instinct. But the claims it disclaims are still there, so the page now contradicts itself: "**Verified** Recovered Production $18,400", "12 PMS-**verified** bookings", "$18,400 / 123.5x / 52.8%", "D4W #8491 **Verified**", and "Proves exact dollar yield recovered on the practice appointment ledger". Under the Australian Consumer Law and AHPRA's advertising guidelines a panel that says "Verified" next to an asterisk saying it is illustrative is worse than either claim alone — the disclaimer documents that the claim is unsourced. Delete the word "Verified" (and the D4W reference), or drive the panel from `/api/pipeline/roi`.

### Untouched ❌

- **G5 — the trial never ends.** Still no `trialEndsAt` anywhere; the trial plan still advertises "14-day evaluation" and the landing page CTA still says "Start 14-Day Free Evaluation", which now routes to ordinary sign-up. A deadline is the cheapest conversion mechanism a SaaS has and it is still absent — and it is now load-bearing, because "trial" is the free tier (N1).
- **G7 — no funnel instrumentation.** Unchanged: `/api/telemetry` retired, nothing durable recording signup → first note → first saved note → return → upgrade. Every judgement in this review is therefore an opinion.
- **G9 — PMS integration still inbound-only.** The copy/paste path is still the outbound path, and the cockpit's own PMS guide still tells the dentist to paste by hand.
- **G10 — you cannot charge money in Australia with these receipts.** Attempted, and now worse. See N2.
- **G12 — no first-run path or sample consultation.** Untouched.

---

## 3. Defects introduced by this PR, ranked

### N1 — 🔴 The free tier is `trial`, not `solo`, and `trial` grants the paid plan's six seats

**Evidence.** `PLANS.trial` is now `dailyNotes: 15, dailyTokens: 60_000, seats: 6` (`src/lib/plans.ts`). `PLANS.solo` is `15 / 60_000 / seats: 1`. A clinic with no subscription row resolves to trial — `resolveEntitlements()` returns `plan: 'trial'` for `no_subscription`, and the DB default is `tier TEXT NOT NULL DEFAULT 'trial'` (`src/lib/migrations.ts:187,343`). The only writer of `plan: 'solo'` in production code is `planFromMetadata(object, 'solo')` on a Stripe checkout event (`src/server/billing.ts:302,307,313`) — and checkout now *rejects* every plan except `practice` (`if (plan !== 'practice') return 400`). **So `PLANS.solo` is unreachable configuration.**

**Why it matters, in order of severity:**

1. **The seat enforcement added in this PR has nothing to enforce against.** A new practice gets six seats free; the A$149 Practice plan's headline "Up to 6 Clinician seats" is a limit they already have. The one lever this PR set out to build (G4) is commercially inert, and the only real upgrade trigger left is notes/day (15 → 200).
2. **The product contradicts itself on screen.** `BillingModal`'s Solo card promises "**1 Clinician seat**" two inches below a seat counter that reads "Clinician Seats: 1 of **6** active" (from `entitlements.seats`), and the owner can approve five more people. `ClinicMembersModal` will happily show "6 active seats" on the free tier.
3. **Marketing sells "Free forever" and delivers "Trial".** The landing page and the demo both promise free-forever solo; the entitlement a clinic is actually on is named Trial and advertises a 14-day evaluation that never expires (G5). The promise is met by accident, not design, and nothing downgrades anyone to `solo` ever.

**Fix (pick one, then make the copy match):**

- **Preferred:** make `trial` the 14-day, 1-seat evaluation it claims to be, and assign `solo` to every clinic without a paid subscription — i.e. signup/`ensurePersonalClinic` writes a `solo` subscription row, and a lapse or unpaid state resolves to `solo`, not `trial`. Keep `trial` for its stated purpose and add the expiry (G5).
- **Minimum:** set `PLANS.trial.seats = 1` so no clinic can be six free clinicians, and rename the free tier to Solo in every string. That alone restores the seat lever.

Also note `resolveEntitlements` returns trial for an unknown/garbage status by design ("being wrong in that direction costs a courtesy note") — that is the right instinct, but it means an unrecognised Stripe status silently grants six free seats.

**Test blindness to flag:** the branch's own `tests/billingSuite.test.ts` proves seat enforcement by hand-writing a `{ plan: 'solo', seats: 1 }` row into `data/subscriptions.json` — a state no code path produces. The test passes and the feature is untested in the configuration real clinics will be in. A test that asserts the *free tier's* seat count would have caught this immediately.

### N2 — 🔴 The tax-invoice path is fabricated: an invalid ABN, GST that is never charged, and an email that is never sent

Three separate problems that compound into "the invoice you promise is both non-existent and wrong".

**(a) The ABN fails its own checksum.** `src/server/email.ts:233` defaults to a hardcoded `'83 671 294 102'`, and the same number is repeated to the customer in `BillingModal.tsx:425` ("DentAI invoices are issued under ABN 83 671 294 102"). The ABN check (weighted modulus 89) gives:

```
ABN 83 671 294 102 → weighted sum 355, mod 89 = 88 → INVALID
```

A tax invoice carrying an ABN that fails validation is not a tax invoice; it will be rejected by any practice's accounts-payable process, and `src/components/LegalPage.tsx:19` still says `'ABN to be inserted before commercial use'` — so the PR simultaneously states that the ABN is not yet set and prints a specific one. Both cannot be true.

**(b) The GST figure does not match the charge.** Checkout still builds the line item inline as `unit_amount = definition.monthlyAudExGst * 100` → **A$149.00 charged**, with no `automatic_tax`, no `tax_behavior` and no Stripe Prices (`src/server/billing.ts`). The new `receiptEmail()` then computes `gst = amount * 0.10` and prints:

```
Subtotal: A$149.00 (ex GST) / GST (10%): A$14.90 / Total Paid: A$163.90 (inc GST)
```

The customer paid A$149.00; the document says they paid A$163.90. The landing page and the modal repeat the same claim ("$149 AUD / month ex GST ($163.90 inc GST)"). So either the price is really A$163.90 inc GST and you are **under-collecting A$14.90 of GST per month** (which you must remit regardless), or the invoice is false. An Australian B2B tax invoice must show the GST amount *payable on the supply* and be marked as a tax invoice; this one does neither correctly.

**(c) The receipt is dead code.** `grep -rn "receipt" server.ts src/server/billing.ts src/server/stores.ts` → **no matches**. `receiptEmail` is exported and never called; the billing deps do not receive an emailer (`emails` is not wired into `registerBillingRoutes`). So while the landing page sells "Monthly Australian B2B Tax Invoices (ABN & 10% GST)" and the modal's success banner says "Tax receipt sent to your email", **no invoice email exists**. The only real artefact a customer can get is the Stripe billing-portal link, which this PR did correctly add (`POST /api/billing/portal`, owner-only, audited).

**Fix:** real Stripe Products/Prices with Stripe Tax enabled for AU (which also buys you promo codes and price history, both currently impossible); charge A$163.90 inc GST (or make A$149 inc GST and say so); take the ABN from configuration — not from source, and never with a default — and fail closed with an operator error when it is unset; and either send the invoice email from the webhook (`invoice.paid`, linking Stripe's hosted invoice URL) or delete `receiptEmail` and the two claims that depend on it. Do not ship a "TAX INVOICE" string until a real invoice backs it.

### N3 — 🔴 The new odontogram reads ordinary speech as tooth findings

`ChairsideOdontogram.tsx` detects teeth with `/\b([1-4][1-8])\b/g` over the transcript plus the SOAP objective/assessment, and renders whatever it matches as clinical findings: a pulsing dot per tooth, a badge reading "**N tooth findings live**", and a selected-tooth bar reading "**Identified in current consultation**".

I ran the regex against ordinary chairside sentences:

| Transcript | Flagged as FDI teeth |
|---|---|
| "I saw you about **16** weeks ago and your blood pressure was 120 over 80" | 16 |
| "The patient is **45** years old and we took **42** minutes" | 45, 42 |
| "She returns in **21** days, we billed **24** units at **15** percent" | 21, 24, 15 |
| "Give it 30 seconds, then take the **11th** and **12th** instruments, tooth 16 needs a crown" | 16 |

Every one of those highlights a real tooth in a clinical diagram and tells the dentist it was identified in the encounter. This is the **same defect class removed from `transcriptGrounding.ts` in the accuracy work** — a bare 2-digit number is not an FDI tooth number — reintroduced here with no guard at all.

It is worse than the grounding case in one respect: `onSelectTooth` calls `handleAppendTranscriptText(\`Tooth ${fdi}: \`, 'Dentist')` (`ChairsideWorkspace.tsx:2401`), which **writes into the transcript as a dentist statement** — the source the note generator treats as authoritative. So a mis-lit tooth is one tap away from entering the clinical record as something the dentist said, with no clinical content attached.

**Fix:** require an explicit introducer (`tooth 16`, `FDI 16`, `#16`) or an FDI number with a surface/quadrant word, exactly as `transcriptGrounding` now does; drop the `phraseMap` entries that map a general phrase ("wisdom tooth") onto one specific tooth (18) — that is an invented finding; label the strip as "teeth mentioned in this conversation" rather than "findings"; and make the tap insert a complete phrase or nothing. Also note the false-light state is what invites the tap in the first place — the UI's own noise creates the contamination path.

### N4 — 🟠 A purchased seat count that outlives the purchase, and a plan read from the wrong clinic

Two server-side defects in the same feature.

**Seat checks bypass `resolveEntitlements`.** `server.ts:2733` reads the plan straight off the subscription row:

```js
const planId = (subscription?.plan as PlanId) || 'trial';
const planDef = PLANS[planId] || PLANS.trial;
```

This ignores `status` and `currentPeriodEnd`, so a `plan: 'enterprise'` (100 seats) subscription that is `unpaid` or past its paid period still grants 100 seats — while the *metering* path for the same clinic has already correctly downgraded to trial via `entitlements.resolve()` (`server.ts:248`). The plan module exists precisely to stop the two disagreeing; use `PLANS[entitlements.plan].seats` (or `isSeatAvailable(count, entitlements.plan)` — the helper this PR added, which is currently used only by tests).

**Billing resolves the owned clinic, not the active one.** `ownedClinic()` (`src/server/billing.ts:444`) picks the first clinic where the caller has `role === 'owner'`. `/api/billing/status`, `/checkout` and `/portal` all use it, and the client never sends the active clinic. A dentist who owns two practices and switches to the second in `ClinicSwitcher` sees the first practice's plan, seats and Stripe customer — and `BillingModal` mixes the two: plan and entitlements from the *owned* clinic, member count from the *active* clinic (`fetch(\`/api/clinics/${activeClinic.clinicId}/members\`)`). Multi-clinic is a shipped feature, so this is reachable today. Separately, `HistoryHub` shows the **Plan & Billing** button to every member of a clinic, so an associate gets a red "Only the practice owner can view billing" error instead of no button.

### N5 — 🟠 The recall worklist cannot report success, and invents the interval it reports

`src/lib/recallEngine.ts` is clean, pure and tested — the right shape. Four behavioural problems:

1. **One row per consultation, not per patient.** `extractRecallItems` iterates `consultations` and creates an item per note. A patient seen three times in the loaded history appears three times, with three due dates, and the "Active Patient Recalls" card counts consultations. That number is presented as the practice's recall opportunity.
2. **Nothing can ever be completed.** There is no contacted / booked / attended / dismissed state, and no persistence — the list is recomputed from the note history on every render. Every past recall is therefore permanently overdue, the "Overdue Recalls" count can only ever grow, and the practice can never demonstrate improvement. A metric that cannot move is worse than no metric, and this one is next to a "revenue recovery" narrative.
3. **It invents the interval it displays.** `c.findings?.recallRequirements || '6 Months (Standard)'` — a consultation with no recall plan gets a fabricated 6-month interval, which the worklist then renders as "Recommended Interval: 6 Months (Standard)". That is the same class of invented clinical data removed from the note pipeline earlier in this project, now reintroduced on a clinical worklist.
4. **Two date bugs.** `calculateRecallDueDate` falls back to `new Date()` when the consultation date is missing or unparseable (an invented due date); and `setMonth` overflows month-ends, verified: `2026-08-31 + 6 months → 2027-03-03`, `2026-03-31 + 6 months → 2026-10-01`.

Also worth noting: the tab badge counts every item as an alert ("Patient Recall Worklist" with an `N` and a pulsing dot), the list is derived only from the consultations the client has loaded (so "practice-wide worklist" is an overstatement unless the owner's export path is what loads them), and the two metric cards claim work the code does not do ("Current recall outreach target", "High-compliance clinical protocol") — there is no outreach.

### N6 — 🟡 The Apple type stack has no fallback where Australian practices actually work

`src/index.css` replaces the `Outfit` stack with `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro", "Inter", -system-ui, sans-serif`, but nothing loads `Inter` — and `index.html:9` **still downloads Outfit from Google Fonts**, which is now referenced by no rule. On macOS `-apple-system` resolves to SF Pro and the PR looks as intended. On **Windows and Linux** — which is where Dentrix, Eaglesoft and Exact practices live — every family in the list is unavailable, so the entire application falls through to generic `sans-serif`: the app silently re-typesets itself on the majority of practice machines, and pays for a webfont it does not use. (`-system-ui` is also an invalid family name; the CSS keyword is `system-ui`, so that entry is skipped.)

**Fix:** keep the Apple look, add a real fallback — e.g. `… "SF Pro Text", system-ui, "Inter", "Segoe UI", Roboto, sans-serif` with Inter self-hosted — or keep Outfit as the fallback and load the SF stack ahead of it. Then remove the now-dead Outfit download (or put it back in the stack).

### N7 — 🟡 Contrast dropped across the app, and fails in the small labels

`--color-primary` moved from `#0F52BA` to Apple blue `#0071E3`. Measured on white: **7.15:1 → 4.70:1**. That still clears AA for normal text, but the pairing actually used in four places — `bg-primary-light text-primary` (`ClinicMembersModal.tsx:371`, `HistoryHub.tsx:349`, `Landing.tsx:222,745`), the first at `text-[9px]` — now measures **4.20:1 on `#EBF3FD`**, below the 4.5:1 AA threshold, where the old palette passed. The new surgical teal `#00A389` on the odontogram's active-tooth tint measures **2.86:1**, under the 3:1 minimum for meaningful graphics (that is the icon beside the tooth number, not the number itself, which uses the darker `#007A66` at 4.74:1).

Small fixes: darken the teal one step for icon use, and give those four label pairings a slightly deeper text or tint.

### N8 — 🟡 Smaller items, all verifiable

- **Permanent spinner with no clinic.** `BillingModal.loadBillingStatus` starts `if (!activeClinic) return;` **before** `finally { setLoading(false) }`, so with no active clinic the modal shows "Checking practice subscription…" forever and no error. (In practice the effect re-runs once clinics load, so this bites when the clinics fetch fails or the dentist has no membership.)
- **Fabricated operatory.** The patient hero renders `{activeEncounter.operatory || 'Chair 1'}` and presents it as bold structured data. If the encounter has no chair assigned, the record header asserts Chair 1. Prefer "Unassigned" — same reason the note pipeline no longer invents a DOB or practitioner.
- **Practice price cut 75% without a stated target.** A$399 → A$149 for the same six seats and 200 notes/day, *and* the trial allowance rose 10 → 15 notes/day, *and* solo became free. Each is defensible (the recorded demo already said $99–149), but together they need ~2.7× the practice count to hold revenue, and there is no measurement in place to see whether that happens (G7). Decision worth writing down.
- **Carried over, not introduced:** when `DENTAI_DAILY_NOTE_LIMIT`/`_TOKEN_LIMIT` is set, the resolver *overrides* the plan allowance rather than taking the `min()` that `docs`/`plans.ts` documents (`src/server/billing.ts:113-116`). Now that the paid plan advertises 200 notes/day, an operator cap silently downgrades a paying practice. Either implement the documented `min` via `effectiveDailyLimits()` or correct the comment.
- **`isSeatAvailable()`** is exported and used only by tests; the enforcement path re-implements the comparison inline. Use the helper.

---

## 4. What is genuinely good in this PR

- **The quota moment now sells.** Opening the billing modal on `QUOTA_DAILY` is the single most commercially valuable line in the diff.
- **Billing portal route** is done right: owner-only, 404 when there is no Stripe customer, 503 when unconfigured, 502 on Stripe failure, and `billing_portal_opened` is audited. Cancellations and card updates no longer need the founder.
- **The plan module is respected elsewhere.** `resolveDailyLimits` → `entitlements.resolve()` → `effectiveDailyLimits` is the correct chain, and the free/paid boundary it implements is honest (anything not clearly paid-for resolves to the trial allowance).
- **Recall engine is pure, tested and separate from the UI** — due-date arithmetic, urgency classification and status thresholds are unit-tested, including the ">14 days past = overdue" boundary.
- **No patient contact is initiated.** Reminders are copied to the clipboard for the practice to send through its own channels. That avoids opening a Spam Act 2003 / consent problem, and it is the right first step.
- **The cockpit work is disciplined.** The odontogram and the rest of the Apple Medical restyle are additive: no hook was added conditionally, no provider or router change, `@theme` tokens and the semantic surface variables were extended rather than replaced, and `.font-tabular`/`.glass-apple` are defined in CSS rather than invented as Tailwind utilities. Typecheck and 351 tests pass.
- **Build state:** nothing here threatens the deploy — no new dependency, no config change, no backend migration (`dbCountActiveMembers` reads an existing table).

---

## 5. Sequencing to make this mergeable

1. **N1** — decide the free tier (1 seat, or `solo` assigned at signup) — it makes the seat feature real and fixes the on-screen contradiction. One or two files.
2. **N2** — remove the "TAX INVOICE"/ABN/GST claims until a real Stripe invoice exists; move the ABN to config with no default; wire or delete `receiptEmail`. A deletion is acceptable and safe; a false tax invoice is not.
3. **N3** — tighten the FDI matcher and downgrade the label from "findings" to "teeth mentioned". Small, and it removes a clinical-accuracy claim from the flagship screen.
4. **N4/N5** — resolve seats through `resolveEntitlements`, key billing to the active clinic, dedupe/track recall state, stop defaulting the recall interval.
5. **G6** — delete the remaining "Verified" strings on the landing page (the disclaimer then becomes accurate rather than a confession).
6. **N6/N7** — fix the font fallback (Windows is the majority of the AU market) and the two contrast tokens.
7. Still open from the plan and worth doing next: **G7** (funnel, derived from `usage_events`/`audit_logs`) and **G5** (trial expiry), because without G7 you cannot tell whether any of the pricing decisions above worked.

---

## 6. Evidence appendix

```
# branch scope
git fetch origin feature/apple-medical-ui-and-monetization
git merge-base origin/main FETCH_HEAD            # c5f82a6 (== origin/main, no divergence)
git diff --stat origin/main...FETCH_HEAD         # 17 files, +1857 −113

# no PR exists
gh pr list --state all
gh pr view feature/apple-medical-ui-and-monetization   # no pull requests found

# build + suite, on the branch
bun tsc -b --noEmit                              # exit 0
bun run test                                     # 351 passed | 22 skipped (25 files)

# ABN checksum
ABN 83 671 294 102 → weighted sum 355, mod 89 = 88 → invalid

# odontogram FDI detection, regex from ChairsideOdontogram.tsx
"16 weeks ago, blood pressure 120 over 80"      → [16]
"patient is 45 years old, took 42 minutes"      → [45, 42]
"returns in 21 days, billed 24 units, 15%"      → [21, 24, 15]

# recall month arithmetic
2026-08-31 + 6 months → 2027-03-03   (expected ~2027-02-28)
2026-03-31 + 6 months → 2026-10-01   (expected ~2026-09-30)

# receipt email is never sent
grep -rn "receipt" server.ts src/server/billing.ts src/server/stores.ts   # no matches

# contrast (WCAG, on white unless stated)
#0071E3 4.70   #0F52BA 7.15   #0071E3 on #EBF3FD 4.20   #00A389 on #E6F6F4 2.86
```

**Not verified:** the Postgres paths (no `DATABASE_URL` in this sandbox — the 22 skipped tests), Stripe behaviour against live keys, and the rendered UI (no preview was started, so the Apple Medical layout, the odontogram's real behaviour with a live transcript, and the modal's spinner state were reviewed as source and logic, not as pixels).
