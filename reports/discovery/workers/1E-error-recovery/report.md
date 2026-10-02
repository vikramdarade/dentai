# Worker 1E — ERROR / RECOVERY — Discovery Report

**STATUS: PASS (completed)**

## OBJECTIVE
Probe failure modes: malformed input, oversized payloads, missing fields, bad credentials, quota/provider outages, and audit-chain verification. Evidence only.

## ENVIRONMENT
- Same hermetic staging profile (port 4731, JSON store in temp dir, synthetic session).

## COMMIT_SHA
`2cf786aac840eee69d520ebaae0a35d91c23ffe3`

## TESTS_PERFORMED
1. Malformed JSON `POST /api/consultations` → **400** with Express default HTML error page (not JSON). Evidence: evidence/malformed-json.body.
2. Missing-fields `POST /api/consultations` (empty `{}`) → **201** — record created with blank `consent.obtainedAt: ""` and no transcript. Evidence: evidence/missing-fields.body.
3. Unauthenticated write → **401** `Access token required.` Evidence: evidence/unauth-write.body.
4. Bogus-id read (`/api/consultations/does-not-exist`) → **200 + SPA HTML** (falls through `get *` fallback instead of JSON 404). Evidence: evidence/bogus-id.body.
5. Oversized 2 MB body → **413 PayloadTooLargeError** (HTML error page). Evidence: evidence/oversized.body.
6. Ops secret probes: missing/wrong secret → 401 with corrective hint (`Sign in at GET /api/ops/console, or send x-dentai-ops-secret`). Cron drain: wrong secret → 401 "Invalid scheduler secret."; valid secret → 200 `{"ok":true,"openNoteJobs":0}`.
7. Provider-outage behaviour (observed in full-suite run): Gemini 402/429 (billing depleted) → graceful fallbacks; queue job requeue-with-backoff test passes; integration tests self-skip rather than fabricate.
8. Audit-chain verification endpoint reachable and auth-gated (`/api/ops/audit/verify` → 401 without ops secret).

## FINDINGS
- F-1E-1 (URGENT for triage): `POST /api/consultations` with an empty object returns **201**, creating a consultation record with `consent.obtainedAt: ""` and no transcript. A record that can be created in this state is a record that can later exist unsigned-but-structured with a blank consent timestamp; the sign gate does refuse it (422 EMPTY_NOTE, see worker 1D), so **no unsafe sign path was demonstrated** — but creation-side validation is more permissive than the clinical contract implies. Evidence: evidence/missing-fields.body. Not root-caused here.
- F-1E-2 (OBSERVATION): JSON-body parse errors and payload-limit rejections return **HTML error pages** (Express default), not JSON — machine clients see 400/413 with HTML; error contract is inconsistent.
- F-1E-3 (OBSERVATION): Unknown API ids/paths fall through to SPA HTML 200 (shared with F-1B-1) — clients cannot distinguish "not found" from "found".
- F-1E-4 (POSITIVE): Ops/cron secrets enforced correctly on every probed route; cron drain idempotent on empty queue; job fabric requeues on quota failure with backoff (unit-proven).
- F-1E-5 (POSITIVE): Provider quota exhaustion degrades gracefully (deterministic fallback path exercised in suite; no invented clinical content observed in outputs).

## REPRODUCTION
- `curl -X POST $BASE/api/consultations -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'` → 201 (F-1E-1).
- `curl -X POST $BASE/api/consultations -d '{not json' ...` → 400 HTML (F-1E-2).
- `curl -H "x-cron-secret: discovery-cron-secret" $BASE/api/cron/drain` → 200 `{"ok":true,"openNoteJobs":0}`.

## EVIDENCE
- evidence/malformed-json.body, missing-fields.body, unauth-write.body, bogus-id.body, oversized.body
- evidence/ops-telemetry.json, audit-verify.json, cron-wrong.json, cron-right.json
- Worker 1D evidence/full-suite.log (provider-outage transcripts, backoff test)

## BLOCKED_TESTS
- Audit-chain tamper-evidence rehearsal on the live JSON store (would require writing mutated audit entries to the store — deferred to a hermetic harness; chain verification logic is covered by passing unit tests).
- Server-restart durability drill (would require stopping/restarting the shared staging instance mid-stage; queue durability covered by tests/server.test.ts passes).
