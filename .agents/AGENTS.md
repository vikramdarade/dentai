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

5. **CI Security Audit & Dependency Overrides**:
   - When CI enforces `npm audit --audit-level=high`, high-severity vulnerabilities in transitive dependencies (e.g. `browserslist`) will break the build.
   - Pin patched versions using npm `"overrides"` in `package.json` (e.g. `"overrides": { "browserslist": "^4.28.9" }`) and commit the synchronized `package-lock.json`.

6. **Composite Entity IDs for O(1) Updates**:
   - When generating child entity records derived from consultations (such as treatment opportunities), prefix the child ID with the parent consultation ID (e.g. `${consultationId}-tx-${key}`).
   - Update endpoints (`PATCH /api/pipeline/:id`) must parse the prefix to perform direct O(1) targeting rather than scanning the entire consultation database linearly.

7. **Extended Transcript Capacity & Horizon Filtering**:
   - The server transcript capacity is 5,000 entries (allowing up to 10 hours of speech / <75,000 tokens of Gemini 2.5 Flash's 1,000,000-token window). Never set arbitrary low limits (<200) that reject long consultations.
   - When passing transcripts to AI synthesis models or offline draft engines, always apply `clinicalHorizonFilter` to prune post-procedure room turnover noise while preserving all clinical dialogue and post-op instructions.

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

10. **Actual Clinic Timestamps & Zero Mock Seed Drift**:
    - The application is a live pilot; never hardcode placeholder dates (e.g. static "18 Sep 2026") or demo seed records.
    - All date/time operations must use the clinic timezone utilities in `src/utils/date.ts` (`formatClinicDate`, `formatClinicTime`, `getClinicTodayIso`).

11. **Cross-Patient Boundary Isolation & Forced Standby**:
    - Any patient transition (via Daysheet selection, "Next Patient" button, or `⌘→` hotkey) must **immediately halt active listening** (`recognitionRef.current.stop()`) and place the workspace into explicit **`STANDBY` mode (`isMicStandby = true`, timer reset to `00:00`, stop chime played)**.
    - Never auto-start recording on a newly selected patient; recording must strictly require intentional, physical clinician initiation (`Spacebar` or `Start Audio`).
    - Speech recognition buffers and live in-memory transcripts must remain strictly scoped by unique patient consultation ID (`localLiveTranscripts[targetId]`).
    - The asynchronous handoff for the prior patient must dispatch an immutable snapshot of their transcript, ensuring subsequent room audio cannot contaminate the prior patient's chart.

