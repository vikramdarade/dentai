# Stage 1 Discovery Report — DentAI

**Controller:** Discovery Controller (Buffy) · **Date:** 2026-09-28
**COMMIT_SHA:** `2cf786aac840eee69d520ebaae0a35d91c23ffe3`
**STATUS: PASS — exit gate satisfied; all evidence passed to Stage 2 Consolidation**

---

## 1. Entry gate (verified before work started)

| Requirement | Result |
|---|---|
| Stage 0 PASS | `reports/discovery/bootstrap-report.md` EXIT GATE: PASS |
| Repository SHA recorded | `2cf786aac840eee69d520ebaae0a35d91c23ffe3` |
| Working tree known | Only untracked control-plane dirs; **zero application files modified** |
| Application can start | Verified live: `/api/health` → 200 on hermetic staging profile (port 4731) |
| Synthetic test environment | Temp-dir JSON store, `DENTAI_ALLOW_FILE_STORAGE=true`, `NODE_ENV=staging`, `DATABASE_URL` unset — **no production data or shared DB touched at any point** |

## 2. Workers — completion matrix

| Worker | Status | Report | Headline |
|---|---|---|---|
| 1A UI/JOURNEY | **PASS** (journey E2E BLOCKED) | workers/1A-ui-journey/report.md | No executable journey specs (known gap); API-layer-only auth on screens; inventory drift |
| 1B API | **PASS** | workers/1B-api/report.md | ~78 routes enumerated; auth boundaries hold live; unknown `/api/*` → 200 HTML (hygiene) |
| 1C STATE/CONCURRENCY | **PASS** | workers/1C-state-concurrency/report.md | Optimistic concurrency fail-closed live (400/409); Postgres branch unexecutable locally; `.env.local` precedence hazard |
| 1D CLINICAL SAFETY | **PASS** (1 urgent flag) | workers/1D-clinical-safety/report.md | Sign gate fail-closed live; 108/108 protected-surface suites green; 4 full-battery failures URGENT-flagged |
| 1E ERROR/RECOVERY | **PASS** (1 urgent flag) | workers/1E-error-recovery/report.md | Empty-body consultation create → 201 (urgent for triage); HTML error contract; secrets enforced; graceful quota degradation |
| 1F STATIC/ARCHITECTURE | **PASS** | workers/1F-static-architecture/report.md | Typecheck clean; no originalUrl governance bypass; API inventory materially stale (DOC_DRIFT) |

## 3. Step 2 handling — urgent clinical findings

Two findings were marked urgent during monitoring and preserved per protocol:

1. **F-1D-3** — 4 failing tests in the full battery (1116 passed / 4 failed / 22 skipped). Of these, `silenceAndStandby.test.ts` guards the clinical silence/standby boundary (protected surface 2) and one of its security tests **cannot execute** (fixture TypeError). Mitigating context: the repo's Gemini key is billing-depleted (402) and the suite reads `.env.local`, so some failures may be environment artifacts — re-verification on a quota-healthy key is BLOCKED here. Destructive exploration was not required; testing continued on independent paths.
2. **F-1E-1** — `POST /api/consultations` accepts an empty body with **201**, creating a record with blank `consent.obtainedAt`. No unsafe sign path was demonstrated (sign gate refuses it: 422 EMPTY_NOTE), but creation-side permissiveness is flagged for triage.

Neither was escalated as a confirmed CRITICAL clinical defect; both are passed to Stage 2 with full evidence packages.

## 4. Evidence inventory (all under reports/discovery/workers/)

- **1A**: evidence/index.html; UI census (23 components; App.tsx 813 lines); uiSafety suite pass.
- **1B**: evidence/route-inventory.md (full ~78-route table with auth classification); health.json; register.json; auth-probe bodies; urgent-unauth-200/ (headers+bodies).
- **1C**: consult-create.json / consult-update.json (server-set retention + revisions); sign 400/409 transcripts; health.json (storage mode); db.ts dotenv analysis.
- **1D**: full-suite.log (complete 67-file battery); sign-refusal.json, sign-refusal2.json (422), sign-stale.json (409).
- **1E**: malformed-json.body (400 HTML), missing-fields.body (201 blank-consent), unauth-write.body (401), bogus-id.body, oversized.body (413), ops/cron secret probes.
- **1F**: originalUrl-usage.txt (33 refs, none governance-decision); lint-clean result; config-key census (21).

## 5. Step 4 constraints honoured

- **No duplicate resolution** — overlapping observations (e.g. SPA-fallback 200s appear in 1B, 1E, 1F) are recorded as independently observed facts.
- **No root-cause decisions** — F-1D-3 and F-1E-1 are reported with evidence and alternative hypotheses, no verdicts.
- **No prioritisation** — no severity ordering is assigned beyond the binary urgent/non-urgent monitoring flag; ranking belongs to Stage 2.
- **No shared control-plane writes** — `.control/quality-ledger.json` untouched (entries: []). All outputs live under `reports/discovery/workers/*` plus this report.

## 6. Exit gate

| # | Condition | Result |
|---|---|---|
| 1 | All six workers completed or explicitly BLOCKED | **PASS** — 6/6 completed; BLOCKED items enumerated per worker (Postgres suite, journey E2E, quota-healthy re-run, Bun) |
| 2 | No application code changed | **PASS** — `git status` shows only control-plane/reports/docs additions; zero edits to app source, tests, or config |
| 3 | Every finding has an evidence package | **PASS** — F-1A-1…F-1F-4 each carry file references and reproduction commands |
| 4 | Worker outputs independently identifiable | **PASS** — one directory + report.md per worker, mandated 8 sections in each |
| 5 | Synthetic data only | **PASS** — synthetic clinician/patient/consultation in a temp-dir JSON store; no real records; first-boot DB mis-bind caught and killed before any write |
| 6 | Discovery report exists | **PASS** — this document |

## 7. Handoff to Stage 2 Consolidation

Stage 2 receives:

- 6 worker reports + evidence packages (`reports/discovery/workers/`)
- 2 urgent-flagged clusters (F-1D-3 test-failure cluster; F-1E-1 blank-consent creation) requiring dedup, root-cause analysis, and severity assignment
- Known BLOCKED dependencies to weigh during triage: Postgres test DB, quota-healthy Gemini key, missing Bun, missing Playwright specs for J1–J8
- Candidate quality-ledger entries (for Stage 2 to author per ISSUE_SCHEMA.md): F-1D-3 (TEST_GAP / possible defect), F-1E-1 (defect candidate), F-1B-1/F-1E-3 (API hygiene), F-1C-3 (operator hazard), F-1F-3 (DOC_DRIFT), F-1A-2 (TEST_GAP)

**STAGE 1: PASS — proceeding to Stage 2 Consolidation.**
