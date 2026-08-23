# Product Intent: Custom Clinic Template Matching & 1-Click PMS Smart Copy

## Executive Summary
Dentists currently spend 5–10 minutes per patient manually filling out standardized clinic typing templates in their Practice Management Systems (PMS) like Dental4Windows, Dentrix, EXACT, or Cliniko. Across a 10-dentist clinic seeing 150 patients daily, this represents 15–25 hours of lost clinical productivity every single day.

DentAI’s monetization wedge is to eliminate this manual documentation friction completely by adapting directly to the clinic's existing note templates and generating 1-click PMS-formatted clipboard copies with automated ADA billing item codes.

---

## Target Personas
1. **Clinic Owners / Principal Dentists**: Seeking standardized documentation quality, reduced staff burnout, and accurate insurance billing item code capture.
2. **Associate Dentists**: Seeing 12–20 patients/day, wanting to leave the clinic on time without 1–2 hours of evening charting backlog.

---

## Core Feature Scope

### 1. Custom Clinic Template Manager
- Allows clinics and practitioners to choose from standardized dental documentation formats or create custom templates:
  - **Standard Comprehensive (AHPRA / ADA 8-Point)**: Chief Complaint, History, Extra/Intra-oral, Periodontal, Radiographic, Diagnosis, Treatment, Next Visit.
  - **SOAP Format**: Subjective, Objective, Assessment, Plan.
  - **Restorative & Endo Focus**: Tooth, Pre-op, Caries/Pulp status, Material, Shade, Isolation, Post-op instructions.
  - **Custom Practice Template**: User defines custom section headings matching their existing practice macros.

### 2. Automated ADA Billing Item Code Extraction
- In addition to clinical prose, DentAI automatically maps conversation cues into standard ADA item numbers:
  - Diagnostic: `011` (Comp Exam), `012` (Periodic Exam), `013` (Emergency Exam), `022` (Intraoral periapical radiograph), `026` (Bitewing).
  - Preventive: `111` (Prophylaxis), `114` (Calculus removal), `121` (Fluoride).
  - Restorative: `511/512/513` (Direct composite restorations), `572` (Crown prep).
  - Endodontics: `411` (Pulp capping), `414` (Extirpation of pulp).

### 3. 1-Click PMS-Ready Smart Copy
- Dedicated single-click action formatted specifically for paste into Dental4Windows / Dentrix / EXACT / Cliniko note boxes.
- Clean plain-text formatting with clear section separators, tooth numbers, and itemized billing summaries.
- Visual toast feedback (`"Copied in Dental4Windows format!"`).

---

## Out of Scope (Initial Phase)
- Direct 2-way database read/write hooks into on-prem PMS databases.
- Automated health insurance clearinghouse direct-submission APIs.
