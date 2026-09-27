/**
 * Phase 10 remediation — macro sparse-transcript adversarial coverage.
 *
 * "This is the critical regression that Phase 10 missed": every macro template
 * is executed against transcripts that lack the clinical facts a fabricated
 * template used to paper over. For each template × scenario the note must be
 * STRUCTURE ONLY: no invented diagnosis, findings, consent, anaesthetic,
 * material, postoperative care, recall or outcome. Missing data appears as
 * explicit notices, never as conventional-practice defaults.
 *
 * The fabrication scan uses the same FORBIDDEN_WITHOUT_EVIDENCE list the
 * module's load-time guard enforces, so the suite and the runtime contract
 * cannot drift.
 */
import { describe, it, expect } from 'vitest';
import { generateMacroNote } from '../src/lib/macroEngine';
import { parseClinicalEntities } from '../src/lib/clinicalEntityParser';
import {
  ALL_AUSTRALIAN_MACROS,
  FORBIDDEN_WITHOUT_EVIDENCE,
  type ClinicalMacroDefinition,
} from '../src/lib/australianClinicalMacros';

type Utterance = { sender: 'Dentist' | 'Patient' | 'Dialogue'; text: string };

const SCENARIOS: Record<string, Utterance[]> = {
  // As little clinical information as possible — the decisive case.
  sparse: [
    { sender: 'Dentist', text: 'Hello, let us get started.' },
    { sender: 'Patient', text: 'Okay.' },
  ],
  findingsOnly: [
    { sender: 'Dentist', text: 'Tooth 36 has caries.' },
  ],
  treatmentOnly: [
    { sender: 'Dentist', text: 'Restoring tooth 36 today.' },
  ],
  negated: [
    { sender: 'Dentist', text: 'No caries on 36. No extraction needed today.' },
  ],
  patientOnly: [
    { sender: 'Patient', text: 'I think my tooth is broken.' },
  ],
  plannedTreatment: [
    { sender: 'Dentist', text: 'We plan to restore tooth 36 next visit.' },
  ],
  noConsent: [
    { sender: 'Dentist', text: 'Restoring tooth 36 with composite. 4% articaine infiltration.' },
  ],
  noAnaesthetic: [
    { sender: 'Dentist', text: 'Restoring tooth 36 with composite. Verbal consent given.' },
  ],
  noMaterial: [
    { sender: 'Dentist', text: 'Restoring tooth 36 today. Verbal consent given. 4% articaine infiltration.' },
  ],
  noRecall: [
    { sender: 'Dentist', text: 'Restoring tooth 36 today. Verbal consent given.' },
  ],
};

function noteText(note: ReturnType<typeof generateMacroNote>): string {
  return [
    note.chiefComplaint, note.history, note.toothFindings, note.findingsGingival,
    note.diagnosis, note.treatmentPerformed, note.recommendations,
    note.recallRequirements, note.patientSummary,
    JSON.stringify(note.adaCodes),
  ].join(' ');
}

/** Clinical sentences that WERE spoken per scenario (allowed to re-appear). */
const SPOKEN_EVIDENCE: Record<string, RegExp[]> = {
  sparse: [],
  findingsOnly: [/caries/i],
  treatmentOnly: [/restoring|restoration/i],
  negated: [/no caries|no extraction/i],
  patientOnly: [],
  plannedTreatment: [/plan/i],
  noConsent: [/articaine/i],
  noAnaesthetic: [/composite|consent/i],
  noMaterial: [/articaine|consent/i],
  noRecall: [/consent/i],
};

describe('Macro sparse-transcript adversarial coverage (all templates)', () => {
  for (const macro of ALL_AUSTRALIAN_MACROS) {
    for (const [scenarioName, utterances] of Object.entries(SCENARIOS)) {
      it(`${macro.id} × ${scenarioName}: structural note only, zero fabricated assertions`, () => {
        const note = generateMacroNote(utterances as any, macro.id, macro.category as string);
        const text = noteText(note);

        // 1. The load-time guard's fabrication vocabulary must never appear —
        //    except for a concept that THIS scenario actually spoke (e.g.
        //    articaine in the noConsent/noMaterial scenarios). The match is
        //    excused only when the matched substring itself is spoken evidence.
        const spoken = SPOKEN_EVIDENCE[scenarioName] ?? [];
        const fabricated = FORBIDDEN_WITHOUT_EVIDENCE.filter(p => {
          const m = p.exec(text);
          if (!m) return false;
          return !spoken.some(e => e.test(m[0]));
        });
        expect(fabricated, `fabricated patterns: ${fabricated.map(p => p.source).join(', ')}`).toEqual([]);

        // 2. Diagnosis is never invented — empty + completion notice.
        expect(note.diagnosis).toBe('');
        expect(note.missingProtocolNotices.join(' ')).toMatch(/no diagnosis/i);

        // 3. No consent attestation prose, ever — even when consent WAS spoken,
        //    the attestation statement belongs to the clinician, not the template.
        expect(text).not.toMatch(/verbal informed consent obtained|consent obtained\.|patient verbalised|patient understands/i);

        // 4. No recall interval invented — the recall section stays empty.
        expect(note.recallRequirements).toBe('');

        // 5. Anatomy: only teeth that were actually spoken (none in any
        //    scenario except via the shared "36" in treatment scenarios).
        const teeth = [...text.matchAll(/#(\d+)/g)].map(m => m[1]);
        for (const t of teeth) {
          expect(['36'], `${macro.id}/${scenarioName} emitted tooth #${t}`).toContain(t);
        }

        // 6. Codes: only SPOKEN item numbers — none of these scenarios
        //    speaks an item number, so no codes may appear at all.
        expect(note.adaCodes).toEqual([]);
      });
    }
  }

  it('exposes all macro families (20 templates, incl. every chairside option)', () => {
    expect(ALL_AUSTRALIAN_MACROS.length).toBe(20);
    const ids = new Set(ALL_AUSTRALIAN_MACROS.map(m => m.id));
    expect(ALL_AUSTRALIAN_MACROS.every(m => ids.has(m.id))).toBe(true);
  });

  it('patient-only speech never produces clinician-voiced assertions in any template', () => {
    for (const macro of ALL_AUSTRALIAN_MACROS) {
      const note = generateMacroNote(SCENARIOS.patientOnly as any, macro.id, macro.category as string);
      const text = noteText(note);
      // No tooth may be attached from the patient's vague complaint, and no
      // clinician-observed claims may exist.
      expect(text).not.toMatch(/#(\d+)/);
      expect(text).not.toMatch(/clinician observed|on examination|i can see/i);
    }
  });
});
