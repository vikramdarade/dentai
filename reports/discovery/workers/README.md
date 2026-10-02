# Stage 1 Discovery — Worker Partition

**Stage:** 1 (Discovery only) · **Controller:** Discovery Controller (Buffy)
**Entry gate:** **PASS** — verified 2026-09-28:

| Requirement | Evidence |
|---|---|
| Stage 0 PASS | `reports/discovery/bootstrap-report.md` — EXIT GATE: PASS |
| Repository SHA recorded | `2cf786aac840eee69d520ebaae0a35d91c23ffe3` (git rev-parse HEAD, recorded in all `.control/*.json`) |
| Working tree known | Only untracked control-plane dirs (`.control/`, `docs/agents/`, `docs/continuous/`, `docs/testing/`, `reports/`); **zero application files modified** |
| Application can start | Hermetic staging profile verified: `GET /api/health → 200 {"status":"ok","version":"0.1.0-rc.1","storage":"file-fallback"}` on `http://localhost:4731` |
| Synthetic test environment | JSON store in a `mkdtemp` temp dir (`dentai-disc-h0OP3b`), `DENTAI_ALLOW_FILE_STORAGE=true`, `NODE_ENV=staging`, deterministic provider flag, `DATABASE_URL` unset (Postgres deliberately NOT used — no shared/production DB touched). Vitest + Playwright installed locally. |

## Workers (independent work streams)

| id | Stream | Scope | Evidence dir |
|---|---|---|---|
| 1A | UI / JOURNEY | Golden journeys J1–J8 (docs/testing/GOLDEN_JOURNEYS.md) against the running app | `reports/discovery/workers/1A-ui-journey/` |
| 1B | API | Enumerate + probe every HTTP surface; auth classification; route-matching bypass class (originalUrl) | `reports/discovery/workers/1B-api/` |
| 1C | STATE / CONCURRENCY | Persistence layers, JSON-store cache, optimistic concurrency, version/hash gates, durable queue | `reports/discovery/workers/1C-state-concurrency/` |
| 1D | CLINICAL SAFETY | Protected surfaces 1–10 (docs/testing/SAFETY_INVARiants.md); fail-closed verification via tests + live probes | `reports/discovery/workers/1D-clinical-safety/` |
| 1E | ERROR / RECOVERY | Failure modes: offline provider, malformed input, stale writes, queue durability, audit-chain tamper evidence | `reports/discovery/workers/1E-error-recovery/` |
| 1F | STATIC / ARCHITECTURE | Doc-vs-code-vs-test cross-checks; route-by-route inventory extension; dependency/config audit | `reports/discovery/workers/1F-static-architecture/` |

Workers are executed by the controller in parallel batches (code inspection, test-suite runs, and
live HTTP probes against the shared hermetic staging instance on port 4731 — read/test-only).

## Shared rules (binding on every worker)

Workers **may**: inspect · navigate · test · reproduce · capture evidence.

Workers **may NOT**: fix · refactor · commit application changes · deploy · modify
`.control/quality-ledger.json` · modify production data.

Each worker directory must contain a `report.md` with the mandated sections:

1. `OBJECTIVE`
2. `ENVIRONMENT` (profile, port, store, SHA)
3. `COMMIT_SHA`
4. `TESTS_PERFORMED`
5. `FINDINGS` (facts observed, each tied to evidence; no root-cause analysis, no prioritisation)
6. `REPRODUCTION` (command or HTTP transcript that regenerates each finding)
7. `EVIDENCE` (file references: raw HTTP transcripts, test output, code refs with file:line)
8. `BLOCKED_TESTS` (what could not be executed, and why)

No worker may write outside its own directory (plus the shared
`reports/discovery/workers/README.md`, owned by the controller).
