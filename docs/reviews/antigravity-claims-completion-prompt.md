# Antigravity prompt — finish the claims correction

Copy everything from `§0` to `§6`. The line numbers were verified on `main` @ `027a934` and the branch `fix/billing-gst-governance-hardening` @ `936b477`; **verify them in your own checkout before editing** and stop if they do not match. The exact strings are given so you never have to guess at a match.

---

## §0. Guardrails — this is a clinical product taking real payments

1. **SYNC FIRST:** `git fetch origin --prune && git checkout <the branch under review> && git pull --ff-only`. State the exact commit you are working on. If a cited line or string does not match, **STOP and report** — do not guess.
2. **THE STRINGS ARE THE CONTRACT.** Every edit below quotes the text to find. Match on the string, not the line number; line numbers drift.
3. **NEVER REPLACE AN INVENTED NUMBER WITH ANOTHER INVENTED NUMBER.** If a figure has no source in the repository, remove it or render it from real data. Adding a plausible-looking substitute is the exact defect you are fixing.
4. **DO NOT CHANGE SCOPE SILENTLY.** Anything you find that is not in this brief goes in an "additional findings" section with file:line evidence. Do not fix it.
5. **PROVE IT.** Paste real command output. "All tests pass" without pasted output is not a result. Never fabricate output.
6. **ASK BEFORE TOUCHING AUTH.** §5 lists a route you must not modify without explicit confirmation.

**Stack:** Bun · Express + Node≥22 (`server.ts` is both the API and the note-job worker) · React 19 + Vite · Postgres via `@neondatabase/serverless` · Gemini · Vitest.
**Commands:** `bun tsc -b --noEmit` · `bun run test` (must run with `--fileParallelism=false`; the `test` script already does) · `bun run eval:notes`
**Baseline to match:** `tsc` clean, **384 passed / 23 skipped**.

---

## §1. Context — what is already done. Do not undo it.

A previous pass corrected false claims in `src/demo/demoScript.ts`, `src/components/Landing.tsx`, `src/components/LegalPage.tsx`, `src/components/TreatmentPipeline.tsx`, `server.ts`, three docs under `docs/`, and added four guard tests to `tests/productionHardening.test.ts`.

**⚠️ Those changes are uncommitted — they are working-tree edits on the branch `fix/billing-gst-governance-hardening` (9 files).** Work in that same workspace/branch, or the guard tests and the corrected labels described below will not be present. Start by running `git status --short` and confirm those 9 files show as modified. If they do not, **stop** — you are in the wrong checkout and §4 will not make sense.

Two things were **blocked by an editor that could only see the first ~64 KB of a file**, and they are what you are here to finish:

- `server.ts` — the ROI denominator sits around line 3941, well past byte 155,000
- `src/demo/Scenes.tsx` — every target sits past byte 77,000

There is a **skipped** test in `tests/productionHardening.test.ts` titled `PENDING: demo visuals carry no fabricated constants or PMS-verification claims`. It documents this gap. You will enable it in §4.

---

## §2. `server.ts` — the ROI multiple divides by a hardcoded price

`GET /api/pipeline/roi` computes an ROI multiple that is **displayed to the practice**. It divides by a constant, so a **free Solo clinic is shown a return against a subscription it does not hold**, and a Group/annual/GST customer is given the Practice price.

**Find (around line 3941):**

```ts
    const subscriptionCost = 149;
    const netRoiMultiple = totalBookedValue > 0
      ? Number((totalBookedValue / subscriptionCost).toFixed(1))
      : 0;
```

**Replace with:**

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

**Also required** — `isPlanId` must be imported. Find the plans import (around line 45):

```ts
import { PLANS, type PlanId, resolveEntitlements } from './src/lib/plans';
```

Replace with:

```ts
import { PLANS, isPlanId, type PlanId, resolveEntitlements } from './src/lib/plans';
```

**Verify before you rely on it:** `subscriptionStore.forClinic` already exists (`server.ts` uses it around line 2945) and returns an object with a `plan`. `PLANS[plan].monthlyAudExGst` is the real price (`practice: 149`, `solo: 0`, `trial: 0`, `enterprise: 0`). If `forClinic`'s shape differs from that, **stop and report** rather than inventing a lookup.

The UI already renders a zero multiple as `—`, so a free clinic sees no multiple rather than a false one. **Do not** touch `src/components/TreatmentPipeline.tsx` for this — its own hardcoded `149` fallback was already removed and is guard-tested.

---

## §3. `src/demo/Scenes.tsx` — the demo **visuals** still carry the banned constants

This is the higher-priority fix. These scenes are shown on a projector to a dentist or an investor, and they assert things the code does not do. A repo-wide grep confirms every occurrence below is in this file (plus one mock label in `Landing.tsx`, §3.5).

### 3.1 The fabricated constants

Fabricated money and multiples — the same tokens `tests/productionHardening.test.ts` already bans from `Landing.tsx`:

```ts
  const card1Val = Math.min(34800, Math.floor(progress * 4 * 34800));
  const card2Val = progress > 0.25 ? 18400 : 0;
  const roiVal = progress > 0.25 ? '123.5x' : '0x';
```

and rendered:

```tsx
              <div className="text-2xl font-black text-slate-800 tracking-tight">+$15k–$30k</div>
                $51,600
```

**Replace with figures that come from somewhere, or with no figure at all.** Do not substitute a different invented number. If these cards need a value and the scene has no real data to read, render the mechanism (`"Drafted during the visit"`, `"Reported from marked bookings"`) or `—`, and change `roiVal` so it is never a hardcoded multiple. Update the captions to match what the number actually is:

- `"Booked Prod."` → `"Booked production (reported)"`
- `"9 verified in PMS"` → the count of items with a PMS reference, or `"with a PMS reference"`
- `"vs. $149/mo sub"` → `"vs. your plan"`
- `"Total Lifetime"` / `"Captured from notes"` → `"Total identified"` / `"Reported from marked bookings"`

### 3.2 The PMS-verification claims

**There is no PMS integration in this codebase.** Notes leave via a formatted clipboard copy (`formatNoteForPmsClipboard`), and a booking is recorded by the practice. `/api/webhooks/pms-booking` exists as an endpoint but nothing is configured to call it — see §5.

Remove or correct each of these:

| String to find | Replace with |
|---|---|
| `<span>Revenue Engine & PMS Sync</span>` | `<span>Treatment Pipeline & Recalls</span>` |
| `{/* Subheader with universal PMS bridge indicator */}` | `{/* Subheader: what the export format is copy-ready for */}` |
| `Universal PMS Bridge` | `PMS-ready export` |
| `<span>9 verified in PMS</span>` | `<span>with a PMS reference</span>` |
| `<span>✓ D4W #8491 Verified</span>` | `<span>D4W appointment reference logged</span>` |
| `<span>Sync to D4W</span>` | `<span>Copy to D4W</span>` |

Note the words that must **not** appear anywhere: `Verified` attached to a PMS booking, `Sync to`, `Universal PMS Bridge`, `automatically update booking status`.

### 3.3 The unmeasured outcomes in `RoiScene`

There is no measurement behind any of these, and the only pilot feedback on record is that note generation was **slow**. Remove the numbers; keep the workflow description:

```
Eliminate 100% of After-Hours Charting
Measurable Clinical ROI
High ROI                      (the AppBar Chip)
Practice ROI & Economics      (the AppBar title)
Chairside Time Recovery · Clinic Capacity
15–20 min                     (card caption: "Saved per complex procedure")
1.5–2 Hours                   (caption: "Recovered every single day")
```

State the mechanism instead — the note is drafted during the visit, so charting happens at the chair rather than after hours — and point at the practice's own day sheet as the source of any time saving.

### 3.4 The pricing copy contradicts `plans.ts`

```tsx
              <div className="text-2xl font-black text-slate-800">$99–$149 <span className="text-xs font-normal text-slate-400">/ month per clinic</span></div>
              <p className="text-[10px] text-indigo-600 font-semibold mt-0.5">$99/mo annual · $149 month-to-month</p>
```

`src/lib/plans.ts` is the source of truth: `practice` is a flat `A$149` (ex GST) for up to 6 seats, `solo` is free, `enterprise` (Group) is quote-priced. **There is no annual tier and no per-clinic $99.** Render the price from `PLANS` / `describePlan()` rather than hardcoding, so it cannot drift again, and **remove the annual line**.

⚠️ **Do not invent a new pricing model.** Per-chair pricing is an open business decision the owner has not made. If you believe the price should change, say so in additional findings — do not change `plans.ts`.

### 3.5 `src/components/Landing.tsx` — one mock label

```tsx
                      D4W #8491 Booked
```

Make the mock unambiguous: it shows an appointment reference the practice recorded, not a booking DentAI wrote into D4W. If it reads as a write-back, correct it. The landing page is otherwise already clean and guard-tested.

---

## §4. Turn the pending guard on

In `tests/productionHardening.test.ts`:

1. Change `it.skip('PENDING: demo visuals carry no fabricated constants or PMS-verification claims', …)` to `it(…)`.
2. Add `'src/demo/Scenes.tsx'` to the `surfaces` arrays in the `never claims a PMS integration that does not exist` and `never presents self-reported bookings as verified revenue` tests.
3. Add `'src/demo/Scenes.tsx'` to the ROI-multiple test's `surfaces`.
4. Extend the pending test's `pending` array with any fabricated token you removed that is not already listed.

**The guard must be non-vacuous.** Prove it: temporarily reintroduce one banned string, confirm the guard **fails**, then remove it again and confirm it passes. Paste both runs.

---

## §5. Do NOT touch without explicit confirmation

`POST /api/webhooks/pms-booking` (`server.ts`, around line 3738) is **unauthenticated**. `src/server/recordGovernance.ts` returns `next()` for anything that is not a consultation read/write (around line 92), and this route has no other middleware. An anonymous caller can POST a `clinicId` and mark a treatment `booked` + `auto_synced`, writing to a clinical record.

**This is a real finding and it explains why the "verified" claim could never have been true** — the status the UI labelled PMS-verified is settable by anyone who knows the URL. **Report it. Do not add a secret check in this pass**: if a Zapier/Cliniko hook already points at that URL, a check breaks it silently, and only the owner knows what is configured.

---

## §6. Definition of done

- [ ] `server.ts` ROI cost derives from the clinic's subscription; free plans get `0`, not `149`
- [ ] `src/demo/Scenes.tsx` contains no `34800`, `18400`, `123.5x`, `$51,600`, `+$15k–$30k`
- [ ] No `Verified`/`Sync to`/`Universal PMS Bridge` claim about a PMS in any demo or landing surface
- [ ] Demo pricing derives from `PLANS`/`describePlan`; no annual tier; no per-clinic $99
- [ ] The `PENDING` guard is enabled, `Scenes.tsx` added to the surfaces arrays, and the guard proven to fail when a claim returns
- [ ] `bun tsc -b --noEmit` clean
- [ ] `bun run test` passes — expect **≈386 passed / 22 skipped** (baseline 384/23). Report the actual numbers

**Then report in this shape:** finding → file:line → the string removed → the proving guard → status. Followed by *Additional findings* (with evidence) and *What could still be wrong*.

**One-line summary of the whole task:** the product's code is more honest than its demo — make the demo describe the product that exists.
