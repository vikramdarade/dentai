# DentAI Product Requirements Document (PRD)
## Autonomous Dental Operating System (SF-OS)

**Document Status:** Approved & Baseline  
**Version:** 2.0.0  
**Target Release:** Q4 2026  
**Author:** DentAI Product & Engineering Team  
**Architecture Reference:** [`docs/architecture/solo-founder-operating-system.md`](file:///c:/Users/swati/Downloads/dentai/docs/architecture/solo-founder-operating-system.md)  
**Decisions Reference:** [`docs/decisions/`](file:///c:/Users/swati/Downloads/dentai/docs/decisions/)

---

## 1. Executive Summary & Product Vision

### 1.1 The Core Problem
Private dental practices operate under intense clinical, physical, and temporal pressure. Associate dentists see 15 to 25 patients per day, with turnaround intervals under 3 minutes between procedures. Dental charting in legacy Practice Management Systems (PMS) like Dental4Windows (D4W), EXACT, Dentrix, and Eaglesoft requires dense clicking, tooth-by-tooth charting, and manual narrative typing.

This yields two systemic failures:
1. **Clinician Burnout ("Pajama Time"):** Dentists sacrifice 60 to 90 minutes every evening completing clinical notes at home, leading to chronic turnover and medical note omissions.
2. **Lost Restorative Revenue:** Under cognitive and scheduling pressure, dentists fail to document secondary incidental findings (e.g., microleakage on tooth 16, hairline cusp fractures, incipient interproximal caries), leaving an estimated **$14,200 AUD per chair per month** in unbooked treatment unpresented.

Existing medical AI scribes fail in dental operatories because they require cumbersome desktop installers (`.exe`/`.msi`) blocked by corporate clinic IT, demanding multi-step wizards, intrusive UI overlays, or top-down enterprise procurement cycles.

### 1.2 The Product Vision
**DentAI** is the **zero-disturbance ambient clinical operating system** designed for modern dental surgeries. Operating entirely inside standard web browsers (`app.dentai.com`) with zero IT install requirements, DentAI listens passively to the dentist-patient conversation, synthesizes bulletproof AHPRA/ADA-compliant clinical SOAP progress notes, extracts actionable reception handoff slips, and detects unbooked restorative opportunities.

DentAI is built from the ground up to be operated by a **100% autonomous solo founder**, where product acquisition, customer onboarding, hardware troubleshooting, customer support, and billing are fully automated into code.

---

## 2. User Personas & Journey Maps

### 2.1 Primary Personas

| Persona | Role | Key Frustrations | Primary Job-to-be-Done | Success Metric |
| :--- | :--- | :--- | :--- | :--- |
| **Dr. Alex Vance** | Associate Dentist (Private Clinic) | Evening charting debt; glove contamination; clicking through 40+ dropdowns in D4W. | Capture clinical conversations without touching the keyboard; leave the clinic at 5:01 PM with zero uncompleted charts. | < 120 seconds total daily screen time; 100% chart sign-off by 5:05 PM. |
| **Sam Rivera** | Dental Assistant / Nurse | Constant chair turnover; missing lab slips; unclear billing items communicated to reception. | Fast 1-click consultation triggers; automated front desk action manifests. | Zero reception callbacks regarding billing codes or appointment durations. |
| **Dr. Vikram Patel** | Practice Owner / Principal Dentist | Associate turnover; downcoded insurance items; unbooked treatment plans leaking out of hygiene cleanings. | Practice-wide revenue velocity; standardized legal compliance; frictionless practice onboarding. | +$14k/mo unbooked restorative treatment surfaced per operatory. |
| **System Operator** | Solo SaaS Founder | Time spent on manual onboarding, tier provisioning, basic hardware debugging, and support inquiries. | Build an indestructible, self-healing, self-monetizing SaaS product that scales to 1,000+ operatories with zero support staff. | < 0.01 manual support tickets per user per month. |

### 2.2 The "Day in the Life" Workflow

```
08:25 AM                    08:30 AM - 05:00 PM             05:01 PM
MORNING SCHEDULE IMPORT      ZERO-DISTURBANCE SURGERY        SPEED REVIEW BATCH CLEARANCE
┌───────────────────────┐   ┌───────────────────────────┐   ┌───────────────────────────┐
│ • Win+Shift+S D4W Roster│   │ • 28px Ghost Micro-Pill   │   │ • 1-Click [Sign All &     │
│ • Paste into DentAI   │──▶│ • Voice: "Deep caries 16" │──▶│   Push to EHR]            │
│ • Deterministic Hash  │   │ • Auto-detected ADA codes │   │ • Front Desk Cross-Docking│
│   Deduplication       │   │ • F12 Instant Paste       │   │ • "Clean Slate" 5:01 PM   │
└───────────────────────┘   └───────────────────────────┘   └───────────────────────────┘
```

1. **Morning Ingestion (08:25 AM):** The assistant snaps a screenshot of the day's PMS schedule (`Win+Shift+S`) and presses `Ctrl+V` into DentAI. DentAI's vision model extracts the patient roster, slot times, and procedure intents, persisting them directly to the Neon PostgreSQL schedule store. Midday walk-ins or changes are accommodated via the `+ Walk-In` modal or repasted with deterministic slot fingerprinting.
2. **Chairside Surgery (08:30 AM - 05:00 PM):**
   - The dentist opens the **28px Ghost Micro-Pill** at the top edge of the monitor or scans the operatory QR code using `PhoneBeaconMode` for studio-grade beamforming microphone capture.
   - Global keyboard shortcuts (`Spacebar` to pause, `Alt+C` to toggle view, `F12` to copy) allow hands-free or one-touch operation.
   - The ambient audio engine filters out high-speed handpiece whining, suction gurgles, and ultrasonic scaler noise, capturing clinical findings in real time.
3. **Reception Handoff:** Upon consultation completion, DentAI instantly generates a 3-item Front Desk Handoff Slip (ADA billing codes, next recall interval, lab prescription) accessible via a lightweight local URL, eliminating checkout discrepancies.
4. **Speed Review Batch Clearance (05:01 PM):** The clinician opens the `SpeedReviewStrip`, validates the day's notes in seconds, taps **`[Sign All & Push to EHR]`**, and leaves the operatory on time with zero homework.

---

## 3. Product Architecture & Technical Foundations

### 3.1 Web-Only Zero-Admin Trojan Horse Model
To achieve instant Day-1 viral penetration without triggering corporate IT security reviews:
- **No Native Installers:** Zero `.exe` or `.msi` desktop binaries.
- **No Mandatory Browser Extensions:** No dependencies on Chrome Web Store approvals or enterprise group policies.
- **Pure Web Standards:** Operates on standard HTML5 WebAudio, WebSockets, Clipboard API, and Neon Serverless Database over HTTPS.

### 3.2 System Topology

```
┌────────────────────────────────────────────────────────────────────────┐
│                          CLIENT FRONTEND (Vite / React)                │
│ ┌──────────────────────┐ ┌────────────────────┐ ┌────────────────────┐ │
│ │ SidebarDockMode.tsx  │ │ SpeedReviewStrip   │ │ DayScheduleQueue   │ │
│ │ (28px Ghost Pill)    │ │ (5:01 PM Batch)    │ │ (Dynamic Neon Roster│ │
│ └──────────┬───────────┘ └─────────┬──────────┘ └──────────┬─────────┘ │
│            │                       │                       │           │
│            ▼                       ▼                       ▼           │
│   WebAudio DSP Engine    IndexedDB Audio Vault    Navigator Clipboard  │
└────────────┬───────────────────────────────────────────────┬───────────┘
             │ WebSocket / HTTPS                             │
             ▼                                               ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   SERVERLESS BACKEND (Node / Express / Vercel)         │
│ ┌──────────────────────┐ ┌────────────────────┐ ┌────────────────────┐ │
│ │ Stateless Auth (HMAC)│ │ Gemini Note Fabric │ │ Stripe Webhook Hub │ │
│ └──────────┬───────────┘ └─────────┬──────────┘ └──────────┬─────────┘ │
│            │                       │                       │           │
│            ▼                       ▼                       ▼           │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │        Neon PostgreSQL Database (Stateless Serverless Pool)        │ │
│ │        • schedules  • consultations  • clinics  • audit_logs       │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │        In-Memory Read-Through / Write-Through Fallback Cache       │ │
│ └────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Functional Requirements & The 5 Autonomous Milestones

### Milestone 1: Automated Stripe Self-Service Billing & Customer Portal
*Requirement: Eliminate 100% of billing, invoicing, upgrade, and seat-management support.*

- **FR-1.1 Pricing Architecture:**
  - **Solo Chair Wedge (Free):** 1 operatory, basic SOAP note transcription, manual clipboard copy.
  - **Clinic Pro Tier ($199 AUD/mo):** Up to 3 chairs, 5:01 PM Speed Review Strip, reception handoff manifests, custom tooth notation formats (FDI/Universal).
  - **Enterprise DSO Tier ($499 AUD/mo):** Unlimited chairs, cross-chair schedule aggregation, unbooked treatment analytics, automated nightly backup escrow.
- **FR-1.2 Zero-Touch Checkout:** 
  - Direct checkout sessions initialized via `POST /api/billing/create-checkout`.
  - Stripe webhook listener `POST /api/billing/webhook` handles `checkout.session.completed`, `invoice.payment_succeeded`, and `customer.subscription.deleted`.
- **FR-1.3 Stripe Customer Portal:**
  - One-click navigation to `POST /api/billing/portal` allowing practice managers to update payment methods, add operatory seats, or download tax invoices autonomously.
- **FR-1.4 Feature Gating:**
  - In-memory and database-backed entitlement resolution (`hasActiveSubscription(clinicId)`), instantly unlocking premium UI modules without app reloading.

### Milestone 2: Autonomous In-App Hardware Diagnostic Self-Healer & Sterile Audio Engine
*Requirement: Eliminate 95% of audio device, microphone permission, and clipboard copy support tickets while upholding strict AHPRA/ADA infection control.*

- **FR-2.1 Two-Tier Sterile Audio Pipeline:**
  - **Tier 1 (Default):** Zero-click pure ambient desktop capture via PC built-in mic or permanent $29 USB boundary mic under monitor bezel. Fully wipeable with hospital-grade disinfectant wipes; zero smartphone involvement.
  - **Tier 2 (Surgical / Pro):** Direct Bluetooth 5.2+ wireless headset / loupe earpiece pairing to the operatory PC for noisy crown preps and high-speed suction, boosting SNR by >20dB.
  - **Emergency Rescue:** QR mobile pairing (`PhoneBeaconMode`) relegated to an unprompted fallback utility in advanced diagnostic settings.
- **FR-2.2 Client Diagnostic Engine (`DiagnosticAssistant.tsx`):**
  - **Microphone Health & Device Switching:** Auto-detects audio device transitions via `navigator.mediaDevices.ondevicechange`, monitors sample rates (16kHz vs 48kHz), and displays real-time RMS input metering.
  - **Clipboard Permissions:** Tests `navigator.clipboard.writeText` access on mount to guarantee that `F12` PMS pasting will succeed without security popups.
  - **Network Latency:** Measures continuous round-trip ping to the serverless API endpoint, alerting if latency exceeds 800ms.
- **FR-2.3 1-Click Hardware Self-Heal:**
  - Automated remediation action: closes hung `AudioContext` instances, clears stuck WebAudio buffers, flushes local IndexedDB caches, and re-initializes desktop/Bluetooth audio input.

### Milestone 3: Autonomous Clinical AI Concierge (In-App Support Bot)
*Requirement: Provide real-time clinical guidance, item-code resolution, and PMS workflow support without human intervention.*

- **FR-3.1 Embedded Dental Knowledge Base:**
  - Pre-prompted with Australian Dental Association (ADA) Schedule of Dental Services, AHPRA dental record-keeping compliance codes, and major PMS clipboard macro guides (D4W, EXACT, Dentrix, Praktika).
- **FR-3.2 Context-Aware Resolution:**
  - Detects current screen context (e.g. if a user is in `SpeedReviewStrip`, answers prioritize batch-signing questions; if in `DiagnosticAssistant`, answers prioritize audio input selection and Bluetooth headset pairing).
- **FR-3.3 Automated Escalation Protocol:**
  - Generates founder alert summaries only when an unhandled server exception or critical data error is detected, categorizing the issue with full client diagnostic telemetry.

### Milestone 4: Zero-CAC Viral Gifting & Referral Flywheels
*Requirement: Power organic chair-to-chair practice expansion driven by clinical peer advocacy.*

- **FR-4.1 Chair-to-Chair 1-Click Gifting:**
  - Associate in Chair 1 can trigger `[Gift Chair 2 a 30-Day Pass]` directly from `SidebarDockMode.tsx`.
  - Generates a single-use tokenized onboarding link (`app.dentai.com/join?gift=CHAIR2-XYZ`).
- **FR-4.2 Operatory Intercom Activation:**
  - When 2 or more chairs are active in the same practice, the shared schedule queue and operatory intercom automatically unlock, creating immediate team lock-in.
- **FR-4.3 Lost Treatment Recovery Audit (Owner Magnet):**
  - Automated monthly generation of the **Practice Treatment Velocity Report**, calculating the dollar value of restorative treatment (CDT/ADA item codes) identified during examinations that remains unbooked in the PMS schedule.

### Milestone 5: Multi-Tenant Neon Isolation & Diligence-Ready Backup Escrow
*Requirement: Ensure bulletproof enterprise data isolation, regulatory compliance, and legal diligence readiness.*

- **FR-5.1 Compound Tenant Isolation:**
  - All database tables (`schedules`, `consultations`, `note_jobs`, `clinics`) are indexed and queried with compound keys `(clinic_id, dentist_id)`.
  - Stateless HMAC session tokens encode tenant boundaries, preventing cross-tenant data leaks across ephemeral serverless containers.
- **FR-5.2 Automated Backup Escrow Engine:**
  - Nightly scheduled export daemon dumps database state into AES-256 encrypted archive packages stored in Cloudflare R2 / AWS S3.
- **FR-5.3 1-Click Clinic Data Portability:**
  - Clinic owners can download their complete clinic archive (JSON + formatted PDF progress notes) with one click from Practice Settings, meeting legal health record portability requirements.

---

## 5. Non-Functional Requirements (NFRs)

### 5.1 Ergonomics & Screen Time Budget
- **NFR-1.1 Total Daily Screen Time:** An active clinician must spend **less than 120 seconds** total interacting with DentAI across a standard 18-patient clinical day.
- **NFR-1.2 Zero-Click Audio Capture:** Automatic silence detection, push-to-talk, and global keyboard hotkeys (`Spacebar`, `Alt+C`, `F12`) must operate without requiring cursor focus on the input box.

### 5.2 Latency & Performance
- **NFR-2.1 Clipboard Transfer Latency:** Copying notes to the OS clipboard via `F12` or click must execute in **< 10ms**.
- **NFR-2.2 Note Synthesis Latency:** Background SOAP note generation must complete in **< 3.5 seconds** from the moment `[ Finish Consult ]` is triggered.
- **NFR-2.3 Visual Smoothness:** Audio waveform and frequency visualizers must sustain **60 frames per second** with < 2% CPU overhead.

### 5.3 Reliability & Offline Resilience
- **NFR-3.1 Serverless Read-Only Filesystem Resilience:** All local filesystem writes (`data/db.json`) must be wrapped with read-through/write-through in-memory caching to guarantee zero `EROFS` exceptions on serverless environments.
- **NFR-3.2 Local Audio Vaulting:** Raw audio chunks must be persisted in client IndexedDB prior to server transmission, guaranteeing zero audio loss during clinic Wi-Fi drops.
- **NFR-3.3 Idempotent Background Job Drain:** Note generation jobs on the durable queue must support automatic retry with exponential backoff for up to 5 attempts upon API rate-limiting.

### 5.4 Privacy, Security & Compliance
- **NFR-4.1 Regulatory Adherence:** Architecture complies with AHPRA Guidelines for Dental Records, ADA Schedule of Dental Services, Australian Privacy Principles (APP / Privacy Act 1988), and HIPAA/HITECH security rules.
- **NFR-4.2 Zero-Retention LLM Ingestion:** Clinical prompts dispatched to LLM providers (Google Gemini / Anthropic Claude) must utilize zero-data-retention, enterprise-grade endpoints where audio and clinical text are never used for model training.
- **NFR-4.3 Cryptographic Audit Trail:** Every consultation note generation, revision, and clipboard transfer must log an immutable audit entry with timestamp, dentist ID, and SHA-256 hash.

---

## 6. Success Metrics & Key Performance Indicators (KPIs)

| Metric | Target | Verification Method |
| :--- | :--- | :--- |
| **Clinician Daily Screen Time** | < 120s / day | Telemetry tracking UI focus duration & interaction events |
| **5:01 PM Chart Clearance Rate** | > 95% of active clinics | Nightly database aggregation of signed vs. open charts |
| **Founder Support Overhead** | < 1 hour / month | Zendesk / Crisp support ticket count & escalation log |
| **Trojan Horse Viral K-Factor** | > 1.25 | Ratio of Chair 1 users who successfully invite Chair 2 |
| **Pipelined Treatment Recovery** | > $10,000 AUD/chair/mo | Aggregated ADA billing opportunities surfaced vs. PMS intake |
| **System Uptime & Job Reliability** | 99.95% (<0.05% error rate) | Automated heartbeat telemetry & error rate sentry |

---

## 7. Risk Analysis & Mitigation Matrix

| Risk Category | Potential Failure Mode | Likelihood | Impact | Built-in Mitigation |
| :--- | :--- | :--- | :--- | :--- |
| **Corporate IT** | Hospital/DSO network blocks third-party `.exe` or extensions | High | Critical | **Web-Only Architecture:** Zero desktop daemons; runs entirely in standard browser tabs over port 443 with pure clipboard API. |
| **Acoustic Environment** | Handpiece and ultrasonic scaler noise corrupts transcription | High | High | **DSP Bandpass & Noise Gate:** Client-side WebAudio audio processor filters high-frequency drill harmonics (>6kHz) and silences suction drone. |
| **Serverless Runtime** | Container rotation drops memory state or throws `EROFS` | Medium | High | **Stateless Neon DB + In-Memory Fallback:** Neon PostgreSQL handles durable persistence; read-through cache absorbs ephemeral filesystem restrictions. |
| **PMS Incompatibility** | Legacy PMS lacks open APIs or developer partnerships | High | Medium | **F12 Clipboard Injection:** Bypasses PMS vendor walled-gardens entirely by simulating standard OS paste events into active PMS fields. |
| **Clinician Forgetfulness** | Dentist forgets to start or stop recording | Medium | Medium | **Micro-Pill Audio Sentry:** Visual pulse alerts clinician when speech is detected; auto-stop timeout after 10 minutes of silence. |

---

## 8. Document History & Approvals

| Version | Date | Author | Description of Changes |
| :--- | :--- | :--- | :--- |
| **1.0.0** | 2026-08-15 | Product Team | Initial Single-Screen Surgery Cockpit Spec |
| **1.5.0** | 2026-09-02 | Engineering Team | Neon DB persistence & Trojan Horse Wedge Strategy |
| **2.0.0** | 2026-09-14 | Lead Architect | Full Solo-Founder Operating System (SF-OS) PRD & Milestone Alignment |
