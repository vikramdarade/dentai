/**
 * EXACT (Software of Excellence) Clipboard Adapter.
 * Compact clinical record format for SOE EXACT Treatment and Clinical Notes tabs.
 * Pure text rendering; no IO.
 */

import type { PmsEncounter } from '../canonical';

export function renderExact(encounter: PmsEncounter): string {
  const lines: string[] = [];
  lines.push(`[SOE EXACT CLINICAL RECORD — ${encounter.date}${encounter.time ? ` ${encounter.time}` : ''}]`);
  lines.push(`Patient: ${encounter.patientName}${encounter.dob ? ` | DOB: ${encounter.dob}` : ''}`);
  if (encounter.practitioner) {
    lines.push(`Clinician: ${encounter.practitioner}`);
  }
  lines.push(`Procedure: ${encounter.appointmentType}`);
  lines.push('----------------------------------------');

  for (const s of encounter.sections) {
    const flat = s.value.replace(/\s*\n+\s*/g, ' ').trim();
    lines.push(`[${s.label}] ${flat}`);
  }

  if (encounter.itemCodes.length > 0) {
    lines.push('----------------------------------------');
    lines.push(`Items Completed: ${encounter.itemCodes.map(c => `${c.code}${c.tooth ? ` (T${c.tooth})` : ''}`).join(', ')}`);
  }

  if (encounter.attestation) {
    lines.push('----------------------------------------');
    lines.push(`Attested: ${encounter.attestation.signedBy} (${encounter.attestation.ahpraRegistration || 'AHPRA'}) | ${encounter.attestation.signedAt}`);
    lines.push(`SHA-256 Seal: ${encounter.attestation.signatureHash.slice(0, 16)}... | ${encounter.attestation.auditStatus}`);
  }

  return lines.join('\n');
}
