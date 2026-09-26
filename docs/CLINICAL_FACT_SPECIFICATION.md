# DentAI Canonical ClinicalFact Domain Contract Specification
**Document:** `docs/CLINICAL_FACT_SPECIFICATION.md`  
**Phase:** Phase 3 Hardening & Trust-Boundary Specification  
**Date:** September 2026  
**Status:** Authoritative Domain Specification  

---

## 1. Executive Summary & Architectural Principle

Phase 3 transitions `ClinicalFact` from a TypeScript interface into a hardened, canonical, deterministic domain model bounded by a strict trust boundary.

### The Fundamental Principle
> **The LLM may propose clinical assertions. It must never be treated as the authority that creates trusted canonical clinical state.**

Model-generated outputs and transcript extractions are inherently **untrusted inputs**. Only deterministic domain validation and controlled construction can establish a canonical `ClinicalFact`. Furthermore, deterministic structural validation must never be represented as proof that the clinical assertion itself is true—it proves internal coherence and admissibility, while clinical verification evaluates grounding and evidentiary warrant.

```text
                    UNTRUSTED BOUNDARY
                           │
                           ▼
                  ASR / Audio Transcript
                           │
                           ▼
                 CandidateClinicalFact
                           │
             ┌─────────────┴─────────────┐
             │   Deterministic Pipeline  │
             │                           │
             │ 1. Value Normalization    │
             │ 2. Type/Value Discrim.    │
             │ 3. FDI Consistency        │
             │ 4. Status × Temporal      │
             │ 5. Provenance Integrity   │
             │ 6. Speaker Consistency    │
             └─────────────┬─────────────┘
                           │
                           ▼
                     TRUST BOUNDARY
                           │
                           ▼
                      ClinicalFact
                           │
                 ┌─────────┴─────────┐
                 ▼                   ▼
         Domain Validation   Clinical Verification
         (Structural State)   (Evidentiary State)
                 │                   │
                 └─────────┬─────────┘
                           ▼
                 Clinical Documentation
              (Notes, PMS, Batch Tray)
```

---

## 2. Trust Boundary: CandidateClinicalFact vs Canonical ClinicalFact

To prevent unvalidated extraction payloads from masquerading as authoritative domain entities, the architecture enforces a strict runtime and compile-time boundary:

| Dimension | `CandidateClinicalFact` (Untrusted) | `ClinicalFact` (Canonical) |
|---|---|---|
| **Origin** | LLM extraction, heuristics, regex, legacy feeds | Controlled construction pathway only |
| **Mutability** | Mutable during ingestion and normalization | Readonly canonical assertion |
| **Type Safety** | Permissive (`value: unknown`) | Discriminated union (`FactValueTypeMap[T]`) |
| **Validation State** | Unvalidated | Enforced (`validationState: 'valid' \| 'warning' \| 'invalid'`) |
| **Anatomical Integrity** | Raw numbers / unverified surfaces | ISO 3950 verified with quadrant/position parity |
| **Timestamps** | Optional, raw ASR millisecond offsets | Authentic only (strictly 0 synthetic timestamps) |

### Controlled Construction Pathway

Canonical facts must be constructed exclusively via:
```typescript
createCanonicalClinicalFact(candidate: CandidateClinicalFact): FactConstructionResult
```

Where `FactConstructionResult` is a discriminated union:
```typescript
type FactConstructionResult =
  | { readonly success: true; readonly fact: ClinicalFact; readonly warnings: ReadonlyArray<string> }
  | { readonly success: false; readonly errors: ReadonlyArray<string>; readonly warnings: ReadonlyArray<string> };
```

Model-generated candidates that fail structural invariants are rejected at the boundary and returned with explicit error diagnostics.

---

## 3. Discriminated Type/Value Contract

The generic `Record<string, unknown>` backdoor has been eliminated. Every fact type is strictly bound to its corresponding typed payload via `FactValueTypeMap`:

```typescript
export interface FactValueTypeMap {
  tooth_finding: ToothFindingValue;
  procedure: ProcedureValue;
  anaesthetic: AnaestheticValue;
  periodontal_finding: PeriodontalFindingValue;
  allergy: AllergyValue;
  medication: MedicationValue;
  diagnosis: DiagnosisValue;
  consent: InformedConsentValue;
  symptom: SymptomValue;
  medical_history: MedicalHistoryValue;
  hard_tissue_finding: HardTissueFindingValue;
  soft_tissue_finding: SoftTissueFindingValue;
  radiographic_finding: RadiographicFindingValue;
  occlusal_finding: OcclusalFindingValue;
  endodontic_finding: EndodonticFindingValue;
  prosthodontic_finding: ProsthodonticFindingValue;
  orthodontic_finding: OrthodonticFindingValue;
  implant_finding: ImplantFindingValue;
  surgical_finding: SurgicalFindingValue;
  preventive_finding: PreventiveFindingValue;
  temporomandibular_finding: TemporomandibularFindingValue;
  sedation_finding: SedationFindingValue;
  pathology_finding: PathologyFindingValue;
  treatment_plan: TreatmentPlanValue;
  aftercare: AftercareValue;
  administrative: AdministrativeValue;
  clinical_flag: ClinicalFlagValue;
}
```

A fact with `type: 'procedure'` cannot accept a `ToothFindingValue`, and `tooth_finding` cannot accept a `ProcedureValue`. String and partial candidate values are safely normalized into explicit structured objects during canonical construction (e.g. `"caries"` -> `{ condition: 'caries' }`), preventing runtime contract escapes.

---

## 4. Separation of Extraction Method and Epistemic Certainty

Phase 3 untangles extraction mechanics from clinical certainty:

### Extraction Method (`how` the fact was derived):
```typescript
export type FactExtractionMethod =
  | 'verbatim'         // Exact string extracted from transcript
  | 'normalized'       // Safe vocabulary or alias normalization
  | 'model_extracted'  // Extracted by LLM semantic inference
  | 'inferred';        // Derived from contextual dental rules
```

### Epistemic Certainty (`how certain` the clinical assertion is):
```typescript
export type FactCertainty =
  | 'certain'          // Definite clinical observation or assertion
  | 'uncertain'        // Expressed with clinical or patient doubt
  | 'conflicting';      // Explicitly contradicted by another statement
```

An extraction method must **never** be used as a proxy for clinical certainty. A model extracting an utterance verbatim with 100% confidence where a patient states *"I think 36 might have a hole"* remains `certainty: 'uncertain'`.

---

## 5. Separation of Structural Validation from Clinical Verification

Phase 3 separates domain coherence from evidentiary support:

### Domain Validation State (`validationState`)
> **Answers:** Is this ClinicalFact internally coherent and structurally admissible?
```typescript
export type FactValidationState =
  | 'not_validated'    // Initial candidate state
  | 'valid'            // Passes all deterministic domain rules
  | 'warning'          // Clinically admissible with flagged irregularities
  | 'invalid';         // Structurally inadmissible (rejected)
```

### Clinical Verification State (`verificationState`)
> **Answers:** Is this assertion sufficiently supported by evidence and verification agents?
```typescript
export type FactVerificationState =
  | 'unverified'       // Awaiting evidentiary review
  | 'verified'         // Supported by audio/transcript evidence
  | 'flagged'          // Flagged for clinician review (e.g. discrepancy)
  | 'rejected';        // Disproven by evidence or clinician refusal
```

### Verification Method (`verificationMethod`)
```typescript
export type FactVerificationMethod =
  | 'none'
  | 'deterministic'
  | 'clinical_agent'
  | 'clinician_review';
```

> [!CRITICAL]
> **Deterministic structural validation does NOT establish clinical truth.**  
> A structurally valid fact (`validationState: 'valid'`) means the tooth number exists, the surface is anatomically legal, and the status matches the temporal window. It does not establish whether the patient actually has caries.

---

## 6. Evidence Provenance & Authentic Timestamp Policy

### Provenance Model
Evidence spans track their authentic source:
```typescript
export interface EvidenceSpan {
  utteranceId: string;
  rawText: string;
  speaker?: FactSpeaker;
  startMs?: number;
  endMs?: number;
  source?: 'asr' | 'transcript' | 'manual';
  timestampSource?: 'asr' | 'manual';
}
```

### Absolute Prohibition on Synthetic Timestamps
1. **No Timestamp Fabrication:** The LLM and extraction layers must **never** invent, extrapolate, interpolate, or fabricate timestamps from token counts, utterance order, or average speech rates.
2. **Missing Timestamps Allowed:** If the source transcript lacks millisecond offsets, `startMs: undefined` and `endMs: undefined` remain fully valid.
3. **Temporal Bounds Validation:** If present:
   - `startMs >= 0`
   - `endMs >= 0`
   - `startMs <= endMs`
   - Synthetic markers (`[synthetic]`, `synthetic: true`) are unconditionally rejected.

---

## 7. FDI Anatomical Metadata Redundancy & Surface Rules

The ISO 3950 FDI validation engine enforces cross-attribute consistency:

```typescript
export interface ToothReference {
  tooth: number;
  dentition?: 'permanent' | 'deciduous';
  quadrant?: number;
  position?: number;
  rawMention?: string;
}
```

### Redundancy Validation (`validateToothReferenceMetadata`)
Every redundant component is checked against the authoritative FDI tooth number:
- **Quadrant Calculation:** `Math.floor(tooth / 10)`
  - Permanent: Quadrants 1, 2, 3, 4 (positions 1–8).
  - Deciduous: Quadrants 5, 6, 7, 8 (positions 1–5).
- **Position Calculation:** `tooth % 10`
- Contradictions (e.g., tooth `36` claiming `quadrant: 1` or `dentition: 'deciduous'`) are rejected as corrupted anatomical records.
- Non-existent FDI teeth (`00`, `09`, `39`, `49`, `50`, `86`, etc.) cannot become canonical facts.

### Surface Anatomical Rules
- **Anterior Teeth (Positions 1, 2, 3):** Cannot accept Occlusal (`O`) surfaces. Valid surfaces: `M`, `D`, `B`/`F`/`La`, `L`/`P`, `I`.
- **Posterior Teeth (Positions 4, 5, 6, 7, 8):** Cannot accept Incisal (`I`) edges. Valid surfaces: `M`, `O`, `D`, `B`, `L`/`P`.

---

## 8. Central Status × Temporal Compatibility Matrix

All temporal and operational combinations are governed by a central matrix (`checkStatusTemporalCompatibility`):

| Status | `current` | `historical` | `planned` | `future` | `completed_today` | `previous_appointment` | `next_appointment` |
|---|---|---|---|---|---|---|---|
| **`performed`** | Valid | Warning | Incompatible | Incompatible | Valid | Incompatible | Incompatible |
| **`observed`** | Valid | Valid | Incompatible | Incompatible | Valid | Valid | Incompatible |
| **`reported`** | Valid | Valid | Incompatible | Incompatible | Valid | Valid | Incompatible |
| **`planned`** | Valid | Incompatible | Valid | Valid | Incompatible | Incompatible | Valid |
| **`discussed`** | Valid | Valid | Valid | Valid | Valid | Valid | Valid |
| **`declined`** | Valid | Valid | Valid | Valid | Valid | Valid | Valid |
| **`historical`**| Incompatible| Valid | Incompatible | Incompatible | Incompatible | Valid | Incompatible |
| **`negated`** | Valid | Valid | Valid | Valid | Valid | Valid | Valid |
| **`unknown`** | Valid | Valid | Valid | Valid | Valid | Valid | Valid |

### Invariant Rejections
- `planned + completed_today` → Inadmissible
- `performed + next_appointment` → Inadmissible
- `performed + future` → Inadmissible
- `historical + completed_today` → Inadmissible
- `observed + next_appointment` → Inadmissible

---

## 9. Speaker & Evidence Consistency

Single-speaker facts are validated against evidence attribution:
1. **Patient Observation Inadmissibility:** A fact spoken by `patient` with `evidenceType: 'clinician_observed'` is an epistemological contradiction and is strictly rejected.
2. **Clinician Relaying Patient Report:** Spoken by `clinician` with `evidenceType: 'patient_reported'` generates an explicit validation warning unless marked as indirect history.
3. **Speaker Mismatch Detection:** If a fact specifies `speaker: 'clinician'` while its sole evidentiary span records `speaker: 'patient'`, a provenance warning is raised.

---

## 10. Explicit Negation Semantics

A fact with `status: 'negated'` represents the explicit clinical refutation of a finding or procedure:
- **Direct Negation:** *"No caries on 36"* → `status: 'negated'`, `certainty: 'certain'`, `type: 'tooth_finding'`.
- **Clinical Uncertainty:** *"I don't know if 36 has caries"* → `status: 'observed'`, `certainty: 'uncertain'`. Uncertainty is **never** converted into negation.
- **Negation Scope:** Canonical facts carry an explicit `negationScope` identifying the exact negated finding or procedure to prevent ambiguous chart entries.

---

## 11. Model Extraction Confidence Semantics

- **Range:** Confidence must be a finite numerical value between `0.0` and `1.0`.
- **Rejections:** `NaN`, `Infinity`, `< 0.0`, or `> 1.0` are rejected during canonical construction.
- **Independence:** High confidence (`0.99`) indicates that the extraction pipeline is confident it read the transcript correctly; it **does not** imply clinical certainty (`certainty: 'certain'`).

---

## 12. Backward Compatibility & Migration Strategy

Existing `ClinicalFindings` records remain 100% supported:
1. `adaptFactsToLegacyFindings(facts: ClinicalFact[]): ClinicalFindings`: Projects canonical facts into the 8-field legacy model without data loss for UI components and PMS exports.
2. `adaptLegacyFindingsToFacts(findings: ClinicalFindings): ClinicalFact[]`: Lifts legacy records into canonical facts with `validationState: 'valid'` and `extractionMethod: 'normalized'`.
3. No endpoints in `server.ts` or UI components in `ChairsideWorkspace.tsx` were modified.
