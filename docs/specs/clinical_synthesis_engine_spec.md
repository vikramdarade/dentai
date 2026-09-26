# Spec: Clinical Ambient Scribe & Synthesis Engine (DentAI)

**Author:** Antigravity / Senior Clinical Ambient Scribe Architect  
**Date:** 2026-09-26  
**Status:** DRAFT (Updated with Clinical Industry Best Practices)  
**Reference Documents:**  
- [`docs/reviews/clinical_readiness_audit_2026_09_26.md`](file:///c:/Users/swati/Downloads/dentai/docs/reviews/clinical_readiness_audit_2026_09_26.md)  
- [`docs/reviews/consultation_recording_review_2026_09_26.md`](file:///c:/Users/swati/Downloads/dentai/docs/reviews/consultation_recording_review_2026_09_26.md)  
- AHPRA Dental Board of Australia Code of Conduct & Clinical Records Guidelines  

---

## 1. Industry Context & Background

In production clinical ambient scribes (e.g., Nuance DAX, Abridge, Suki, Heidi Health, Nabla), the fundamental technical challenge is **the vast semantic gap between spontaneous conversational speech and formal legal health documentation**.

In an operatory setting:
- Background radios, ceiling TVs (YouTube, ads), high-volume suction, and dental assistants introduce acoustic noise.
- Patients speak colloquially (*"I have a sweet tooth"*, *"Can't you just put a filling in it?"*, *"Don't wear it, sell it"*).
- Clinicians alternate between conversational chit-chat, chairside patient education, examination findings, and operative commands.

**The Golden Law of Medical/Dental Scribes:**  
> *A clinical scribe is NOT a court stenographer. A transcript documents what was said; a medical record documents what was observed, diagnosed, and performed. Dumping verbatim conversational dialogue into a patient's chart is considered negligent documentation under AHPRA and ADA professional guidelines.*

---

## 2. Core Architectural Principles (Industry Scribe Best Practices)

### Principle 1: The 4 Distinct Clinical Speech Modalities
Every utterance in an operatory belongs to one of four clinical modalities. Scribing algorithms must classify modality before assigning content to clinical sections:

```text
CONVERSATIONAL UTTERANCE
          │
          ├── 1. Ambient Noise / Social Chit-Chat (SQUELCH)
          │      └── e.g. "Footy finals are here", "Don't wear it, sell it" -> DROP
          │
          ├── 2. Patient Inquiry / Speculative Intent
          │      └── e.g. "Can we do whitening?", "I was going to ask about..." 
          │          -> Route to SUBJECTIVE / INQUIRIES or PLAN; NEVER to Treatment Performed
          │
          ├── 3. Patient Education / Preventative Counseling
          │      └── e.g. "Soft drinks have acid that dissolves enamel", "Limit to 10 mins"
          │          -> Route to PREVENTATIVE ADVICE / OHI; NEVER to Tooth Findings
          │
          └── 4. Concrete Clinical Finding / Action
                 ├── Clinician Observation -> OBJECTIVE (Hard Tissue / Periodontal)
                 ├── Clinician Diagnosis -> ASSESSMENT / DIAGNOSIS
                 └── Clinician Executed Procedure -> TREATMENT PERFORMED TODAY
```

---

### Principle 2: Speaker Role & Semantic Authority (Diarization Rules)
In clinical charting, clinical sections have strict speaker-authority constraints:

| Clinical Section | Authoritative Speaker | Valid Linguistic Content | Banned Content |
|---|---|---|---|
| **Chief Complaint / Subjective** | Patient (or Dentist eliciting) | Patient-reported symptoms, pain history, aesthetic concerns. | Operative details, cavity prep dimensions. |
| **Hard Tissue / Tooth Findings** | Clinician Only | Clinician-observed enamel/dentin caries, restorations, wear, fractures, tests (cold, EPT, TTP). | Patient casual questions, clothing ads, radio lyrics. |
| **Periodontal & Soft Tissue** | Clinician Only | Mucosal pathology (stomatitis, leukoplakia, ulcers), gingival inflammation, BPE, pocket depths, calculus. | Enamel stains, patient inquires, non-oral remarks. |
| **Diagnosis & Clinical Assessment** | Clinician Only | Pathology identified by clinician (e.g. *Nicotinic stomatitis of hard palate secondary to cigarillo use*). | Patient casual remarks (*"I don't think of them as cigars"*). |
| **Treatment Performed Today** | Clinician Only | Past-tense executed procedures (local anaesthetic, prep, etch, bond, composite placement, cure, polish). | Inquiries, future plans, prospective discussions, whitening questions. |
| **Preventative Advice & Home Care** | Clinician (Educating) | Dietary counseling, smoking cessation, fluoride advice, oral hygiene instructions. | Anatomical findings, billing items. |

---

### Principle 3: Clinical Entity Knowledge Graph & Mutual Exclusivity
In industry scribes, candidate clinical sentences must not duplicate across multiple sections (e.g., whitening inquiry appearing in 3 sections). 

**The Single-Ownership Rule:**
A clinical fact or sentence is evaluated against a strict **Clinical Precedence Hierarchy**:
$$\text{Diagnosis} \succ \text{Treatment Performed} \succ \text{Hard Tissue} \succ \text{Soft Tissue} \succ \text{Subjective} \succ \text{Plan / Advice}$$
Once a finding claims an utterance, that utterance is marked as **consumed** and cannot populate secondary sections.

---

### Principle 4: Conversational Synthesis vs Verbatim Dumping
Clinical notes must be rendered using standardized medical documentation formatting:
- **Raw Dialogue:** *"No, not that I can think of anything worrying you about your teeth or gums? There is some decay in one of your lower molars... unfortunately Josh you're going to need a filling..."*
- **Synthesized Clinical Output:**
  ```text
  HARD TISSUE & TOOTH FINDINGS:
  - Lower molar: Carious lesion identified requiring direct restoration.
  - Caries etiology, dietary risk factors, and restorative options discussed.
  - Patient consented to composite restoration.
  ```

---

## 3. Concrete Engineering Specifications

### Spec Rule 1: Ambient Radio & Commercial Squelch Filter
* **Problem in Video:** *"Chloe loves the sound of earning and saving money on Vintage. Don't wear it, sell it"* was filed as tooth pathology due to single-word trigger `'wear'`.
* **Engineering Solution:**
  1. Ban single-word anatomical/procedural triggers (`wear`, `crack`, `sound`, `break`, `cold`, `hot`, `sweet`, `radio`, `game`).
  2. Require dental contextual collocation (bigrams/trigrams):
     ```typescript
     // Hard tissue wear must co-occur with dental anatomy
     const DENTAL_WEAR_REGEX = /\b(tooth|teeth|incisal|occlusal|enamel|cervical|attrition|abrasion|erosion)\s+(wear|facets?|loss)\b|\bwear\s+(facets?|patterns?|on\s+(teeth|tooth|molars?|incisors?))\b/i;
     ```
  3. Non-Clinical Squelch Gate: Filter utterances with commercial/broadcasting markers (`radio`, `footy`, `finals`, `vintage`, `save money`, `earn money`, `sponsor`, `subscribers`, `podcast`).

---

### Spec Rule 2: Treatment Performed Intent Gate (Inquiry Negation)
* **Problem in Video:** Patient asked *"I was going to ask you about whitening my teeth..."*, which was documented under `Treatment Performed Today`.
* **Engineering Solution:**
  1. Implement `isCompletedTreatmentSentence(text)`:
     ```typescript
     export function isCompletedTreatmentSentence(text: string): boolean {
       const trimmed = text.trim();
       if (!trimmed) return false;

       // 1. Inquiries, prospective discussions, and questions are STRICTLY PROHIBITED
       const inquiryOrQuestionPattern = /\b(can (we|you|i)|could (we|you|i)|should (we|you|i)|would (we|you|i)|might|wondering if|going to ask|wanted to ask|like to ask|thinking about|what about|interested in|options for|look into|question about)\b|\?$/i;
       if (inquiryOrQuestionPattern.test(trimmed)) {
         return false;
       }

       // 2. Must contain verified declarative completed past-tense clinical verb
       const completedActionPattern = /\b(placed|restored|filled|extracted|removed|administered|infiltrated|etched|bonded|cured|scaled|polished|applied|sutured|extirpated|obturated|cemented|excavated|debrided)\b/i;
       return completedActionPattern.test(trimmed);
     }
     ```

---

### Spec Rule 3: Diagnostic Mucosal Pathology Extraction
* **Problem in Video:** Clinician diagnosed *"nicotinic stomatitis"* of the palate. DentAI missed it and instead logged patient chit-chat (*"they're certainly not cigarettes"*).
* **Engineering Solution:**
  1. Expand oral mucosal pathology lexicon:
     ```typescript
     const MUCOSAL_PATHOLOGY_TERMS = [
       'nicotinic stomatitis', 'smoker\'s palate', 'smokers palate', 'stomatitis',
       'leukoplakia', 'erythroplakia', 'lichen planus', 'hyperkeratosis',
       'ulcer', 'aphthous', 'fibroma', 'papilloma', 'candidiasis', 'thrush',
       'angular cheilitis', 'geographic tongue', 'fissured tongue'
     ];
     ```
  2. When a pathology term is identified in clinician speech, it takes absolute precedence for `diagnosis` and `findingsGingival` (Soft Tissue).
  3. Colloquial patient conversational disclaimers (`"I don't think of them as..."`, `"just social"`) are explicitly excluded from `diagnosis`.

---

### Spec Rule 4: Dedicated Patient Counseling & Prevention Section
* **Problem in Video:** Smoking cessation advice and soft drink dietary counseling were either omitted or jumbled into tooth findings.
* **Engineering Solution:**
  Ensure the Australian Standard Clinical Note template features a dedicated **PREVENTATIVE ADVICE & COUNSELING** section that captures:
  - Dietary advice (limiting frequency of acid/sugar, sipping duration).
  - Smoking & tobacco counseling (risk of nicotinic stomatitis and mucosal changes).
  - Oral hygiene instruction (flossing, brushing technique, interdental brushes).

---

### Spec Rule 5: Cross-Section De-Duplication Pipeline
* **Problem in Video:** Identical sentence appeared in 3 separate sections.
* **Engineering Solution:**
  ```typescript
  // A consumed utterance set prevents any sentence from appearing more than once
  const consumedUtteranceHashes = new Set<string>();

  function assignSectionSentence(sectionKey: string, sentence: string): boolean {
    const hash = sentence.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (consumedUtteranceHashes.has(hash)) {
      return false; // Already claimed by higher-priority clinical section
    }
    consumedUtteranceHashes.add(hash);
    return true;
  }
  ```

---

## 4. Test Verification Suite & Success Criteria

### Target Test Suite: `tests/clinicalScribeSynthesis.test.ts`

| Test Scenario | Input Speech Utterance | Expected Output | Prohibited Output |
|---|---|---|---|
| **T1: Commercial Squelch** | *"Chloe loves the sound of earning and saving money on Vintage. Don't wear it, sell it."* | Omitted completely from all clinical note sections. | Must NOT appear in `toothFindings` or `chiefComplaint`. |
| **T2: Treatment Performed Gate** | *"I was going to ask you about whitening my teeth because I've noticed that they have more stains on them."* | Assigned to `chiefComplaint` or `plan`. | Must NOT appear in `treatmentPerformed`. |
| **T3: Mucosal Pathology** | *"Because I'm seeing some irritation in your mouth, in the palate. That's called nicotinic stomatitis."* | Captured in `diagnosis` as *Nicotinic stomatitis of the palate* and `findingsGingival`. | Must NOT be replaced by patient banter. |
| **T4: Single-Ownership** | *"I've noticed these white spots appearing on my teeth."* | Assigned to `chiefComplaint` (Patient reported) or `toothFindings`. | Must NOT be duplicated across 2+ sections. |
| **T5: Prevention Counseling** | *"Try to limit that soft drink to lunchtime rather than sipping it all afternoon."* | Captured under `recommendations` / `preventativeAdvice`. | Must NOT appear under `toothFindings`. |

---

## 5. Phased Implementation Roadmap

- [x] **Phase 1: Lexicon & Squelch Filter Hardening**
  - Implement `NON_CLINICAL_NOISE_REGEX` for commercials/radio (`NON_CLINICAL_COMMERCIAL_RE`).
  - Upgrade `SECTION_KEYWORDS.toothFindings` to require dental collocations for wear/cracks.
  - Expand oral mucosal pathology terms in `SECTION_KEYWORDS.diagnosis` and `SECTION_KEYWORDS.findingsGingival`.

- [x] **Phase 2: Intent & Modality Classifier**
  - Implement `isCompletedTreatmentSentence` with inquiry negation.
  - Implement `isPreventativeCounselingSentence` to route diet/smoking advice to OHI.

- [x] **Phase 3: Multi-Pass De-Duplication & Section Precedence Engine**
  - Implement modality-based inquiry isolation preventing multi-section duplicate pollution.
  - Enforce clinical precedence hierarchy across note template sections.

- [x] **Phase 4: Synthesis Formatting & Conversational Cleanser**
  - Clean conversational speech filler (*"look"*, *"well"*, *"you know"*, *"as I said"*, *"I mean"* via `CONVERSATIONAL_FILLER_RE`).
  - Format output into crisp, standardized clinical bullet points and capitalized medical sentences.

- [x] **Phase 5: Automated Verification & Vitest Regression**
  - Author comprehensive test suite `tests/clinicalScribeSynthesis.test.ts` (9 tests passing).
  - Run full test suite across the repository (`vitest run --fileParallelism=false`: 620 tests passing, 0 failures).
