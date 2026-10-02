# DENTAI ASPECT READINESS REPORT

**Run:** DENTAI — FINAL PRE-DENTIST HARDENING RUN (continuation)
**Date:** 2026-09-29
**Base:** `origin/main` @ `23768f87b6ed4ade81f9cf90de30496e39db7d5f`
**Production URL:** https://dentai-one.vercel.app

Covers all **42** ledger findings, organised by aspect as requested: UI, API,
stage management, recovery, error handling, clinical safety, docs/infra/test gaps.

---

## OVERALL STATUS

# BLOCKED

| Layer | State |
|---|---|
| **Deployed release** (`main` @ `23768f87`) | Healthy and serving. QLE-2026-0022 verified live today. |
| **Prepared but NOT deployed** | Branch `fix/qle-2026-0042-api-error-json` (QLE-0042 fix) + branch `chore/keep-evidence-out-of-local-gates` (tooling). |
| **Blocker for dentist-readiness** | 2 × P0 / HIGH clinical-risk findings confirmed present: **QLE-0002** (wrong-patient surface), **QLE-0001** (logout data loss). Plus several P1 / HIGH (QLE-0003, 0004, 0007, 0008, 0006, 0005). |
| **Blocker for deployment** | No deployment credentials exist in this environment (see DEPLOYMENT). Deployment is a human action. |

---

## ASPECT 1 — ERROR HANDLING & API CONTRACT

| ID | Sev | Risk | Status | Summary |
|---|---|---|---|---|
| **QLE-2026-0022** | P2 | LOW | **VERIFIED** | unknown `/api/*` → 404 JSON. **Merged (PR #7) and verified live in production today.** |
| **QLE-2026-0042** | P2 | LOW | **PR_READY** | Malformed JSON → HTML 400 page; oversized body → HTML 413 page. **Fixed on `fix/qle-2026-0042-api-error-json`, 5 regression tests, not yet deployed.** |
| QLE-2026-0038 | P3 | LOW | OBSERVED | Raw provider messages can reach the chairside screen via job poll `statusDetail` (jargon, not a safety issue). |
| QLE-2026-0021 | P2 | LOW | OBSERVED | Fallback path reads client-cached versions; benign (server refuses 409 `STALE_VERSION`). |

**Error-handling assessment:** the `/api` error contract is now *closed for implementation* on the
branch — every failure mode under `/api` returns machine-parsable JSON. It is **not closed in
production** until QLE-0042 is deployed.

### QLE-2026-0042 — the new defect, with live production evidence

**Production, 2026-09-29, executed:**

```
POST /api/consultations   body: {"broken":
→ HTTP 400
→ content-type: text/html
→ <!DOCTYPE html> <html lang="en"> <head> <meta charset="utf-8">
   <title>Error</title> </head> <body> <pre>Bad Request</pre> </body> </html>
```

This is the **defect reproduced live in the currently deployed build**, and simultaneously the
"before" evidence for the fix.

**Root cause:** `server.ts` registered **no error-handling middleware at all**, with
`express.json({ limit: '1mb' })` at line 205. Body-parser errors therefore fell through to Express's
built-in handler, which renders HTML.

**Fix (branch `fix/qle-2026-0042-api-error-json`, commit `bf07bb8`):** an `/api`-scoped 4-arity error
handler registered after every `/api` route (mirroring the terminal 404) mapping
`entity.parse.failed` → `400 {code:'INVALID_JSON'}` and `entity.too.large` →
`413 {code:'PAYLOAD_TOO_LARGE'}`, plus a generic `500 {code:'INTERNAL_ERROR'}` so nothing under
`/api` can return HTML. Deliberately scoped to `/api` so SPA and dev-proxy behaviour is unchanged.

**Not the same fix as QLE-2026-0022** — kept as a separate defect, as instructed.

---

## ASPECT 2 — UI / CHAIRSIDE WORKSPACE

20 findings. This is where the highest clinical risk lives.

| ID | Sev | Risk | Status | Summary |
|---|---|---|---|---|
| **QLE-0001** | **P0** | **HIGH** | CONFIRMED | Logout clears `consultations` beneath a comment claiming it preserves the consult. **Human-gated.** |
| **QLE-0002** | **P0** | **HIGH** | CONFIRMED | History Hub reopen → wrong-patient surface via silent date-heuristic drop. **Human-gated.** |
| **QLE-0004** | P0 | HIGH | REPRODUCING | Mid-recording tab switch strands the recording with only a "Reset" (silent discard); no Finish control. |
| QLE-0009 | P1 | HIGH | OBSERVED | Finalization save reverted by a later poll response → self-inflicted `STALE_WRITE` loop. |
| QLE-0010 | P1 | HIGH | OBSERVED | Multi-tab lost update on the shared cache. |
| QLE-0011 | P1 | MODERATE | OBSERVED | "Nothing happened" for up to ~2 min; the transcript snapshot feeding the attempt is lost. |
| QLE-0012 | P1 | MODERATE | OBSERVED | `handleSaveConsultation` builds from a stale closure array → lost update round-tripped to the server. |
| QLE-0013 | P1 | MODERATE | OBSERVED | Rapid A→B→A switching with live speech can attribute A's final utterance to B's save. |
| QLE-0018 | P2 | MODERATE | OBSERVED | 25 s client poll deadline < 45 s server backoff → two different notes for one encounter, no signal. |
| QLE-0019 | P2 | MODERATE | OBSERVED | Duplicate transcript rows pollute the grounding evidence layer. |
| QLE-0020 | P2 | MODERATE | OBSERVED | Two divergent digest implementations; benign today, false-match risk if cross-compared. |
| QLE-0023 | P2 | MODERATE | OBSERVED | `expectedVersion` optional on existing records → silent last-write-wins. Fail-open by design. |
| QLE-0027 | P3 | LOW | OBSERVED | Macro records carry a client-asserted provenance label (cosmetic; sign gate re-evaluates server-side). |
| QLE-0028 | P3 | LOW | OBSERVED | A "MRONJ Risk" chip can appear from a transcript mention with no server-verified fact; template sentences originate client-side. |
| QLE-0033 | P3 | LOW | OBSERVED | One-way auto-focus latch: after one manual click, a newer walk-in is never suggested until reload. |
| QLE-0034 | P3 | LOW | OBSERVED | Same-millisecond collision → two schedule items over one record; non-UUID id defeats job dedupe (compounds QLE-0006). |
| QLE-0035 | P3 | LOW | OBSERVED | Digit keys land in the name field; only Enter blurs. Usability trap. |
| QLE-0037 | P3 | LOW | OBSERVED | Navigating to `#/demo` or `#/beacon` unmounts the workspace; live transcripts lost, no guard. |
| QLE-0040 | P3 | LOW | OBSERVED | Failed/finalizing ids are never pruned → stale-writer gate blocks navigation up to 25 s. |
| QLE-0041 | P3 | NONE | OBSERVED | 5 divergent `{sender|role|speaker}` normalizers; transcript-shape drift risk. |

**UI assessment:** the *verified* UI behaviour is good — the encounter-safety and UI smokes pass
(grounding badges, refusal display, seal display, focus invariant). But **20 open findings** sit on
this surface, including both P0s. The UI is the primary reason the product is not dentist-ready.

---

## ASPECT 3 — STAGE MANAGEMENT (operatory stage, recording lifecycle, job queue)

| ID | Sev | Risk | Status | Summary |
|---|---|---|---|---|
| **QLE-0004** | P0 | HIGH | REPRODUCING | Recording stranded when the stage's only Finish control unmounts. |
| **QLE-0006** | P1 | HIGH | REPRODUCING | Job id is `isUuid(consultationId) ? consultationId : randomUUID()` — non-UUID ids (the chairside path uses `consult-<ts>`, `chair-active`) defeat dedupe entirely → duplicate jobs/records. **Confirmed present.** |
| **QLE-0017** | P2 | MODERATE | REPRODUCING *(downgraded)* | Claimed double-metering. **Static review narrowed it**: submission is not metered (`recordUsage:false`), so the dedupe alone cannot double-count. Surviving mechanism is a concurrency race — both requests `await tickNoteJobs(true)` (server.ts:2057) over the **same queued job with no claim/lease in JSON mode**. Needs a concurrent probe. |
| QLE-0025 | P2 | LOW | OBSERVED | Four overlapping state machines, none authoritative; the strict transition table is dead code. |
| QLE-0011 / 0018 | P1/P2 | — | OBSERVED | Stage de-sync between client stage state and the durable job (see UI). |

**Stage-management assessment:** the stage machine has no single authority, and the job-queue
dedupe is defeated by exactly the id shapes the real chairside client emits. The QLE-0017
concurrency race is the same shared-queued-job hazard, so **QLE-0006 and QLE-0017 should be
triaged together** — both are fixed by a job claim/lease, which is a deliberate change, not a
small one.

---

## ASPECT 4 — RECOVERY & RESILIENCE

| ID | Sev | Risk | Status | Summary |
|---|---|---|---|---|
| QLE-0018 | P2 | MODERATE | OBSERVED | Client abandons polling before the server's first retry; divergent notes, no reconciliation. |
| QLE-0011 | P1 | MODERATE | OBSERVED | Failed generation offers no retry with the original transcript snapshot (only 5 s audio slices persist). |
| QLE-0036 | P3 | LOW | OBSERVED | Replay window is narrow: the persisted seal is checked before nonces, so a sealed-record replay still fails 409. Residual window is only a replay racing the first sign-off. |
| QLE-0039 | P3 | LOW | OBSERVED | Dev-only file store assumes single process; multi-process would see stale lock state. |
| QLE-0032 | P3 | NONE | **BLOCKED** | Postgres branch validated statically only — `SKIP LOCKED` claims and migration rollback never executed. |
| QLE-0031 | P2 | MODERATE | OBSERVED | A stray `DATABASE_URL` in `.env.local` silently selects the production persistence mode. |
| QLE-0029 | P2 | UNKNOWN | **BLOCKED** | 4 red tests, verdict withheld pending a quota-healthy provider key. |

**Recovery assessment:** no evidence of an unrecoverable loss *in the automated paths that passed*
(server restart, interrupted-session requeue, stale-write refusal are all covered by passing tests).
The gaps are in the **client** recovery UX (QLE-0011/0018) and in the **unexecuted** Postgres and
provider-dependent paths (QLE-0032/0029).

---

## ASPECT 5 — CLINICAL SAFETY (ClinicalFact, grounding, sign-off, provenance)

| ID | Sev | Risk | Status | Summary |
|---|---|---|---|---|
| **QLE-0003** | **P0** | **HIGH** | REPRODUCING | Sign-off `500` (`unguarded .trim(), attestation.ts:37`) **and the replay nonce is consumed before the crash** → retry gets `409 REPLAY` with no seal persisted. Sign-off dead-ends on a reachable record shape. |
| QLE-0005 | P1 | HIGH | REPRODUCING | No runtime enum-membership validation at the ClinicalFact trust boundary; casing/unknown enums bypass the status×temporal matrix. |
| QLE-0007 | P1 | HIGH | OBSERVED | 3 server-side writers bypass record governance: a transcript can be replaced under a record whose `groundingAudit` was computed over the old transcript, and over a **SIGNED** record's transcript (the seal digest covers findings, not the transcript). |
| QLE-0008 | P1 | HIGH | OBSERVED | Seal write not atomic vs a concurrent `PUT` → a `PUT` can clobber the seal; seal loss = immutability loss. |
| QLE-0028 | P3 | LOW | OBSERVED | Client-asserted clinical chip without a server-verified fact. |

**Clinical-safety assessment — and this is the good news:** every safety invariant **executed today
held**:

- **Grounding** — server authoritative. Correction invalidates approval; no stale "Verified from
  Audio" badge. `422 GROUNDING_NOT_APPROVED` on refusal.
- **Sign-off** — server authoritative. Server-minted seal; survives reload in a fresh browser.
- **Signed-record immutability** — `409 RECORD_SIGNED` on content edit.
- **Stale write** — refused (`STALE_WRITE` / `STALE_VERSION` / `REPLAY`).
- **No fabrication** — fake timestamps rejected; no tooth invented; no dose guessed; walk-in
  transcript empty.
- **Negation / temporal / speaker / FDI** — all pass the API E2E negative flows.
- **Provenance** — gold set: evidence grounding 100%, provenance errors 0.0%.

But QLE-0003/0007/0008 are **structural weaknesses in the same machinery that passed**: they are
windows *around* the gates (ordering, non-atomicity, bypassed writers), not failures of the gates
themselves. They must be closed before a dentist depends on the record in an audit.

---

## ASPECT 6 — DOCS, TEST GAPS, INFRA

| ID | Sev | Risk | Status | Summary |
|---|---|---|---|---|
| QLE-0030 | P3 | NONE | OBSERVED | `docs/testing/API_INVENTORY.md` drifts from reality (known). |
| QLE-0029 | P2 | UNKNOWN | BLOCKED | Provider-quota-blocked clinical risk verdict. |
| QLE-0032 | P3 | NONE | BLOCKED | Postgres claims unexecuted. |
| QLE-0031 | P2 | MODERATE | OBSERVED | Env-var silently flips persistence mode. |
| QLE-0039 | P3 | LOW | OBSERVED | Dev file store assumes single process. |

**Process gap found and fixed:** the workspace had **197 untracked files** whose presence broke
`tsc`, the full suite, **and the husky pre-commit hook — so no commit was possible at all**. Fixed on
`chore/keep-evidence-out-of-local-gates` (commit `db262b8`) by excluding `reports/` and
`.worktrees/` from `tsconfig.json` and `vitest.config.ts`. **No-op in CI** (a fresh clone contains
neither directory), so the local gate now measures exactly what CI measures.

---

## CHANGES

| Commit | Branch | Files | Purpose |
|---|---|---|---|
| `db262b8` | `chore/keep-evidence-out-of-local-gates` | `tsconfig.json` (+2/-1), `vitest.config.ts` (+6) | Unblock the local toolchain and the pre-commit hook. CI-neutral. |
| `bf07bb8` | `fix/qle-2026-0042-api-error-json` | `server.ts` (+44), `tests/server.test.ts` (+65) | QLE-2026-0042: `/api` error contract. 5 new regression tests. |
| `d885da7`, `db3b035`, `23768f8` | `main` | pre-existing | QLE-2026-0022 fix + tests + PR #7 merge. **Not authored in this run.** |

Branch topology: `fix/qle-2026-0042-api-error-json` contains `db262b8` then `bf07bb8`;
`chore/keep-evidence-out-of-local-gates` points at `db262b8` alone so the two can be PR'd separately.

**Nothing was pushed. No history was rewritten. No other agent's branch, worktree or uncommitted
change was touched.** (One local commit was split after an accidental bundling; it was unpushed and
created seconds earlier by me.)

---

## TEST RESULTS

Executed with the project's own commands (via `node_modules/.bin`, since `bun` is absent here).

| Gate | Result |
|---|---|
| TypeScript (`tsc -b --noEmit`) | **PASS** — exit 0. *(Now also with the plain project command, after the tooling fix.)* |
| Full suite | **PASS** — 66 files passed / 1 skipped (67); **1134 passed, 19 skipped, 0 failed** |
| QLE-2026-0022 suite | **PASS** — 6/6 cases |
| **QLE-2026-0042 suite (new)** | **PASS** — 5/5: 400 `INVALID_JSON`; 400 beats 404 on unknown route; 413 `PAYLOAD_TOO_LARGE`; valid JSON → 404 `API_NOT_FOUND`; `/api/health` unaffected |
| API E2E (`phase11-e2e-flow`) | **PASS** — all checks incl. negative safety flows |
| Browser smoke (`phase12-ui-smoke`) | **PASS** — Cases A–G + 3 schedule cases |
| Encounter-safety smoke (`phase13a`) | **PASS** — H1–H4 |
| Clinical eval | **PASS** — 3/3, avg 1.000, **0 safety failures** |
| Benchmark | **PASS** — 20/20, WER 0.00%, FDI 100% |
| Gold set | **exit 0** — regression fixtures pass; F1 53.1%, diagnosis 1.1% (quality debt) |
| Production build | **PASS** — `dist/index.html` + `server.js` |
| **Pre-commit hook** (`npm run lint && npm test`) | **PASS** — and it now passes, which it did not before the tooling fix |
| Postgres suite | **NOT RUN** — no DB/Docker; self-skips |
| Live-LLM integration | **NOT EXERCISED** — 19–22 tests self-skip on provider quota |

---

## PRODUCTION

| Item | Value |
|---|---|
| Serving build | `main` @ `23768f87` (QLE-2026-0022 included) |
| Production URL | https://dentai-one.vercel.app |
| `GET /api/health` | **200** — `database=ok`, `migrations=v3`, `blocking=0` |
| `GET` unknown `/api/*` | **404 JSON** `API_NOT_FOUND` ✅ **QLE-0022 live** |
| `POST` malformed JSON body | **400 `text/html`** → `<pre>Bad Request</pre>` ❌ **QLE-0042 live defect reproduced** |
| `GET /` , `/chairside` | **200 `text/html`** |
| Vercel deployment record / `githubCommitSha` | **NOT VERIFIABLE** — no token/API access. Argued from behaviour only. |
| GitHub CI conclusion for `23768f87` / new branches | **NOT VERIFIABLE** — no `gh` CLI. |

Non-browser clients (`curl`) receive `429` + a *"Vercel Security Checkpoint"* page from Vercel's
edge bot challenge. All production probes were therefore executed **from a real browser session** —
the same method documented in `docs/PHASE_13_INTEGRATED_RELEASE.md` §8.

---

## DEPLOYMENT

**Current production is up and serving correctly** (health 200, database ok, QLE-0022 fix live).

**The new work is NOT deployed, and I could not deploy it. Stated plainly:**

- `vercel` CLI: **not installed**
- `gh` CLI: **not installed**
- Vercel token / API credentials: **absent** (no such env vars)
- `bun`: **not installed**
- Per `docs/continuous/RELEASE_POLICY.md`, a production deploy is a **human action** anyway.

To ship it, a human must run (in order):

```bash
# 1. tooling (prerequisite — unblocks lint + the pre-commit hook)
git push -u origin chore/keep-evidence-out-of-local-gates
#    open PR, wait for CI (quality-gate, postgres, clinical-eval), merge

# 2. the API error-contract fix
git push -u origin fix/qle-2026-0042-api-error-json
#    open PR, wait for CI, merge to main

# 3. deploy (human-owned step)
vercel --prod
```

Then verification is **separate from deployment success** (they are not the same fact):

```bash
# from a real browser session, not curl (edge bot challenge):
POST /api/consultations   body {"broken":   -> expect 400 application/json INVALID_JSON
POST /api/consultations   body >1MB         -> expect 413 application/json PAYLOAD_TOO_LARGE
GET  /api/__missing__                       -> expect 404 application/json API_NOT_FOUND (regression guard)
```

I will not claim a deployment I did not perform, and I will not claim a green CI run I could not fetch.

---

## SAFETY

Every result below was **executed** in this run on synthetic data. No real patient data was used.

| Invariant | Result |
|---|---|
| WRONG PATIENT | **PASS in automated coverage** (focus invariant H1/H2) — **but QLE-0002's root cause survives**, so the wrong-patient *surface* class is an open finding |
| WRONG CONSULTATION | PASS — no adverse evidence; not separately adversarially tested |
| SIGNED RECORD IMMUTABILITY | PASS — `409 RECORD_SIGNED` (but QLE-0008 non-atomicity open) |
| STALE WRITE | PASS — `409 STALE_WRITE` / `STALE_VERSION` / `REPLAY` |
| GROUNDING | PASS — server authoritative; `422 GROUNDING_NOT_APPROVED` |
| SIGN-OFF | PASS — server-minted seal; survives reload (but QLE-0003 nonce-order bug open) |
| CLINICAL FACTS | PASS — contract tests + FDI 100% (but QLE-0005 enum gap open) |
| PROVENANCE | PASS — grounding 100%, provenance errors 0.0% |
| NO FABRICATION | PASS |
| NEGATION / TEMPORAL / FDI / SPEAKER | PASS |

---

## HUMAN ACTION REQUIRED

1. **QLE-0002** — intended behaviour when a record's date cannot be matched to the clinic day
   (normalise + always show, recommended; or show with a "confirm this patient" banner).
2. **QLE-0001** — is an in-progress consultation content that must survive logout; if yes, is
   persisting partially-composed content acceptable?
3. **QLE-0014** — which fields are required to create a consultation record?
4. **QLE-0015** — on an id collision, refuse (`409`, recommended) or versioned upsert?
5. **QLE-0026** — is phone-only auto-match acceptable on a DOB-less chart? (`CLINICAL_VERIFIER`)
6. **QLE-0003** — approve the nonce-ordering fix (consume the nonce only after a seal is persisted);
   it changes sign-off failure semantics.
7. **QLE-0006 + QLE-0017** — approve a job claim/lease in the JSON store (changes the queue's
   concurrency model; also the clinical-content-integrity question of double-generation).
8. **QLE-0031** — decide whether a stray `DATABASE_URL` should hard-fail startup rather than
   silently select the production persistence mode.
9. **Deploy** — run the three steps in DEPLOYMENT (credentials required).
10. **Workspace** — decide the fate of the 197 untracked scaffolding files (I neither committed nor
    deleted them; the tooling commit makes them harmless to the gates, but they are still untracked).

---

## REMAINING WORK

- **P0:** QLE-0002, QLE-0001, QLE-0003, QLE-0004.
- **P1 / HIGH:** QLE-0005, QLE-0006, QLE-0007, QLE-0008, QLE-0009, QLE-0010, QLE-0015.
- **Safe deferred (implementable, not yet done):** QLE-0016 (needs a decision), QLE-0017 (needs a
  concurrent probe), QLE-0018, QLE-0023, QLE-0033–0035, QLE-0037, QLE-0040, QLE-0041, QLE-0030.
- **Evidence required:** QLE-0017 (concurrency probe), QLE-0016 (behavioural probe), QLE-0026
  (verifier + probe).
- **Blocked:** QLE-0029 (provider quota), QLE-0032 (Postgres environment).
- **Non-blocking observations:** live-LLM path unexercised; gold-set diagnosis 1.1%; score
  variance on health-endpoint first response (`migrations=v0` once, `v3` on fresh calls);
  `API_INVENTORY.md` drift.
- **Ready to deploy:** QLE-2026-0042 `bf07bb8`, tooling `db262b8`.

---

## FINAL VERDICT

**Demonstrated by execution in this run:**

1. **QLE-2026-0022 is fixed and live.** 404 JSON `API_NOT_FOUND` for unknown `GET`/`POST`/nested
   `/api/*` on the production deployment, with `/api/health`, `/` and `/chairside` unaffected.
2. **QLE-2026-0042 is a real, currently-deployed defect, reproduced live in production** (malformed
   JSON → `400 text/html` `<pre>Bad Request</pre>`), and **is fixed on a branch** with 5 passing
   regression tests — *not deployed*.
3. **The workspace is unblocked** so that local gates and the pre-commit hook work again.
4. **Every release gate executable here passes**: TypeScript, 1134 tests (0 failures), API E2E,
   browser smoke, encounter-safety smoke, clinical evaluation (0 safety failures), benchmark,
   gold set, build.
5. **No safety invariant regressed** in anything executed.

**Not demonstrated:** GitHub CI and the Vercel deployment record (no credentials); the live-LLM
path (provider quota); the Postgres gate (no database); and fresh end-to-end reproduction of
QLE-0001/0002/0016/0017/0026.

**Therefore DentAI is not yet dentist-ready, and the new fix is not yet in production.** Two P0 /
HIGH clinical-risk findings (QLE-0002 wrong-patient surface, QLE-0001 logout data loss) remain
present in the live build, joined by P0 QLE-0003 (sign-off dead-end that consumes the replay nonce)
and P1 / HIGH QLE-0005/0006/0007/0008. Those are the difference between "the deployed release works"
and "a dentist can rely on it".
