# Workspace Rules: DentAI Working Guidelines

### Serverless & Ephemeral Hosting Guidelines

1. **Stateless Session Authentication**:
   - Never use in-memory token maps (e.g. `Record<string, string>`) to store user sessions on serverless hosting platforms (like Vercel). Serverless routes requests across multiple independent instances, leading to random `Session expired or invalid` (403) errors.
   - Always implement stateless signed tokens (e.g. HMAC-signed JSON tokens or JWTs) that can be verified in-memory by any container instance, or use a shared database store (like Redis/KV).

2. **Read-Only Filesystem Resilience**:
   - Serverless runtimes are read-only at runtime. Writing to local files (like `data/db.json`) will throw write permission errors (`EROFS`).
   - Implement read-through/write-through in-memory caching wrappers for all filesystem operations. If a write throws a write-permission error, log a warning and fallback to memory caching, returning success (200/201) to the client.

3. **Database Test Isolation**:
   - Unit and integration tests must never pollute the persistent database files used by the application in development.
   - Always implement backup (`beforeAll`) and restore (`afterAll`) hooks in the test runner for all database JSON files (like `users.json` and `consultations.json`) to keep the dashboard clean.
   - **Concurrency Isolation:** Vitest runs test files in parallel by default. When tests interact with shared local filesystem JSON files, configure `--fileParallelism=false` in the test script to prevent file write collisions and race conditions between test suites.
   - **Cache Invalidation:** If a test modifies database JSON files directly on disk, always call `invalidateDbCache()` to purge in-memory read caches, ensuring the server sees fresh fixture data.

4. **Overlay Click Z-Index Controls**:
   - Immersive overlays that overlay the screen (like Ambient Tray Mode) must give visual control headers and footers explicit `relative z-50` bounds.
   - Any central visualizers (`flex-grow relative`) must be given a lower stack ordering (like `z-10`) to prevent them from intercepting cursor click events intended for the control panels.

5. **Dependency Overrides (Bun)**:
   - **This repo uses Bun.** There is a `bun.lock` and CI installs with `bun install --frozen-lockfile`. Do NOT commit a `package-lock.json`, `yarn.lock` or `pnpm-lock.yaml` — an extra lockfile is exactly what makes the frozen install fail.
   - Pin patched transitive versions with `"overrides"` in `package.json` (e.g. `"overrides": { "browserslist": "^4.28.9" }`), then regenerate and commit **`bun.lock`** (`bun install`) so the frozen install still matches `package.json`.

6. **Composite Entity IDs for O(1) Updates**:
   - When generating child entity records derived from consultations (such as treatment opportunities), prefix the child ID with the parent consultation ID (e.g. `${consultationId}-tx-${key}`).
   - Update endpoints (`PATCH /api/pipeline/:id`) must parse the prefix to perform direct O(1) targeting rather than scanning the entire consultation database linearly.

7. **Extended Transcript Capacity & Horizon Filtering**:
   - The server transcript capacity is 5,000 entries (allowing up to 10 hours of speech / well under the model's context window). Never set arbitrary low limits (<200) that reject long consultations.
   - Apply `clinicalHorizonFilter` before passing a transcript to an AI model or the offline draft engine, so a microphone left running after the patient leaves does not spend a clinic's token budget on room turnover.
   - It is a **heuristic, not a guarantee**. It drops a long trailing tail (>15 utterances) after the last utterance it recognises as clinical or aftercare. If clinical advice is phrased outside its vocabulary, that tail is trimmed and nothing reports it. Never document it as preserving everything; add new aftercare wording to `AFTERCARE_TRIGGER_REGEX` so post-op handover is never mistaken for noise.

8. **Medical-Grade Audio Silence Sleep & Early Warnings**:
   - Continuous audio listening must feature an adaptive 3-minute silence sleep to prevent battery drain and accidental post-op recording.
   - Clinicians must be given an explicit 30-second audio-visual warning (at 2m 30s) with a distinct warning chime (double-pip 784Hz) and a hands-free `Spacebar` / `[Keep Listening]` trigger before auto-pausing.

9. **Receptionist-Friendly UI Language (Anti-Jargon Standard)**:
   - All user-facing UI copy must be readable by a 12th-grade receptionist or assistant.
   - Strictly avoid engineering and acoustic jargon in the interface:
     - No "DSP squelch" &rarr; use "Noise Filter"
     - No "100% grounded / 0 hallucination vectors" &rarr; use "Verified from Audio"
     - No "Ambient transcription feed / utterances" &rarr; use "Live Conversation / Lines Recorded"
     - No "Batch Tray" &rarr; use "End of Day Notes"
     - No "Master Export" &rarr; use "Copy All Notes"
     - No "Aseptic Operatory Hotkeys" &rarr; use "Hands-Free Keyboard Shortcuts"

10. **Session Tokens Must Carry the Account's Session Epoch**:
    - A session token is HMAC-signed and embeds the account's `sessionEpoch`. `authenticateToken` rejects any token whose epoch differs from the account's.
    - **Never mint a session token by hand.** Always use `issueSessionToken(dentist)`, which reads the epoch from the record. A mint site that omits the field silently defaults it to 0, so once an epoch has been advanced (PIN change, revoke-all, operator lockout) sign-in returns 200 and then *every* later request 403s — a permanent lockout that looks like success.
    - The same applies to session revocation: advancing the epoch is what retires other devices.

11. **Match Request Paths on the Path, Never `req.originalUrl`**:
    - `originalUrl` includes the query string. A pattern anchored with `$` stops matching the moment a caller appends `?x=1`, so a middleware silently becomes a no-op while Express still serves the route — which is how the consultation consent gate, append-only revisions, retention stamps, stale-write guard and read audit were all bypassable with one query parameter.
    - Strip the query (`originalUrl.split('?')[0]`) before deciding anything, and use the stripped form for audit labels so a caller cannot inflate them.

12. **Never Synthesise Clinical Evidence or Identity**:
    - Do not generate, template or infer transcript utterances, and do not substitute a scripted encounter when the microphone captured nothing. The transcript is the evidence a note is grounded against: inventing "Full clinical examination performed" produces a record asserting an examination that never happened, and the grounding check then verifies the note against that fabrication and reports it as verified.
    - Do not invent identity data — no default date of birth, no placeholder practitioner id (`|| 'dentist-01'`). An absent value stays absent so the record shows it is missing.
    - A daysheet/PMS import row is a scheduled appointment, not a clinical record: create the schedule entry, not a consultation with asserted findings.

13. **Actual Clinic Timestamps & Zero Mock Seed Drift**:
    - The application is a live pilot; never hardcode placeholder dates (e.g. static "18 Sep 2026") or demo seed records.
    - All date/time operations must use the clinic timezone utilities in `src/utils/date.ts` (`formatClinicDate`, `formatClinicTime`, `getClinicTodayIso`).

14. **A Name Is Not a Patient Identity**:
    - Never resolve prior history, merge records or attach a consultation from a name match. Use `src/lib/patients.ts` (`decidePatientResolution`, `patientNameKey`) and the registry (`patientStore`). Auto-match only on name + a second detail that *agrees*; anything else is `ambiguous` and needs a human, or a new record.
    - A missing `patientId` means "unknown patient". Never fall back to matching on the name, and never invent a DOB to force a match.
    - When recording live speech that cannot be diarized, label it `'Dialogue'`. Labelling it `'Dentist'` asserted a role the microphone never established and pushed patient-reported statements into the clinician-observed sections.

15. **The Recording, Not the Browser Recogniser, Is the Transcript**:
    - Notes must be generated from the transcribed recorded audio when it exists. Use `chooseNoteTranscript` and store its verdict as `transcriptProvenance` on the consultation.
    - Never truncate a recording to make it fit a transcription limit, and never silently drop a failed upload: refuse, or report the gap as a warning the clinician sees before signing.
    - Delete the raw audio once the transcript is persisted. Do not keep a "backup" copy of clinical voice.
