# Environment reference

Every variable the server reads, what it does, and what to set in production.
Values themselves live in the host's environment settings (never in Git, never in
`.env.example` with real credentials).

## Required before the first clinic

| Variable | Purpose | Production value |
|---|---|---|
| `SESSION_SECRET` | Signs session tokens; also derives constant-time secret comparison. Server refuses to run in production without it. | 32+ random bytes, stored in a password manager |
| `DATABASE_URL` | Postgres (Neon-compatible) connection string. **Without it, records are written to files and are lost between serverless invocations.** | Sydney region project |
| `GEMINI_API_KEY` | Primary note-drafting model | A key on a billing-enabled project |
| `DENTAI_OPS_SECRET` | Enables `/api/ops/telemetry` and `/api/ops/drain`. Until set, those routes return `503 OPS_DISABLED`. | Long random value |
| `CRON_SECRET` | Authenticates the scheduler at `/api/cron/drain` | Long random value |

## Strongly recommended

| Variable | Purpose | Notes |
|---|---|---|
| `DENTAI_DISABLE_PROFILE_DIRECTORY` | Hides the public list of clinician profiles | Set `true` in production — the directory lets anyone enumerate accounts to attack |
| `DENTAI_REQUIRE_CONSENT` | Blocks saving a consultation with no recorded AI-assist consent | Set `true`; it is the evidence trail a privacy review asks for |
| `DENTAI_ALLOW_SELF_SIGNUP` | `false` closes self-serve registration (the register endpoint returns `403 SIGNUP_CLOSED`) | Leave open for launch; close it if accounts are created abusively. Account creation is separately limited to 5/hour per address, because each new account carries its own daily AI allowance |
| `ERROR_WEBHOOK_URL` | Slack/Teams/Discord incoming webhook for error alerts | Your only push notification that something broke |
| `GCP_REGION` | Region for hosted AI | Defaults to `australia-southeast1`; change only if the practice agrees |
| `DENTAI_DAILY_NOTE_LIMIT` | Max AI notes per clinic per day | Start ~60; raise with the plan |
| `DENTAI_DAILY_TOKEN_LIMIT` | Max tokens per clinic per day — the real cost ceiling | Start ~400k; one long transcript can cost more than a day of short consults |
| `DENTAI_ALLOW_FILE_STORAGE` | Escape hatch that permits JSON-file storage | Leave unset/`false` in production so a missing `DATABASE_URL` fails loudly instead of silently dropping records |

## Optional

| Variable | Purpose |
|---|---|
| `GEMINI_FALLBACK_API_KEY` | Second key on a separate quota pool, used when the primary is rate-limited |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL` | Model overrides |
| `GCP_PROJECT_ID`, `GCP_SERVICE_ACCOUNT_KEY` | Vertex AI path, tried before the API-key path when both are set |
| `DENTAI_QUEUE_INTERVAL_MS` | In-process drain timer for long-running hosts (`node server.js`). Minimum 10000; unnecessary on serverless |
| `DENTAI_DATA_DIR` | Location of the JSON fallback store (development only) |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Legacy Vercel KV fallback store |
| `PORT`, `NODE_ENV` | Injected by the platform |

## Platform placement (production is separate from sandbox)

- **Vercel**: set Production and Preview scopes. Cron uses `CRON_SECRET`
  automatically once it is set; the schedule is in `vercel.json`.
- **Freebuff-managed hosting**: set production variables through the environment
  panel (`freebuff-deploy env set '{"KEY":"value"}'`). Note the deploy builder is
  Node-only and does not run scheduled jobs — pair it with an external pinger for
  `/api/cron/drain` (see `docs/runbooks/queue-scheduling.md`).
- **Sandbox/development**: local `.env.local`. Sandbox values are only used for
  keys production does not define, so never rely on a sandbox value in prod.

## Verification after any environment change

```bash
curl -s https://<app>/api/health | jq
# expect: {"status":"ok","storage":"postgres","database":"ok","alerting":true,...}
```

- `storage: file-fallback` in production → `DATABASE_URL` is missing. Fix it
  before any clinic uses the app; records are being written to a disk that
  disappears.
- `alerting: false` → `ERROR_WEBHOOK_URL` is not set (or not a URL) and you will
  not be told when things break.
