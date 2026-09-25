# Data flow and sub-processors

This is the factual answer to "where does a patient's information actually go?".
It backs the in-app privacy notice (`src/components/LegalPage.tsx`) and the
sub-processor list a practice will ask for during onboarding. **If you change a
processing path in code, change this file in the same commit.**

## Roles

| Party | Role under the Privacy Act 1988 |
|---|---|
| The dental practice | Holds the patient record; decides why and how it is used |
| DentAI (you) | Processes the record on the practice's instructions — a contracted service provider |
| Google, Neon, Vercel | Sub-contracted processors, used only for the functions below |

A practice cannot delegate its obligations to you. Your job is to make sure
they can answer a patient's access request quickly and that nothing leaves
Australia without them knowing.

## What is collected

- **Clinician account**: name, specialty, clinic memberships, PIN.
  The PIN is stored only as a salted PBKDF2 hash — no plaintext, no reversible
  form. Recovery codes are stored hashed and are single-use.
- **Consultation**: patient first/last name, date of birth, appointment type,
  intake answers, transcript of the consultation, the generated draft, the
  reviewed note, patient correspondence text, and the recorded consent
  (timestamp + disclosure version).
- **Access log**: who signed in, who opened which consultation, who changed a
  note, credential changes. Append-only; contains identifiers and event types,
  not clinical text.
- **Usage ledger**: per-clinic note and token counts, for cost control.

Nothing else is collected. There is no advertising or analytics SDK in the app.

## Where it goes

| Path | Destination | Region | Notes |
|---|---|---|---|
| Note drafting (primary) | Vertex AI / Gemini (`@google/genai`) | `GCP_REGION`, default `australia-southeast1` | Transcript + intake sent; draft returned. Google does not train on this data under the Vertex/paid API terms. |
| Note drafting (fallback key) | Gemini API with `GEMINI_FALLBACK_API_KEY` | Google default | Only used when the primary path fails. Same data. |
| Note drafting (offline) | The clinician's own browser | Device | `src/lib/draftEngine.ts` — deterministic, nothing leaves the device. Flagged `needsReview`. |
| Live transcription | Browser SpeechRecognition engine, or the clinic's typing | Device / browser vendor | Where the browser engine is used, audio handling is the browser vendor's. A practice that requires no audio to leave the device should type or paste the transcript. |
| Records, audit log, jobs, usage | Neon Postgres (`DATABASE_URL`) | Neon project region — **set this to Sydney (ap-southeast-2)** | Encrypted at rest by Neon. |
| Application hosting, logs | Vercel | Deployment region — **set to Sydney (syd1)** | Request logs contain URLs, status and timing, not clinical content. Never log transcripts. |
| Error alerts | `ERROR_WEBHOOK_URL` (Slack/Teams/Discord) | Vendor | Payloads are error messages and route names. Do not add patient identifiers to log context. |

## Sub-processor register

Give this table to a practice on request. Update the "Last reviewed" date when
you change it.

| Sub-processor | Purpose | Data | Location |
|---|---|---|---|
| Google Cloud / Gemini API | AI note drafting | Consultation transcript + intake | Australia southeast (default) |
| Neon (or your Postgres host) | Database | All records and the access log | Must be set to Sydney |
| Vercel | Hosting and static assets | Request metadata | Must be set to Sydney |
| Slack / Teams / Discord (optional) | Operational alerts | Error messages only | Vendor default |
| GitHub | Source code (no patient data) | Code only | n/a |

*Last reviewed: 16 September 2026.*

## Rules that keep this document true

1. **Never log clinical content.** No transcript text, no note text, no patient
   names in log fields or error payloads.
2. **Never commit `data/`.** It is gitignored; the JSON store exists only for
   local development. Production must run on Postgres.
3. **Keep AI in an Australian region** unless the practice has been told and has
   agreed otherwise in writing.
4. **Record the engine on every note** (`noteOrigin`) so any draft's processing
   path is reconstructable after the fact.
