# ADR-004: Solo-Founder Autonomous Operations & In-App Concierge Architecture

## Status
Accepted

## Date
2026-09-14

## Context
DentAI is designed to be operated and grown by a solo founder without a hired customer support team, billing department, or full-time operations engineers.

In traditional medical/dental SaaS:
1. **Support Overhead:** Up to 70% of inbound customer support tickets stem from trivial local client environment issues: microphone permissions denied, incorrect audio input selected in Windows, Bluetooth headset dropouts, or OS clipboard permissions blocked.
2. **Clinical Inquiries:** Another 20% of inquiries involve questions regarding ADA item code mapping (e.g. "Which code for a 3-surface molar composite?"), PMS clipboard pasting instructions, or AHPRA record-keeping guidelines.
3. **Billing Churn & Invoicing Friction:** Invoicing, failed credit card updates, seat additions, and GST tax invoice requests create continuous administrative drag.

If a solo founder spends 2 hours a day handling support tickets and manual invoicing, product development and clinical sales stall.

## Decision
We establish an **Autonomous Solo-Founder Operating System (SF-OS)** comprised of three self-executing subsystems:

### 1. In-App Hardware Diagnostic Self-Healer (`DiagnosticAssistant`)
- A client-side diagnostic agent automatically validates:
  - WebAudio microphone permissions and sample rates (16kHz vs 48kHz).
  - Navigator clipboard write permissions (essential for `F12` pasting).
  - Round-trip network latency to the serverless API.
- If audio distortion or dropouts occur, the UI displays a 1-click **`[Reset Audio Buffer & Re-pair Phone]`** button that flushes the WebAudio context and regenerates the WebRTC/WebSocket beacon automatically, eliminating the #1 driver of support inquiries.

### 2. Autonomous Clinical AI Concierge
- An embedded in-app assistant pre-prompted with the ADA Schedule of Dental Services, AHPRA record compliance guidelines, and PMS macro integration guides (D4W, EXACT, Dentrix).
- Resolves >95% of clinical usage and coding questions directly in the operatory without human involvement.
- Escalates to the founder only when an unhandled server error or data loss event occurs, transmitting a complete bundle of client telemetry and diagnostic logs.

### 3. Self-Service Stripe Customer Portal & Automated Billing
- Self-service Stripe Checkout sessions (`POST /api/billing/create-checkout`) with webhook handling for subscription events.
- Direct redirection to the Stripe Customer Portal (`POST /api/billing/portal`), enabling clinic managers to update payment methods, add operatory seats, or download VAT/GST tax invoices autonomously.
- Nightly cron briefings (`briefing.json`) dispatched to the founder summarizing active operatories, revenue velocity, and error rates in under 60 seconds.

## Alternatives Considered

### 1. Traditional Helpdesk (Zendesk / Intercom / Live Chat)
- **Pros:** Familiar enterprise interface.
- **Cons:** Creates an expectation of real-time human response; interrupts founder focus; expensive per-seat pricing.
- **Rejected:** Replaced with the in-app AI Concierge + Diagnostic Assistant.

### 2. Manual Invoicing & Custom Enterprise Contracts
- **Pros:** Ability to negotiate custom terms with large clinic groups.
- **Cons:** Creates invoice reconciliation delays, collections friction, and administrative paperwork.
- **Rejected:** All tiers (Solo, Clinic Pro, Enterprise) must checkout and manage billing self-service via Stripe.

## Consequences
- **Infinite Support Leverage:** The platform can scale from 10 to 1,000 operatories without linear headcount expansion.
- **Founder Time Protection:** Founder time is preserved exclusively for clinical product engineering and strategic enterprise relationships.
- **Proactive Failure Detection:** Hardware and audio issues are resolved chairside by the user in 1 click before frustration accumulates.
