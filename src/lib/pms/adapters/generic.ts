/**
 * Generic Clipboard PMS Adapter.
 * Compact standard Label: value layout for universal PMS clipboard pasting.
 */

import type { PmsEncounter } from '../canonical';

export function renderGeneric(encounter: PmsEncounter): string {
  const lines: string[] = [];
  lines.push(`[DentAI note — reviewed by treating practitioner]`);
  lines.push(`Date: ${encounter.date}${encounter.time ? ` ${encounter.time}` : ''}`);
  if (encounter.practitioner) {
    lines.push(`Provider: ${encounter.practitioner}`);
  }
  lines.push(`Procedure: ${encounter.appointmentType}`);

  for (const s of encounter.sections) {
    const flat = s.value.replace(/\s*\n+\s*/g, ' ').trim();
    lines.push(`${s.label}: ${flat}`);
  }

  if (encounter.itemCodes.length > 0) {
    lines.push(`Items: ${encounter.itemCodes.map(c => `${c.code}${c.tooth ? ` (${c.tooth})` : ''}`).join(', ')}`);
  }

  if (encounter.needsReview) {
    lines.push('Note: generated draft — clinician review recorded in DentAI.');
  }

  return lines.join('\n');
}
