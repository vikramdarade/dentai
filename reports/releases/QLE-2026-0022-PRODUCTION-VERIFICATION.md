# QLE-2026-0022 — Unknown `/api/*` must return API 404 JSON

**Status: PRODUCTION VERIFIED** (2026-09-29)
**Defect:** `unknown /api/* → SPA HTML with HTTP 200`
**Branch:** `fix/qle-2026-0022` · **PR:** #7 (merged) · **Merged commit:** `23768f87b6ed4ade81f9cf90de30496e39db7d5f`
**Fix commits:** `d885da7` (`server.ts`), `db3b035` (regression-test seeding)

---

## 1. Reconciled state at run start

The defect was found to be **already implemented, reviewed, merged and deployed** before this run
began. This document is therefore verification + evidence, not a re-implementation. The fix was
**not** rewritten.

| Fact | Value |
|---|---|
| Current branch | `fix/qle-2026-0022` @ `db3b035` (== `origin/fix/qle-2026-0022`) |
| Production branch | `main` @ `23768f87` = *"Merge pull request #7 from vikramdarade/fix/qle-2026-0022"* |
| Is the fix an ancestor of `origin/main`? | **Yes** (`git merge-base --is-ancestor db3b035 origin/main` → true) |
| Local `origin/main` before fetch | `2cf786a` (stale, last fetched 2026-09-28 01:25) — refreshed by `git fetch` |
| Local `origin/main` after fetch | `23768f87` |

Note: local `origin/main` was **stale** at the start of this run. The merge of PR #7 was only
visible after `git fetch origin`. Any earlier claim that "no PRs exist" was a stale-ref artefact.

## 2. Implementation (in `server.ts`, ~line 5024)

```ts
// API terminal 404.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found', code: 'API_NOT_FOUND' });
});
```

Registered **after** every `/api` route and **before** the SPA fallbacks. Uses `app.use('/api', …)`
prefix matching (Express 4 / path-to-regexp 0.x compatible) rather than a wildcard route, so it
cannot shadow parameterised routes. The installed Express version is `^4.21.2` (verified in
`package.json`) — no Express 5 syntax was introduced.

## 3. Regression tests (in `tests/server.test.ts`, `describe('DentAI Server - API 404 fallback (QLE-2026-0022)')`)

Covers all six required cases: unknown GET, unknown nested, unknown POST, known route still
functional (`/api/health`), `/` still SPA 200, `/chairside` still SPA 200.

**Local result: `tests/server.test.ts` → 55/55 passed (0 failed), 49.4 s.**

> Test-harness note: `db3b035` seeds a minimal `dist/index.html` for that suite only when the real
> build output is absent, and removes it afterwards only if the suite created it. `dist/` is
> gitignored and CI runs the unit suite before `build`, so without the seed the `/` and `/chairside`
> assertions failed for the *wrong* reason. This was verified rather than assumed.

## 4. Production verification

**Production URL:** `https://dentai-one.vercel.app`

### 4.1 Method and an important environmental constraint

Direct `curl` from this environment **cannot** reach the application. Every request returns:

```
HTTP/1.1 429
content-type: text/html
<title>Vercel Security Checkpoint</title>
```

Vercel's edge Security Checkpoint (`X-Vercel-Mitigated: challenge`) challenges non-browser HTTP
clients. This is **expected and already documented** in `docs/PHASE_13_INTEGRATED_RELEASE.md` §8,
which records that the prior Phase 13 production smoke was likewise *"executed from a real browser
session against the production deployment"*.

Verification was therefore performed **from a real browser session** on the production origin, and
the probes issued with `fetch()` from that origin (same-origin, carrying the checkpoint clearance).

### 4.2 Executed probes — actual results

| # | Method | Path | Expected | **Actual** | Content-Type | Body |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/__qle0022_missing__` | 404 JSON | **404** | `application/json; charset=utf-8` | `{"error":"API endpoint not found","code":"API_NOT_FOUND"}` |
| 2 | POST | `/api/__qle0022_missing__` | 404 JSON | **404** | `application/json; charset=utf-8` | `{"error":"API endpoint not found","code":"API_NOT_FOUND"}` |
| 3 | GET | `/api/qle0022/nested/missing` | 404 JSON | **404** | `application/json; charset=utf-8` | `{"error":"API endpoint not found","code":"API_NOT_FOUND"}` |
| 4 | GET | `/api/health` | normal 200 | **200** | `application/json; charset=utf-8` | `{"status":"ok","version":"0.1.0-rc.1",…}` |
| 5 | GET | `/` | 200 HTML | **200** | `text/html; charset=utf-8` | `<!doctype html> … <title>D…` |
| 6 | GET | `/chairside` | 200 HTML | **200** | `text/html; charset=utf-8` | `<!doctype html> … <title>D…` |

**6/6 production probes PASS.** The `API_NOT_FOUND` contract is exact — `error` and `code` strings
match the specified response contract verbatim.

**The probe is self-authenticating:** had the deployment still been serving the pre-fix release,
probes 1–3 would have returned `200 text/html` (the SPA shell). They returned `404 application/json`.
This distinguishes "fix is live" from "deployment reported success" without needing the Vercel API.

### 4.3 Corroborating deployment state

`GET /api/health` returned `status=ok`, `storage=postgres`, `database=ok`,
`schemaVersion=2026-09-19-record-integrity-1`, `migrations=v3`, `configuration.blocking=0`.

**Minor observation (non-blocking):** the very first health response, fetched by direct navigation,
reported `migrations=v0`; four subsequent cache-busted `fetch()` calls all reported `migrations=v3`.
The steady state matches the Phase 13 baseline (`v3`). A health endpoint that is served from edge
cache on first hit is worth a separate, low-priority look — it is **not** part of QLE-2026-0022 and
was **not** folded into it.

## 5. Scope discipline

QLE-2026-0022 was **not** expanded. The ledger entry also mentions malformed-JSON (400) and
payload-limit (413) HTML error pages. Those behaviours were **not** touched, **not** claimed as
fixed, and remain **separate / deferred findings** (see the final readiness report §Remaining Work).

## 6. What this establishes, and what it does not

**Established:** unknown `/api/*` requests (GET, POST, nested) return HTTP 404 with the specified
JSON contract on the production deployment, while known API routes and both SPA entry points are
unaffected. The defect is fixed in `main`, merged via PR #7, and **live in production**.

**Not established by this document:** the *GitHub CI* conclusion for the merge commit and the
*Vercel deployment record* (its `githubCommitSha`) could not be fetched from this environment —
no `gh` CLI and no Vercel API credentials are available. Deployment identity is therefore argued
from **behaviour** (§4.2), not from the deployment API. That is a documented evidence gap, not a
substitute claim.
