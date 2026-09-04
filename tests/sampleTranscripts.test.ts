import { describe, it, expect } from 'vitest';
import { SAMPLE_TRANSCRIPTS, getSampleForType } from '../src/lib/sampleTranscripts';
import { APPOINTMENT_TYPES, getDefaultTemplateIdForType, getTemplateById } from '../src/lib/dentalLibrary';
import { generateOfflineDraft } from '../src/lib/draftEngine';
import { TranscriptItem } from '../src/types';

const VALID_SENDERS = new Set(['Dentist', 'Patient', 'Dialogue', 'Clinical Comment']);

describe('sample transcript library', () => {
  it('covers all 8 treatment types exactly once', () => {
    expect(SAMPLE_TRANSCRIPTS).toHaveLength(8);
    const types = SAMPLE_TRANSCRIPTS.map((s) => s.appointmentType);
    expect(new Set(types).size).toBe(types.length);
    for (const t of APPOINTMENT_TYPES) {
      expect(types).toContain(t.value);
    }
  });

  it('getSampleForType returns the matching sample', () => {
    expect(getSampleForType('scale_clean')?.title).toBe('Scale & Clean');
    expect(getSampleForType('endodontic')?.items.length).toBeGreaterThan(5);
    expect(getSampleForType('examination')?.items.length).toBeGreaterThan(5);
  });

  it('every transcript is server-valid (senders, lengths, item count)', () => {
    for (const sample of SAMPLE_TRANSCRIPTS) {
      expect(sample.items.length).toBeLessThanOrEqual(200);
      for (const item of sample.items) {
        expect(VALID_SENDERS.has(item.sender)).toBe(true);
        expect(item.text.length).toBeGreaterThan(0);
        expect(item.text.length).toBeLessThanOrEqual(1000);
      }
    }
  });

  it('every sample has at least one patient and one clinician utterance', () => {
    for (const sample of SAMPLE_TRANSCRIPTS) {
      const senders = sample.items.map((i) => i.sender);
      expect(senders).toContain('Patient');
      expect(senders.some((s) => s === 'Dentist' || s === 'Clinical Comment')).toBe(true);
    }
  });
});

describe('sample transcripts produce template-shaped offline drafts', () => {
  const draftFor = (sample: (typeof SAMPLE_TRANSCRIPTS)[number]) => {
    const templateId = getDefaultTemplateIdForType(sample.appointmentType);
    const template = getTemplateById(templateId);
    return { templateId, template, draft: generateOfflineDraft(template, sample.items) };
  };

  it('exam sample: finds the early cavity tooth and the stated exam item codes', () => {
    const { templateId, draft } = draftFor(getSampleForType('examination')!);
    expect(templateId).toBe('standard');
    expect(draft.canonical.toothFindings ?? '').toContain('46');
    expect(draft.canonical.chiefComplaint ?? '').toContain('bleeding');
    const codes = draft.adaCodes.map((c) => c.code);
    expect(codes).toContain('011');
    expect(codes).toContain('026');
  });

  it('scale & clean sample: gingivitis diagnosis, calculus findings, item 114/121', () => {
    const { templateId, draft } = draftFor(getSampleForType('scale_clean')!);
    expect(templateId).toBe('hygiene');
    expect((draft.canonical.diagnosis ?? '').toLowerCase()).toContain('gingivitis');
    expect((draft.canonical.findingsGingival ?? '').toLowerCase()).toContain('calculus');
    const codes = draft.adaCodes.map((c) => c.code);
    expect(codes).toContain('114');
    expect(codes).toContain('121');
  });

  it('emergency sample: pulpitis diagnosis on FDI tooth 36 with item 013/022', () => {
    const { templateId, draft } = draftFor(getSampleForType('emergency')!);
    expect(templateId).toBe('emergency');
    expect((draft.canonical.diagnosis ?? '').toLowerCase()).toContain('pulpitis');
    expect(draft.canonical.toothFindings ?? '').toContain('36');
    const codes = draft.adaCodes.map((c) => c.code);
    expect(codes).toContain('013');
    expect(codes).toContain('022');
  });

  it('restorative sample: tooth 46 findings, occlusion note and item 511', () => {
    const { templateId, draft } = draftFor(getSampleForType('restorative')!);
    expect(templateId).toBe('restorative');
    expect(draft.canonical.toothFindings ?? '').toContain('46');
    expect((draft.customSections.toothIsolation ?? '').toLowerCase()).toContain('high spot');
    const codes = draft.adaCodes.map((c) => c.code);
    expect(codes).toContain('511');
  });

  it('endo sample: periapical radiograph assessment and extirpation/obturation codes', () => {
    const { templateId, draft } = draftFor(getSampleForType('endodontic')!);
    expect(templateId).toBe('endo');
    expect((draft.customSections.periapicalAssessment ?? '').toLowerCase()).toContain('radiograph');
    expect(draft.canonical.toothFindings ?? '').toContain('26');
    const codes = draft.adaCodes.map((c) => c.code);
    expect(codes).toContain('414');
    expect(codes).toContain('415');
  });

  it('surgical sample: stated diagnosis, post-op care section and item 311 captured', () => {
    const { templateId, draft } = draftFor(getSampleForType('surgical')!);
    expect(templateId).toBe('surgical');
    expect((draft.canonical.diagnosis ?? '').toLowerCase()).toContain('pericoronitis');
    expect(draft.canonical.toothFindings ?? '').toContain('48');
    expect((draft.customSections.postOpInstructions ?? '').toLowerCase()).toContain('soft diet');
    const codes = draft.adaCodes.map((c) => c.code);
    expect(codes).toContain('311');
  });

  it('prostho sample: provisional note, shade/temporary content and item 572', () => {
    const { templateId, draft } = draftFor(getSampleForType('prosthodontic')!);
    expect(templateId).toBe('prostho');
    expect((draft.customSections.provisionalNote ?? '').toLowerCase()).toContain('temporary');
    const codes = draft.adaCodes.map((c) => c.code);
    expect(codes).toContain('572');
  });

  it('paediatric sample: behaviour assessment + prevention advice sections filled', () => {
    const { templateId, draft } = draftFor(getSampleForType('paediatric')!);
    expect(templateId).toBe('paediatric');
    expect((draft.customSections.behaviourAssessment ?? '').toLowerCase()).toContain('cooperat');
    expect((draft.customSections.recommendations ?? '').length).toBe(0); // paediatric recall uses canonical
    expect((draft.canonical.recommendations ?? '').toLowerCase()).toContain('sugar');
  });
});

describe('draft engine keeps the never-fabricate contract on every sample', () => {
  it('never outputs speaker prefixes or ADA codes the clinician never stated', () => {
    for (const sample of SAMPLE_TRANSCRIPTS) {
      const template = getTemplateById(getDefaultTemplateIdForType(sample.appointmentType));
      const draft = generateOfflineDraft(template, sample.items);
      const all = [
        ...Object.values(draft.canonical),
        ...Object.values(draft.customSections),
        draft.patientSummary
      ].join(' ');
      expect(all).not.toContain('Dentist:');
      expect(all).not.toContain('Patient:');
    }
  });
});
