<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# DentAI - Context-Aware Clinical & Patient Care Copilot

DentAI is a production-grade, secure clinical charting assistant that maps dentist-patient conversations into compliance-aligned structured clinical notes and patient correspondence.

View your app in AI Studio: https://ai.studio/apps/baa326da-f1fe-4df5-9760-464dd68a835d

---

## Technical Features
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
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```

### Run Locally (Production Mode)
To simulate the production runtime:
1. Compile client assets and backend bundle:
   ```bash
   npm run build
   ```
2. Launch server in production:
   ```bash
   cross-env NODE_ENV=production PORT=3000 node server.js
   ```

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
