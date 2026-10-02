# DentAI Golden Journeys

**Status:** proposed by FREEBUFF bootstrap 2026-09-28. These are the end-to-end journeys the system must protect; each maps to screens (`SCREEN_INVENTORY.md`) and APIs (`API_INVENTORY.md`). E2E coverage is a planned work item (Playwright is a devDependency; no specs exist yet).

A **golden journey** is a path a real clinician walks. A regression on any step of a golden journey is at minimum P1 with clinical risk assessed.

## J1 — Chairside live scribing (CRITICAL)

Intake with consent → clinician starts recording (physical activation) → live conversation captured → recording stops → recorded audio uploaded & server-transcribed with diarization → note drafted from recorded transcript (`transcriptProvenance` recorded) → clinician reviews grounding banner → sign-off passes server gate → signed record immutable.

**Protected surfaces touched:** patient identity, consultation identity, evidence/provenance, grounding, sign-off, audit/seal.

## J2 — Cross-patient boundary (CRITICAL)

Patient A recording → "Next Patient" (or daysheet selection) → immediate STANDBY, recognition stopped, timer reset, stop chime → Patient B intake → Patient A's transcript dispatched as immutable snapshot; buffers never contaminate.

**Must never:** auto-start recording for B; merge A/B identity by name.

## J3 — Patient identity resolution (CRITICAL)

Daysheet/import row → registry lookup via `decidePatientResolution` → `matched` only on name + second detail agreeing; `ambiguous` ⇒ human confirms; else `create`. Mismatched DOB is decisive even when phone matches. No record ever falls back to name-only identity.

## J4 — Offline / degraded resilience (HIGH)

Every hosted AI route fails → "Draft offline now" → deterministic `draftEngine` fills template from transcript only; empty sections stay empty; `noteOrigin.needsReview` flagged; no invented diagnoses/treatments/recalls/ADA codes → note saveable only flagged-for-review.

## J5 — Sign-off refusal path (CRITICAL)

Attempt to sign with grounding unverified, blocking fact state, missing consent, stale version, or replayed nonce → server refuses, refusal audited, record remains unsigned and correctable.

## J6 — Long consultation (HIGH)

>75,000-token appointment (5,000-utterance capacity) → transcript accepted, horizon filter applies (documented as heuristic) → no silent truncation of recording; refusal or surfaced warning instead.

## J7 — Queue durability (MODERATE)

Note job enqueued → browser closed → cron drain advances queue → note completes; `openNoteJobs` telemetry reflects depth; per-clinic metering respected.

## J8 — Session epoch revocation (HIGH)

"Sign out every device" / PIN change → epoch advances → all prior tokens rejected (403) on next request; new sign-in mints token with current epoch.

## Maintenance

- New feature work touching a golden journey must update that journey's step list or open a ledger entry.
- E2E specs live under `tests/` (or `e2e/` when introduced) named `journey-<id>.spec.ts`.
