/**
 * Core Practice Clipboard Adapter.
 * Format for Core Practice clinical treatment notes.
 * Pure text rendering; no IO.
 */

import type { PmsEncounter } from '../canonical';

export function renderCorePractice(encounter: PmsEncounter): string {
  const lines: string[] = [];
  lines.push(`CORE PRACTICE PROGRESS NOTE`);
  lines.push(`Date: ${encounter.date}${encounter.time ? ` ${encounter.time}` : ''} | Patient: ${encounter.patientName}`);
  if (encounter.practitioner) {
    lines.push(`Provider: ${encounter.practitioner}`);
  }
  lines.push(`Treatment: ${encounter.appointmentType}`);
  lines.push('');

  for (const s of encounter.sections) {
    lines.push(`[${s.label}]`);
    lines.push(s.value);
    lines.push('');
  }

  if (encounter.itemCodes.length > 0) {
    lines.push('[Item Numbers]');
    for (const c of encounter.itemCodes) {
      lines.push(`${c.code}: ${c.description}${c.tooth ? ` (Tooth ${c.tooth})` : ''}`);
    }
    lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
