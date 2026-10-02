# Release Policy

**Created:** 2026-09-28 · **Release authority:** RELEASE_ENGINEER role; final go/no-go is human.

## Release gate (all must hold)

1. CI green at the release SHA: `quality-gate`, `postgres`, `clinical-eval` jobs (`.github/workflows/ci.yml`).
2. Full local verification recorded: `bun run lint`, `bun run test`, `bun run build`, eval gates.
3. **No open `clinicalRisk: CRITICAL` or `P0` ledger entries.** `HIGH` entries require explicit human acceptance recorded in the release report.
4. Documented environment gaps assessed: the Postgres-enabled test run must have executed in a database-enabled environment (per `docs/FINAL_CLINICAL_SAFETY_AUDIT.md`) — JSON-fallback-only green is **not** a release state.
5. Clinical eval thresholds met (`eval:notes` ≥ 0.9; benchmark/gold-set deltas explained).
6. Safety audit current: no `SAFETY_INVARIANT_DRIFT` entries in anything but `VERIFIED`/`WONT_FIX`(human-closed) state.
7. Rollback path rehearsed: migrations have a working down path (CI rehearses `migrate down/up`).

## Release record

The RELEASE_ENGINEER appends to `.control/release-state.json` `releases[]`:

```json
{
  "id": "rel-YYYY-MM-DD-n",
  "version": "x.y.z",
  "sha": "<release head sha>",
  "date": "<iso>",
  "ledgerIds": ["QLE-..."],
  "ciRunUrls": [],
  "environmentGapsClosed": [],
  "humanApprover": "<handle>",
  "notes": ""
}
```

## Environments

- **Deploy target:** Vercel (`vercel.json`, `api/index.ts`). Production requires Postgres `DATABASE_URL`; the file-store fallback fails closed by design.
- **Pre-release rehearsal:** `bun run build` + `NODE_ENV=production` local run; go/no-go items in `docs/operations/au-go-live-checklist.md`.
- No agent deploys. `vercel --prod` is a human action.

## Post-release

- Ledger entries referenced in the release move to `RELEASED`; `VERIFIED` requires post-deploy telemetry check (`GET /api/health`, `GET /api/ops/telemetry`) with evidence in `reports/releases/`.
- Any clinical defect discovered post-release: new CRITICAL/HIGH entry, immediate human notification, rollback decision by human.
