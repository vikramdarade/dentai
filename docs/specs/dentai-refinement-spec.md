# Spec: DentAI Australian Pilot Copilot

## Objective
Build a production-grade, single-server integration for DentAI tailored for an Australian dental clinic pilot. The system uses the server-side Gemini API (via `@google/genai` SDK) to parse patient intake data and session transcripts, producing clinical SOAP findings compliant with the Dental Board of Australia record-keeping guidelines and a warm, en-AU patient care plan.

The system must be highly resilient to transcription variations caused by diverse accents (e.g., Australian, British, Asian, Middle Eastern), speech speeds, and dictions, using semantic correction to resolve phonetic errors.

## Tech Stack
* **Frontend**: React (v19), TypeScript, Vite (v6), Tailwind CSS (v4), Motion/React (v12)
* **Backend**: Express (v4), TypeScript, `@google/genai` (v2.4.0), `helmet` (v7), `express-rate-limit` (v7), `dotenv` (v17), `tsx` (for dev running)
* **Testing**: Vitest (v2.0.0), Supertest (v7.0.0), `@types/supertest` (v6.0.2)
* **API Key**: Securely managed via `.env.local`

## Commands
* **Unified Dev Server**: `npm run dev` (Runs Express serving Vite middleware on port 3000)
* **Build App**: `npm run build` (Builds Vite assets and compiles `server.ts` to `server.js`)
* **Production Run**: `node server.js` (Express serving built static files)
* **Lint/Type-Check**: `npm run lint` (Checks typescript validity)
* **Automated Tests (Mocked API)**: `npm test` (Runs Vitest unit tests for server routing, rate limiting, and inputs)
* **LLM Integration Tests (Live API)**: `npm run test:integration` (Hits live Gemini API to verify accent/FDI translation accuracy)

## Project Structure
```text
dentai/
├── src/                      → Client application
│   ├── components/           → UI Components (Refactored findings fields)
│   │   ├── ClinicalSummary.tsx
│   │   ├── LiveRecording.tsx
│   │   ├── PatientIntake.tsx
│   │   └── HistoryHub.tsx
│   ├── App.tsx
│   ├── types.ts              → Updated schemas (toothFindings instead of findingsTooth14)
│   └── main.tsx
├── tests/                    → Automated Test Suites [NEW]
│   └── server.test.ts        → Backend API and Accent resilience tests
├── server.ts                 → Single Server Entrypoint (Vite dev middleware + API routes)
├── vite.config.ts            → Shared vite configurations (Vite Dev Server integration)
├── docs/specs/
│   └── dentai-refinement-spec.md  → This specification
├── package.json
└── tsconfig.json
```

## Schema Refactoring Plan
We will refactor the `ClinicalFindings` type to replace the US-centric, single-tooth `findingsTooth14` with a general, multi-tooth `toothFindings` field that maps well to FDI notations.

```typescript
export interface ClinicalFindings {
  chiefComplaint: string;
  history: string;
  toothFindings: string; // Refactored from findingsTooth14 to capture any teeth findings in FDI notation
  findingsGingival: string;
  diagnosis: string;
  treatmentPerformed: string;
  recommendations: string;
  recallRequirements: string;
}
```

## Robust Accent & Phonetic Correction (Gemini Instructions)
The system instruction for Gemini will explicitly enforce:
1. **Phonetic Correction**: Treat the transcript as potentially containing accent-based phonetic errors, homophones, or garbled words due to rapid speech or low clarity. Semantic context should map words like:
   - "tooth category" or "feeling" → "filling" or "carious lesion"
   - "tooth tree" or "tooth dirty" → "tooth 33" or "tooth 13" (depending on quadrant context)
   - "pocket depths three two tree" → "3-2-3 mm pocket depths"
2. **FDI Dental Notation**: Understand and output teeth designations using the FDI two-digit numbering system (11-18, 21-28, 31-38, 41-48).
3. **en-AU Spelling**: Output patient-facing documents using Australian/British English spelling conventions (e.g. "anaesthetic", "haemorrhage", "programme", "colour").
4. **Clinical Terminology**: Align notes with Australian clinical terms (e.g., "scale and clean", "composite restoration", "fissure sealant").
5. **Dental Board Guidelines**: Ensure the structured note sections correspond strictly to the Dental Board of Australia record-keeping rules.

## Robust Testing Strategy

We will establish a layered testing matrix to guarantee robustness across code integration, LLM output quality, and rate limiting:

### 1. Automated Mocked API Testing (`npm test`)
Using Vitest and Supertest, we test the Express server in isolation:
* **Rate Limiting Verification**: Verify that sending more than the specified requests to `/api/generate-notes` returns an HTTP `429 Too Many Requests`.
* **Input Validation**: Assert that the backend returns `400 Bad Request` if `intakeData` or `transcript` is missing or structurally invalid.
* **Error Propagation**: Mock a Gemini API timeout or key failure and assert that the server propagates an appropriate HTTP `503 Service Unavailable` or `500 Internal Server Error` with a user-friendly payload, rather than crashing.

### 2. Automated LLM Integration Testing (`npm run test:integration`)
To test accent/diction resilience and compliance with FDI/en-AU, we run automated assertions against the *live* Gemini API with three specific test cases:

* **Test Case A (Indian Accent & Sibilants / Homophone Test)**:
  * **Input Transcript**: `"patient has decay on tooth dirty tree and needs a composite feeling... pocket depths are tree two tree"`
  * **Assert findings**:
    * `toothFindings` contains `"33"` (FDI for lower left canine, corresponding to "dirty tree") and `"restoration"` or `"composite"`.
    * `findingsGingival` contains `"3-2-3"`.
* **Test Case B (Broad Australian Accent & Fast Colloquialisms)**:
  * **Input Transcript**: `"no decay on tooth two four, scale and clean mate, check forty two for mobility"`
  * **Assert findings**:
    * `toothFindings` contains references to FDI Tooth 24 and FDI Tooth 42.
    * `treatmentPerformed` contains `"scale and clean"`.
    * `patientSummary` uses Australian English spelling (e.g., spelling `"colour"`, `"minimise"`, `"programme"`).
* **Test Case C (Mumbled Speech & Phonetic Diction Test)**:
  * **Input Transcript**: `"probably need a root can all on tooth one six due to pulp it is"`
  * **Assert findings**:
    * `toothFindings` contains FDI Tooth 16.
    * `diagnosis` contains `"pulpitis"` (correcting "pulp it is").
    * `treatmentPerformed` contains `"root canal"` (correcting "root can all").

### 3. Frontend Error Handling Verification
* Ensure the UI displays a premium error panel if the server returns 429 (Rate Limited) or 500 (API Error).
* Ensure that the loading state is fully responsive and disables the "Finish Note" button during pending requests.

## Boundaries
* **Always**: 
  * Validate that the incoming transcript has content before querying the API.
  * Sanitize inputs to prevent prompt injection.
* **Ask First**: Adding external database packages.
* **Never**:
  * Log PHI in cleartext to stdout.
  * Leak API keys to client bundles.

## Success Criteria
1. **Single Entrypoint**: Running `npm run dev` starts the Express server which proxies Vite correctly.
2. **Refactored Codebase**: `findingsTooth14` is replaced by `toothFindings` throughout client components and types.
3. **FDI/en-AU Enforced**: All Gemini structured responses utilize FDI dental notation and Australian English spelling.
4. **Resiliency to Accents**: The integration tests pass, confirming phonetic corrections of common dental terms and FDI notation translate correctly.
5. **No Key Leakage**: Verified that Gemini keys are never sent to the client.
