# Worker 1B — Adversarial API Probe Findings (Phase 2)

**Commit SHA:** `2cf786aac840eee69d520ebaae0a35d91c23ffe3`
**Environment:** hermetic staging instance on `http://localhost:4731`, JSON file store in
`mkdtemp` temp dir (`dentai-disc-*`), `DENTAI_ALLOW_FILE_STORAGE=true`, `NODE_ENV=staging`,
no real provider keys, no real patient data — all names/transcripts/patients synthetic
("Syn"/"Dr Disc OneB"/"parallel edit N" etc.). No application code was modified.
Raw HTTP bodies: same directory (`*.json`, `probe-run*.log`).

Legend: each finding lists endpoint / method / request / response+status / expected /
actual / reproduction / evidence.

---

## FINDING-1B-201 — CRITICAL / FUNCTIONAL — Sign-off crashes with 500 when practitioner name is absent (seal never mints)

- **Endpoint:** `POST /api/consultations/:id/sign`
- **Method:** POST
- **Request:** authenticated owner, all gates satisfied (grounding approved, consent
  recorded via governance middleware, `expectedVersion` = current), e.g.
  `{"expectedVersion":5,"requestNonce":"disc-1b-nonce-20"}`
- **Response/Status:** `500 {"error":"Sign-off could not be validated."}`
- **Expected:** `200 {ok:true, seal, recordVersion, signedAt}` — the F-4 sign gate should
  mint and persist the attestation seal.
- **Actual:** unhandled `TypeError: Cannot read properties of undefined (reading 'trim')`
  at `src/lib/attestation.ts:37` (`buildCanonicalTextDigest` reads
  `consultation.firstName.trim()` / `lastName.trim()` without null guards) called from
  `createAttestationSeal` ← `signOffValidation.ts:275` ← `server.ts:3776`. The nonce is
  consumed **before** the crash, so the immediately retried request gets `409 REPLAY`
  even though no seal was ever persisted — the client is dead-ended (500 then 409 on
  retry; a third attempt with a fresh nonce 500s again until a name is set).
- **Trigger conditions:** consultation created through the API without
  `firstName`/`lastName` on the record (records carry patient identity via
  `patientId`/`intakeData` in normal flows; the validator's `empty_note` gate checks
  structured findings but nothing checks name presence before minting).
- **Severity rationale:** the single most safety-critical transition in the product
  (sign-off) fails closed in the worst way: hard 500 + poisoned replay nonce + no seal.
  It is *safe* (no invalid seal is minted) but blocks finalization for any record
  lacking patient name fields — an easily reachable state.
- **Reproduction:**
  1. `POST /api/consultations` `{}` → 201 (record without firstName/lastName, with transcript+findings+consent)
  2. Satisfy grounding/consent/version gates
  3. `POST /api/consultations/:id/sign {"expectedVersion":N,"requestNonce":"x"}` → 500
  4. Repeat exact request → 409 REPLAY (nonce consumed despite 500)
- **Evidence:** `m2-sign.json`, `m3-replay.json`, `probe-run10.log`,
  `.control/discovery-runtime/server.log` 2026-09-27T23:51:37.621Z (stack trace),
  `src/lib/attestation.ts:37`, `src/server/signOffValidation.ts:210-216` (nonce
  consumption order), `server.ts:3776`.
- **Related observations:** when a structured-findings record *has* names, seal minting
  works and is replay/immutability protected (see POSITIVES). Note also
  `contentDigest`/`canonicalContent` (`signOffValidation.ts:96-131`) treats a
  findings object with only non-canonical keys (e.g. `findings.note`) as *no clinical
  content* → `422 EMPTY_NOTE` (fail-closed, but the message is misleading for
  free-text-shaped notes; client-shaped `findings` are accepted by PUT with no schema
  validation).

## FINDING-1B-202 — MEDIUM / API-HYGIENE — Empty POST /api/consultations body creates a valid clinical record (201)

- **Endpoint:** `POST /api/consultations`
- **Method:** POST
- **Request:** `{}` (also a malformed non-JSON body with no `Content-Type`, parsed as
  `{}` by Express)
- **Response/Status:** `201` full record (id, recordVersion=1, grounding audit with
  status "Clinician Verification Required", consent/retention/revisions stamps)
- **Expected:** arguable — the route deliberately accepts a minimal payload so the
  governance middleware can stamp integrity fields, but a record with no transcript,
  no findings, no patient and no note is clinically meaningless and sign-off would
  refuse it (`EMPTY_NOTE`). No required-field gate exists (contrast
  `/api/generate-notes`, which validates names/appointmentType/transcript).
- **Actual:** 201 + persisted durable consultation (counts against storage, appears in
  history lists).
- **Reproduction:** `curl -X POST /api/consultations -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{}'`
- **Evidence:** `a1-missing-body.json`, `a2-no-ct.json`, `probe-run1.log`,
  `server.ts:3666-3762`.
- **Related:** duplicate create with a client-supplied existing `id` silently
  **overwrites** the stored record (`POST /api/consultations` JSON path,
  `server.ts:3744-3751` — `existingIdx !== -1` replaces in place, no
  version/ownership-conflict check, response 201 not 409). Same shape as 1C's
  stale-write territory; logged here because it is reachable purely via the API.
  Evidence: `c1-create-dup.json` (recordVersion stayed 1 while content was replaced).

## FINDING-1B-203 — MEDIUM / API-HYGIENE — Patient create accepts malformed DOB and ignores `dateOfBirth` (records empty DOB silently)

- **Endpoint:** `POST /api/patients`
- **Method:** POST
- **Request:** `{"firstName":"Syn","lastName":"PatB","dateOfBirth":"not-a-date"}`
- **Response/Status:** `201 {"id":"e9217836...","name":"Syn PatB","dob":"","phone":null}`
- **Expected:** `400` for a malformed date (contrast `/api/generate-notes` DOB
  validation, `server.ts:4700-4712`), or at minimum `dob:"not-a-date"` if stored raw.
- **Actual:** 201 with `dob:""` — the route reads `req.body.dob` only
  (`patientRoutes.ts:265`), so the client field `dateOfBirth` is silently dropped and
  garbage is neither rejected nor stored.
- **Clinical risk:** silent identity-data loss; empty DOB weakens the
  `decidePatientResolution` second-detail match policy (name-only resolutions become
  `ambiguous` more often — safe but degrades chart linking).
- **Reproduction:** `curl -X POST /api/patients -d '{"firstName":"A","lastName":"B","dateOfBirth":"not-a-date"}'`
- **Evidence:** `j1-patient.json` (correct `dob` field name works), `j7-baddob.json`,
  `probe-run7.log`, `src/server/patientRoutes.ts:249-278`.

## FINDING-1B-204 — LOW / CORRECTNESS — `resolve-dob-conflict` returns `matched` when the stored patient has no DOB on file

- **Endpoint:** `POST /api/patients/resolve`
- **Method:** POST
- **Request:** existing patient "Syn PatA" (stored `dob:""`, phone matches), resolve
  with `{"firstName":"Syn","lastName":"PatA","dateOfBirth":"1999-12-31","phone":"0400000000"}`
- **Response/Status:** `200 {"status":"matched",...}` — a caller-supplied DOB that
  *conflicts* with the stored chart (empty) is treated as agreement because only the
  phone is compared when the stored DOB is blank.
- **Expected:** per PROJECT_CONTEXT rule 12 ("Conflicts win"), a name+phone match with
  a supplied DOB that cannot be corroborated should arguably be `ambiguous` for human
  confirmation rather than auto-`matched`.
- **Actual:** auto-matched on phone alone; record links without review flag.
- **Impact:** bounded — only reachable when the chart has no stored DOB (the common
  case for walk-ins, which rule 12 permits). Flagged for CLINICAL_VERIFIER review of
  `decidePatientResolution` semantics rather than as a definite defect.
- **Reproduction:** `probe-run7.log` J2/J3/J4 sequence with a name-only patient.
- **Evidence:** `j2-resolve.json` (name-only → ambiguous, correct),
  `j3-resolve-name.json`, `j4-resolve-conflict.json`, `src/lib/patients.ts`.

## FINDING-1B-205 — LOW / API-HYGIENE — Unknown `/api/*` paths return SPA HTML 200 instead of 404 JSON

- **Endpoint:** any unknown `/api/*` path (e.g. `GET /api/records`, and observed
  side-effect: a PUT to a *deleted/unknown* consultation id returned 200 HTML in the
  concurrency run when the path accidentally fell through)
- **Method:** any
- **Request:** `GET /api/records` (no such route)
- **Response/Status:** `200 <!doctype html>...` (Vite/SPA shell)
- **Expected:** `404` JSON for `/api/*` namespace.
- **Actual:** 200 HTML — API clients and monitors see "success" for a mistyped route.
- **Reproduction:** `curl -s http://localhost:4731/api/records`
- **Evidence:** `urgent-unauth-200/`, `g-put-1.json` (from the mis-targeted first
  concurrency run), Phase-1 report F-1B-1.

## FINDING-1B-206 — OBSERVATION — Free-text `findings` shape is accepted by PUT but invisible to the sign gates

- PUT accepts arbitrary `findings` shapes (no schema validation, `server.ts:3853-3861`
  merge), the grounding audit happily claims them, but
  `signOffValidation.ts` `canonicalContent`/`empty_note` only recognise the 8 canonical
  sections + `customSections`. A record whose findings use keys like `note` can be
  grounding-approved (`isApprovedForSigning:true`) yet permanently un-signable with a
  misleading `EMPTY_NOTE` 422. The produced note path (durable job) writes canonical
  sections, so this is primarily a client-shape robustness gap, not a production-flow
  break. Evidence: `k1-record.json` (approved=true, findings={note}), `k2-sign.json`.

---

## POSITIVE VERIFICATIONS (attack refused — evidence files)

| Attack | Result | Evidence |
|---|---|---|
| Missing fields (notes jobs, generate-notes, sign) | 400 with specific codes (`EXPECTED_VERSION_REQUIRED`) | `a3`–`a6`, `a5-sign-nover.json` |
| Empty / >5,000-item transcripts | 400 | `a4-notes-empty.json`, `f6-huge.json` |
| Malformed JSON / no Content-Type | 400 (Express JSON parse) on validated routes; `{}` on consultations (see 202) | `probe-run1.log` |
| Invalid/unknown IDs (PUT, job poll, patient history, sign) | 404 `NOT_FOUND` | `b1`–`b4` |
| Path traversal in id segment (`..%2f..%2fusers.json`) | 404, no file access | `b5-traverse.json` |
| Cross-tenant ownership: foreign PUT / sign / job poll / history | 404 (indistinguishable from missing) | `e1`, `e2`, `f4-job-foreign.json`, `j6-foreign-history.json` |
| Foreign list scoping | 200 `[]` (no leakage) | `e3-foreign-list.json` |
| Duplicate note-job submission (same consultationId) | Idempotent — same `jobId`, one generation, no double-spend of daily quota (usage `used:0` after both) | `f1/f2-job-*.json`, `probe-run3.log` |
| Replay of sign-off nonce | 409 `REPLAY` (nonce consumed before gates) | `h3`, `i3`, `l3`, `m3` |
| Stale `expectedVersion` | 409 `STALE_VERSION` + `currentVersion` | `d3-sign-stale.json`, `l5-sign-stale.json`, `m5-sign2.json` |
| Sign without grounding approval | 422 `GROUNDING_NOT_APPROVED` (fail-closed; audit shows unverified claims) | `d2-sign-unapproved.json` |
| Sign without clinical content | 422 `EMPTY_NOTE` (fail-closed) | `h2-sign-ok.json` |
| Sign without AI-assist consent (transcript-bearing) | 422 `CONSENT_MISSING` (fail-closed) | `l2-sign.json` |
| Client version forgery (`recordVersion:99` in PUT body) | Overwritten by governance middleware (record advanced 1→2, client 99 ignored) | `d1-put-spoof.json` |
| Client attestation forgery | `attestation` stripped from body, preserved from store | `d1`/`i5` responses contain no client seal |
| Ungrounded content added by edit | Grounding audit recomputed server-side, score drops 0.92→0, approval flips false | `d1-put-spoof.json` vs `h1-create.json` |
| Omitted content detection | Spoken "Tooth 36" omitted after edit → omission alert raised | `l4-edit.json` reconciliation block |
| 10 parallel PUTs (last-writer-wins race) | All 200; version monotonic 1→12+1, one revision per accepted write, no corruption/lost canonical fields | `g-put-*.json`, `g1-final.json` |
| `/api/notes/jobs/tick` unauthenticated | 401 (falls to authenticateToken) | `f7-tick.json` |
| Retired `/api/telemetry`, ops/cron planes without secrets | 401 | Phase-1 evidence |
| Provider-failure classification (timeout/malformed/quota → metrics + backoff + failover) | Static verification: `server.ts:1540-1605` (Tier-2/3 failover, quota→backoff, `llmTimeout`/`llmMalformedOutput` counters), `server.ts:1868-1878` (exponential backoff `backoffDelayMs(attempts)`, terminal `failed`), stale-`processing` requeue `server.ts:1698-1706`; runtime covered by `tests/clinicalPipelineReliability.test.ts` (passing suite). Live probing would need real provider keys — not attempted (no production side effects). | code refs |
| Database failure path | Postgres deliberately not configured in hermetic profile; JSON-store error paths (`500 Failed to retrieve consultations.`) covered by code + suite; DB-failure injection left to 1C/1E to avoid duplicating store-level work | code refs |

## Field summary of statuses exercised

401 (unauth/ops/cron) · 400 (validation) · 404 (not found / foreign resource) ·
409 (stale, replay) · 422 (grounding, consent, empty note) · 429 (quota — code-verified)
· 500 (crash — FINDING-1B-201) · 200/201/202 (happy paths).
