# ANTIGRAVITY PROMPT — PMS adapter layer, inbound webhook authentication, clinical audio hardening

Copy everything from here down into Antigravity. It is a clinical product handling real patient records; treat every claim about a third-party system as **unverified unless a source is in the repo**.

---

## §0. GUARDRAILS (read first)

1. **SYNC FIRST.** `git fetch origin --prune && git checkout <the branch under review> && git pull --ff-only`. **State the exact commit you are working on.** If a file or symbol named below is absent or has a different shape than described, STOP and report — do not invent an equivalent.
2. **DO NOT INVENT PM SYSTEM CAPABILITIES.** This is the single most important rule. You know nothing about what Dental4Windows, EXACT, Cliniko, Core Practice, Open Dental or Dentrix actually allow unless the repo says so. Their capability entry must default to **clipboard + file only**. If you are tempted to mark `noteWrite: true` because an API "probably exists", that is the exact failure this task exists to prevent — see §7.
3. **THE ADAPTER SITS BELOW THE SAFETY GATES.** An adapter receives an already identity-resolved, grounding-verified, **clinician-approved** note. It must never resolve a patient, choose a chart id, propose or alter item codes, or write to a record unattended. Those live in `src/lib/patients.ts`, `src/lib/transcriptGrounding.ts` and `src/lib/dentalLibrary.ts` and must not be touched.
4. **NO CHANGE IN BEHAVIOUR WITHOUT SAYING SO.** The existing copy path must keep producing the same clinical content, and the existing capture flow must keep behaving the same for a clinician. If anything observable changes, state exactly what changed and why.
5. **PROVE IT.** Paste real command output for every verification step. "Tests pass" with no pasted output is not a result. **Never fabricate output.**
6. **DO NOT TOUCH THE SESSION/AUTH TOKEN SYSTEM, BILLING, OR THE DATABASE SCHEMA.** `issueSessionToken`, `sessionEpoch`, the PIN/lockout policy, `src/server/billing.ts`'s Stripe flow and every migration are out of scope. **The one exception** is the signature gate you add in front of `POST /api/webhooks/pms-booking` (§5) — that is a self-contained new control on one route, not a change to how sessions work. Do not extend it to any other route.
7. **NO NEW DEPENDENCIES.** This is pure TypeScript. Do not add a package. No `stripe` SDK, no `body-parser`, no HMAC helper library — Node's `crypto` and what is already imported are sufficient.
8. **THREE INDEPENDENT WORKSTREAMS.** A = PMS adapter layer (§2–§4). B = inbound PMS webhook authentication (§5). C = clinical audio & beacon hardening (§6). They do **not** depend on each other. Do them in order, keep each one green on its own, and report each separately. If you run out of budget, finish an earlier workstream cleanly rather than half-finishing all three.

**STACK.** Bun; React 19 + Vite; Express 4 + Node ≥ 22 (`server.ts` is both the API and the note worker); Vitest with `--fileParallelism=false`; TypeScript `tsc -b --noEmit`.

**BASELINE TO MATCH.** `tsc` clean · **384 passed / 23 skipped**. Both numbers must still hold (plus whatever you add). Re-run the baseline yourself before changing anything and report the number you actually measured.

---

## §1. WHAT ALREADY EXISTS — BUILD ON IT, DO NOT DUPLICATE IT

Read these before writing anything.

**Formatting / export (Workstream A):**

- **`src/lib/noteExport.ts`** — pure formatters that already exist and are unit-tested:
  - `consultationToPlainText(consultation, opts)` — multi-line clinical text
  - `consultationToPmsText(consultation)` — compact `Label: value` layout for a PMS note field
  - `consultationsToCsv(consultations)` / `csvToString(exported)` — spreadsheet export with the formula-injection guard
  - `sectionsFor(consultation)` — resolves the template's sections, falling back to `STANDARD_SECTION_ORDER`
  - `exportFilename(prefix, at)`
- **`src/server/clinicExport.ts`** — the practice-initiated export route (`/api/clinic/export`), already audited.
- Evidence: **`docs/reviews/d4w-integration-route-patientdesk.md`** and **`docs/reviews/d4w-integration-evidence-hotdoc.md`** — why every capability defaults to clipboard. **Cite these in code comments.**

**Webhook / signature primitives (Workstream B) — all of these already exist, reuse them:**

- **`server.ts:196-197`** — the global `express.json({ verify })` hook already records the exact received bytes as **`req.rawBody`**. Stripe signatures depend on it. **Do not add a second body parser or `express.raw`.**
- **`src/server/billing.ts` → `verifyStripeSignature()`** — the house pattern: parse `t=`/`v1=` from the header, sign `${timestamp}.${payload}`, enforce a **300s tolerance**, compare constant-time. **Mirror this shape**; it is exported and pure so it can be tested with a documented fixture.
- **`server.ts:2336` → `signaturesMatch(a, b)`** — the existing constant-time comparison helper in `server.ts` (an early-exit `===` leaks how much of a forged signature was right). Reuse it.
- **`src/server/durableRateLimit.ts`** — the durable rate limiter. The new gate must use this, not an in-memory map (see `PROJECT_CONTEXT.md` guardrail 1 on serverless).
- **`src/server/opsRoutes.ts` → `createOpsSession` / `verifyOpsSession`** — a worked example of "sign a payload with a server secret, never hand the secret to the client, verify constant-time, honour expiry."
- **`docs/operations/environment-reference.md`** — every env var is documented here. Your new secret goes in, **name only, never a value**.

**Capture / standby (Workstream C) — this is hardening of code that already exists:**

- **`src/components/ChairsideWorkspace.tsx`**
  - `1113-1156` — the **existing** adaptive silence sleep: `silenceSec >= 180` auto-pauses, `>= 150` raises `isSilenceWarning` + the 784 Hz double-pip via `playMedicalChime('warning')`, gated by `hasPlayedWarningChimeRef`.
  - `565` `handleKeepListening`, `~641` the spacebar/[Keep Listening] reset, `939` / `1070` the `lastVoicedTimeRef` resets on voiced speech.
  - `380` `isMicStandby` starts `true`; `599` `handleStopAudioToStandby`; `1479-1483` `handleFinalizeNote` drops to standby; `1500-1535` `handleNextPatient`; `1161` the visibility catch-up listener.
- **`server.ts:4946`** — `POST /api/beacon/chair/:chairId/upload-chunk`: appends a chunk to the **chair session**; the only check is that the session exists.
- **`server.ts:4677` / `4692`** — `generateChairToken` / `verifyChairToken` already exist and are **not** called by the upload route.
- **`src/server/chairSessionStore.ts`** — durable chair sessions + chunks (including the per-appointment size refusal).
- **`src/lib/beaconAudioStorage.ts`** — the phone keeps its own IndexedDB copy, so a refused upload is not a lost appointment.
- **`PROJECT_CONTEXT.md` guardrail 9** (silence sleep + pre-pause cue) and **guardrail 11** (cross-patient boundary isolation & forced standby) are the written policy you are enforcing. Quote them in the code you touch.

---

## §2. WORKSTREAM A — BUILD: one canonical model, a capability registry, one interface, clipboard renderers only

**There is no `src/lib/pms/` directory yet.** You are creating it.

### §2.1 `src/lib/pms/canonical.ts`

A PMS-agnostic encounter document and a **pure** mapper from the existing type.

- `export interface PmsEncounter { ... }` — the clinically meaningful fields only: patient display name + dob, appointment type, date/time, the ordered section list (label + value), proposed item codes, clinician/practitioner, and the note-review flag. Derive it from what `noteExport.ts` already reads; add nothing that isn't in `Consultation`.
- `export function toPmsEncounter(consultation: Consultation): PmsEncounter` — pure, no IO, reuses `sectionsFor` and `patientDisplayName` rather than re-deriving them.

### §2.2 `src/lib/pms/capabilities.ts`

- `export type PmsChannel = 'clipboard' | 'file' | 'appointmentWrite' | 'noteWrite' | 'invoiceWrite'`
- `export interface PmsCapability { id; name; region; channels: Record<PmsChannel, boolean>; source: 'unconfirmed' | 'vendor-confirmed' | 'public-api-docs' }`
- `export const PMS_REGISTRY` with entries for **Dental4Windows, EXACT (Software of Excellence), Cliniko, Core Practice, Open Dental, Dentrix**.
- **Every entry:** `clipboard: true, file: true`, and **`appointmentWrite: false, noteWrite: false, invoiceWrite: false`, `source: 'unconfirmed'`**.
- A prominent header comment: *these flags are false because no vendor has confirmed the capability; the repo has evidence that the on-premise route is not a file drop (`docs/reviews/d4w-integration-evidence-hotdoc.md`) and that the incumbent writes bookings, not clinical notes (`docs/reviews/d4w-integration-route-patientdesk.md`). Change a flag only when a written vendor answer is recorded in the repo.*
- `export function capabilityFor(id: PmsId): PmsCapability` and `export function isSupported(id, channel): boolean`. **Unknown id must fall back to clipboard-only, never to "assume everything".**

### §2.3 `src/lib/pms/adapter.ts`

- `export interface RenderedNote { format: 'text' | 'csv'; body: string; filename?: string }`
- `export interface PmsAdapter { id: PmsId; capability: PmsCapability; render(encounter: PmsEncounter, opts?: {...}): RenderedNote; commit?(...): Promise<...> }`
- `export function renderForPms(id: PmsId, encounter: PmsEncounter): RenderedNote` — dispatches; for an unknown id returns the generic clipboard rendering.
- `export function renderAppointment(id, ...)` (or equivalent) that **throws a clear error** when `!isSupported(id,'appointmentWrite')`. This is the point: an unsupported action fails loudly in a test instead of silently pretending.

### §2.4 `src/lib/pms/adapters/*.ts` — clipboard renderers only

- One **generic** renderer that produces the compact `Label: value` layout (you may delegate to / mirror `consultationToPmsText`).
- Per-PMS renderers for **Dental4Windows, EXACT, Cliniko, Core Practice** that adjust only *presentation* (header line, item-code formatting, plain vs bold labels). **No network. No filesystem. Pure functions.**
- Do **not** create `d4wExport.ts`, a watch-folder writer, an RTF-with-manifest generator, or any Cliniko/API client. See §7.

---

## §3. WORKSTREAM A — INTEGRATE: route the existing flow through the dispatcher, and make the label honest

1. **Route the copy/export path** through `renderForPms(...)` instead of calling a formatter directly, so future PMS additions are additive. Preserve current clinical content.
2. **Expose the capability** to the UI: a selector/label can list `PMS_REGISTRY` and show what each supports. **Nothing in the UI may claim an integration, sync, write-back, or verification the registry marks `false`.** If existing copy in `ChairsideWorkspace.tsx` (e.g. the PMS guide tab) or the demo/landing says *"Sync to D4W"*, *"PMS-verified"* or similar, do not add to it — and if you touch it, make it match the registry. Do **not** rewrite `Landing.tsx` / `src/demo/Scenes.tsx` copy in this task; those have a separate pending patch (`docs/reviews/claims-fix-applied-and-pending.md`).
3. Keep `noteExport.ts` as the shared formatter layer — the adapters build on it, they do not fork it.

---

## §4. WORKSTREAM A — TESTS

Add `tests/pmsAdapters.test.ts` (pure, no network, no server):

1. **Golden fixtures.** For each adapter, a fixed `PmsEncounter` → the exact expected string. Assert equality. This is what makes "fast" real.
2. **Registry invariant.** Assert that **no** entry has `(noteWrite || appointmentWrite || invoiceWrite) === true` unless `source !== 'unconfirmed'`. If someone later flips a flag with no recorded vendor answer, this test fails.
3. **Unknown id is safe.** `capabilityFor('made-up-pms')` → clipboard-only, and `renderForPms('made-up-pms', ...)` returns the generic rendering rather than throwing or guessing.
4. **Unsupported action refuses.** Calling the appointment/note/invoice renderer for a registry entry whose flag is false throws the documented error.
5. **No fabrication in output.** A fixture where item codes are **absent** must render **no** item-code line (never an invented one), and a section with no value must be omitted, matching the existing `noteExport` behaviour.

Run: `bunx vitest run tests/pmsAdapters.test.ts --fileParallelism=false --test-timeout=30000` — **paste the output.**

---

## §5. WORKSTREAM B — AUTHENTICATE THE INBOUND PMS BOOKING WEBHOOK

### §5.0 The problem, stated precisely

`server.ts:3746` registers `POST /api/webhooks/pms-booking`. As it stands it has **no authentication and no signature verification of any kind** — the only thing in front of it is the global per-address API rate limiter (`server.ts:595`, `app.use('/api/', apiLimiter)`), and rate limiting is not authentication. Any caller who can reach the host can POST a body and cause the server to **update a patient's treatment opportunity and persist it**, crediting an audit entry. Three concrete consequences you must fix:

1. **Anyone can mark treatment as booked.** The only input is the request body.
2. **It matches on `patientName` by substring** against every consultation's `firstName lastName` — a *name-based* identity match, which is exactly what `PROJECT_CONTEXT.md` guardrail 12 and `src/lib/patients.ts` exist to prevent ("a patient's name is not their identity"). A call with `patientName: "Smith"` can match the wrong patient's opportunity.
3. **The JSON-store branch searches every consultation in the database** with no clinic scoping, so an unauthenticated caller can cause a write against **another clinic's** record.

**Do not redesign the endpoint's business meaning** (marking a `TreatmentOpportunity` booked and stamping `pmsType`/`pmsAppointmentId`). Only put a correct gate in front of it and remove the two unsafe matching behaviours.

### §5.1 Create `src/server/pmsWebhookAuth.ts` — exported, pure, unit-testable

Mirror `verifyStripeSignature` in `src/server/billing.ts` in spirit and shape.

```ts
export interface PmsSignatureCheckInput {
  secret: string;                 // DENTAI_PMS_WEBHOOK_SECRET
  header: string | undefined;     // x-dentai-signature
  payload: string;                // the RAW body (req.rawBody)
  toleranceSeconds?: number;      // default 300
  now?: () => number;
}
export type PmsSignatureCheckResult =
  | { ok: true; timestamp: number }
  | { ok: false; reason:
      | 'no_secret' | 'missing_header' | 'malformed_header'
      | 'timestamp_out_of_tolerance' | 'no_matching_signature' };

export function verifyPmsWebhookSignature(input: PmsSignatureCheckInput): PmsSignatureCheckResult;
```

- Header format, exactly one to implement: **`x-dentai-signature: t=<unix-seconds>,v1=<hex>`**, where `v1 = HMAC_SHA256(secret, "<t>.<rawBody>")` as **lowercase hex**.
- Compare with the existing **`signaturesMatch()`** helper (or an equivalent length-checked `crypto.timingSafeEqual`). **Never `===`.**
- **Fail closed and never throw.** A missing secret, a missing header, garbage, a stale timestamp — each returns a distinct reason, never "ok".
- Export a small `signPmsWebhookPayload(secret, rawBody, now)` helper so a test can produce a valid fixture without duplicating the format string. It is fine for this to be exported for tests only; say so in the doc comment.

### §5.2 Wire the gate into the route

In `server.ts`, before any body field is read:

1. **Secret unset** → `503` `{ error: 'Webhook not configured.', code: 'WEBHOOK_NOT_CONFIGURED' }` and a `logger.warn`. **Never** fall through to processing because configuration is missing, and do not crash the process at boot (every other route must keep working without this secret).
2. **Signature missing/invalid/stale** → `401` `{ error: 'Invalid signature.', code: 'INVALID_SIGNATURE' }`. Do not echo the expected signature, the secret, or the received payload back. Do not distinguish "unknown secret" from "bad signature" in the response body (log the specific reason server-side instead).
3. Read the raw body from **`req.rawBody`** (it is already captured globally at `server.ts:196-197`). If `req.rawBody` is undefined, treat it as `no_matching_signature` — a signature computed over a re-serialised object is not proof.
4. **Confirm the rate limit, do not duplicate it.** The route is already covered by the global durable limiter at `server.ts:595` (`app.use('/api/', apiLimiter)`), because it is registered earlier in the file than the route, and Express applies middleware in registration order. Verify that ordering still holds and **state it in your report** — do not add a second limiter to this path, and do not move the route above line 595.
5. Use `logAudit(...)` for **both** outcomes with the specific reason code (`pms_webhook_rejected` with `reason`), and **never** log the payload, patient name, or any clinical content.

### §5.3 Remove the two unsafe matching behaviours

- **Require a stable id.** Matching is by `opportunityId` **only** — that is the id the app issued. If the request carries no `opportunityId`, respond `400` `{ code: 'OPPORTUNITY_ID_REQUIRED' }`. **Delete the `patientName` substring fallback** in both the Postgres and JSON branches. A name is not an identifier; do not replace it with a different fuzzy match, and do not add a lookup by name "to be helpful".
- **Scope the write to a clinic.** Require `clinicId`, resolve it with the existing clinic-scope resolver, and search only that clinic's consultations. The JSON branch must stop scanning the whole database. If the resolved opportunity's `clinicId` does not match the request's, refuse (`403`/`404`) rather than writing.

### §5.4 Do not trust the caller's clock

- `bookedAt` currently comes straight from the body (`new Date().toISOString()` only as a *default*). Validate it is an ISO-8601 string; if absent or invalid, use the server receipt time. Never let an unvalidated string be persisted as a clinical timestamp, and never derive a clinic-day label from the host clock — use `src/utils/date.ts` if a label is needed (`PROJECT_CONTEXT.md` guardrail 7).

### §5.5 Documentation

- Add **`DENTAI_PMS_WEBHOOK_SECRET`** to `docs/operations/environment-reference.md` — **name, purpose and safe production value only; never a real value** — and note that the route is unusable (503) until it is set.
- Add a short note in the same file showing the exact `curl` a PMS/Zapier can use, including how to compute the signature. A connector that cannot be configured correctly will be worked around, and this control would be the thing that gets disabled.

### §5.6 Tests — `tests/pmsWebhookAuth.test.ts`

Pure unit tests for `verifyPmsWebhookSignature` (no server), plus route-level tests using the existing supertest setup:

1. A payload signed with the secret and a current timestamp → `ok: true`.
2. **Tampered body** (signature valid for body A, request carries body A+1 byte) → `no_matching_signature`.
3. **Missing header** → `missing_header`; malformed header → `malformed_header`.
4. **Wrong secret** → `no_matching_signature`.
5. **Timestamp older than the tolerance** → `timestamp_out_of_tolerance` (inject `now`; do not sleep).
6. **Empty secret** → `no_secret`, and the route returns **503**, not 200/401.
7. **Route rejects unsigned POST** with `401` and the opportunity is **unchanged** — assert the stored record was not mutated. A test that only checks the status code does not prove the write was refused.
8. **Replay / idempotency.** Record an event id (from an `x-dentai-event-id` header, or the signature + timestamp if you prefer — state which) and assert a re-sent identical signed request does not apply the mutation twice.
9. **Name-only request is refused** (`OPPORTUNITY_ID_REQUIRED`), proving the substring match is gone.
10. **Cross-clinic opportunity id is refused** and the other clinic's record is untouched.

---

## §6. WORKSTREAM C — CLINICAL AUDIO & BEACON HARDENING

This is **hardening of behaviour that already exists**, not a rewrite of the cockpit. Both policies are already written down in `PROJECT_CONTEXT.md` (guardrails **9** and **11**); the job is to make them enforced in one place, provable by a test, and true on **both** audio paths (cockpit mic and phone beacon).

### §6.1 Extract the silence policy into a pure, tested module

The 3-minute rule is currently implemented **inside a `useEffect` closure** in `ChairsideWorkspace.tsx` (`1113-1156`) with the numbers `180` / `150` / `784` inline. That means it cannot be unit-tested and cannot be shared with the beacon path.

- Create **`src/lib/silencePolicy.ts`**:
  - `export const SILENCE_WARN_SECONDS = 150;`
  - `export const SILENCE_SLEEP_SECONDS = 180;`
  - `export const SILENCE_WARN_CHIME_HZ = 784;`
  - `export type SilenceAction = 'none' | 'warn' | 'pause';`
  - `export function decideSilenceAction(silenceSeconds: number): SilenceAction` — pure; `>= 180` → `'pause'`, `>= 150` → `'warn'`, else `'none'`. Define and document the boundary behaviour (exactly 150 → warn, exactly 180 → pause).
- **Refactor `ChairsideWorkspace.tsx` to call it.** The component keeps the state, the chime and the `hasPlayedWarningChimeRef` one-shot latch; the *decision* comes from the module. Do not change the observable behaviour: still auto-pause at 3:00, still warn at 2:30, still one chime per silence window.
- **Check the beacon path.** Determine whether the phone beacon (`PhoneBeaconMode.tsx` / `src/lib/beaconAudioStorage.ts`) applies any equivalent inactivity pause. Report what you find. If it has one, route it through `decideSilenceAction` too so the two paths cannot drift. If it has none, **report that as a finding with `file:line` and do not silently add a new auto-pause to a phone mid-appointment** — that is a clinician-visible behaviour change that needs its own decision.

### §6.2 Make the silence timer's baseline correct and idempotent

Verify and state in your report:

- `lastVoicedTimeRef` is reset **when recording starts**, not left at a stale value from a previous appointment (an unreset baseline means a fresh recording can inherit "silence" that happened before the patient sat down).
- Auto-pause **fires at most once** per silence window, and the warning chime fires **at most once** per window (this is what `hasPlayedWarningChimeRef` is for — confirm it is reset in the right places, including on `[Keep Listening]`).
- Entering standby, pausing, or changing patient **clears** the warning state so it cannot survive into the next patient.
- If the mic is paused or in standby, the interval must not be counting silence at all (the guard is `isRecording && !isPaused && !isMicStandby` — confirm every path that reaches one of those states resets the warning).
- **Record what happens to buffered audio on auto-pause**: the chunk currently in flight must still be uploaded/retained, and nothing recorded before the pause may be dropped. If you find audio can be lost on the auto-pause boundary, report it with `file:line` — do not quietly change the recorder.

### §6.3 Enforce the multi-patient standby boundary on the server, not just in the UI

The client-side standby (`isMicStandby`, timer reset to `00:00`, stop chime, no auto-start) is correct and must stay. **The gap is the server.** `POST /api/beacon/chair/:chairId/upload-chunk` currently accepts chunks for any existing chair with **no chair token** and **no binding to a patient or consultation**, so a phone that is still uploading after the clinician has moved to the next patient appends the previous patient's audio to the same chair session.

- **Bind the chair session to a consultation.** When recording starts for a patient, record `consultationId` (and `patientId` when resolved) on the chair session. Chunks arriving with a different or absent `consultationId` than the session's active one are refused.
- **Require the chair token on chunk upload.** `verifyChairToken` already exists (`server.ts:4692`) and is not called here. A chunk without a valid, unexpired chair token is refused — the chair id and PIN alone are not a credential for writing clinical audio.
- **Close the previous consultation for ingestion on patient switch.** After a switch, late chunks for the prior consultation must be refused with a specific, non-clinical error code (e.g. `SESSION_CLOSED`) rather than appended. The phone keeps its own IndexedDB copy (`src/lib/beaconAudioStorage.ts`), so the client can be told to stop and nothing is silently lost — say so in the response, in the same plain language the existing size-limit refusal uses.
- **Refusal must be specific, not generic.** Return a distinct code so the phone can stop retrying and tell the user, rather than retrying forever against a 500. Never return a stack trace or a patient name in the error body.
- **Do not auto-start recording, and do not auto-assign a patient.** Guardrail 11: recording strictly requires physical clinician activation. Refusing a chunk must never cause the server to start or attach a recording.

### §6.4 Tests

Add **`tests/silenceAndStandby.test.ts`** (pure where possible):

1. `decideSilenceAction` golden cases: `0`, `149`, `150`, `151`, `179`, `180`, `600` → the documented action. Assert the constants are what the doc says (`SILENCE_SLEEP_SECONDS === 180`), so a future edit that shortens the clinical sleep fails loudly.
2. **Chime is one-shot per window**: driving the decision across a `'warn' → 'warn' → 'pause'` sequence produces exactly one chime (test the latch logic, not the Web Audio node).
3. **Standby boundary rule** as a pure decision: given the session's active `consultationId` and an incoming chunk's `consultationId`, the verdict is `accept` / `refuse('PATIENT_MISMATCH')` / `refuse('SESSION_CLOSED')`. Cover the same-id, different-id, absent-id and closed-session cases.
4. **Route-level**: a chunk with no chair token is refused; a chunk for a consultation other than the session's active one is refused **and the stored chunk count does not increase**; a valid chunk is still accepted (so the fix is not simply "reject everything").

---

## §7. EXPLICIT NON-GOALS (building any of these is a failure of this task)

Applies to all three workstreams.

- **No D4W watch-folder / `AutoImport` writer / RTF+XML manifest.** No `import_manifest.xml`, no `<D4WImport>` schema. That mechanism is unverified and the evidence is against it.
- **No Cliniko / Open Dental / Dentrix API client.** No connector to any PMS whose write capability is `unconfirmed`.
- **No outbound webhook signing, no outbound PMS push.** Workstream B authenticates **inbound** requests only.
- **No new product copy claiming an integration, sync, write-back, or "verified" status.**
- **No new auth on any route other than `/api/webhooks/pms-booking`.** In particular do **not** put the new secret in front of beacon pairing, ops routes, or the chair command route — those have their own credentials and changing them is out of scope.
- **No change to `src/lib/patients.ts`, `src/lib/transcriptGrounding.ts`, `src/lib/dentalLibrary.ts`, the session/epoch token system, `src/server/billing.ts`'s Stripe flow, or any migration.**
- **No silent clinical-behaviour change.** If hardening would alter what a clinician sees (a new auto-pause, a changed timer, a new refusal the dentist is shown), report it as a finding and let it be decided rather than shipping it inside a "hardening" task.
- **No simulated or hardcoded success output.** Do not print a fake deploy URL, a fake signature, or a fake test summary.
- **Stay inside your workstream's files.** A: `src/lib/pms/**`. B: `src/server/pmsWebhookAuth.ts`, the one route in `server.ts`, `tests/pmsWebhookAuth.test.ts`, the env reference doc. C: `src/lib/silencePolicy.ts`, `src/lib/standbyPolicy.ts`, the capture path in `ChairsideWorkspace.tsx`, the beacon upload route and `chairSessionStore`, `tests/silenceAndStandby.test.ts`. Everything else you find goes in a short **"additional findings"** list with `file:line` — **do not fix it here.**

---

## §8. VERIFY, THEN DEPLOY

**Verify (paste real output for each):**

```
bun tsc -b --noEmit
bun run test          # must still run with --fileParallelism=false (the script sets it)
bun run eval:notes    # only if you touched anything that influences note content
```

Report: the tsc result, the full passed/skipped counts, and the difference from the baseline you measured at the start. Workstreams B and C change request handling and capture timing — "the suite still passes" must mean the **whole** suite, not just your new files.

**Deploy** — only after all checks pass and you have shown the diff (`git diff --stat`):

1. This app is a Vite client **plus an Express API** (`server.ts`, `api/index.ts`). It is **not** a static site. A static-only host serves the landing page and 404s every `/api/*` call.
2. Use the project's configured pipeline (`vercel.json` + `api/index.ts` are wired for Vercel — see `README.md`: `vercel` / `vercel --prod`).
3. **`DENTAI_PMS_WEBHOOK_SECRET` must be set in the deploy environment before the webhook is usable.** If you cannot set it, deploy anyway and state clearly that the route returns 503 until it is configured — do **not** weaken the gate to make something pass.
4. **If you cannot deploy because credentials, DNS, or a platform account are required, STOP and report that as a blocker with the exact command you ran and its output.** A missing credential is a normal outcome; do not simulate success, do not print an invented URL.
5. On success, report the **real** deployment URL and then confirm it actually runs the API: `curl -s <url>/api/health` must return `{"status":"ok",...}` with `storage: postgres`. Then confirm the gate is live: an **unsigned** `POST <url>/api/webhooks/pms-booking` must return **401** (or **503** if the secret is unset) — a `200` there means the fix did not deploy. A landing page that loads is not proof the app deployed.

---

## §9. REPORT BACK IN THIS SHAPE

Report **per workstream** (A, B, C) — a single blended summary is not acceptable.

1. **Commit** worked on (hash + branch) and confirmation the pre-existing working-tree changes were left intact.
2. **Files added / changed** (`git diff --stat`), split by workstream.
3. **Workstream A:** the capability registry as built — every entry, every flag, and the `source`.
4. **Workstream B:** the exact signature format implemented (header name, signed string, hashing, tolerance), the three refusal outcomes (503/401/400) with their codes, the two matching behaviours removed, and proof the replay guard works.
5. **Workstream C:** what the silence sleep and the standby boundary did **before** and do **after**, with `file:line`; whether the beacon path already had an inactivity pause; and any place where hardening would have changed clinician-visible behaviour, reported rather than shipped.
6. **Verification** — pasted `tsc`, test, and (if run) eval output; counts vs the baseline you measured.
7. **Integration** — the exact call sites changed, with confirmation that no clinical content changed and no clinical behaviour changed without being listed.
8. **Deploy** — real URL **or** the named blocker, with the command and output; plus the unsigned-POST result proving the gate is live.
9. **Additional findings** — anything out of scope, with `file:line`, unfixed.
10. **What is deliberately still false** — restate that D4W/EXACT/Cliniko write capability remains `unconfirmed` because no vendor has answered yet.

**One-line goal:** a pure, tested PMS adapter layer where every system defaults to clipboard-only; an inbound PMS webhook that cannot be called without a valid, non-replayed HMAC signature, that identifies a patient by the id we issued and never by name, and that cannot write across clinics; and capture hardening where the 3-minute silence sleep and the multi-patient standby boundary are enforced in one tested place on both the cockpit and the beacon, so one patient's audio can never be filed against another's record or honoured after anyone has said so.
