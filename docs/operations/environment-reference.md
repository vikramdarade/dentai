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
| `DENTAI_REQUIRE_CONSENT` | Blocks saving a consultation with no recorded AI-assist consent | **Default is off** (`server.ts` compares the value to `'true'`). Set `true`; it is the evidence trail a privacy review asks for. While it is unset, a transcript saved without consent is still written — the app only records a `consultation_without_consent_captured` audit event. Do not describe consent as mandatory until this is `true` |
| `DENTAI_ALLOW_SELF_SIGNUP` | `false` closes self-serve registration (the register endpoint returns `403 SIGNUP_CLOSED`) | Leave open for launch; close it if accounts are created abusively. Account creation is separately limited to 5/hour per address, because each new account carries its own daily AI allowance |
| `ERROR_WEBHOOK_URL` | Slack/Teams/Discord incoming webhook for error alerts | Your only push notification that something broke |
| `GCP_REGION` | Region for hosted AI | Defaults to `australia-southeast1`; change only if the practice agrees. **This only takes effect when `GCP_PROJECT_ID` is set** — without it, generation uses the global Gemini endpoint and the region is ignored |
| `DENTAI_DAILY_NOTE_LIMIT` | Max AI notes per clinic per day | Start ~60; raise with the plan |
| `DENTAI_DAILY_TOKEN_LIMIT` | Max tokens per clinic per day — the real cost ceiling | Start ~400k; one long transcript can cost more than a day of short consults |
| `DENTAI_ALLOW_FILE_STORAGE` | Escape hatch that permits JSON-file storage | Leave unset/`false` in production so a missing `DATABASE_URL` fails loudly instead of silently dropping records |

## Optional

| Variable | Purpose |
|---|---|
| `GEMINI_FALLBACK_API_KEY` | Second key on a separate quota pool, used when the primary is rate-limited |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL` | Model overrides |
| `DENTAI_THINKING_LEVEL` | `minimal` (default), `low`, `medium` or `high` — reasoning effort for note generation | Leave at `minimal`. The Gemini 3 Flash family runs thinking on by default ("On (medium)" for `gemini-3.6-flash`), and that was the dominant cause of slow note generation in the pilot. Raising it adds seconds per note with no accuracy benefit, because the clinical rules are supplied explicitly in the prompt and the accuracy gate is `bun run eval:notes`. An invalid value safely falls back to `minimal` rather than taking generation down |
| `GCP_PROJECT_ID`, `GCP_SERVICE_ACCOUNT_KEY` | Vertex AI path, tried before the API-key path when both are set | **Set `GCP_PROJECT_ID` if you promise a practice Australian processing.** Without it the app drafts every note through the global Gemini endpoint. `configCheck.ts` reports the key as `required` but only `fatal` findings stop a boot, so a production deploy missing it starts and runs offshore — confirm it is set before making a residency claim |
| `DENTAI_RETENTION_ENABLED`, `DENTAI_RETENTION_DRY_RUN`, `DENTAI_RETENTION_ACTION`, `DENTAI_RETENTION_BATCH` | The retention sweep that deletes or de-identifies records past their horizon | **Off by default, and dry-run even when on.** `DENTAI_RETENTION_ACTION` is `delete` (default) or `deidentify`; `DENTAI_RETENTION_BATCH` caps each sweep at 200. Run one dry sweep and read the report before enabling, and record the enablement date in `docs/legal/retention-and-deletion.md` |
| `DENTAI_TRANSCRIPTION_MODEL` | Model used to transcribe recorded audio. Falls back to `GEMINI_MODEL` | Optional. Worth setting higher than the note model if accuracy matters more than latency here: transcription runs once per appointment after recording stops, while note generation is on the clinician's critical path. Recorded audio is what the note is actually built from, so this is the model that decides whether the note can be right |
| `DENTAI_QUEUE_INTERVAL_MS` | In-process drain timer for long-running hosts (`node server.js`). Minimum 10000; unnecessary on serverless |
| `DENTAI_DATA_DIR` | Location of the JSON fallback store (development only) |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Legacy Vercel KV fallback store |
| `PORT`, `NODE_ENV` | Injected by the platform |

## Payments and email (only when you turn them on)

| Variable | Purpose | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | Charges cards and opens the billing portal | Until it is set, checkout reports that billing is not configured rather than pretending to succeed |
| `STRIPE_WEBHOOK_SECRET` | Verifies Stripe webhook signatures | **Fails closed**: without it `/api/billing/webhook` returns `503` and will not activate anything. This is the control that stops a hand-crafted POST conferring a free paid tier |
| `DENTAI_PMS_WEBHOOK_SECRET` | Verifies inbound PMS booking webhook signatures (`POST /api/webhooks/pms-booking`) | **Fails closed**: without it the webhook endpoint returns `503 WEBHOOK_NOT_CONFIGURED`. Prevents unauthenticated mutation of clinical treatment records. |
| `RESEND_API_KEY` | Sends invitations, recovery codes and receipts | Without it, `send()` reports "not configured" — the invite is still recorded, nothing is silently discarded |
| `DENTAI_EMAIL_FROM` | The From address those emails use | Must be a verified sender domain, e.g. `DentAI <hello@yourdomain.com.au>` |

### Inbound PMS Webhook Signing Format (`POST /api/webhooks/pms-booking`)

Inbound webhooks must supply an `x-dentai-signature` header:
- Header: `x-dentai-signature: t=<unix_timestamp_seconds>,v1=<hex_hmac_sha256>`
- Signed message: `<unix_timestamp_seconds>.<raw_body_string>`
- Example curl:
```bash
TIMESTAMP=$(date +%s)
BODY='{"opportunityId":"consult-123-tx-crown-16","clinicId":"clinic-456","pmsAppointmentId":"D4W-8899","pmsType":"d4w"}'
SIG=$(echo -n "${TIMESTAMP}.${BODY}" | openssl dgst -sha256 -hmac "$DENTAI_PMS_WEBHOOK_SECRET" | sed 's/^.* //')

curl -X POST https://<app>/api/webhooks/pms-booking \
  -H "Content-Type: application/json" \
  -H "x-dentai-signature: t=${TIMESTAMP},v1=${SIG}" \
  -d "$BODY"
```

Emails are sent at the moment the action happens, so a missing key produces a clear operator error. Neither integration charges you anything until it is switched on — activation is a deliberate act, and `/api/ops/billing/activate` exists for the first cohort who pay by invoice.

## Operator and maintenance commands

These are not server variables; they are set on the command line when you run an operator task.

| Variable | Command | Purpose |
|---|---|---|
| `DENTAI_MIGRATE_DATABASE_URL` | `bun run db:migrate` | Migrate a *different* database than the app uses — the safe way to rehearse a migration against a scratch branch |
| `DENTAI_CONFIRM_DESTRUCTIVE` | `bun run db:migrate:down` | Required to roll a migration back, because it drops tables and columns |
| `DENTAI_MIGRATION_FORCE` | `bun run db:migrate` | Overrides the refusal to run when a shipped migration's checksum changed. Use only on a database you know was never migrated |

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
