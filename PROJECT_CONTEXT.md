# Project Context: DentAI

## Overview
DentAI is an ambient AI clinical copilot for dental practices. It operates live chairside, capturing conversational dialogue between clinicians, assistants, and patients, transcribing in real-time, filtering room noise, and drafting structured, compliance-aligned clinical notes ready for PMS export (Dentrix, Eaglesoft, Open Dental, Exact, Cliniko).

DentAI is documentation software: it does not diagnose or prescribe, and the treating practitioner reviews and owns every record.

---

## Tech Stack
- **Frontend**: React 19 + TypeScript, Vite, Tailwind CSS v4 (`@tailwindcss/vite`), `motion` (Framer Motion), lucide-react. Web Audio API and the Web Speech API for capture.
- **Backend**: Node.js (>= 22), Express 4, Helmet, durable rate limiting. A single Express app — there is no separate backend service.
- **AI Engine**: Google Gemini via `@google/genai`. Default model is `gemini-3.6-flash`, resolved through one module (`src/lib/noteModelConfig.ts`) so the model id and thinking level cannot drift between call sites. Recorded audio is transcribed server-side with diarization (`src/server/transcription.ts`, override the model with `DENTAI_TRANSCRIPTION_MODEL`); the browser Web Speech transcript is only a fallback.
- **Capture**: two paths, both now producing recorded audio — the chair-side phone beacon (slices uploaded to `/api/beacon/chair/:chairId/upload-chunk`) and the cockpit's own microphone (slices uploaded to `/api/transcribe/audio`, keyed by consultation). The recorded audio is the transcript the note is built from.
- **Persistence**: PostgreSQL via `@neondatabase/serverless` (Neon-compatible) when `DATABASE_URL` is set; otherwise a JSON-file store with an in-memory read/write cache. Production requires Postgres — the file fallback fails closed unless `DENTAI_ALLOW_FILE_STORAGE=true`.
- **Hosting**: Vercel serverless (`api/index.ts` re-exports the app from the esbuild bundle), with an external scheduler required for durable queue draining.
- **Tooling**: Bun is the package manager (`bun.lock`). Vitest, Husky pre-commit gate, esbuild for the server bundle.

---

## Core Commands
All commands use **Bun** — this repo has `bun.lock`; do not add an npm/yarn/pnpm lockfile.
- **Dev server**: `bun run dev`
- **Typecheck**: `bun run lint` (`tsc -b --noEmit`)
- **Tests**: `bun run test` — the script already passes `--fileParallelism=false`. Always enforce it: the suites share local JSON fixtures, and parallel files collide.
- **Single test file**: `bunx vitest run tests/server.test.ts --fileParallelism=false --test-timeout=30000`
- **Postgres suite**: `bun run test:postgres` (skips without `DATABASE_URL`)
- **Build**: `bun run build`
- **Clinical eval gate**: `bun run eval:notes` (must stay at the documented score threshold)
- **Migrations**: `bun run db:migrate` / `db:migrate:status` / `db:migrate:down`

---

## Codebase Map

```
dentai/
├── server.ts                     # The Express API AND the note-job worker. ~4.6k lines.
├── api/index.ts                  # Vercel serverless entry — re-exports `app`
├── src/
│   ├── App.tsx                   # Router + app state: hash routes for public screens,
│   │                             #   `view` state machine for the authenticated app
│   ├── components/
│   │   ├── ChairsideWorkspace.tsx # Live chairside cockpit (capture, feed, SOAP editor)
│   │   ├── DayScheduleQueue.tsx  # Daily schedule list, walk-ins, in-place recording
│   │   ├── ClinicalSummary.tsx   # Generated note review + grounding banner
│   │   ├── HistoryHub.tsx        # Past consultations and chart history
│   │   ├── PhoneBeaconMode.tsx   # Mobile companion audio relay
│   │   ├── Landing.tsx · Login.tsx · CredentialScreen.tsx · LegalPage.tsx
│   │   └── TreatmentPipeline.tsx · PatientIntake.tsx · ClinicMembersModal.tsx
│   ├── lib/                      # Domain logic (client + server shared, pure where possible)
│   │   ├── dentalLibrary.ts        # Templates, ADA codes, FDI mappings
│   │   ├── draftEngine.ts          # Deterministic offline draft fallback (no invention)
│   │   ├── transcriptGrounding.ts  # Cross-checks a note against the transcript
│   │   ├── patients.ts             # Patient identity policy (pure): when a name is
│   │   │                           #   NOT enough to decide it is the same person
│   │   ├── transcription.ts        # Audio assembly math, diarized-output parsing,
│   │   │                           #   and which transcript the note is built from
│   │   ├── transcribeClient.ts     # Browser client for /api/transcribe(+ /audio)
│   │   ├── noteModelConfig.ts      # Model id + thinking level (SERVER ONLY)
│   │   ├── noteJobs.ts             # Job priority, backoff, per-clinic metering
│   │   ├── migrations.ts           # Migration runner + checksum ledger
│   │   ├── authPolicy.ts           # PIN format/weakness policy, lockout, session TTL
│   │   ├── db.ts                   # Postgres access (all parameterised)
│   │   ├── compliance.ts · retentionPolicy.ts · auditChain.ts
│   │   └── plans.ts · adaFees.ts · dayScheduleStorage.ts · ...
│   ├── server/                   # Feature surfaces registered onto the app
│   │   ├── opsRoutes.ts            # /api/health, /api/ops/*, /api/cron/drain
│   │   ├── sessionSecurity.ts      # change-pin, revoke-all, recovery redemption
│   │   ├── recordGovernance.ts     # Consent gate, append-only revisions, read audit
│   │   ├── mfa.ts · billing.ts · practiceAgreement.ts · clinicExport.ts
│   │   ├── opsActions.ts · alerting.ts · email.ts · retention.ts
│   │   ├── payloadValidation.ts    # Transcript shape validation + horizon filter
│   │   ├── patientStore.ts         # Durable patient registry (patients table)
│   │   ├── patientRoutes.ts        # /api/patients/*, consultation→patient linking
│   │   ├── chairSessionStore.ts    # Durable beacon sessions + audio chunks
│   │   ├── transcription.ts        # Gemini audio transcription (SERVER ONLY)
│   │   ├── transcriptionRoutes.ts  # /api/transcribe, /api/transcribe/audio
│   │   ├── durableRateLimit.ts · signupGuard.ts · aiMetering.ts
│   │   ├── stores.ts · sessionSecurity.ts · configCheck.ts
│   ├── utils/
│   │   ├── date.ts               # Clinic timezone + date/clock labelling
│   │   └── storage.ts            # localStorage/sessionStorage persistence
│   └── types.ts                  # Shared types
├── scripts/                      # Migration CLI, recovery tokens, backup, demo recorder
├── docs/                         # operations/, runbooks/, legal/, reviews/, ideas/
├── data/                         # JSON fallback store (dev only; NOT for production)
└── tests/                        # 22 suites; vitest with --fileParallelism=false
```

---

## Key Architecture Principles & Guardrails

1. **Sessions are stateless and epoch-versioned.**
   - Never store sessions in an in-memory map. On serverless, requests land on different instances, so in-memory sessions produce random 403s.
   - Session tokens are HMAC-signed and carry the account's `sessionEpoch`. **Every mint site must take the epoch from the dentist record** (`issueSessionToken`). A token minted without it defaults to 0, which authenticateToken rejects the moment the account's epoch has been advanced — so sign-in appears to succeed and then every request 403s.
   - Advancing the epoch (`bumpDentistEpoch`) is what "change PIN", "sign out every device" and operator lockout mean. Never mint a session token by hand.

2. **Request paths must be matched on the path, never `req.originalUrl`.**
   - `originalUrl` includes the query string. A pattern anchored with `$` silently stops matching when a caller appends `?x=1`, which turns a governance middleware into a no-op while Express still serves the route. Strip the query before deciding anything.

3. **Extended Transcript Capacity (5,000 entries).**
   - Server capacity is 5,000 utterances (supports very long appointments / <75,000 tokens). Never cap at small numbers (<200) that reject long consultations.

4. **Horizon filtering is a heuristic, not a guarantee.**
   - `clinicalHorizonFilter` drops a long trailing tail (more than 15 utterances) after the last utterance it recognises as clinical *or* as aftercare advice. It is deliberately conservative but it is still keyword-based: unrecognised clinical advice in a long tail will be trimmed, and nothing downstream reports that a trim happened.
   - Do not describe it as preserving everything. If you add vocabulary, add it to `AFTERCARE_TRIGGER_REGEX` so post-op handover is never treated as room noise.

5. **Grounding verification can clear a hallucination if its extraction is loose.**
   - `transcriptGrounding.ts` extracts teeth, surfaces, drugs and procedures from both the note and the transcript. A loose rule on both sides makes a fabricated finding match an unrelated utterance and be reported as verified.
   - Never treat a bare 2-digit number as a tooth, and never match quadrant abbreviations as a substring (`includes('ur')` also matches "your"). Bias every rule against inventing a finding.
   - A note with nothing recognisable in it has NOT been verified: report it as needing review, never as 100% grounded.

6. **Never synthesise clinical evidence.**
   - Do not generate, template or infer transcript utterances. A transcript is the evidence a note is grounded against; inventing "Full clinical examination performed" produces a record asserting an examination that never happened, and the grounding check then validates the note against the fabrication.
   - Do not invent identity data either (no default DOB, no placeholder practitioner id). An absent value stays absent.

7. **Clinic local time, always.**
   - Never hardcode placeholder dates, and never stamp records from the host clock. Serverless runs UTC, so the host's calendar day puts a Sydney morning appointment on the previous day.
   - Use `src/utils/date.ts`: `getClinicDayKey` (metering buckets), `getClinicDayLabel` / `getClinicTimeLabel` (record headers), `getClinicTodayIso`. Timezone comes from `DENTAI_CLINIC_TIMEZONE` (default `Australia/Sydney`).

8. **Test concurrency isolation.**
   - Always run Vitest with `--fileParallelism=false` (already in the script) because suites share local JSON fixtures.
   - Keep the backup (`beforeAll`) / restore (`afterAll`) hooks for those fixtures, and call `invalidateDbCache()` after modifying JSON on disk.
   - Tests must set `DENTAI_DATA_DIR` to a temp directory so a run never reads or writes the developer's working data.

9. **Silence sleep & pre-pause audio cues.**
   - An adaptive 3-minute silence sleep auto-pauses recording. A 30-second warning (double-pip 784Hz) precedes it with a `[Keep Listening]` / spacebar reset.

10. **Receptionist-friendly UI language (zero jargon).**
    - Copy must be readable by a receptionist or dental assistant. Use *"Live Conversation"*, *"Lines Recorded"*, *"Listening & Taking Notes"*, *"Verified from Audio"*, *"Noise Filter"*, *"End of Day Notes"*, *"Hands-Free Keyboard Shortcuts"*.

11. **Cross-Patient Boundary Isolation & Forced Standby.**
    - Switching patients immediately stops speech recognition, resets recording duration, and engages `STANDBY` mode (`isMicStandby = true`, timer reset to `00:00`, stop chime played).
    - Recording never auto-starts on an incoming patient; it strictly requires physical clinician activation.
    - Live transcript buffers remain segregated by consultation ID (`localLiveTranscripts[consultationId]`), and asynchronous handoffs use immutable data snapshots.

12. **A patient's name is not their identity.**
   - Never resolve, merge or display prior clinical history from a name match. Two patients called John Smith at one practice used to share a chart, so one patient's treatment appeared as the other's history — a clinical safety problem, not a data-quality nit.
   - Use `src/lib/patients.ts`: `decidePatientResolution` returns `matched` only when the name *and* a second detail (DOB, or phone) agree, `ambiguous` when a human must confirm, and `create` otherwise. A record with no `patientId` means "unknown patient" — never fall back to the name.
   - Conflicts win: a mismatched DOB is decisive even when the phone number matches (family phones are shared). Never invent a DOB to make a match work.

13. **The recording is the source of truth for the transcript, not live speech recognition.**
   - Notes were generated from the browser Web Speech API: no dental vocabulary, no diarization, and it silently drops audio. The recorded audio is uploaded (beacon phone, or the cockpit's own slices) and transcribed server-side with speaker roles; live speech is the fallback and is labelled unattributed.
   - `chooseNoteTranscript` decides, and its verdict is recorded on the consultation as `transcriptProvenance` — a note built from non-diarized speech is not the same evidence as one built from recorded audio.
   - Long recordings are refused rather than truncated, and a refused or partial upload is surfaced as a warning. Do not silently transcribe part of an appointment.
   - Transcribed audio is deleted once the transcript is persisted (data minimisation). Do not "keep a backup copy" of raw clinical voice.

14. **Reverse-proxy trust must be declared.**
    - Per-address rate limiting keys on `req.ip`. Behind a platform edge that is the edge's address unless the hop count is set, so every practice would share one bucket. `app.set('trust proxy', <hops>)` — a hop count, never `true` (trusting every hop lets a client spoof `X-Forwarded-For`). Override with `DENTAI_TRUST_PROXY_HOPS`.

