# Intent & Technical Blueprint: Treatment Revenue & Practice Moat

**Status:** Confirmed & Approved  
**Strategic Category:** Defensible Product Moat & Commercial Profit Engine  
**Target Beneficiaries:** Practice Owners, Practice Coordinators / Front Desk, Solo Clinicians  

---

## 1. Executive Summary & Strategic Rationale

Ambient AI scribes that simply transcribe and format clinical notes are rapidly commoditizing. Large generic vendors (Heidi Health, Freed, Sunoh, Nabla) offer low-cost wrappers that capture general doctor-patient dialogue. 

However, general medical scribes have two fatal weaknesses in dentistry:
1. **Zero Domain Billing Intelligence:** They do not understand the Australian Dental Association (ADA) 3-digit item coding system, FDI tooth notation (11–48), tooth surfaces (MODBL), periodontal pocket sextants (BPE), or dental fee structures.
2. **They Are Operational Expenses, Not Profit Centers:** A scribe that only "saves typing time" is viewed by clinic owners as a cost center ($100–$150/mo overhead). In financial reviews or downturns, time-saving software is easily audited and canceled.

### The Moat Thesis: The Clinical-to-Revenue Operating Engine
In average dental practices, **35% to 50% of diagnosed treatment never gets booked chairside**. Patients state: *"I'll check with my health fund,"* *"I need to check my work schedule,"* or *"I'll think about it,"* and walk out after paying only for their routine clean. Front desk teams rarely have the time or clinical context to dig through dense narrative notes to identify and follow up on these high-value opportunities.

DentAI builds an unassailable moat by transforming from a passive scribe into an **Unscheduled Treatment Recovery Engine**:
- Captures ambient chairside consultation with zero typing friction.
- Automatically isolates deferred treatment proposals (e.g. Tooth 16 crown, Tooth 46 composite, Quadrant 3 root planing) and maps them to exact ADA item numbers and estimated dollar values.
- Arms the front desk / treatment coordinator with an **Unscheduled Treatment Pipeline** featuring **1-click clinically contextual follow-ups** (SMS/WhatsApp/email).
- Provides practice owners with a **Closed-Loop ROI Scorecard**: *"DentAI Cost: $149/mo → Booked Chair Production: $16,800/mo (112x ROI)"*.

**No practice owner ever cancels software that visibly prints a 100x cash return on their investment.**

---

## 2. Statement of Strategic Intent

- **Outcome:** Upgrade DentAI from an ambient scribe into a comprehensive Clinical-to-Revenue Intelligence Engine that extracts unscheduled dental treatment, quantifies production with localized ADA fee schedules, enables 1-click front-desk patient recovery, and proves 50x–100x financial ROI to clinic principals.
- **Primary Users:**
  1. *Dentists:* Ambient capture without administrative burden; clear clinical intent classification (`performed_today` vs. `proposed_unscheduled` vs. `monitoring_only`).
  2. *Practice Coordinators & Front Desk:* A dedicated pipeline tracking pending treatment dollars with 1-click tailored patient messaging that references the exact doctor and clinical rationale.
  3. *Clinic Owners & DSOs:* A transparent executive dashboard demonstrating recovered chair billings, treatment acceptance rates, and verifiable software ROI.
- **Why Now:**
  - Dental clinics face rising chair overheads, tighter patient discretionary spending, and front-desk staffing shortages.
  - Scribing tech is commoditizing; clinics will consolidate onto tools that directly impact their top-line practice revenue.
- **Success Criteria:**
  - Automatic extraction of proposed treatment items with >95% accuracy across common restorative, endodontic, crown/bridge, and perio procedures.
  - Accurate mapping to ADA item codes (e.g., 011, 114, 222, 531, 611) with customizable practice fee schedules.
  - Front-desk staff can dispatch a clinically contextual patient follow-up message in under 10 seconds.
  - Owner dashboard calculates exact closed-loop revenue from booked recall/treatment consultations.
- **Binding Constraints:**
  - Strict compliance with the Australian Privacy Principles (APP), Privacy Act 1988, and Spam Act 2003: messages must be staff-reviewed and 1-click dispatched rather than unmonitored mass-blasting.
  - Zero disruption to real-time ambient scribing performance or offline deterministic drafting.
- **Out of Scope (Immediate Phase):**
  - Building a native calendar scheduling engine (DentAI integrates with existing PMS appointment workflows and booking links).
  - High-risk autonomous clinical diagnosis without human doctor review.

---

## 3. Four-Pillar Moat Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CHAIRSIDE CONVERSATION                          │
│     "Dr: Tooth 16 has a cracked cusp under the amalgam, needs crown.   │
│      Pt: I'll think about it and check my health fund first."          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 PILLAR 1: DENTAL INTENT EXTRACTOR                      │
│  - Categorizes: Performed (011, 026) vs. Proposed/Unscheduled (611)    │
│  - Stamped with FDI Tooth: 16 | Condition: Cracked Cusp Amalgam        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 PILLAR 2: ADA VALUATION ENGINE                         │
│  - Maps Item 611 (Full Crown - Ceramic) -> Standard Fee: $1,650       │
│  - Maps Item 026 (Bitewings x2) -> Performed Fee: $95                  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 PILLAR 3: PRACTICE COORDINATOR PIPELINE                │
│  - Pipeline Status: Unscheduled ($1,650 Pending)                       │
│  - 1-Click Personalized Follow-Up Dispatch (SMS / Email)               │
│  - Contextual Patient Explainer: Why tooth 16 needs protection         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 PILLAR 4: CLOSED-LOOP OWNER ROI DASHBOARD              │
│  - Patient Books: $1,650 Chair Production Realized                     │
│  - Monthly Report: DentAI Cost $149 | Production Added $18,400 (123x)  │
└────────────────────────────────────────────────────────────────────────┘
```

---

### Pillar 1: Dental Clinical Intent & Entity Extractor

During note processing, the engine runs a dedicated secondary extraction pass to classify clinical items by state:

1. `performed_today`: Treatment rendered and completed during the session (e.g. 011 exam, 114 scale & clean, 026 bitewings). Pushes to day's billings.
2. `proposed_unscheduled`: Diagnosed treatment that was recommended but not scheduled today (e.g., tooth 16 crown, tooth 46 composite filling, nightguard 965).
3. `monitoring_watch`: Incipient lesions or conditions noted for future review (e.g., early enamel caries 25, 4mm pocket on 36, wear facet on 13). Pushes to recall interval.
4. `patient_declined`: Explicitly declined care (with documented informed refusal for compliance risk management).

---

### Pillar 2: ADA Fee Schedule & Valuation Engine

To prove financial ROI, clinical items must carry localized monetary value:
- **Baseline Fee Catalog:** Pre-seeded with the national Australian Dental Association (ADA) Fee Survey averages:
  - Diagnostic: Item 011 ($75), Item 022 ($48), Item 026 ($92)
  - Preventative / Perio: Item 114 ($145), Item 222 ($340 per quad)
  - Restorative: Item 531 ($220), Item 532 ($295), Item 533 ($360)
  - Crown & Bridge: Item 611 ($1,650), Item 613 ($1,850), Item 627 ($750)
  - Endodontics: Item 415 ($850), Item 417 ($420)
- **Practice Override:** Clinic owners can upload or adjust their custom fee schedule (e.g. Private, Bupa First, Medibank Members' Choice) in Practice Settings.

---

### Pillar 3: Practice Coordinator Treatment Pipeline

A dedicated role-based view for clinic managers, treatment coordinators, and front desk reception:

1. **Pipeline Metrics at a Glance:**
   - Total Unscheduled Opportunity Value (e.g. `$48,250`)
   - High-Priority Cases (Crowns, Endodontics, Implants, Quad Perio)
   - Follow-Ups Due Today
2. **Actionable Patient Cards:**
   - Patient Name & Contact
   - Diagnosing Clinician (e.g. `Dr. Emily Carter`)
   - Proposed Procedures & ADA Codes (e.g. `Tooth 16: Ceramic Crown [Item 611] — $1,650`)
   - Clinical Rationale Snippet (e.g. *"Large MOD amalgam with hairline lingual crack; at risk of coronal fracture without cuspal coverage."*)
   - Patient Concern Stated (e.g. *"Checking private health fund quote"*)
3. **1-Click Outreach Modal:**
   - Pre-formatted, clinically tailored SMS / WhatsApp / Email:
     > *"Hi Priya, following up on your visit with Dr. Carter on Wednesday. Dr. Carter recommended protecting tooth 16 with a ceramic crown to prevent the hairline crack from breaking into the nerve. We have reserved priority morning appointments with Dr. Carter next week. View your treatment plan summary here: [Link] or reply to book."*
   - Status updates automatically: `Pending` → `Contacted` → `Booked` → `Declined`.

---

### Pillar 4: Closed-Loop ROI & Owner Scorecard

The core driver of zero churn for practice owners:
- **Direct Financial Attribution:** When an unscheduled treatment or recall appointment is booked and completed, DentAI matches the consultation ID and logs the realized production.
- **The "No-Brainer" Dashboard Widget:**
  - **Monthly Subscription:** `$149.00`
  - **Unscheduled Treatment Booked:** `$18,350.00`
  - **Net Practice Production Multiple:** `123.1x ROI`
  - **Hours of Administration Saved:** `38.5 hours`
- **Audit & Compliance Safety:** Automatically attaches the informed consent discussion and reason for deferral to the permanent patient log, safeguarding the clinic against negligence claims.

---

## 4. Proposed Data Model & Schema Extensions

```typescript
// 1. Treatment Opportunity
export interface TreatmentOpportunity {
  id: string;
  consultationId: string;
  dentistId: string;
  clinicId: string;
  patientName: string;
  patientPhone?: string;
  patientEmail?: string;
  tooth?: string; // FDI e.g. "16"
  surfaces?: string[]; // e.g. ["M", "O", "D"]
  adaCode: string; // e.g. "611"
  procedureName: string; // e.g. "Full Crown - Ceramic"
  estimatedFee: number; // e.g. 1650
  clinicalReason: string; // e.g. "Hairline fracture under amalgam"
  patientBarrier?: string; // e.g. "Checking private health insurance"
  status: 'unscheduled' | 'contacted' | 'booked' | 'completed' | 'declined';
  lastContactedAt?: string;
  bookedAt?: string;
  createdAt: string;
}

// 2. Practice Fee Schedule
export interface AdaFeeEntry {
  adaCode: string;
  procedureName: string;
  category: 'diagnostic' | 'preventive' | 'perio' | 'restorative' | 'crown_bridge' | 'endo' | 'surgery';
  standardFee: number;
}

// 3. Practice ROI Summary
export interface PracticeRoiSummary {
  clinicId: string;
  month: string; // "2026-09"
  totalIdentifiedValue: number;
  totalBookedValue: number;
  totalCompletedValue: number;
  subscriptionCost: number;
  netRoiMultiple: number;
}
```

---

## 5. Phased Implementation Plan

| Phase | Milestone | Deliverables |
|---|---|---|
| **Phase 1** | **Entity & Valuation Engine** | Update note processing prompt to extract structured `proposedTreatments`; create default ADA fee table (`src/lib/adaFees.ts`); calculate consult treatment pipeline value. |
| **Phase 2** | **Practice Coordinator Pipeline UI** | Create `/pipeline` dashboard view with filtering (by dentist, value, age); build 1-click personalized message preview modal. |
| **Phase 3** | **Owner Closed-Loop Scorecard** | Implement ROI metrics card on clinic management page; record booking conversions and calculate production multiple. |
| **Phase 4** | **PMS Sync & Webhooks** | Add CSV/JSON PMS import/export for Dental4Windows, Exact, and Core Practice to ingest treatment plan statuses automatically. |

---

## 6. Verification & Quality Gates

1. **Extraction Accuracy:** Regression tests on synthetic transcripts to verify 0% hallucination of treatment proposals when a procedure is only mentioned in passing or explicitly rejected.
2. **Fee Schedule Calculation:** Unit tests verifying accurate fee roll-ups across multi-tooth and multi-surface proposals.
3. **Data Protection:** Ensure all patient identifiers and treatment pipeline records remain strictly scoped to authenticated clinic members, respecting practice-level data isolation.
