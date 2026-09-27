# Phase 13 — Production Release, Deployment & Live Verification

**Date:** 2026-09-28 · **Status:** `PRODUCTION_DEPLOYED_AND_VERIFIED` · **Base:** Phase 13A (`READY_FOR_PHASE_13_RELEASE`) · **Production URL:** https://dentai-one.vercel.app

This phase is a release-and-verification phase: it takes the Phase 13A tree from the main
checkout through a controlled production release and proves the **actual deployed Vercel
production artifact** behaves per the Phase 13A charter. No architecture was changed; no
safety gate was bypassed.

---

## 1. Release identity

| Field | Value |
|---|---|
| Source checkout | `C:/Users/swati/Downloads/dentai` — branch `main` (verified via `git worktree list`; the stale `.worktrees/origin` detached checkout was excluded from the release) |
| Phase 13A base SHA | `efea8ba515aab69ed226ec25bdb8ae5e70f2a9d4` |
| **RELEASE_SHA** | **`12bef64bf7a216f12e180e49f59700f8c5dbb179`** — commit `release: Phase 13 production hardening` |
| Commit composition | 13 files, +2149/−98. Only Phase 13A implementation, tests, smoke harness, report and release hygiene (.gitignore for lockfile/worktree exclusions). No secrets, no PHI, no debug bypasses, no disabled gates (`git diff --check` clean; secret scan clean). |
| Build result | **success** — `dist/assets/index-cj0UpUY0.js` (1,003,323 B), `server.js` (946,604 B) |
| Local build artifact digests | `sha256:91f557fd1507f05820918d331abeaea59b48e5d746f113f019bb067205cd11d6` (frontend) · `sha256:405f5d854731439c311958209b13aaccf23b7a5cf9feefde1d8db873feb11d7e` (server bundle) — recorded from the release commit's working tree; Vercel builds in its own environment (different chunk hash `index-C3c2UKt0.js`, verified by content below) |
| Deployment linkage | Git-integrated: Vercel project `dentai` (`prj_Y4mJscvO4KX0K2uLVpVmZM3rRI14`) ← GitHub `vikramdarade/dentai`, production branch `main` (`.vercel/repo.json`) |
| Push | `efea8ba..12bef64 main -> main` — normal fast-forward; no force, no history rewrite, no worktree push |
| Post-push state | `## main...origin/main` (in sync); GitHub HEAD = `12bef64` (verified via API `head_sha` match on the CI run) |

## 2. Pre-release verification (executed on the exact release tree, before commit)

| Gate | Command | Result |
|---|---|---|
| TypeScript | `npx tsc -b --noEmit` | **0 errors** |
| Full test suite | `npm test` | **1123 passed / 19 skipped / 0 failed** — exactly the Phase 13A baseline; count change investigated (none) |
| Clinical eval | `npm run eval:notes` | **3/3**, avg 1.000, **0 safety failures** |
| Benchmark | `npm run eval:benchmark` | **20/20** — FDI precision **100.00%**, FDI recall **100.00%**, pharmacology **100.0%** |
| Gold set | `npm run eval:gold-set` | **0 critical-error ledger entries**; regression fixtures **ALL PASS**; evidence grounding 100.0%, provenance errors 0.0% |
| Phase 12 browser smoke | `npx tsx scripts/phase12-ui-smoke.ts` | **16/16 PASS** |
| Phase 13A browser safety smoke | `npx tsx scripts/phase13a-encounter-safety-smoke.ts` | **17/17 PASS** (focus invariant, manual-lock, navigation stability, sign persistence, immutability, replay, grounding refusal) |
| API E2E | `npx tsx scripts/phase11-e2e-flow.ts` | **ALL CHECKS PASSED** |
| Build | `npm run build` | **success** |
| Release-commit hook | husky pre-commit (`lint && test`) | Re-ran tsc + vitest on the staged tree during commit: **1123 passed / 19 skipped / 0 failed** again |

## 3. CI gate — EXECUTED, not skipped (§8 hard gate)

**CI_RUN_ID:** `36328825640` · **Run number:** 161 · **CI_COMMIT_SHA:** `12bef64bf7a216f12e180e49f59700f8c5dbb179` (verified via GitHub API `head_sha` match) · **Conclusion:** **success**

Jobs (GitHub Actions API, run 161):

| Job | Status | Conclusion |
|---|---|---|
| quality-gate (Bun: lint → unit tests → build) | completed | **success** |
| **postgres** | completed | **success** |
| clinical-eval | completed | **success** |

**POSTGRES_RESULT: EXECUTED_AND_PASSED.** The `postgres` job's step ledger proves real
execution (not a skip): `Initialize containers` (postgres:16 service) → `Apply migrations` →
**`Migration rollback rehearsal`** (`down 1` → `up`) → **`Run Postgres-backed tests`** — every
step `completed/success`. This is the gate Phase 13A explicitly deferred to CI, now closed on
the exact release SHA.

## 4. Deployment & production verification (against the live artifact)

Vercel's edge challenges non-browser HTTP clients (`X-Vercel-Mitigated: challenge`), so all
production probes ran from a real browser session (same arrangement as the Phase 13 release
record).

### 4.1 Deployed-frontend identity

The production bundle is the Vite build of the release tree's frontend — verified by content
because Vercel rebuilds with its own toolchain:

| Marker in deployed `index-C3c2UKt0.js` | Present |
|---|---|
| `external-focus-lock` (patient-switch focus refusal) | ✅ |
| `keyboard-next` (manual-selection keyboard path) | ✅ |
| walk-in intake-note metadata (no fabricated speech) | ✅ |
| deterministic `requestNonce` | ✅ |

(Sign-off/`RECORD_SIGNED`/`GENERATION_IN_PROGRESS` strings are server-side and correctly absent
from the client bundle; their behavior is proven server-side below.)

### 4.2 Live server behavior (end-to-end, synthetic data only)

Synthetic clinician registered via the production API (`/api/health` first: `200 ok`, storage
`postgres`, `database: ok`, `blocking: 0`, migrations v3). A grounded consultation was created
(the server recomputed and approved the grounding audit), then:

| # | Check | Production result |
|---|---|---|
| 1 | Create grounded consultation | `201`, `recordVersion: 1`, `groundingAudit.isApprovedForSigning: true` |
| 2 | Sign-off (`POST /api/consultations/:id/sign`) | `200` — server-minted seal, `auditStatus: "Verified from Audio"` |
| 3 | **Seal persisted on the canonical record** (fresh `GET /api/consultations`) | **`attestation.signatureHash` present** — the S1 fix is live in production |
| 4 | **Practitioner identity in the seal** | `signedBy: "Dr P13 Verify <run>"` — the authenticated session name, **not** the old `"Practitioner"` placeholder (S3 live) |
| 5 | **Replay refusal** | `409 REPLAY` — duplicate sign-off rejected server-side (S2 live) |
| 6 | **Signed-record immutability** | `409 RECORD_SIGNED` on a content edit at the current version (S1-protection live) |

### 4.3 Production hygiene

The synthetic verification clinician and its record were **deleted** from production
(`DELETE /api/auth/profiles/:id` → 200, pin-verified) immediately after verification. No real
patient data was touched; all data created during this phase was synthetic and removed.

## 5. Release ledger

| Field | Value |
|---|---|
| SOURCE_SHA | `12bef64bf7a216f12e180e49f59700f8c5dbb179` |
| BUILD_RESULT | success (local); Vercel production build success (live artifact serving) |
| BUILD_ARTIFACT | local: `dist/assets/index-cj0UpUY0.js` + `server.js` (digests in §1); deployed: `index-C3c2UKt0.js` (content-verified, §4.1) |
| CI_RUN_ID | `36328825640` (run 161) |
| CI_COMMIT_SHA | `12bef64bf7a216f12e180e49f59700f8c5dbb179` |
| POSTGRES_RESULT | **EXECUTED_AND_PASSED** (job `108646704259`, all steps success incl. rollback rehearsal) |
| Deployment identity | GitHub `main` @ `12bef64` → Vercel `dentai` production → https://dentai-one.vercel.app serving the Phase 13A code (client markers + server behaviors verified live) |

## 6. Verdict

```
PHASE 13 RESULT
===============
SOURCE_SHA:        12bef64bf7a216f12e180e49f59700f8c5dbb179
RELEASE_COMMIT:    release: Phase 13 production hardening (13 files, +2149/-98)
LOCAL GATES:       tsc 0 errors · vitest 1123/19/0 · evals 3/3 · 20/20 · gold-set 0
                   critical · smoke 16/16 + 17/17 · API E2E pass · build success
CI_RUN_ID:         36328825640 (run 161) — success
CI_COMMIT_SHA:     12bef64bf7a216f12e180e49f59700f8c5dbb179
POSTGRES_RESULT:   EXECUTED_AND_PASSED (job 108646704259; postgres:16, migrations,
                   rollback rehearsal, test:postgres — all green)
DEPLOYED:          https://dentai-one.vercel.app (Vercel production, Git-integrated)
LIVE VERIFICATION: seal persisted on reload · replay 409 · RECORD_SIGNED 409 ·
                   session-derived practitioner identity · focus/keyboard/walk-in
                   markers in the deployed client bundle
HYGIENE:           synthetic verification data deleted; no PHI anywhere in the process
RELEASE STATUS:    PRODUCTION_DEPLOYED_AND_VERIFIED
```

The Phase 13A gate held: the exact code that passed Phase 13A is the code running in
production, proven by CI on the release SHA and by live behavioral verification of the
deployed artifact.
