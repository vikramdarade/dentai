# Project Context: DentAI

## Overview
DentAI is an ambient AI clinical copilot for dental practices. It operates live chairside, capturing conversational dialogue between clinicians, assistants, and patients, transcribing in real-time, filtering room noise, and automatically drafting structured, ADA/CDT-coded SOAP clinical notes ready for PMS export (Dentrix, Eaglesoft, Open Dental, Exact, Cliniko).

---

## Tech Stack
- **Frontend**: React 18, TypeScript, Tailwind CSS, Lucide Icons, Web Audio API, Web Speech API.
- **Backend**: Node.js, Express, Helmet, Rate Limiting, Server-Sent Events / Polling.
- **AI Engine**: Google Gemini 2.5 Flash (via `@google/genai`), supporting up to 1,000,000 tokens per request.
- **Persistence**: Serverless-resilient dual-mode (PostgreSQL or local JSON files with in-memory read/write cache wrappers).
- **Tooling**: Vite, esbuild, Vitest, Husky pre-commit quality gates.

---

## Core Commands
- **Start Dev Server**: `npm run dev` (starts frontend on `:3000` / `:5173` and backend API).
- **Run Typecheck**: `npx tsc --noEmit`
- **Run Tests**: `npx vitest run --fileParallelism=false` *(always enforce `--fileParallelism=false` to prevent JSON file write collisions)*.
- **Run Specific Test**: `npx vitest run tests/runawayAudio.test.ts --fileParallelism=false`
- **Build Production**: `npm run build`

---

## Codebase Map

```
dentai/
├── server.ts                       # Authoritative Express API server, job queue, authentication
├── src/
│   ├── components/
│   │   ├── ChairsideWorkspace.tsx   # Live chairside cockpit (recording, conversation feed, SOAP note editor)
│   │   ├── DayScheduleQueue.tsx     # Daily appointment schedule list & walk-in queue
│   │   ├── HistoryHub.tsx           # Past consultations and chart history
│   │   ├── PhoneBeaconMode.tsx      # Mobile companion audio stream relay
│   │   └── TreatmentPipeline.tsx    # Treatment planning & revenue tracker
│   ├── lib/
│   │   ├── dentalLibrary.ts        # Clinical templates, ADA procedure codes, tooth FDI mappings
│   │   ├── draftEngine.ts          # Deterministic offline draft generator fallback
│   │   ├── dentalPhoneticLexicon.ts# Speech-to-text dental correction dictionary
│   │   └── noteJobs.ts             # Asynchronous priority job dispatching & backoff logic
│   ├── server/
│   │   └── payloadValidation.ts    # 5,000-utterance validation & clinicalHorizonFilter
│   └── utils/
│       ├── date.ts                 # Clinic timezone utilities (formatClinicDate, formatClinicTime)
│       └── storage.ts              # LocalStorage & token persistence
├── data/                           # Active clinic data files (consultations.json, users.json, clinics.json)
└── tests/                          # 21 test suites ensuring regression-free operation
```

---

## Key Architecture Principles & Guardrails

1. **Extended Transcript Capacity (5,000 Entries)**:
   - Server transcript capacity is 5,000 utterances (supports up to 10 hours of continuous audio / <75,000 tokens).
   - Never artificially cap at small numbers (<200) that reject long appointments.

2. **Semantic Clinical Horizon Filtering**:
   - Transcripts funneled to AI generation or offline draft engines are filtered with `clinicalHorizonFilter`.
   - Prunes trailing post-op room turnover chatter (cleaning, banter) while guaranteeing zero loss of clinical findings or post-op instructions.

3. **Silence Sleep & Pre-Pause Audio Cues**:
   - Adaptive 3-minute silence sleep triggers auto-pause when no speech is detected.
   - A 30-second pre-pause countdown appears at 2m 30s with a double-pip warning chime (784Hz G5) and `[Keep Listening]` / `Spacebar` reset trigger.

4. **Receptionist-Friendly UI Language (Zero Jargon)**:
   - Copy must be accessible to a 12th-grade receptionist or dental assistant.
   - Use *"Live Conversation"*, *"Lines Recorded"*, *"Listening & Taking Notes"*, *"Verified from Audio"*, *"Noise Filter"*, *"End of Day Notes"*, and *"Hands-Free Keyboard Shortcuts"*.

5. **Test Concurrency Isolation**:
   - Always run Vitest with `--fileParallelism=false` because tests share local database fixture files.
   - Keep backup (`beforeAll`) and restore (`afterAll`) hooks in place for test database fixtures.

6. **Clinic Local Timezone Fidelity**:
   - Never hardcode static placeholder dates or demo seed records.
   - Always derive clinic local time using `src/utils/date.ts`.
