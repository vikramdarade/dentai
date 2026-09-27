# Phase 9 — Production Readiness (Production Hardening)

**Status:** COMPLETE — all exit criteria met; no critical safety defect open.
**Date:** 2026-09-27
**Scope:** Observability, reliability, idempotency, auditability, privacy, security, data lifecycle, recovery.
**Rule observed:** no new clinical reasoning was introduced; this phase hardened the existing architecture only.

---

## Entry criteria — verified before work began

| Criterion | Evidence |
| --- | --- |
| Phase 8 evaluation report passed | `docs/CLINICAL_EVALUATION_REPORT.md`; `eval:gold-set` 217 cases, 0 critical-error ledger entries |
| Critical error categories measured | Critical error ledger in the gold-set runner; Phase 9 adds PHI-free runtime counters |
| Phase 7 renderer stable | `docs/NOTE_RENDERING_CONTRACT.md`; 20/20 benchmark cases FULLY SATISFIED (2.0 ms synthesis) |
| Phase 6 verifier stable | `eval:notes` 3/3, score 1.000; fail-closed verification retained |
| Phase 5 fail-closed controls stable | `docs/PHASE_5_EXIT_AUDIT.md`; sign-off still refuses without an approving audit |
| No automatic unsafe sign-off path | `createAttestationSeal` fail-closed branch re-tested in Phase 9 (`signOffRejection` counter) |

---

## 1. Observability

New module: `src/lib/pipelineMetrics.ts` — a process-instance metrics registry, **PHI-free by construction**: every API accepts only stage enums, booleans, durations and ids. There is no parameter capable of carrying transcript or note text; a type-level test (`tests/pipelineMetrics.test.ts`) fails to compile the moment a free-text parameter is introduced.

**Stage latency** (per-stage bounded 100-sample histogram, p50/p95), recorded at these seams:

| Stage | Instrumentation site |
| --- | --- |
| `audio_ingestion` | `src/server/transcriptionRoutes.ts` — assemble + provider call window |
| `asr` | `src/server/transcription.ts` — inside `createAudioTranscriber`, success and failure |
| `extraction` | `runHostedGeneration` (server.ts) — failure path carries full duration; OpenAI-compatible path records `latencyMs` |
| `validation` | `finalizeHostedNoteOutput` — grounding + contradiction pass |
| `rendering` | `finalizeHostedNoteOutput` |
| `total` | worker job lifetime (claim → done/failed) and `finalizeHostedNoteOutput` |

**Tracked counters** (all keyed by outcome, never content): verification rate (`verificationRuns / casesWithFacts`, `null` before any case), verification triggers, `clinicianCorrection`, `contradictionFlags`, `extractionFailure`, `renderingFailure`, `asrFailure`, `audioIngestionFailure`, `validationFailure`, `signOffRejection`, `llmMalformedOutput`, `llmTimeout`, `providerTimeout`, `partialAsrTranscript`.

**Surfacing:** `GET /api/ops/telemetry` (operator secret or ops session; the legacy `/api/telemetry` remains retired with 401) now returns a `pipeline` section with `pipelineMetrics.snapshot()`, alongside the existing logger telemetry, queue depth and generation settings.

## 2. Reliability

Exercised in `tests/clinicalPipelineReliability.test.ts` (and pre-existing suites). Each mandated mode and its safe outcome:

| Failure mode | Safe outcome |
| --- | --- |
| Provider timeout | `withTimeout` rejects with a content-free timeout message; classified `llmTimeout`/`providerTimeout` |
| LLM failure | Non-quota hosted failure → failed `extraction` stage, terminal-visible job state after bounded retries (maxAttempts 4, capped exponential backoff 45 s → 6 min) |
| Malformed JSON | Classified `llmMalformedOutput` (parse/schema errors distinct from transport); job fails visibly, never renders a half-note |
| Partial ASR | Warnings returned to the clinician, `partialAsrTranscript` counter incremented, provenance records gaps |
| Missing transcript | 400 on both sync and async generation routes; empty transcript refused |
| Missing provenance | Degraded-success surfaced via warnings + counter; never silently accepted |
| Database failure | JSON fallback preserves the full audit chain; audit writes never throw upward; metering fails closed on transcription |
| Duplicate request | JSON job submission is now idempotent on consultation id (Postgres mode already `ON CONFLICT DO NOTHING`) |
| Retry | Quota retries back off exponentially and are capped; duplicate inserts deduped by id |
| Interrupted session | Stuck `processing` jobs requeued each tick (`dbRequeueStuckProcessingJobs`, 30-min window) |
| Browser disconnect | Worker persists the finished consultation under the submitted id; visible in History Hub at next sign-in |
| Server restart | All durable state (jobs, consultations, audit) on disk in `DENTAI_DATA_DIR`; chain verifies across restart |

## 3. Idempotency

- **Duplicate facts/procedures/evidence:** same-id job submission returns the same jobId without creating a second job (JSON mode fixed this phase; Postgres already `ON CONFLICT (id) DO NOTHING`); consultation persistence is deduped by id (`insertConsultationDeduped` / `ON CONFLICT`).
- **Clinician corrections preserved:** consent is append-only and revisions accumulate in `recordGovernance`; a retry re-submitting the AI draft cannot erase a clinician edit (verified by test).
- **Multiple sign-offs impossible:** sign-off is a property of the record's `attestation` seal, not a queued side effect; `recordVersion` optimistic concurrency refuses stale writers with 409 + server copy.

## 4. Auditability

The auditable chain per signed note: **audio/transcript → fact → evidence → validation → verification → rendered note → clinician correction → sign-off**.

- `notes_generated` (now emitted on **every** engine path at job completion), `note_job_submitted`, `note_job_consultation_persisted`, `transcription_completed`, `consultation_updated` events give the trail submission → generation → persistence for every note.
- Corrections appear as revision entries + `clinicianCorrection` counter; sign-off is the SHA-256 attestation seal whose `auditStatus` is fail-closed (`'Clinician Verification Required'` unless `groundingAudit.isApprovedForSigning === true`).
- The audit log itself is hash-chained (`src/lib/auditChain.ts`): tamper-evident content + link checks, branching reported separately from tampering, head hash published for witnessing.
- No link is faked: the grounding verdict is computed (`verifyTranscriptGrounding` → structured `groundingReport` with claim-level detail), never asserted; absent evidence fails closed.

## 5. Privacy

- **Logs:** audit payloads are ids/counts (asserted by test — no transcript phrases in `audit.json`); `logger` redacts by design; pipeline metrics cannot carry PHI (type-level guarantee).
- **Test fixtures:** synthetic only; reliability suite reads/writes a `mkdtemp` directory; server.test.ts forbids the developer's real data dir.
- **Git:** `.env.local` is not tracked; tests deliberately disable Postgres and real provider keys (`DATABASE_URL=''`, provider keys blanked *after* pre-loading dotenv so a developer's local config cannot leak into a test call).
- **Error telemetry:** minimised — messages are code text, never request bodies; `ERROR_WEBHOOK_URL` alerting carries counts only.
- **Debug logging:** structured logger with explicit levels; the ops console/telemetry is behind `DENTAI_OPS_SECRET`.
- **Development fixtures:** `src/demo` scenes are scripted synthetic patients; retention/de-identification primitives exist for real data (`retentionPolicy.ts`).

## 6. Security

Architecture unchanged (per instruction). Verified boundaries, all with pre-existing or new tests:

- **Authorisation:** session tokens, optional MFA step-up, PIN policy, login lockout (securityControls/sessionSecurity suites).
- **Patient/tenant isolation:** consultations scoped to owner; PUT/GET by foreign clinician → 404; clinic scope resolution honours only active memberships; jobs readable only by their owner.
- **API access:** rate limiting (proxy-hop aware, durable shared store), webhook HMAC + replay check, retired telemetry endpoint refuses anonymous reads.
- **Signed-note access / evidence / audit access:** record reads audited (`consultation_records_viewed`, APP 6); ops/audit surfaces operator-gated.

## 7. Data lifecycle

Explicit behaviour per artifact (retention sweep in `src/server/retention.ts` + `src/lib/retentionPolicy.ts`, off by default, dry-run default, 7-year horizon from `retentionPolicyFromEnv`):

| Artifact | Lifecycle |
| --- | --- |
| Raw audio | Uploaded files deleted at the provider immediately after transcription (even on failure); chair audio purged once persisted; sovereignty stamps record purge time |
| Transcripts | Stored with the record; `clinicalHorizonFilter` bounds what enters generation |
| ClinicalFacts / evidence | Live inside the note record; destroyed with the record |
| Notes (consultations) | `retentionYears`/`retentionUntil` stamped at creation (worker path now included); retention sweep deletes or de-identifies when due, leaving tombstones |
| Corrections | Revision history retained with the record — never rewritten |
| Audit events | Hash-chained, chain head witnessable; retained as the access-evidence record |

## 8. Recovery

- **Failed ASR:** user-visible refusal/warning, live recognition + offline drafting remain; audio preserved when not persisted; `asrFailure`/`partialAsrTranscript` counted.
- **Failed extraction:** job retries with backoff, then a visible `failed` state with the provider message; the transcript is never lost (client keeps it; job retains payload).
- **Failed verification:** note still renders but is flagged (`needsReview`, unverified claims listed); sign-off fails closed to "Clinician Verification Required".
- **Failed rendering:** terminal job failure is visible; no partial note is presented as complete (result stored only on success).
- **Database failure:** JSON fallback store keeps the app and the audit chain running; metering fails closed rather than unmetered.
- **Provider outage:** tiered failover (Vertex → primary key → fallback key → OpenAI-compatible bridge), then quota-aware backoff, then explicit failure — the clinician always sees a truthful state.
- **Instance crash mid-processing:** stuck jobs requeued automatically each tick (30-min stale window).

**Never-silent-incompleteness rule:** a note reaches a clinician as (a) a complete draft with computed grounding verdict, (b) a flagged draft needing verification, or (c) an explicit failure — never as a quietly truncated note.

---

## Production vs development/test configuration

| Concern | Production | Development/Test |
| --- | --- | --- |
| `SESSION_SECRET` | Required (throws without it) | Warned fallback |
| Storage | Postgres required unless `DENTAI_ALLOW_FILE_STORAGE=true` (throws otherwise) | JSON fallback in `DENTAI_DATA_DIR` |
| CSP | Enabled (`helmet` default) | Disabled for Vite dev |
| Provider keys | Operator-configured, config-readiness surfaced at `/api/health` (counts only) | Tests blank keys and force the mocked `@google/genai` |
| Ops surface | `DENTAI_OPS_SECRET` + short-lived signed cookie | Same gate; tests use the header |
| Retention sweep | Opt-in via `DENTAI_RETENTION_ENABLED=true` (dry-run default) | Off |
| Queue drain | `DENTAI_QUEUE_INTERVAL_MS` in-process or external cron via `CRON_SECRET` | Off in `NODE_ENV=test` |

---

## Exit criteria verdict

| # | Criterion | Verdict |
| --- | --- | --- |
| 1 | Stage-level latency observable | **PASS** — 7 stages instrumented, p50/p95 in `/api/ops/telemetry` |
| 2 | Verification rate observable | **PASS** — rate + per-trigger counts |
| 3 | Critical failure types observable | **PASS** — 15 counters incl. timeout/malformed/partial-ASR/sign-off rejection |
| 4 | No PHI enters telemetry | **PASS** — type-enforced registry; string-leaf test on the snapshot |
| 5 | Provider failures fail safely | **PASS** — bounded retries, visible terminal states |
| 6 | Malformed LLM output fails safely | **PASS** — classified, counted, never rendered |
| 7 | Retries idempotent | **PASS** — same-id submission converges (JSON mode fixed this phase) |
| 8 | No duplicate facts on retry | **PASS** — deduped insert, both store modes |
| 9 | Corrections preserved | **PASS** — append-only consent + revisions; optimistic concurrency |
| 10 | Sign-offs auditable | **PASS** — attestation seal + fail-closed status + counter |
| 11 | Provenance chain auditable | **PASS** — engine-independent generation audit event; hash-chained log |
| 12 | Lifecycle documented | **PASS** — §7 + `docs/legal/retention-and-deletion.md` |
| 13 | Security boundaries tested | **PASS** — webhook HMAC, retired telemetry, ops gate, rate limits |
| 14 | Patient/tenant isolation tested | **PASS** — cross-clinician 404s, ownership-scoped jobs |
| 15 | Recovery documented | **PASS** — §8 |
| 16 | Config separated | **PASS** — table above |
| 17 | Full suite passes | **PASS** — 824 passed / 19 skipped (postgres, no DATABASE_URL), 58 files |
| 18 | Evaluation suite passes | **PASS** — eval:notes 3/3 (1.000); eval:benchmark 20/20 FULLY SATISFIED; eval:gold-set 217 cases, 0 critical-error entries, all regression fixtures pass |
| 19 | No open critical defect without mitigation | **PASS** — none open |

## Phase 9 remediations applied

1. **JSON-mode job submission idempotency** — duplicate submission with the same consultation id no longer queues a second job (Postgres semantics matched).
2. **Worker-persisted consultations now carry governance stamps** — `privacyNoticeVersion`, `retentionYears`/`retentionUntil`, `recordVersion`, and a `systemGenerated: true` revision entry, matching what the chairside save path applies via recordGovernance.
3. **Engine-independent completion audit** — `notes_generated` emitted at job completion for every provider, closing a trail gap when generation ran on the OpenAI-compatible bridge.
4. **Metrics hardening** — `recordCounter` refuses non-positive amounts (counters cannot be decremented); `partialAsrTranscript` counter added for degraded ASR.

## Verification record (this phase, fresh runs)

- `npm run lint` → clean.
- `npx tsc --noEmit` → clean.
- `npx vitest run` → **824 passed, 19 skipped, 0 failed** (58 files; new: `tests/pipelineMetrics.test.ts` 19 tests, `tests/clinicalPipelineReliability.test.ts` 28 tests).
- `npm run eval:notes` → 3/3, average score 1.000, 0 safety failures.
- `npm run eval:benchmark` → 20/20 FULLY SATISFIED, WER 0.00%, FDI precision/recall 100%, 2.0 ms mean synthesis.
- `npm run eval:gold-set` → 217 cases; critical-error ledger **0 entries**; regression fixtures ALL PASS.
