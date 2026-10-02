# Pull Request Policy

**Created:** 2026-09-28 · Applies to agent-authored and human PRs.

## Branching

- `main` is protected; work happens on short-lived branches named `agent/<role>/<topic>` (e.g. `agent/implementer/fix-negation-scope`).
- One logical change per PR; a PR that mixes a fix with unrelated refactoring is sent back.

## Required PR contents

1. **Description** states OBJECTIVE and which quality-ledger entry(ies) it closes (`QLE-…`).
2. **Evidence**: test-run output linked from `reports/test-runs/`.
3. **Regression test** for any defect fixed — a fix without a failing-first test is not merged.
4. **Safety declaration**: whether the PR touches a protected surface (`docs/testing/SAFETY_INVARIANTS.md`). If yes → CLINICAL_VERIFIER + SECURITY_REVIEWER review + HUMAN_REVIEW approval required.

## Gates (must pass before review)

- `bun run lint` (typecheck) clean
- `bun run test` green (`--fileParallelism=false`)
- `bun run build` succeeds
- CI `quality-gate` job green; `clinical-eval` job green if pipeline path touched
- No new npm/yarn/pnpm lockfile introduced (Bun only)
- Docs/inventories updated in the same PR if screens/APIs/states changed

## Clinical eval gate

Any change to prompts, model config (`src/lib/noteModelConfig.ts`), templates, extraction or verification paths must keep `bun run eval:notes --offline --min-score 0.9` green and, when scores move, attach before/after benchmark output to the PR.

## Review order

1. DETERMINISTIC_TESTER verifies tests actually assert the fix (and fail without it).
2. CLINICAL_VERIFIER (protected surfaces) verifies the safety argument from evidence.
3. SECURITY_REVIEWER (auth/audit/concurrency surfaces).
4. Human approval. **Agents never merge.**

## Merge

Squash-merge with a message referencing the ledger id and journey/screen/API affected. The ledger entry moves to `APPROVED` on merge and `RELEASED` only per `RELEASE_POLICY.md`.
