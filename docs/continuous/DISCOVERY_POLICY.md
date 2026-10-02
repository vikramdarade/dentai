# Discovery Policy

**Owner:** FREEBUFF (orchestration) · **Created:** 2026-09-28

## Purpose

Discovery is the standing process by which agents gather evidence about the repository — code structure, screens, APIs, states, tests, docs, CI — and convert unknowns into inventoried facts or ledger entries. Discovery never modifies application code.

## Cadence

- **On bootstrap or contract change:** full discovery pass (environment + repository, as performed by the bootstrap agent).
- **Before any implementer work:** scoped discovery of the surfaces being touched.
- **Continuous (per PR / per cycle):** differential discovery — what changed since the last recorded SHA.

## Method

1. Read only; record the HEAD SHA the discovery was performed at.
2. Cross-check three source classes: documentation claims, code reality, test coverage. Any disagreement between them is a finding (`DOC_DRIFT`, `TEST_GAP`, or defect).
3. Extend inventories (`docs/testing/*.md`) only with evidence: file paths, route registrations, line references. No invented entries.
4. Do not assume undocumented behaviour. If behaviour matters and is undocumented, it is a finding, not an assumption.

## Outputs

- Inventory updates in `docs/testing/`.
- New/updated ledger entries in `.control/quality-ledger.json` (status `OBSERVED`).
- Discovery reports under `reports/discovery/` named `YYYY-MM-DD-<topic>.md`.

## Boundaries

- No package installation, no code changes, no fixes. Fixes are triaged per `TRIAGE_POLICY.md`.
- Missing tooling is recorded as a BLOCKED dependency in the discovery report; never installed autonomously.
