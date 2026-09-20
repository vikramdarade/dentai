/**
 * Cliniko Clipboard Adapter.
 * Clean, sectioned format for Cliniko Treatment Notes.
 * Pure text rendering; no IO.
 */

import type { PmsEncounter } from '../canonical';

export function renderCliniko(encounter: PmsEncounter): string {
  const lines: string[] = [];
  lines.push(`## Dental Treatment Note — ${encounter.date}`);
  lines.push(`**Patient:** ${encounter.patientName}${encounter.dob ? ` (DOB: ${encounter.dob})` : ''}`);
  if (encounter.practitioner) {
    lines.push(`**Practitioner:** ${encounter.practitioner}`);
  }
  lines.push(`**Appointment Type:** ${encounter.appointmentType}`);
  lines.push('');

  for (const s of encounter.sections) {
    lines.push(`### ${s.label}`);
    lines.push(s.value);
    lines.push('');
  }

  if (encounter.itemCodes.length > 0) {
    lines.push('### Item Codes');
    for (const c of encounter.itemCodes) {
      lines.push(`- **${c.code}** — ${c.description}${c.tooth ? ` (Tooth: ${c.tooth})` : ''}`);
    }
    lines.push('');
  }

  if (encounter.patientSummary) {
    lines.push('### Patient Summary');
    lines.push(encounter.patientSummary);
    lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
