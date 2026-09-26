import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { saveLocalConsultations, getLocalConsultations } from '../src/utils/storage';
import { Consultation } from '../src/types';
import { generateOfflineDraft } from '../src/lib/draftEngine';
import { getTemplateById } from '../src/lib/dentalLibrary';

describe('Rule 18: chair-active Ephemerality & Anti-Bleed Guarantees', () => {
  let storageMock: Record<string, string> = {};

  beforeEach(() => {
    storageMock = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storageMock[key] ?? null,
      setItem: (key: string, val: string) => {
        storageMock[key] = val;
      },
      removeItem: (key: string) => {
        delete storageMock[key];
      },
      clear: () => {
        storageMock = {};
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saveLocalConsultations filters out chair-active and never writes it to storage', () => {
    const consults: Consultation[] = [
      {
        id: 'chair-active',
        firstName: 'In-Chair',
        lastName: 'Patient',
        dob: '',
        appointmentType: 'examination',
        date: 'Sep 26',
        time: '9:41 AM',
        status: 'In Review',
        transcript: [],
        findings: {
          chiefComplaint: 'Stale complaint',
          history: '',
          toothFindings: '#16 MO restoration',
          findingsGingival: '',
          diagnosis: '',
          treatmentPerformed: '',
          recommendations: '',
          recallRequirements: ''
        },
        patientSummary: ''
      },
      {
        id: 'real-consult-123',
        firstName: 'Sarah',
        lastName: 'Connor',
        dob: '1984-05-12',
        appointmentType: 'examination',
        date: 'Sep 26',
        time: '10:00 AM',
        status: 'Completed',
        transcript: [],
        findings: {
          chiefComplaint: '',
          history: '',
          toothFindings: '',
          findingsGingival: '',
          diagnosis: '',
          treatmentPerformed: '',
          recommendations: '',
          recallRequirements: ''
        },
        patientSummary: ''
      }
    ];

    saveLocalConsultations(consults, 'dentist-01');
    const loaded = getLocalConsultations('dentist-01');

    expect(loaded).toBeDefined();
    expect(loaded?.length).toBe(1);
    expect(loaded![0].id).toBe('real-consult-123');
    expect(storageMock['dentai_consultations_cache_dentist-01']).toBeDefined();
    expect(storageMock['dentai_consultations_cache_dentist-01']).not.toContain('chair-active');
  });

  it('getLocalConsultations purges chair-active even if it was previously written to storage', () => {
    storageMock['dentai_consultations_cache_dentist-01'] = JSON.stringify([
      { id: 'chair-active', firstName: 'In-Chair' },
      { id: 'legit-456', firstName: 'John' }
    ]);

    const loaded = getLocalConsultations('dentist-01');
    expect(loaded?.length).toBe(1);
    expect(loaded![0].id).toBe('legit-456');
  });

  it('draftEngine routes Denosumab/osteoporosis dialogue to medical history and GP clearance to recommendations/plan', () => {
    const template = getTemplateById('standard');
    const transcript = [
      { sender: 'Dentist' as const, text: 'Are you taking any medications or seeing your GP?' },
      { sender: 'Patient' as const, text: 'I am taking denosumab injections for osteoporosis 2 days ago.' },
      { sender: 'Dentist' as const, text: 'We will check with your GP for medical clearance before proceeding.' }
    ];

    const draft = generateOfflineDraft(template, transcript, 'In-Chair Patient');

    expect(draft.canonical.history.toLowerCase()).toContain('denosumab');
    expect(draft.canonical.history.toLowerCase()).toContain('osteoporosis');
    expect(draft.canonical.recommendations.toLowerCase()).toContain('gp');

    // Also verify SOAP template maps GP clearance to plan
    const soapTemplate = getTemplateById('soap');
    const soapDraft = generateOfflineDraft(soapTemplate, transcript, 'In-Chair Patient');
    expect(soapDraft.customSections.plan.toLowerCase()).toContain('gp');
  });

  it('normalizes spoken acoustic mis-transcriptions for high-risk dental pharmacotherapy', async () => {
    const { normalizeSpokenDentalText } = await import('../src/lib/dentalPhoneticLexicon');
    const input = 'Patient takes Dimosuma injection every 6 months for osteoporosis and the thinner right with elequis.';
    const normalized = normalizeSpokenDentalText(input);

    expect(normalized).toContain('Denosumab (Prolia)');
    expect(normalized).toContain('blood thinner');
    expect(normalized).toContain('Eliquis (apixaban)');
    expect(normalized).toContain('osteoporosis');
  });

  it('deduplicates consultations by ID in local storage to prevent queue bloat', () => {
    const consults: Consultation[] = [
      { id: 'c-1', firstName: 'Alice', lastName: 'A', dob: '', appointmentType: 'examination', date: '2026-09-26', time: '9:00', status: 'In Review', transcript: [], findings: { chiefComplaint: '', history: '', toothFindings: '', findingsGingival: '', diagnosis: '', treatmentPerformed: '', recommendations: '', recallRequirements: '' }, patientSummary: '' },
      { id: 'c-1', firstName: 'Alice Duplicate', lastName: 'A', dob: '', appointmentType: 'examination', date: '2026-09-26', time: '9:00', status: 'In Review', transcript: [], findings: { chiefComplaint: '', history: '', toothFindings: '', findingsGingival: '', diagnosis: '', treatmentPerformed: '', recommendations: '', recallRequirements: '' }, patientSummary: '' },
      { id: 'c-2', firstName: 'Bob', lastName: 'B', dob: '', appointmentType: 'examination', date: '2026-09-26', time: '10:00', status: 'In Review', transcript: [], findings: { chiefComplaint: '', history: '', toothFindings: '', findingsGingival: '', diagnosis: '', treatmentPerformed: '', recommendations: '', recallRequirements: '' }, patientSummary: '' }
    ];

    saveLocalConsultations(consults, 'dentist-vik');
    const loaded = getLocalConsultations('dentist-vik');

    expect(loaded?.length).toBe(2);
    expect(loaded?.map(c => c.id)).toEqual(['c-1', 'c-2']);
  });
});
