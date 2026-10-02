# Worker 1B — API — Discovery Report

**STATUS: PASS**

## OBJECTIVE
Two-phase adversarial API discovery: (1) enumerate every HTTP surface, classify auth per
route, live-probe auth boundaries; (2) adversarially probe the critical clinical APIs
(consultation create/update, note generation, finalization/sign-off, grounding, history,
persistence) with synthetic data only. Evidence only — no code changes.

## ENVIRONMENT
- Same hermetic staging profile (port 4731, JSON store in temp dir, synthetic clinician + patient created via API).
- Phase 2 added two synthetic clinicians (owned records only), synthetic patients, and
  synthetic transcripts; no real patient data touched. No production records created —
  all writes landed in the disposable `mkdtemp` JSON store.

## COMMIT_SHA
`2cf786aac840eee69d520ebaae0a35d91c23ffe3` (both phases; tree unchanged by this worker —
only files under `reports/discovery/workers/1B-api/` were written)

## TESTS_PERFORMED
1. Full route enumeration via grep of `app.(get|post|put|patch|delete)` across `server.ts` (30 direct routes + SPA fallback) and 10 route modules (patientRoutes, transcriptionRoutes, beaconRoutes, opsRoutes, sessionSecurity, mfa, billing, clinicExport, opsActions, practiceAgreement) — **~78 routes total**; middleware mounts at server.ts lines 397/406/477/606/682/703-705/1127. Full table: evidence/route-inventory.md.
2. Unauthenticated probes of protected endpoints → 401 (`/api/patients`, `/api/consultations`, `/api/ops/telemetry`, `/api/cron/drain`, retired `/api/telemetry`).
3. Ops-plane: wrong/missing secret → 401 with `OPS_SECRET_REQUIRED`; retired telemetry → 401.
4. Synthetic registration contract: rejected without specialty (400), rejected email/password shape (this build authenticates by name + 4-digit non-weak PIN — `server.ts:2928`); valid PIN registration → 201 + epoch-bearing session token.
5. Authenticated reads with session token → 200 (empty arrays); synthetic patient create → 201.

### Phase 2 — adversarial probes (full detail: evidence/adversarial/FINDINGS.md)

1. Missing fields, malformed JSON, invalid IDs, path traversal, ownership violations
   (foreign PUT/sign/poll/history), duplicate requests, stale versions, replay nonces,
   invalid transitions (sign without grounding/consent/content), client version+seal
   forgery, 10-way concurrent PUT race, unauthenticated queue tick, huge transcripts,
   patient-identity edge cases (name-only resolve, DOB conflict, malformed DOB).
2. Every attack class in the brief was exercised; provider-failure and database-failure
   classes verified statically (code + passing suites) because live probing needs real
   provider keys / Postgres, which the hermetic profile deliberately excludes.

## FINDINGS

**Phase 2 (adversarial) — full write-ups in evidence/adversarial/FINDINGS.md:**

- **FINDING-1B-201 (CRITICAL, functional):** `POST /api/consultations/:id/sign` returns
  **500** with `TypeError: Cannot read properties of undefined (reading 'trim')`
  (`src/lib/attestation.ts:37`, unguarded `firstName/lastName.trim()`) whenever the
  consultation record has no patient name fields — even when every approval gate passes.
  Worse: the replay nonce is consumed *before* the crash (`signOffValidation.ts:210-216`),
  so the client's immediate retry gets **409 REPLAY** while no seal was ever persisted —
  sign-off dead-ends. Fail-closed (no invalid seal), but blocks finalization on an easily
  reachable record shape. Evidence: `adversarial/m2-sign.json`, `adversarial/m3-replay.json`,
  server.log stack trace 2026-09-27T23:51:37.621Z.
- **FINDING-1B-202 (MEDIUM):** `POST /api/consultations` accepts an empty `{}` body → 201
  durable clinical record (no required-field gate); and a duplicate POST with a
  client-supplied existing `id` silently **overwrites** the stored record (JSON path,
  `server.ts:3744-3751`) with 201 — no version/ownership conflict check.
- **FINDING-1B-203 (MEDIUM):** `POST /api/patients` accepts malformed DOB (`201`) and
  silently ignores a `dateOfBirth` field (route reads `dob` only) — silent identity-data
  loss weakening the patient-resolution policy.
- **FINDING-1B-204 (LOW, for CLINICAL_VERIFIER):** `POST /api/patients/resolve` auto-
  returns `matched` on phone alone when the stored chart has no DOB, treating a caller-
  supplied conflicting DOB as agreement — tension with PROJECT_CONTEXT rule 12.
- **FINDING-1B-205 (LOW):** unknown `/api/*` paths return 200 SPA HTML instead of 404 JSON
  (carried from Phase 1 F-1B-1; also observed swallowing a mistyped PUT during probing).
- **FINDING-1B-206 (OBSERVATION):** free-text `findings` shapes are accepted by PUT and
  pass grounding, but are invisible to the sign gates' canonical-content digest →
  permanently un-signable with misleading `EMPTY_NOTE` (fail-closed, misleading message).

**Phase 1 (enumeration/auth):**
- F-1B-1 (API-HYGIENE): Unknown `/api/*` paths (e.g. `/api/records`, `/api/billing`) return **200 + SPA HTML** via the `get *` fallback instead of 404 JSON. Not an auth gap (no data), but API/SPA boundary is ambiguous for clients and monitors. Evidence: evidence/urgent-unauth-200/ (headers + bodies show `<!doctype html>`).
- F-1B-2 (OBSERVATION): Ops secret header is `x-dentai-ops-secret` (not `x-ops-secret` as assumed from API_INVENTORY draft) — inventory drift; corrected behaviour documented in route-inventory.md.
- F-1B-3 (OBSERVATION): Registration schema in live API (name + specialty + PIN) differs from legacy email/password shape; API_INVENTORY.md does not document the auth register contract.
- F-1B-4 (POSITIVE): All clinical data routes enforced auth live (401 without token); epoch-bearing opaque tokens observed.

**Positive adversarial verifications (attack refused, evidence captured):** replay nonce
→ 409 REPLAY; stale version → 409 + currentVersion; ungrounded sign → 422
GROUNDING_NOT_APPROVED; missing consent → 422 CONSENT_MISSING; foreign access → 404 with
no leakage; client `recordVersion`/`attestation` forgery stripped by governance
middleware; duplicate note-job idempotent (no double-spend); 10-way concurrent PUT kept
versions monotonic with per-write revisions; edit adding ungrounded content flipped
approval server-side; omission detection raised spoken-but-omitted alerts.

## REPRODUCTION
- `curl -s http://localhost:4731/api/records` → 200 HTML (F-1B-1 / FINDING-1B-205).
- `curl -s -H "x-dentai-ops-secret: <wrong>" http://localhost:4731/api/ops/telemetry` → 401 OPS_SECRET_REQUIRED.
- `curl -s -X POST http://localhost:4731/api/auth/register -H "Content-Type: application/json" -d '{"name":"X","specialty":"Dentistry","pin":"7391"}'` → 201 token.
- FINDING-1B-201: create consultation via API without names → satisfy grounding+consent+version gates →
  `POST /api/consultations/:id/sign {"expectedVersion":N,"requestNonce":"x"}` → 500; repeat → 409.
- Full request/response transcripts: evidence/adversarial/probe-run1.log … probe-run10.log.

## EVIDENCE
- evidence/route-inventory.md, evidence/health.json, evidence/register.json, evidence/token.txt
- evidence/auth-*.body, evidence/patient-create.json, evidence/urgent-unauth-200/*
- **evidence/adversarial/** — FINDINGS.md + ~60 raw request/response bodies (a*, b*, c*, d*, e*, f*, g*, h*, i*, j*, k*, l*, m*) + probe-run1..10.log
- server.ts:2928 (register contract), src/server/*.ts route registrations (line numbers in route-inventory.md)
- src/lib/attestation.ts:37, src/server/signOffValidation.ts:210-216, server.ts:3744-3776 (FINDING-1B-201)

## BLOCKED_TESTS
- Stripe webhook path (`/api/billing/webhook`): needs a valid Stripe signing secret to test acceptance; refusal of unsigned events covered by tests/abuse.test.ts (passing).
- Chair beacon pairing flow: requires chair device simulation harness (beaconRoutes token scheme inspected statically only).
