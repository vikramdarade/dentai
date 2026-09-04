import { describe, it, expect } from 'vitest';
import {
  APPOINTMENT_TYPES,
  BUILT_IN_TEMPLATES,
  getDefaultTemplateIdForType,
  getTemplateById,
  TEMPLATE_BY_ID,
  isCanonicalField
} from '../src/lib/dentalLibrary';
import { normalizeTemplateOutput } from '../src/lib/normalizeNoteOutput';

describe('dental template library invariants', () => {
  it('covers all 8 core treatment types with a unique default template', () => {
    expect(APPOINTMENT_TYPES).toHaveLength(8);
    const ids = APPOINTMENT_TYPES.map((t) => t.defaultTemplateId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('maps every appointment type to a template that declares it', () => {
    for (const type of APPOINTMENT_TYPES) {
      const template = getTemplateById(type.defaultTemplateId);
      expect(template).toBeDefined();
      expect(template.appointmentType).toBe(type.value);
      expect(template.sections.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('every built-in template id is unique and sections have safe keys', () => {
    const ids = BUILT_IN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of BUILT_IN_TEMPLATES) {
      for (const s of t.sections) {
        expect(s.key).toMatch(/^[A-Za-z][A-Za-z0-9_]{0,39}$/);
        expect(s.key).not.toBe('patientSummary');
        expect(s.key).not.toBe('adaCodes');
      }
    }
  });

  it('legacy ids still resolve (standard, soap, restorative)', () => {
    expect(getTemplateById('standard').id).toBe('standard');
    expect(getTemplateById('soap').id).toBe('soap');
    expect(getTemplateById('restorative').id).toBe('restorative');
    expect(getTemplateById('unknown-template').id).toBe('standard');
  });

  it('all appointment types are persisted under the documented union', () => {
    expect(getDefaultTemplateIdForType('scale_clean')).toBe('hygiene');
    expect(getDefaultTemplateIdForType('examination')).toBe('standard');
    expect(getDefaultTemplateIdForType('paediatric')).toBe('paediatric');
  });
});

describe('normalizeTemplateOutput contract', () => {
  it('maps canonical keys top-level and extra keys into customSections', () => {
    const template = getTemplateById('endo');
    const output = normalizeTemplateOutput(template, {
      chiefComplaint: 'Pain to cold on tooth 26 for a week.',
      toothFindings: 'Tooth 26: tender to percussion.',
      diagnosis: 'Symptomatic irreversible pulpitis.',
      treatmentPerformed: 'Access opened, canals instrumented.',
      periapicalAssessment: 'Periapical radiolucency visible.',
      patientSummary: 'Dear Sam, your tooth needs a second visit.',
      adaCodes: '415 - Pulp extirpation (Tooth 26)'
    });

    expect(isCanonicalField('chiefComplaint')).toBe(true);
    expect(output.chiefComplaint).toContain('cold');
    expect(output.toothFindings).toContain('26');
    expect(output.customSections.periapicalAssessment).toContain('radiolucency');
    expect(output.patientSummary).toContain('second visit');
    expect(output.adaCodes[0].code).toBe('415');
    expect((output.adaCodes[0] as any).tooth).toBe('26');
  });

  it('never injects empty or oversized values', () => {
    const template = getTemplateById('standard');
    const output = normalizeTemplateOutput(template, {
      chiefComplaint: 'x'.repeat(5000),
      history: 42,
      patientSummary: ''
    });
    expect((output.chiefComplaint as string).length).toBeLessThanOrEqual(4000);
    expect(output.history).toBe('');
    expect(output.patientSummary).toBe('');
  });
});

describe('built-in template ids present for registry consumers', () => {
  it('TEMPLATE_BY_ID includes every built-in', () => {
    for (const t of BUILT_IN_TEMPLATES) {
      expect(TEMPLATE_BY_ID[t.id]).toBeDefined();
    }
  });
});
