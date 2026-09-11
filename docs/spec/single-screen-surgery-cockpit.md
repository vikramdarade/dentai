# Specification: The Single-Screen Surgery Cockpit & Ambient HUD

## 1. Executive Summary & Clinical Vision
In high-volume private dental practices across Australia, dentists and dental assistants work under extreme physical and temporal pressure. Turnaround time between 30-to-45 minute appointments is typically under 3 minutes, during which operators must strip barrier plastic, disinfect surfaces, and seat the next patient.

Any software requiring multi-page navigation, intake wizards, blocking save screens, or manual data reconciliation is abandoned within days.

**The Solution:** The **DentAI Single-Screen Surgery Cockpit** unifies the entire clinical day onto one unmoving screen:
1. **Morning PMS Snip & Smart Merge:** Pasting a D4W or Praktika screenshot (`Ctrl + V`) populates today's roster with cryptographic deduplication—even if repasted midday.
2. **Top Surgery Island:** Initiating a consultation expands an ergonomic floating surgery bar at the top of the monitor with an organic audio visualizer and real-time ADA keyword chips, while the full schedule remains visible below.
3. **Zero-Wait Chairside Handoff:** Tapping `[ Finish Consult ]` instantly releases the screen, stores the audio in a local IndexedDB vault, and synthesizes clinical notes silently in the background.
4. **5:00 PM Cake Walk:** All clinical notes are waiting in the queue, formatted for D4W/Praktika with 1-click clipboard transfer.

---

## 2. The 3-Axis Deep Review

### Axis 1: Clinical Ergonomics & Surgery Environment
* **Top Screen Dominance:** Overhead articulating arm monitors sit at eye level. Placing the live recording status at the top gives the dentist zero-latency confirmation that audio is live without straining or bending down.
* **Taskbar Conflict Elimination:** Moving all interactive controls away from the bottom edge prevents accidental mis-clicks on the Windows 10/11 taskbar, system trays, or D4W popups.
* **Infection Control & Assistant Reach:** When the dentist has contaminated surgical gloves, the dental assistant can reach across and tap the high-contrast `[ Finish Consult ]` button on the top island with a single mouse click.
* **Persistent Context:** The dentist can glance at the upcoming afternoon appointments while actively recording the current patient, eliminating mental friction about who is in the waiting room next.

### Axis 2: The "WOW" Factor & Willingness-to-Pay
* **Dynamic Surgery Island:** Replaces clunky medical forms with a modern, glassmorphic floating island inspired by high-end consumer hardware (Apple Dynamic Island / Tesla telemetry).
* **Organic Audio Pulse:** A responsive 32-bar neon-emerald frequency visualizer reacts in real time to the dentist's voice, giving visceral proof that ambient audio is being captured with studio clarity.
* **Live ADA & Tooth Chip Stream:** As the dentist examines teeth and calls out findings (*"Deep caries on 16 distal, let's prep for 2-surface composite 532"*), glowing chips (`#16 Distal`, `ADA 532`, `Composite`) pop up in real time on the bar.
* **Instant Value Demonstration:** When practice owners see clinical notes drafted with FDI two-digit numbering and ADA billing items ready for D4W at 5:00 PM with zero manual typing, the ROI is self-evident.

### Axis 3: Architectural Soundness & Failsafe Design
* **Single-Screen State Model:** All consultation states (`scheduled`, `recording`, `processing`, `ready`, `failed`) are rendered inside one persistent component tree. Zero view unmounting means zero loss of scroll position or UI state.
* **Smart Hash Fingerprinting:** Every appointment is hashed by `date + normalizeTime(time) + normalizeName(patientName)`. Midday snips automatically merge walk-ins without duplicating existing records or overwriting completed notes.
* **Local Audio Vault (IndexedDB):** Audio streams are saved directly into the browser's IndexedDB before network dispatch. Even if clinic Wi-Fi drops, the raw consult audio is 100% secure.
* **Background Worker Drain:** Background note jobs run on the durable `/api/notes/jobs` queue with exponential backoff and rate-limit recovery.

---

## 3. Data Architecture & Deduplication Engine

### 3.1 Composite Slot Fingerprinting
```ts
export function generateSlotFingerprint(date: string, time: string, patientName: string): string {
  const cleanDate = date.trim();
  const cleanTime = time.replace(/[^0-9:]/g, '').padStart(5, '0'); // e.g. "09:15"
  const cleanName = patientName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
  return `${cleanDate}_${cleanTime}_${cleanName}`;
}
```

### 3.2 The 3-Way Merge Algorithm (Mistake-Proofing)
When a new screenshot is pasted into an existing day schedule:
1. **Existing 'ready', 'processing', or 'recording' appointments:** Kept strictly immutable. Notes, timestamps, and active recordings are never overwritten.
2. **Existing 'scheduled' appointments:** If the new snip contains updated procedure notes for that slot, update the text while preserving appointment IDs.
3. **New slots:** Added chronologically with a temporary visual highlight (`+ Added from PMS`).
4. **Duplicate rows in same snip:** Deduplicated instantly during the Gemini vision parse step.

---

## 4. Component Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│ HistoryHub.tsx (Full Viewport)                                         │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ TopSurgeryBar.tsx (Sticky Top Island)                              │ │
│ │  [ ● LIVE: Sarah Connor • 09:15 ] [ ~~~ Waveform ~~~ ] [ Finish ✓ ]│ │
│ └────────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ DayScheduleQueue.tsx (Full-Width Timeline)                         │ │
│ │  • Snip & Paste Dropzone (Win+Shift+S -> Ctrl+V)                   │ │
│ │  • Running Day Metrics (9 Appointments • 7 Ready • $4,200 ROI)     │ │
│ │  • Chronological Appointment Cards:                                │ │
│ │    - 08:30 John Smith    [ Ready: Copy Note 📋 ]                   │ │
│ │    - 09:15 Sarah Connor  [ ● Recording Active in Surgery ]         │ │
│ │    - 10:00 David Miller  [ Writing Clinical Note... 🟡 ]          │ │
│ │    - 11:00 Emma Watson   [ Start Record 🎙️ ]                       │ │
│ └────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 5. End-of-Day "Cake Walk" Flow (5:00 PM)
* **Status Header:** Displays total consults completed and estimated ADA production.
* **1-Click Copy:** Each card contains an optimized button that copies the clean, AHPRA-compliant clinical progress note directly into the OS clipboard.
* **Visual Audit Checkmark:** Upon copying, the button flips to a solid green **`Copied to D4W ✓`**, visually checking off the dentist's day row by row.
