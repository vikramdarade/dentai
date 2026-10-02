# Triage Policy

**Owner:** FREEBUFF (orchestration) · **Created:** 2026-09-28

## Ledger entry lifecycle

Statuses (see `ISSUE_SCHEMA.md`): `OBSERVED → REPRODUCING → CONFIRMED → TRIAGED → PLANNED → IN_PROGRESS → PR_READY → APPROVED → RELEASED → VERIFIED`

Side exits: `DUPLICATE`, `REJECTED`, `WONT_FIX`, `BLOCKED`, `HUMAN_REVIEW`.

## Severity & risk classification

- **engineeringSeverity** (P0–P3): engineering impact. P0 = blocks release / breaks a core flow.
- **clinicalRisk** (CRITICAL→UNKNOWN): assessed **only** by CLINICAL_VERIFIER against `docs/testing/SAFETY_INVARIANTS.md`. Other agents set `UNKNOWN`, which forces `HUMAN_REVIEW`.

## Priority ordering for work

1. `clinicalRisk: CRITICAL` with confirmed reproduction
2. `engineeringSeverity: P0`
3. `clinicalRisk: HIGH` / `P1`
4. `clinicalRisk: MODERATE` / `P2`
5. `P3`, `DX`, `DOC_DRIFT`

Any entry with `clinicalRisk: CRITICAL` or `HIGH` **cannot** be `WONT_FIX` — only a human may close it, via `HUMAN_REVIEW`.

## Rules

1. No entry leaves `OBSERVED` without a reproduction or evidence link (`reports/` path).
2. `CONFIRMED` requires a deterministic reproduction (command, fixture, or test).
3. Every confirmed entry names a `regressionTest` requirement (existing or to-be-written) before entering `PLANNED`.
4. `rootCause` requires `rootCauseConfidence` (0–1). Below 0.7, the entry stays `REPRODUCING`/`CONFIRMED` with investigation recommended.
5. Protected-surface findings (see `SAFETY_INVARIANTS.md`) always route through `HUMAN_REVIEW` — no autonomous remediation, even for obvious fixes.
6. `DUPLICATE` entries must link the canonical entry in `recommendedAction`.
7. Triage decisions and transitions are appended to `.control/agent-state.json` `activityLog` by the acting agent.

## Verification closure

`VERIFIED` requires: regression test merged, full suite green at the recorded SHA (`bun run lint` + `bun run test`), clinical eval gate green if the pipeline path was touched, and evidence stored under `reports/test-runs/`.
