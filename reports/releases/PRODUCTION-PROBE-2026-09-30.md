# DentAI — Production Probe Evidence (2026-09-30)

**Target:** https://dentai-one.vercel.app (Vercel production, `origin/main` @
`23768f8` — "Merge pull request #7 from vikramdarade/fix/qle-2026-0022")

**Method:** A real Chromium session was pointed at the production origin and the
probes below were issued as same-origin `fetch` calls from
`https://dentai-one.vercel.app`. This is the same method used for the
2026-09-29 verification: a direct `curl` from this machine is answered with the
Vercel edge Security Checkpoint (`HTTP 429`, `X-Vercel-Mitigated: challenge`)
and cannot reach the application, so transport-level probes from a bare HTTP
client are not evidence about the app.

**Nothing was mutated.** Every request below is either read-only (`GET`), an
unauthenticated `POST` to a route that does not exist, or a deliberately
malformed `POST` that cannot pass validation. No credentials were used.

## Probes

| # | Request | Status | content-type | Body (first 120 chars) | Verdict |
|---|---------|--------|--------------|------------------------|---------|
| 1 | `GET /api/definitely-not-a-route-20260930` | 404 | `application/json` | `{"error":"API endpoint not found","code":"API_NOT_FOUND"}` | PASS — QLE-2026-0022 contract |
| 2 | `GET /api/nope-2026` | 404 | `application/json` | `{"error":"API endpoint not found","code":"API_NOT_FOUND"}` | PASS |
| 3 | `POST /api/nope-2026` (`{}`) | 404 | `application/json` | `{"error":"API endpoint not found","code":"API_NOT_FOUND"}` | PASS |
| 4 | `GET /api/consultations/deep/unknown/nested` | 404 | `application/json` | `{"error":"API endpoint not found","code":"API_NOT_FOUND"}` | PASS — nested path |
| 5 | `GET /api/consultations` (no token) | 401 | `application/json` | `{"error":"Access token required."}` | PASS — known route still functional |
| 6 | `GET /` | 200 | `text/html` | `<!doctype html>…` | PASS — SPA fallback intact |
| 7 | `GET /chairside` | 200 | `text/html` | `<!doctype html>…` | PASS — SPA route intact |
| 8 | `POST /api/consultations` with body `{"broken":` | 400 | **`text/html`** | `<!DOCTYPE html>…<pre>Bad Request</pre>` | **FAIL — QLE-2026-0042 is still live in production** |

## Reading

- QLE-2026-0022 (unknown `/api/*` returning SPA HTML) is **fixed and live**:
  probes 1–4. The known-route and SPA-fallback invariants also hold (5–7).
- QLE-2026-0042 (malformed JSON answered with an HTML error page instead of a
  JSON error) is **confirmed live in production** by probe 8: the response is
  Express's default HTML `Bad Request` page, not
  `{"error":…,"code":"INVALID_JSON"}`. The fix for it exists only on the local
  branch `fix/qle-2026-0042-api-error-json` (commit `bf07bb8`) and is not
  deployed.
- Consequences for this run: every other fix produced in this run is also
  uncommitted/unpushed, so **no fix from this run other than QLE-2026-0022 can
  be described as production-verified.**
