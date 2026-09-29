/**
 * DentAI Canonical Clinical Fact Domain Contract (Phase 3 Hardened Architecture)
 *
 * TRUST BOUNDARY ARCHITECTURE:
 * - CandidateClinicalFact: Untrusted model/extraction proposal.
 * - ClinicalFact: Verified, canonical domain assertion with provenance and structural invariants.
 *
 * CRITICAL DESIGN INVARIANTS:
 * 1. Discriminated Type/Value relationship: ClinicalFact.type dictates ClinicalFact.value.
 *    No generic Record<string, unknown> backdoor.
 * 2. Extraction method ('verbatim' | 'normalized' | 'model_extracted' | 'inferred')
 *    is strictly separated from epistemic certainty ('certain' | 'uncertain' | 'conflicting').
 * 3. Domain validation ('valid' | 'invalid' | 'warning') is strictly separated from
 *    clinical verification ('unverified' | 'verified' | 'flagged' | 'rejected').
 * 4. Provenance is authentic: timestamps are never synthesized or extrapolated.
 * 5. Anatomical FDI metadata (quadrant, position, dentition) must be internally coherent.
 * 6. Central Status × Temporal compatibility matrix prevents impossible states.
 */

// ============================================================================
// 1. TAXONOMY & CLASSIFICATION
// ============================================================================

export type ClinicalFactType =
  | 'chief_complaint'
  | 'symptom'
  | 'medical_history'
  | 'dental_history'
  | 'medication'
  | 'allergy'
  | 'vital'
  | 'examination'
  | 'tooth_finding'
  | 'periodontal_finding'
  | 'soft_tissue_finding'
  | 'radiographic_finding'
  | 'diagnosis'
  | 'differential_diagnosis'
  | 'procedure'
  | 'anaesthetic'
  | 'material'
  | 'medication_instruction'
  | 'oral_hygiene_instruction'
  | 'risk_factor'
  | 'treatment_plan'
  | 'recall_plan'
  | 'referral'
  | 'follow_up'
  | 'consent'
  | 'declined_treatment'
  | 'postoperative_instruction';

export type FactSpeaker =
  | 'patient'
  | 'clinician'
  | 'assistant'
  | 'unknown';

export type FactEvidenceType =
  | 'patient_reported'
  | 'clinician_observed'
  | 'clinician_interpretation'
  | 'instruction'
  | 'discussion';

export type FactStatus =
  | 'performed'
  | 'observed'
  | 'reported'
  | 'planned'
  | 'discussed'
  | 'declined'
  | 'historical'
  | 'negated'
  | 'unknown';

export type FactTemporalContext =
  | 'current'
  | 'historical'
  | 'planned'
  | 'future'
  | 'completed_today'
  | 'past_appointment'
  | 'previous_appointment'
  | 'next_appointment';

/**
 * Epistemic certainty of the clinical assertion itself.
 * (How certain is the assertion?)
 */
export type FactCertainty =
  | 'certain'
  | 'uncertain'
  | 'conflicting';

/**
 * Extraction method specifying how the fact was derived.
 * (How was this assertion captured?)
 */
export type FactExtractionMethod =
  | 'verbatim'
  | 'normalized'
  | 'model_extracted'
  | 'inferred';

/**
 * Deterministic structural/domain validation state.
 * Answers: Is this fact internally coherent and admissible?
 */
export type FactValidationState =
  | 'not_validated'
  | 'valid'
  | 'invalid'
  | 'warning';

/**
 * Clinical evidentiary verification state.
 * Answers: Is this assertion verified against source evidence?
 */
export type FactVerificationState =
  | 'unverified'
  | 'verified'
  | 'flagged'
  | 'rejected';

/**
 * Method by which clinical verification was established.
 */
export type FactVerificationMethod =
  | 'none'
  | 'deterministic'
  | 'selective_agent'
  | 'clinician_review';

// Backward compatibility alias
export type ClinicalVerificationState = FactVerificationState;

// ============================================================================
// 2. ANATOMICAL DATA STRUCTURES
// ============================================================================

export type DentalSurface = 'M' | 'D' | 'O' | 'I' | 'B' | 'L' | 'P' | 'F' | 'LA';

export interface ToothReference {
  /** ISO 3950 two-digit integer (11-48 permanent, 51-85 deciduous). */
  readonly tooth: number;
  /** Dentition category. */
  readonly dentition: 'permanent' | 'deciduous';
  /** Quadrant (1-4 permanent, 5-8 deciduous). */
  readonly quadrant: number;
  /** Position from midline (1-8 permanent, 1-5 deciduous). */
  readonly position: number;
  /** Original spoken phrase (e.g. "three six", "lower left first molar"). */
  readonly rawMention?: string;
}

export interface DentalAnatomyTarget {
  readonly teeth: ReadonlyArray<ToothReference>;
  readonly surfaces?: ReadonlyArray<DentalSurface>;
  readonly canonicalSurfaces?: string;
  readonly quadrant?: 1 | 2 | 3 | 4;
  readonly sextant?: 1 | 2 | 3 | 4 | 5 | 6;
  readonly arch?: 'maxillary' | 'mandibular';
  readonly softTissueSite?: string;
}

// ============================================================================
// 3. EVIDENCE & PROVENANCE
// ============================================================================

export interface EvidenceSpan {
  /** Unique identifier of the source utterance (e.g. "u-12", "utt-04"). */
  readonly utteranceId: string;
  /** The exact transcript text that grounds this claim. */
  readonly rawText: string;
  /** Text after phonetic normalisation. */
  readonly normalizedText?: string;
  /** The identified speaker of this specific utterance. */
  readonly speaker?: FactSpeaker;
  /** Audio start time in milliseconds (ONLY if authentically provided by ASR). */
  readonly startMs?: number;
  /** Audio end time in milliseconds (ONLY if authentically provided by ASR). */
  readonly endMs?: number;
  /** Source of this evidence span. */
  readonly source?: 'asr' | 'transcript' | 'manual';
  /** Source of timestamps, if timestamps are present. */
  readonly timestampSource?: 'asr' | 'manual';
}

// ============================================================================
// 4. SPECIALIZED FACT VALUE PAYLOADS (DISCRIMINATED SCHEMA)
// ============================================================================

export interface ChiefComplaintValue {
  readonly complaint: string;
  readonly duration?: string;
  readonly severity?: string;
}

export interface SymptomValue {
  readonly description: string;
  readonly severity?: string;
  readonly onset?: string;
  readonly aggravatingFactors?: ReadonlyArray<string>;
  readonly relievingFactors?: ReadonlyArray<string>;
  readonly patientPhrase?: string;
}

export interface MedicalHistoryValue {
  readonly condition: string;
  readonly status?: 'active' | 'managed' | 'resolved';
  readonly notes?: string;
}

export interface DentalHistoryValue {
  readonly summary: string;
  readonly previousDentist?: string;
  readonly lastDentalVisit?: string;
}

export interface MedicationValue {
  readonly drugName: string;
  readonly genericName?: string;
  readonly dose?: string;
  readonly frequency?: string;
  readonly category?: 'anticoagulant' | 'antiplatelet' | 'antiresorptive' | 'corticosteroid' | 'other';
  readonly mronjRisk?: boolean;
  readonly bleedingRisk?: boolean;
}

export interface AllergyValue {
  readonly allergen: string;
  readonly reaction?: string;
  readonly severity?: 'mild' | 'moderate' | 'severe' | 'life_threatening';
}

export interface VitalValue {
  readonly bloodPressure?: string;
  readonly pulseBpm?: number;
  readonly oxygenSaturation?: number;
  readonly temperatureC?: number;
}

export interface ExaminationValue {
  readonly site: string;
  readonly finding: string;
  readonly normal?: boolean;
}

export interface ToothFindingValue {
  readonly condition: string;
  readonly depth?: 'enamel' | 'dentine' | 'pulpal_involvement';
  readonly vitality?: {
    readonly coldTest?: 'normal' | 'lingering_positive' | 'negative' | 'exaggerated';
    readonly percussion?: 'positive' | 'negative' | 'tender';
    readonly eptValue?: number;
    readonly palpation?: 'positive' | 'negative';
  };
  readonly mobilityGrade?: '0' | 'I' | 'II' | 'III';
  readonly details?: string;
}

export interface PeriodontalFindingValue {
  readonly bpeScores?: ReadonlyArray<string>;
  readonly probingDepthsMm?: ReadonlyArray<{ readonly tooth: number; readonly site: string; readonly depth: number }>;
  readonly bleedingOnProbing?: boolean;
  readonly suppuration?: boolean;
  readonly furcationInvolvement?: { readonly tooth: number; readonly class: 'I' | 'II' | 'III' };
  readonly calculus?: 'supragingival' | 'subgingival' | 'both' | 'none';
  readonly diagnosis?: string;
}

export interface SoftTissueFindingValue {
  readonly location: string;
  readonly description: string;
  readonly dimensionsMm?: string;
  readonly pathologySuspected?: boolean;
}

export interface RadiographicFindingValue {
  readonly modality: 'bitewing' | 'periapical' | 'opg' | 'cbct';
  readonly finding: string;
  readonly teeth?: ReadonlyArray<number>;
}

export interface DiagnosisValue {
  readonly condition: string;
  readonly provisional: boolean;
  readonly teethInvolved?: ReadonlyArray<number>;
  readonly differentialDiagnoses?: ReadonlyArray<string>;
}

export interface DifferentialDiagnosisValue {
  readonly conditions: ReadonlyArray<string>;
  readonly primarySuspect?: string;
}

export interface ProcedureValue {
  readonly name: string;
  readonly adaCode?: string;
  readonly technique?: string;
  readonly isolation?: 'Rubber dam' | 'Cotton roll and gauze' | 'Gingival barrier' | 'None';
  readonly materialsUsed?: ReadonlyArray<string>;
  readonly details?: string;
}

export interface AnaestheticValue {
  readonly agent: string;
  readonly adrenaline?: string;
  readonly volumeMl?: number;
  readonly cartridges?: number;
  readonly technique: string;
  readonly topicalUsed?: boolean;
  readonly topicalAgent?: string;
  readonly profoundAnaesthesiaAchieved?: boolean;
}

export interface MaterialValue {
  readonly name: string;
  readonly brand?: string;
  readonly shade?: string;
  readonly category?: string;
}

export interface MedicationInstructionValue {
  readonly drug: string;
  readonly dose: string;
  readonly frequency: string;
  readonly duration: string;
  readonly instructions?: string;
}

export interface OralHygieneInstructionValue {
  readonly instruction: string;
  readonly aidsRecommended?: ReadonlyArray<string>;
}

export interface RiskFactorValue {
  readonly factor: string;
  readonly clinicalImplication?: string;
}

export interface TreatmentPlanValue {
  readonly phase?: number;
  readonly proposedProcedures: ReadonlyArray<string>;
  readonly estimatedCost?: string;
  readonly priority?: 'immediate' | 'urgent' | 'elective';
}

export interface RecallPlanValue {
  readonly intervalMonths: number;
  readonly reason?: string;
}

export interface ReferralValue {
  readonly specialty: string;
  readonly specialistName?: string;
  readonly urgency?: string;
  readonly reason: string;
}

export interface FollowUpValue {
  readonly timeframe: string;
  readonly action: string;
}

export interface InformedConsentValue {
  readonly procedureDiscussed: string;
  readonly materialRisksWarned: ReadonlyArray<string>;
  readonly alternativesDiscussed: ReadonlyArray<string>;
  readonly patientResponse: 'verbally_consented' | 'requested_time' | 'declined' | 'ambiguous';
  readonly costsDiscussed?: string;
}

export interface DeclinedTreatmentValue {
  readonly proposedTreatment: string;
  readonly reasonGiven?: string;
  readonly risksAcknowledged?: boolean;
}

export interface PostoperativeInstructionValue {
  readonly instructions: ReadonlyArray<string>;
  readonly emergencyContactProvided?: boolean;
}

/**
 * Compile-time mapping from ClinicalFactType to specialized payload.
 */
export interface FactValueTypeMap {
  chief_complaint: ChiefComplaintValue;
  symptom: SymptomValue;
  medical_history: MedicalHistoryValue;
  dental_history: DentalHistoryValue;
  medication: MedicationValue;
  allergy: AllergyValue;
  vital: VitalValue;
  examination: ExaminationValue;
  tooth_finding: ToothFindingValue;
  periodontal_finding: PeriodontalFindingValue;
  soft_tissue_finding: SoftTissueFindingValue;
  radiographic_finding: RadiographicFindingValue;
  diagnosis: DiagnosisValue;
  differential_diagnosis: DifferentialDiagnosisValue;
  procedure: ProcedureValue;
  anaesthetic: AnaestheticValue;
  material: MaterialValue;
  medication_instruction: MedicationInstructionValue;
  oral_hygiene_instruction: OralHygieneInstructionValue;
  risk_factor: RiskFactorValue;
  treatment_plan: TreatmentPlanValue;
  recall_plan: RecallPlanValue;
  referral: ReferralValue;
  follow_up: FollowUpValue;
  consent: InformedConsentValue;
  declined_treatment: DeclinedTreatmentValue;
  postoperative_instruction: PostoperativeInstructionValue;
}

export type FactValue = FactValueTypeMap[ClinicalFactType];

// ============================================================================
// 5. UNTRUSTED CANDIDATE VS CANONICAL CLINICAL FACT
// ============================================================================

/**
 * Untrusted candidate fact proposed by extraction engines or models.
 * Has not passed deterministic domain validation or trust boundary checks.
 */
export interface CandidateClinicalFact {
  readonly id?: string;
  readonly type: ClinicalFactType;
  readonly speaker: FactSpeaker;
  readonly evidenceType: FactEvidenceType;
  readonly value: unknown;
  readonly status?: FactStatus;
  readonly temporal?: FactTemporalContext;
  readonly certainty?: FactCertainty;
  readonly extractionMethod?: FactExtractionMethod;
  readonly anatomy?: {
    readonly teeth?: ReadonlyArray<number | ToothReference>;
    readonly surfaces?: ReadonlyArray<DentalSurface | string>;
    readonly canonicalSurfaces?: string;
    readonly quadrant?: 1 | 2 | 3 | 4;
    readonly sextant?: 1 | 2 | 3 | 4 | 5 | 6;
    readonly arch?: 'maxillary' | 'mandibular';
    readonly softTissueSite?: string;
  };
  readonly evidence?: ReadonlyArray<EvidenceSpan>;
  readonly confidence?: number;
  readonly negationScope?: string;
}

/**
 * Base common properties of a canonical fact.
 */
export interface BaseClinicalFact {
  readonly id: string;
  readonly speaker: FactSpeaker;
  readonly evidenceType: FactEvidenceType;
  readonly status: FactStatus;
  readonly temporal: FactTemporalContext;
  readonly certainty: FactCertainty;
  readonly extractionMethod: FactExtractionMethod;
  readonly anatomy?: DentalAnatomyTarget;
  readonly evidence: ReadonlyArray<EvidenceSpan>;
  readonly validationState: FactValidationState;
  readonly verificationState: FactVerificationState;
  readonly verificationMethod: FactVerificationMethod;
  readonly confidence?: number;
  readonly validationWarnings?: ReadonlyArray<string>;
  readonly negationScope?: string;
}

/**
 * Discriminated canonical fact: type strictly dictates value.
 */
export type TypedClinicalFact<T extends ClinicalFactType> = BaseClinicalFact & {
  readonly type: T;
  readonly value: FactValueTypeMap[T];
};

/**
 * Canonical validated domain assertion.
 */
export type ClinicalFact = {
  [K in ClinicalFactType]: TypedClinicalFact<K>;
}[ClinicalFactType];

// ============================================================================
// 6. RUNTIME ENUM MEMBERSHIP (THE TRUST BOUNDARY)
// ============================================================================

/**
 * QLE-2026-0005: every guard below (the status × temporal matrix, the epistemic
 * checks, the renderer) compares against lowercase literals with `===`. Nothing
 * validated *membership* first, so a candidate carrying `status: 'PERFORMED'`
 * — or `'made_up'`, or `speaker: 'robot'` — matched no rule, fell through the
 * whole matrix, and was minted as a canonical `valid` fact. The matrix only
 * forbids what it recognises; unknown values have to be refused before it.
 *
 * Each table is declared as `Record<Union, true>` so the compiler fails the
 * build if a member is ever added to or removed from the union without the
 * table being updated. The tables cannot drift from the types.
 */
export const FACT_SPEAKER_MEMBERS: Readonly<Record<FactSpeaker, true>> = {
  patient: true, clinician: true, assistant: true, unknown: true
};

export const FACT_EVIDENCE_TYPE_MEMBERS: Readonly<Record<FactEvidenceType, true>> = {
  patient_reported: true, clinician_observed: true, clinician_interpretation: true,
  instruction: true, discussion: true
};

export const FACT_STATUS_MEMBERS: Readonly<Record<FactStatus, true>> = {
  performed: true, observed: true, reported: true, planned: true, discussed: true,
  declined: true, historical: true, negated: true, unknown: true
};

export const FACT_TEMPORAL_MEMBERS: Readonly<Record<FactTemporalContext, true>> = {
  current: true, historical: true, planned: true, future: true, completed_today: true,
  past_appointment: true, previous_appointment: true, next_appointment: true
};

export const FACT_CERTAINTY_MEMBERS: Readonly<Record<FactCertainty, true>> = {
  certain: true, uncertain: true, conflicting: true
};

export const FACT_EXTRACTION_METHOD_MEMBERS: Readonly<Record<FactExtractionMethod, true>> = {
  verbatim: true, normalized: true, model_extracted: true, inferred: true
};

export type FactEnumCheck<T extends string> =
  | { readonly ok: true; readonly value: T | undefined }
  | { readonly ok: false; readonly error: string };

/**
 * Resolves one candidate enum field against its membership table.
 *
 * - absent/null → ok with `undefined` (the caller's default applies)
 * - a recognised member in any casing/whitespace → ok with the canonical member,
 *   so a clinically meaningful assertion is normalised rather than discarded
 * - anything else → refused, with the offending field and value named
 */
export function checkFactEnumMember<T extends string>(
  field: string,
  raw: unknown,
  members: Readonly<Record<T, true>>
): FactEnumCheck<T> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (typeof raw !== 'string') {
    return { ok: false, error: `Invalid ${field} '${String(raw)}'. Must be one of: ${Object.keys(members).join(', ')}.` };
  }
  const needle = raw.trim().toLowerCase();
  for (const member of Object.keys(members) as T[]) {
    if (member === needle) return { ok: true, value: member };
  }
  return { ok: false, error: `Unknown ${field} '${raw}'. Must be one of: ${Object.keys(members).join(', ')}.` };
}

// ============================================================================
// 7. STATUS × TEMPORAL COMPATIBILITY MATRIX
// ============================================================================

export interface StatusTemporalRule {
  readonly allowed: boolean;
  readonly reason?: string;
}

/**
 * Central deterministic compatibility matrix for FactStatus × FactTemporalContext.
 */
export function checkStatusTemporalCompatibility(
  status: FactStatus,
  temporal: FactTemporalContext
): StatusTemporalRule {
  // 1. Performed cannot be scheduled in the future or next appointment
  if (status === 'performed') {
    if (temporal === 'next_appointment' || temporal === 'future' || temporal === 'planned') {
      return {
        allowed: false,
        reason: `Temporal Conflict: A 'performed' procedure cannot be scheduled for '${temporal}'.`
      };
    }
  }

  // 2. Planned cannot be completed in the past or completed today
  if (status === 'planned') {
    if (temporal === 'completed_today' || temporal === 'historical' || temporal === 'previous_appointment') {
      return {
        allowed: false,
        reason: `Temporal Conflict: A 'planned' procedure cannot have temporal status '${temporal}'.`
      };
    }
  }

  // 3. Observed cannot be located in the future or next appointment
  if (status === 'observed') {
    if (temporal === 'next_appointment' || temporal === 'future') {
      return {
        allowed: false,
        reason: `Temporal Conflict: An 'observed' finding cannot have future temporal reference '${temporal}'.`
      };
    }
  }

  // 4. Reported cannot be located in the future or next appointment
  if (status === 'reported') {
    if (temporal === 'next_appointment' || temporal === 'future') {
      return {
        allowed: false,
        reason: `Temporal Conflict: A 'reported' symptom cannot refer to future appointment '${temporal}'.`
      };
    }
  }

  // 5. Historical cannot be completed today or current
  if (status === 'historical') {
    if (temporal === 'completed_today' || temporal === 'current' || temporal === 'next_appointment' || temporal === 'future') {
      return {
        allowed: false,
        reason: `Temporal Conflict: A 'historical' fact cannot have temporal reference '${temporal}'.`
      };
    }
  }

  return { allowed: true };
}

// ============================================================================
// 7. FDI METADATA INTEGRITY
// ============================================================================

export function validateToothReferenceMetadata(ref: ToothReference): { isValid: boolean; error?: string } {
  const toothNum = ref.tooth;
  const isValidPermanent = toothNum >= 11 && toothNum <= 48 && (toothNum % 10 >= 1 && toothNum % 10 <= 8);
  const isValidDeciduous = toothNum >= 51 && toothNum <= 85 && (toothNum % 10 >= 1 && toothNum % 10 <= 5);

  if (!isValidPermanent && !isValidDeciduous) {
    return { isValid: false, error: `Invalid FDI tooth number '${toothNum}'. Must be ISO 3950 (11-48, 51-85).` };
  }

  const quadrant = Math.floor(toothNum / 10);
  const position = toothNum % 10;
  const expectedDentition = quadrant >= 5 && quadrant <= 8 ? 'deciduous' : 'permanent';

  if (ref.dentition !== expectedDentition) {
    return {
      isValid: false,
      error: `Metadata Conflict: Tooth ${toothNum} is ${expectedDentition}, but metadata asserts '${ref.dentition}'.`
    };
  }
  if (ref.quadrant !== quadrant) {
    return {
      isValid: false,
      error: `Metadata Conflict: Tooth ${toothNum} is in quadrant ${quadrant}, but metadata asserts quadrant '${ref.quadrant}'.`
    };
  }
  if (ref.position !== position) {
    return {
      isValid: false,
      error: `Metadata Conflict: Tooth ${toothNum} is position ${position}, but metadata asserts position '${ref.position}'.`
    };
  }

  return { isValid: true };
}

// ============================================================================
// 8. DETERMINISTIC DOMAIN VALIDATOR
// ============================================================================

export interface FactValidationResult {
  readonly isValid: boolean;
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}

/**
 * Deterministically checks all clinical and structural invariants of a ClinicalFact.
 */
export function validateClinicalFactInvariants(fact: ClinicalFact): FactValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Invariant 1: Valid ID and Type
  if (!fact.id || typeof fact.id !== 'string') {
    errors.push('Fact missing valid immutable string id');
  }
  if (!fact.type) {
    errors.push('Fact missing clinical fact type');
  }

  // Invariant 2: Epistemic attribution consistency
  if (fact.speaker === 'patient' && fact.evidenceType === 'clinician_observed') {
    errors.push('Epistemic Conflict: Patient statements cannot have evidenceType clinician_observed');
  }
  if (fact.speaker === 'clinician' && fact.evidenceType === 'patient_reported') {
    warnings.push('Epistemic Alignment Notice: Clinician speaker marked with patient_reported evidence');
  }

  // Invariant 3: Speaker vs Evidence Span Consistency
  if (fact.evidence && fact.evidence.length > 0) {
    for (const span of fact.evidence) {
      if (span.speaker && fact.speaker !== 'unknown' && span.speaker !== 'unknown') {
        if (fact.speaker !== span.speaker) {
          warnings.push(`Speaker Mismatch: Fact speaker '${fact.speaker}' differs from evidence utterance speaker '${span.speaker}' (utterance ${span.utteranceId}).`);
        }
      }
    }
  }

  // Invariant 4: Status × Temporal Compatibility Matrix
  const statusTemporalCheck = checkStatusTemporalCompatibility(fact.status, fact.temporal);
  if (!statusTemporalCheck.allowed && statusTemporalCheck.reason) {
    errors.push(statusTemporalCheck.reason);
  }

  // Invariant 5: Anatomical FDI and Surface Consistency
  if (fact.anatomy?.teeth && fact.anatomy.teeth.length > 0) {
    for (const toothRef of fact.anatomy.teeth) {
      const toothCheck = validateToothReferenceMetadata(toothRef);
      if (!toothCheck.isValid && toothCheck.error) {
        errors.push(toothCheck.error);
      }

      const position = toothRef.tooth % 10;
      const isAnterior = position <= 3;
      const isPosterior = !isAnterior;

      if (fact.anatomy.surfaces) {
        if (isAnterior && fact.anatomy.surfaces.includes('O')) {
          errors.push(`Anatomical Conflict: Anterior tooth ${toothRef.tooth} cannot have an Occlusal (O) surface.`);
        }
        if (isPosterior && fact.anatomy.surfaces.includes('I')) {
          errors.push(`Anatomical Conflict: Posterior tooth ${toothRef.tooth} cannot have an Incisal (I) edge.`);
        }
      }
    }
  }

  // Invariant 6: Timestamp Sanity & Anti-Synthesis Check
  if (fact.evidence) {
    for (const span of fact.evidence) {
      if (span.startMs !== undefined && span.endMs !== undefined) {
        if (span.startMs < 0 || span.endMs < 0) {
          errors.push(`Invalid timestamp span: negative milliseconds (${span.startMs} - ${span.endMs})`);
        }
        if (span.startMs > span.endMs) {
          errors.push(`Invalid timestamp span: startMs (${span.startMs}) cannot exceed endMs (${span.endMs})`);
        }
      }
    }
  }

  // Invariant 7: Confidence range validation
  if (fact.confidence !== undefined) {
    if (
      typeof fact.confidence !== 'number' ||
      isNaN(fact.confidence) ||
      !isFinite(fact.confidence) ||
      fact.confidence < 0 ||
      fact.confidence > 1
    ) {
      errors.push(`Invalid confidence: must be a finite number between 0.0 and 1.0 (got ${fact.confidence}).`);
    }
  }

  // Invariant 8: Negation Semantics
  if (fact.status === 'negated') {
    if (fact.certainty === 'conflicting') {
      warnings.push('Negated fact flagged as conflicting certainty.');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}
