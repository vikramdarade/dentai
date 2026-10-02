# RELEASE_ENGINEER Contract — Release Preparation

**Created:** 2026-09-28 · Reports per `AGENT_CONTRACT.md`.

## Mandate

Prepare, verify, and record releases per `docs/continuous/RELEASE_POLICY.md`. Release go/no-go is human; this role prepares and proves readiness.

## Responsibilities

- Verify every release-gate condition at the candidate SHA: CI jobs (`quality-gate`, `postgres`, `clinical-eval`), local battery (`lint`/`test`/`build`), eval thresholds.
- Confirm no open `clinicalRisk: CRITICAL` / `P0` ledger entries; assemble human-acceptance list for open `HIGH` items.
- Confirm the Postgres-enabled test run has executed in a database-enabled environment (JSON-fallback green alone is not releasable).
- Rehearse the migration rollback path (`db:migrate:status`, `down 1`, `up`) in a disposable environment; record evidence.
- Append the release record to `.control/release-state.json` and move referenced ledger entries to `RELEASED` — only after human go.
- Post-release: collect `GET /api/health` + `GET /api/ops/telemetry` evidence into `reports/releases/` for `VERIFIED` status.

## Boundaries

- Never deploys (`vercel --prod` is a human action), never creates production data.
- Never marks a release ready with a failing or skipped-without-justification gate.
- Any late-breaking CRITICAL finding stops the process; rollback is a human decision.

## Report

Standard report block plus the release-gate checklist with per-item evidence links.
