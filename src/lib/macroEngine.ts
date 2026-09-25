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
  ENDODONTIC_OBTURATON_MACRO,
  CROWN_PREPARATION_MACRO,
  CROWN_CEMENTATION_MACRO,
  OCCLUSAL_SPLINT_MACRO,
  TRAUMA_SPLINT_MACRO,
  DENTAL_IMPLANT_PLACEMENT_MACRO,
  COMPLETE_PARTIAL_DENTURES_MACRO,
  IMPLANT_OVERDENTURE_MACRO,
  TEETH_WHITENING_MACRO,
  VENEERS_SMILE_DESIGN_MACRO,
  INVISALIGN_ALIGNER_MACRO,
  CONSCIOUS_SEDATION_MACRO,
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

  // 1. Explicit sleep dentistry / conscious IV sedation
  if (/\b(?:conscious\s+iv\s+sedation|iv\s+sedation|sleep\s+dentistry|midazolam|fentanyl|nitrous\s+oxide|relative\s+analgesia|aldrete\s+score|ramsay\s+sedation)\b/i.test(lower)) {
    return CONSCIOUS_SEDATION_MACRO;
  }

  // 2. Explicit teeth whitening (Pola In-Chair)
  if (/\b(?:pola\s+office|pola\s+advanced|teeth\s+whitening|in-chair\s+whitening|tooth\s+whitening|gingival\s+barrier|bleaching\s+gel|hydrogen\s+peroxide)\b/i.test(lower)) {
    return TEETH_WHITENING_MACRO;
  }

  // 3. Explicit Invisalign / clear aligners
  if (/\b(?:invisalign|clear\s+aligner|aligner\s+(?:delivery|issue|seat)|template\s+aligner|composite\s+attachment\s+bonding|chewies|interproximal\s+reduction|\bipr\b)\b/i.test(lower)) {
    return INVISALIGN_ALIGNER_MACRO;
  }

  // 4. Explicit porcelain veneers & smile design
  if (/\b(?:porcelain\s+veneer|veneers|smile\s+design|smile\s+makeover|diagnostic\s+wax-up|butt-joint|facial\s+reduction|facial\s+enamel\s+reduction)\b/i.test(lower)) {
    return VENEERS_SMILE_DESIGN_MACRO;
  }

  // 5. Explicit implant-supported overdenture & locator attachments
  if (/\b(?:implant[- ]supported\s+overdenture|implant\s+overdenture|overdenture|locator\s+abutment|quick\s+up|block-out\s+spacer|processing\s+insert|retention\s+cap)\b/i.test(lower)) {
    return IMPLANT_OVERDENTURE_MACRO;
  }

  // 6. Explicit dentures & digital CAD/CAM dentures
  if (/\b(?:digital\s+denture|complete\s+denture|partial\s+denture|full\s+upper|full\s+lower|custom\s+tray|border\s+mould|master\s+impression|retromolar\s+pad|hamular\s+notch|dentures?\b)/i.test(lower)) {
    return COMPLETE_PARTIAL_DENTURES_MACRO;
  }

  // 7. Explicit surgical dental implant placement
  if (/\b(?:implant\s+surgery|implant\s+fixture|osteotomy|straumann|nobel|pilot\s+drill|insertion\s+torque|healing\s+abutment|cover\s+screw)\b/i.test(lower)) {
    return DENTAL_IMPLANT_PLACEMENT_MACRO;
  }

  // 8. Explicit acute dental trauma & flexible splinting
  if (/\b(?:dental\s+trauma|trauma\s+presentation|subluxat|luxat|avulsion|flexible\s+splint|wire-composite\s+splint|splinted\s+from)\b/i.test(lower)) {
    return TRAUMA_SPLINT_MACRO;
  }

  // 9. Explicit occlusal splints / nightguards
  if (/\b(?:occlusal\s+splint|night\s*guard|bruxism\s+splint|splint\s+delivery|splint\s+tried|canine\s+guidance)\b/i.test(lower)) {
    return OCCLUSAL_SPLINT_MACRO;
  }

  // 10. Explicit crown cementation / issue visit (laboratory crown fitting)
  if (/\b(?:crown\s+fit|crown\s+issue|crown\s+insert|crown\s+try-in|try-in\s+verified|relyx|cemented\s+definitively|definitive\s+cementation)\b/i.test(lower)) {
    return CROWN_CEMENTATION_MACRO;
  }

  // 11. Explicit crown preparation & digital scan / impressions
  if (/\b(?:crown\s+prep|crown\s+preparation|chamfer|shoulder\s+margin|retraction\s+cord|trios|intraoral\s+scan|protemp|temp\s+crown\s+fabricated)\b/i.test(lower)) {
    return CROWN_PREPARATION_MACRO;
  }

  // 12. Explicit root canal completion / obturation (Stage 2/3 RCT)
  if (/\b(?:obturat|gutta[- ]percha|ah\s+plus|master\s+cone|chemo-mechanical|root\s+canal\s+filled|canals\s+obturated)\b/i.test(lower)) {
    return ENDODONTIC_OBTURATON_MACRO;
  }

  // 13. Explicit endodontic extirpation / emergency nerve removal (Stage 1 RCT)
  if (/\b(?:extirpat|odontopaste|pulp\s+extirpation|barbed\s+broach|cavit|canals?\s+located|emergency\s+nerve\s+removal|remove\s+(?:the\s+)?nerve|nerve\s+treatment|dressing\s+inside\s+(?:the\s+)?tooth|open\s+(?:the\s+)?tooth|pulpotomy|pulpitis)\b/i.test(lower)) {
    return EMERGENCY_PULP_EXTIRPATION_MACRO;
  }

  // 14. Explicit surgical extraction indicators (only when not contraindicated/negated)
  if (!isExtractionNegated && /\b(?:bone\s+gutter|guttering|mucoperiosteal\s+flap|sectioned|tooth\s+division|suture|gelatemp|prolene)\b/i.test(lower)) {
    return SURGICAL_EXTRACTION_MACRO;
  }

  // 15. Simple extraction indicators (only when not contraindicated/negated)
  if (!isExtractionNegated && /\b(?:simple\s+extraction|forceps\s+technique|socket\s+inspected|elevated\s+and\s+removed)\b/i.test(lower)) {
    return SIMPLE_EXTRACTION_MACRO;
  }

  // 16. Periodontal debridement / SRP
  if (/\b(?:srp|root\s+planing|subgingival\s+debridement|deep\s+clean|quadrant\s+debridement)\b/i.test(lower)) {
    return PERIODONTAL_DEBRIDEMENT_MACRO;
  }

  // 17. Fissure sealants
  if (/\b(?:fissure\s+sealant|sealant|preventive\s+resin)\b/i.test(lower)) {
    return FISSURE_SEALANT_MACRO;
  }

  // 18. Restorative / filling
  if (/\b(?:filling|composite|restoration|etch|bond|cured|cavity\s+prep|shade\s+a[1-4]|shade\s+b[1-4])\b/i.test(lower)) {
    return ROUTINE_RESTORATION_MACRO;
  }

  // 19. Scale & Clean
  if (/\b(?:scale\s+and\s+clean|s\/c|prophy\s+paste|ultrasonic\s+scaler|topical\s+fluoride)\b/i.test(lower)) {
    return SCALING_CLEAN_MACRO;
  }

  // 20. General Exam
  if (/\b(?:comprehensive\s+exam|checkup|bpe|soft\s+tissues\s+nad|dentition\s+charted)\b/i.test(lower)) {
    return GENERAL_EXAM_CLEAN_MACRO;
  }

  // Fallback to booked appointment type
  if (appointmentType) {
    switch (appointmentType) {
      case 'implant':
        return DENTAL_IMPLANT_PLACEMENT_MACRO;
      case 'cosmetic':
        return VENEERS_SMILE_DESIGN_MACRO;
      case 'orthodontic':
        return INVISALIGN_ALIGNER_MACRO;
      case 'restorative':
        return ROUTINE_RESTORATION_MACRO;
      case 'prosthodontic':
        return CROWN_PREPARATION_MACRO;
      case 'endodontic':
        return ENDODONTIC_OBTURATON_MACRO;
      case 'paediatric':
        return FISSURE_SEALANT_MACRO;
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
