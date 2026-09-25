import { describe, it, expect } from 'vitest';
import { generateMacroNote } from '../src/lib/macroEngine';
import { parseClinicalEntities } from '../src/lib/clinicalEntityParser';

describe('SOAP Clinical Note Completeness & Objective/Assessment Verification', () => {
  it('populates Subjective, Objective, Assessment, and Plan for Routine Restorations', () => {
    const transcript = [
      { sender: 'Patient' as const, text: 'I feel a sharp sensitivity on my upper right tooth when drinking cold water.' },
      { sender: 'Dentist' as const, text: 'Let us check tooth 16. Yes, there is deep caries on 16 MO into dentine.' },
      { sender: 'Dentist' as const, text: 'Discussed risks of sensitivity and pulp exposure. Patient gave verbal consent to restore.' },
      { sender: 'Dentist' as const, text: 'Administered 2.2 mL of 4% Articaine infiltration. Cotton roll isolation.' },
      { sender: 'Dentist' as const, text: 'Caries excavated. Placed etch, bond, shade A3 composite, light cured and checked occlusion.' },
      { sender: 'Dentist' as const, text: 'Post-op instructions: numbness for 2 hours, avoid hot drinks.' }
    ];

    const note = generateMacroNote(transcript, 'restoration_composite', 'restorative');

    // S: Subjective
    expect(note.chiefComplaint).toBeDefined();
    expect(note.chiefComplaint.length).toBeGreaterThan(10);
    expect(note.chiefComplaint.toLowerCase()).toMatch(/sensitivity|routine direct restoration/);

    // O: Objective (Hard & Soft tissue findings)
    expect(note.toothFindings).toBeDefined();
    expect(note.toothFindings.length).toBeGreaterThan(10);
    expect(note.toothFindings).toContain('#16 (MO)');
    expect(note.toothFindings.toLowerCase()).toContain('caries');

    // A: Assessment (Diagnosis)
    expect(note.diagnosis).toBeDefined();
    expect(note.diagnosis.length).toBeGreaterThan(5);
    expect(note.diagnosis).toContain('#16 (MO)');
    expect(note.diagnosis.toLowerCase()).toMatch(/caries|pulpitis/);

    // P: Plan & Procedure
    expect(note.treatmentPerformed).toBeDefined();
    expect(note.treatmentPerformed).toContain('#16 (MO)');
    expect(note.treatmentPerformed).toContain('Articaine');
    expect(note.treatmentPerformed).toContain('A3');
    expect(note.treatmentPerformed).toContain('Occlusion checked');
    expect(note.recommendations).toContain('Post-Operative Instructions');

    // ADA Item Codes
    expect(note.adaCodes.length).toBeGreaterThan(0);
    expect(note.adaCodes.some(c => c.code === '532')).toBe(true);
  });

  it('populates Objective and Assessment for General Examination & Clean', () => {
    const transcript = [
      { sender: 'Patient' as const, text: 'Here for my six-month checkup and routine clean. No pain.' },
      { sender: 'Dentist' as const, text: 'Examining soft tissues, all normal. No cavities detected on charting.' },
      { sender: 'Dentist' as const, text: 'Mild gingivitis with light supragingival calculus on lower front teeth.' },
      { sender: 'Dentist' as const, text: 'Scaling completed with ultrasonic scaler, prophy polish and fluoride varnish applied.' }
    ];

    const note = generateMacroNote(transcript, 'general_exam_clean', 'examination');

    expect(note.chiefComplaint).toContain('examination');
    expect(note.toothFindings).toContain('NAD');
    expect(note.findingsGingival).toContain('Periodontal Assessment');
    expect(note.diagnosis).toContain('gingivitis');
    expect(note.treatmentPerformed).toContain('Supra s/c');
    expect(note.treatmentPerformed).toContain('fluoride');
    expect(note.adaCodes.some(c => c.code === '011')).toBe(true);
    expect(note.adaCodes.some(c => c.code === '114')).toBe(true);
    expect(note.adaCodes.some(c => c.code === '121')).toBe(true);
  });

  it('populates Objective and Assessment for Simple Tooth Extraction', () => {
    const transcript = [
      { sender: 'Dentist' as const, text: 'Tooth 46 is unrestorable due to extensive subgingival decay.' },
      { sender: 'Dentist' as const, text: 'Discussed extraction risks. Verbal consent given.' },
      { sender: 'Dentist' as const, text: 'Infiltration 4% articaine. Forceps elevation and simple extraction of tooth 46. Socket inspected, haemostasis achieved with gauze.' }
    ];

    const note = generateMacroNote(transcript, 'simple_extraction', 'surgical');

    expect(note.toothFindings).toContain('#46');
    expect(note.diagnosis).toContain('#46');
    expect(note.treatmentPerformed).toContain('#46');
    expect(note.treatmentPerformed).toContain('forceps');
    expect(note.treatmentPerformed).toContain('Haemostasis achieved');
    expect(note.adaCodes.some(c => c.code === '311')).toBe(true);
  });
});
