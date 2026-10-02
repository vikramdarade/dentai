# Worker 1F — STATIC / ARCHITECTURE — Discovery Report

**STATUS: PASS (completed)**

## OBJECTIVE
Cross-check documentation claims against code reality and test coverage; audit route-matching, security middleware, dependency, and configuration surfaces. Evidence only.

## ENVIRONMENT
- Static analysis at the recorded SHA + typecheck run on this machine.

## COMMIT_SHA
`2cf786aac840eee69d520ebaae0a35d91c23ffe3`

## TESTS_PERFORMED
1. Typecheck: `npm run lint` (tsc -b --noEmit) → **clean**.
2. Governance route-matching audit (AGENTS rule 11 bypass class): 33 `originalUrl` references across `server.ts` + `src/server/*` (evidence/originalUrl-usage.txt); `src/server/recordGovernance.ts` matches on `req.path` (path-based) — no governance decision keyed on `originalUrl` found in the governance middleware itself.
3. Security middleware census: `helmet(...)` at server.ts:194; durable per-address rate limiting (custom store replacing bare express-rate-limit) at server.ts:367; API limiter mounted at `/api/` (line 682); signup guard at 606; login MFA guard at 1127.
4. Dependency audit: 13 runtime + 15 dev dependencies; no npm/yarn/pnpm lockfiles added (Bun canonical rule respected).
5. Config surface: 21 declared config keys in `src/server/configCheck.ts`; health endpoint reports readiness `limited` with 8 advisories on the hermetic profile (all advisory, 0 blocking).
6. Doc-vs-code drift triage: API_INVENTORY.md drafts were partially wrong (ops secret header name, register schema, missing ~60 module-registered routes) — worker 1B's route-inventory.md supersedes it as evidence; formal inventory update is a post-consolidation action.

## FINDINGS
- F-1F-1 (POSITIVE): Typecheck clean; architecture matches documented shape (single Express app + React 19/Vite client, JSONB-document Postgres layer, fail-closed JSON fallback).
- F-1F-2 (OBSERVATION): Governance middleware is path-matched as required; the `originalUrl` references found are limited to non-governance uses (limiter keying comments, telemetry). No bypass-class defect demonstrated.
- F-1F-3 (DOC_DRIFT): `docs/testing/API_INVENTORY.md` is materially incomplete vs the ~78-route reality (self-declared draft; now evidence-complete in workers/1B-api/evidence/route-inventory.md).
- F-1F-4 (OBSERVATION): `.env.local` precedence trap documented by worker 1C (F-1C-3) is an architectural operator-hazard: module-level dotenv in `src/lib/db.ts` means a stray `DATABASE_URL` silently selects the production persistence mode.

## REPRODUCTION
- `npm run lint` → clean (exit 0).
- `grep -n originalUrl server.ts src/server/*.ts` → 33 hits (evidence/originalUrl-usage.txt).
- `grep -c "key: '" src/server/configCheck.ts` → 21.

## EVIDENCE
- evidence/originalUrl-usage.txt
- Full-suite log: workers/1D-clinical-safety/evidence/full-suite.log
- Route census: workers/1B-api/evidence/route-inventory.md

## BLOCKED_TESTS
- `bun run lint` (canonical Bun path): Bun missing on this machine (bootstrap-recorded BLOCKED dependency); npm/tsc equivalent executed instead.
