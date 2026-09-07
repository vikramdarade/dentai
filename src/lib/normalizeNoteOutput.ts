/**
 * Shared normaliser for note-generation output.
 *
 * Every note source — hosted Gemini, secondary Gemini key, on-device WebLLM,
 * and the rule-based offline draft — must converge on ONE record contract:
 *  - canonical keys (chiefComplaint, history, ...) land on the top level of
 *    ClinicalFindings,
 *  - every other template-specific section key lands in
 *    findings.customSections[key],
 *  - patientSummary (string) and adaCodes (array) are always present.
 *
 * Server (server.ts), on-device model client (onDeviceModel.ts) and the
 * offline draft engine (draftEngine.ts) all import from here.
 */
import { NoteTemplate, isCanonicalField } from './dentalLibrary';
import type {
  GeneratedNotePayload,
  SpecialistReferral,
  PatientConsentAndCare,
  TreatmentQuoteData
} from '../types';
import { buildTreatmentQuoteData } from './adaFees';

export interface AdaCodeLike {
  code: string;
  description: string;
  tooth?: string;
}

export interface NormalizedNoteOutput {
  /** Canonical findings at top level (may be a subset of the 8). */
  [canonicalOrExtraKey: string]: unknown;
  customSections: Record<string, string>;
  patientSummary: string;
  adaCodes: AdaCodeLike[];
  proposedTreatments?: any[];
  specialistReferral?: SpecialistReferral;
  patientConsent?: PatientConsentAndCare;
  treatmentQuote?: TreatmentQuoteData;
}

const MAX_NOTE_SECTION_LENGTH = 4000;

export function parseAdaCodes(raw: any): AdaCodeLike[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    return raw
      .split(/[,;\n]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const match = item.match(/^(\d{3})\s*[-:]\s*(.*?)(?:\s*\((?:Tooth\s*|FDI\s*)?(\d{2})\))?$/i);
        if (match) {
          return { code: match[1], description: match[2].trim(), tooth: match[3] };
        }
        const simpleMatch = item.match(/^(\d{3})\s*(.*)$/);
        if (simpleMatch) {
          return { code: simpleMatch[1], description: simpleMatch[2].trim() };
        }
        return { code: '011', description: item };
      });
  }
  return [];
}

const sanitizeString = (v: unknown): string =>
  typeof v === 'string' ? v.slice(0, MAX_NOTE_SECTION_LENGTH).trim() : '';

/**
 * Maps raw model output (keyed by the template's section keys) onto the record
 * contract. Also usable for client-side fallback engines.
 */
export function normalizeTemplateOutput(template: NoteTemplate, raw: any): NormalizedNoteOutput {
  const output: NormalizedNoteOutput = {
    customSections: {},
    patientSummary: '',
    adaCodes: [],
    proposedTreatments: Array.isArray(raw?.proposedTreatments) ? raw.proposedTreatments : undefined,
  };

  for (const section of template.sections) {
    const value = sanitizeString(raw?.[section.key]);
    if (isCanonicalField(section.key)) {
      output[section.key] = value;
    } else {
      output.customSections[section.key] = value;
    }
  }

  output.patientSummary = sanitizeString(raw?.patientSummary);
  output.adaCodes = parseAdaCodes(raw?.adaCodes);

  // Specialist Referral Normalisation
  if (raw?.specialistReferral && typeof raw.specialistReferral === 'object') {
    const sr = raw.specialistReferral;
    output.specialistReferral = {
      required: Boolean(sr.required),
      specialty: sr.specialty || 'General Referral',
      specialistName: sanitizeString(sr.specialistName),
      recipientClinic: sanitizeString(sr.recipientClinic),
      teethInvolved: Array.isArray(sr.teethInvolved)
        ? sr.teethInvolved.map(String)
        : typeof sr.teethInvolved === 'string'
        ? sr.teethInvolved.split(/[,;\s]+/).map((s: string) => s.trim()).filter(Boolean)
        : [],
      urgency: sr.urgency || 'Routine',
      clinicalQuestion: sanitizeString(sr.clinicalQuestion),
      backgroundAndFindings: sanitizeString(sr.backgroundAndFindings),
      provisionalDiagnosis: sanitizeString(sr.provisionalDiagnosis),
      interimTreatmentProvided: sanitizeString(sr.interimTreatmentProvided),
      medicalAlerts: sanitizeString(sr.medicalAlerts),
      letterText: sanitizeString(sr.letterText)
    };
  }

  // Patient Consent & Care Normalisation
  if (raw?.patientConsent && typeof raw.patientConsent === 'object') {
    const pc = raw.patientConsent;
    output.patientConsent = {
      plainSummary: sanitizeString(pc.plainSummary) || output.patientSummary,
      optionsDiscussed: Array.isArray(pc.optionsDiscussed)
        ? pc.optionsDiscussed.map((opt: any) => ({
            optionName: sanitizeString(opt.optionName),
            benefits: sanitizeString(opt.benefits),
            risks: sanitizeString(opt.risks),
            estimatedCost: sanitizeString(opt.estimatedCost)
          }))
        : typeof pc.optionsDiscussed === 'string' && pc.optionsDiscussed.trim()
        ? [{ optionName: 'Proposed Treatment', benefits: sanitizeString(pc.optionsDiscussed), risks: '' }]
        : [],
      risksOfNoTreatment: sanitizeString(pc.risksOfNoTreatment),
      postOpCareInstructions: sanitizeString(pc.postOpCareInstructions),
      redFlagsWarning: sanitizeString(pc.redFlagsWarning),
      consentStatus: pc.consentStatus || 'discussed_pending_signature'
    };
  } else if (output.patientSummary) {
    output.patientConsent = {
      plainSummary: output.patientSummary,
      optionsDiscussed: [],
      risksOfNoTreatment: 'Progression of untreated pathology may require more extensive restorative or surgical intervention.',
      postOpCareInstructions: 'Maintain regular oral hygiene with a soft brush and adhere to scheduled recall appointments.',
      redFlagsWarning: 'Contact the clinic immediately if you experience severe increasing pain, swelling, fever, or prolonged bleeding.',
      consentStatus: 'discussed_pending_signature'
    };
  }

  // Treatment Quote Normalisation & Auto-Derivation
  if (raw?.treatmentQuote && typeof raw.treatmentQuote === 'object' && Array.isArray(raw.treatmentQuote.items)) {
    output.treatmentQuote = raw.treatmentQuote;
  } else {
    const clinicalText = Object.values(output).filter(v => typeof v === 'string').join(' ');
    output.treatmentQuote = buildTreatmentQuoteData(output.adaCodes, output.proposedTreatments, clinicalText);
  }

  return output;
}

/**
 * Converts any normalized output (server or on-device shape) into the
 * engine-agnostic GeneratedNotePayload the frontend persists. Works whether
 * canonical keys sit on the top level (server/on-device) or under `.canonical`
 * (offline draft engine).
 */
export function normalizedToPayload(template: NoteTemplate, out: any): GeneratedNotePayload {
  const canonical: Record<string, string> = {};
  const customSections: Record<string, string> = {
    ...(out?.customSections || {}),
  };

  for (const section of template.sections) {
    const raw =
      typeof out?.[section.key] === 'string'
        ? out[section.key]
        : typeof out?.canonical?.[section.key] === 'string'
        ? out.canonical[section.key]
        : '';
    const value = sanitizeString(raw);
    if (isCanonicalField(section.key)) canonical[section.key] = value;
    else if (value) customSections[section.key] = value;
  }

  return {
    canonical,
    customSections,
    patientSummary: sanitizeString(out?.patientSummary),
    adaCodes: parseAdaCodes(out?.adaCodes),
    proposedTreatments: Array.isArray(out?.proposedTreatments) ? out.proposedTreatments : undefined,
    specialistReferral: out?.specialistReferral,
    patientConsent: out?.patientConsent,
    treatmentQuote: out?.treatmentQuote,
  };
}


