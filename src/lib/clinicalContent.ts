/**
 * What counts as clinical content — one rule, one owner.
 *
 * Three separate places ask "does this record hold anything a clinician would
 * call note content?", and they were answering it differently. Each of them
 * read `findings.customSections` as a bag of note text, but that bag also
 * holds SEATING/INTAKE bookkeeping:
 *
 *   - `operatory`     — which room the visit happened in;
 *   - `priorNoteDate` — the day sheet's prior-visit date;
 *   - `intakeNote`    — walk-in provenance ("Walk-in encounter created at
 *                       intake for <name>"), documented as metadata and NOT
 *                       transcript content in src/lib/encounterSession.ts.
 *
 * Reading those as note text is how a blank appointment came to look like a
 * documented visit: the string "Room 1" counted as a clinical claim, so the
 * grounding audit found something to score instead of nothing to sign, and a
 * record with no audio and no findings was approved, badged "Verified from
 * Audio", and sealed. The sign-off gate's own empty-note guard had the same
 * leak, so it could not catch what the audit missed: it counted ANY non-empty
 * custom section as content.
 *
 * These keys describe the encounter, never the patient's mouth. Everything
 * else in `customSections` is clinical text.
 */

/**
 * `findings.customSections` keys that describe the ENCOUNTER, not the patient.
 * Deliberately a closed list: an unknown key is treated as clinical content,
 * so a new section type fails safe (toward review) rather than silently
 * becoming bookkeeping.
 */
export const NON_CLINICAL_SECTION_KEYS: ReadonlySet<string> = new Set([
  'operatory',
  'priorNoteDate',
  'intakeNote',
]);

/**
 * `findings.customSections` with the encounter bookkeeping removed — the
 * sections a grounding audit or a sign-off gate is entitled to read as note
 * text. A non-object input yields no sections.
 */
export function clinicalNoteSections(customSections: unknown): Record<string, unknown> {
  if (!customSections || typeof customSections !== 'object') return {};
  const clinical: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(customSections as Record<string, unknown>)) {
    if (NON_CLINICAL_SECTION_KEYS.has(key)) continue;
    clinical[key] = value;
  }
  return clinical;
}

/**
 * Does `findings` hold clinical content? Patient identity is NOT consulted
 * here — a seated appointment legitimately carries a name while holding no
 * note content, and callers asking this question (sign-off, grounding) care
 * only about note text.
 *
 * Non-clinical custom sections do not count, so an appointment that is nothing
 * but a room and a walk-in stamp reads as EMPTY. That is the whole point: on
 * such a record "nothing to check" must not be mistaken for "nothing wrong".
 */
export function hasClinicalContent(findings: unknown): boolean {
  if (!findings || typeof findings !== 'object') return false;
  return Object.entries(findings as Record<string, unknown>).some(([key, value]) => {
    if (key === 'customSections') {
      const sections = clinicalNoteSections(value);
      return Object.keys(sections).length > 0;
    }
    if (typeof value === 'string') return value.trim().length > 0;
    if (value == null) return false;
    if (typeof value === 'object') return Object.keys(value as object).length > 0;
    return Boolean(value);
  });
}
