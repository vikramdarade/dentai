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
2. Configure `.env.local` or `.env` in the root:
```env
GEMINI_API_KEY="your-gemini-api-key"
# Optional: secondary Gemini project key used automatically when the primary
# key hits its quota/billing limit (its own separate quota pool).
GEMINI_FALLBACK_API_KEY="your-second-gemini-api-key"
# Optional: override the fallback model (defaults to GEMINI_MODEL or gemini-3.6-flash).
GEMINI_FALLBACK_MODEL="gemini-3.6-flash"
SESSION_SECRET="a-long-random-secret-used-to-sign-session-tokens"
```
   `SESSION_SECRET` is required in production (`NODE_ENV=production`) — the server will refuse to start without it.

3. (Optional but recommended) Add a Postgres connection string to make data durable on serverless:
   ```env
   DATABASE_URL="postgresql://..."
   ```
   When `DATABASE_URL` is set, dentists, consultations, and the audit log are stored in
   Postgres (Neon-compatible). Without it, the server falls back to JSON files / Vercel KV.
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

## Monitoring and Telemetry

DentAI tracks requests, errors, and P50/P95 response times. You can fetch metrics via:
`GET /api/telemetry`

Response format:
```json
{
  "totalRequests": 42,
  "totalErrors": 0,
  "p50LatencyMs": 1820,
  "p95LatencyMs": 3100,
  "averageLatencyMs": 1940
}
```
