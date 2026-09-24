/**
 * Dental4Windows (D4W) Clipboard Adapter.
 * Clean, structured text formatted for the D4W 3D Charting and Clinical Progress Notes tab.
 * Pure text rendering; no IO, no filesystem drops.
 */

import type { PmsEncounter } from '../canonical';

export function renderD4W(encounter: PmsEncounter): string {
  const lines: string[] = [];
  lines.push(`=== DENTAL4WINDOWS CLINICAL PROGRESS NOTE ===`);
  lines.push(`PATIENT: ${encounter.patientName}${encounter.dob ? ` (DOB: ${encounter.dob})` : ''}`);
  lines.push(`DATE: ${encounter.date}${encounter.time ? ` ${encounter.time}` : ''}`);
  if (encounter.practitioner) {
    lines.push(`PROVIDER: ${encounter.practitioner}`);
  }
  lines.push(`APPOINTMENT TYPE: ${encounter.appointmentType.toUpperCase()}`);
  lines.push('');

  for (const s of encounter.sections) {
    lines.push(`${s.label.toUpperCase()}:`);
    lines.push(s.value);
    lines.push('');
  }

  if (encounter.itemCodes.length > 0) {
    lines.push('ADA ITEM NUMBERS:');
    for (const c of encounter.itemCodes) {
      lines.push(`- Item ${c.code}: ${c.description}${c.tooth ? ` (Tooth ${c.tooth})` : ''}`);
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
