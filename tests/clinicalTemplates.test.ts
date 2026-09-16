import { describe, it, expect } from 'vitest';
import {
  matchTemplateFromAppointmentReason,
  analyzeNoteGrounding,
  formatNoteForPmsClipboard,
  CLINICAL_TEMPLATES
} from '../src/lib/clinicalTemplates';

describe('Clinical Templates & Discrepancy Engine', () => {
  describe('matchTemplateFromAppointmentReason', () => {
    it('should map crown booking reasons to Crown Preparation template', () => {
      expect(matchTemplateFromAppointmentReason('Crown Prep 16').id).toBe('crown_preparation');
      expect(matchTemplateFromAppointmentReason('Zirconia crown prep and scan').id).toBe('crown_preparation');
      expect(matchTemplateFromAppointmentReason('Bridge preparation').id).toBe('crown_preparation');
    });

    it('should map root canal booking reasons to Endodontic template', () => {
      expect(matchTemplateFromAppointmentReason('RCT Stage 1 46').id).toBe('endodontic_therapy');
      expect(matchTemplateFromAppointmentReason('Root canal treatment').id).toBe('endodontic_therapy');
      expect(matchTemplateFromAppointmentReason('Pulp extirpation').id).toBe('endodontic_therapy');
    });

    it('should map filling booking reasons to Restorative Composite template', () => {
      expect(matchTemplateFromAppointmentReason('Filling 24 DO').id).toBe('restorative_composite');
      expect(matchTemplateFromAppointmentReason('Restore 16 MOD composite').id).toBe('restorative_composite');
      expect(matchTemplateFromAppointmentReason('Caries removal').id).toBe('restorative_composite');
    });

    it('should map emergency booking reasons to Emergency template', () => {
      expect(matchTemplateFromAppointmentReason('Emergency Toothache').id).toBe('emergency_relief');
      expect(matchTemplateFromAppointmentReason('Severe nocturnal pain and swelling').id).toBe('emergency_relief');
      expect(matchTemplateFromAppointmentReason('Broken tooth cuspal fracture').id).toBe('emergency_relief');
    });

    it('should default clean and checkup booking reasons to Comprehensive Exam template', () => {
      expect(matchTemplateFromAppointmentReason('Periodic Exam & Clean').id).toBe('comprehensive_exam');
      expect(matchTemplateFromAppointmentReason('Routine 6-month checkup').id).toBe('comprehensive_exam');
      expect(matchTemplateFromAppointmentReason('').id).toBe('comprehensive_exam');
    });
  });

  describe('analyzeNoteGrounding & Discrepancy Highlighting', () => {
    it('should flag stated spoken facts as grounded (green)', () => {
      const verbatim = 'Administered 1 cartridge 2% lignocaine with 1:80,000 adrenaline. Prepared tooth 16 for crown.';
      const fields = {
        anaesthesia: '1 cartridge 2% lignocaine with 1:80,000 adrenaline administered.'
      };
      const discrepancies = analyzeNoteGrounding(verbatim, fields, 'Crown Prep 16');
      const grounded = discrepancies.find(d => d.fieldId === 'anaesthesia');
      expect(grounded).toBeDefined();
      expect(grounded?.status).toBe('grounded');
    });

    it('should flag unstated template boilerplate as template_default (amber)', () => {
      const verbatim = 'Tooth 16 was prepared and scanned.';
      const fields = {
        post_op: 'Post-op instructions given: avoid sticky foods on temporary crown; call clinic immediately if temp crown dislodges.'
      };
      const discrepancies = analyzeNoteGrounding(verbatim, fields, 'Crown Prep 16');
      const boilerplate = discrepancies.find(d => d.fieldId === 'post_op');
      expect(boilerplate).toBeDefined();
      expect(boilerplate?.status).toBe('template_default');
    });

    it('should raise conflict alert if appointment book was Tooth 16 but spoken audio treated Tooth 26', () => {
      const verbatim = 'Examination reveals recurrent caries on tooth 26. We will restore tooth 26 today.';
      const fields = {
        tooth_surfaces: 'Tooth 26 MOD restoration placed.'
      };
      const discrepancies = analyzeNoteGrounding(verbatim, fields, 'Filling Tooth 16');
      const conflict = discrepancies.find(d => d.status === 'conflict');
      expect(conflict).toBeDefined();
      expect(conflict?.statement).toContain('Booked for Tooth 16');
      expect(conflict?.statement).toContain('Tooth 26');
    });
  });

  describe('formatNoteForPmsClipboard', () => {
    it('should format note ready for 1-click Ctrl+V paste into Dental4Windows / EXACT', () => {
      const formatted = formatNoteForPmsClipboard({
        patientName: 'Sarah Jenkins',
        templateName: 'Crown Preparation & Impression',
        fields: {
          tooth_indication: 'Tooth 16 fractured distobuccal cusp',
          anaesthesia: '1 cartridge 2% lignocaine with 1:80,000 adrenaline'
        },
        adaCodes: ['613', '022'],
        dentistName: 'Dr. Sarah Jenkins'
      });

      expect(formatted).toContain('DENTAI CLINICAL EXAMINATION & PROCEDURE NOTE');
      expect(formatted).toContain('Patient: Sarah Jenkins');
      expect(formatted).toContain('Tooth 16 fractured distobuccal cusp');
      expect(formatted).toContain('[ITEMISED ADA BILLING CODES]');
      expect(formatted).toContain('Item 613, Item 022');
      expect(formatted).toContain('Dr. Sarah Jenkins');
    });
  });
});
