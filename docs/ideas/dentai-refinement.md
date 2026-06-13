# DentAI Context-Aware Clinical & Patient Care Copilot

## Problem Statement
How might we design a production-grade, premium DentAI assistant that utilizes the server-side Gemini API to instantly map dentist-patient conversations into accurate clinical structures, saving solo practitioners hours of admin time without compromising compliance or accuracy?

## Recommended Direction
We will implement an Express server backend that integrates with the server-side Gemini API (using the `@google/genai` library). The frontend will pass the patient's intake form context (chief complaint, appointment type, medical history, age) along with the live-transcribed examination text.

The Gemini API will parse this combined context using a customized system prompt tailored for dental nomenclature (Universal Teeth numbering, dental surfaces, periodontal pocket depths). It will return a structured JSON response containing:
1. **Professional Clinical Notes (SOAP format):** Chief Complaint, History, Tooth Findings, Gingival State, Diagnosis, Treatment Performed, Recommendations, and Recall.
2. **A Patient Care Summary:** A warm, jargon-free, easy-to-read letter that the dentist can instantly print or email to the patient, boosting patient trust and compliance.

## Key Assumptions to Validate
- [ ] **Shorthand Parsing:** Gemini can reliably map dense dental abbreviations (e.g., "Tooth 3 DO composite", "pocket depths 3-2-3") to the correct clinical findings fields.
- [ ] **Context Infusion:** Combining the initial intake form data with the live transcription improves homophone resolution and disambiguates reference points.
- [ ] **API Proxying:** The React frontend and Express backend can seamlessly communicate locally and in production via Vite proxy configurations.

## MVP Scope
### In Scope
- A local Express server (`server.ts` or `server.js`) using `@google/genai` to connect to Gemini.
- A `POST /api/generate-notes` backend route that takes the patient's intake data + transcript and returns structured findings.
- An updated frontend in `App.tsx` and `components/LiveRecording.tsx` that replaces simulated timers/states with the active API fetch.
- An updated `ClinicalSummary.tsx` rendering the real Gemini-structured findings and patient care letter.
- Beautiful, high-end loading and success overlays indicating the actual API status.

### Out of Scope
- Direct browser microphone/voice audio capturing (we will continue using the high-fidelity transcript simulator for text feeds).
- Direct API integration with commercial Practice Management Systems (PMS).
- User authentication and role management (multi-dentist clinics).

## Not Doing (and Why)
- **Direct browser voice-to-text recording:** Speech-to-text in noisy dental environments requires expensive, specialized hardware noise-cancelling models. We will stick to the text simulator to focus on the core value: clinical note structuring.
- **3D Interactive Chart Sync:** Creating a fully interactive 3D dental mouth chart is a heavy feature that distracts from the primary workflow: getting notes saved to EHRs fast.

## Open Questions
- Which Gemini model balances latency, cost, and professional medical terminology parsing best (e.g., `gemini-2.5-flash` vs. `gemini-2.5-pro`)?
- Should we provide an option for dentists to toggle between Universal Teeth numbering (used in the US) and FDI notation (standard internationally)?
