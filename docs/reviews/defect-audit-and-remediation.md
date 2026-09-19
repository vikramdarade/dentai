# Defect audit and remediation — pre-pilot hardening

Audit of `main` at `c43e7e5`. Every finding below was reproduced from the code (three of the
highest-severity ones by executing the logic directly), ranked by blast radius, and either fixed
with a regression test or explicitly deferred with a reason.

**Verification at the end of this pass**

| Gate | Result |
|---|---|
| `bun run lint` (`tsc -b --noEmit`) | clean |
| `bun run test` | **283 passed**, 22 skipped (postgres suite needs `DATABASE_URL`) |
| `bun run eval:notes` | **3/3 fixtures, average score 1.0, 0 safety failures** |
| `SCHEMA_VERSION` | bumped to `2026-09-19-record-integrity-1` |

---

## Ranking

Severity is blast radius × likelihood of a clinician or practice being harmed, not effort.

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | 🔴 Critical | Sign-in permanently locks the account out after any credential change | **Fixed** + 2 tests |
| 2 | 🟠 High | Consent gate, revisions, retention and read-audit bypassable with `?x=1` | **Fixed** + 1 test |
| 3 | 🟠 High | Grounding engine clears hallucinated teeth (false positives) | **Fixed** + 3 tests |
| 4 | 🟠 High | An empty/non-clinical note reports "100% verified" | **Fixed** + 1 test |
| 5 | 🟠 High | Fabricated dialogue persisted as the clinical evidence | **Fixed** |
| 6 | 🟠 High | Rate limiting collapses to one shared bucket in production | **Fixed** + 1 test |
| 7 | 🟠 High | Horizon filter silently drops post-op advice while claiming "zero loss" | **Fixed** (vocabulary + honest docs) |
| 8 | 🟡 Medium | Daily AI allowance reset mid-shift (UTC bucketing) | **Fixed** |
| 9 | 🟡 Medium | Server stamped records with the host's (UTC) date | **Fixed** + 1 test |
| 10 | 🟡 Medium | Invented patient DOB and practitioner id on write paths | **Fixed** |
| 11 | 🟡 Medium | Dead `/api/day/import-screenshot` route (middleware, no handler) | **Fixed** |
| 12 | 🟡 Medium | Duplicated shadowed auth handlers carrying the same bug | **Fixed** |
| 13 | 🟡 Medium | AU product transcribed with the workstations's OS locale | **Fixed** |
| 14 | 🟡 Medium | Legacy 1,000-iteration PIN hashes accepted forever | **Fixed** + 1 test |
| 15 | 🟡 Medium | PHI cached in `localStorage` survives logout on a shared workstation | Deferred — policy decision |
| 16 | 🟡 Medium | Patient identity keyed by name only; no patient identifier | Deferred — needs data model |
| 17 | 🟡 Medium | Chair beacon sessions held in an in-memory `Map` | Deferred — needs persistence |
| 18 | 🟢 Low | Transcript read-modify-write race (lost lines under rapid speech) | Deferred |
| 19 | 🟢 Low | Two claims in repo docs were false | **Fixed** |
| 20 | 🟢 Low | `express-rate-limit` now unused as a direct import | Deferred — hygiene |

---

## 1. 🔴 Sign-in permanently locks the account out after any credential change

**Where** `server.ts` — `generateToken` / `issueSessionToken`, login, register.
**Fixed.** Two regression tests added.

`generateToken` defaulted `epoch` to `0`, and login minted its payload without the field:

```js
epoch: Number(payload.epoch ?? 0)                 // generateToken
const token = generateToken({ dentistId: dentist.id, name, specialty })   // login — no epoch
```

`authenticateToken` then rejects any token whose epoch differs from the account's:

```js
if (Number(decoded.epoch ?? 0) !== dentistEpoch(dentist)) return res.status(403)…
```

`bumpDentistEpoch` advances that epoch on **change-PIN, sign-out-everywhere, credential recovery
and operator lockout**. So the first time a clinician used any of those, they could sign in
(HTTP 200, token returned) and then **every subsequent request returned 403 `SESSION_SUPERSEDED`,
forever**. Only a recovery token could be issued, and it doesn't help, because login still minted 0.

This was reachable through ordinary UI, and it was invisible to the suite because the existing test
stopped one assertion short — it asserted `login.status === 200` and never used the returned token.
`grep -rn "epoch" tests/` returned nothing.

**Fix:** all mint sites now go through `issueSessionToken(dentist)`, which reads the epoch from the
record, so a caller cannot forget it. The dead, shadowed duplicate handlers that had the same bug
were deleted (finding 12).

**Tests:** the PIN-change test now uses the token login returns, asserts the claim's `epoch >= 1`,
and a second test covers revoke-all → sign-in → working session.

---

## 2. 🟠 Governance bypass with a query string

**Where** `src/server/recordGovernance.ts`.
**Fixed.** 1 regression test.

The middleware decided whether it applied by matching `req.originalUrl` against patterns anchored
with `$`:

```js
const isConsultationUpdate = (method === 'PUT' || …) && /^\/api\/consultations\/[^/?]+$/.test(originalUrl);
```

`originalUrl` includes the query string, so one parameter defeated all three patterns and the
middleware returned early — while Express still served the route, because route matching ignores the
query. Verified by executing the patterns:

| URL | write | update | readClinic |
|---|---|---|---|
| `/api/consultations` | ✅ | – | – |
| `/api/consultations?x=1` | ❌ | ❌ | ❌ |
| `/api/consultations/abc?x=1` | ❌ | ❌ | ❌ |

**Blast radius:** with `DENTAI_REQUIRE_CONSENT=true`, consent enforcement was opt-out from the
client side; append-only revisions, retention stamps, the optimistic-concurrency 409 guard and APP 6
read auditing were all skipped as well.

**Fix:** decisions now run against the query-stripped path, and the audit label uses that form too.

---

## 3. 🟠 The grounding engine cleared hallucinated teeth

**Where** `src/lib/transcriptGrounding.ts`.
**Fixed.** 3 regression tests.

Two independent defects, both confirmed by execution:

```
extractToothNumbers("your lower left molar")                → ["16", "36"]     // 16 invented
extractToothNumbers("see you in 16 weeks, 24 hours, age 36")→ ["16","24","36"]  // none are teeth
```

- The quadrant check was `normalized.includes('ur')`, which also matches **your**, sure, during,
  burn — so any sentence containing "your" invented tooth 16.
- Bare 2-digit numbers 11–48 were read as FDI codes, so "16 weeks", "24 hours" and "age 36" became
  teeth.

Because the same loose rule ran over **both** the note and the transcript, an unrelated number in the
conversation *grounded* a fabricated tooth:

```
note:       "Extraction of tooth 16 performed."
transcript: "see you in 16 weeks for a review"
before →    tooth 16 GROUNDED; only "Extraction" flagged
after →     tooth 16 UNVERIFIED (score 0, needs review)
```

This is a mechanistic explanation for the pilot's "the notes were not accurate" complaint, and it
inverted the module's central promise: the amber "unspoken items" banner systematically
under-reported.

**Fix:** extraction is now conservative. A number is a tooth only with an explicit introducer
(`tooth 16`, `#48`, `FDI 24`), FDI-with-surface notation (`24 MOD`), or a quadrant phrase matched on
word boundaries within one clause. Recall is intentionally traded for precision — a missed tooth
simply doesn't appear, whereas an invented one certifies treatment that never happened. Surface
verification (`DENTAL_SURFACES`, previously declared and unused) is now implemented for full words
only, since two-letter surfaces (MO, DO) collide with ordinary English.

---

## 4. 🟠 An unverifiable note reported as "100% transcript-grounded"

**Where** `src/lib/transcriptGrounding.ts`.
**Fixed.** 1 regression test.

```js
const groundingScore = totalEntities > 0 ? … : 100;   // 0 entities → 100, isFullyGrounded: true
```

A note with nothing recognisable in it scored 100% and the summary asserted *"All teeth, treatments,
and drugs were verified against spoken operatory dialogue."* `isFullyGrounded` drives
`noteOrigin.needsReview` in the worker, so **the least specific notes were the ones least likely to
be flagged for review**. Now zero recognisable entities reports score 0, `isFullyGrounded: false`,
and a summary that says nothing could be cross-checked.

---

## 5. 🟠 Fabricated dialogue persisted as clinical evidence

**Where** `src/components/DayScheduleQueue.tsx`, `src/components/ChairsideWorkspace.tsx`.
**Fixed.**

When the microphone captured nothing, the recorder substituted a scripted encounter and submitted it
as the consultation transcript:

```js
const finalTranscriptText = liveTranscript.trim() ||
  `Consultation recorded for ${patientName} (${procedure}). Full clinical examination performed.`;
const transcriptItems = [
  { sender: 'Dentist', text: `Good morning ${patientName}, let's begin your appointment for ${procedure}.` },
  { sender: 'Dialogue', text: finalTranscriptText },
  { sender: 'Dentist', text: `All procedures completed. We will review your recovery…` }
];
```

The transcript is the evidence a note is grounded against, so the pipeline became: invent a
transcript → generate a note from it → verify the note against the invention → show the clinician a
green "verified from audio" badge. The stored record asserted an examination that never happened.
Two more instances: the daysheet importer wrote `"Imported from PMS daysheet for X."` as a
consultation transcript *and* asserted `treatmentPerformed` plus `chiefComplaint` for treatment that
had not occurred, and the durable worker defaulted `dob` to `1900-01-01`.

**Fix:** the recorder fails the row with a plain-English message when nothing was captured (the
server already rejects an empty transcript); the daysheet importer now creates the **schedule entry
only** — a daysheet row is an appointment, not a record; the worker leaves `dob` empty. Fabricated
identity fallbacks (`|| 'dentist-01'`, `|| '1900-01-01'`, client-side `'1990-01-01'`) are gone — an
absent value stays visibly absent.

---

## 6. 🟠 Rate limiting collapses to one shared bucket in production

**Where** `server.ts`.
**Fixed.** 1 regression test.

Every per-address limiter keys on `req.ip`, and there was no `app.set('trust proxy', …)` anywhere.
Behind Vercel the socket peer is the platform edge, so **every practice on the deployment shared one
counter** — a handful of users could exhaust the credential budget (30 / 15 min) and lock sign-in
out for everyone. `express-rate-limit` additionally reports a validation error when
`X-Forwarded-For` is present but untrusted. Compounding: `generationLimiter` — the expensive path —
was still a bare `express-rate-limit` instance with a per-process store, i.e. "60 per instance",
which is not a limit when there are twenty instances.

**Fix:** `trust proxy` is declared as a **hop count** (default 1, overridable with
`DENTAI_TRUST_PROXY_HOPS`) — never `true`, because trusting every hop lets a client spoof
`X-Forwarded-For` and choose its own bucket. The generation limiter now uses the same durable counter
as the rest.

---

## 7. 🟠 Horizon filter silently dropped post-op advice

**Where** `src/server/payloadValidation.ts`.
**Fixed** (vocabulary + documentation).

`clinicalHorizonFilter` finds the last utterance matching a keyword list and truncates everything
more than 15 utterances past it. Ordinary aftercare language contains no procedure vocabulary — "keep
the gauze in for half an hour", "no smoking tonight", "the script is at reception" — so a genuine
post-op handover after the last recognised keyword was **removed from the transcript before note
generation, with nothing reporting it**. The module and `AGENTS.md` claimed it "guarantees zero loss
of clinical findings or post-op instructions", which the implementation cannot deliver.

**Fix:** a dedicated `AFTERCARE_TRIGGER_REGEX` was added so aftercare language is never treated as
room noise, and the documentation now states the heuristic's actual limits rather than a guarantee.
Cost control is preserved (the >15-utterance rule is unchanged, and the existing runaway-audio test
still passes).

---

## 8–9. 🟡 Daily allowance reset mid-shift; records filed on the wrong day

**Where** `src/lib/noteJobs.ts`, `server.ts`.
**Fixed.** 1 new test + 1 updated.

`meteringDay()` bucketed on `now.toISOString().slice(0,10)` — UTC. For an Australian practice the
"40 notes for today" allowance therefore reset at **10–11am local**, mid-shift, and one clinic day
straddled two buckets. Separately, the durable worker stamped persisted records with
`getTodayStr(new Date(job.createdAt))`, which reads the *host* clock — UTC on serverless — so a 9am
Sydney appointment was filed on the previous day, while the client stamping the same record used
browser-local time.

**Fix:** new clinic-timezone helpers in `src/utils/date.ts` (`getConfiguredClinicTimeZone`,
`getClinicDayKey`, `getClinicDayLabel`, `getClinicTimeLabel`), driven by `DENTAI_CLINIC_TIMEZONE`
(default `Australia/Sydney`, unparseable values ignored rather than thrown). Metering buckets and
record stamps both use them. The existing test asserting UTC bucketing was rewritten to assert clinic
bucketing, with the DST rollover pinned explicitly.

---

## 10–13. 🟡 Dead route, duplicated handlers, invented identity, wrong locale

- **Dead endpoint (`server.ts`).** `/api/day/import-screenshot` registered an 8 MB body parser but
  **no handler existed anywhere in the repo** — and it was shadowed by the global 1 MB parser anyway,
  since Express parses the body once. Removed.
- **Shadowed duplicate handlers (`server.ts`).** `/api/auth/change-pin` and
  `/api/auth/recovery/redeem` were defined twice; `sessionSecurity.ts` registers first, so the copies
  in `server.ts` were unreachable dead code that had drifted — both minted tokens without the epoch
  (finding 1) and both rewrote the PIN through an epoch-bumping upsert. Deleted, with a comment
  pointing at the authoritative module.
- **Invented identity.** See finding 5.
- **Locale (`ChairsideWorkspace.tsx`).** `recognition.lang = navigator.language || 'en-AU'` meant any
  machine set to en-US/en-GB transcribed with US/UK phonetics, undermining the dental lexicon and the
  dialect-resilience claim on exactly the hardware practices own. Pinned to `en-AU` for the
  Australian market (now also documented, so the next market makes a deliberate change).

---

## 14. 🟡 Legacy 1,000-iteration PIN hashes stayed weak forever

**Where** `server.ts` (sign-in path).
**Fixed.** 1 regression test.

`verifyPinHash` accepts a legacy 1,000-iteration hash so that hardening the policy didn't lock
existing clinicians out — but nothing ever rewrote the stored hash. A pre-hardening account
therefore stayed at roughly 10⁴ PBKDF2 operations for a 4-digit PIN, which is moments to
brute-force if the stored hash ever leaks.

**Fix:** the first successful sign-in at the current iteration count rewrites the credential
(`pin_hash_upgraded` in the audit trail). A failure in that step is logged and ignored — a
maintenance action must never block a clinician signing in. The test seeds a legacy hash directly
into the throwaway users store, signs in, and asserts the stored hash is rewritten at 210,000
iterations.

---

## 15–20. Deferred, with reasons

These are real and should land before scale, but each needs a product decision or a data-model
change that should not be smuggled into a hardening pass. Recommended order given.

| # | Item | Why deferred / what it needs |
|---|---|---|
| 15 | **PHI in `localStorage`.** Full consultations (names, DOB, transcripts) are cached under `dentai_consultations_<dentistId>` and `clearAuth()` deliberately leaves them, on a product whose whole model is a *shared chairside workstation*. `saveLocalConsultations` also writes an unbounded array, so a busy practice will hit the ~5 MB quota and the `catch` silently kills the offline fallback. | Genuine policy decision: clearing the cache trades offline recovery. Recommended: clear the cache on explicit logout, keep only the in-progress intake, and cap/trim the cached history. |
| 16 | **No patient identifier.** Prior-visit history matches on first + last name only, so two patients named "John Smith" inherit each other's clinical history at the chair, and DOB is now empty everywhere (correctly, but nothing replaces it). | Needs a patient/identity model. This is the largest item and arguably the most important for clinical safety at multi-practitioner practices. |
| 17 | **Chair beacon sessions in an in-memory `Map`** (`chairSessions`) with a non-constant-time signature compare. | Directly contradicts the repo's own serverless rule (in-memory session maps produce random logouts across instances). Needs a DB-backed store. |
| 18 | **Transcript read-modify-write race.** `handleAppendTranscriptText` reads `consultationsRef.current`, which only syncs after render; two results arriving before React flushes both read the same base, so the second save drops the first line from the persisted transcript. | Bounded and low-frequency, but the loss is in the transcript the AI generates from. Fix by appending against the server copy (or a functional state update) rather than a lagging ref. |
| 19 | **False documentation claims.** | **Fixed** — `AGENTS.md` rules 5 and 7 were corrected (Bun lockfile, horizon heuristic) and rules 10–12 added covering the epoch, path matching and "never synthesise clinical evidence"; `PROJECT_CONTEXT.md` was corrected (Bun commands, React 19, `gemini-3.6-flash`, accurate module map, accurate guardrails). |
| 20 | **`express-rate-limit` is now an unused direct import** after finding 6. | Hygiene only; removing it means regenerating `bun.lock`. Left in place deliberately. |

---

## What this pass does *not* prove

- **No live end-to-end verification of the AI pipeline.** The clinical eval gate passes (3/3, score
  1.0) but it runs against fixtures, not against a real Gemini key with real speech. Findings 3–5
  change what the *verifier* reports; they do not improve transcription.
- **The dominant accuracy limitation is still upstream.** Capture is the browser Web Speech API: no
  dental vocabulary biasing, no diarization, and it drops audio on every recogniser restart. No
  amount of prompt or verifier work recovers a tooth number that was never transcribed correctly.
  Settle transcription before making any further accuracy claim to a practice.
- **The UI changes are typechecked, not eyeballed.** The recorder's new "no speech captured" state and
  the daysheet importer's schedule-only behaviour use existing patterns and Tailwind classes, but the
  preview was not run.
- **Postgres behaviour is unverified here.** The postgres suite skips without `DATABASE_URL`, and the
  migration/epoch/claim code paths differ between JSON and Postgres modes.

## Go-live gate

Nothing in this document replaces the operational checklist
(`docs/operations/au-go-live-checklist.md`): a Sydney-region Neon project, production secrets,
an external scheduler hitting `/api/cron/drain` (Hobby-plan Vercel only permits daily crons), an
uptime monitor on `/api/health`, and one rehearsed backup/restore. Finding 6 in particular should be
confirmed against the real deployment (check that `req.ip` differs between clients) before the first
practice is onboarded.
