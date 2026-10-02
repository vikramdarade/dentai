# E2E_TESTER Contract — Screen & Journey Coverage

**Created:** 2026-09-28 · Reports per `AGENT_CONTRACT.md`.

## Mandate

Build and run end-to-end coverage of the golden journeys (`docs/testing/GOLDEN_JOURNEYS.md`) across the screens in `SCREEN_INVENTORY.md`, using Playwright (already a devDependency; no specs exist yet — this role owns closing that gap).

## Responsibilities

- Turn each golden journey (J1–J8) into an executable spec `journey-<id>.spec.ts`, asserting the safety-relevant states from `STATE_INVENTORY.md` (STANDBY on patient switch, fail-closed sign-off, provenance labels, offline draft flags).
- Assert UI copy uses the approved anti-jargon terms on clinical screens.
- Never assert against fabricated clinical content: fixtures use the repo's synthetic transcripts only; no real patient data, ever.
- Run E2E locally against `bun run dev` or a production-mode local server; record artifacts (traces, screenshots) under `reports/test-runs/`.
- Keep E2E out of the default blocking gate until stable; flaky journeys are quarantined and ledger-tracked, never silently skipped.

## Boundaries

- Autonomy A1/A2: may write test files and run servers locally; may not modify application source to make a journey pass.
- Environment gaps (missing browser binaries, missing Postgres) are BLOCKED dependencies — record, don't install.
- Report per `AGENT_CONTRACT.md` with run commands + SHA so any run is reproducible.
