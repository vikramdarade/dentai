# DentAI State Inventory

**Status:** initial draft, bootstrapped 2026-09-28 from `PROJECT_CONTEXT.md` and `.agents/AGENTS.md`. Agents extend with evidence from code.

## 1. Client application states

### Recording / session state machine (`ChairsideWorkspace`)

| State | Meaning | Entry | Exit |
|---|---|---|---|
| `STANDBY` | Mic disengaged; timer `00:00` | Patient switch, initial load, silence auto-pause, stop | Clinician-initiated start only |
| `LISTENING` | "Listening & Taking Notes" | Physical clinician activation (Spacebar / Start Audio) | Stop, pause, patient switch, silence sleep |
| `SILENCE_WARNING` | 30s pre-sleep warning (double-pip 784Hz) at 2m30s | Adaptive silence timer | `[Keep Listening]` / spacebar reset → LISTENING; timeout → STANDBY |

**Invariants (protected):**
- Recording **never** auto-starts on patient selection.
- Patient switch ⇒ immediate `recognitionRef.current.stop()` + `isMicStandby = true` + timer reset + stop chime.
- Live transcript buffers strictly scoped by consultation id (`localLiveTranscripts[consultationId]`); handoffs use immutable snapshots.

### Note lifecycle

`drafted` → `clinician review/correction` (append-only revisions, optimistic concurrency) → `sign-off` (server gate; client SHA-256 seal is integrity display only) → `signed (immutable)`.

Sign-off is **fail-closed**: grounding approval `!== true`, blocking fact states, missing consent, or version mismatch block signing. Never auto-sign.

## 2. Server states

### Session / auth
- Stateless HMAC tokens carrying `sessionEpoch` from the dentist record (never mint by hand; always `issueSessionToken`).
- Epoch advance (`bumpDentistEpoch`) = PIN change / revoke-all / operator lockout ⇒ all prior tokens dead.

### Note job queue
- Durable queue (Postgres or JSON fallback) with priority, backoff, per-clinic metering (`noteJobs.ts`).
- Drained by `POST /api/ops/drain` (ops secret) or `GET/POST /api/cron/drain` (cron secret).
- `openNoteJobs` depth visible on `GET /api/ops/telemetry`.

### Persistence
- Postgres (Neon) when `DATABASE_URL` set — production mode.
- JSON-file fallback fails closed unless `DENTAI_ALLOW_FILE_STORAGE=true`; on serverless it is not durable.

### Encounter scratchpad
- `chair-active` fallback encounter is in-memory ephemerality only: never persisted with completed findings; fresh session with 0 lines = pristine blank canvas.

## 3. Transcript provenance states

`recorded audio (server, diarized)` > `live Web Speech (unattributed fallback)` — decision by `chooseNoteTranscript`, verdict stored as `transcriptProvenance` on the consultation. Long recordings are refused, not truncated; partial uploads surface as warnings. Raw audio deleted after transcript persisted (data minimisation).

## 4. Fact states (ClinicalFact)

Canonical fact model: discriminated assertions with evidence spans, status×temporal compatibility matrix (historical / current / planned / completed-today), FDI metadata integrity, negation scope, attribution (patient/assistant statements never promoted to clinician observations). See `docs/CLINICAL_FACT_SPECIFICATION.md` — **protected semantics**.
