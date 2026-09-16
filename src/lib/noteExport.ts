/**
 * Note handoff formats.
 *
 * The honest answer to "do you integrate with my practice software?" used to be
 * "no, copy it out of the screen". That is a real cost in a chair, several times
 * a day, and it is also where transcription errors get introduced into the
 * official record.
 *
 * This module produces three things a practice can actually use today:
 *   - **Plain text**, for a clipboard or a letter.
 *   - **PMS paste text**, a compact ordered layout that pastes cleanly into the
 *     free-text clinical note field of common Australian practice-management
 *     systems without carrying Markdown or bullet glyphs across.
 *   - **CSV / JSON**, for a whole-range export a practice can open itself
 *     (data portability under APP 12, see docs/legal/retention-and-deletion.md).
 *
 * Pure functions only: no React, no server, no IO, so the formats are unit
 * tested rather than eyeballed.
 */

import type { ClinicalFindings, Consultation } from '../types';
import { TEMPLATE_BY_ID, type NoteTemplate, type TemplateSection } from './dentalLibrary';

/** The eight standard sections, in the order a clinician reads them. */
export const STANDARD_SECTION_ORDER: Array<{ key: keyof ClinicalFindings; label: string }> = [
  { key: 'chiefComplaint', label: 'Chief complaint' },
  { key: 'history', label: 'History' },
  { key: 'toothFindings', label: 'Tooth findings' },
  { key: 'findingsGingival', label: 'Gingival findings' },
  { key: 'diagnosis', label: 'Diagnosis' },
  { key: 'treatmentPerformed', label: 'Treatment performed' },
  { key: 'recommendations', label: 'Recommendations' },
  { key: 'recallRequirements', label: 'Recall' },
];

/**
 * Sections to render for a record: the template's sections when one is
 * identified (which gives correct labels and ordering, including custom
 * sections), otherwise the standard eight.
 */
export function sectionsFor(consultation: Consultation): Array<{ key: string; label: string }> {
  const template: NoteTemplate | undefined = consultation.templateId
    ? TEMPLATE_BY_ID[consultation.templateId]
    : undefined;
  if (template && Array.isArray(template.sections) && template.sections.length > 0) {
    return (template.sections as TemplateSection[]).map((section) => ({
      key: section.key,
      label: section.label,
    }));
  }
  return STANDARD_SECTION_ORDER.map((s) => ({ key: String(s.key), label: s.label }));
}

function valueFor(consultation: Consultation, key: string): string {
  const findings = (consultation.findings || {}) as Record<string, any>;
  if (key in findings && typeof findings[key] === 'string') return findings[key];
  const custom = findings.customSections || {};
  if (key in custom && typeof custom[key] === 'string') return custom[key];
  return '';
}

export function patientDisplayName(consultation: Consultation): string {
  const name = `${consultation.firstName || ''} ${consultation.lastName || ''}`.trim();
  return name || 'Unnamed patient';
}

/** Multi-line clinical text, for the clipboard or a letter. */
export function consultationToPlainText(
  consultation: Consultation,
  options: { includePatient?: boolean } = {}
): string {
  const includePatient = options.includePatient !== false;
  const lines: string[] = [];
  if (includePatient) {
    lines.push(`Patient: ${patientDisplayName(consultation)}`);
    if (consultation.dob) lines.push(`Date of birth: ${consultation.dob}`);
  }
  lines.push(`Appointment: ${consultation.appointmentType || 'examination'}`);
  lines.push(`Date: ${consultation.date}${consultation.time ? ` ${consultation.time}` : ''}`);
  lines.push('');
  for (const section of sectionsFor(consultation)) {
    const value = valueFor(consultation, section.key);
    if (!value) continue;
    lines.push(`${section.label.toUpperCase()}`);
    lines.push(value.trim());
    lines.push('');
  }
  const codes = consultation.findings?.adaCodes || [];
  if (codes.length > 0) {
    lines.push('ITEM NUMBERS');
    for (const code of codes) {
      lines.push(`${code.code} — ${code.description}${code.tooth ? ` (tooth ${code.tooth})` : ''}`);
    }
    lines.push('');
  }
  if (consultation.patientSummary) {
    lines.push('PATIENT SUMMARY');
    lines.push(consultation.patientSummary.trim());
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Compact layout for pasting into a PMS clinical note field: `Label: value`
 * lines, no Markdown, no bullets, no blank-line runs. Kept short because these
 * fields are often character-limited.
 */
export function consultationToPmsText(consultation: Consultation): string {
  const lines: string[] = [];
  lines.push(`[DentAI note — reviewed by treating practitioner]`);
  lines.push(`Date: ${consultation.date}${consultation.time ? ` ${consultation.time}` : ''}`);
  for (const section of sectionsFor(consultation)) {
    const value = valueFor(consultation, section.key);
    if (!value) continue;
    const flat = value.replace(/\s*\n+\s*/g, ' ').trim();
    lines.push(`${section.label}: ${flat}`);
  }
  const codes = consultation.findings?.adaCodes || [];
  if (codes.length > 0) {
    lines.push(`Items: ${codes.map((c) => c.code).join(', ')}`);
  }
  if (consultation.noteOrigin?.needsReview) {
    lines.push('Note: generated draft — clinician review recorded in DentAI.');
  }
  return lines.join('\n');
}

/** Escapes a CSV field, including the spreadsheet formula-injection guard. */
export function csvField(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  // A clinical note beginning with =, +, - or @ is interpreted as a formula by
  // Excel and Sheets. Prefixing a single quote is the standard mitigation.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export interface CsvExport {
  header: string[];
  rows: string[][];
}

/**
 * Builds a spreadsheet-ready export. Fixed columns keep the header stable for
 * a practice importing into their own tooling.
 */
export function consultationsToCsv(consultations: Consultation[]): CsvExport {
  const header = [
    'Record ID',
    'Date',
    'Time',
    'Patient first name',
    'Patient last name',
    'Date of birth',
    'Appointment type',
    'Status',
    ...STANDARD_SECTION_ORDER.map((s) => s.label),
    'Custom sections',
    'Item numbers',
    'Patient summary',
    'Generated by',
    'Needs review',
    'Consent recorded at',
  ];

  const rows = consultations.map((c) => {
    const custom = c.findings?.customSections || {};
    const customText = Object.entries(custom)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' | ');
    return [
      c.id,
      c.date,
      c.time,
      c.firstName,
      c.lastName,
      c.dob,
      c.appointmentType,
      c.status,
      ...STANDARD_SECTION_ORDER.map((s) => String((c.findings || {})[s.key] ?? '')),
      customText,
      (c.findings?.adaCodes || []).map((code) => code.code).join(' '),
      c.patientSummary,
      c.noteOrigin?.engine || 'unknown',
      c.noteOrigin?.needsReview ? 'yes' : 'no',
      c.consent?.obtainedAt || '',
    ];
  });

  return { header, rows };
}

export function csvToString(exported: CsvExport): string {
  const lines = [exported.header.map(csvField).join(',')];
  for (const row of exported.rows) lines.push(row.map(csvField).join(','));
  return lines.join('\r\n');
}

/** Filename a practice can recognise, e.g. `dentai-export-2026-09-16.csv`. */
export function exportFilename(prefix: string, at: Date = new Date()): string {
  return `${prefix}-${at.toISOString().slice(0, 10)}`;
}
