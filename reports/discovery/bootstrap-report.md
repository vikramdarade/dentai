# DentAI Engineering Control Plane — Bootstrap Report

**Agent:** FREEBUFF · **Date:** 2026-09-28 · **STATUS: PASS (exit gate satisfied — see §7)**

---

## 1. Environment discovery

| Item | Value |
|---|---|
| Current directory | `C:/Users/swati/Downloads/dentai` |
| Repository root | `C:/Users/swati/Downloads/dentai` |
| Branch | `main` |
| HEAD SHA | `2cf786aac840eee69d520ebaae0a35d91c23ffe3` |
| Working tree at start | **CLEAN** (0 modified / 0 untracked) |
| PowerShell | 5.1.26100.9549 (Windows) |
| Git | 2.55.0.windows.3 |
| Node | v24.21.0 |
| npm / pnpm / yarn | npm 11.19.0 · pnpm MISSING · yarn MISSING |
| **Bun** | **MISSING** (BLOCKED dependency — repo's canonical package manager; `bun.lock`, CI and husky all use Bun; npm fallback exists in `.husky/pre-commit` and `package.json` scripts remain runnable) |
| Docker | MISSING (BLOCKED — only needed if Postgres suite is to run locally) |
| GitHub CLI | MISSING (BLOCKED — not required for control-plane operation) |
| Other tooling | tsx/vitest/playwright/esbuild present as project devDependencies (not yet executed — no installs or runs of app code in this bootstrap) |

Nothing was installed. Missing tools recorded as BLOCKED dependencies above.

## 2. Repository discovery (documented, not assumed)

- **Product:** DentAI — clinical documentation copilot for Australian dental practices (React 19/Vite + Express single app, Gemini verbaliser over a canonical ClinicalFact pipeline, Postgres/Neon with fail-closed JSON fallback, Vercel serverless). Sources: `README.md`, `PROJECT_CONTEXT.md`, `docs/FINAL_CLINICAL_SAFETY_AUDIT.md`.
- **Agent instructions:** `.agents/AGENTS.md` — 20 numbered working rules incl. protected safety rules (no synthesised evidence, name ≠ identity, epoch session tokens, path matching not `originalUrl`, anti-jargon UI copy).
- **Clinical documentation:** `docs/CLINICAL_FACT_SPECIFICATION.md`, `CLINICAL_EVALUATION_SPECIFICATION.md`, `GOLD_SET_SPECIFICATION.md`, `NOTE_RENDERING_CONTRACT.md`, `FINAL_CLINICAL_SAFETY_AUDIT.md` (verdict: ARCHITECTURALLY COMPLETE; documented Postgres environment gap).
- **Tests:** 76 test files (Vitest, `--fileParallelism=false` mandatory); suites incl. `macroSparseTranscript` (202-case fabrication matrix), `signOffValidation`, `negationScope`, `groundingVerification`, `patientIdentity`, `securityControls`. Playwright is a devDependency but **no E2E specs exist** — recorded as a gap.
- **CI:** `.github/workflows/ci.yml` — three jobs: `quality-gate` (lint+test+build, Bun frozen-lockfile), `postgres` (service container, migration rollback rehearsal), `clinical-eval` (`eval:notes --offline --min-score 0.9`).
- **Git hooks:** `.husky/pre-commit` runs lint + test (Bun if available, else npm).
- **Package manager:** Bun only — explicit rule against adding npm/yarn/pnpm lockfiles.
- **Known environment gap (from docs):** 19 Postgres tests skip without `DATABASE_URL`; must run in a DB-enabled environment before release.

## 3. Control plane created

```
docs/agents/       AGENT_CONTRACT.md + 9 role contracts (FREEBUFF, HERMES, ARCHITECT,
                   IMPLEMENTER, DETERMINISTIC_TESTER, CLINICAL_VERIFIER,
                   SECURITY_REVIEWER, E2E_TESTER, RELEASE_ENGINEER)
docs/testing/      TEST_STRATEGY, SCREEN_INVENTORY, API_INVENTORY, STATE_INVENTORY,
                   GOLDEN_JOURNEYS, SAFETY_INVARIANTS
docs/continuous/   DISCOVERY_POLICY, TRIAGE_POLICY, ISSUE_SCHEMA, PR_POLICY,
                   RELEASE_POLICY, AUTONOMY_POLICY
.control/          product-state.json, test-state.json, release-state.json,
                   agent-state.json, quality-ledger.json (+ quality-ledger.schema.json)
reports/           discovery/ test-runs/ bugs/ releases/ continuous/  (gitkeep'd)
```

All structures were missing; nothing pre-existing was overwritten.

## 4. Quality ledger

`.control/quality-ledger.json` created (empty, append-only policy) with schema `.control/quality-ledger.schema.json` supporting all mandated fields: id, category, engineeringSeverity, clinicalRisk, status, firstDetected, lastObserved, surface, screen, API, journey, reproduction, expected, actual, evidence, rootCause, rootCauseConfidence, regressionTest, recommendedAction, releaseRisk, owner, linkedIssue, linkedPR, linkedRelease. Enums implemented exactly as specified (P0–P3; CRITICAL→UNKNOWN; the 15 mandated statuses). Governance in `ISSUE_SCHEMA.md` + `TRIAGE_POLICY.md`.

## 5. Agent contracts

All 9 roles created with the mandatory report block (STATUS, OBJECTIVE, INPUTS, WORK_PERFORMED, FILES_CHANGED, TESTS_RUN, TEST_RESULTS, EVIDENCE, RISKS, OPEN_QUESTIONS, RECOMMENDED_NEXT_ACTION), autonomy levels per `AUTONOMY_POLICY.md`, and role-specific prohibitions. Contracts encode the protected-surface rule: **no agent may weaken patient identity, consultation identity, ClinicalFact semantics, evidence/provenance, grounding, sign-off, signed record immutability, authorization, audit/seal, or concurrency controls autonomously** (full table in `SAFETY_INVARIANTS.md`; also mirrored in `.control/agent-state.json`).

## 6. Validation performed

- JSON: all 6 `.control/*.json` files parsed with Node — **all VALID**.
- Documentation structure: all 22 mandated files present (ls evidence in transcript).
- Git state: `git status --porcelain` at HEAD `2cf786a…` shows **only** the five new untracked control-plane directories (`.control/`, `docs/agents/`, `docs/continuous/`, `docs/testing/`, `reports/`). **Zero application source files modified.** No commits were made.
- Working tree at bootstrap start recorded CLEAN in `.control/agent-state.json`.

## 7. Exit gate

| # | Condition | Result |
|---|---|---|
| 1 | Control-plane structure exists | **PASS** |
| 2 | JSON is valid | **PASS** (6/6 parsed) |
| 3 | Application source unchanged | **PASS** (only new control-plane dirs untracked) |
| 4 | Current SHA recorded | **PASS** (`2cf786aac840eee69d520ebaae0a35d91c23ffe3` in 4 state files) |
| 5 | Working-tree state recorded | **PASS** (CLEAN at start; post-bootstrap diff = control-plane files only) |
| 6 | Contracts exist | **PASS** (general + 9 roles) |
| 7 | Bootstrap report exists | **PASS** (this file) |

**EXIT GATE: PASS**

## 8. Risks & open questions

- **RISK — Bun missing locally:** typecheck/test/build cannot be executed on this machine until Bun is installed (deliberately not installed). Deterministic-tester runs require it.
- **RISK — E2E gap:** Playwright present but no journey specs; J1–J8 in `GOLDEN_JOURNEYS.md` are proposed, not yet executable.
- **RISK — inventories are drafts:** SCREEN/API/STATE inventories were bootstrapped from documentation and the codebase map; full route enumeration of `server.ts` (~4.6k lines) is a first discovery-cycle task.
- **OPEN QUESTION:** should the control-plane files be committed as their own commit (recommendation: yes, `docs: bootstrap engineering control plane`)?
- **OPEN QUESTION:** who is the human approver of record for PR/RELEASE policies?

**RECOMMENDED_NEXT_ACTION:** Install Bun (human action, closes the primary BLOCKED dependency), then run the full verification battery (`bun run lint && bun run test`) to baseline test-state with a fresh run at the recorded SHA.
