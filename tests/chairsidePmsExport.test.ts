import { describe, it, expect } from 'vitest';
import { toPmsEncounter, renderD4W, renderExact, renderUniversalProgressNote } from '../src/lib/pms';
import type { Consultation } from '../src/types';

describe('Chairside 1-Click PMS Export Formats', () => {
  const sampleConsultation: Consultation = {
    id: 'consult-test-chairside-01',
    dentistId: 'dentist-01',
    dentistName: 'Dr. Sarah Jenkins',
    firstName: 'John',
    lastName: 'Smith',
    dob: '1980-05-15',
    date: '2026-09-25',
    time: '14:00',
    appointmentType: 'restorative',
    status: 'Completed',
    patientSummary: 'Follow up in 6 months for review.',
    transcript: [],
    findings: {
      chiefComplaint: 'Broken filling on upper right molar',
      history: 'Nil known allergies, medically fit and well',
      toothFindings: 'Tooth 16: Defective MOD amalgam with recurrent distal caries',
      findingsGingival: 'Healthy gingiva, no bleeding on probing',
      diagnosis: 'Recurrent dental caries 16 MOD',
      treatmentPerformed: 'Composite resin restoration 16 MOD under rubber dam, 2.2ml Articaine infiltration',
      recommendations: 'Avoid hard foods on right side today, post-op care leaflet provided',
      recallRequirements: '6 months routine recall',
      adaCodes: [
        { code: '533', description: 'Adhesive restoration - 3 surfaces - posterior', tooth: '16' },
        { code: '022', description: 'Periapical radiograph', tooth: '16' }
      ]
    }
  };

  it('renders clean D4W format with section headers and tooth numbers', () => {
    const encounter = toPmsEncounter(sampleConsultation);
    const d4w = renderD4W(encounter);

    expect(d4w).toContain('DENTAL4WINDOWS CLINICAL PROGRESS NOTE');
    expect(d4w).toContain('PATIENT: John Smith');
    expect(d4w).toContain('TREATMENT PERFORMED:');
    expect(d4w).toContain('Composite resin restoration 16 MOD');
    expect(d4w).toContain('Item 533');
    expect(d4w).toContain('Tooth 16');
  });

  it('renders Exact / Software of Excellence note format', () => {
    const encounter = toPmsEncounter(sampleConsultation);
    const exact = renderExact(encounter);

    expect(exact).toContain('SOE EXACT CLINICAL RECORD');
    expect(exact).toContain('John Smith');
    expect(exact).toContain('16 MOD');
  });

  it('renders Universal Progress note for Cliniko and Core Practice', () => {
    const encounter = toPmsEncounter(sampleConsultation);
    const universal = renderUniversalProgressNote(encounter);

    expect(universal).toContain('CLINICAL PROGRESS NOTE');
    expect(universal).toContain('John Smith');
    expect(universal).toContain('Item 533');
  });
});
