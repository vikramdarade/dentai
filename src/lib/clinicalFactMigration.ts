/**
 * Clinical Fact Migration & Controlled Construction Pathway (Phase 3 Architecture)
 *
 * Implements:
 * 1. Single authoritative canonical construction pathway:
 *    createCanonicalClinicalFact(candidate: CandidateClinicalFact): FactConstructionResult
 * 2. Discriminated payload normalization (no Record<string, unknown> loopholes)
 * 3. Bidirectional migration between ClinicalFact[] and legacy ClinicalFindings
 */

import {
  ClinicalFact,
  CandidateClinicalFact,
  ToothReference,
  DentalSurface,
  validateClinicalFactInvariants,
  validateToothReferenceMetadata,
  FactValidationResult,
  FactSpeaker,
  FactEvidenceType,
  FactStatus,
  FactTemporalContext,
  FactCertainty,
  FactExtractionMethod,
  EvidenceSpan,
  DentalAnatomyTarget,
  ClinicalFactType,
  FactValueTypeMap,
  FACT_SPEAKER_MEMBERS,
  FACT_EVIDENCE_TYPE_MEMBERS,
  FACT_STATUS_MEMBERS,
  FACT_TEMPORAL_MEMBERS,
  FACT_CERTAINTY_MEMBERS,
  FACT_EXTRACTION_METHOD_MEMBERS,
  checkFactEnumMember
} from '../types/clinicalFact';
import type { ClinicalFindings, AdaCodeItem } from '../types';
import { isValidFdiTooth } from './fdiNotationEngine';

// ============================================================================
// 1. CANONICAL FACT CONSTRUCTION RESULT & PATHWAY
// ============================================================================

export type FactConstructionResult =
  | { readonly success: true; readonly fact: ClinicalFact; readonly warnings: ReadonlyArray<string> }
  | { readonly success: false; readonly errors: ReadonlyArray<string>; readonly warnings: ReadonlyArray<string> };

export function isFactConstructionFailure(
  res: FactConstructionResult
): res is { readonly success: false; readonly errors: ReadonlyArray<string>; readonly warnings: ReadonlyArray<string> } {
  return res.success === false;
}

/**
 * Creates a validated ToothReference instance with internal consistency checks.
 */
export function createToothReference(toothNum: number, rawMention?: string): ToothReference {
  const quadrant = Math.floor(toothNum / 10);
  const position = toothNum % 10;
  const isDeciduous = quadrant >= 5 && quadrant <= 8;

  const ref: ToothReference = {
    tooth: toothNum,
    dentition: isDeciduous ? 'deciduous' : 'permanent',
    quadrant,
    position,
    rawMention
  };

  const check = validateToothReferenceMetadata(ref);
  if (!check.isValid && check.error) {
    throw new Error(check.error);
  }

  return ref;
}

/**
 * Safely normalizes untrusted candidate value into the strictly typed payload
 * for the given ClinicalFactType. Rejects invalid or contradictory values.
 */
function normalizeCandidateValue(type: ClinicalFactType, rawValue: unknown): { value?: any; error?: string } {
  if (rawValue === undefined || rawValue === null) {
    return { error: `Fact value for '${type}' cannot be null or undefined.` };
  }

  // 1. Chief Complaint
  if (type === 'chief_complaint') {
    if (typeof rawValue === 'string') return { value: { complaint: rawValue } };
    if (typeof rawValue === 'object' && rawValue !== null && 'complaint' in rawValue) {
      return { value: rawValue };
    }
    return { error: `Invalid value for chief_complaint: expected string or { complaint: string }` };
  }

  // 2. Symptom
  if (type === 'symptom') {
    if (typeof rawValue === 'string') return { value: { description: rawValue } };
    if (typeof rawValue === 'object' && rawValue !== null) {
      const v = rawValue as any;
      if (typeof v.description === 'string' || typeof v.condition === 'string' || typeof v.patientPhrase === 'string') {
        return {
          value: {
            description: v.description || v.condition || v.patientPhrase,
            severity: v.severity,
            onset: v.onset,
            patientPhrase: v.patientPhrase
          }
        };
      }
    }
    return { error: `Invalid value for symptom: expected string or { description: string }` };
  }

  // 3. Tooth Finding
  if (type === 'tooth_finding') {
    if (typeof rawValue === 'string') return { value: { condition: rawValue } };
    if (typeof rawValue === 'object' && rawValue !== null && 'condition' in rawValue) {
      return { value: rawValue };
    }
    return { error: `Invalid value for tooth_finding: expected string or { condition: string }` };
  }

  // 4. Procedure
  if (type === 'procedure') {
    if (typeof rawValue === 'string') return { value: { name: rawValue } };
    if (typeof rawValue === 'object' && rawValue !== null && 'name' in rawValue) {
      return { value: rawValue };
    }
    return { error: `Invalid value for procedure: expected string or { name: string }` };
  }

  // 5. Diagnosis
  if (type === 'diagnosis') {
    if (typeof rawValue === 'string') return { value: { condition: rawValue, provisional: false } };
    if (typeof rawValue === 'object' && rawValue !== null && 'condition' in rawValue) {
      return { value: rawValue };
    }
    return { error: `Invalid value for diagnosis: expected string or { condition: string }` };
  }

  // 6. Allergy
  if (type === 'allergy') {
    if (typeof rawValue === 'string') return { value: { allergen: rawValue } };
    if (typeof rawValue === 'object' && rawValue !== null && 'allergen' in rawValue) {
      return { value: rawValue };
    }
    return { error: `Invalid value for allergy: expected string or { allergen: string }` };
  }

  // 7. Medication
  if (type === 'medication') {
    if (typeof rawValue === 'string') return { value: { drugName: rawValue } };
    if (typeof rawValue === 'object' && rawValue !== null && 'drugName' in rawValue) {
      return { value: rawValue };
    }
    return { error: `Invalid value for medication: expected string or { drugName: string }` };
  }

  // 8. Anaesthetic
  if (type === 'anaesthetic') {
    if (typeof rawValue === 'object' && rawValue !== null && 'agent' in rawValue && 'technique' in rawValue) {
      return { value: rawValue };
    }
    return { error: `Invalid value for anaesthetic: expected { agent: string, technique: string }` };
  }

  // 9. Periodontal Finding
  if (type === 'periodontal_finding') {
    if (typeof rawValue === 'string') return { value: { diagnosis: rawValue } };
    if (typeof rawValue === 'object' && rawValue !== null) {
      return { value: rawValue };
    }
    return { error: `Invalid value for periodontal_finding: expected { bpeScores?, probingDepthsMm?, diagnosis? }` };
  }

  // 10. Treatment Plan
  if (type === 'treatment_plan') {
    if (typeof rawValue === 'string') return { value: { proposedProcedures: [rawValue] } };
    if (typeof rawValue === 'object' && rawValue !== null) {
      const v = rawValue as any;
      if (Array.isArray(v.proposedProcedures)) return { value: rawValue };
      if (typeof v.procedure === 'string') return { value: { proposedProcedures: [v.procedure], ...v } };
    }
    return { error: `Invalid value for treatment_plan: expected { proposedProcedures: string[] }` };
  }

  // 11. Consent
  if (type === 'consent') {
    if (typeof rawValue === 'object' && rawValue !== null && 'procedureDiscussed' in rawValue && 'patientResponse' in rawValue) {
      return { value: rawValue };
    }
    return { error: `Invalid value for consent: expected { procedureDiscussed: string, patientResponse: string }` };
  }

  // Fallback for remaining structured types:
  if (typeof rawValue === 'object' && rawValue !== null) {
    return { value: rawValue };
  }
  if (typeof rawValue === 'string') {
    return { value: { text: rawValue, details: rawValue } as any };
  }

  return { error: `Unsupported value payload for fact type '${type}'.` };
}

/**
 * Authoritative construction pathway: validates untrusted candidate into canonical ClinicalFact.
 */
export function createCanonicalClinicalFact(candidate: CandidateClinicalFact): FactConstructionResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const factId = candidate.id || `fact-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  // 1. Validate and normalize specialized value payload
  const normVal = normalizeCandidateValue(candidate.type, candidate.value);
  if (normVal.error) {
    errors.push(normVal.error);
  }

  // 2. Normalise and validate teeth references
  let anatomy: DentalAnatomyTarget | undefined = undefined;
  if (candidate.anatomy) {
    const teethRefs: ToothReference[] = [];
    if (candidate.anatomy.teeth) {
      for (const t of candidate.anatomy.teeth) {
        if (typeof t === 'number') {
          try {
            teethRefs.push(createToothReference(t));
          } catch (e: any) {
            errors.push(e.message || String(e));
          }
        } else if (typeof t === 'object' && t !== null && 'tooth' in t) {
          const toothCheck = validateToothReferenceMetadata(t);
          if (!toothCheck.isValid && toothCheck.error) {
            errors.push(toothCheck.error);
          } else {
            teethRefs.push(t);
          }
        }
      }
    }

    const surfaces = candidate.anatomy.surfaces as DentalSurface[] | undefined;
    anatomy = {
      teeth: teethRefs,
      surfaces,
      canonicalSurfaces: candidate.anatomy.canonicalSurfaces || (surfaces ? surfaces.join('') : undefined),
      quadrant: candidate.anatomy.quadrant,
      sextant: candidate.anatomy.sextant,
      arch: candidate.anatomy.arch,
      softTissueSite: candidate.anatomy.softTissueSite
    };
  }

  // 3. Normalise evidence spans and preserve authenticity
  const evidenceSpans: EvidenceSpan[] = (candidate.evidence || []).map(span => ({
    utteranceId: span.utteranceId,
    rawText: span.rawText,
    normalizedText: span.normalizedText,
    speaker: span.speaker,
    startMs: span.startMs,
    endMs: span.endMs,
    source: span.source || 'transcript',
    timestampSource: span.timestampSource || (span.startMs !== undefined ? 'asr' : undefined)
  }));

  // 4. QLE-2026-0005 — enum membership at the trust boundary.
  //
  // Everything below compares lowercase literals with `===`, so before this
  // guard a candidate carrying `status: 'PERFORMED'`, `temporal: 'FUTURE'` or
  // an invented `speaker: 'robot'` / `evidenceType: 'made_up'` matched no rule,
  // passed the whole matrix unexamined, and was minted as a canonical `valid`
  // fact — exactly what the matrix exists to forbid. Membership is checked
  // here, before the matrix; a recognised case/whitespace variant is normalised
  // to the canonical member so a real clinical assertion is not discarded, and
  // an unknown value refuses construction (fail closed).
  const speakerCheck = checkFactEnumMember('speaker', candidate.speaker, FACT_SPEAKER_MEMBERS);
  const evidenceTypeCheck = checkFactEnumMember('evidenceType', candidate.evidenceType, FACT_EVIDENCE_TYPE_MEMBERS);
  const statusCheck = checkFactEnumMember('status', candidate.status, FACT_STATUS_MEMBERS);
  const temporalCheck = checkFactEnumMember('temporal', candidate.temporal, FACT_TEMPORAL_MEMBERS);
  const certaintyCheck = checkFactEnumMember('certainty', candidate.certainty, FACT_CERTAINTY_MEMBERS);
  const extractionCheck = checkFactEnumMember('extractionMethod', candidate.extractionMethod, FACT_EXTRACTION_METHOD_MEMBERS);
  const enumChecks = [speakerCheck, evidenceTypeCheck, statusCheck, temporalCheck, certaintyCheck, extractionCheck];
  for (const check of enumChecks) {
    if (!check.ok) errors.push((check as { ok: false; error: string }).error);
  }

  // 5. Map extractionMethod and certainty
  const extractionMethod: FactExtractionMethod = (extractionCheck.ok && extractionCheck.value) || 'model_extracted';
  const certainty: FactCertainty = (certaintyCheck.ok && certaintyCheck.value) || 'certain';

  // Assemble canonical candidate
  const fact: ClinicalFact = {
    id: factId,
    type: candidate.type,
    speaker: (speakerCheck.ok && speakerCheck.value) || candidate.speaker,
    evidenceType: (evidenceTypeCheck.ok && evidenceTypeCheck.value) || candidate.evidenceType,
    value: normVal.value,
    status: (statusCheck.ok && statusCheck.value) || 'observed',
    temporal: (temporalCheck.ok && temporalCheck.value) || 'current',
    certainty,
    extractionMethod,
    anatomy,
    evidence: evidenceSpans,
    validationState: 'valid',
    verificationState: 'unverified',
    verificationMethod: 'none',
    confidence: candidate.confidence,
    negationScope: candidate.negationScope
  } as ClinicalFact;

  // 6. Enforce deterministic domain invariants
  const invariantCheck = validateClinicalFactInvariants(fact);
  if (!invariantCheck.isValid) {
    errors.push(...invariantCheck.errors);
  }
  if (invariantCheck.warnings.length > 0) {
    warnings.push(...invariantCheck.warnings);
  }

  if (errors.length > 0) {
    return {
      success: false,
      errors,
      warnings
    };
  }

  // Attach warnings if present
  if (warnings.length > 0) {
    (fact as any).validationWarnings = warnings;
    (fact as any).validationState = 'warning';
  }

  return {
    success: true,
    fact,
    warnings
  };
}

/**
 * Backward-compatible helper for tests and adapters:
 * constructs a ClinicalFact directly or attaches validation errors as warnings.
 */
export function createClinicalFact(params: {
  id?: string;
  type: ClinicalFact['type'];
  speaker: FactSpeaker;
  evidenceType: FactEvidenceType;
  value: unknown;
  status?: FactStatus;
  temporal?: FactTemporalContext;
  certainty?: FactCertainty;
  extractionMethod?: FactExtractionMethod;
  teeth?: number[];
  surfaces?: DentalSurface[];
  rawText?: string;
  utteranceId?: string;
  startMs?: number;
  endMs?: number;
  confidence?: number;
}): ClinicalFact {
  const candidate: CandidateClinicalFact = {
    id: params.id,
    type: params.type,
    speaker: params.speaker,
    evidenceType: params.evidenceType,
    value: params.value,
    status: params.status || 'observed',
    temporal: params.temporal || 'current',
    certainty: params.certainty || 'certain',
    extractionMethod: params.extractionMethod || 'model_extracted',
    anatomy: {
      teeth: params.teeth,
      surfaces: params.surfaces
    },
    evidence: params.rawText && params.utteranceId ? [{
      utteranceId: params.utteranceId,
      rawText: params.rawText,
      speaker: params.speaker,
      startMs: params.startMs,
      endMs: params.endMs,
      source: 'transcript'
    }] : [],
    confidence: params.confidence
  };

  const result = createCanonicalClinicalFact(candidate);
  if (isFactConstructionFailure(result)) {
    const fallbackFact: ClinicalFact = {
      id: candidate.id || `fact-fallback-${Date.now()}`,
      type: candidate.type,
      speaker: candidate.speaker,
      evidenceType: candidate.evidenceType,
      value: candidate.value as any,
      status: candidate.status || 'observed',
      temporal: candidate.temporal || 'current',
      certainty: candidate.certainty || 'certain',
      extractionMethod: candidate.extractionMethod || 'model_extracted',
      anatomy: candidate.anatomy as any,
      evidence: candidate.evidence as any || [],
      validationState: 'invalid',
      verificationState: 'unverified',
      verificationMethod: 'none',
      validationWarnings: result.errors.concat(result.warnings)
    } as ClinicalFact;

    return fallbackFact;
  }

  return result.fact;
}

// ============================================================================
// 2. MIGRATION ADAPTERS: ClinicalFact[] <-> Legacy Models
// ============================================================================

/**
 * Renders an array of validated ClinicalFacts into the legacy ClinicalFindings format.
 */
export function adaptFactsToLegacyFindings(facts: ClinicalFact[]): ClinicalFindings {
  const chiefComplaints: string[] = [];
  const histories: string[] = [];
  const toothFindings: string[] = [];
  const findingsGingival: string[] = [];
  const diagnoses: string[] = [];
  const treatmentsPerformed: string[] = [];
  const recommendations: string[] = [];
  const recallRequirements: string[] = [];
  const adaCodes: AdaCodeItem[] = [];

  for (const fact of facts) {
    // 1. Chief Complaint & Symptoms
    if (fact.type === 'chief_complaint' || (fact.type === 'symptom' && fact.evidenceType === 'patient_reported')) {
      const val = fact.value as any;
      const text = typeof val === 'string' ? val : val?.complaint || val?.description || val?.patientPhrase || JSON.stringify(val);
      if (fact.status === 'negated') {
        chiefComplaints.push(`Patient denies ${text}.`);
      } else {
        chiefComplaints.push(text);
      }
    }

    // 2. Medical / Dental History & Allergies
    if (fact.type === 'medical_history' || fact.type === 'dental_history' || fact.type === 'allergy' || fact.type === 'medication') {
      if (fact.type === 'allergy') {
        const val = fact.value as any;
        const allergen = val.allergen || val;
        if (fact.status === 'negated') {
          histories.push(`No known allergy to ${allergen}.`);
        } else {
          histories.push(`Allergic to ${allergen}${val.reaction ? ` (${val.reaction})` : ''}.`);
        }
      } else if (fact.type === 'medication') {
        const val = fact.value as any;
        const medName = val.drugName || val;
        if (fact.status === 'negated') {
          histories.push(`Not taking ${medName}.`);
        } else {
          histories.push(`Takes ${medName}${val.dose ? ` ${val.dose}` : ''}${val.frequency ? ` ${val.frequency}` : ''}.`);
        }
      } else {
        const val = fact.value as any;
        const text = typeof val === 'string' ? val : val?.condition || val?.summary || JSON.stringify(val);
        histories.push(text);
      }
    }

    // 3. Tooth Findings & Examinations
    if (fact.type === 'tooth_finding' || fact.type === 'examination' || fact.type === 'radiographic_finding') {
      const teethStr = fact.anatomy?.teeth?.map(t => `#${t.tooth}`).join(', ') || '';
      const surfStr = fact.anatomy?.canonicalSurfaces ? ` (${fact.anatomy.canonicalSurfaces})` : '';
      const val = fact.value as any;
      const cond = typeof val === 'string' ? val : val?.condition || val?.finding || '';

      if (fact.status === 'negated') {
        toothFindings.push(`${teethStr}${surfStr}: No ${cond} detected.`);
      } else {
        toothFindings.push(`${teethStr}${surfStr}: ${cond}`.trim());
      }
    }

    // 4. Periodontal & Gingival Findings
    if (fact.type === 'periodontal_finding' || fact.type === 'soft_tissue_finding') {
      const val = fact.value as any;
      if (val?.diagnosis) {
        findingsGingival.push(val.diagnosis);
      } else if (val?.bpeScores) {
        findingsGingival.push(`BPE sextants: ${val.bpeScores.join(' ')}`);
      } else if (typeof fact.value === 'string') {
        findingsGingival.push(fact.value);
      } else if (val?.description) {
        findingsGingival.push(`${val.location ? `${val.location}: ` : ''}${val.description}`);
      }
    }

    // 5. Diagnoses
    if (fact.type === 'diagnosis' || fact.type === 'differential_diagnosis') {
      const val = fact.value as any;
      const diagStr = typeof val === 'string' ? val : val?.condition || val?.conditions?.join(', ') || '';
      const teethStr = fact.anatomy?.teeth?.map(t => `#${t.tooth}`).join(', ') || '';
      if (fact.status === 'negated') {
        diagnoses.push(`Ruled out: ${diagStr}${teethStr ? ` on ${teethStr}` : ''}`);
      } else {
        diagnoses.push(`${diagStr}${teethStr ? ` on ${teethStr}` : ''}`);
      }
    }

    // 6. Procedures / Treatment Performed
    if (fact.type === 'procedure' || fact.type === 'anaesthetic' || fact.type === 'material') {
      const teethStr = fact.anatomy?.teeth?.map(t => `#${t.tooth}`).join(', ') || '';
      const surfStr = fact.anatomy?.canonicalSurfaces ? ` (${fact.anatomy.canonicalSurfaces})` : '';

      if (fact.type === 'procedure') {
        const val = fact.value as any;
        const procName = typeof val === 'string' ? val : val?.name || '';
        if (fact.status === 'performed' && (fact.temporal === 'completed_today' || fact.temporal === 'current')) {
          treatmentsPerformed.push(`Completed ${procName}${teethStr ? ` on ${teethStr}${surfStr}` : ''}.`);
          if (val?.adaCode) {
            adaCodes.push({ code: val.adaCode, description: procName, tooth: teethStr.replace('#', '') });
          }
        } else if (fact.status === 'planned' || fact.temporal === 'next_appointment' || fact.temporal === 'future') {
          recommendations.push(`Planned: ${procName}${teethStr ? ` on ${teethStr}${surfStr}` : ''}.`);
        } else if (fact.status === 'negated') {
          treatmentsPerformed.push(`No ${procName} performed today.`);
        }
      } else if (fact.type === 'anaesthetic' && fact.status === 'performed') {
        const val = fact.value as any;
        const laParts = [
          val.volumeMl ? `${val.volumeMl}ml` : '',
          val.agent || '',
          val.adrenaline ? `with ${val.adrenaline}` : '',
          val.technique || ''
        ].filter(Boolean);
        if (laParts.length > 0) {
          treatmentsPerformed.push(`LA: ${laParts.join(' ')}.`);
        }
      }
    }

    // 7. Recommendations & Postoperative Instructions
    if (fact.type === 'postoperative_instruction' || fact.type === 'oral_hygiene_instruction' || fact.type === 'consent') {
      const val = fact.value as any;
      const text = typeof val === 'string'
        ? val
        : val?.instructions?.join('. ') || val?.instruction || val?.procedureDiscussed || JSON.stringify(val);
      recommendations.push(text);
    }

    // 8. Recall Plan & Follow Up
    if (fact.type === 'recall_plan' || fact.type === 'follow_up') {
      const val = fact.value as any;
      const text = typeof val === 'string'
        ? val
        : val?.intervalMonths ? `Recall in ${val.intervalMonths} months${val.reason ? ` (${val.reason})` : ''}` : val?.action || JSON.stringify(val);
      recallRequirements.push(text);
    }
  }

  return {
    chiefComplaint: chiefComplaints.join('\n'),
    history: histories.join('\n'),
    toothFindings: toothFindings.join('\n'),
    findingsGingival: findingsGingival.join('\n'),
    diagnosis: diagnoses.join('\n'),
    treatmentPerformed: treatmentsPerformed.join('\n'),
    recommendations: recommendations.join('\n'),
    recallRequirements: recallRequirements.join('\n'),
    adaCodes: adaCodes.length > 0 ? adaCodes : undefined
  };
}

/**
 * Lifts a legacy ClinicalFindings record into baseline ClinicalFact[] entities.
 */
export function adaptLegacyFindingsToFacts(findings: ClinicalFindings): ClinicalFact[] {
  const facts: ClinicalFact[] = [];
  let counter = 1;

  if (findings.chiefComplaint?.trim()) {
    facts.push(createClinicalFact({
      id: `legacy-fact-${counter++}`,
      type: 'chief_complaint',
      speaker: 'patient',
      evidenceType: 'patient_reported',
      value: { complaint: findings.chiefComplaint.trim() },
      status: 'reported',
      temporal: 'current',
      certainty: 'certain',
      extractionMethod: 'model_extracted'
    }));
  }

  if (findings.history?.trim()) {
    facts.push(createClinicalFact({
      id: `legacy-fact-${counter++}`,
      type: 'medical_history',
      speaker: 'patient',
      evidenceType: 'patient_reported',
      value: { condition: findings.history.trim() },
      status: 'reported',
      temporal: 'current',
      certainty: 'certain',
      extractionMethod: 'model_extracted'
    }));
  }

  if (findings.toothFindings?.trim()) {
    facts.push(createClinicalFact({
      id: `legacy-fact-${counter++}`,
      type: 'tooth_finding',
      speaker: 'clinician',
      evidenceType: 'clinician_observed',
      value: { condition: findings.toothFindings.trim() },
      status: 'observed',
      temporal: 'current',
      certainty: 'certain',
      extractionMethod: 'model_extracted'
    }));
  }

  if (findings.treatmentPerformed?.trim()) {
    facts.push(createClinicalFact({
      id: `legacy-fact-${counter++}`,
      type: 'procedure',
      speaker: 'clinician',
      evidenceType: 'clinician_observed',
      value: { name: findings.treatmentPerformed.trim() },
      status: 'performed',
      temporal: 'completed_today',
      certainty: 'certain',
      extractionMethod: 'model_extracted'
    }));
  }

  if (findings.diagnosis?.trim()) {
    facts.push(createClinicalFact({
      id: `legacy-fact-${counter++}`,
      type: 'diagnosis',
      speaker: 'clinician',
      evidenceType: 'clinician_interpretation',
      value: { condition: findings.diagnosis.trim(), provisional: false },
      status: 'observed',
      temporal: 'current',
      certainty: 'certain',
      extractionMethod: 'model_extracted'
    }));
  }

  if (findings.recallRequirements?.trim()) {
    facts.push(createClinicalFact({
      id: `legacy-fact-${counter++}`,
      type: 'recall_plan',
      speaker: 'clinician',
      evidenceType: 'instruction',
      value: { intervalMonths: 6, reason: findings.recallRequirements.trim() },
      status: 'planned',
      temporal: 'future',
      certainty: 'certain',
      extractionMethod: 'model_extracted'
    }));
  }

  return facts;
}
