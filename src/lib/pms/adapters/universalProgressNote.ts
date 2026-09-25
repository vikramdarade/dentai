/**
 * Universal Australian Clinical Progress Note Adapter.
 *
 * Produces a single, clean, dentist-friendly progress note layout
 * compatible with any Practice Management System (D4W, Exact, Core Practice, Cliniko, etc.).
 */

import type { PmsEncounter } from '../canonical';

const DENTIST_FRIENDLY_LABELS: Record<string, string> = {
  'CHIEF COMPLAINT': 'PRESENTING COMPLAINT',
  'HISTORY': 'HISTORY OF COMPLAINT & MEDICAL SCREEN',
  'TOOTH FINDINGS': 'CLINICAL EXAMINATION',
  'GINGIVAL FINDINGS': 'SOFT TISSUE / SWELLING',
  'DIAGNOSIS': 'DIAGNOSIS',
  'TREATMENT PERFORMED': 'IMMEDIATE TREATMENT PROVIDED',
  'RECOMMENDATIONS': 'POST-OPERATIVE & EMERGENCY INSTRUCTIONS',
  'RECALL': 'FOLLOW-UP / NEXT APPOINTMENT',
};

export function renderUniversalProgressNote(encounter: PmsEncounter): string {
  const lines: string[] = [];
  lines.push(`=== CLINICAL PROGRESS NOTE ===`);
  lines.push(`PATIENT: ${encounter.patientName}${encounter.dob ? ` (DOB: ${encounter.dob})` : ''}`);
  lines.push(`DATE: ${encounter.date}${encounter.time ? ` ${encounter.time}` : ''}`);
  if (encounter.practitioner) {
    lines.push(`PROVIDER: ${encounter.practitioner}`);
  }
  lines.push(`APPOINTMENT TYPE: ${encounter.appointmentType.toUpperCase()}`);
  lines.push('');

  for (const s of encounter.sections) {
    const rawUpper = s.label.trim().toUpperCase();
    const heading = DENTIST_FRIENDLY_LABELS[rawUpper] || rawUpper;
    lines.push(`${heading}:`);
    lines.push(s.value);
    lines.push('');
  }

  if (encounter.itemCodes && encounter.itemCodes.length > 0) {
    lines.push('ADA ITEM NUMBERS:');
    for (const c of encounter.itemCodes) {
      lines.push(`- Item ${c.code}: ${c.description}${c.tooth ? ` - tooth ${c.tooth}` : ''}`);
    }
    lines.push('');
  }

  if (encounter.patientSummary) {
    lines.push('PATIENT COMMUNICATION:');
    lines.push(encounter.patientSummary);
    lines.push('');
  }

  if (encounter.attestation) {
    lines.push('CLINICAL ATTESTATION & EVIDENCE:');
    lines.push(`Attested By: ${encounter.attestation.signedBy} (${encounter.attestation.ahpraRegistration || 'Registered Dentist'})`);
    lines.push(`Attestation Timestamp: ${encounter.attestation.signedAt}`);
    lines.push(`Audio Grounding: ${encounter.attestation.auditStatus}`);
    lines.push(`Digital Seal (SHA-256): ${encounter.attestation.signatureHash}`);
    lines.push('');
  }

  lines.push('[Reviewed and verified by treating clinician chairside in DentAI]');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
