# Verification of the Antigravity VC memo against `main`

**Reviewed at:** `origin/main` @ `027a934` (2026-09-20). Working tree: `fix/billing-gst-governance-hardening` @ `936b477` (1 ahead / 1 behind).
**Method:** every code claim in the memo was checked against the file it names, by reading the source. Nothing here is from memory. Business claims (market, CAC, DSO channel) are marked as not code-verifiable rather than guessed at.

**Why this document exists:** the memo is written in the voice of an investment committee, which means its technical claims will be repeated as facts to a practice owner or another investor. Four of them are wrong, two of them are "true but off by default", and the two metrics the memo says it would underwrite cannot measure what it thinks they measure. Correcting them is cheaper now than in a diligence call.

---

## 1. Claims that hold up

### 1.1 "$149/mo for up to 6 chairs" — accurate
`src/lib/plans.ts:80-94`:

```ts
practice: {
  dailyNotes: 200,
  dailyTranscriptions: 200,
  dailyTokens: 2_000_000,
  seats: 6,
  monthlyAudExGst: 149,
}
```

Per-chair arithmetic is exactly as the memo states: `149 / 6 = A$24.83` per clinician per month. The memo's "$24.80 per dentist" is right, and the conclusion — that this reads as a toy price for clinical infrastructure — is a fair reading of the same numbers.

### 1.2 "200 notes/day across 6 chairs" — accurate
`dailyNotes: 200` (`plans.ts:83`). Note that after the transcription-meter fix in PR #5, `dailyNotes` and `dailyTranscriptions` are counted **separately** (`NOTE_USAGE_KINDS` vs `TRANSCRIPTION_USAGE_KINDS`), so the daily allowance is 200 notes **plus** 200 transcriptions, not 200 of one pool. That slightly softens the margin concern behind the memo's §2.2 — the worst case is 400 metered events/day, not "4,000 consults a month on one cap".

### 1.3 "Copy and paste into Dental4Windows, EXACT, or Cliniko" — accurate, and it is the whole PMS story
There is no PMS integration in the codebase. The complete surface is:

- `formatNoteForPmsClipboard` (`src/lib/dayScheduleStorage.ts`), consumed at `App.tsx:688`
- `ClinicalSummary.tsx:441-458` — `handleCopyPmsNote`, "1-Click Copy for PMS", tooltip `"Copy the note formatted for Dental4Windows, Core Practice, or Exact"`
- `TreatmentPipeline.tsx` — a "PMS verify" modal where the user **types** a `pmsAppointmentId` by hand

This is the memo's strongest finding and it is exactly right. Keep it.

### 1.4 "Append-only cryptographic revision chaining" — true, with a caveat the memo omits
`src/lib/auditChain.ts:70-86` is a genuine SHA-256 hash chain over `(prevHash, contentHash)`. It is real engineering, not decoration.

The caveat is written in the module's own header (`auditChain.ts:18-23`):

> It is tamper-*evident*, not tamper-proof. Someone who can edit rows can also recompute the whole chain from that point forward. Detecting that requires the chain head to be witnessed somewhere the attacker does not control … The verifier reports the chain head hash so it can be witnessed; that is its main operational use.

**Nothing in the codebase performs that witnessing.** `grep -rn "headHash|chainHead|witness"` returns only the doc comment, the type field, and one line of operator advice in `opsActions.ts:491`:

> 'A tampered or brokenLink finding is a real problem: compare headHash with the value witnessed off-platform.'

That is an instruction to do a thing no code path schedules. The memo's claim that "your append-only timestamped audit log protects the dentist" in a tribunal is therefore **only true if someone has been copying the chain head off-platform every day**, and today nobody is. This is a ~10-line fix (append the head hash to an immutable sink or email a periodic digest to the practice) and it is the difference between the moat being real and being a claim.

---

## 2. Claims that are wrong

### 2.1 "Mandatory consent stamping" — false. Consent is opt-in.
`server.ts:402`:

```ts
requireConsent: (process.env.DENTAI_REQUIRE_CONSENT || '') === 'true',
```

Off unless the operator sets the variable. What actually happens on a transcript saved without consent is a *passive audit event*, not a block (`recordGovernance.ts:150-155`):

```ts
if (hasTranscript && !consentWasSupplied) {
  void Promise.resolve(
    deps.logAudit('consultation_without_consent_captured', dentistId, { route: pathname })
  ).catch(() => {});
}
```

The record is written either way. In a project whose own `configCheck.ts:137` pattern is to describe consequences honestly, "mandatory" is the one word a practice's lawyer will circle — and it is not true. In an Australian health context, recording a consultation without consent is the liability the memo says the compliance layer removes.

### 2.2 "Strict patient boundary isolation (`isMicStandby`)" — mischaracterised
`isMicStandby` is client-side React state:

```ts
// src/components/ChairsideWorkspace.tsx:380
const [isMicStandby, setIsMicStandby] = useState(true); // Starts in explicit STANDBY
```

Read through the file and it is a **mic standby toggle**: it gates capture (`:735`, `:857`), forces standby when the patient changes, and is mirrored into a ref for the async paths. That is good, well-reasoned UX — and `PROJECT_CONTEXT.md:134-137` documents it as such ("Cross-Patient Boundary Isolation & Forced Standby").

But it is a boolean in a browser tab. Calling it "strict patient boundary isolation" in a diligence document invites the question "*isolation enforced where?*" — and the honest answer is: nothing server-side enforces it, because there is no server-side per-patient capture boundary to enforce. The memo should describe this as a capture-safety default, not a security control.

### 2.3 "Sovereign AU data boundaries (Vertex AI `australia-southeast1`)" — conditional, and not enforced
The region is a **default**, not a control (`server.ts:521`, `:1301`, `:4278`, `:4284`):

```ts
location: process.env.GCP_REGION || 'australia-southeast1'
```

Worse, there is a fallback path with no residency at all (`server.ts:532-536`):

```ts
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
return { client: new GoogleGenAI({ apiKey }), vertexai: false };
```

If `GCP_PROJECT_ID` is unset, every transcript and intake form goes to the **global** endpoint. `GCP_PROJECT_ID` is declared `severity: 'required'` — but only `fatal` findings throw at boot (`configCheck.ts:279`), and this one is not `fatal`. So the app **boots and runs in production on the non-AU path**.

The config check's own `impact` string admits it (`configCheck.ts:80-82`):

> 'Generation uses the global Gemini endpoint, so content may be processed outside Australia — **which contradicts sovereign processing commitments**.'

For a memo whose §1A is "the compliance moat is real", this is the load-bearing claim and it is a soft default. The memo should either (a) say "supports AU-region processing" rather than "sovereign AU data boundaries", or (b) require that the code actually *is* sovereign — which is a two-line change (make the missing `GCP_PROJECT_ID` fatal in production, and refuse to fall back to the global endpoint when it is).

### 2.4 "Automated retention purges (`retention.ts`)" — false as worded
`src/lib/retentionPolicy.ts:43`:

```ts
const enabled = String(env.DENTAI_RETENTION_ENABLED || '').toLowerCase() === 'true';
const dryRun = !enabled || String(env.DENTAI_RETENTION_DRY_RUN || '').toLowerCase() === 'true';
```

Off, and dry-run when off. `configCheck.ts:134-138` records the consequence:

> 'The 7-year retention promise in the privacy notice stays unexecuted; the sweep only reports.'

So it is not "automated retention purges". It is a correct, well-tested, switched-off sweep. The distinction matters because the privacy notice is a published promise to patients.

---

## 3. The revenue story is not supported by the code

The memo's §1B — cost → asset, "recover $12,000 of unbooked crowns", the reason to give it a 90%+ retention multiple — does not survive contact with the source.

### 3.1 The recall engine contains no money
`src/lib/recallEngine.ts` (218 lines, read in full) computes: a due date from the documented `recallRequirements`, an urgency, a status, and a **suggested message string**. Fields are `dueDate`, `urgency`, `status`, `suggestedMessage`.

There is no fee schedule, no procedure value, no ledger, no booked revenue. `grep -rn "recovered|valueAud|estimatedValue|avgFee"` across `src/` returns nothing in the recall engine. The engine is clean, conservative work ("Never synthesises missing recall intervals", clamped month arithmetic, dedup by patient) and it is a genuinely good clinical *worklist*. It is not a revenue engine, and nothing in it can produce the sentence the memo repeats.

### 3.2 Where the dollars actually come from
`server.ts:3866-3946` (`GET /api/pipeline/roi`):

```ts
const fee = Number(item.estimatedFee) || 0;      // the AI's estimate
...
} else if (item.status === 'booked') {           // the clinic's own self-reported status
  totalBookedValue += fee;
...
const subscriptionCost = 149;                    // hardcoded
const netRoiMultiple = totalBookedValue > 0
  ? Number((totalBookedValue / subscriptionCost).toFixed(1))
  : 0;
```

Three problems in that block:

1. **`estimatedFee` is the model's estimate**, derived from `extractProposedTreatmentsFromFindings`, not from the practice's fee schedule or its PMS.
2. **`status === 'booked'` is set by the clinic in the UI.** It is self-reported.
3. **`subscriptionCost` is hardcoded to `149`** — so a **free Solo clinic** (which pays nothing) is shown an ROI multiple against A$149 it never paid, and a Group/annual/GST-registered customer gets the same denominator. `plans.ts` already knows the real price; the endpoint doesn't ask it.

`verifiedBookedValue` requires `item.pmsAppointmentId || pmsSyncStatus === 'verified'`, and `pmsAppointmentId` is **typed by a human** into a modal (`TreatmentPipeline.tsx:96-97`, `pmsVerifyModalOpp`). There is no integration, so `'auto_synced'` is unreachable. The card labelled **"Booked Production (Verified Recovered Revenue)"** and the sub-label **"PMS-verified appointments"** therefore describe a self-reported number with a human-typed ID behind it.

This is not dishonest data. It is **mis-labelled** data — and the label is the part an investor or an accountant will act on.

### 3.3 The demo script repeats both claims as product fact
`src/demo/demoScript.ts:215` (and the TTS variant at `:217`), verbatim:

> "…verify bookings **directly in Dental4Windows, EXACT, or Cliniko**. DentAI tracks **verified recovered production on your ledger** — proving over **100x return on investment** on your subscription."

Every clause of that sentence is unsupported:

| Clause | Reality |
|---|---|
| "verify bookings directly in D4W / EXACT / Cliniko" | Clipboard copy only (§1.3) |
| "verified recovered production on your ledger" | Self-reported, AI-estimated, human-typed ID (§3.2) |
| "over 100x return on investment" | Hardcoded denominator, unverified numerator |

This matters more than the landing-page claim that PR #5 already deleted, because a demo script is **spoken aloud** — to a pilot dentist or an investor — and it is the origin of the memo's own belief that this capability exists. Same class of defect, one layer deeper in the funnel, and it was not caught by the earlier sweep.

---

## 4. The two underwriting metrics cannot measure what the memo thinks

The memo's §3 is the most useful part — "forget vanity metrics, pull `/api/ops/funnel`". The endpoint exists and (after PR #5) is correctly authenticated and rate-limited. But both numbers it names are broken in ways that make them read *better* than reality, which is the dangerous direction.

### 4.1 `editRate` — a clinic that rewrites every note reports 0%

`server.ts:878`:

```ts
if (Array.isArray(c.revisions) && c.revisions.length > 1) {
  editedNotes++;
}
```

Now trace a real generated note:

1. The worker persists the note by **direct insert with no `revisions` field at all** (`server.ts:1519`, `dbInsertConsultation(consult)`; the object literal at `:1472-1517` has no `revisions` key).
2. The clinician opens it, rewrites it, and saves. The save goes through `app.use('/api', recordGovernance)` (`server.ts:409`).
3. `recordGovernance.ts:237-249`: `priorRevisions` is `[]`, so `body.revisions = [ { ...one revision... } ]` → **length 1**.
4. `length > 1` is **false**. Not counted as edited.

So `editedNotes` counts **notes saved twice**, not notes edited. A dentist who deletes the entire AI draft once and signs reports an edit rate of **0%** — which reads, on the memo's own scale, as "indispensable, under 10%".

`denominator = generatedNotes > 0 ? generatedNotes : totalNotes` compounds it: the metric mixes a generated-note denominator with a total-note fallback.

The memo's single most important diligence question cannot currently be answered by the product, and the number it *would* return flatters.

### 4.2 `upgraded` — counts free clinics as paid

`server.ts:897`:

```ts
const upgraded = subscriptions.filter((s: any) =>
  s.plan && s.plan !== 'trial' && s.status === 'active').length;
```

`plans.ts:65-72` defines `solo` as `monthlyAudExGst: 0` — **free**. So every free Solo clinic is counted as an upgrade. Any funnel chart built on this will overstate conversion, and the memo's §3 would be reading a number that is partly a function of how the free tier is configured.

### 4.3 `liveFallbackShare` — this one works
`server.ts:900-901` divides `browserLiveNotes` by `(browserLiveNotes + serverDiarizedNotes)` off `transcriptProvenance.source`, which is genuinely stamped by `chooseNoteTranscript`'s verdict. Notes with no provenance are excluded from both counts, so an unrecorded note doesn't distort it. That metric is sound.

---

## 5. What the memo gets right that I cannot argue with

These are not code claims and I am not going to pretend to adjudicate them from a repository:

- **PMS distribution is the binding constraint.** Confirmed independently: the integration does not exist (§1.3), and the memo's adoption-cliff reasoning about a 10-chair practice is sound.
- **The pricing model caps revenue at the logo.** Confirmed in `plans.ts` (§1.1). Per-chair pricing is the right correction, and the memo is right that revenue must scale with the practice.
- **The compliance record is the moat.** I agree with the thesis — with the correction that two of the four pillars it cites (consent, retention) are switched off and a third (AU residency) is a default rather than an enforcement. The moat is *buildable* and is currently *half-dug*.
- **The two-metric frame is correct.** Edit rate and live-fallback share are the right two. The problem is the instrumentation, not the choice.
- **High CAC / no DSO channel / dentists don't answer cold email.** Not verifiable here; also not contradicted by anything in the repo, and consistent with the absence of any self-serve growth instrumentation beyond the funnel endpoint.

---

## 6. What the memo misses

1. **It reasons from product surface to business model, and never from evidence.** It reads 4,846 lines of `server.ts`, sees a billing module, a recall engine, an ROI endpoint, and an ops funnel, and concludes the business has a revenue story. But the revenue story is a **self-reported estimate divided by a hardcoded constant** (§3.2), and the metric that would validate it reads 0% for a clinic that rewrites everything (§4.1). Surface is not evidence.

2. **It repeats a fabricated claim as fact, in the one place a founder will repeat it out loud.** §3.3. The memo's central bull case is downstream of a demo script line that is false in three clauses. That is a trust event waiting to happen in front of a pilot dentist — which is precisely the failure mode that closes clinical companies.

3. **It prices the trust risk as an asset instead of a liability.** §1A of the memo lists the compliance surface as a moat without noting that consent is off, retention is off, the AU residency is optional, the audit chain head is unwitnessed, and the NDB runbook has never been drilled. A memo that praises a control layer without checking it is switched on is describing the *shape* of a moat.

4. **It treats a large ROI multiple as a selling point.** `149x` on a hardcoded denominator and an AI-estimated numerator is not a credential. If a practice owner checks that number against their own ledger — which is exactly the behaviour the memo's §4.3 wants to *encourage* — it reads as inflation. A conservative, ledger-derived number would be worth more, and the memo does not notice it is asking for the opposite.

5. **It proposes a price increase without acknowledging what would justify one.** Raising to $129/chair is defensible for a system that provably reduces editing. It is not defensible while edit rate cannot be measured, because the first dentist who asks "does it actually save time?" gets a number the instrument invented.

---

## 7. The corrective work list

Ordered by what unblocks the memo's own conditions. Each is a small, testable change.

| # | Fix | File | Why it matters |
|---|---|---|---|
| 1 | Count a **first** save of a generated note as an edit (`revisions.length >= 1`, or compare note content against the generated draft) | `server.ts:878` | Without this the memo's #1 diligence metric is meaningless and flatters |
| 2 | Exclude free plans from `upgraded` (`s.plan !== 'trial' && s.plan !== 'solo'`) | `server.ts:897` | Any funnel chart is otherwise partly a function of the free tier's existence |
| 3 | Delete the fabricated demo-script claims; add a CI guard alongside the existing landing-claims guard | `demoScript.ts:213-217` | Spoken to dentists; origin of the memo's own error |
| 4 | Compute `subscriptionCost` from the subscription's actual plan, not `149` | `server.ts:3938` | ROI multiple for a free clinic currently implies a payment that never happened |
| 5 | Rename "Verified Recovered Revenue" / "PMS-verified" to "Reported booked value", or require a real PMS link before claiming verification | `TreatmentPipeline.tsx:474-490` | The label is what an accountant acts on |
| 6 | Make missing `GCP_PROJECT_ID` **fatal in production**, and refuse the global-endpoint fallback there | `configCheck.ts:78-83`, `server.ts:532` | Turns "sovereign AU processing" from a default into a control |
| 7 | Make `DENTAI_REQUIRE_CONSENT` default **on**, or stop describing consent as mandatory | `server.ts:402` | AU health-recording consent is not a setting |
| 8 | Schedule the audit-chain head witness (immutable sink, or a periodic digest to the practice) | `auditChain.ts`, `opsActions.ts:491` | The moat is only real if the head is witnessed off-platform, and nothing does it |
| 9 | Treat `DENTAI_RETENTION_ENABLED` as required, or soften the 7-year promise in the privacy notice | `retentionPolicy.ts:43`, `configCheck.ts:134` | A published promise to patients is currently unexecuted |
| 10 | Ship **one** PMS path (Cliniko REST is the cheapest real bridge) | new | The memo's condition #2, and the only genuine distribution unlock |
| 11 | Per-chair pricing above 6 seats: revenue scales with the practice, not the logo | `plans.ts:80-94` | The memo's condition #1, and correct |

**Sequencing note:** items 1–5 are *instrumentation and labels* — they change no clinical behaviour and can ship together. Items 6–9 are trust defaults and are the ones a clinic's lawyer will ask about. Item 10 is a project, not a ticket, and is the only one on this list that a VC will actually underwrite.

---

## 8. Bottom line

The memo is directionally right about the business and wrong about the code in a specific, patterned way: **it treats built-but-disabled and computed-from-assumption as done.** Consent off, retention off, AU region optional, audit head unwitnessed, ROI numerator self-reported, ROI denominator hardcoded, edit rate measuring double-saves, upgrades counting free clinics, and a demo script asserting an integration that does not exist.

None of that is fatal — every item in §7 is small. But it means the memo's own term-sheet conditions ("pull the funnel, check edit rate under 12%") currently return numbers that are manufactured by the instrument rather than produced by the practices. Fix §7 items 1–5 before showing that funnel to anyone, and the memo's advice becomes actionable instead of aspirational.

**The one-sentence version:** the engineering is real and the *measurement layer* is what's overstated — so the memo is describing a company that has not been measured yet, using metrics that would currently agree with it.
