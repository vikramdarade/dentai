# ADR-003: Composite Entity Identifiers and Deterministic Slot Fingerprinting

## Status
Accepted

## Date
2026-09-14

## Context
In dental operations, schedules are dynamic and clinical records have hierarchical dependencies:
1. **Dynamic Midday Schedule Changes:** Clinicians frequently re-paste PMS screenshots midday (e.g. after lunch) or add ad-hoc walk-in emergency appointments. If an appointment row is re-imported from a fresh screenshot, a naive import algorithm risks creating duplicate appointment slots, or worse, overwriting active audio recordings or already-completed SOAP notes.
2. **Derived Child Opportunities:** During a consultation, the ambient AI extracts secondary restorative opportunities (e.g. `#16 Distal Composite`, `Crown on 26`). When the clinician or front desk updates or signs off on these treatment opportunities (via `PATCH /api/pipeline/:id`), locating the item via linear scanning of the entire database is inefficient ($O(N)$) and prone to ID collisions across consultations.

## Decision
We enforce two structural identification patterns across the system:

### 1. Deterministic Schedule Slot Fingerprinting (`generateSlotFingerprint`)
To support the "Snip & Paste" PMS schedule ingestion workflow without data destruction:
- Every schedule slot is assigned a deterministic fingerprint derived from:
  $$\text{fingerprint} = \text{date} + \text{"\_"} + \text{normalizeTime}(\text{time}) + \text{"\_"} + \text{normalizeName}(\text{patientName})$$
- When a new PMS screenshot or walk-in is ingested, a **3-Way Non-Destructive Merge Algorithm** executes:
  - **Existing `ready`, `processing`, or `recording` slots:** Kept strictly immutable. Notes, timestamps, and active audio buffers are preserved.
  - **Existing `scheduled` slots:** Updated with new procedure text without changing slot IDs.
  - **New slots:** Appended chronologically with a visual highlight.
  - **Duplicate rows within the same snip:** Deduplicated instantly during Gemini vision extraction.

### 2. Composite Entity Identifiers for O(1) Updates
To support instant updates to child entities (such as treatment opportunities and lab prescriptions):
- Child IDs are always prefixed with the parent consultation ID:
  $$\text{childId} = \text{\$\{consultationId\}-tx-\$\{key\}}$$
- API endpoints (e.g. `PATCH /api/pipeline/:id`) parse the prefix to isolate the parent consultation directly, enabling $O(1)$ direct targeting in storage rather than linearly scanning all consultations.

## Alternatives Considered

### 1. Random UUIDs for Schedule Slots
- **Pros:** Trivial to generate; guaranteed globally unique.
- **Cons:** Inability to match the same patient appointment when re-snapped midday from D4W; leads to duplicate appointment rows and orphan records.
- **Rejected:** Fails the primary usability requirement of painless midday schedule re-syncing.

### 2. Separate Normalized SQL Tables with Foreign Keys
- **Pros:** Classical relational database normalization.
- **Cons:** Requires complex multi-table joins and transactions on every ambient consultation save; complicates offline-first client-side synchronization and serverless cold starts.
- **Rejected:** Unnecessary overhead. Storing consultation-scoped items within the consultation document with composite prefixed keys provides $O(1)$ lookups without relational join overhead.

## Consequences
- **Idempotent Schedule Imports:** Clinicians can paste PMS screenshots as many times as they want throughout the day without fear of losing notes or duplicating patient appointments.
- **Instant Pipeline Updates:** Treatment plan edits and front desk status changes resolve with zero database scan latency.
- **Predictable Test Assertions:** Deterministic IDs simplify automated integration and end-to-end test fixtures.
