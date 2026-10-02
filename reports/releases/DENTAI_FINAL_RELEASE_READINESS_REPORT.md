# DENTAI FINAL RELEASE READINESS REPORT

**Run:** DENTAI — FINAL PRE-DENTIST HARDENING RUN
**Date of execution:** 2026-09-29
**Reconciled base:** `origin/main` @ `23768f87b6ed4ade81f9cf90de30496e39db7d5f`
**Verification tree:** pristine worktree `.worktrees/verify-qle-0022` (detached at `db3b035`)
**Production URL:** https://dentai-one.vercel.app

---

## OVERALL STATUS

# BLOCKED

**Meaning, stated precisely:** this is **not** a `RELEASE_FAILED` — the release that is live works,
and QLE-2026-0022 is fixed and production-verified. It is **not** `READY_FOR_DENTIST`, and it is not
merely `READY_FOR_DENTIST_WITH_HUMAN_APPROVAL_REQUIRED`, because two **CONFIRMED, P0, HIGH
clinical-risk** defects are **still present in the live production build** and have not been fixed:

- **QLE-2026-0002** — History Hub reopen can land the clinician on the **wrong patient surface**
  (the safety invariants state this "must never occur").
- **QLE-2026-0001** — **Logout destroys unsaved clinical work** (silent data loss on a routine action).

Both are human-gated under this run's own safety boundary, and both are blocked on a *decision*,
not on engineering. DentAI cannot be handed to a dentist tomorrow while these two remain
unaddressed. Removing that block requires the four human decisions listed under **HUMAN ACTION
REQUIRED**.

---

## DEFECT TABLE

| ID | Current status | Currently reproducible? | Root cause | Fixed? | Tested? | Reviewed? | Released? | Production verified? | Human action required? |
|---|---|---|---|---|---|---|---|---|---|---|
| **QLE-2026-0022**<br>unknown `/api/*` → SPA HTML | **VERIFIED** | Was (2 workers) | SPA `get *` fallback mounted before any API 404 handler | **YES** | **YES** — 6-case suite, 55/55 pass | **YES** — PR #7 merged by founder | **YES** — in `main` @ `23768f87` | **YES** — 6/6 live probes (§PRODUCTION) | No |
| **QLE-2026-0001**<br>logout destroys unsaved work | **CONFIRMED** | Not re-reproduced this run (code path present) | `App.handleLogout` clears `consultations` beneath a comment claiming it preserves the consult | **NO** | **NO** — no test exists | Not reviewed | Not released | n/a (unfixed) | **YES — product decision** |
| **QLE-2026-0002**<br>History Hub wrong-patient surface | **CONFIRMED** | Not re-reproduced this run (code path present) | `encountersForDate` 4-way date heuristic silently drops unmatched records; focus falls back to scratchpad | **NO** | **NO** — no test exists; phase13a does not cover this path | Not reviewed | Not released | n/a (unfixed) | **YES — product decision** |
| **QLE-2026-0014**<br>empty consultation body → blank record | **CONFIRMED** | **Yes** — code path confirmed present | `POST /api/consultations` validates body *type* only; no required-field gate | **NO** | **NO** | Not reviewed | Not released | n/a (unfixed) | **YES — clinical field set** |
| **QLE-2026-0015**<br>client id collision → silent overwrite | **CONFIRMED** | **Yes** — code path confirmed present | JSON store POST path upserts by id with no conflict check and answers `201` | **NO** | **NO** | Not reviewed | Not released | n/a (unfixed) | **YES — 409 vs versioned upsert** |
| **QLE-2026-0016**<br>`POST /api/patients` DOB loss | **CONFIRMED** | Code path present; behavioural probe missing | Route reads `req.body.dob` only; never reads `dateOfBirth`; no format validation | **NO** | **NO** | Not reviewed | Not released | n/a | Yes — patient-identity surface |
| **QLE-2026-0017**<br>duplicate submission meters twice | **CONFIRMED** | **Not established** — static read insufficient | Exact double-increment path not visible from the submit handler | **NO** | **NO** | Not reviewed | Not released | n/a | Evidence first |
| **QLE-2026-0026**<br>phone-only auto-match on DOB-less chart | **CONFIRMED** (conf. 0.75) | Not probed | `patients/resolve` treats missing stored DOB + matching phone as decisive | **NO** | **NO** | Not reviewed | Not released | n/a | **YES — `CLINICAL_VERIFIER` policy call** |

Everything else in the ledger (41 entries total) is `OBSERVED`, `REPRODUCING` or `BLOCKED` and was
not actioned this run. Note the ladder gap: the ledger entry for **QLE-0003** (P0, HIGH — sign-off
`500` + consumed replay nonce on nameless records) was **not** in this run's prioritised list and is
**not** covered by my verification; it should be triaged next.

**Severity-source discrepancy to resolve:** the run brief lists QLE-0001 as "P1 / HIGH"; the ledger
lists it **P0 / HIGH**. The ledger is the declared source of truth and is what I used.

---

## CHANGES

**No application code was changed in this run.** QLE-2026-0022 was already implemented, merged and
deployed before the run began; per §3 of the brief it was **verified, not rewritten**.

| Commit | Branch | Files | Purpose |
|---|---|---|---|
| `d885da7` | `fix/qle-2026-0022` | `server.ts` (+14) | *Pre-existing.* API-scoped terminal 404 returning `{error, code:'API_NOT_FOUND'}` JSON, registered after all `/api` routes and before the SPA fallback |
| `db3b035` | `fix/qle-2026-0022` | `tests/server.test.ts` (+24) | *Pre-existing.* Seeds `dist/index.html` for the suite only when real build output is absent (CI runs tests before `build`) |
| `23768f87` | `main` | merge | *Pre-existing.* **Merge pull request #7** from `fix/qle-2026-0022` |

**Files I created (all evidence, no code):**

- [QLE-2026-0022-PRODUCTION-VERIFICATION.md](reports/releases/QLE-2026-0022-PRODUCTION-VERIFICATION.md) — production probe evidence
- [HUMAN-GATED-EVIDENCE-PACKS.md](reports/releases/HUMAN-GATED-EVIDENCE-PACKS.md) — prepared, unreleased packs for QLE-0001/0002/0014/0015
- This report

**Ledger updated (evidence-backed only):** [.control/quality-ledger.json](.control/quality-ledger.json) — `QLE-2026-0022` set to `VERIFIED`, `linkedPR: "#7"`, `linkedRelease` recorded, production evidence appended, `lastObserved` advanced. Validated: 41 entries, JSON parses, **0 unexpected keys** (schema is `additionalProperties:false`), 0 duplicate ids. No new schema field was needed. No historical evidence was deleted or rewritten.

**Repository hygiene:** I created the throwaway worktree `.worktrees/verify-qle-0022` for faithful
verification and removed it after use. No other worktree, branch, or uncommitted change of any other
agent was touched. No commit was made by me.

---

## TEST RESULTS

All gate results below were produced in a **pristine worktree** (exactly what CI sees), because the
main working tree is contaminated by untracked scratch files — see **WORKSPACE INTEGRITY** below.
Toolchain note: `bun` was **not installed** in this environment, so the project's own commands were
executed through the repo's local binaries in `node_modules/.bin` (`tsc`, `vitest`, `vite`, `esbuild`,
`tsx`). No lockfile was created or changed — `package-lock.json` present in the tree is gitignored
local debris, not a repo artefact.

| Gate | Command | Result |
|---|---|---|
| **TypeScript** | `tsc -b --noEmit` | **PASS** (exit 0) |
| **Unit + integration (full)** | `vitest run --fileParallelism=false --test-timeout=30000` | **PASS** — 66 files passed, 1 skipped (67); **1126 passed, 22 skipped, 0 failed**; 24.36 s |
| **QLE-0022 targeted suite** | `vitest run tests/server.test.ts` | **PASS** — **55/55 passed**; 49.4 s |
| **API E2E** | `tsx scripts/phase11-e2e-flow.ts` | **PASS** — *"ALL CHECKS PASSED"* incl. all negative safety flows |
| **Browser smoke** | `tsx scripts/phase12-ui-smoke.ts` | **PASS** — *"ALL SMOKE CHECKS PASSED"* (Cases A–G + 3 schedule cases) |
| **Encounter-safety smoke** | `tsx scripts/phase13a-encounter-safety-smoke.ts` | **PASS** — *"ALL ENCOUNTER-SAFETY CHECKS PASSED"* (H1–H4) |
| **Clinical evaluation** (CI gate) | `eval:notes --offline --min-score 0.9` | **PASS** — 3/3 fixtures, average score **1.000**, **0 safety failures** |
| **Benchmark** | `eval:benchmark` | **PASS** — 20/20 cases; WER **0.00%**; FDI precision **100%**, recall **100%**; pharmacology sensitivity **100%**; mean latency **1.9 ms** |
| **Gold set** | `eval:gold-set` | **EXIT 0** — regression fixtures ALL PASS. Quality signal (see below) |
| **Production build** | `vite build && esbuild server.ts…` | **PASS** — 2129 modules; `dist/index.html` + `server.js` (924.6 kB) emitted |
| **Postgres suite** | `vitest run tests/postgres.test.ts` | **NOT RUN** — no Postgres/Docker in this environment; the file self-skips (that is the "1 skipped" file) |

**The 22 skipped tests are a real evidence gap, not a pass.** They are the live-LLM integration
tests, which self-skipped on `RESOURCE_EXHAUSTED` (Gemini quota). **The live model path was not
exercised in this run.** The deterministic macro path was (benchmark, gold-set, E2E, UI smoke).
No test was weakened, deleted, or suppressed to obtain any result above.

**Gold-set quality signal (reported, not hidden):** Fact precision/recall/F1 = 56.5% / 50.1% / 53.1%;
omission 49.9%; hallucination 43.5%; **diagnosis 1.1%**; surface 25.6%; negation 66.7%; tooth 100%;
medication/dose/allergy 100%; **evidence grounding 100%**; **provenance errors 0.0%**. The script
exits 0 because its hard gate is the regression fixtures, but extraction quality — especially
diagnosis — is materially below what a dentist-ready claim would want. It is **not** an
introduced regression (nothing changed in this run) and is flagged as release-quality debt.

---

## PRODUCTION

| Item | Value |
|---|---|
| Release commit | `23768f87b6ed4ade81f9cf90de30496e39db7d5f` (`main`) |
| Production URL | https://dentai-one.vercel.app |
| Vercel deployment record | **NOT VERIFIABLE from this environment** — no Vercel API token and no `gh` CLI. I did not query, and I do not infer, the deployment id or its `githubCommitSha`. |
| GitHub CI conclusion for the merge commit | **NOT VERIFIABLE from this environment** — same reason. Reported as a gap, not assumed green. |
| Deployment status | Inferred **behaviourally only**: the QLE-0022 fix is live (below), so the serving build is at or after `23768f87`. |

### QLE-2026-0022 production verification — **6/6 PASS**

Direct `curl` **cannot** reach the app: every request returns `429` with a *"Vercel Security
Checkpoint"* HTML page (Vercel's edge bot challenge, `X-Vercel-Mitigated: challenge`). This is
expected and already documented in `docs/PHASE_13_INTEGRATED_RELEASE.md` §8, which records that the
prior Phase 13 smoke was likewise run *"from a real browser session"*. I used the same method — a
real browser session on the production origin.

| # | Probe | Expected | **Actual** |
|---|---|---|---|
| 1 | `GET /api/__qle0022_missing__` | 404 JSON | **404**, `application/json` — `{"error":"API endpoint not found","code":"API_NOT_FOUND"}` |
| 2 | `POST /api/__qle0022_missing__` | 404 JSON | **404**, `application/json` — same body |
| 3 | `GET /api/qle0022/nested/missing` | 404 JSON | **404**, `application/json` — same body |
| 4 | `GET /api/health` | normal 200 | **200**, `application/json` — `status=ok`, `version=0.1.0-rc.1`, `database=ok`, `migrations=v3`, `blocking=0` |
| 5 | `GET /` | 200 HTML | **200**, `text/html` — SPA shell |
| 6 | `GET /chairside` | 200 HTML | **200**, `text/html` — SPA shell |

**This probes the defect, not the deployment.** Had the live build predated the fix, probes 1–3 would
have returned `200 text/html` (the SPA shell). They returned `404 application/json`. Deployment
success and defect verification are therefore recorded as **separate facts**, and only the second is
claimed.

**Minor non-blocking observation:** the first health response (direct navigation) reported
`migrations=v0`; four subsequent cache-busted `fetch()` calls all reported `migrations=v3`, matching
the Phase 13 baseline. A health endpoint served from edge cache on first hit merits a separate
low-priority look. It is **not** part of QLE-2026-0022 and was **not** folded into it.

---

## SAFETY

Every result below is from an **executed** check in this run, on synthetic data only. No real patient
data was used anywhere.

| Invariant | Result | Evidence |
|---|---|---|
| **WRONG PATIENT** | **PASS in automated coverage — but see unresolved finding** | phase13a H1: active patient **remains P1** after an external walk-in is injected by another browser; operatory banner still names P1. H2: `⌘→` manual lock holds against further external events; `⌘←`/`⌘→` stable. **However, QLE-0002's root cause survives in code (History Hub reopen path), which is a wrong-patient-*surface* class and is not covered by phase13a.** Reported as unresolved. |
| **WRONG CONSULTATION** | **PASS** — no adverse evidence | No check exposed wrong-consultation addressing. Not separately adversarially tested this run. |
| **SIGNED RECORD IMMUTABILITY** | **PASS** | phase13a H4: content edit to a signed record refused **409 `RECORD_SIGNED`**; duplicate sign-off refused **409 `REPLAY`**. |
| **STALE WRITE** | **PASS** | Phase 13 ledger records 409 `STALE_WRITE` with the server record/version; this run re-confirmed 409 `STALE_VERSION`/`REPLAY` refusal behaviour in phase13a. |
| **GROUNDING** | **PASS — server authoritative** | phase12-ui-smoke Case D: after a correction invalidates grounding, the stale **"Verified from Audio"** badge does **not** persist. Case A: unverified note never displays it. Case C: macro path shows *"Template Applied"*, never a verified claim. API E2E negative flows: no false verification of a negated procedure. |
| **SIGN-OFF** | **PASS — server authoritative** | phase12-ui-smoke Case F: refusal carries server code **`GROUNDING_NOT_APPROVED`** and no signed state is presented. Case G: the **server-minted** seal is displayed after sign-off. phase13a H3: signed state **survives reload in a fresh browser** (server-persisted). |
| **CLINICAL FACTS** | **PASS — no regression** | `tests/clinicalFactContract.test.ts` in the 1126 passing tests. Benchmark FDI precision/recall **100%**. **But QLE-0005** (no runtime enum-membership validation at the ClinicalFact trust boundary) remains open — unresolved. |
| **PROVENANCE** | **PASS** | API E2E: *"no invented evidence"*, *"evidence-less fact admits its state honestly"*. Gold set: **provenance errors 0.0%**, **evidence grounding 100.0%**. |
| **NO FABRICATION** | **PASS** | API E2E: fabricated/negative timestamps rejected; ambiguous reference invents no tooth; no dose guessed for vague medication speech; no performed filling from a negated procedure. phase13a H1: walk-in transcript contains **NO fabricated speech**. |
| **NEGATION** | **PASS** | API E2E negative flows: negated procedure yields no performed fact; planned ≠ performed; planned status preserved. |
| **TEMPORAL** | **PASS** | API E2E: fabricated/negative timestamps rejected by validation; planned/patient-speculation states preserved. |
| **FDI / TOOTH** | **PASS** | Benchmark FDI precision **100%**, recall **100%**; API E2E: ambiguous reference invents no tooth. |
| **SPEAKER DISTINCTION** | **PASS** | API E2E: patient speculation never becomes a clinician diagnosis; patient-voiced statements stay patient-reported. |

**Unresolved safety findings (all carried, none released):** QLE-0001 (P0/HIGH — logout data loss),
QLE-0002 (P0/HIGH — wrong-patient surface), QLE-0003 (P0/HIGH — sign-off 500 + consumed nonce),
QLE-0005 (P1/HIGH), QLE-0006 (P1/HIGH), QLE-0007 (P1/HIGH), QLE-0008 (P1/HIGH), QLE-0014,
QLE-0015, QLE-0016, QLE-0017, QLE-0026.

---

## HUMAN ACTION REQUIRED

Only genuine decisions. Each is blocking something that is otherwise ready to implement.

1. **QLE-0002 — intended behaviour when a stored record's date cannot be matched to the clinic day.**
   Normalise dates and always show the record (recommended), or show it with an explicit
   "date unverified — confirm this patient" banner? *(Wrong-patient surface; P0.)*

2. **QLE-0001 — is the in-progress consultation content that must survive logout?**
   If yes, confirm that persisting the chair-active scratchpad on logout is acceptable (it writes
   partially-composed clinical content to storage), or choose explicit user-visible discard
   semantics. *(Silent clinical data loss; P0.)*

3. **QLE-0014 — which fields are required to create a consultation record?**
   May a consultation exist before any content is dictated (needed by the daysheet / chair-side
   quick-start flows), and if so what minimum fields must be present? *(Clinical contract decision.)*

4. **QLE-0015 — on an id collision against an existing consultation, refuse (`409`) or converge as an
   explicit versioned upsert?**
   Refusal is safer and recommended, but it changes behaviour for any caller relying on
   replace-by-id. *(Persistence of clinical information.)*

5. **QLE-0026 — is phone-only auto-match acceptable when the stored chart has no DOB?**
   A `CLINICAL_VERIFIER` policy call, not an engineering one.

6. **Workspace hygiene — what should happen to the 197 untracked scaffolding files**
   (`.control/`, `docs/agents/`, `docs/continuous/`, `docs/testing/`, `reports/`)? They appear to be
   the partially-built Continuous Engineering Control Plane this run was told not to build, and they
   currently break local typecheck and local full-suite runs. **I deliberately neither committed nor
   deleted them.**

**Not listed** (routine engineering, does not need a human): everything else, including running the
Postgres gate in CI, fetching the CI/deployment records with credentials, and writing the regression
tests for the confirmed defects.

---

## REMAINING WORK

**P0**
- QLE-0002 — History Hub wrong-patient surface (needs decision #1, then normalise dates + fail-loud match, then a live reproduction + regression test).
- QLE-0001 — logout destroys unsaved clinical work (needs decision #2, then a browser E2E regression test).
- QLE-0003 — sign-off `500` on nameless records **and a consumed replay nonce**, which dead-ends finalisation. Not in this run's prioritised list; requires its own triage.

**P1**
- QLE-0006 — duplicate jobs/records for non-UUID consultation ids (dedupe can never fire).
- QLE-0007 — three server-side writers bypass record governance (transcript can change under a signed record).
- QLE-0008 — seal write not atomic w.r.t. concurrent `PUT`.
- QLE-0005 — no enum-membership validation at the ClinicalFact trust boundary.
- QLE-0015 — silent overwrite on id collision (decision #4).

**HIGH clinical risk**
- All of the above carry HIGH clinical risk; additionally QLE-0004 (stranded recording with no finish path).

**Safe deferred**
- **Malformed-JSON (400) and payload-limit (413) HTML error pages** — part of the *original* QLE-2026-0022 ledger entry. **Deliberately not folded into the 404 fix**, per instruction. They remain a separate, still-unfixed finding and should get their own defect id.
- QLE-0018 (25 s client poll deadline < 45 s server backoff → note divergence), QLE-0023 (`expectedVersion` optional on existing records → silent last-write-wins).
- Health-endpoint first-response `migrations=v0` (edge-cache observation).
- Postgres gate not executable locally — close it in CI.

**Evidence required** (do not implement yet)
- QLE-0016 — behavioural probe for `dateOfBirth`/malformed `dob` against a disposable store.
- QLE-0017 — deterministic two-request probe asserting exactly one usage increment.
- QLE-0026 — `CLINICAL_VERIFIER` assessment + conflicting-DOB probe.

**Non-blocking observations**
- 22 live-LLM integration tests skipped on provider quota; the live model path was not exercised this run.
- Gold-set extraction quality: F1 53.1%, **diagnosis 1.1%**, omission 49.9%, hallucination 43.5%.
- `docs/testing/API_INVENTORY.md` is known-drifted (QLE-2026-0030).
- `bun` absent from this environment; all project commands were run through `node_modules/.bin`.
- The **41-entry quality ledger lives in an untracked directory**, so the declared "source of truth" for the backlog is **not in the repository**.

### WORKSPACE INTEGRITY (must be resolved — it silently invalidates local gates)

The working tree contained **197 untracked files**, of which **167 are under `reports/`**, including a
scratch test file at `reports/discovery/workers/1D-clinical-safety/evidence2/fact-attacks.test.ts`.
Because `tsconfig.json` declares **no `include`/`exclude`**, and Vitest's default glob matches that
path:

- local `tsc -b --noEmit` **FAILS in the main working tree** (8 errors, all from that scratch file),
  while the **tracked** project typechecks cleanly (`exit 0` in a pristine worktree);
- a local full-suite run in the main working tree would **execute untracked scratch code**.

**CI is unaffected** (fresh clone never sees `reports/`). Every gate result in this report was
therefore produced in the pristine worktree. Until this is resolved, **local typecheck and
full-suite results from the main working tree are not trustworthy.**

---

## FINAL VERDICT

**What has been demonstrated, on evidence actually executed in this run:**

1. **QLE-2026-0022 is fixed, merged and live in production.** The fix (`d885da7`) and its regression
   tests (`db3b035`) are ancestors of `origin/main` @ `23768f87`; **PR #7 was merged by the human
   founder**, which satisfies the human review gate. On the production deployment,
   `GET`/`POST`/nested unknown `/api/*` all return **HTTP 404 `application/json`** with
   `{"error":"API endpoint not found","code":"API_NOT_FOUND"}`, while `/api/health`, `/`, and
   `/chairside` are unaffected — **6/6 probes passed**. The ledger is updated to `VERIFIED` with that
   evidence. **QLE-2026-0022's lifecycle is complete.**

2. **Every release gate that can execute in this environment passes on the tracked tree:**
   TypeScript, 1126 unit/integration tests (0 failures), API E2E, browser smoke, encounter-safety
   smoke, clinical evaluation (0 safety failures), benchmark (20/20), gold set (regression fixtures
   pass), and the production build.

3. **No clinical safety invariant regressed in anything executed here:** no wrong-patient outcome was
   observed in automated coverage; grounding, sign-off, signed-record immutability, stale writes,
   negation, temporal meaning, FDI, speaker distinction, provenance and no-fabrication all held.

**What has NOT been demonstrated:**

- The **GitHub CI** conclusion and the **Vercel deployment record** for `23768f87` — no `gh` CLI and
  no Vercel credentials exist in this environment. This is an **explicit evidence gap**, and
  deployment identity is argued from observed behaviour only.
- The **live LLM model path** — 22 integration tests self-skipped on provider quota.
- The **Postgres** gate — no database available locally.
- **Live reproduction** of QLE-0001, QLE-0002, QLE-0016, QLE-0017 or QLE-0026. For each I have
  static confirmation that the code path exists, and for QLE-0014/QLE-0015 direct confirmation of
  the handler behaviour — **not** a fresh end-to-end reproduction.
- Anything at all about the **41 other ledger entries**, which I did not action.

**Therefore: DentAI is NOT `READY_FOR_DENTIST`.** Two CONFIRMED P0 / HIGH-clinical-risk defects
(QLE-0002 wrong-patient surface; QLE-0001 logout data loss) remain present in the live build, and
several P1 / HIGH items remain open. The safest live defect (QLE-2026-0022) has been taken
end-to-end and is genuinely closed; the rest are prepared and waiting on the six human decisions
above. I do not claim production verification of anything I did not probe, and I do not claim a
green CI or Vercel record I could not fetch.
