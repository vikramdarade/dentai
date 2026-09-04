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
import type { GeneratedNotePayload } from '../types';

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
  };
}

