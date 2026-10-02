# DentAI Screen Inventory

**Status:** initial draft, bootstrapped 2026-09-28 from `PROJECT_CONTEXT.md` codebase map. Agents extend this file — never invent screens not present in `src/components/`.

## Conventions

- `id`: kebab-case, stable across refactors; referenced by quality-ledger entries and E2E specs.
- `risk`: clinical risk of a defect on this screen (CRITICAL/HIGH/MODERATE/LOW).
- `protected`: touches a protected surface (see `SAFETY_INVARIANTS.md`) — changes require CLINICAL_VERIFIER review.

## Inventory

| id | Component | Purpose | Risk | Protected | Notes |
|---|---|---|---|---|---|
| `landing` | `Landing.tsx` | Public entry; privacy notice + terms reachable | LOW | no | |
| `login` | `Login.tsx` | Sign-in (PIN-based) | HIGH | authorization | Epoch semantics apply |
| `credential-screen` | `CredentialScreen.tsx` | Credentials / account flows | HIGH | authorization | |
| `chairside-workspace` | `ChairsideWorkspace.tsx` (~3.3k lines) | Live cockpit: recording state, DSP, silence timer, note finalization, PMS copy | **CRITICAL** | yes | Owns no UI itself; renders the two panels below |
| `live-conversation-panel` | `LiveConversationPanel.tsx` | Live feed, waveform, standby/listening states | CRITICAL | yes | Copy must use anti-jargon terms |
| `clinical-note-editor-panel` | `ClinicalNoteEditorPanel.tsx` | Note textarea, macro bar, Copy / Next Patient | **CRITICAL** | yes | Macro defaults must not fabricate anatomy |
| `operatory-patient-banner` | `OperatoryPatientBanner.tsx` | Patient identity strip | **CRITICAL** | patient identity | Name ≠ identity |
| `clinical-summary` | `ClinicalSummary.tsx` | Generated note review + grounding banner | **CRITICAL** | grounding | "Verified from Audio" language only |
| `day-guide-modal` | `DayGuideModal.tsx` | Guide + GitHub issue form | LOW | no | |
| `day-schedule-queue` | `DayScheduleQueue.tsx` | Daysheet, walk-ins, in-place recording | HIGH | patient identity | Import rows are appointments, not clinical records |
| `history-hub` | `HistoryHub.tsx` | Past consultations, chart history | HIGH | consultation identity | |
| `phone-beacon-mode` | `PhoneBeaconMode.tsx` | Mobile companion audio relay | HIGH | evidence | Upload refusal must surface, never truncate |
| `treatment-pipeline` | `TreatmentPipeline.tsx` | Treatment opportunity pipeline | MODERATE | no | Composite IDs `${consultationId}-tx-*` |
| `patient-intake` | `PatientIntake.tsx` | Intake + AI-assist disclosure, consent | **CRITICAL** | patient identity, sign-off | Consent timestamp + disclosure version |
| `clinic-members-modal` | `ClinicMembersModal.tsx` | Clinic member management | HIGH | authorization | |
| `legal-page` | `LegalPage.tsx` | `#/privacy`, `#/terms` | LOW | no | |

## Maintenance rule

When a screen is added/removed in `src/components/`, an agent must update this table in the same change or open a `DOC_DRIFT` ledger entry. No screen ships without an inventory row and at least one planned E2E journey mapping.
