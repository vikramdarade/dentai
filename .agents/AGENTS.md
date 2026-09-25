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
   - Use the **approved term** on the right; never the banned term on the left:

   | ❌ Banned | ✅ Use instead |
   |---|---|
   | DSP squelch / DSP filter | Noise Filter |
   | 100% grounded / 0 hallucination vectors | Verified from Audio |
   | Ambient transcription feed / utterances | Live Conversation / Lines Recorded |
   | Batch Tray | End of Day Notes |
   | Master Export / Copy All | Copy All Notes |
   | Aseptic Operatory Hotkeys | Hands-Free Keyboard Shortcuts |
   | Standby mode / Mic armed | Ready to Listen |
   | Listening active / Mic live | Listening &amp; Taking Notes |
   | Audio session / Recording session | Consultation Recording |
   | SOAP note / structured note | Clinical Note |

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

14. **Cross-Patient Boundary Isolation & Forced Standby**:
    - Any patient transition (via Daysheet selection, "Next Patient" button, or `⌘→` hotkey) must **immediately halt active listening** (`recognitionRef.current.stop()`) and place the workspace into explicit **`STANDBY` mode (`isMicStandby = true`, timer reset to `00:00`, stop chime played)**.
    - Never auto-start recording on a newly selected patient; recording must strictly require intentional, physical clinician initiation (`Spacebar` or `Start Audio`).
    - Speech recognition buffers and live in-memory transcripts must remain strictly scoped by unique patient consultation ID (`localLiveTranscripts[targetId]`).
    - The asynchronous handoff for the prior patient must dispatch an immutable snapshot of their transcript, ensuring subsequent room audio cannot contaminate the prior patient's chart.

15. **A Name Is Not a Patient Identity**:
    - Never resolve prior history, merge records or attach a consultation from a name match. Use `src/lib/patients.ts` (`decidePatientResolution`, `patientNameKey`) and the registry (`patientStore`). Auto-match only on name + a second detail that *agrees*; anything else is `ambiguous` and needs a human, or a new record.
    - A missing `patientId` means "unknown patient". Never fall back to matching on the name, and never invent a DOB to force a match.
    - When recording live speech that cannot be diarized, label it `'Dialogue'`. Labelling it `'Dentist'` asserted a role the microphone never established and pushed patient-reported statements into the clinician-observed sections.

16. **The Recording, Not the Browser Recogniser, Is the Transcript**:
    - Notes must be generated from the transcribed recorded audio when it exists. Use `chooseNoteTranscript` and store its verdict as `transcriptProvenance` on the consultation.
    - Never truncate a recording to make it fit a transcription limit, and never silently drop a failed upload: refuse, or report the gap as a warning the clinician sees before signing.
    - Delete the raw audio once the transcript is persisted. Do not keep a "backup" copy of clinical voice.

17. **Clinic-Wide Specialty Scope, Negation Guards & Procedure Disambiguation**:
    - **Universal Service Coverage**: Operatory note generation and macro selection must natively support the entire Australian general and specialty dental scope:
      - *Surgical & Oral Surgery*: Simple & surgical wisdom teeth extraction (ADA 311, 324, 386), bone guttering, tooth sectioning, sutures.
      - *Implantology*: Fixture placement (ADA 661), osteotomy under chilled saline, insertion torque (Ncm), healing abutments (ADA 684).
      - *Removable Prosthodontics*: Complete & partial dentures (ADA 711, 712, 721), border moulding, master impressions, CAD/CAM digital dentures.
      - *Implant Prosthodontics*: Implant-supported overdentures (ADA 672, 712, 731), locator abutment torquing, chairside pick-up resin, retention caps.
      - *Cosmetic & Aesthetic*: In-chair Pola tooth whitening with gingival barrier (ADA 118, 119), diagnostic wax-up mock-ups, porcelain veneers with butt-joint enamel prep (ADA 582, 583, 556).
      - *Fixed Prosthodontics*: Multi-unit bridges & crowns (ADA 613, 615, 627, 643), crown issue & cementation with RelyX/Panavia (ADA 651, 652).
      - *Orthodontics*: Clear aligners / Invisalign (ADA 825), composite attachment bonding, interproximal reduction (IPR), tracking reviews.
      - *Endodontics*: Stage 1 emergency pulp extirpation & dressing (ADA 414) vs. Stage 2/3 chemo-mechanical prep and gutta-percha obturation (ADA 415, 416).
      - *Periodontics & Prevention*: Prophylaxis and fluoride (ADA 111, 114, 121) vs. quadrant subgingival root planing with Gracey curettes (ADA 222).
      - *Trauma & Emergencies*: Luxation/subluxation repositioning and flexible wire splints (ADA 392).
      - *Sleep Dentistry*: Conscious IV sedation (Midazolam/Fentanyl titration), nitrous oxide relative analgesia, continuous vitals, Aldrete discharge criteria (ADA 927, 943, 949).
    - **Contraindication & Negation Supremacy**: Any clinical statement indicating a procedure is contraindicated, avoided, refused, or deferred (e.g., patient on anticoagulants/antiresorptives, GP clearance needed) MUST strictly suppress that procedure. Never generate billing items or operative sections for a contraindicated intervention.
    - **Disambiguation Precedence**:
      - Porcelain veneers (facial reduction, mock-up) must take precedence over full crown preparation.
      - Aligner attachments & IPR must take precedence over routine direct restorations.
      - Crown cementation/try-in (temporary crown removal, RelyX) must take precedence over crown preparation.
      - Conscious sedation vitals & recovery must be captured independently from the underlying surgical or restorative treatment.
    - **Chained Entity Extraction**: Tooth extraction regexes must extract complete lists and conjunctions (`teeth 14 and 16`, `teeth 16, 26, 36, 46`, `13 to 23`) and map all relevant teeth to the clinical record.

