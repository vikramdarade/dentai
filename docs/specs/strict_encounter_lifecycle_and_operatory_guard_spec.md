# Technical Specification: Strict Encounter Lifecycle & Operatory Guard

**Document Version:** 1.0.0  
**Status:** APPROVED FOR IMPLEMENTATION  
**Topic:** Clinician Feedback & Operatory Recording Stability  
**Target Modules:** `ChairsideWorkspace.tsx`, `ClinicalNoteEditorPanel.tsx`, `OperatoryPatientBanner.tsx`, `DayScheduleQueue.tsx`  

---

## 1. Problem Statement & Root Cause

In clinical operatory practice, dentists and dental assistants reported the following critical issue:
1. **Cold Start Pre-Load:** On app launch, a stale consultation or previous patient record was already loaded on screen.
2. **Premature Recording:** The clinician pressed Spacebar to start recording as the patient entered the room, before checking who was loaded on screen.
3. **Mid-Recording Advancement:** The clinician (or assistant) clicked "Next Patient" or selected a new patient from the day schedule while recording was in-flight.
4. **Data Contamination:** The audio chunks and live transcripts were either prematurely stamped to the prior patient, severed in mid-sentence, or split across both records.

---

## 2. The Strict Encounter Lifecycle State Machine

To guarantee 100% boundary isolation and eliminate accidental cross-patient contamination, the operatory cockpit transitions through an explicit **Encounter State Machine**:

```
┌────────────────────────────────────────────────────────────────────────┐
│ STATE 1: CHAIR EMPTY (Cold Start / Post-Turnover)                     │
│ - Canvas locked in read-only / standby mode.                          │
│ - Spacebar / recording is disabled with explicit prompt.               │
│ - Action Banner: "Next Scheduled: [John Smith (8:00 AM)] [Seat Patient]"│
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ Clinician clicks [Seat Patient]
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ STATE 2: ENCOUNTER ACTIVE                                              │
│ - Canvas unlocked. Spacebar & microphone armed.                        │
│ - 🔒 "Next Patient" button is strictly DISABLED & GREYED OUT.          │
│ - Tooltip: "Finish current encounter to unlock next patient."          │
│ - Escape Hatch: "Wrong patient? [Switch Appointment]"                  │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ Clinician clicks [Finish Encounter] or [Sign Off]
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ STATE 3: ENCOUNTER FINISHED                                            │
│ - Microphone automatically stops (stop chime plays).                   │
│ - Clinical note is finalized and sealed to the active patient.         │
│ - 🔓 "Next Patient ➔" is now ENABLED in bright green.                 │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ Clinician clicks [Next Patient]
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ STATE 4: ADVANCE TO NEXT PATIENT                                       │
│ - Workspace switches to next patient record.                           │
│ - Enters STATE 2 (Active) for the new patient in clean STANDBY mode.   │
│ - Timer resets to 00:00; Zero audio bleed.                             │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. UI Component Enhancements

### 3.1 `ClinicalNoteEditorPanel.tsx` (Action Bar Suite)
- **Active Encounter:** 
  - Render primary button: **`[Finish Encounter]`** (or `[Sign Off]`).
  - Render **`[Next Patient ➔]`** button as **disabled**:
    - `opacity-50 cursor-not-allowed`
    - Tooltip: *"Finish current encounter to unlock next patient"*
- **Finished Encounter:**
  - Render **`[Next Patient ➔]`** as **enabled**:
    - `bg-emerald-600 hover:bg-emerald-700 text-white shadow-md animate-pulse`
    - Clicking advances immediately to the next patient on the schedule.

### 3.2 `OperatoryPatientBanner.tsx` (Header Banner)
- **Status Badges:**
  - `Encounter in Progress` (Amber pill when mic active or notes being taken)
  - `Encounter Completed` (Green checkmark when finished)
- **Escape Hatch Link:**
  - Small, unobtrusive link: `Wrong patient? [Switch Appointment]`
  - Clicking this link when audio has been recorded triggers the **Guarded Transition Modal**.

### 3.3 `GuardedTransitionModal.tsx` (Mistake Recovery Dialog)
Triggered **only** when a clinician attempts to switch patients while audio was captured in the current session:
1. **Option 1:** *"Save audio to [Current Patient] & Switch"*
2. **Option 2:** *"This audio is actually for [Target Patient]! Move audio & Keep recording"*
3. **Option 3:** *"Discard audio & Switch"*
*Strict Mouse Click Only:* Keyboard hotkeys / Spacebar are disabled inside this modal to prevent accidental misfiring.

---

## 4. Audio Transfer Mechanics (Option 2: "Move Audio")

When the clinician selects *"This audio is actually for [Target Patient]! Move audio & Keep recording"*:
1. Synchronously detach in-memory audio buffers and transcripts from `currentPatientId`.
2. Attach the audio slices and transcript to `targetPatientId`.
3. Roll back `currentPatientId` consultation record to its prior clean state.
4. Set active patient to `targetPatientId`.
5. Keep the microphone actively recording (`isMicStandby = false`) so zero conversation is lost while the clinician fixes the screen attribution.

---

## 5. Verification & Acceptance Criteria

- [ ] On app launch, `isEncounterActive` defaults properly; `Next Patient` is locked until active encounter finishes.
- [ ] During active recording, clicking `Next Patient` is blocked or intercepted.
- [ ] Clicking `Finish Encounter` halts audio recording, saves the note, and unlocks `Next Patient ➔`.
- [ ] Clicking `Next Patient` cleanly advances to the next scheduled appointment in fresh Standby mode (`00:00`).
- [ ] Escape hatch allows moving misattributed audio to the correct patient with continuous recording.
- [ ] All Vitest tests pass with `bun test --fileParallelism=false`.
- [ ] Typecheck passes with `bun run lint`.
- [ ] Production build succeeds with `bun run build`.
