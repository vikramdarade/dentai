import { describe, it, expect } from 'vitest';
import {
  PMS_REGISTRY,
  capabilityFor,
  isSupported,
  toPmsEncounter,
  renderForPms,
  renderAppointment,
  writeToPmsNote,
  writeToPmsInvoice,
  type PmsEncounter
} from '../src/lib/pms';
import type { Consultation } from '../src/types';

describe('PMS Adapter Layer & Capability Registry', () => {
  const sampleEncounter: PmsEncounter = {
    consultationId: 'consult-test-101',
    patientName: 'Jane Doe',
    dob: '1985-04-12',
    appointmentType: 'Comprehensive Examination',
    date: '2026-09-20',
    time: '10:30 AM',
    practitioner: 'Dr. Sarah Jenkins',
    sections: [
      { key: 'chiefComplaint', label: 'Chief Complaint', value: 'Sensitivity on upper right molar with cold drinks.' },
      { key: 'toothFindings', label: 'Tooth Findings', value: 'Tooth 16: Mesial occlusal caries detected.' },
      { key: 'treatmentPerformed', label: 'Treatment Performed', value: 'Composite resin restoration 16 MO under local infiltration.' }
    ],
    itemCodes: [
      { code: '011', description: 'Comprehensive oral examination' },
      { code: '531', description: 'Adhesive restoration - 1 surface - posterior', tooth: '16' }
    ],
    patientSummary: 'Discussed oral hygiene maintenance and follow-up in 6 months.',
    needsReview: false
  };

  const sampleConsultation: Consultation = {
    id: 'consult-test-101',
    dentistId: 'dentist-01',
    dentistName: 'Dr. Sarah Jenkins',
    firstName: 'Jane',
    lastName: 'Doe',
    dob: '1985-04-12',
    date: '2026-09-20',
    time: '10:30 AM',
    appointmentType: 'examination',
    status: 'Completed',
    transcript: [],
    findings: {
      chiefComplaint: 'Sensitivity on upper right molar with cold drinks.',
      history: 'Non-contributory',
      toothFindings: 'Tooth 16: Mesial occlusal caries detected.',
      findingsGingival: 'Normal',
      diagnosis: 'Caries 16',
      treatmentPerformed: 'Composite resin restoration 16 MO under local infiltration.',
      recommendations: 'Hygiene recall',
      recallRequirements: '6 months',
      adaCodes: [
        { code: '011', description: 'Comprehensive oral examination' },
        { code: '531', description: 'Adhesive restoration - 1 surface - posterior', tooth: '16' }
      ]
    },
    patientSummary: 'Discussed oral hygiene maintenance and follow-up in 6 months.'
  };

  it('correctly maps a Consultation to a pure canonical PmsEncounter', () => {
    const enc = toPmsEncounter(sampleConsultation);
    expect(enc.patientName).toBe('Jane Doe');
    expect(enc.dob).toBe('1985-04-12');
    expect(enc.practitioner).toBe('Dr. Sarah Jenkins');
    expect(enc.sections.length).toBe(8);
    expect(enc.itemCodes.length).toBe(2);
    expect(enc.itemCodes[1].tooth).toBe('16');
  });

  describe('Registry Invariants', () => {
    it('enforces that every PMS registry entry defaults to clipboard+file only with write channels false', () => {
      for (const [id, cap] of Object.entries(PMS_REGISTRY)) {
        expect(cap.channels.clipboard).toBe(true);
        expect(cap.channels.file).toBe(true);
        if (cap.source === 'unconfirmed') {
          expect(cap.channels.appointmentWrite).toBe(false);
          expect(cap.channels.noteWrite).toBe(false);
          expect(cap.channels.invoiceWrite).toBe(false);
        }
      }
    });

    it('safely handles unknown PMS IDs with generic clipboard capability', () => {
      const cap = capabilityFor('non-existent-pms-id');
      expect(cap.id).toBe('generic');
      expect(cap.channels.clipboard).toBe(true);
      expect(cap.channels.appointmentWrite).toBe(false);
      expect(isSupported('non-existent-pms-id', 'clipboard')).toBe(true);
      expect(isSupported('non-existent-pms-id', 'noteWrite')).toBe(false);
    });
  });

  describe('Golden Fixtures & Presentation Layouts', () => {
    it('renders Dental4Windows (D4W) layout with progress note headers and item numbers', () => {
      const rendered = renderForPms('d4w', sampleEncounter);
      expect(rendered.format).toBe('text');
      expect(rendered.body).toContain('=== DENTAL4WINDOWS CLINICAL PROGRESS NOTE ===');
      expect(rendered.body).toContain('PATIENT: Jane Doe (DOB: 1985-04-12)');
      expect(rendered.body).toContain('PROVIDER: Dr. Sarah Jenkins');
      expect(rendered.body).toContain('CHIEF COMPLAINT:');
      expect(rendered.body).toContain('ADA ITEM NUMBERS:');
      expect(rendered.body).toContain('- Item 531: Adhesive restoration - 1 surface - posterior (Tooth 16)');
    });

    it('renders EXACT (SOE) layout with bracketed section delimiters', () => {
      const rendered = renderForPms('exact', sampleEncounter);
      expect(rendered.format).toBe('text');
      expect(rendered.body).toContain('[SOE EXACT CLINICAL RECORD — 2026-09-20 10:30 AM]');
      expect(rendered.body).toContain('[Chief Complaint]');
      expect(rendered.body).toContain('Items Completed: 011, 531 (T16)');
    });

    it('renders Cliniko layout with clean markdown structure', () => {
      const rendered = renderForPms('cliniko', sampleEncounter);
      expect(rendered.format).toBe('text');
      expect(rendered.body).toContain('## Dental Treatment Note — 2026-09-20');
      expect(rendered.body).toContain('**Patient:** Jane Doe');
      expect(rendered.body).toContain('### Chief Complaint');
      expect(rendered.body).toContain('### Item Codes');
      expect(rendered.body).toContain('- **531** — Adhesive restoration - 1 surface - posterior (Tooth: 16)');
    });

    it('renders Core Practice layout with progress note headings', () => {
      const rendered = renderForPms('corepractice', sampleEncounter);
      expect(rendered.format).toBe('text');
      expect(rendered.body).toContain('CORE PRACTICE PROGRESS NOTE');
      expect(rendered.body).toContain('[Chief Complaint]');
      expect(rendered.body).toContain('[Item Numbers]');
    });

    it('renders generic fallback layout for unrecognised systems', () => {
      const rendered = renderForPms('future-system-xyz', sampleEncounter);
      expect(rendered.format).toBe('text');
      expect(rendered.body).toContain('[DentAI note — reviewed by treating practitioner]');
      expect(rendered.body).toContain('Chief Complaint: Sensitivity on upper right molar with cold drinks.');
      expect(rendered.body).toContain('Items: 011, 531 (16)');
    });
  });

  describe('Zero Fabrication & Defensive Absence', () => {
    it('omits item numbers when absent without inventing placeholder codes', () => {
      const encounterWithoutCodes: PmsEncounter = {
        ...sampleEncounter,
        itemCodes: []
      };
      const d4w = renderForPms('d4w', encounterWithoutCodes);
      expect(d4w.body).not.toContain('ADA ITEM NUMBERS:');

      const generic = renderForPms('generic', encounterWithoutCodes);
      expect(generic.body).not.toContain('Items:');
    });

    it('omits empty sections cleanly without dangling blank headings', () => {
      const minimalEncounter: PmsEncounter = {
        patientName: 'John Smith',
        appointmentType: 'Emergency',
        date: '2026-09-20',
        sections: [
          { key: 'chiefComplaint', label: 'Chief Complaint', value: 'Broken tooth' }
        ],
        itemCodes: [],
        needsReview: false
      };
      const rendered = renderForPms('generic', minimalEncounter);
      expect(rendered.body).toContain('Chief Complaint: Broken tooth');
      expect(rendered.body).not.toContain('Tooth Findings');
      expect(rendered.body).not.toContain('Diagnosis');
    });
  });

  describe('Unsupported Channel Boundary Exceptions', () => {
    it('refuses direct appointment write with an explicit capability error', () => {
      expect(() => renderAppointment('d4w', sampleEncounter)).toThrow(
        /Direct appointment write-back is not supported for Dental4Windows \(Centaur\)/
      );
    });

    it('refuses direct note write with an explicit capability error', () => {
      expect(() => writeToPmsNote('exact', sampleEncounter)).toThrow(
        /Direct clinical note write-back is not supported for EXACT/
      );
    });

    it('refuses direct invoice write with an explicit capability error', () => {
      expect(() => writeToPmsInvoice('cliniko', sampleEncounter)).toThrow(
        /Direct invoice write-back is not supported for Cliniko/
      );
    });
  });
});
