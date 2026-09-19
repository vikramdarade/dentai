# Patient identity, chair session persistence, and transcription accuracy

**Scope:** three workstreams taken to a production-ready state, on `main`.
**Status:** implemented and verified — typecheck clean, **342 tests pass** (+59), clinical eval gate **3/3 at score 1.0**.
**Verified by:** `bun tsc -b --noEmit` · `bun run test` · `bun run lint` · `bun run eval:notes`.

The three are one story. A note is generated from a transcript; a transcript is
recorded in a session; a session belongs to a patient. Each layer was broken in a
way that the layer above could not detect, and every break produced a plausible,
confident record.

| Layer | What was wrong | Consequence on a real patient |
|---|---|---|
| Identity | A patient's **name** was their identity | Two patients called John Smith shared a chart; prior treatment appeared as another patient's history |
| Session | Chair state was a module-level `Map` | On serverless, pairing succeeded and the next poll 404'd — recording appeared to work, audio went nowhere |
| Transcription | Notes came from the **browser's Web Speech API**; the recorded audio was stored and never read | No dental vocabulary, no speaker separation, silent audio loss — the pilot's "notes were not accurate" |

---

## 1. Patient identity

### What was wrong

Prior-visit history was selected by matching first and last name across a
clinic's consultations. Nothing distinguished same-named patients, and no
identity was stored on the record to check against later. Both halves were load
bearing:

- the chairside view showed *some* John Smith's previous treatment as *this* John
  Smith's prior history — and that history is what the clinician uses to decide
  what to do next, so this is a clinical safety problem rather than a data-quality
  nit;
- because nothing was written down, there was no record to be wrong about, so no
  later correction was possible.

### What changed

**A registry, and an identity policy that refuses to guess.**
`src/lib/patients.ts` is pure and decides one of three ways:

- `matched` — the name **and** a second detail agree (date of birth, or phone).
  Only then is a record reused without asking.
- `ambiguous` — candidates share the name. A human confirms. Never auto-merged.
- `create` — nothing agrees; a new record is registered.

Design choices worth knowing, because each one trades a small annoyance for a
large safety property:

- **A conflicting date of birth is decisive even when the phone number matches.**
  Shared family phone numbers are normal; a different DOB is not.
- **A missing second detail produces a new record, not a merge.** A duplicate can
  be reconciled; a wrong chart cannot.
- **Two records that agree on name and DOB return `ambiguous`, not a pick.** When
  the registry itself is inconsistent, that is for a human to resolve.
- **An absent `patientId` on a consultation means "unknown patient".** Consumers
  must not fall back to matching on the name; the type documents this.

Persistence is `patients` (one row per patient per clinic, unique on
clinic + name key + DOB) with the repo's usual dual implementation (Postgres, and
a JSON fallback so the feature is testable without a database). `POST
/api/patients/resolve` is what the intake path calls; consultation records now
carry `patientId` and `identityNeedsReview`, and prior history is read **by
`patientId`**, never by name.

### Evidence

`tests/patientIdentity.test.ts` (16 tests) covers the policy, the registry, and
specifically the refusals: same-name/no-detail → `ambiguous`; conflicting DOB with
a matching phone → `ambiguous`; duplicate name+DOB pairs → `ambiguous`; an absent
id in the wrong clinic → `null`.

### What is not done

`identityNeedsReview` is set and stored, and the record is always saved — clinical
work is never discarded over an identity question — but the confirmation UI for
resolving an ambiguous intake is minimal. A practice with existing duplicate
records needs a merge tool; `duplicateNameGroups` surfaces them for an operator
check but there is no merge screen yet. **This is the most likely place a solo
founder gets stuck**: the first practice with two John Smiths will hit it in week
one.

---

## 2. Chair session persistence

### What was wrong

Beacon state (pairing, status, telemetry, commands, and every uploaded audio
chunk) lived in a module-level `Map`. On a serverless host that is per-instance
state:

- pairing succeeded on the instance that answered the create call, and the next
  status poll could land on an instance that had never heard of the chair — the
  phone appeared to disconnect mid-appointment;
- commands sent to the phone could be read by an instance that had none;
- uploaded audio was lost with the instance, and the map grew without bound for
  the life of the process.

### What changed

A durable store (`src/server/chairSessionStore.ts`) with two tables, deliberately
separate:

- `chair_sessions` — the small, frequently-written state (status, telemetry,
  commands). Heartbeats rewrite this and nothing else.
- `chair_audio_chunks` — the audio. Written once per slice, read once when the
  appointment is transcribed. Keeping megabytes out of the hot row is what stops a
  3-second heartbeat from re-serialising an appointment.

Also:

- **Caps, enforced against what is already stored** (1,200 slices / 60 MB per
  session). A phone left recording in a drawer must not fill a database. On refusal
  the client is told with a specific code, because the phone keeps its own
  IndexedDB copy and nothing is actually lost.
- **Ordering by `chunkIndex`**, never insertion order. Slices arrive out of order
  after a Wi-Fi drop, and a transcript assembled in arrival order is a scrambled
  record.
- **Idempotent chunk writes** (`ON CONFLICT (chair_id, chunk_index)`), so a retried
  slice replaces rather than duplicates.
- **Expiry sweeping**, which removes a session and its audio together.
- `deleteAudio` (keep the pairing, drop the recording) is separate from `delete`,
  because deleting the recording must never unpair a chair mid-appointment.
- The caps are **injectable**, so they are tested at their boundary with small
  numbers instead of by allocating 60 MB.

### Evidence

`tests/chairSessions.test.ts` (14 tests). The important one reads a session back
through a **second store instance** — the closest a unit test gets to "different
serverless instance, same database" — which is precisely the test that would have
caught the original bug, and which the old in-memory `Map` could not have passed.

---

## 3. Transcription accuracy

### What was wrong (three separate faults)

**(a) The recorded audio was never read.** The beacon phone uploaded the real
audio to the server, and the server stored it. Note generation used the browser's
Web Speech API instead. So the product held the good transcript and used the bad
one.

**(b) The cockpit captured no audio at all.** `ChairsideWorkspace` — the primary
authenticated surface — opened the microphone for a visualiser and the Web Speech
API and nothing else. There was no recording to transcribe, so its notes could
never be better than a browser recogniser with no dental vocabulary that cannot
separate the dentist from the patient.

**(c) Everything captured live was labelled `'Dentist'`.** Web Speech returns one
undifferentiated stream. Every patient statement was therefore recorded as
clinician speech — which is the worst possible default, because the note template
separates patient-reported sections (chief complaint, history) from
clinician-observed findings (tooth findings, diagnosis). A patient's own
description of a symptom could be written into the findings as an observed
diagnosis, and the `needsReview` machinery could not see it because the transcript
claimed to know who spoke.

### What changed

**Server-side diarized transcription of the recording.**
`src/server/transcription.ts` sends the audio to Gemini with a strict instruction
set (verbatim only; no invented content; attribute speakers **by clinical content**,
not by voice order; use `'Dialogue'` rather than guessing; preserve FDI numbers,
surfaces, doses and item terminology exactly; JSON out) and a response schema, with
thinking pinned to `minimal`. Structured output is not decoration: a chatty model
must not be able to smuggle prose into a clinical transcript.

**Two transports, and an honest refusal.** Up to ~10 MB is sent inline; beyond that
the whole recording is uploaded and referenced by URI, then **deleted from the
provider in a `finally`** (a clinical recording must not be left sitting with a
vendor). Windowing the audio into several calls was deliberately rejected: only the
first MediaRecorder slice carries the container header, and speaker labels are only
consistent *within* one call — batch two's "Patient" can be batch one's "Dentist".
On Vertex (the Australian sovereign path) the upload API does not exist, so an
oversized recording is **refused with a code the client can act on**. Silently
transcribing the first ten minutes of a forty-minute appointment would produce a
confident, incomplete record.

**The cockpit records now.** `ChairsideWorkspace` records the microphone it was
already holding in 5-second slices and uploads them against the consultation.
Uploads are chained through one promise so slices land in the order they were
recorded; a failed slice is not retried and does not stop the recording — the gap
is reported to the clinician, not stitched over. The audio container
(`MediaRecorder.mimeType`) is carried with telemetry, because Safari records
`audio/mp4` and guessing `audio/webm` fails the whole transcription.

**One policy for which transcript wins** (`chooseNoteTranscript`), with the
decision recorded on the record as `transcriptProvenance`:

- recorded audio beats live speech, because only it separates dentist from patient;
- a diarized transcript much shorter than what was heard is **flagged**, not used
  silently (a lost upload is quiet — this is the check that makes it loud);
- an incomplete upload, and a low attributed-speaker share, are flagged;
- the live transcript is used as a fallback and is **labelled** as
  not-speaker-separated, so the record does not claim a role it never established;
- nothing captured → source `'none'`, which is a real state, not a failure.

**Live speech is now labelled `'Dialogue'`**, and the deterministic offline engine
was updated to treat an unattributed line as evidence for *both* pools (it may
legitimately be a finding or a complaint). Without that second change, honest
labelling would have silently emptied the clinician sections of every offline draft.

**Fabricated clinical fallbacks removed.** The cockpit's note finalisation
previously filled empty sections with boilerplate — `'Teeth examined and stable.'`,
`'Gingiva stable.'`, `'Procedure completed.'`, `'Patient completed visit.'` — and,
when nothing was captured at all, invented the transcript line *"Clinical procedure
completed successfully."* and generated a note from it. That is a record asserting
an examination and a procedure that may never have happened, and the grounding
check then validated the note against the fabrication. Those defaults are gone:
every section falls back to what is already on the record and then to **empty**.
An empty field is visibly unfinished; a fabricated one is not. The invented
`'1985-01-01'` date of birth is gone for the same reason — a fabricated identifier
is how two patients' records get merged.

**Cost and privacy.** Transcription is metered against the clinic's AI allowance
(`ai_transcription`), a repeat call for a consultation returns the stored
transcript unless `force` is set (a dentist clicking twice must not pay twice), and
**the raw audio is deleted once the transcript is persisted** — after a *persisted*
success only, because a transcript that lives only in the response has nowhere to
be recovered from.

### Evidence

`tests/transcription.test.ts` (29 tests). The ones that matter:

- two 1-byte chunks each carrying their own `=` padding — proves the assembly joins
  **decoded bytes**, since joining base64 text corrupts everything after the first
  gap;
- a missing chunk index is reported, not hidden;
- `'Speaker 3'` becomes `'Dialogue'` and a dental assistant is **not** promoted to
  clinician (attributing an assistant's words to the dentist asserts an observation
  the dentist never made);
- the upload is deleted from the provider on success *and* when the transcription
  fails;
- Vertex refuses an oversized recording instead of truncating it;
- another clinician's chair returns 403 before any audio is read;
- a persisted transcript deletes the audio; a non-persisted one does not.

---

## The single biggest remaining limitation

**Nothing here can recover a tooth number that was never recorded.** Diarization
fixes *who said it*; it does not fix *whether it was heard*. The remaining quality
ceiling is upstream and physical:

1. **Microphone placement and room noise.** One phone on the counter and one laptop
   microphone in a room with a high-speed handpiece at 4,200 Hz will always lose
   speech. The DSP chain helps; it does not solve it.
2. **Overlapping speech.** The model is told to use `'Dialogue'` when speakers
   overlap, which is honest and means the note is flagged for review more often.
3. **Accents, dentures, and masks.** Not measurable from here.
4. **Transcription latency on very long appointments.** Fixed by refusing, not by
   degrading — but a 45+ minute appointment on the Vertex path will not be
   transcribed and the note will fall back to live speech with a warning.

**Recommendation before making any further accuracy claim to a practice:** record
20–30 real appointments and measure (a) how often the diarized transcript is used
rather than the live fallback, (b) the warning rate, and (c) how often the dentist
edits a generated section. That is the evidence a pilot decision should rest on,
and it is cheap to collect now that `transcriptProvenance` is on every record.

---

## Gotchas a founder will hit

1. **Postgres paths are unverified in this workspace.** The suite skips 22
   Postgres tests without `DATABASE_URL`. The new `patients`, `chair_sessions` and
   `chair_audio_chunks` migrations are written and registered, but they have not
   been executed against a real database here. **Run `bun run db:migrate` against
   staging before the first production deploy** and run `bun run test:postgres`.
2. **The audio ingress is capped, and the caps are real.** A 45+ minute appointment
   can hit either the 1,200-slice or the 60 MB cap. On the beacon path the phone
   keeps its own copy; on the cockpit path the client is told to finish the note.
   Watch for the refusal code in logs — it is the signal that a practice's
   appointments are longer than the limits assume.
3. **`/api/transcribe` is invoked on finalisation, in the note's critical path.**
   It waits up to 25 s for the transcription before falling back. A slow provider
   therefore adds up to 25 s to "Finalize Note". That is deliberate (better
   transcript beats faster) but it is a UX cost, and the honest fix is
   pre-transcribing when recording stops, which the legacy record screen already
   does. Porting that to the cockpit is the next obvious improvement.
4. **A beacon chair id is not a capability.** `/api/beacon/chair/:chairId/upload-chunk`
   is unauthenticated by design (the phone has no session), so anyone who guesses a
   six-hex-character id can *write* junk slices into someone's session. It cannot
   read audio (there is no read endpoint) and cannot trigger transcription
   (`/api/transcribe` requires a session token and checks ownership), so the impact
   is corrupting an in-progress recording. Worth tightening with the chair token
   before scale.
5. **The cockpit writes the whole consultation on every utterance.**
   `handleAppendTranscriptText` calls `onSaveConsultation` per utterance, and
   consultations now also carry audio slices. On Postgres that is one jsonb rewrite
   per sentence for the length of an appointment. It works; it will not scale
   gracefully, and it is the first thing to batch.
6. **`Api` function budget is now 120 s.** The transcription path needs the room;
   the note path is still bounded by its own 25 s/18 s budgets, so raising the
   platform ceiling did not relax the clinical latency budget. Do not read 120 s as
   an acceptable note-generation time.
7. **The cockpit's `'Dialogue'` label changes offline drafts.** Intentionally: the
   deterministic engine now treats unattributed lines as evidence for both
   patient-reported and clinician-observed sections. If a draft looks fuller than
   before, that is why.
8. **Deleting transcription audio is not reversible.** Once a transcribed
   appointment's audio is deleted, `force: true` cannot re-transcribe it. That is
   deliberate (data minimisation) but it means a model change does not retro-fix
   past transcripts.
