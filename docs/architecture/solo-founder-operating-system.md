# DentAI Solo-Founder Operating System (SF-OS)
## Architecture & Implementation Blueprint: From MVP to Autonomous Production Product

---

## 1. Executive Vision & Core Philosophy

**DentAI** is architected to run as a **100% autonomous, solo-founder-operated SaaS enterprise**. The founder (Dr. Vikram) focuses on clinical excellence and high-level strategy, while the software autonomously handles:
* **Self-Service Customer Acquisition & Viral Loops** (Chair-to-chair invites, free solo-chair wedge).
* **Automated Monetization & Billing Lifecycle** (Stripe self-service checkout, automated invoicing, customer portal).
* **Autonomous In-App Customer Support** (AI clinical concierge + client hardware diagnostic self-healer).
* **Fleet Telemetry & Resilient Self-Healing Ops** (Audio heartbeat telemetry, auto-restarting workers, nightly executive briefings).
* **Enterprise Data Governance & Diligence Readiness** (Tenant-isolated Neon PostgreSQL, automated backup escrow, cryptographic audit trails).

```
┌────────────────────────────────────────────────────────────────────────┐
│                   SOLO FOUNDER EXECUTIVE COCKPIT                       │
│    (Nightly Autonomous Briefing • Production Velocity • Fleet Health)  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
         ┌──────────────────────────┴──────────────────────────┐
         ▼                                                     ▼
┌─────────────────────────────────┐   ┌──────────────────────────────────┐
│     AUTONOMOUS OPERATIONS       │   │    CHAIRSIDE CLINICAL COCKPIT    │
│ • Stripe Billing & Portal       │   │ • 28px Ghost Micro-Pill (F12)    │
│ • AI In-App Support Concierge   │   │ • Live Speech & DSP AGC          │
│ • Diagnostic Self-Healer        │   │ • 5:01 PM Batch Speed Review     │
│ • Nightly S3/R2 Backup Escrow   │   │ • Front Desk Cross-Docking Slip  │
└─────────────────────────────────┘   └──────────────────────────────────┘
```

---

## 2. The 5 Autonomous Architectural Pillars

### Pillar 1: Automated Stripe Monetization & Customer Portal
* **Free Solo Chair Wedge:** Any individual associate dentist can use DentAI in 1 operatory with basic SOAP note generation for free.
* **Clinic Pro Tier ($199/mo):** Unlocks 5:01 PM Speed Review Strip, reception cross-docking manifests, and PMS macro integration for up to 3 chairs.
* **Enterprise / DSO Group Tier ($499/mo):** Unlocks multi-chair schedule aggregation, practice revenue velocity analytics, and audit defense escrow for unlimited chairs.
* **Zero-Touch Billing Engine:**
  * Self-service checkout via Stripe Checkout sessions (`/api/billing/create-checkout`).
  * Webhook listener (`/api/billing/webhook`) processing `checkout.session.completed`, `invoice.payment_succeeded`, and `customer.subscription.deleted`.
  * Stripe Customer Portal (`/api/billing/portal`) allowing practice managers to update credit cards, add seats, or download VAT/GST tax invoices with zero founder intervention.

### Pillar 2: Autonomous In-App Support & Hardware Diagnostic Self-Healer
* **Client Diagnostic Agent (`DiagnosticAssistant.tsx`):**
  * Auto-tests WebAudio microphone permissions and sample rates on load.
  * Verifies OS clipboard read/write permissions for `F12` PMS pasting.
  * Measures network round-trip latency to the serverless backend.
  * Displays a 1-click self-heal button (*"Reset Audio Buffer & Re-pair Phone"*) if distortion or latency spikes are detected.
* **Clinical AI Concierge Widget:**
  * Embedded in-app assistant trained on AHPRA guidelines, ADA item codes (e.g. D012, D531, D615), and PMS shortcuts (Dental4Windows, EXACT, Dentrix).
  * Resolves 95% of clinician questions ("How do I paste into EXACT?", "Why did tooth 16 show as 26?") with zero human support tickets.
  * Escalates to the founder only when an unhandled server error occurs.

### Pillar 3: Fleet Reliability, Telemetry & Nightly Briefing Engine
* **Operatory Heartbeat Sentry:**
  * Active operatories dispatch lightweight 60-second telemetry pings (`/api/telemetry`) recording audio frame dropouts, transcription latency, and memory utilization.
  * If a note generation job fails or encounters Gemini rate limits, the Job Fabric automatically backs off exponentially and retries without clinician notification.
* **Nightly Autonomous Executive Briefing:**
  * Every evening at 6:00 PM, the system compiles an autonomous company briefing in `reports/company/YYYY-MM-DD/briefing.json` covering:
    1. Active operatories & daily patient volume.
    2. Gross revenue & MRR expansion.
    3. Surfaced unbooked restorative treatment value.
    4. Fleet health & error rates (target: <0.1%).
  * Founder reviews the briefing in 60 seconds on the `FounderExecutiveDashboard.tsx` or via Telegram/Email summary.

### Pillar 4: Zero-CAC Viral Growth & Expansion Loops
* **Lateral Chair-to-Chair Gifting:**
  * Associates in Chair 1 can click *"Gift Chair 2 a 30-Day Pass"* in `SidebarDockMode.tsx`, sending an instant invite code to their colleague.
  * When Chair 2 activates, both chairs unlock the synchronized Operatory Intercom.
* **Unbooked Revenue Recovery Audit (The Owner Lead Magnet):**
  * DentAI generates an automated monthly "Lost Restorative Production Report" showing practice owners:
    * Total unbooked treatment plans identified during hygiene cleanings ($14,200 AUD average per chair).
    * Billed insurance CDT code discrepancies prevented.
    * Downcoded resin restorations appealed and recovered.
  * Practice owners see hard-dollar proof that DentAI pays for itself 50x over.

### Pillar 5: Multi-Tenant Neon Isolation & Diligence-Ready Backup Escrow
* **Strict Tenant Isolation:**
  * All database tables (`consultations`, `schedules`, `note_jobs`, `clinics`) are indexed and scoped by `clinic_id` and `dentist_id`.
  * Multi-clinic access enforced via stateless signed tokens, adhering to serverless container isolation.
* **Automated Nightly Backup Escrow:**
  * Cron job runs nightly pg_dump export of Postgres tables, encrypted via AES-256 and stored in secure cloud storage (Cloudflare R2 / AWS S3).
  * Clinic owners can download their clinic's complete JSON/PDF clinical data archive at any time, satisfying legal medical record portability.
  * Diligence-ready data room: Clean compliance certificates, architecture ADRs, and financial unit economics ready for institutional buyers or DSO acquisitions.

---

## 3. Concrete Implementation Roadmap

| Milestone | Target Deliverables | Technical Scope |
| :--- | :--- | :--- |
| **M1: Self-Service Billing** | Stripe Checkout & Customer Portal integration | Express billing routes, Stripe webhook handler, subscription status checks in `db.ts` |
| **M2: Diagnostic Self-Healer** | Hardware diagnostic modal & auto-test | Audio input tester, clipboard validator, 1-click audio buffer flush |
| **M3: Autonomous Support Bot** | In-app Clinical AI Concierge | Embedded chat drawer with dental PMS documentation embeddings |
| **M4: Viral Gifting Loops** | Chair-to-Chair invite generator | Invite code generator, trial provisioning, colleague onboarding flow |
| **M5: Backup Escrow Daemon** | Nightly encrypted data snapshot | Serverless backup script, export archive download in Practice Settings |

---

## 4. Operational Invariant for the Solo Founder
> **"If an operation requires manual human intervention more than once a month, it must be automated into code."**  
> Every customer lifecycle event—from onboarding and payment to diagnostic troubleshooting and compliance reporting—is completely self-executing.
