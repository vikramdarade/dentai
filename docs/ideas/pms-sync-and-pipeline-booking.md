# PMS 2-Way Sync & Pipeline Auto-Booking Bridge

## Problem Statement
How might we seamlessly bridge DentAI's detected treatment pipeline into confirmed chairside appointments without forcing front-desk staff to re-type clinical data or wrestling with closed, legacy on-premise Practice Management Systems?

## Recommended Direction
We recommend **Direction A: The "Pragmatic Bridge" (Cloud PMS Adapter + Smart Clipboard / Sidecar Bridge)**.

Rather than attempting hazardous direct database writes to on-premise legacy PMS databases (such as D4W's Firebird or EXACT's proprietary store)—which risk schema corruption, concurrency lockouts, and IT permission blockades—DentAI will implement a dual-tier strategy:

1. **Direct Cloud PMS Integration (API-First Tier):** For modern cloud PMS platforms (Cliniko, Core Practice, Dentrix Ascend), DentAI communicates via secure webhooks/REST APIs. When an opportunity is identified in DentAI, it provisions an itemized treatment draft or queries available booking slots, and listens for appointment booking events to transition opportunities from `unscheduled` $\rightarrow$ `booked` automatically.
2. **Universal Smart Clipboard & Sidecar Bridge (Legacy Desktop Tier):** For on-premise Windows desktop PMS software (Dental4Windows, Software of Excellence / EXACT, Best Practice), DentAI provides a 1-click formatted clipboard payload and lightweight helper overlay. When the receptionist selects an opportunity in DentAI, clicking "Push to PMS" formats the patient identifiers, FDI tooth numbers, ADA item codes (e.g., 613, 022), estimated duration, and clinical summary so it can be dropped into the PMS appointment dialog with zero re-typing.

Front-desk staff retain ultimate booking control, while DentAI records the `pmsAppointmentId` and timestamps to close the revenue loop in the ROI valuation engine.

## Key Assumptions to Validate
- [ ] **Assumption 1 (Workflow Friction):** Front-desk receptionists are willing to adopt a 1-click clipboard / sidecar payload to paste treatment codes rather than manually re-keying them from scribbled doctor notes.
  - *Validation strategy:* Conduct a timed test with 2 dental receptionists comparing manual entry of a 3-item treatment plan vs. DentAI's 1-click bridge.
- [ ] **Assumption 2 (Cloud PMS Webhook Reliability):** Cloud PMS APIs (e.g., Cliniko / Core Practice) expose sufficient appointment and patient metadata to match DentAI consultation records deterministically by patient name and phone number.
  - *Validation strategy:* Build a sandbox mock integration against Cliniko's public REST API testing appointment creation and webhook status receipt.
- [ ] **Assumption 3 (Closed-Loop Attribution):** Dentists and clinic owners value tracking the exact lag time between chairside treatment recommendation and front-desk booking confirmation.
  - *Validation strategy:* Verify with clinic owners whether measuring "Days to Book" and "Treatment Conversion %" on the ROI dashboard influences their follow-up protocol.

## MVP Scope
### What's In
- **Targeted Cloud PMS Adapter:** Built-in connector architecture supporting Cliniko REST API (patient search, treatment creation, appointment linking).
- **Universal Smart Clipboard Helper:** "1-Click PMS Export" action on each treatment opportunity in `TreatmentPipelineView.tsx` supporting:
  - Formatted text summary (Tooth, ADA code, Fee, Duration, Clinical notes).
  - Pre-structured tab-delimited/CSV payload suitable for fast keyboard pasting into D4W / EXACT appointment notes.
- **Closed-Loop Status Tracking:** Extend the `TreatmentOpportunity` schema to store:
  - `pmsType`: `'cliniko' | 'corepractice' | 'd4w' | 'exact' | 'manual'`
  - `pmsAppointmentId`: string identifier from PMS.
  - `bookedAt`: ISO timestamp.
- **Webhook Endpoint in `server.ts`:** `POST /api/webhooks/pms-booking` to receive booking confirmation events from external integrations and automatically transition opportunities to `booked`.

### What's Out
- Direct unauthorized ODBC/SQL writes into local on-premise Firebird/InterBase database files.
- Unsupervised autonomous AI patient booking without front-desk staff confirmation.
- Full two-way clinical charting sync (e.g., synchronizing full graphical odontograms back and forth).

## Not Doing (and Why)
- **Direct On-Premise Database Injection:** Attempting to inject rows into local D4W/EXACT `.fdb`/SQL databases without certified vendor SDKs risks corrupting clinic records, violating medical software warranties, and triggering security alarms.
- **Autonomous Outbound Patient SMS Bot for V1:** Clinic receptionists strongly prefer controlling doctor chair scheduling (managing doctor fatigue, procedure buffers, assistant availability). Removing human confirmation in V1 creates user resistance.
- **Custom Hardware / Virtual Print Drivers:** Over-complicates deployment. A web/browser extension clipboard bridge accomplishes 90% of the workflow value with 10% of the maintenance overhead.

## Open Questions
- What is the exact distribution of PMS systems among DentAI's initial cohort of dental practices (e.g., percentage on D4W vs. Core Practice vs. Cliniko)?
- Does the clinic require multi-provider allocation (e.g., associating an opportunity with a specific hygienist vs. principal dentist) when booking?
