# Technical Specification: Operatory-to-Receptionist Handover Task Engine ("DentAI Tasks")

**Document Version:** 1.0.0  
**Status:** DRAFT FOR CLINICAL & ARCHITECTURAL REVIEW (No code changes committed)  
**Author:** Antigravity AI / DentAI Engineering  
**Scope:** Frontend Cockpit, Task Extraction Engine, Shared Types, REST Endpoints, Receptionist Export  

---

## Assumptions Surfaced

1. **Target User:** Chairside clinicians (Dentists, Oral Health Therapists, Dental Assistants) creating handovers, and Front Desk Receptionists / Practice Managers receiving actionable tasks.
2. **Extraction Input:** Primary clinical note text, structured consultation findings (`extractedVariables`), and transcript utterances.
3. **Execution Runtime:** Client-side deterministic extraction for instant chairside preview with zero latency + optional server-side persistence with composite consultation IDs.
4. **Toolchain & Runtime:** Bun runtime (`bun.lock`), React 19 + TypeScript, Tailwind CSS v4, Express 4 API backend, Vitest test suite (`--fileParallelism=false`).
5. **Zero Hallucination:** Tasks are strictly derived from spoken dialogue or explicit note contents; missing recall intervals, lab specifications, or medications are never synthesized.

---

## 1. Objective & Commercial Value

### 1.1 The Clinical Problem
In dental practices, the physical and operational divide between the **sterile operatory** and the **front desk reception** is the single greatest point of practice failure:
- **Dropped Recalls:** The dentist tells the patient *"We'll see you in 6 months for a clean and check"*, but reception only collects payment and fails to rebook.
- **Delayed Lab Slips:** Impressions or digital scans sit chairside; lab turnaround times (10–14 days) are missed, resulting in embarrassing crown try-in cancellations.
- **Post-Op Neglect:** Surgical extractions or implant placements lack documented post-operative follow-up calls, increasing dry socket complications and medicolegal exposure.
- **Prescription Ambiguity:** Scripts mentioned verbally are not clearly flagged for reception printing or pharmacist dispensing check.

### 1.2 Generic Medical Scribe Limitations & Dental Superiority
Legacy medical scribes detect generic medical follow-ups (tests, referrals, reviews). DentAI's Handover Task Engine leapfrogs generic medical tasking by tailoring specifically to the **dental operatory reality**:
1. **Lab Order Tracking:** Specific tracking of lab turnaround days, restoration type, tooth numbers (FDI), and shade.
2. **Post-Op Welfare Calls:** Auto-scheduled 24–48h follow-up phone calls based on surgical invasiveness (extractions, implants, surgical perio).
3. **Hygiene & Periodontal Recalls:** Tied to ADA prevention intervals (3-month perio vs 6-month preventive) with automated recall engine sync.
4. **Next Appointment Pre-Calculation:** Maps planned procedure to recommended appointment duration and chair requirements (e.g. 60 min for crown prep, 30 min for suture removal).
5. **1-Click "Copy for Reception" Clipboard:** Instantly copies an anti-jargon summary into practice messaging (Slack, Teams, WhatsApp, internal PMS messenger).

### 1.3 Monetization Impact
- **Team / Practice Plan Value Driver ($199–$299/mo):** Multi-chair clinics upgrade specifically to eliminate operatory-to-reception dropped balls.
- **Zero Receptionist Training:** Receptionists do not need to decipher dense clinical jargon or open doctor charts; they receive an actionable, clear checklist.

---

## 2. Clinical Task Taxonomy (The 5 Core Dental Task Categories)

Each task belongs to one of five mutually exclusive dental categories:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DENTAL HANDOVER TASKS                           │
├──────────────┬──────────────┬──────────────┬─────────────┬─────────────┤
│  LAB ORDERS  │ POST-OP CALL │ RECALL/BOOK  │ PRESCRIPTION│ REFERRAL    │
│  (Crown,     │ (24-48h check│ (Next visit, │ (Antibiotic,│ (Specialist,│
│   Denture,    │  on surgery, │  hygiene,    │  Analgesic, │  CBCT, OPG  │
│   Splint,     │  pain, dry   │  suture      │  Chlorhex-  │  radiology) │
│   Aligner)   │  socket)     │  removal)    │  idine)     │             │
└──────────────┴──────────────┴──────────────┴─────────────┴─────────────┘
```

1. **`lab_order` (Laboratory Fabrication & Turnaround):**
   - *Triggers:* Crown prep, bridge impression, aligner scan, night guard / splint impression, denture bite registration / try-in.
   - *Extracted Metadata:* Restoration type, tooth number(s), shade (if stated), required turnaround (default: 10 business days), lab name (if stated).
   - *Example:* `[Lab] Send digital scan for #16 Zirconia Crown to lab. Shade A2. Due in 10 days.`

2. **`post_op_call` (Patient Welfare & Post-Surgical Follow-up):**
   - *Triggers:* Surgical/simple extractions (ADA 311, 324), surgical endo, implant fixtures (ADA 661), bone grafting, periodontal flap surgery.
   - *Extracted Metadata:* Scheduled offset (e.g. `+1 day` / `+2 days`), risk factors (bleeding, suture care).
   - *Example:* `[Welfare Call] Call John tomorrow afternoon to check surgical extraction socket #48 & bleeding.`

3. **`appointment_booking` (Next Treatment Session / Recall Booking):**
   - *Triggers:* Stage 2 endodontics, crown insert, suture removal (7–10 days), routine 6-month hygiene, 3-month perio maintenance.
   - *Extracted Metadata:* Proposed procedure, target timeframe (`in 2 weeks`, `in 7-10 days`, `in 6 months`), recommended chair duration.
   - *Example:* `[Book Appointment] Book 60-min crown prep for #26 in 2-3 weeks.`

4. **`prescription` (Medication Dispensing / Script Issuance):**
   - *Triggers:* Spoken scripts for Amoxicillin, Augmentin Duo Forte, Clindamycin, Ibuprofen 600mg, Paracetamol/Codeine, Savacol/Chlorhexidine.
   - *Extracted Metadata:* Drug name, dosage, frequency, indication.
   - *Example:* `[Prescription] Issue script for Amoxicillin 500mg (21 caps, 1 tds for 7 days).`

5. **`specialist_referral` (External Referral & Imaging):**
   - *Triggers:* Oral surgeon (impacted 38/48, IV sedation), Endodontist (calcified canal), Periodontist (Stage III/IV perio), Orthodontist, or external CBCT/OPG imaging.
   - *Extracted Metadata:* Specialty discipline, provider name (if spoken), urgency.
   - *Example:* `[Referral] Generate specialist referral to Oral Surgeon for surgical removal of impacted #38 and #48 under IV sedation.`

---

## 3. Data Model & Architecture

### 3.1 Type Definitions (`src/types.ts`)

```typescript
export type HandoverTaskCategory =
  | 'lab_order'
  | 'post_op_call'
  | 'appointment_booking'
  | 'prescription'
  | 'specialist_referral';

export type HandoverTaskUrgency = 'urgent' | 'routine' | 'scheduled';

export type HandoverTaskStatus = 'pending' | 'in_progress' | 'completed' | 'dismissed';

export interface HandoverTask {
  /**
   * Composite Entity ID conforming to Rule 6: ${consultationId}-task-${key}
   */
  id: string;
  consultationId: string;
  patientId?: string;
  patientName: string;
  dentistId: string;
  clinicId?: string;
  
  category: HandoverTaskCategory;
  title: string;
  details: string;
  urgency: HandoverTaskUrgency;
  status: HandoverTaskStatus;
  
  // Specific metadata fields
  dueDateIso?: string;             // ISO date for due date or recall date
  dueTimeframeText?: string;       // Human label, e.g. "In 2 weeks", "Tomorrow 2:00 PM"
  targetTeeth?: string[];          // FDI numbers ['16', '26']
  chairTimeMinutes?: number;       // Recommended booking time (e.g. 60 min)
  
  // Provenance & Audit
  sourceSnippet?: string;          // Spoken phrase or note sentence that generated task
  createdAtIso: string;
  completedAtIso?: string;
  completedBy?: string;            // 'Reception - Sarah' or dentist
}

export interface ConsultationHandoverSummary {
  consultationId: string;
  patientName: string;
  patientId?: string;
  encounterDateIso: string;
  dentistName: string;
  tasks: HandoverTask[];
  receptionNotes?: string;
}
```

### 3.2 Composite Entity IDs (Rule 6 Compliance)
All task IDs are minted as:
```
`${consultationId}-task-${category.substring(0,3)}-${hash(title)}`
```
*Example:* `consult-1727821200000-task-lab-36crown`  
This guarantees $O(1)$ index targeting on the server during status toggles (`PATCH /api/tasks/:id`) without full table or JSON-file scans.

---

## 4. Task Extraction Engine (`src/lib/handoverTaskEngine.ts`)

### 4.1 Hybrid Deterministic Extraction Pipeline
To ensure sub-millisecond execution, zero token cost for basic chairside use, and zero hallucination risk (Rule 12), the engine operates via a **multi-stage deterministic parser**:

```
┌────────────────────────────────────────────────────────┐
│             CONSULTATION ARTIFACTS                     │
│  (Clinical Note Text + Extracted Variables + Dialogue) │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│         DETERMINISTIC REGEX & TRIGGER EVALUATION       │
│  - Lab keywords (impression, scan, shade, crown prep)  │
│  - Surgery keywords (ext, extraction, suture, socket)  │
│  - Booking keywords (review, recall, book, prep, next) │
│  - Script keywords (amox, augmentin, ibuprofen, mg)    │
│  - Referral keywords (refer, specialist, oms, perio)   │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│         CONTRAINDICATION & NEGATION FILTER (Rule 17)   │
│  - Suppress tasks if "cancelled", "refused", "no"      │
│  - Clamped calendar arithmetic for recall dates        │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│            STANDARDIZED HANDOVER TASKS                 │
│  - Composite IDs (${consultationId}-task-${k})         │
│  - Anti-jargon titles & receptionist-friendly notes    │
└────────────────────────────────────────────────────────┘
```

### 4.2 Negation & Contraindication Protection
Adhering to **Rule 17**: If the transcript states:
- *"Patient declined specialist referral to oral surgeon"* $\rightarrow$ Suppress referral task.
- *"No antibiotics needed today"* $\rightarrow$ Suppress prescription task.
- *"Postponing crown preparation until next year"* $\rightarrow$ Suppress immediate lab / prep booking.

---

## 5. UI/UX Specification

### 5.1 In-Cockpit Task Drawer / Card (`ClinicalNoteEditorPanel.tsx`)
Positioned directly beneath or adjacent to the Clinical Note textarea:

```
┌───────────────────────────────────────────────────────────────────────┐
│ 📋 Operatory Handover Tasks (3 actions detected)        [Copy for Front Desk]│
├───────────────────────────────────────────────────────────────────────┤
│ [✓] 🔬 LAB ORDER                                                      │
│     Zirconia Crown #36 (Shade A2) • Southern Cross Dental             │
│     Due: 15 Oct 2026 (10 business days)                               │
├───────────────────────────────────────────────────────────────────────┤
│ [ ] 📞 WELFARE CALL                                                   │
│     Post-Op Check on Extraction #48 • Call tomorrow afternoon         │
├───────────────────────────────────────────────────────────────────────┤
│ [ ] 📅 BOOK NEXT VISIT                                                │
│     Crown Insert #36 (30 mins) in 2 weeks                             │
├───────────────────────────────────────────────────────────────────────┤
│ + Add custom task...                                                  │
└───────────────────────────────────────────────────────────────────────┘
```

### 5.2 Interactive Controls
1. **Interactive Checkboxes:** Toggle task between `pending` and `completed` instantly with optimistic UI updates.
2. **One-Click "Copy for Reception" Button:**
   Formats a clean, anti-jargon handover snippet to the clipboard:
   ```text
   HANDOVER — Sarah Jenkins (Chair 1 • Dr. Vikram Darade)
   • [LAB] Send #36 scan to lab (Shade A2) — Due 15 Oct
   • [CALL] Call patient tomorrow PM to check socket #48
   • [BOOK] Schedule 30-min Crown Insert in 2 weeks
   ```
3. **Task Dismissal:** Clicking `✕` marks a task as `dismissed` with undo capability.
4. **Manual Task Insertion:** An inline input allowing the dental assistant or doctor to quickly type an ad-hoc action (e.g. `Take alginate impression for bleach trays`).

### 5.3 Dedicated Receptionist / Master Task View
A clean dedicated tab or modal view (`src/components/HandoverTasksHub.tsx`) accessible by front desk staff:
- Filter by: `Today's Tasks`, `Lab Orders Due`, `Pending Welfare Calls`, `Recall Bookings`.
- Group by Chair/Provider (`Chair 1 - Dr. Darade`, `Chair 2 - Dr. Sarah`).
- Direct action shortcuts: Click `[Call]` to open phone dialer/softphone protocol (`tel:...`); Click `[Mark Booked]` to resolve.

---

## 6. API & Storage Contract

### 6.1 Endpoints

| Method | Endpoint | Description | Guard / Security |
|---|---|---|---|
| `GET` | `/api/tasks/consultation/:consultationId` | Fetch all tasks for a specific consultation | `authenticateToken` + clinic tenancy |
| `GET` | `/api/tasks/active` | Fetch all pending handover tasks for the active clinic | `authenticateToken` + clinic tenancy filter |
| `PATCH` | `/api/tasks/:id` | Update task status (`completed`, `dismissed`, `notes`) | $O(1)$ composite ID parser (`${consultId}-task-*`) |
| `POST` | `/api/tasks/custom` | Append a manually entered chairside task | `authenticateToken` + schema validation |

### 6.2 Serverless & Persistence Compliance (Rules 1 & 2)
- **Vercel Safe:** In-memory caching wrapper around database tables/JSON files.
- **Fail Closed / EROFS Safe:** Writes to storage fail open to in-memory store if on a read-only serverless filesystem.
- **Cache Invalidation:** Calling `updateTaskStatus` invokes `invalidateDbCache()` to ensure fresh reads across worker threads.

---

## 7. Anti-Jargon Standard & Clinical Safety Compliance

Following **Rule 9 (Anti-Jargon Standard)**, user-facing copy strictly uses approved receptionist-friendly vocabulary:

| ❌ Banned / Confusing Term | ✅ Required Receptionist-Friendly Term |
|---|---|
| *Clinical consultation action items* | **Operatory Handover Tasks** |
| *SOAP / Structured extraction array* | **Front Desk Checklist** |
| *Prophylaxis / Perio debridement recall* | **Hygiene & Clean Booking** |
| *Exodontia post-op phoneline protocol* | **Post-Surgery Care Call** |
| *Prosthodontic lab dispatch ticket* | **Lab Order** |

---

## 8. Tech Stack & Commands

- **Language / Runtime:** TypeScript 5.8 / Node.js >= 22 / Bun runtime.
- **Package Manager:** `bun` (strictly using `bun.lock`).
- **Core Commands:**
  - Build: `bun run build`
  - Unit & Integration Tests: `bun test --fileParallelism=false`
  - Specific Suite: `bunx vitest run tests/handoverTaskEngine.test.ts --fileParallelism=false`
  - Lint & Typecheck: `bun run lint`

---

## 9. Boundaries

### 9.1 Always
- Use composite IDs prefixed with `${consultationId}` (Rule 6).
- Use clinic timezone utilities in `src/utils/date.ts` (`formatClinicDate`, `getClinicTodayIso`).
- Run `bun test --fileParallelism=false` before any commit.
- Suppress tasks if a clinical negation or patient refusal is present in the dialogue (Rule 17).

### 9.2 Ask First
- Modifying the core Postgres schema or migration tables for tasks.
- Adding any third-party npm dependencies for task scheduling.
- Altering the existing `TreatmentOpportunity` entity in `src/types.ts`.

### 9.3 Never
- Never synthesize unmentioned dental findings, lab orders, or medications (Rule 12).
- Never persist tasks generated from transient scratchpads (`chair-active`) before an immutable consultation ID is created (Rule 18).
- Never commit a `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml` (Rule 5).

---

## 10. Testing Strategy & Test Scenarios

### 10.1 Automated Test Suite (`tests/handoverTaskEngine.test.ts`)
1. **Extraction Accuracy:**
   - Detects crown lab order with tooth number, shade, and due date.
   - Detects extraction follow-up call scheduled for +1 day.
   - Detects recall booking (6-month preventive clean vs 3-month perio maintenance).
   - Detects medication script (Amoxicillin 500mg).
   - Detects specialist referral to oral surgeon.
2. **Negation & Contraindication Guard:**
   - Verifies that *"patient refuses specialist referral"* generates 0 referral tasks.
   - Verifies that *"no antibiotics required"* generates 0 prescription tasks.
3. **Composite ID Validation:**
   - Verifies that task IDs begin with `${consultationId}-task-`.
4. **Reception Clipboard Formatting:**
   - Verifies that `formatReceptionClipboardText` produces clean, plain-text copy without markdown errors or technical jargon.

---

## 11. Implementation Phase Breakdown (For Subsequent Execution)

```
┌────────────────────────────────────────────────────────┐
│ PHASE 1: Data Contracts & Pure Domain Engine           │
│ - Add HandoverTask types to `src/types.ts`             │
│ - Create `src/lib/handoverTaskEngine.ts`               │
│ - Author `tests/handoverTaskEngine.test.ts` (TDD)      │
├────────────────────────────────────────────────────────┤
│ PHASE 2: UI Cockpit Integration                        │
│ - Build `src/components/HandoverTasksPanel.tsx`        │
│ - Embed in `ClinicalNoteEditorPanel.tsx`               │
│ - Add 1-click "Copy for Front Desk" clipboard handler  │
├────────────────────────────────────────────────────────┤
│ PHASE 3: Server Endpoints & State Management           │
│ - Add task store handlers in `server.ts`               │
│ - Add status toggle endpoint (`PATCH /api/tasks/:id`)  │
│ - Verify test coverage & build check                   │
└────────────────────────────────────────────────────────┘
```

---

## 12. Success Criteria & Verification Checklist

- [ ] `handoverTaskEngine.ts` deterministically extracts all 5 task categories with 0 token latency.
- [ ] Negated clinical statements strictly suppress corresponding tasks.
- [ ] Task IDs conform to composite entity standard `${consultationId}-task-${key}`.
- [ ] Copy button outputs receptionist-friendly, anti-jargon plain text.
- [ ] Full Vitest suite passes with `bun test --fileParallelism=false`.
- [ ] Typecheck passes with `bun run lint` (`tsc -b --noEmit`).
- [ ] Production bundle builds cleanly with `bun run build`.

---

## 13. Open Questions for Human Review

1. **Placement in Cockpit:** Do you prefer the Handover Tasks card rendered directly **beneath the clinical note editor** in the right panel, or as an **expandable collapsible drawer**?
2. **Reception Notification:** Should completing a consultation automatically trigger an audio chime or badge indicator at the front desk view, or is clipboard copy to your existing practice messenger sufficient for v1?
