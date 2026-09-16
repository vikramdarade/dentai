<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# DentAI - Context-Aware Clinical & Patient Care Copilot

DentAI is a production-grade, secure clinical charting assistant that maps dentist-patient conversations into compliance-aligned structured clinical notes and patient correspondence.

View your app in AI Studio: https://ai.studio/apps/baa326da-f1fe-4df5-9760-464dd68a835d

---

## Technical Features
- **Template-driven note generation**: a built-in library of 8 core treatment types (examination, scale & clean, emergency, restorative, endodontic, surgical, prosthodontic, paediatric). Each type has a preconfigured note template whose sections drive exactly which clinical fields the AI extracts — not just how the note is displayed. Templates are shared between client and server (`src/lib/dentalLibrary.ts`).
- **Resilient scribing (no dead-ends on quota)**: generation falls back in tiers — (1) primary Gemini/Vertex, (2) a secondary Gemini key on a separate quota pool (`GEMINI_FALLBACK_API_KEY`), (3) an offline rule-based draft engine that fills the active template from the transcript without inventing content, and (4) an optional on-device WebLLM model (beta) for WebGPU browsers. Fallback output is always flagged for clinician review (`noteOrigin.needsReview`) and never fabricates diagnoses, treatments, recall intervals or ADA billing codes.
- **API Hardening**: Payload size limits (1MB) and server-side schema validations shield against DoS attacks.
- **Prompt Injection Defense**: Untrusted transcription inputs are strictly sanitized and isolated.
- **Dialect Resilience**: Indian and Broad Australian (en-AU) phonetic accents are automatically resolved to correct clinical FDI notations.
- **Telemetry**: Running latency stats (P50/P95) and error counters are measured in real time.

---

## Getting Started

### Prerequisites
- Node.js (v22 recommended)
- Git (configured for local hooks)

### Run Locally (Development)
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment variables in `.env.local` (never commit them). The
   minimum for local development is `GEMINI_API_KEY` and `SESSION_SECRET`:
   ```env
   GEMINI_API_KEY="your-gemini-api-key"
   SESSION_SECRET="a-long-random-secret-used-to-sign-session-tokens"
   DATABASE_URL="postgresql://..."   # required in production
   ```
   `SESSION_SECRET` is required in production (`NODE_ENV=production`).
   **Every variable, what it does, and the safe production value is documented in
   `docs/operations/environment-reference.md`** — including `DENTAI_OPS_SECRET`,
   `CRON_SECRET`, the per-clinic daily ceilings and the residency settings.

   When `DATABASE_URL` is set, dentists, consultations, the audit log and the note
   queue are stored in Postgres (Neon-compatible). **Production requires Postgres**:
   without it the server falls back to JSON files, which on serverless means
   records written to a disk that disappears between requests. That fallback now
   fails closed unless `DENTAI_ALLOW_FILE_STORAGE=true` is set deliberately.
3. Run the development server:
   ```bash
   npm run dev
   ```

### Note templates

Each treatment type auto-selects a built-in note template at intake (AHPRA Standard, SOAP, Hygiene, Emergency, Restorative, Endo, Surgical, Crown & Bridge, Paediatric). The selected template is sent with the request, and the server builds a per-template JSON schema + system instruction so the AI populates exactly that template's sections. Custom clinic templates can still be sent inline (validated server-side).

### Offline draft tier

If every hosted AI route fails, the recording screen offers **Draft offline now**: a deterministic engine (`src/lib/draftEngine.ts`) that fills the template sections using only what was said (keyword matching + FDI tooth normalisation). It never invents diagnoses, treatments, recall intervals, patient letters, or ADA codes — sections without supporting transcript content stay empty for the dentist to complete, and the note is flagged for review before it can be saved. A beta **On-device model** option additionally runs a small WebLLM model locally on WebGPU browsers.

### Run Locally (Production Mode)
To simulate the production runtime:
1. Compile client assets and backend bundle:
   ```bash
   npm run build
   ```
2. Launch server in production:
   ```bash
   NODE_ENV=production PORT=3000 node server.js
   ```
   (Windows users: install `cross-env` as a dev dependency and prefix the command with `cross-env`.)

---

## Deploy to Vercel

DentAI is configured for Vercel out of the box with serverless function mapping (`vercel.json` & `api/index.ts`).

1. Install the Vercel CLI:
   ```bash
   npm install -g vercel
   ```
2. Log in and deploy:
   ```bash
   vercel login
   ```
3. Deploy preview or production:
   ```bash
   vercel          # Deploy Preview
   vercel --prod   # Deploy Production
   ```
4. Set the environment variable `GEMINI_API_KEY` in your Vercel Dashboard under project settings.

---

## Monitoring and operations

Three endpoints, deliberately separated by who may call them:

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/health` | none | Liveness/readiness. `200` when serving and the database answers; `503` when degraded. Safe to feed an uptime monitor. |
| `GET /api/ops/telemetry` | `DENTAI_OPS_SECRET` | Per-instance request/error/latency counters plus `openNoteJobs` queue depth. |
| `POST /api/ops/drain` · `GET|POST /api/cron/drain` | ops secret · `CRON_SECRET` | Advance the note queue. The cron route is what makes completion durable when no browser is open. |

```bash
curl -s https://<app>/api/health | jq
curl -s -H "x-dentai-ops-secret: $DENTAI_OPS_SECRET" https://<app>/api/ops/telemetry | jq
```

`GET /api/telemetry` is retired and returns `401` — it used to publish process
metrics to anyone who asked, and on serverless those counters were per-instance
anyway. Set `ERROR_WEBHOOK_URL` to have errors pushed to Slack/Teams/Discord;
logging never includes clinical content.

Operator procedures: `docs/runbooks/operator-runbook.md`,
`docs/runbooks/queue-scheduling.md`, `docs/runbooks/backup-and-restore.md`.

---

## Compliance and clinical safety

The product is built for Australian practices, so the paper trail is part of the
repository:

- In-app **privacy notice** and **terms** (`#/privacy`, `#/terms`), reachable from
the landing page and the sign-in screen, with the AI-assist disclosure shown at intake.
- Patient consent (timestamp + disclosure version) stored on the consultation.
- Append-only note revisions and an audited access log per clinic.
- Model provenance on every note: which engine drafted it, and whether it needs
  clinician review.
- `docs/legal/data-flow-and-subprocessors.md` — exactly where patient data goes.
- `docs/legal/retention-and-deletion.md`, `docs/legal/practice-agreement-checklist.md`.
- `docs/runbooks/notifiable-data-breach.md` — the NDB response procedure.
- `docs/operations/au-go-live-checklist.md` — go/no-go list and known limitations.

DentAI is documentation software: it does not diagnose or prescribe, and the
treating practitioner reviews and owns every record.
