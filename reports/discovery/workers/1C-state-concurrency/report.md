# Worker 1C — STATE / CONCURRENCY — Discovery Report

**STATUS: PASS (completed)**

## OBJECTIVE
Probe persistence layers, optimistic concurrency, and version gates on the record lifecycle. Evidence only.

## ENVIRONMENT
- Same hermetic staging profile (JSON file fallback store in temp dir; Postgres deliberately not configured so no shared DB is touched).

## COMMIT_SHA
`2cf786aac840eee69d520ebaae0a35d91c23ffe3`

## TESTS_PERFORMED
1. Persistence-mode verification: `/api/health` reports `storage: "file-fallback"`, `database: "not-configured"` — writes land in the temp `DENTAI_DATA_DIR`, never in the repo's `./data` or any live DB (health.json).
2. Consultation lifecycle: valid create → 201 with server-side defaults (privacyNoticeVersion `2026-09-16`, retentionYears 7, retentionUntil computed server-side, `revisions[]` initialised).
3. Optimistic-concurrency gate (live): sign-off without `expectedVersion` → **400 EXPECTED_VERSION_REQUIRED**; stale `expectedVersion:1` on a v2 record → **409 STALE_VERSION** with `currentVersion` echoed. Version gate is enforced server-side, not client-honour-system.
4. Static review of state layers: `src/lib/db.ts` (Postgres via Neon + JSON fallback, `dbEnabled` gate, test-only executor seam, one-time seed flag), `src/server/chairSessionStore.ts` (chair session state), `src/server/stores.ts`, `src/lib/noteJobs.ts` (durable queue), `src/lib/auditChain.ts` (hash-chained audit).
5. Live cron drain (`x-cron-secret` valid) → `{"ok":true,"openNoteJobs":0}` — queue depth readable and drain idempotent on empty queue.

## FINDINGS
- F-1C-1 (OBSERVATION): Two storage implementations (Postgres JSONB documents + JSON fallback) share one code path via `dbEnabled`; the Postgres suite (`tests/postgres.test.ts`, 19 tests) skips without `DENTAI_TEST_DATABASE_URL`, so on this machine the Postgres branch of the concurrency logic ran **only** as static inspection, not execution.
- F-1C-2 (POSITIVE): Optimistic concurrency is live and fail-closed (see sign-gate 400/409 transcripts; detailed in worker 1D report).
- F-1C-3 (OBSERVATION): `src/lib/db.ts` loads `.env.local` **before** `dbEnabled` is evaluated (module-level dotenv). Correct, but subtle: an environment with a stray `DATABASE_URL` in `.env.local` silently flips persistence mode — this is exactly how the controller's first server boot bound to a real Neon DB. Operator hazard worth a config guard (reported as finding; no fix applied).
- F-1C-4 (POSITIVE): Consultation documents carry server-set retention fields and append-only `revisions[]` from creation.

## REPRODUCTION
- `curl -s http://localhost:4731/api/health` → storage file-fallback.
- `curl -s -X POST .../api/consultations/:id/sign -d '{"expectedVersion":1}'` → 409 STALE_VERSION (evidence: sign-stale.json).
- First boot of controller reproduced F-1C-3: `.env.local` DATABASE_URL took precedence over shell env (server.log shows "Persistence mode: PostgreSQL (Neon)" on first start).

## EVIDENCE
- evidence/consult-create.json, consult-update.json (revisions array visible)
- evidence/health.json
- src/lib/db.ts:1-80 (dotenv/dbEnabled), src/server/chairSessionStore.ts, src/lib/noteJobs.ts
- Worker 1D evidence/full-suite.log (postgres suite skip counts)

## BLOCKED_TESTS
- Postgres-backed concurrency (SKIP LOCKED claims, migration rollback rehearsal): no DENTAI_TEST_DATABASE_URL on this machine; never install or provision autonomously.
- Vercel-KV fallback branch: no KV credentials; branch inspected statically only.
