# Issue Schema

**Created:** 2026-09-28 · The canonical issue/finding record is a **quality-ledger entry** in `.control/quality-ledger.json`, validated by `.control/quality-ledger.schema.json`.

## Field reference

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | ✅ | `QLE-YYYY-NNNN`, monotonic per calendar year |
| `category` | enum | ✅ | `DEFECT`, `SAFETY_INVARIANT_DRIFT`, `TEST_GAP`, `FLAKY_TEST`, `DOC_DRIFT`, `PERFORMANCE`, `SECURITY`, `ACCESSIBILITY`, `DX`, `OBSERVATION` |
| `engineeringSeverity` | enum | ✅ | `P0` `P1` `P2` `P3` |
| `clinicalRisk` | enum | ✅ | `CRITICAL` `HIGH` `MODERATE` `LOW` `NONE` `UNKNOWN` — only CLINICAL_VERIFIER may resolve `UNKNOWN` |
| `status` | enum | ✅ | `OBSERVED` `REPRODUCING` `CONFIRMED` `DUPLICATE` `TRIAGED` `PLANNED` `IN_PROGRESS` `PR_READY` `HUMAN_REVIEW` `REJECTED` `APPROVED` `RELEASED` `VERIFIED` `WONT_FIX` `BLOCKED` |
| `firstDetected` / `lastObserved` | date-time | ✅ | ISO 8601 |
| `surface` | string | — | `client` / `server` / `shared-lib` / `api` / `infra` / `docs` |
| `screen` | string\|null | — | id from `SCREEN_INVENTORY.md` |
| `API` | string\|null | — | id from `API_INVENTORY.md` |
| `journey` | string\|null | — | id from `GOLDEN_JOURNEYS.md` |
| `reproduction` | string\|null | — | deterministic steps / command |
| `expected` / `actual` | string\|null | — | |
| `evidence` | string[] | — | paths under `reports/`; **never inline clinical/PHI content** |
| `rootCause` | string\|null | — | |
| `rootCauseConfidence` | number\|null | — | 0–1 |
| `regressionTest` | string\|null | — | test file/name added or required |
| `recommendedAction` | string\|null | — | |
| `releaseRisk` | string\|null | — | consequence of shipping unfixed |
| `owner` | string\|null | — | agent role or human handle |
| `linkedIssue` / `linkedPR` / `linkedRelease` | string\|null | — | external references |

## Rules

1. Entries are **append and amend**: never delete; corrections are edits with a note in `recommendedAction` or an `activityLog` line.
2. Every `evidence` path must exist under `reports/`.
3. IDs are assigned by the FREEBUFF orchestrator or the triage agent; collisions are a process failure.
4. PHП and clinical content never enter the ledger or reports — refer by record id only, never by patient/consultation content.
