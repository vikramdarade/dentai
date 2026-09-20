# Claims corrections — applied, and two patches still pending

**Branch:** `fix/billing-gst-governance-hardening` @ `936b477`. **Base:** `main` @ `027a934`.
**Scope:** make every user-facing and investor-facing assertion match what the code actually does. No clinical behaviour changed.

**Verified after the changes:** `tsc -b --noEmit` clean · full suite **383 passed / 22 skipped** (was 379 — the four new guard tests) · the new guard was proven non-vacuous by reintroducing a claim and watching it fail.

---

## 1. What was fixed

### 1.1 The demo script — the claims that were spoken aloud (`src/demo/demoScript.ts`)

The worst offender, because a demo script is read *out loud* to a dentist or an investor. It asserted three things that are false:

| Was | Reality |
|---|---|
| "verify bookings **directly in Dental4Windows, EXACT, or Cliniko**" | No PMS integration exists. The whole surface is `formatNoteForPmsClipboard` and a "Copy for PMS" button |
| "tracks **verified recovered production on your ledger**" | The figure is the sum of fees *we* estimated, for items *the practice* marked booked |
| "proving **over 100x return on investment**" | Was computed against a hardcoded `149` |

Rewritten to state the mechanism and name the source of the number, and the scene title dropped "PMS Sync". The chairside scene's **"save 15 to 20 minutes per procedure / up to two hours a day"** was removed too — there is no measurement behind it, and the only pilot feedback on record is that generation was *slow*. Each rewritten block carries a comment explaining why, so it is not "tidied back" later.

### 1.2 The pipeline labels (`src/components/TreatmentPipeline.tsx`)

- "Booked Production" under a comment reading *Verified Recovered Revenue* → **"Booked Production (reported)"**, with a line under it: *"Estimated fees for the items your team marked booked. Reconcile against your own ledger."*
- "**N** PMS-verified appointments" → **"N with a PMS appointment reference"**. The count also had a real bug: it fell back to `o.status === 'booked' || o.status === 'completed'`, so it labelled *unreferenced* entries as PMS-verified. It now counts only entries carrying a PMS field.
- Modal heading "PMS Appointment Verification" / "Lock verified revenue onto practice ledger" → "Record PMS Appointment Reference" / "Record the booking against this treatment item". The step is a human typing an appointment ID, and the copy now says so.

### 1.3 The public landing page (`src/components/Landing.tsx`)

| Was | Now |
|---|---|
| "Closed-Loop Revenue Recovery Engine" | "Treatment Pipeline & Recall Worklist" |
| "Turn unbooked chairside treatment into **verified practice revenue**" | "…into **treatment you can follow up**" |
| "**Universal PMS Bridge** … cloud PMS webhooks **automatically update booking status**" | "**PMS-ready export** … There is **no direct PMS integration** — your team pastes the note, and records the booking here" |
| "Practice Treatment & Recall **Ledger**" | "Practice Treatment & Recall **Worklist**" |

The `/api/webhooks/pms-booking` endpoint does exist — but nothing is configured to call it, so "webhooks automatically update booking status" described a capability no clinic has. The new copy is also *more useful* to a buyer: it says what the front desk actually does.

### 1.4 The privacy notice and the legal/ops records

- **`src/components/LegalPage.tsx`** told patients records are retained "and then deleted or de-identified." Deletion is **manual** today (see below). Now: *"Deletion or de-identification at the end of that period is carried out on request, not automatically."* This is the one clause with regulatory weight, not marketing weight.
- **`docs/legal/retention-and-deletion.md`** — added an *Enforcement state* section quoting `configCheck.ts`'s own words ("the 7-year retention promise in the privacy notice stays unexecuted; the sweep only reports") and the manual procedures to use until the sweep is on.
- **`docs/legal/data-flow-and-subprocessors.md`** — the table implied the global Gemini endpoint was only a *failure* fallback. It is the **primary path whenever `GCP_PROJECT_ID` is unset**, which the app does not prevent. Corrected, plus a note that the AU region is a setting rather than a control, and the sub-processor register row now says so. (The `GEMINI_FALLBACK_API_KEY` row was accurate and is untouched.)
- **`docs/operations/environment-reference.md`** — `DENTAI_REQUIRE_CONSENT` now states the **default is off** and that a consented-less transcript is still written; `GCP_REGION` now states it is ignored without `GCP_PROJECT_ID`; the retention variables were **missing entirely** and are now documented with their defaults.

### 1.5 The funnel's conversion count (`server.ts:897`)

`upgraded` counted any active plan except `trial` — which made **free Solo** clinics count as revenue conversions. Now excludes both free plans. Deliberately a free-plan blacklist rather than a `price > 0` test: `enterprise` (Group) is quote-priced at `0` in `PLANS`, so a price filter would have silently dropped real revenue.

### 1.6 A guard so they cannot come back (`tests/productionHardening.test.ts`)

The existing guard covered `Landing.tsx` only. Extended (4 new tests) across `Landing.tsx`, `LegalPage.tsx`, `demoScript.ts`, `TreatmentPipeline.tsx`:

- no PMS-integration claim (`verify bookings directly`, `PMS Bridge`, `PMS Sync`, `automatically update booking status`, `two-way sync`)
- no self-reported figure presented as verified (`Verified Recovered Revenue`, `PMS-verified`, `on your ledger`, `verified practice revenue`)
- no ROI multiple in copy
- no promise of automatic deletion

The guard **strips comments** before matching, so a comment may explain why a claim was removed without tripping itself — that is exactly how it failed the first time, and the fix was the right way round.

---

## 2. Found but NOT fixed — a real finding

### 2.1 The same fabricated constants live in the demo **visuals**

`tests/productionHardening.test.ts` bans `$34,800`, `$18,400` and `123.5x` from `Landing.tsx`. All three are alive in **`src/demo/Scenes.tsx`** — the on-screen half of the demo:

```ts
// src/demo/Scenes.tsx:1847-1849
const card1Val = Math.min(34800, Math.floor(progress * 4 * 34800));
const card2Val = progress > 0.25 ? 18400 : 0;
const roiVal   = progress > 0.25 ? '123.5x' : '0x';
```

and rendered alongside:

- `:"9 verified in PMS"` (`:1928`) and `:"✓ D4W #8491 Verified"` (`:1985`) — again, a verification that does not happen
- `:"Sync to D4W"` (`:2058`), `:"Universal PMS Bridge"` (`:1888`), `:"Revenue Engine & PMS Sync"` (`:1878`), `:"D4W · EXACT · Cliniko Verified"` (`:1893`)
- `:"+$15k–$30k"` (`:1547`), `:"15–20 min"` (`:1501`), `:"1.5–2 Hours / Recovered every single day"` (`:1528`), `:"$51,600"` (`:1958`), `:"Eliminate 100% of After-Hours Charting"` (`:1486`)
- `:"$99–$149 / month per clinic"` + `:"$99/mo annual · $149 month-to-month"` (`:1804-1805`) — **inconsistent with `plans.ts`**, which is a flat `A$149` ex GST for up to 6 seats with no annual tier

**So the fix that PR #5 made to the landing page is undone by the demo the founder actually presents.** This is the single densest concentration of invented numbers in the product, and it is shown on a projector.

### 2.2 Why these two are still open: an editor limit, not a decision

The write path used in this workspace cannot see past roughly the **first 64 KB** of a file. Evidence:

| File | Largest byte offset edited successfully | First offset that failed |
|---|---|---|
| `src/components/TreatmentPipeline.tsx` | 59,863 | — |
| `server.ts` | 34,357 | 155,798 (line 3941) |
| `src/demo/Scenes.tsx` | — | 77,018 (line 1547) |

The 64 KB crossing point is `Scenes.tsx` line 1313 and `server.ts` line 1657. Every remaining target sits beyond it, so the edits are mechanical but *unreachable* here. They should be applied by hand or by an agent that can write the whole file.

---

## 3. The pending patches

### Patch A — `server.ts` (~line 3941, in `GET /api/pipeline/roi`)

The ROI multiple is displayed to the practice. Today it divides by a constant, so a **free Solo clinic is shown a return against a subscription it does not have**.

**Replace:**
```ts
    const subscriptionCost = 149;
    const netRoiMultiple = totalBookedValue > 0
      ? Number((totalBookedValue / subscriptionCost).toFixed(1))
      : 0;
```

**With:**
```ts
    // The multiple must divide by what THIS clinic actually pays. This was a
    // hardcoded 149, which told a free Solo clinic it was realising a return
    // against a subscription it does not have, and gave a Group/annual/GST
    // customer the Practice price. No cost => no multiple, not an invented one.
    let subscriptionCost = 0;
    if (clinicId) {
      try {
        const subscription = await subscriptionStore.forClinic(clinicId);
        const plan = isPlanId(subscription?.plan) ? subscription.plan : null;
        subscriptionCost = plan ? PLANS[plan].monthlyAudExGst : 0;
      } catch (subErr: any) {
        logger.warn('Could not resolve the plan price for the ROI summary:', subErr?.message || subErr);
      }
    }
    const netRoiMultiple =
      subscriptionCost > 0 && totalBookedValue > 0
      ? Number((totalBookedValue / subscriptionCost).toFixed(1))
      : 0;
```

**Also required:** add `isPlanId` to the existing plans import at `server.ts:45`:
```ts
import { PLANS, isPlanId, type PlanId, resolveEntitlements } from './src/lib/plans';
```

`subscriptionStore.forClinic` already exists (used at `server.ts:2945`), and `PLANS[plan].monthlyAudExGst` is the real price. The UI already renders `0` as `0x` (`TreatmentPipeline.tsx`), so a free clinic sees no multiple rather than a false one.

### Patch B — `src/demo/Scenes.tsx`

1. **Delete the fabricated constants** (`:1847-1849`) and render something true. The four metric cards should read from the same data the product does — or state the mechanism:
   ```ts
   const card1Val = 0; // was Math.min(34800, …) — a constant, not a measurement
   const card2Val = 0; // was 18400
   const roiVal = '—'; // was '123.5x'
   ```
   and change the captions: `"Booked Prod."` → `"Booked production (reported)"`, `"9 verified in PMS"` → `"with a PMS reference"`, `"vs. $149/mo sub"` → `"vs. your plan"`, `"Total Lifetime / $51,600"` → the real `totalIdentifiedValue`, `"Captured from notes"` → `"Reported from marked bookings"`.

2. **Remove the verification claims:** `"Universal PMS Bridge"` → `"PMS-ready export"`; `"Revenue Engine & PMS Sync"` → `"Treatment Pipeline & Recalls"`; `"D4W · EXACT · Cliniko Verified"` → `"Copy-ready for D4W · EXACT · Cliniko"`; `"✓ D4W #8491 Verified"` → `"D4W appointment reference logged"`; `"Sync to D4W"` → `"Copy to D4W"`.

3. **Remove the unmeasured outcomes** in `RoiScene`: `"Practice ROI & Economics"`, `"High ROI"`, `"Measurable Clinical ROI"`, `"Eliminate 100% of After-Hours Charting"`, `"15–20 min"`, `"1.5–2 Hours"`, `"Recovered every single day"`, `"+$15k–$30k"`. State the workflow, not the outcome.

4. **Decide the pricing copy** (`:1804-1805`). It contradicts `plans.ts`. This is a product decision, not a copy fix: if per-chair pricing is adopted, `plans.ts` changes and the demo follows; until then the demo should show the price the invoice will show.

5. **Then extend the guard:** add `'src/demo/Scenes.tsx'` to both `surfaces` arrays in `tests/productionHardening.test.ts`. It is deliberately absent until the file is clean, so the suite is not left red.

---

## 4. Still open, and needing a decision rather than an edit

**`POST /api/webhooks/pms-booking` is unauthenticated.** Found while verifying the PMS claim. `recordGovernance` returns `next()` for anything that is not a consultation read/write (`src/server/recordGovernance.ts:92`), and this route has no other middleware:

```ts
app.post('/api/webhooks/pms-booking', async (req: any, res) => {
  const { opportunityId, pmsType = 'cliniko', pmsAppointmentId, patientName, bookedAt, clinicId } = req.body;
```

An anonymous caller can POST a `clinicId` and mark a treatment `booked` + `auto_synced` (`server.ts:3767-3775`), writing to a clinical record. It is also **why the "verified" claim could never have been true**: the exact status the UI labelled *PMS-verified* is settable by anyone who knows the URL.

I have not added a secret check, because if a Zapier/Cliniko hook is already pointed at this URL then adding one breaks it silently — and I cannot see which webhooks are configured. **This is your call.** The fix is one line (`requireCronSecret`/`requireOps` style guard, or an HMAC over the body); the question is whether anything is currently calling it.

---

## 5. Summary

**Fixed:** the spoken demo script, the pipeline labels and their wrong count, the public landing page, the patient-facing privacy notice, the retention/data-flow/environment records, and the funnel's conversion count — plus a comment-aware guard across four surfaces, proven to fail when a claim returns.

**Two patches pending**, both blocked by an editor limit rather than by a decision: the hardcoded ROI denominator in `server.ts` (past 64 KB) and the demo visuals in `Scenes.tsx` (past 64 KB) — the latter containing the very constants the landing guard was written to ban.

### 5.1 Second pass — the client half of Patch A is now applied

The same hardcoded price existed **twice**. `src/components/TreatmentPipeline.tsx:310` also divided by `149`:

```ts
const roiMultiple = roiSummary?.netRoiMultiple ?? (totalBookedValue > 0 ? (totalBookedValue / 149).toFixed(1) : 0);
```

That file is reachable, so it is fixed: the client has no plan price (`ClinicMembership` in `src/lib/clinics.ts` carries no plan), so it no longer invents a denominator, and the card shows `—` instead of a fabricated `0x` when there is nothing to divide by.

**Patch A's server half still stands** — `server.ts:3941` remains the source of the *displayed* multiple when the summary is present, so a free Solo clinic is still shown a return against a subscription it does not hold. The client fix removes the second occurrence, not the primary one.

`tests/productionHardening.test.ts` now guards the client half (`never divides booked value by a hardcoded plan price`), and carries a **skipped** `PENDING` test naming every `Scenes.tsx` string to remove, so the gap is visible in the suite rather than lost. Suite after this pass: **384 passed / 23 skipped**.

**Do not** paper over the server half by registering a duplicate route earlier in `server.ts` (Express serves the first match) — that leaves a live-looking dead handler in a clinical codebase, which is worse than the three-line bug it hides.

**One decision needed:** whether anything legitimate calls the unauthenticated PMS webhook.
