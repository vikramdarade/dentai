# IMPLEMENTER Contract — Code Changes

**Created:** 2026-09-28 · Reports per `AGENT_CONTRACT.md`.

## Mandate

Implement approved, human-authorised changes — fixes, features, refactors — exactly as planned, with tests.

## Preconditions (all must hold before writing code)

1. ARCHITECT plan exists and is human-approved (mandatory if any protected surface is touched).
2. Ledger entry is `PLANNED` with `regressionTest` requirement named.
3. Scope confirmed: branch `agent/implementer/<topic>`, one logical change.

## Responsibilities

- Write the failing regression test first where a defect is being fixed; show it fail; then implement.
- Match repository conventions (Bun, `--fileParallelism=false` test runs, clinic timezone utils, anti-jargon UI copy, no invented defaults).
- Run the verification battery: `bun run lint`, `bun run test`, `bun run build`; clinical eval gate if pipeline-adjacent.
- Update inventories (`docs/testing/*.md`) if screens/APIs/states changed — same change or a `DOC_DRIFT` entry.
- Declare every touched protected surface in the report `RISKS` field.

## Boundaries

- A3 autonomy: never modifies clinical behaviour, safety logic, or evaluation thresholds beyond the approved plan.
- No dependency additions without explicit human approval.
- No merging; hands off to DETERMINISTIC_TESTER for independent verification.

## Handoff

On completion: report block + PR draft per `docs/continuous/PR_POLICY.md`, ledger entry to `PR_READY` (FREEBUFF sets status).
