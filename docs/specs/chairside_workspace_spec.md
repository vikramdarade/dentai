# Specification: Chairside Workspace (ChairsideWorkspace.tsx)

## 1. Objective & Vision
Perfect `ChairsideWorkspace.tsx` to operate with 100% reliability, zero data loss, and pristine compliance with Australian Dental Association (ADA) and AHPRA clinical standards. The chairside workspace is the primary real-time operatory dashboard used by clinicians during active consultations, managing continuous speech recognition, real-time clinical notes generation, dynamic day schedule tracking, non-blocking patient turnover, and single-patient PMS clipboard export.

---

## 2. Core Subsystems & Technical Requirements

### Subsystem 1: Patient Handoff, In-Chair Ephemerality & Day Schedule Tracking
- **Rule 18 Compliance**: In-chair encounters (`chair-active`) exist strictly in-memory as transient scratchpads. They must never be persisted to storage with ID `chair-active`.
- **Next Patient Finalization**: When clicking "Next Patient" (`handleNextPatient`) or pressing `⌘→`:
  - If substantive content exists (speech captured, notes entered, or macro applied):
    - Mint an immutable timestamped ID (`consult-${Date.now()}`).
    - Immediately persist the completed consultation with `status: 'Completed'` and clinic timezone date (`getClinicTodayIso()`).
    - Immediately register the encounter in `dayScheduleStorage` (`addScheduleItem`) with `status: 'done'`, time, patient name, and procedure.
    - Display confirmation toast: `"Prior note saved to End of Day Notes. Ready for In-Chair Patient {nextNum}."`
  - If no substantive content exists (clean untouched session):
    - Do not fabricate consultations or mint blank records (Rule 12).
    - Advance to `In-Chair Patient {nextNum}` with a clean scratchpad.
    - Display honest toast: `"Ready for In-Chair Patient {nextNum}."`
- **Day Schedule Representation**:
  - The left collapsible Day Schedule pane renders all appointments for the clinic date (`encountersForDate`).
  - Completed in-chair appointments appear chronologically in the list with a `"Done"` status badge and patient details.
  - Active encounter is highlighted with sky-blue border accent and indicator.

### Subsystem 2: Clinical Note Generation, Inline Editing & Strict Regeneration Guard
- **Progressive Speech & Macro Drafting**:
  - Automatically synthesizes clinical progress notes from speech dialogue via offline macro engine (`generateMacroNote`, `generateOfflineDraft`) and hosted LLM queue.
  - Formats output according to selected Australian PMS standard (`d4w`, `exact`, `cliniko`, `generic`).
- **Inline Editing & Autosave**:
  - Clinician manual edits in the progress note textarea are saved optimistically in `editedProgressNotes` (0ms typing latency) and debounced to consultation storage.
- **Strict Regeneration Confirmation Modal**:
  - When manual edits exist in `editedProgressNotes` and the clinician clicks "Regenerate Note":
    - Present a strict modal confirmation: *"Regenerating will replace your manual edits with fresh audio transcription. Continue?"* with `[Cancel]` and `[Replace & Regenerate]`.
    - If confirmed, clear edits and regenerate fresh note from dialogue.
    - If cancelled, preserve existing manual edits intact.

### Subsystem 3: Live Audio Recording, Silence Sleep & Aseptic Ambient Banner
- **Rule 8 Silence Sleep**:
  - Continuous audio listening monitors silence.
  - At 2m 30s of silence, trigger a 30-second audio-visual warning (pulsing warning banner + double-pip 784Hz chime).
  - At 3m 00s, automatically halt microphone and transition to standby mode.
- **Aseptic Ambient Banner**:
  - Display a pinned amber banner: *"Audio Paused after 3m silence. Press Spacebar or click to Resume Listening"*.
  - Clinician can press `Spacebar` or tap the button to immediately resume active listening without touching a mouse.
- **Rule 14 Patient Boundary Isolation**:
  - Any patient transition (Next Patient, Daysheet item click, Prev Patient) immediately stops the browser recognition buffer, sets `isMicStandby = true`, resets recording timer to `00:00`, and plays stop chime.

### Subsystem 4: PMS Export Targets & Clipboard Architecture
- **Target Adapters**:
  - `d4w`: Dental4Windows structured progress notes (Tooth, Surface, Material, Anaesthetic, Next Visit).
  - `exact`: Software of Excellence formatted text.
  - `cliniko`: Cliniko medical progress note format.
  - `generic`: Clean formatted plain text SOAP.
- **1-Click Copy with Persistent Target Selector**:
  - Remembers preferred target in persistent settings (`localStorage`).
  - Single click or `⌘C` copies the formatted note and marks status as `done` with visual checkmark.

### Subsystem 5: End-of-Day Notes (Batch Tray) Single-Patient Export
- **Clinical Safety Constraint**:
  - In accordance with clinical risk prevention, disable monolithic "Copy All" batch string dumps that risk accidental clipboard pasting into incorrect patient charts.
  - The End-of-Day Notes tray lists each finalized patient encounter individually with:
    - Patient Name, DOB, Time, Operatory.
    - Procedure and SOAP summary excerpt.
    - ADA procedure item codes.
    - Individual `[Copy Note]` action that formats the note for the active PMS target and displays an immediate green `[Copied!]` checkmark.

### Subsystem 6: Aseptic Hotkeys & Context Guards
- **Shortcuts**:
  - `Spacebar`: Start / Pause / Resume Audio (dismisses silence alarm).
  - `⌘→` / `Ctrl+→`: Next Patient handoff.
  - `⌘←` / `Ctrl+←`: Prev Patient handoff.
  - `⌘B` / `Ctrl+B`: Toggle End of Day Notes tray.
  - `⌘V` / `Ctrl+V`: Open Daysheet paste modal (when outside inputs).
  - `⌘C` / `Ctrl+C`: Copy active progress note for PMS (when no text is selected).
- **Context Guards**:
  - All hotkeys are strictly suppressed when the user is typing inside any `HTMLInputElement` or `HTMLTextAreaElement`.
  - Subtle keyboard shortcut badges are visible in the persistent footbar (`[Space]`, `[⌘→]`, `[⌘B]`, `[⌘C]`).

---

## 3. Tech Stack & Commands
- **Framework**: React 19 + TypeScript 5.8 + Vite
- **Styling**: TailwindCSS 4 with custom operatory design tokens
- **Test Runner**: Vitest 4 with `--fileParallelism=false`
- **Commands**:
  - Dev Server: `bun run dev` (or `npm run dev`)
  - Type Check: `npx tsc --noEmit`
  - Unit & Integration Tests: `npx vitest run --fileParallelism=false`
  - Build: `bun run build`

---

## 4. Boundaries
- **Always Do**:
  - Run `npx vitest run --fileParallelism=false` and `npx tsc --noEmit` before proposing commits.
  - Use clinic timezone utilities (`getClinicTodayIso`, `formatClinicDate`, `getClinicTimeZone`) for all dates.
  - Enforce Rule 14 (immediate audio shutoff on patient transition) and Rule 18 (ephemeral `chair-active`).
- **Ask First**:
  - Adding external dependencies or modifying database JSON schemas.
- **Never Do**:
  - Never synthesize clinical evidence or invent tooth numbers (Rule 12 & Rule 19).
  - Never allow "Copy All" mass clipboard dumps in the Batch Tray.
  - Never persist `chair-active` directly into permanent storage.

---

## 5. Success Criteria & Verification
1. [x] In-chair patient turnover creates immutable records (`consult-${Date.now()}`) and displays them in Day Schedule sidebar and End of Day Notes tray.
2. [ ] "Regenerate Note" with active manual edits triggers the strict modal confirmation before touching dialogue drafts.
3. [ ] 3-minute silence sleep triggers the ambient amber warning banner and resumes seamlessly via `Spacebar`.
4. [ ] Batch Tray enforces single-patient individual note review and copying.
5. [ ] 100% of test suites pass cleanly with 0 type errors.
