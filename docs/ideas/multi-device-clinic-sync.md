# Multi-Device, Multi-Clinic Cloud Scheduling Fabric

## Problem Statement
How might we allow receptionists to broadcast multi-column PMS appointment books to multiple dentist operatory chairs simultaneously, while providing locum and multi-clinic practitioners with a unified, conflict-free schedule across all their devices and practice locations?

---

## Architecture & Data Model

### 1. Granular Composite Key & Partitioning
Instead of a single monolithic schedule dictionary, schedules are stored as partitioned records with clean tenant and practice isolation:
- **Entity**: `ClinicScheduleSlot`
- **Composite ID**: `${clinicId}:${dentistId}:${date}:${slotTime}`
- **Storage Layer**:
  - PostgreSQL table: `clinic_schedules (id UUID, clinic_id UUID, dentist_id UUID, schedule_date DATE, items JSONB, updated_at TIMESTAMP, version INT)`
  - Direct indexes: `(dentist_id, schedule_date)` for Unified Dentist Feeds, and `(clinic_id, schedule_date)` for Reception Broadcasts.
  - Vercel KV / In-memory fallback: partitioned keys `dentai:schedule:${dentistId}:${clinicId}:${date}`.

### 2. The 3 Core Personas & Workflows

```
   [Receptionist Desktop]                  [DentAI Cloud API]                  [Chairside Mobile / iPad]
             │                                     │                                      │
  (Snips multi-column D4W)                         │                                      │
             ├─── POST /api/schedule/broadcast ───►│                                      │
             │    { clinicId, columns: [...] }     │                                      │
             │                                     ├── Stores partitioned slots           │
             │                                     │                                      │
             │                                     │◄── GET /api/schedule?date=... ───────┤
             │                                     │    (Unified cross-clinic feed)       │
             │                                     ├──► Returns slots with clinic tags ───┤
             │                                     │                                      │
             │                                     │◄── PUT /api/schedule (walk-in added) ┤
             │◄── Polling / SSE Delta Update ──────┼─── Hash-merged without note conflict─┘
```

1. **Reception Broadcast (`POST /api/schedule/broadcast`)**:
   - Takes a multi-column screenshot of the morning PMS appointment book (Dental4Windows, EXACT, Core Practice).
   - Gemini Vision OCR extracts distinct columns for each provider (`Dr. Chen`, `Dr. Miller`, `Sarah (Hygiene)`).
   - Maps column headers to registered `clinicMembers` within that clinic.
   - Atomically updates queues for all doctors working that day at the clinic in one operation.

2. **Dentist Unified Inbox (`GET /api/schedule?date=YYYY-MM-DD`)**:
   - Aggregates appointments across all practices the practitioner belongs to (e.g. Bondi Practice on Mon/Tue and Chatswood on Thu/Fri).
   - Color-coded badges on cards: `Bondi Dental • Chair 1` or `Chatswood Specialist • Surgery 2`.
   - Locum clinicians never need to sign in and out of different clinic accounts.

3. **Chairside Autonomy (`PUT /api/schedule`)**:
   - Dentists can add emergency walk-in patients or alter appointments directly on their phone or tablet chairside.
   - **3-Way Smart Hash Merge** reconciles local state with server state without overwriting in-progress voice recordings or completed clinical notes.
   - Optimistic timestamp and version check prevents stale desktop overwrites.

---

## Key Assumptions & Risk Validation

1. **Assumption: Provider Header Readability in PMS**:
   - *Risk*: PMS columns might abbreviate doctor names (e.g., `DOC1`, `SURG_A`, `VD`).
   - *Validation*: A 1-time Column Mapping Dialog where the receptionist maps column headers to clinic dentists; mappings are saved in `clinics.json` for future zero-touch snips.

2. **Assumption: Cross-Clinic Privacy Isolation (AHPRA / Privacy Act Invariant)**:
   - *Risk*: Practice A's receptionist must never see patient names or notes from Practice B.
   - *Validation*: Clinic-scoped API endpoints (`/api/clinics/:id/schedule`) only return records belonging strictly to that `clinicId`. The Unified View is only accessible to the authenticated dentist on their personal devices.

3. **Assumption: Operatory Offline Race Conditions**:
   - *Risk*: Chairside mobile reconnecting after working in a lead-shielded X-ray operatory might overwrite reception modifications.
   - *Validation*: Terminal invariants in the 3-Way Hash Merge treat `ready`, `recording`, and `processing` states as authoritative, ensuring clinical notes are never erased by schedule adjustments.

---

## MVP Scope (Phased Delivery)

### Phase 1 (Completed):
- [x] Single-practitioner cloud persistence (`GET /api/schedule`, `PUT /api/schedule`, `DELETE /api/schedule`).
- [x] Offline-first background synchronization (`saveTodaySchedule` triggers async cloud replication).
- [x] Cross-device 3-way smart hash merge (`generateSlotFingerprint`).
- [x] Visual cloud sync status badges in cockpit header (`Cloud Syncing...` / `Multi-Device Synced`).
- [x] 100% test coverage across 17 test suites (203 tests passing).

### Phase 2 (Multi-Clinic & Broadcast):
- [ ] Add `clinicId` query param and scoping to schedule endpoints.
- [ ] Multi-column Vision OCR dispatch endpoint (`POST /api/schedule/broadcast`).
- [ ] Unified multi-clinic timeline toggle in `DayScheduleQueue.tsx` with practice color badges.
- [ ] Optimistic lock version counter to prevent race conditions between desktop reception and chairside mobile.

---

## Not Doing (Deliberate Non-Goals)

1. **Direct Bi-directional PMS API Integration (D4W / EXACT / Core Practice)**:
   - *Why*: Proprietary PMS write APIs require expensive vendor certs, months of lock-in negotiations, and site-specific server agents. DentAI's Vision Snip + 1-Click Clipboard handoff remains 100% zero-install and PMS-agnostic.
2. **Staff Shift & Roster Management**:
   - *Why*: DentAI is an ambient AI scribe and unbooked treatment recovery engine, not a staff HR payroll or shift scheduling tool.
3. **Patient Direct Self-Booking Portal**:
   - *Why*: Patients book through practice websites or PMS portals. DentAI synchronizes the operational schedule for clinicians once booked.

---

## Open Questions for Practice Stakeholders
- Should practice receptionists have a dedicated "Broadcast Dashboard" tab to monitor note completion status across all 5 operatory chairs in real time?
- When a locum dentist works at two clinics on the same day, should travel buffer times be automatically highlighted between appointments?
