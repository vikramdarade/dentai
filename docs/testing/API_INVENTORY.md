# DentAI API Inventory

**Status:** initial draft, bootstrapped 2026-09-28. Sources: `README.md` (Monitoring/operations), `PROJECT_CONTEXT.md` server-surface map, `.agents/AGENTS.md`. This is **not exhaustive yet** — `server.ts` (~4.6k lines) + `src/server/*` registers many routes; agents enumerate them during discovery cycles and extend this file.

## Conventions

- Route ids are `METHOD /path` exactly as matched by Express (path only, never `req.originalUrl`).
- `auth` values: `none` | `session` | `ops-secret` | `cron-secret` | `session+governance`.
- Any route touching a protected surface is marked **Protected** and requires CLINICAL_VERIFIER review when changed.

## Known endpoints (documented)

| id | auth | Purpose | Protected | Notes |
|---|---|---|---|---|
| `GET /api/health` | none | Liveness/readiness; `503` when degraded | no | Safe for uptime monitors |
| `GET /api/ops/telemetry` | ops-secret (`DENTAI_OPS_SECRET`) | Per-instance counters, `openNoteJobs` depth | no (not clinical) | PHI-free logging mandated |
| `POST /api/ops/drain` | ops-secret | Advance the note queue | no (not clinical) | |
| `GET /api/cron/drain` · `POST /api/cron/drain` | cron-secret (`CRON_SECRET`) | Durable queue draining without a browser | no (not clinical) | Scheduler target |
| `GET /api/telemetry` | — | **Retired**, returns `401` | — | Do not reintroduce |
| `POST /api/consultations/:id/sign` | session+governance | Server-side sign-off gate: ownership, version, content hash, fail-closed grounding re-eval, server-minted seal + audit event | **YES** | F-4 closed server-side; see `tests/signOffValidation.test.ts` |
| `POST /api/beacon/chair/:chairId/upload-chunk` | session | Chairside phone beacon audio slice upload | evidence | Caps enforced; refused long recordings, never truncated |
| `POST /api/transcribe/audio` | session | Cockpit microphone slice upload keyed by consultation | evidence | Server-side diarized transcription |
| `POST /api/transcribe` | session | Web Speech fallback transcript path | evidence | Labelled unattributed when non-diarized |
| `PATCH /api/pipeline/:id` | session | Treatment opportunity updates | no (not clinical) | O(1) via composite ID prefix |
| `GET|POST /api/patients/*` | session | Patient registry, consultation→patient linking | **YES** (patient identity) | `decidePatientResolution` semantics |

## Additional surfaces (registered from `src/server/`, to be enumerated by discovery cycles)

`opsRoutes.ts`, `sessionSecurity.ts` (change-pin, revoke-all, recovery redemption), `recordGovernance.ts` (consent gate, append-only revisions, read audit), `mfa.ts`, `billing.ts`, `practiceAgreement.ts`, `clinicExport.ts`, `opsActions.ts`, `alerting.ts`, `email.ts`, `retention.ts`, `patientRoutes.ts`, `transcriptionRoutes.ts`.

## Inventory rules

1. Discovery agents add rows with evidence (route registration file + line); no invented endpoints.
2. Every endpoint must state its auth requirement; a discovered mismatch is a `SECURITY` ledger entry with `clinicalRisk` assessed.
3. Governance middleware must match on the **path, never `req.originalUrl`** (query-string bypass class — see `.agents/AGENTS.md` rule 11).
