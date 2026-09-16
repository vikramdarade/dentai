# DentAI Clinical Operating System: High-Availability, Medico-Legal & Dual-Cockpit (4-Slice) Implementation Plan

An exhaustive, production-grade technical implementation plan bridging **Dentist Chairside Ergonomics**, **Apple Medical-Grade Interface Standards**, **AHPRA Medico-Legal Defensibility**, **High-Availability Distributed Systems Architecture**, and a **Dual-Cockpit (Standard 3-Zone vs. 4-Slice Command Center) A/B Chairside Testing Architecture**.

This plan is strictly grounded in real-time findings from the codebase ([`server.ts`](../../server.ts), [`src/lib/db.ts`](../../src/lib/db.ts), [`src/lib/streamingSpeechClient.ts`](../../src/lib/streamingSpeechClient.ts), [`src/lib/dayScheduleStorage.ts`](../../src/lib/dayScheduleStorage.ts), [`src/components/CockpitLayout.tsx`](../../src/components/CockpitLayout.tsx), and `.agents/AGENTS.md`).

---

## Executive Architectural Alignment & Software Mission

The mission of DentAI is to be the **mission-critical clinical operating system and ambient intelligence backbone of the modern dental practice**. In a live dental surgery:
1. **The Physical Environment is Hostile**: High electromagnetic interference, lead-lined X-ray shielding causing Wi-Fi deadzones, deafening ultrasonic scalers (25–30 kHz) and high-speed air turbines (400,000 RPM, 75–85 dB), and latex/nitrile barrier film constraints.
2. **Clinical Margin for Error is Zero**: A missed Penicillin allergy, misplaced FDI tooth notation (e.g. 16 vs 26), or dropped patient safety alert can lead to catastrophic medical emergencies or litigation.
3. **Operations Demand Real-Time Rhythm**: A busy surgery operates on 15–30 minute turnarounds. Latency or synchronization collisions between the chairside surgery terminal and the front-desk reception lead to double-booked chairs, lost revenue, and clinician burnout.
4. **Legal Grounding is Non-Negotiable**: Under AHPRA, ADA, and HIPAA standards, clinical documentation must provide a tamper-evident, verifiable audit trail proving that generated notes faithfully reflect the spoken consultation.
5. **Human Factors Differ Across Practices**: Some dentists operate on 27" 4K operatory monitors mounted on ceiling articulation arms; others operate on 14" mobile laptop carts or 12.9" iPads. Providing an **A/B Operatory Layout Option** (Standard 3-Zone Cockpit vs. 4-Slice Command Center) allows the pilot dentists to evaluate real-world ergonomics under actual surgical lighting and loupe magnification.

Below is the concrete blueprint addressing every insight, requirement, and vulnerability identified across all iterations.

---

## Core Pillars Summary

> [!IMPORTANT]
> **Pillar 7: Dual-Cockpit A/B Architecture (Standard vs. 4-Slice Command Center)**
> Implement `OperatoryCommandCenter.tsx` as a dedicated, first-class screen presenting the 4-vertical-slice layout:
> - **Slice 1 (64px)**: Minimalist Apple Surgical Navigation Rail.
> - **Slice 2 (288px)**: Day Sheet Roster with high-contrast safety alerts and chair indicators.
> - **Slice 3 (260px)**: Day Recording Timeline, Session Durations, Schedule Drift Pace, and Audio Sync Telemetry.
> - **Slice 4 (Flexible ~900px+)**: Active Appointment Surgical Stage with ambient recording HUD, live speech stream, dental entity badges, SOAP note drafting, and 1-tap sign & PMS sync.
> A high-visibility Apple segmented pill (`[ Standard Cockpit | 4-Slice Command ]`) in the navigation rail and page header will allow pilot dentists to switch layouts instantly during chairside testing with shared real-time state.

> [!IMPORTANT]
> **Pillar 1: Zero-Loss Audio Ring Buffer & Auto-Burst Reconnection**
> To solve lead-lined surgery Wi-Fi drops, `streamingSpeechClient.ts` will implement monotonic sequence numbering on audio frames, automated exponential backoff reconnection, and an `audio_sync_burst` protocol replaying cached chunks from IndexedDB.

> [!IMPORTANT]
> **Pillar 2: Two-Stage Atomic File Engine with Serverless EROFS Resilience**
> `server.ts` `writeDb` (currently using raw `fs.writeFileSync`) will be upgraded to a write-to-temp (`${filePath}.tmp.${Date.now()}`) and atomic `fs.renameSync` pattern, backed by an in-memory write-through cache that gracefully catches `EROFS` on read-only serverless runtimes.

> [!IMPORTANT]
> **Pillar 3: Optimistic Concurrency Control (OCC) on Operatory Schedules**
> To eliminate write-write race conditions between chairside clinicians and front-desk receptionists, `/api/schedule` will enforce a monotonic integer `version` field and item-level dictionary patching instead of destructive array overwrites.

> [!IMPORTANT]
> **Pillar 4: Cryptographic SHA-256 Hash-Chained Audit Ledger**
> `server.ts` `logAudit` and `src/lib/db.ts` `dbAppendAudit` will establish a tamper-evident blockchain-style hash chain (`prevHash` + `currentHash = SHA256(...)`) for court-admissible non-repudiation.

> [!IMPORTANT]
> **Pillar 5: Dedicated Pipeline Store with Composite Entity IDs**
> Unscheduled treatment opportunities will be separated into a dedicated collection (`data/pipeline.json` / `treatment_opportunities`), using composite IDs (`${consultationId}-tx-${key}`) for O(1) point updates that do not mutate clinical charts.

> [!IMPORTANT]
> **Pillar 6: Centralized Practice Settings & Secrets Vault**
> Replace isolated browser `localStorage` API key storage with an AES-256-GCM encrypted server-side vault (`data/settings.json` / Postgres `practice_settings`), shared across all chairs in the clinic and accessible only to verified practice owners.

---

## Architectural Breakdown

### Pillar 7: Dual-Cockpit A/B Architecture (Standard vs. 4-Slice Command Center)

#### 7.1 Why (Clinical Ergonomics & Real-World Surgical Insights)
- **Insight 1: Optical Loupes & Focal Tunnel Vision**:
  - Dentists wear 2.5x to 5.0x magnification loupes while working in the oral cavity. Looking up from the mouth to an operatory screen 2 to 3 feet away requires rapid refocusing.
  - On compact 1080p laptop carts, a 4-slice layout can restrict the clinical note to under 750px width, causing drug dosages and anatomical tooth descriptions to wrap abruptly.
  - On larger 27" wall/ceiling mounted 4K surgical monitors, however, a 4-slice layout is **spectacular**: it provides simultaneous visibility into the day schedule, the live surgery progress, and the active chart without a single mouse click.
- **Insight 2: Touch Barrier Film & Glove Friction**:
  - Clinicians wear latex/nitrile gloves and monitors are covered with disposable clear barrier film. Fiddling with nested dropdowns or closing drawers with wet gloves contaminates the barrier.
  - Having both layouts available allows the clinic to test which layout minimizes touch interactions during a 30-patient day.
- **Insight 3: The Role of Slice 3 (Day Recording Timeline & Operatory Velocity)**:
  - Slice 3 provides the **"Surgery Pacemaker"**:
    * Displays each appointment of the day with audio status (Recorded, Transcribing, Signed, Pending).
    * Shows live schedule drift: `+8m Ahead of Schedule` (Green) or `-12m Behind` (Amber).
    * Displays audio streaming diagnostics: WebSocket status, frame count, and drop-rate telemetry.
    * Allows 1-click audio playback scrub for any previous patient without closing the active chart.

#### 7.2 What (Components & UI Contracts)
- **New File**: `src/components/OperatoryCommandCenter.tsx`
- **Modified File**: `src/components/CockpitLayout.tsx`
- **Modifications**:
  - Add `activeNav === 'command'` view state.
  - Add layout switcher pill in navigation rail and header.
  - Structure `OperatoryCommandCenter.tsx` with 4 dedicated vertical slices:
    * **Slice 1 (`w-16 shrink-0`)**: Surgical Icon Navigation Rail.
    * **Slice 2 (`w-72 shrink-0 border-r border-slate-200/90 bg-white`)**: Day Sheet Queue with structured chips (`[24] [MO] Resin`), crimson medical alerts (`bg-red-50 text-red-950`), and chair badges (`Chair 1`, `Chair 2`).
    * **Slice 3 (`w-64 shrink-0 border-r border-slate-200/90 bg-slate-50/50`)**: Operatory Timeline & Velocity Pulse. Displays session durations, recording timeline, schedule pace, and ambient audio status.
    * **Slice 4 (`flex-1 min-w-[640px] bg-slate-50 overflow-y-auto p-4`)**: Active Patient Surgical Stage. Floating Dynamic Island HUD, audio visualizer, real-time dental entity badges, SOAP note drafting, and $\ge 48\text{px}$ touch-friendly Sign button.

#### 7.3 How (Implementation Mechanics)
1. Build `src/components/OperatoryCommandCenter.tsx`:
   - Consume existing hooks: `useDaySchedule()`, `StreamingSpeechClient`, `consultations` state.
   - Synchronize selected patient between Slice 2 and Slice 4: clicking a patient in Slice 2 immediately populates Slice 4 with that patient's chart and starts/attaches the ambient session.
   - Render Slice 3 with real-time appointment metrics:
     * Completed notes vs remaining.
     * Elapsed consultation time (tabular figures `font-variant-numeric: tabular-nums`).
     * Real-time audio packet health indicator.
2. In `CockpitLayout.tsx`:
   - Add `command` navigation entry with `LayoutGrid` / `Columns4` icon.
   - When `cockpitMode === 'quad'`, mount `<OperatoryCommandCenter />`.
   - Persist user's preferred layout in `localStorage.getItem('dentai_cockpit_view_mode')`.

---

## File Changes Summary

| Action | File | Description |
| :--- | :--- | :--- |
| **[NEW]** | `src/components/OperatoryCommandCenter.tsx` | The dedicated 4-slice unified surgical command center screen for A/B testing. |
| **[MODIFY]** | `src/components/CockpitLayout.tsx` | Add navigation item & Apple segmented toggle for Standard vs. 4-Slice Command Center. |
| **[MODIFY]** | `server.ts` | Atomic writes, OCC schedule versioning, SHA-256 hash-chain audit, pipeline store, settings vault. |
| **[MODIFY]** | `src/lib/db.ts` | Postgres schema updates for schedule versions, hash-chained audit logs, and pipeline opportunities. |
| **[MODIFY]** | `src/lib/streamingSpeechClient.ts` | Monotonic frame sequence numbers, audio ring buffer, auto-reconnect, and burst recovery. |
| **[MODIFY]** | `src/lib/dayScheduleStorage.ts` | Track schedule version across sync calls for OCC conflict resolution. |
| **[MODIFY]** | `src/components/PracticeSettingsModal.tsx` | Connect API key storage to server-side encrypted vault instead of browser localStorage. |

---

## Verification Plan

### 1. Automated Tests (Vitest)
```bash
npx vitest run --fileParallelism=false tests/server.test.ts tests/pipeline.test.ts tests/daySchedule.test.ts tests/speechStreamServer.test.ts tests/clinicalTemplates.test.ts
```

### 2. End-to-End Tests (Playwright)
```bash
npx playwright test
```
- Verify all 36 existing tests pass.
- Add test verifying switching between Standard Cockpit and 4-Slice Command Center.
- Verify 4-Slice layout renders all 4 vertical columns with Apple Medical Light tokens and zero horizontal overflow.

### 3. Static Type Check
```bash
npm run lint
```
