# DentAI Test Strategy

**Owner:** DETERMINISTIC_TESTER · **Approved by:** human maintainer · **Created:** 2026-09-28 by FREEBUFF bootstrap
**Sources of truth (do not contradict):** `package.json`, `PROJECT_CONTEXT.md`, `.agents/AGENTS.md`, `.github/workflows/ci.yml`, `docs/runbooks/clinical-eval.md`

## 1. Layers

| Layer | Command | Scope | Gate status |
|---|---|---|---|
| Typecheck | `bun run lint` (`tsc -b --noEmit`) | Whole repo | Blocking (CI + husky pre-commit) |
| Unit / integration (Vitest) | `bun run test` (`--fileParallelism=false --test-timeout=30000`) | 76 test files incl. clinical pipeline, sign-off, security, identity | Blocking (CI + husky pre-commit) |
| Server integration | `bun run test:integration` | `tests/server.test.ts` against JSON fallback store | Blocking |
| Postgres suite | `bun run test:postgres` | Requires `DATABASE_URL` / `DENTAI_TEST_DATABASE_URL` | Blocking in CI (service container); **skips locally — known environment gap** |
| Clinical eval gate | `bun run eval:notes --offline --min-score 0.9` | Gold fixtures, offline scoring | Blocking in CI (`clinical-eval` job) |
| Benchmark / gold set | `bun run eval:benchmark` · `eval:gold-set` | 20 scenarios / 217 cases | Advisory reporting; drift recorded in quality ledger |
| Build | `bun run build` (vite + esbuild server bundle) | Compilability of client + server | Blocking in CI |
| Dependency audit | `bun audit` | Transitive advisories | Advisory (non-blocking by design) |
| E2E (Playwright) | **not yet present** | Screen journeys | Planned — see `GOLDEN_JOURNEYS.md` |

## 2. Non-negotiable execution rules (from `.agents/AGENTS.md`)

1. **Always `--fileParallelism=false`** — suites share local JSON fixtures; parallel files collide.
2. Tests must set `DENTAI_DATA_DIR` to a temp directory; never touch developer working data.
3. Keep `beforeAll` backup / `afterAll` restore hooks for shared fixtures; call `invalidateDbCache()` after direct JSON edits.
4. Package manager is **Bun**. Never introduce an npm/yarn/pnpm lockfile.
5. Postgres tests are the only suite allowed to skip — and only when no database is configured. Their skip is recorded as an environment gap, not a pass.

## 3. What "tested" means for clinical software

- A feature is not tested unless its **failure direction is tested**: fabrication attempts, negation flips, identity ambiguity, unsigned/grounding-failed saves, epoch-revoked sessions.
- Safety-critical suites are regression-fixed: `macroSparseTranscript` (202-case fabrication matrix), `signOffValidation`, `negationScope`, `groundingVerification`, `clinicalFactContract`, `patientIdentity`.
- The clinical eval gate is a **threshold gate, not a taste gate**: any drop below the documented score fails CI (`eval:notes --min-score 0.9`).

## 4. Planned additions (control-plane work items, not commitments)

- Screen inventory → Playwright specs per golden journey (`SCREEN_INVENTORY.md`, `GOLDEN_JOURNEYS.md`).
- API contract tests derived from `API_INVENTORY.md` (auth matrix per route).
- State-machine tests from `STATE_INVENTORY.md` (recording states, encounter transitions).
- Flaky-test quarantine policy in `reports/test-runs/`.
