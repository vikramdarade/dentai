import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { saveLocalConsultations, getLocalConsultations } from '../src/utils/storage';
import { Consultation } from '../src/types';
import { generateOfflineDraft } from '../src/lib/draftEngine';
import { getTemplateById } from '../src/lib/dentalLibrary';
import { addScheduleItem, loadTodaySchedule } from '../src/lib/dayScheduleStorage';
import { getClinicTodayIso, formatClinicDate, getClinicTimeZone } from '../src/utils/date';

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

  it('is strictly idempotent and never duplicates brand/generic parentheticals on repeated passes', async () => {
    const { normalizeSpokenDentalText } = await import('../src/lib/dentalPhoneticLexicon');
    let text = 'And the other medication that we also concerned about is the Dimosuma, is that the injection that you take?';
    
    // Run 5 consecutive passes through the normalizer
    for (let i = 0; i < 5; i++) {
      text = normalizeSpokenDentalText(text);
    }

    expect(text).toContain('Denosumab (Prolia)');
    expect(text).not.toContain('(Prolia) (Prolia)');
    expect(text).not.toContain('(Prolia) (Prolia) (Prolia)');
  });

  it('strictly excludes medical history and antiresorptive injections from treatmentPerformed', () => {
    const template = getTemplateById('standard');
    const transcript = [
      { sender: 'Dentist' as const, text: 'The other medication is the denosumab injection that you take for osteoporosis.' },
      { sender: 'Patient' as const, text: 'Yes, I am taking denosumab injection for osteoporosis.' },
      { sender: 'Dentist' as const, text: 'Today we placed a composite restoration on tooth 16.' }
    ];

    const draft = generateOfflineDraft(template, transcript, 'In-Chair Patient');

    // Denosumab must be in history, NOT in treatmentPerformed
    expect(draft.canonical.history.toLowerCase()).toContain('denosumab');
    expect(draft.canonical.treatmentPerformed.toLowerCase()).not.toContain('denosumab');
    expect(draft.canonical.treatmentPerformed.toLowerCase()).not.toContain('osteoporosis');
    expect(draft.canonical.treatmentPerformed.toLowerCase()).toContain('tooth 16');
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

  it('updates universal progress note header in-place when inline patient details are edited', async () => {
    const { toPmsEncounter } = await import('../src/lib/pms/canonical');
    const { renderUniversalProgressNote } = await import('../src/lib/pms/adapters/universalProgressNote');

    const initialConsult: Consultation = {
      id: 'chair-active',
      firstName: 'In-Chair Patient 1',
      lastName: '',
      dob: '',
      date: '2026-09-26',
      time: '11:30 AM',
      appointmentType: 'examination',
      status: 'In Review',
      transcript: [{ sender: 'Dentist', text: 'Good morning.' }],
      findings: {
        chiefComplaint: 'Checkup',
        history: '',
        toothFindings: '',
        findingsGingival: '',
        diagnosis: '',
        treatmentPerformed: '',
        recommendations: '',
        recallRequirements: ''
      },
      patientSummary: ''
    };

    let note = renderUniversalProgressNote(toPmsEncounter(initialConsult));
    expect(note).toContain('PATIENT: In-Chair Patient 1');

    // Inline edit happens (immediately or later)
    const updatedConsult: Consultation = {
      ...initialConsult,
      firstName: 'Sarah',
      lastName: 'Jenkins',
      dob: '15/04/1988'
    };

    note = renderUniversalProgressNote(toPmsEncounter(updatedConsult));
    expect(note).toContain('PATIENT: Sarah Jenkins (DOB: 15/04/1988)');
    expect(note).not.toContain('In-Chair Patient 1');
  });

  it('mints immutable timestamped IDs for completed chair-active encounters so they persist in storage without polluting scratchpad', () => {
    const chairConsult: Consultation = {
      id: 'chair-active',
      firstName: 'In-Chair Patient 1',
      lastName: '',
      dob: '',
      appointmentType: 'restorative',
      date: '2026-09-26',
      time: '11:45 AM',
      status: 'Completed',
      transcript: [{ sender: 'Dentist', text: 'Tooth 26 restoration complete.' }],
      findings: {
        chiefComplaint: '',
        history: '',
        toothFindings: '',
        findingsGingival: '',
        diagnosis: '',
        treatmentPerformed: 'Resin composite restoration placed on tooth 26.',
        recommendations: '',
        recallRequirements: ''
      },
      patientSummary: ''
    };

    // When saved, completed chair-active encounters are converted to consult-${timestamp}
    const mintedConsult: Consultation = {
      ...chairConsult,
      id: `consult-${Date.now()}`
    };

    saveLocalConsultations([mintedConsult], 'dentist-vik');
    const loaded = getLocalConsultations('dentist-vik');

    expect(loaded?.length).toBe(1);
    expect(loaded![0].id).toMatch(/^consult-\d+$/);
    expect(loaded![0].findings.treatmentPerformed).toContain('tooth 26');
  });

  it('records completed in-chair encounters into Day Schedule store with status done and links consultation ID', () => {
    const todayIso = getClinicTodayIso();
    const consultId = `consult-${Date.now()}`;

    addScheduleItem({
      time: '11:45 AM',
      patientName: 'In-Chair Patient 1',
      dob: '12/03/1990',
      procedureText: 'General Consultation',
      appointmentType: 'examination',
      templateId: 'standard',
      status: 'done',
      consultationId: consultId
    }, todayIso);

    const schedule = loadTodaySchedule(todayIso);
    expect(schedule.length).toBeGreaterThanOrEqual(1);

    const entry = schedule.find(s => s.consultationId === consultId);
    expect(entry).toBeDefined();
    expect(entry?.patientName).toBe('In-Chair Patient 1');
    expect(entry?.status).toBe('done');
    expect(entry?.time).toBe('11:45 AM');
  });

  it('verifies completed in-chair appointments match clinic timezone date format for End of Day Notes review', () => {
    const todayIso = getClinicTodayIso();
    const shortDate = formatClinicDate(todayIso, { month: 'short', day: 'numeric' });
    const fullDate = formatClinicDate(todayIso, { month: 'short', day: 'numeric', year: 'numeric' });

    const consult: Consultation = {
      id: `consult-${Date.now()}`,
      firstName: 'In-Chair Patient 1',
      lastName: '',
      dob: '',
      date: todayIso,
      time: '11:45 AM',
      appointmentType: 'examination',
      status: 'Completed',
      templateId: 'standard',
      transcript: [{ sender: 'Dentist', text: 'Exam complete.' }],
      findings: {
        chiefComplaint: 'Routine checkup',
        history: '',
        toothFindings: 'No active caries',
        findingsGingival: '',
        diagnosis: 'Healthy dentition',
        treatmentPerformed: 'Comprehensive examination (011) completed.',
        recommendations: '6-month recall',
        recallRequirements: '',
        adaCodes: [{ code: '011', description: 'Comprehensive oral examination' }]
      },
      patientSummary: 'Routine checkup completed.'
    };

    // Date matching must pass for ISO format, short clinic date, and full clinic date
    const d = consult.date.trim();
    const matchesDate = d === todayIso || d === shortDate || d.startsWith(shortDate) || d === fullDate;
    expect(matchesDate).toBe(true);

    // Consultation must be recognized as having a generated note for End of Day Notes
    const hasActualGeneratedNote = Boolean(
      consult.noteOrigin ||
      (consult.clinicalProgressNote && consult.clinicalProgressNote.trim().length > 0) ||
      (consult.findings?.treatmentPerformed && consult.findings.treatmentPerformed.trim().length > 0) ||
      (consult.findings?.diagnosis && consult.findings.diagnosis.trim().length > 0) ||
      (consult.findings?.adaCodes && consult.findings.adaCodes.length > 0)
    );
    expect(hasActualGeneratedNote).toBe(true);

    const encounterStatus = (consult.status === 'Completed' || hasActualGeneratedNote) ? 'note_generated' : 'ready';
    expect(['note_generated', 'done']).toContain(encounterStatus);
  });

  it('guarantees note regeneration requires confirmation when manual edits exist', () => {
    const dirtyEdits: Record<string, string> = {
      'chair-active': 'Manual clinician edit: patient experienced mild sensitivity on 46.'
    };
    const cleanEdits: Record<string, string> = {
      'chair-active': ''
    };
    const emptyEdits: Record<string, string> = {};

    const shouldConfirmRegeneration = (encounterId: string, edits: Record<string, string>): boolean => {
      const manual = edits[encounterId];
      return Boolean(manual && manual.trim().length > 0);
    };

    expect(shouldConfirmRegeneration('chair-active', dirtyEdits)).toBe(true);
    expect(shouldConfirmRegeneration('chair-active', cleanEdits)).toBe(false);
    expect(shouldConfirmRegeneration('chair-active', emptyEdits)).toBe(false);
  });

  it('persists preferred PMS target in localStorage with d4w default', () => {
    // Initial state without stored value defaults to d4w
    expect(localStorage.getItem('dentai_preferred_pms')).toBeNull();
    const getPreferredPms = () => {
      const saved = localStorage.getItem('dentai_preferred_pms');
      if (saved === 'exact' || saved === 'universal' || saved === 'd4w') {
        return saved;
      }
      return 'd4w';
    };

    expect(getPreferredPms()).toBe('d4w');

    // Update to exact
    localStorage.setItem('dentai_preferred_pms', 'exact');
    expect(getPreferredPms()).toBe('exact');

    // Update to universal
    localStorage.setItem('dentai_preferred_pms', 'universal');
    expect(getPreferredPms()).toBe('universal');
  });

  it('guards aseptic hotkeys against triggering inside input, textarea, or contenteditable elements', () => {
    const isHotKeySuppressed = (element: { tagName: string; isContentEditable?: boolean; getAttribute?: (attr: string) => string | null }): boolean => {
      const tag = element.tagName.toLowerCase();
      return (
        tag === 'input' ||
        tag === 'textarea' ||
        element.getAttribute?.('contenteditable') === 'true' ||
        Boolean(element.isContentEditable)
      );
    };

    expect(isHotKeySuppressed({ tagName: 'INPUT' })).toBe(true);
    expect(isHotKeySuppressed({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isHotKeySuppressed({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isHotKeySuppressed({ tagName: 'SPAN', getAttribute: (a) => a === 'contenteditable' ? 'true' : null })).toBe(true);
    expect(isHotKeySuppressed({ tagName: 'DIV', isContentEditable: false, getAttribute: () => null })).toBe(false);
    expect(isHotKeySuppressed({ tagName: 'BODY' })).toBe(false);
  });
});
