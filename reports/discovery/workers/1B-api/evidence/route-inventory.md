# Worker 1B — API Route Inventory (evidence)

Enumerated at SHA `2cf786aac840eee69d520ebaae0a35d91c23ffe3` via grep of route
registrations (`app.(get|post|put|patch|delete)(...)`) in `server.ts` plus per-module scans.

## server.ts — 30 direct routes

- get: /api/usage/today, /api/pipeline/roi, /api/pipeline, /api/notes/jobs/:id, /api/demo/video, /api/consultations, /api/clinics/mine, /api/clinics/:id/members, /api/clinics/:id/consultations, /api/auth/profiles, /api/auth/me
- post: /api/webhooks/pms-booking, /api/support/github-issue, /api/schedule/parse-image, /api/notes/jobs/tick, /api/notes/jobs, /api/generate-notes, /api/consultations/:id/sign, /api/consultations, /api/clinics/join, /api/clinics/:id/rotate-code, /api/clinics/:id/rename, /api/clinics/:id/members/:dentistId/decline, /api/clinics/:id/members/:dentistId/approve, /api/auth/register, /api/auth/logout, /api/auth/login
- put: /api/consultations/:id
- patch: /api/pipeline/:id
- delete: /api/auth/profiles/:id
- get *: SPA fallback

## Module-registered routes

| Module | Routes |
|---|---|
| patientRoutes.ts | GET /api/patients · POST /api/patients/resolve · POST /api/patients · GET /api/patients/:id/history (all `deps.authenticate`) |
| transcriptionRoutes.ts | POST /api/transcribe/audio · POST /api/transcribe (both `deps.authenticate`) |
| beaconRoutes.ts | POST /api/beacon/chair/create · POST /api/beacon/chair/pair · GET /api/beacon/chair/:chairId/status · POST /api/beacon/chair/:chairId/command · POST /api/beacon/chair/:chairId/telemetry · POST /api/beacon/chair/:chairId/upload-chunk |
| opsRoutes.ts | GET /api/health · GET /api/ops/telemetry (requireOps) · POST /api/ops/drain (requireOps) · GET+POST /api/cron/drain (requireCron) · GET /api/telemetry (retired→401) |
| sessionSecurity.ts | POST /api/auth/change-pin · POST /api/auth/sessions/revoke-all (authenticate) · POST /api/auth/recovery/redeem (unauth by design) |
| mfa.ts | GET /api/auth/mfa · POST /api/auth/mfa/{enroll,confirm,recovery-codes,disable,verify} (authenticate) |
| billing.ts | GET /api/billing/status · POST /api/billing/checkout · POST /api/billing/portal (authenticate) · POST /api/billing/webhook (signature-verified) |
| clinicExport.ts | GET /api/clinic/export · GET /api/clinic/export/consultation/:id (authenticate) |
| opsActions.ts | GET /api/ops/{config,clinics,funnel,audit,audit/verify} (requireOps) · POST /api/ops/console/session · POST /api/ops/console/logout · GET /api/ops/console · POST /api/ops/{retention/run,billing/activate,support/recovery,support/lock} (requireOps) |
| practiceAgreement.ts | GET /api/practice/agreement · POST /api/practice/agreement/accept (authenticate) |

## Middleware mounts (server.ts)

- `:397` /api/generate-notes generationLimiter + syncGenerationMetering
- `:406` /api/notes/jobs jobSubmitMetering
- `:477` /api recordGovernance (governance gate — must match on path, never originalUrl)
- `:606` /api/auth/register signupGuard
- `:682` /api/ apiLimiter
- `:703-705` transcript validation on notes-jobs / generate-notes / consultations
- `:1127` /api/auth/login loginMfaGuard

## Live probe results (evidence files in this directory)

- GET /api/health unauth → 200 `{"status":"ok",...}` (health.json)
- GET /api/patients unauth → 401; with session token → 200 `[]` (auth-_api_patients.body)
- GET /api/consultations unauth → 401; with token → 200 `[]`
- GET /api/ops/telemetry without/wrong secret → 401
- GET /api/telemetry (retired) → 401
- GET /api/records, /api/billing (NOT real routes) → 200 + SPA HTML — unknown `/api/*` paths fall through to the SPA fallback instead of 404 (hygiene finding, not an auth gap; evidence in urgent-unauth-200/)
- Synthetic registration: requires name + specialty + 4-digit non-weak PIN (register.json, 201 + epoch token)
