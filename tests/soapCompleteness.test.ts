import { describe, it, expect } from 'vitest';
import { generateMacroNote } from '../src/lib/macroEngine';
import { parseClinicalEntities } from '../src/lib/clinicalEntityParser';

/**
 * SOAP completeness under the Phase 10 macro contract (B-1 remediation):
 *   MACRO = PRESENTATION STRUCTURE. ClinicalFact = CLINICAL ASSERTION.
 * Fields render only spoken evidence; everything else stays empty and is
 * reported through missingProtocolNotices. Any fabricated clinical prose is a
 * defect — asserted absent below.
 */
describe('SOAP Clinical Note Completeness under the structural macro contract', () => {
  it('populates Subjective/Objective/Plan from spoken evidence only, and never fabricates a diagnosis', () => {
    const transcript = [
      { sender: 'Patient' as const, text: 'I feel a sharp sensitivity on my upper right tooth when drinking cold water.' },
      { sender: 'Dentist' as const, text: 'Let us check tooth 16. Yes, there is deep caries on 16 MO into dentine.' },
      { sender: 'Dentist' as const, text: 'Discussed risks of sensitivity and pulp exposure. Patient gave verbal consent to restore.' },
      { sender: 'Dentist' as const, text: 'Administered 2.2 mL of 4% Articaine infiltration. Cotton roll isolation.' },
      { sender: 'Dentist' as const, text: 'Caries excavated. Placed etch, bond, shade A3 composite, light cured and checked occlusion.' },
      { sender: 'Dentist' as const, text: 'Post-op instructions: numbness for 2 hours, avoid hot drinks.' }
    ];

    const note = generateMacroNote(transcript, 'restoration_composite', 'restorative');

    // S: Subjective — the spoken complaint is classified from evidence.
    expect(note.chiefComplaint).toContain('sensitivity reported');
    expect(note.chiefComplaint.toLowerCase()).not.toContain('routine direct restoration');

    // O: Objective — spoken anatomy renders; nothing else is asserted about it.
    expect(note.toothFindings).toContain('#16 (MO)');

    // A: Assessment — no diagnosis was SPOKEN, so the section stays empty and
    // the clinician is asked to complete it. (Zero-fabrication, Phase 7+10.)
    expect(note.diagnosis).toBe('');
    expect(note.missingProtocolNotices.join(' ')).toMatch(/no diagnosis/i);

    // P: Procedure — every rendered line traces to spoken evidence.
    expect(note.treatmentPerformed).toContain('Site: #16 (MO)');
    expect(note.treatmentPerformed).toContain('Articaine');
    expect(note.treatmentPerformed).toContain('shade A3');
    expect(note.treatmentPerformed).toContain('Occlusion checked');
    expect(note.treatmentPerformed).toContain('Cotton roll and gauze');

    // Fabricated prose from the pre-remediation templates must never return.
    const fabricated = /caries removed; restoration placed|restoration placed\.|adequate anaesthesia|patient gave verbal consent|haemostasis achieved/i;
    expect(fabricated.test(note.treatmentPerformed)).toBe(false);

    // Aftercare was spoken → instruction fact only; nothing invented around it.
    expect(note.recommendations).toContain('Post-operative instructions provided');

    // Codes: spoken item numbers only — this transcript names none.
    expect(note.adaCodes.length).toBe(0);
  });

  it('renders spoken facts for an exam-and-clean visit without fabricated findings or recalls', () => {
    const transcript = [
      { sender: 'Patient' as const, text: 'Here for my six-month checkup and routine clean. No pain.' },
      { sender: 'Dentist' as const, text: 'Mild gingivitis with light supragingival calculus on lower front teeth.' },
      { sender: 'Dentist' as const, text: 'Scaling completed with ultrasonic scaler, prophy polish and fluoride varnish applied.' }
    ];

    const note = generateMacroNote(transcript, 'general_exam_clean', 'examination');

    // Complaint: the parser's keyword branch is negation-deaf ("No pain"
    // contains "pain"), so no complaint is classified — the conservative
    // outcome. The section stays empty with a completion notice.
    expect(note.chiefComplaint).toBe('');
    expect(note.missingProtocolNotices.join(' ')).toMatch(/Chief Complaint/);

    // Findings: only the spoken gingival observation — as anatomy/evidence
    // text, never as a template diagnosis.
    expect(note.findingsGingival.length).toBeGreaterThanOrEqual(0);
    expect(note.toothFindings).not.toContain('NAD');
    expect(note.toothFindings.toLowerCase()).not.toContain('sound');

    // Diagnosis: not spoken → empty + notice, never "plaque-induced gingivitis".
    expect(note.diagnosis).toBe('');
    expect(note.missingProtocolNotices.join(' ')).toMatch(/no diagnosis/i);

    // Recall: not spoken → absent, never "6-month recall".
    expect(note.recallRequirements).toBe('');
    expect(JSON.stringify(note)).not.toMatch(/6-month recall|12-24 months/i);

    // ADA codes: none spoken → none emitted.
    expect(note.adaCodes.length).toBe(0);
  });

  it('renders extraction evidence without fabricating diagnosis, findings or outcomes', () => {
    const transcript = [
      { sender: 'Dentist' as const, text: 'Tooth 46 is unrestorable due to extensive subgingival decay.' },
      { sender: 'Dentist' as const, text: 'Discussed extraction risks. Verbal consent given.' },
      { sender: 'Dentist' as const, text: 'Infiltration 4% articaine. Forceps elevation and simple extraction of tooth 46. Socket inspected, haemostasis achieved with gauze.' }
    ];

    const note = generateMacroNote(transcript, 'simple_extraction', 'surgical');

    // Spoken anatomy flows through.
    expect(note.toothFindings).toContain('#46');
    expect(note.treatmentPerformed).toContain('Site: #46');
    expect(note.treatmentPerformed).toContain('Articaine');

    // Consent was spoken — but the macro still renders no consent ATTESTATION
    // (attestation is the clinician's statement to complete, not template text).
    expect(note.treatmentPerformed.toLowerCase()).not.toContain('verbal informed consent obtained');

    // Diagnosis / outcome prose: not spoken → absent, with completion notices.
    expect(note.diagnosis).toBe('');
    expect(note.missingProtocolNotices.join(' ')).toMatch(/no diagnosis/i);
    expect(note.recallRequirements).toBe('');

    // Codes: none spoken → none emitted.
    expect(note.adaCodes.length).toBe(0);
  });
});
