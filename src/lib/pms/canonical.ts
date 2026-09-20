/**
 * Canonical PMS Encounter representation.
 *
 * A PMS-agnostic encounter document mapping directly from a verified Consultation.
 * Pure model and mapper with no IO, designed to feed clipboard and export adapters.
 */

import type { Consultation } from '../../types';
import { sectionsFor, patientDisplayName } from '../noteExport';

export interface PmsEncounterSection {
  key: string;
  label: string;
  value: string;
}

export interface PmsEncounterCode {
  code: string;
  description: string;
  tooth?: string;
}

export interface PmsEncounter {
  consultationId?: string;
  patientName: string;
  dob?: string;
  appointmentType: string;
  date: string;
  time?: string;
  practitioner?: string;
  sections: PmsEncounterSection[];
  itemCodes: PmsEncounterCode[];
  patientSummary?: string;
  needsReview: boolean;
}

function valueFor(consultation: Consultation, key: string): string {
  const findings = (consultation.findings || {}) as Record<string, any>;
  if (key in findings && typeof findings[key] === 'string') return findings[key];
  const custom = findings.customSections || {};
  if (key in custom && typeof custom[key] === 'string') return custom[key];
  return '';
}

/**
 * Maps a Consultation into a clean, PMS-agnostic PmsEncounter document.
 * Pure function: no IO, deterministic output.
 */
export function toPmsEncounter(consultation: Consultation): PmsEncounter {
  const allSections = sectionsFor(consultation);
  const sections: PmsEncounterSection[] = [];

  for (const s of allSections) {
    const val = valueFor(consultation, s.key);
    if (val && val.trim()) {
      sections.push({
        key: s.key,
        label: s.label,
        value: val.trim()
      });
    }
  }

  const rawCodes = consultation.findings?.adaCodes || [];
  const itemCodes: PmsEncounterCode[] = rawCodes.map((c: any) => ({
    code: String(c.code || ''),
    description: String(c.description || ''),
    ...(c.tooth ? { tooth: String(c.tooth) } : {})
  })).filter(c => c.code.length > 0);

  return {
    consultationId: consultation.id,
    patientName: patientDisplayName(consultation),
    dob: consultation.dob || undefined,
    appointmentType: consultation.appointmentType || 'Examination',
    date: consultation.date || '',
    time: consultation.time || undefined,
    practitioner: consultation.dentistName || undefined,
    sections,
    itemCodes,
    patientSummary: consultation.patientSummary ? consultation.patientSummary.trim() : undefined,
    needsReview: !!consultation.noteOrigin?.needsReview
  };
}
