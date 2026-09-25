/**
 * Deterministic Australian Clinical Procedure Macro Engine
 *
 * Combines gold-standard Australian clinical templates with sub-millisecond
 * spoken variable extraction to produce 100% deterministic, zero-hallucination
 * dental clinical notes with zero cloud egress.
 */

import { TranscriptItem } from '../types';
import {
  ALL_AUSTRALIAN_MACROS,
  MACRO_BY_ID,
  ClinicalMacroDefinition,
  FormattedMacroNote,
  ROUTINE_RESTORATION_MACRO,
  GENERAL_EXAM_CLEAN_MACRO,
  SCALING_CLEAN_MACRO,
  SIMPLE_EXTRACTION_MACRO,
  SURGICAL_EXTRACTION_MACRO,
  EMERGENCY_PULP_EXTIRPATION_MACRO,
  FISSURE_SEALANT_MACRO,
  PERIODONTAL_DEBRIDEMENT_MACRO,
} from './australianClinicalMacros';
import { parseClinicalEntities, TranscriptInputItem } from './clinicalEntityParser';

/**
 * Detects the most accurate clinical macro from operatory conversation
 * or booked appointment type.
 */
export function detectMacroFromContext(
  transcript: TranscriptInputItem[] | string,
  appointmentType?: string
): ClinicalMacroDefinition {
  const fullText = typeof transcript === 'string'
    ? transcript
    : transcript.map(t => t.text || '').join(' ');
  const lower = fullText.toLowerCase();

  // Negation guard: Check if extraction was explicitly contraindicated, negated or deferred
  const isExtractionNegated = /\b(?:not\s+(?:going\s+to|ready\s+to|planning\s+to)?\s*(?:take|extract)|avoid\s+extraction|contraindicated|consult\s+(?:your\s+)?gp\s+(?:first|before\s+taking)|defer(?:red)?\s+extraction|without\s+extracting|refuse\s+extraction|open\s+the\s+tooth\s+instead)\b/i.test(lower);

  // 1. Explicit endodontic / extirpation / emergency nerve removal indicators
  if (/\b(?:extirpat|odontopaste|pulp\s+extirpation|barbed\s+broach|cavit|canals?\s+located|emergency\s+nerve\s+removal|remove\s+(?:the\s+)?nerve|nerve\s+treatment|dressing\s+inside\s+(?:the\s+)?tooth|open\s+(?:the\s+)?tooth|pulpotomy|pulpitis)\b/i.test(lower)) {
    return EMERGENCY_PULP_EXTIRPATION_MACRO;
  }

  // 2. Explicit surgical extraction indicators (only when not contraindicated/negated)
  if (!isExtractionNegated && /\b(?:bone\s+gutter|guttering|mucoperiosteal\s+flap|sectioned|tooth\s+division|suture|gelatemp|prolene)\b/i.test(lower)) {
    return SURGICAL_EXTRACTION_MACRO;
  }

  // 3. Simple extraction indicators (only when not contraindicated/negated)
  if (!isExtractionNegated && /\b(?:simple\s+extraction|forceps\s+technique|socket\s+inspected|elevated\s+and\s+removed)\b/i.test(lower)) {
    return SIMPLE_EXTRACTION_MACRO;
  }

  // 4. Periodontal debridement / SRP
  if (/\b(?:srp|root\s+planing|subgingival\s+debridement|deep\s+clean|quadrant\s+debridement)\b/i.test(lower)) {
    return PERIODONTAL_DEBRIDEMENT_MACRO;
  }

  // 5. Fissure sealants
  if (/\b(?:fissure\s+sealant|sealant|preventive\s+resin)\b/i.test(lower)) {
    return FISSURE_SEALANT_MACRO;
  }

  // 6. Restorative / filling
  if (/\b(?:filling|composite|restoration|etch|bond|cured|cavity\s+prep|shade\s+a[1-4])\b/i.test(lower)) {
    return ROUTINE_RESTORATION_MACRO;
  }

  // 7. Scale & Clean
  if (/\b(?:scale\s+and\s+clean|s\/c|prophy\s+paste|ultrasonic\s+scaler|topical\s+fluoride)\b/i.test(lower)) {
    return SCALING_CLEAN_MACRO;
  }

  // 8. General Exam
  if (/\b(?:comprehensive\s+exam|checkup|bpe|soft\s+tissues\s+nad|dentition\s+charted)\b/i.test(lower)) {
    return GENERAL_EXAM_CLEAN_MACRO;
  }

  // Fallback to booked appointment type
  if (appointmentType) {
    switch (appointmentType) {
      case 'restorative':
        return ROUTINE_RESTORATION_MACRO;
      case 'scale_clean':
        return SCALING_CLEAN_MACRO;
      case 'emergency':
        return EMERGENCY_PULP_EXTIRPATION_MACRO;
      case 'surgical':
        return SIMPLE_EXTRACTION_MACRO;
      case 'examination':
      default:
        return GENERAL_EXAM_CLEAN_MACRO;
    }
  }

  return GENERAL_EXAM_CLEAN_MACRO;
}

/**
 * Generates a complete, AHPRA-compliant clinical note deterministically.
 */
export function generateMacroNote(
  transcript: TranscriptInputItem[] | string,
  macroId?: string,
  appointmentType?: string
): FormattedMacroNote {
  const vars = parseClinicalEntities(transcript);

  const selectedMacro = (macroId && MACRO_BY_ID[macroId])
    ? MACRO_BY_ID[macroId]
    : detectMacroFromContext(transcript, appointmentType);

  return selectedMacro.templateGenerator(vars);
}
