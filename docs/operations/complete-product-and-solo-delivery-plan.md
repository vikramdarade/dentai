# What a complete product looks like — and how one person ships it with two agents

Written against `origin/main` @ `3b429f2`. Every claim about current state was read from that
commit or produced by running it. Where something is unverified, it says so.

---

## 0. The mistake to avoid first

"Complete" is not a feature list. If it were, you would already be close: 26 test files, a
4,846-line API, billing, recall, audit chain, MFA, retention, exports. None of that is the
constraint.

**Complete means: each of the five business loops closes with no human in the middle.**

Today every loop has a person inside it — usually you. That is what "not complete" actually looks
like, and it is the reason growth stops at the founder's calendar regardless of how good the code is.

| Loop | Closes when… | Who is inside it today |
|---|---|---|
| **1. Money** | A dentist can pay and receive exactly what they bought, automatically | You, at the ops console (verified — see §2) |
| **2. Clinical** | Capture → transcript → grounded note → edit → sign → export, and you can *measure* how good the note was | You, guessing about accuracy |
| **3. Trust** | Consent, retention, residency and breach response are defaults and have been drilled | You, on the day it matters, for the first time |
| **4. Growth** | A free solo dentist becomes a paying practice, and the practice can see money they recovered in their own ledger | You, telling them a number you made up |
| **5. Operations** | 100 clinics can be supported by one person without a terminal | You, at a terminal |

Work on the loops in that order. Loop 1 is first not because it is the most interesting but because
until it closes you have no revenue data, and without revenue data the rest is opinion.

---

## 1. Loop 1 — Money (the only true blocker)

**Verified defect.** Checkout writes snake_case metadata; the webhook reads camelCase:

- write — `src/server/billing.ts:532` `metadata[clinic_id]`
- read — `src/server/billing.ts:293` `object.metadata?.clinicId`

`clinicId` is therefore always empty, the handler logs
`Stripe checkout completed without a clinicId in metadata; ignoring.` and **returns before writing
any subscription**. `git grep -n "subscription_data" src/server/billing.ts` returns nothing, so
subscription lifecycle events inherit no clinic either, and the `byStripeCustomerId` fallback needs
a row that the missing write would have created. The fallback plan is `'solo'` — free. Meanwhile
`success_url` (`:529`) tells the customer the payment succeeded.

**A practice pays A$149/month and stays on the free tier, visible only to a human who notices.**

Tax is the same class of problem:

- UI promises `$163.90 inc GST` — `src/components/BillingModal.tsx:279`
- checkout charges `14900` — `src/server/billing.ts:526`, with no `automatic_tax`, no
  `invoice_creation`, no `tax_behavior` (all three: zero matches on main)
- `receiptEmail` is **defined and never called** — `src/server/email.ts:225` is its only occurrence
- `DENTAI_ABN` is accepted but not required in production

And the public surface still invents numbers: `$34,800`, `$18,400`, `123.5x`, `52.8%`
(`src/components/Landing.tsx:420,425,430,435`). There is no model behind them.

### Definition of done

1. One test-mode Stripe checkout, driven through the real UI, observed to change entitlements.
   Paste the webhook log, the `subscriptions` row, and `/api/billing/status` before and after.
2. A signed `checkout.session.completed` regression test that **fails on current main** and passes
   after the fix. A paid checkout must never silently fall back to a free plan.
3. `subscription_data[metadata]` set, so `customer.subscription.*` and invoice events resolve a clinic.
4. Real GST: either charge inc-GST correctly or stop claiming it. One of the two, decided, in writing.
5. `receiptEmail` actually sent on payment, with ABN and a GST line; `DENTAI_ABN` required in prod.
6. The four constants deleted; a CI guard so they cannot return.

**Nothing else in this document should start before item 1 is pasted as output.**

---

## 2. Loop 2 — Clinical accuracy you can defend

The engineering here is strong and largely done: patient identity with a refusal-biased matcher,
durable chair sessions ordered by `chunkIndex`, diarized transcription with provenance on every
record. That is Series-A quality work.

What is missing is **measurement**, and it is the difference between a claim and a business.

- The CI gate is `bun run eval:notes --offline --min-score 0.9` (`.github/workflows/ci.yml:131`) —
  recorded outputs, no model call, 3 fixtures. It cannot catch an accuracy regression. The `--live`
  path exists and is unused.
- Nothing measures **edit rate per generated note** or **live-fallback share** — the two numbers
  that would tell you whether the output is usable and whether capture is good enough.

Those two numbers are the only honest basis for any accuracy statement you ever make to a dentist or
an investor, and the data to compute them is already being written (`usage_events`,
`audit_logs`, note revisions).

### Definition of done

1. Edit rate per note and live-fallback share are computed and visible on one screen.
2. The live eval runs on a schedule, not just offline in CI.
3. The cockpit no longer makes the dentist wait up to 25s inside "Finalize Note" — pre-transcribe at
   stop, as the legacy record screen already does.
4. **20–30 real appointments** from one consenting practice, with the numbers from (1) reported
   before any accuracy claim is made in public.

Item 4 is yours. The agents can build the harness; they cannot be the dentist.

---

## 3. Loop 3 — Trust as a default, not an option

Already built: hash-chained audit log, append-only revisions, executed retention, MFA, practice
agreement acceptance, export, alerting, abuse tests. The gap is configuration and rehearsal.

- Consent, retention and AU residency are opt-in. A clinic that never finds the toggle runs with the
  weaker default — that is a policy choice, and the safe direction costs a courtesy note.
- Residency is documented (`src/server/configCheck.ts:40`, `ap-southeast-2`) but not enforced.
- The breach runbook exists (`docs/runbooks/notifiable-data-breach.md`) and has **never been
  drilled**. An undrilled runbook is a document, not a capability.
- Cost containment is inverted on the most expensive path: transcription is metered **after** spend,
  so the cap cannot prevent the cost it exists to cap. Ceilings and promises also disagree — free
  advertises 15 notes/day against a 60k token cap, which is roughly two long appointments.

### Definition of done

1. Safe defaults shipped; clinic can opt out, not opt in.
2. The NDB runbook drilled once, timed, with the elapsed time written down. If it takes four hours,
   you have learned something you needed to know.
3. Transcription metered before the spend; ceilings reconciled with the promise, or the promise changed.
4. A staging environment (a Neon branch) so migrations are rehearsed before they touch production —
   currently on the "genuinely open" list in `docs/operations/build-backlog.md`.

---

## 4. Loop 4 — Growth that a practice can see

The recall engine (`src/lib/recallEngine.ts`) is real and good: due dates, urgency tiers, outreach
copy, month-end clamping, and it refuses to synthesise a recall interval it does not know.

But it recovers nothing yet, because nothing is sent, and the recovered money is not read back from
the practice's own ledger. The landing page currently supplies that number from nowhere.

**Practices do not renew software to type less. They renew to recover money they can see, or to
remove a liability they personally carry.** Everything durable here comes from one of those two.

### Definition of done

1. Recall worklist drives an actual reminder (appointment reminder SMS is the highest-leverage single
   integration — audit AU sender requirements before committing).
2. The value the practice sees is computed **from their own billing records**, not from a model.
3. Self-serve plan change, cancellation and dunning — the practice never emails you to change a plan.
4. Pricing that scales with the practice (per-chair above the 6-seat Practice plan), so revenue grows
   with the account rather than with logo count.
5. One real PMS write-back to the system the pilot actually uses. Manual copy/print is a defensible
   choice for a pilot and an unanswerable objection at renewal.
6. Compliance defaults from §3 are part of the sales pack — they close deals in this segment.

---

## 5. Loop 5 — Operations that one person can run

Built: alerting, durable queue drain, ops API, export, runbooks. Missing: a support surface and a
schedule that matches reality.

- The queue drains once daily at 02:00 UTC (`vercel.json:17-20`). Notes generated at 09:00 Sydney
  wait most of a day if the inline path falls over.
- The ops console is API-only (`/api/ops/*`). Support is you, with curl.
- No status page.

### Definition of done

1. Drain at least hourly; the cost of a stuck note is a clinician who trusts the product less.
2. A support surface you can use from a phone.
3. A status page, so "is it down?" is not a phone call.
4. Restore rehearsed on a copy and timed (`docs/runbooks/backup-and-restore.md` exists; the rehearsal
   is the part that has not happened).

---

## 6. The two-tool operating model

Two agents with write access to one repository is a race condition. The plan below is mostly about
preventing that, because the failure is silent: you get two half-finished versions of one intent and
a green test suite that proves nothing.

### 6.1 Role split

| | Antigravity (Gemini) | Buffy (here) |
|---|---|---|
| **Job** | Implementer, at volume: migrations, UI, mechanical refactors, test scaffolding | Verifier and evidence work: cross-cutting claims, acceptance tests, adversarial review, incident root-cause |
| **Strength** | Wide agentic edits across many files | Reading the whole repo, then proving or disproving a claim with a command |
| **Rule** | Cannot certify its own work | Cannot be the one that wrote the fix it is verifying |

**Whoever implements, the other verifies.** No exceptions, including for "obvious" one-line fixes —
the A$149 defect in §1 is a one-line fix that no test covered.

### 6.2 The three rules that prevent the collision

1. **Trunk discipline.** One `main`. Short-lived branches. Before either agent starts, sync
   (`git fetch origin --prune && git checkout main && git pull --ff-only`) and confirm the cited line
   numbers still match. If a citation is stale, stop — do not guess.
2. **One writer per file.** Keep a two-line note of which files are in flight and hand it to the other
   agent before it starts. This is unglamorous and it is the single highest-value habit here.
3. **Gate serially.** Do not open a new loop until the previous loop's acceptance test passes on
   `main`. Parallelism is what makes two agents slower than one.

### 6.3 The handoff ticket

Every item handed to an agent carries these six fields. If it cannot be filled in, the item is not
ready and the agent will fill the gaps with invention.

```
SYMPTOM:     what a user or operator observes (not "the metadata key is wrong")
EVIDENCE:    file:line, plus the command that demonstrates it
ACCEPTANCE:  a test that FAILS now and PASSES after — paste both runs
NON-GOALS:   what must not change (this is what stops scope creep)
BLAST RADIUS: files/tables/routes likely touched
VERIFIER:    the other agent, starting from a clean checkout of main
```

### 6.4 The rules you enforce on both agents

- **Reproduce before fixing.** If an agent cannot produce a failing test, the item is downgraded to
  "unverified" — it does not get "fixed".
- **Pasted output only.** "All tests pass" is not evidence; the suite summary is. Same for "should
  work". Same for "I checked the docs" without a link.
- **No invented numbers** on any user-facing surface. No source, no number.
- **No self-certification.** The implementer never marks the ticket done.
- **Hard stops.** Neither agent charges a real card, runs a migration against production, or deletes
  clinical data without you saying so explicitly, in that session.

### 6.5 Divide the work so the agents do not overlap

- **Antigravity** takes: the metadata/tax fix and its regression test; the recall→reminder path;
  the support surface; perf work (pre-transcribe at stop); the accessibility/iPad pass.
- **Buffy** takes: the live-eval harness and the two accuracy metrics; the trust-default flip; the
  cost-ceiling reconciliation; audit of any claim on a public surface; verification of every
  Antigravity change before it is considered done.

Neither agent writes the go-to-market, talks to a dentist, or signs anything. See §8.

---

## 7. Sequence and gates

| Phase | Focus | Exit criterion | Est. |
|---|---|---|---|
| **0** | Money loop (§1) | One test-mode checkout changes entitlements, tax invoice received, invented constants gone | 2–3 days |
| **1** | Accuracy you can defend (§2) | Edit rate + fallback share on a screen; live eval scheduled; one practice, 20–30 appointments measured | 2–3 weeks |
| **2** | Trust defaults (§3) | Safe defaults live; NDB drilled and timed; staging exists; ceilings reconciled | 2–4 weeks |
| **3** | Renewal (§4) | A practice renews, and can see dollars recovered from their own ledger | Month 2 |
| **4** | Scale (§5 + PMS) | Support is not you; one real PMS write-back; load and pen test passed | After first renewal |

Phase 4 is deliberately last. Doing it earlier is how solo founders build 100k lines no one renews.

---

## 8. What only you can do (not delegable to either agent)

Both agents write code. Neither can do the following, and these are on the critical path:

1. **ABN and GST registration**, an accountant, and a decision on inc-GST pricing. This is a
   prerequisite for §1 item 4 — the code cannot decide your tax position.
2. **Stripe account activation** and identity verification, then one real (not test-mode) charge,
   refunded immediately, to prove the live path.
3. **One pilot practice**, with written consent and a signed agreement, willing to record 20–30 real
   appointments and let you measure the output.
4. **Insurance** — confirm professional indemnity actually covers clinical software; many AU policies
   exclude it. Ask before you need it.
5. **A security review you can hand to a practice.** Answer the questionnaire from documents.
6. **Dentist conversations.** The roadmap in §4 is a hypothesis until a dentist tells you which
   number on their ledger they would act on.

If those feel like the slow part: they are. They are also the part that cannot be outsourced, and
they run **in parallel** with the agent work rather than after it.

---

## 9. Definition of complete — the one page to print

- [ ] A practice can pay, and receives exactly what it bought, with no human intervening
- [ ] The tax invoice is real, in the right currency, with the right GST treatment and a valid ABN
- [ ] No number appears on any public surface that cannot name its source
- [ ] Edit rate per note and live-fallback share are measured and visible
- [ ] Accuracy has been measured on real appointments, and the claim matches the measurement
- [ ] Consent, retention and residency are defaults
- [ ] The breach runbook has been drilled, once, for real, and timed
- [ ] A restore has been rehearsed on a copy
- [ ] The recall worklist sends reminders, and the practice sees money recovered in their own ledger
- [ ] A practice can change or cancel a plan without emailing you
- [ ] Support does not require a terminal
- [ ] One real PMS write-back
- [ ] A clinic has renewed, at least once

Thirteen lines. When twelve are true you have a business; when thirteen are true you have a company
that can grow without you deciding everything.

---

## 10. The discipline that decides whether this works

Two capable agents will happily produce a large, plausible, unverified codebase. The binding
constraint is not coding capacity — it is **your capacity to verify**. So:

1. **Prefer deleting to adding.** Every feature is a support burden and an attack surface. The
   strongest item on this list is deleting four constants.
2. **Tests must fail first.** A test written after the fix asserts the current behaviour and proves
   nothing. This is the most common way agent work looks done and is not.
3. **Never ship on confidence.** Paste the output or do not claim it.
4. **Measurement before claims** — clinical accuracy and recovered revenue both.
5. **Run the business on two numbers:** edit rate per note, and live-fallback share. Signups and
   notes-generated are vanity until those two are real.

*Unverified in this document: main's test suite was not executed while writing this (the local tree is
8 commits behind `main`); the §1 and tax findings are read from source at `3b429f2`. The test-mode
checkout in §1.1 is what converts them from findings into facts.*
