# DentAI Clinical Architecture Audit
**Document:** `docs/CLINICAL_ARCHITECTURE_AUDIT.md`  
**Date:** September 2026  
**Auditor:** Senior Clinical NLP & Software Architecture Agent (Antigravity)  
**Target:** DentAI Clinical Scribe Repository  
**Status:** Completed Baseline Architectural Audit (Phase 1)

---

## Executive Summary

DentAI is a high-performance clinical documentation copilot for Australian dental practices. It incorporates mature operational infrastructure: stateless epoch-based session authentication, patient identity resolution (name + DOB/phone), durable PostgreSQL/JSON persistence, server-side audio reassembly, and Australian dental terminology/billing code engines.

However, a forensic inspection of the clinical transcription, entity extraction, grounding verification, and note-generation pipelines reveals **structural clinical accuracy vulnerabilities**:

1. **Monolithic Note Generation:** The primary LLM pipeline (`server.ts` line 4252) asks the model in a single prompt to simultaneously interpret conversational dialogue, perform clinical reasoning, and compose final clinical prose. The final prose note is treated as the primary data model rather than a rendering of underlying clinical facts.
2. **Fabricated Default Evidence in Macros & Parsers:** When speech is incomplete or terse, `src/lib/australianClinicalMacros.ts` (lines 94–100) and `src/lib/clinicalEntityParser.ts` (lines 135–185) silently inject clinical defaults: defaulting unmentioned local anaesthesia to *"4% Articaine with 1:100,000 adrenaline, 2.2 mL infiltration"*, defaulting composite shade to *"A3"*, and asserting profound anaesthesia without verbal evidence.
3. **Synthetic Provenance Timestamps:** `src/grounding/index.ts` (lines 36–50) manufactures artificial timestamps using `idx * 3000` ms and `audioSliceId: chunk-xxx` when real word-level timing is absent, creating a false appearance of sub-second alignment.
4. **False Grounding Confidence:** In `src/lib/draftEngine.ts` (lines 806–846), confidence is computed as `hasContent ? 'verified' : 'missing'`. In `src/lib/transcriptGrounding.ts`, grounding is a loose keyword substring match (`includes()`) that cannot detect negation ("no caries" matches "caries"), historical statements ("crown done last year"), or speaker roles ("patient says tooth feels loose").
5. **UI Reassurance Flaws:** In `src/components/ClinicalNoteEditorPanel.tsx` (lines 73–82), a green *"Verified from Audio"* badge is displayed whenever `hasActualGeneratedNote` is true, providing false reassurance to clinicians.

This audit details the 15 architectural dimensions mandated for Phase 1.

---

## 1. Current Audio → Transcript Flow

### Capture Paths
DentAI captures audio through two parallel mechanisms:
- **Cockpit Microphone:** Web Audio API & MediaRecorder in `src/components/ChairsideWorkspace.tsx`. 5-second audio chunks are encoded to base64 and uploaded to `POST /api/transcribe/audio`, keyed by consultation ID (`consultationAudioKey(consultationId)`).
- **Phone Beacon Mode:** Mobile companion in `src/components/PhoneBeaconMode.tsx` uploads WebM/Opus audio slices to `POST /api/beacon/chair/:chairId/upload-chunk` into `src/server/chairSessionStore.ts`.

### Audio Assembly & Pre-Flight
- `src/server/transcriptionRoutes.ts` handles `POST /api/transcribe`.
- Audio slices are concatenated as raw bytes via `assembleAudio(chunks)` in `src/server/transcription.ts` (`Buffer.concat(buffers)`). Text concatenation is avoided to prevent base64 padding corruption.
- Audio limits are enforced: minimum 2,000 bytes, maximum 10 MB inline (or file upload).
- Usage is metered against clinic limits before LLM dispatch.

### Transcription Engine
- Server-side diarization uses Google Gemini (`@google/genai`) via `createAudioTranscriber` in `src/server/transcription.ts`.
- Guided by `TRANSCRIPTION_SYSTEM_INSTRUCTION` (verbatim enforcement, Australian dental phonetic lexicon, role attribution as `Dentist`, `Patient`, or `Dialogue`).
- Schema expects:
  ```json
  { "lines": [{ "speaker": "Dentist | Patient | Dialogue", "text": "..." }] }
  ```
- Diarized transcript items are stored on the consultation as `TranscriptItem[]` with `transcriptProvenance` (`source: 'server-diarized' | 'browser-live' | 'manual' | 'none'`).
- **Data Minimisation:** Once the transcript is successfully persisted, the raw audio chunks are deleted via `chairStore.deleteAudio(audioKey)`.

---

## 2. Current Transcript → Clinical Note Flow

DentAI offers two note-generation pathways:

```
[Raw Audio Transcript]
         │
         ├─── Hosted LLM Path (server.ts /api/generate-notes or /api/notes/jobs)
         │         │
         │         ├── compactTranscriptForGeneration() (transcriptTrim.ts)
         │         ├── buildTemplateAIConfig() (JSON schema per template)
         │         ├── runHostedGeneration() (Gemini 3.6 Flash / OpenAI-compatible)
         │         ├── normalizeTemplateOutput() (normalizeNoteOutput.ts)
         │         └── finalizeHostedNoteOutput() (runs transcriptGrounding & groundingAudit)
         │
         └─── Offline / Macro Path (src/lib/draftEngine.ts & src/lib/macroEngine.ts)
                   │
                   ├── detectMacroFromContext() (keyword matching against 18 macros)
                   ├── parseClinicalEntities() (regex tooth/surface/drug extraction)
                   └── generateMacroNote() -> prefillMacroSlots()
```

### Key Architectural Flaw
**Notes are generated directly from unstructured text.** There is no intermediate canonical fact layer. The LLM or macro generates final formatted text sections (`chiefComplaint`, `toothFindings`, `treatmentPerformed`, etc.), and verification is attempted *retrospectively* by parsing the generated text.

---

## 3. Current LLM Usage

### Prompts & Configuration
- **Model Configuration:** Centralized in `src/lib/noteModelConfig.ts` (`process.env.GEMINI_MODEL || 'gemini-3.6-flash'`).
- **Prompt Definition:** `TEMPLATE_DRIVEN_SYSTEM_INSTRUCTION` in `server.ts` (lines 4252–4281).
- **Schema Assembly:** `buildTemplateAIConfig()` dynamically constructs a JSON schema from `template.sections`. Every section is requested as a freeform string (`type: Type.STRING`), along with `adaCodes: Type.STRING`, `patientSummary: Type.STRING`, `specialistReferral: Type.OBJECT`, and `patientConsent: Type.OBJECT`.
- **Compaction:** `compactTranscriptForGeneration()` in `src/lib/transcriptTrim.ts` caps transcripts over 250 items by stripping conversational filler and preserving clinical keywords.
- **Failover Hierarchy:**
  1. Vertex AI (Australia-Southeast1) with service account credentials.
  2. Developer API Key (`GEMINI_API_KEY`).
  3. Secondary Gemini Key (`GEMINI_FALLBACK_API_KEY`) on quota exhaustion.
  4. OpenAI-Compatible failover (`src/server/openAiCompatible.ts`) for Groq / Ollama / Llama-cpp.
  5. Deterministic Macro / Offline Draft Engine fallback.

---

## 4. Current Deterministic / Regex Processing

Deterministic processing is used heavily, but with substantial brittleness:

| Module | Purpose | Approach | Vulnerability |
|---|---|---|---|
| `clinicalEntityParser.ts` | Variable extraction for macros | Regex matching on teeth, surfaces, anaesthetics, materials | Hardcodes defaults (e.g. `2.2ml Articaine`, `Cotton roll isolation`, `isProfound: true`) when unmentioned |
| `macroEngine.ts` | Select procedure macro | 18 regex keyword branches | Fragile to conversational phrasing; negation regex is easily bypassed |
| `australianClinicalMacros.ts` | Note templates | String interpolation from `ExtractedClinicalVariables` | Injects full procedural boilerplate even when clinician spoke 5 words |
| `transcriptGrounding.ts` | Grounding check | `fullTranscript.includes(keyword)` | Ignores negation, speaker identity, and temporal context |
| `subsecondAlignment.ts` | Claim alignment | Regex `([1-8][1-8])` + token overlap | Matches numbers that are not teeth; returns 100% score on empty notes |
| `backwardReconciliation.ts` | Omission detection | Pattern tables for allergies and antiresorptives | Good for known drug lists, but lacks semantic understanding |
| `rogersConsentGate.ts` | Legal consent audit | Regex for risks (nerve, sinus, dry socket) + patient acceptance | Keyword-based; cannot verify whether patient understood or hesitated |

---

## 5. Current Dental Terminology Handling

- **Phonetic Lexicon:** `src/lib/dentalPhoneticLexicon.ts` normalizes 300+ common ASR errors (e.g. *"dirty tree"* → *"tooth 33"*, *"category"* → *"cavity"*, *"buckle"* → *"buccal"*, *"palette"* → *"palate"*).
- **ADA Item Schedule:** `src/lib/adaScheduleEngine.ts` and `src/lib/adaFees.ts` contain standard Australian Dental Association 3-digit codes (e.g. 011, 012, 114, 121, 311, 414, 531, 532, 611).
- **Macro Terminology:** `src/lib/australianClinicalMacros.ts` covers 18 major Australian dental procedures with AHPRA-compliant clinical phraseology.

---

## 6. Current FDI Tooth Handling

- **Notation Standard:** ISO 3950 two-digit system:
  - Permanent dentition: 11–18, 21–28, 31–38, 41–48.
  - Deciduous dentition: 51–55, 61–65, 71–75, 81–85.
- **Engine:** `src/lib/fdiNotationEngine.ts` provides robust validation:
  - `isValidFdiTooth(num)` verifies range.
  - `getToothMetadata(num)` determines quadrant, jaw, side, position, anterior vs. posterior status.
  - `parseAndValidateSurfaces(tooth, surfaces)` validates anatomical feasibility:
    - Rejects Occlusal (`O`) on anterior teeth (11–13, 21–23, 31–33, 41–43).
    - Rejects Incisal (`I`) on posterior teeth (14–18, 24–28, 34–38, 44–48).
    - Canonicalizes surface ordering (e.g. `MODBL`).
- **Defects in Other Modules:**
  - `clinicalEntityParser.ts` and `subsecondAlignment.ts` employ naive regexes like `\b[1-8][1-8]\b`. This misidentifies patient ages (e.g. "a 36 year old"), dosages ("50 mg"), and probing depths as teeth.

---

## 7. Current Speaker Attribution

- **ASR Layer:** `src/server/transcription.ts` asks Gemini to label utterances as `'Dentist'`, `'Patient'`, or `'Dialogue'`.
- **Note Generation Layer:** In `server.ts` line 4254, the system prompt instructs:
  > *"Never decide who spoke from the label alone — decide from the content: a clinician states examination findings... a patient reports symptoms..."*
- **Failure Mode:** In practice, because generation is freeform LLM prose, patient-reported symptoms are routinely converted into objective findings:
  - Patient: *"My lower left molar feels loose"* → Note Objective: *"Tooth 36 mobility"*
  - Patient: *"I think I need a filling on 24"* → Note Assessment: *"Tooth 24 carious lesion"*
- There is no programmatic schema barrier preventing patient statements from entering clinician-observed sections.

---

## 8. Current Timestamp / Provenance Handling

### Real Provenance
- Audio chunks have arrival timestamps (`timestamp: Date.now()`).
- Consultations record `transcriptProvenance` (`source: 'server-diarized'`, model ID, chunk count, duration estimate).

### Synthetic Provenance (CRITICAL DEFECT)
- In `src/grounding/index.ts` (lines 32–50), when raw utterances lack start/end timestamps, the code synthesizes them:
  ```ts
  const baseTimeMs = idx * 3000;
  return {
    id: `utt-${idx + 1}`,
    sender: validSender,
    text: u.text,
    startTimeMs: baseTimeMs,
    endTimeMs: baseTimeMs + 2500,
    audioSliceId: `chunk-${String(idx + 1).padStart(3, '0')}`
  };
  ```
- This directly violates workspace rule 12 ("Never Synthesise Clinical Evidence") and Section 14 of the target refactor. Real ASR timestamps must be passed through if available; if not available, provenance must explicitly state `unavailable`.

---

## 9. Current Treatment Verification

In `src/lib/draftEngine.ts` (lines 770–775):
```ts
const hasContent = transcript.length > 0;
const isToothVerified = vars.teeth.length > 0;
const isExamType = appointmentType === 'examination' || macroNote.title.toLowerCase().includes('exam');
const treatmentVerified = hasContent && (isToothVerified || isExamType || vars.spokencodes.length > 0 || /completed|restored|cured|extracted|prep|filling/i.test(macroNote.treatmentPerformed));
```

### Critical Flaws
1. Any routine examination with 1 line of dialogue is marked `treatmentVerified = true`.
2. Any restoration mention sets `treatmentVerified = true`, even if the dialogue said *"We are NOT doing the filling today"*.
3. Mere existence of a transcript is conflated with clinical verification of treatment.

---

## 10. Current Confidence Model

- In `src/lib/draftEngine.ts`:
  ```ts
  confidence: hasContent ? 'verified' : 'missing'
  ```
  Every field (chief complaint, history, gingival findings, diagnosis, recall) is assigned `'verified'` if the transcript has at least one line of speech.
- In `src/grounding/subsecondAlignment.ts`:
  ```ts
  if (claims.length === 0) {
    return { overallGroundingScore: 1.0, isFullyGrounded: true, statusBadge: 'Verified from Audio' };
  }
  ```
  An empty note with zero claims scores 100% and receives a *"Verified from Audio"* badge.

---

## 11. Current Sign-Off Logic

- In `src/lib/draftEngine.ts`:
  ```ts
  export function canSignDeterministicNote(note: DeterministicClinicalNote): boolean {
    if (!note || !note.fields) return false;
    if (note.fields.treatmentPerformed.confidence !== 'verified' || !note.fields.treatmentPerformed.value.trim()) {
      return false;
    }
    return true;
  }
  ```
- Because `treatmentPerformed.confidence` defaults to `'verified'` when transcript content exists, almost any non-empty note permits sign-off.
- There is no appointment-specific completeness state machine (`NOT_READY`, `READY_FOR_REVIEW`, `READY_FOR_SIGNOFF`, `SIGNED`).
- Cryptographic attestation (`src/lib/attestation.ts`) seals whatever note text exists using SHA-256 and AHPRA registration details, without guaranteeing that the underlying facts were verified.

---

## 12. Current Tests & Evaluation

### Existing Test Suite
- **Vitest Suite:** 50 test files, 620 tests passing (19 skipped PostgreSQL tests requiring `DATABASE_URL`).
- **Benchmark Suite (`src/benchmark/`):** 20 golden cases evaluating offline draft keyword coverage. Passed at 0.00% WER and 100% FDI precision/recall.
- **Evaluation Gate (`scripts/eval-notes.ts`):** 3 recorded fixtures (`endodontic-emergency-01.json`, `exam-routine-01.json`, `perio-scale-clean-01.json`). Passed at score 1.000.

### Test Blind Spots
- Tests verify current regex implementations against static strings.
- No tests currently test semantic negation ("Patient has no pain", "No restoration placed today").
- No tests evaluate planned vs. performed confusion ("Extraction planned for next visit").
- No tests evaluate historical treatment confusion ("Tooth 36 had a crown placed 2 years ago").
- No tests evaluate contradictory patient vs. clinician statements.

---

## 13. Current Architectural Weaknesses Summary

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CRITICAL WEAKNESSES                             │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Freeform LLM Prose Generation instead of Fact Extraction            │
│ 2. Ungrounded Default Fabrication in Australian Macro Generators       │
│ 3. Synthetic Timestamps (idx * 3000) Fabricating Alignment Evidence    │
│ 4. "hasContent ? 'verified' : 'missing'" Confidence Fallacy            │
│ 5. Keyword Substring Grounding Blind to Negation & Temporality         │
│ 6. Inability to Disambiguate Planned vs. Performed Treatment           │
│ 7. Leakage of Patient-Reported Speculation into Clinician Findings     │
│ 8. Binary Universal LLM / Universal Macro (No Selective Verification)  │
│ 9. Misleading "Verified from Audio" UI Badge on Unverified Notes       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 14. Exact Files & Functions Requiring Modification

| File | Functions / Structures | Reason for Modification |
|---|---|---|
| `src/types.ts` | Interfaces | Introduce `ClinicalFact`, `EvidenceSpan`, `ToothReference`, `DentalSurface`, `ClinicalFactType`, `ClinicalVerificationState` |
| `server.ts` | `runHostedGeneration`, `buildTemplateAIConfig`, `finalizeHostedNoteOutput` | Refactor LLM prompt from prose generation to structured `ClinicalFact` extraction; decouple extraction from rendering |
| `src/lib/clinicalEntityParser.ts` | `parseClinicalEntities` | Remove default values (no default 2.2ml Articaine, no default A3 shade); return factual extraction |
| `src/lib/australianClinicalMacros.ts` | `ROUTINE_RESTORATION_MACRO`, etc. | Remove ungrounded default text injection; enforce strict placeholder / fact grounding |
| `src/lib/draftEngine.ts` | `prefillMacroSlots`, `canSignDeterministicNote` | Replace `hasContent ? 'verified' : 'missing'` with multi-state fact confidence; implement appointment-specific sign-off readiness |
| `src/lib/transcriptGrounding.ts` | `verifyTranscriptGrounding` | Replace naive substring `includes()` with fact-based grounding against evidence spans |
| `src/grounding/index.ts` | `verifyNoteGrounding` | Remove synthetic timestamp generation (`idx * 3000`); preserve real timestamps or mark unavailable |
| `src/grounding/subsecondAlignment.ts` | `alignClaimsToUtterances` | Fix false 100% score on empty claims; align atomic clinical facts |
| `src/components/ClinicalNoteEditorPanel.tsx` | Header badge logic | Remove false *"Verified from Audio"* badge when note is not grounded |
| `src/components/ChairsideWorkspace.tsx` | Note finalization handlers | Wire into `ClinicalFact` pipeline and selective verification state |
| `src/benchmark/goldenSet.ts` | Benchmark test cases | Add clinical edge-case tests (negation, planned vs. performed, historical, attribution) |

---

## 15. Components That Should Remain Unchanged

To preserve working functionality and avoid unnecessary regressions, the following systems **must remain untouched**:
1. **Stateless Authentication & Session Security:** `src/lib/authPolicy.ts`, `src/server/sessionSecurity.ts`, `src/server/mfa.ts` (HMAC tokens, session epochs, PIN policy, rate limits).
2. **Patient Identity Resolution:** `src/lib/patients.ts` and `src/server/patientStore.ts` (strict name + DOB/phone matching policy).
3. **Audio Capture & Streaming Ingress:** `src/lib/transcribeClient.ts`, `src/server/chairSessionStore.ts`, `src/server/beaconRoutes.ts`, `src/lib/beaconAudioStorage.ts`.
4. **Server-Side Audio Diarization Transcriber:** `src/server/transcription.ts` (`createAudioTranscriber`, chunk reassembly, Gemini verbatim instruction).
5. **Practice Management & Billing:** `src/server/billing.ts`, `src/lib/plans.ts`, `src/lib/adaFees.ts`, `src/server/pmsWebhookAuth.ts`, `src/lib/pms/`.
6. **Governance, Audit & Timezone Utilities:** `src/lib/auditChain.ts`, `src/utils/date.ts` (`Australia/Sydney` clinic timezone handling), `src/lib/compliance.ts`.
7. **Database Storage & Migrations:** `src/lib/db.ts`, `src/lib/migrations.ts` (PostgreSQL / JSON read-through cache).

---

## Conclusion & Read-Out

The DentAI codebase is exceptionally well-structured and disciplined in its systems architecture (concurrency isolation, serverless resilience, security headers, audio reassembly). However, its clinical intelligence layer currently relies on **single-pass prose generation** and **heuristic keyword pattern-matching** that cannot guarantee clinical accuracy.

By introducing:
1. Canonical `ClinicalFact` representation,
2. Strict separation of fact extraction from note rendering,
3. Deterministic dental validation (leveraging `fdiNotationEngine.ts`),
4. A targeted **Selective Verification Agent** for clinical conflicts and ambiguities, and
5. An expanded gold-set evaluation framework,

DentAI will achieve the clinical safety, grounding, and attribution standards required for medical-grade operatory documentation.
