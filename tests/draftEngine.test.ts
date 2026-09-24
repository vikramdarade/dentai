import { describe, it, expect } from 'vitest';
import { getTemplateById } from '../src/lib/dentalLibrary';
import { generateOfflineDraft, normalizeFdiSpoken } from '../src/lib/draftEngine';
import { TranscriptItem } from '../src/types';

const transcript: TranscriptItem[] = [
  { sender: 'Patient', text: "I've had a sharp pain in the upper right for two days now and it wakes me at night." },
  { sender: 'Dentist', text: 'Let me test. Percussion on tooth 16 is tender, and it lingers with cold.' },
  { sender: 'Dentist', text: 'This looks like pulpitis on 16. I will start the root canal — access opening completed today.' },
  { sender: 'Dentist', text: 'Avoid hot drinks and hard chewing on that side. Please come back in two weeks to finish the root canal.' }
];

describe('normalizeFdiSpoken', () => {
  it('keeps already-correct two digit FDI notation', () => {
    expect(normalizeFdiSpoken('Percussion on tooth 16')).toContain('tooth 16');
  });
  it('joins spaced digits "tooth 1 6" into FDI notation', () => {
    expect(normalizeFdiSpoken('Percussion on tooth 1 6')).toContain('tooth 16');
  });
  it('maps spoken word numbers "tooth one six" to FDI notation', () => {
    expect(normalizeFdiSpoken('Pain at tooth one six')).toContain('tooth 16');
  });
});

describe('generateOfflineDraft', () => {
  it('fills the emergency template sections from the transcript without fabricating', () => {
    const template = getTemplateById('emergency');
    const draft = generateOfflineDraft(template, transcript, 'Emergency / Pain');

    // Complaint comes from the patient's own words.
    expect(draft.canonical.chiefComplaint).toContain('pain');
    // Tooth findings reference the FDI tooth.
    expect(draft.canonical.toothFindings).toContain('16');
    // Diagnosis is only included when the clinician actually said it.
    expect(draft.canonical.diagnosis.toLowerCase()).toContain('pulpitis');
    expect(draft.canonical.treatmentPerformed.toLowerCase()).toContain('access');
    expect(draft.canonical.recommendations.toLowerCase()).toContain('avoid');
    expect(draft.canonical.recallRequirements.toLowerCase()).toContain('two weeks');
    // Safety: never invented ADA codes, never an invented letter.
    expect(draft.adaCodes).toEqual([]);
    expect(draft.patientSummary).toBe('');
  });

  it('leaves sections empty when nothing in the transcript supports them', () => {
    const template = getTemplateById('surgical');
    const draft = generateOfflineDraft(template, [
      { sender: 'Dentist', text: 'Sit back please.' },
      { sender: 'Patient', text: 'Okay.' }
    ], 'Surgical');
    // Nothing clinical was said — a draft must not invent an indication or procedure.
    expect(draft.canonical.chiefComplaint ?? '').toBe('');
    expect(draft.canonical.treatmentPerformed ?? '').toBe('');
    expect(draft.adaCodes).toEqual([]);
  });

  it('does not draft billing codes from mere item mentions in small talk', () => {
    const template = getTemplateById('hygiene');
    const draft = generateOfflineDraft(template, [
      { sender: 'Dentist', text: 'The 011 examination fee is already covered today.' }
    ], 'Scale & Clean');
    // 011 appears as a fee mention, not a performed item — the engine stays conservative.
    expect(draft.adaCodes).toEqual([]);
  });

  it('never echoes speaker prefixes or greeting small talk into clinical fields', () => {
    const template = getTemplateById('hygiene');
    const draft = generateOfflineDraft(template, [
      { sender: 'Dentist', text: 'Alright Mrs Smith, the hygienist said you have some build-up on the lower front teeth and bleeding when brushing.' },
      { sender: 'Patient', text: 'Yes, I have been skipping flossing to be honest.' },
      { sender: 'Dentist', text: 'I can see moderate calculus on teeth 32 to 42, and the gingiva looks inflamed. We will do a scale and clean today. Item 114 for the scale and clean.' }
    ], 'Scale & Clean');

    const chiefComplaint = draft.canonical.chiefComplaint ?? '';
    const findingsGingival = draft.canonical.findingsGingival ?? '';
    // No "Dentist:" / "Patient:" labels ever leak into the note.
    expect(chiefComplaint).not.toContain('Dentist:');
    expect(findingsGingival).not.toContain('Dentist:');
    // The "Alright Mrs Smith" opener is small talk, not a complaint.
    expect(chiefComplaint.startsWith('Alright')).toBe(false);
    // The clinical substance still survives, prefix-free.
    expect(chiefComplaint.toLowerCase()).toContain('bleeding');
    expect(findingsGingival.toLowerCase()).toContain('calculus');
  });

  it('assigns template-specific keys to customSections and canonical keys to top level', () => {
    const template = getTemplateById('endo');
    const draft = generateOfflineDraft(template, [
      { sender: 'Dentist', text: 'The radiograph shows a periapical radiolucency at the apex of tooth 26.' }
    ], 'Endodontic (Root Canal)');
    expect(draft.canonical.toothFindings ?? '').toContain('26');
    expect(draft.customSections.periapicalAssessment ?? '').toContain('radiograph');
    expect(draft.customSections.periapicalAssessment?.toLowerCase() ?? '').toContain('periapical');
  });

  it('collapses progressive repeating prefix stutter and eliminates "Dialogue:" speaker tags', () => {
    const template = getTemplateById('emergency');
    const garbledTranscript: TranscriptItem[] = [
      { sender: 'Dialogue', text: "That's right what i will need to do is first we need to know these medications if it is safe to do a dental treatment that you are taking these medications because" },
      { sender: 'Dialogue', text: "that's right what i will need to do is first we need to know these medications if it is safe to do a dental treatment that you are taking these medications because the" },
      { sender: 'Dialogue', text: "that's right what i will need to do is first we need to know these medications if it is safe to do a dental treatment that you are taking these medications because the blood thinner" },
      { sender: 'Dialogue', text: "that's right what i will need to do is first we need to know these medications if it is safe to do a dental treatment that you are taking these medications because the blood thinner that" },
      { sender: 'Dialogue', text: "that's right what i will need to do is first we need to know these medications if it is safe to do a dental treatment that you are taking these medications because the blood thinner that you are taking it can actually affect the bleeding Because." },
      { sender: 'Dialogue', text: "i just" },
      { sender: 'Dialogue', text: "i just got from your" },
      { sender: 'Dialogue', text: "i just got from your medical history" },
      { sender: 'Dialogue', text: "i just got from your medical history that you are taking actually a lot of medications" },
      { sender: 'Dialogue', text: "Yeah. I just got from your medical history that you are taking actually a lot of medications. in some form" },
      { sender: 'Dialogue', text: "and we are we are" },
      { sender: 'Dialogue', text: "and we are we are actually" },
      { sender: 'Dialogue', text: "and we are we are actually in in our little head some of the medications can affect our other medication" },
      { sender: 'Dialogue', text: "i understand OK what what i would need to do we need just to go with you through the options and it's one of them actually is to take the tooth out" },
      { sender: 'Dialogue', text: "opening a pathway for the infection outside the tooth, so this will help" }
    ];

    const draft = generateOfflineDraft(template, garbledTranscript, 'Emergency');

    // 1. Absolutely NO "Dialogue:" speaker tags anywhere in any canonical or custom field
    for (const [key, val] of Object.entries(draft.canonical)) {
      expect(val).not.toMatch(/dialogue\s*:/i);
      expect(val).not.toMatch(/dentist\s*:/i);
      expect(val).not.toMatch(/patient\s*:/i);
    }
    for (const [key, val] of Object.entries(draft.customSections)) {
      expect(val).not.toMatch(/dialogue\s*:/i);
    }

    // 2. Progressive prefix stutter is collapsed
    const history = draft.canonical.history ?? '';
    expect(history.toLowerCase()).toContain('blood thinner');
    const repeatCount = (history.match(/that's right what i will need to do/gi) || []).length;
    expect(repeatCount).toBeLessThanOrEqual(1);

    // 3. Treatment performed captures extraction option cleanly without Dialogue tag
    const treatment = draft.canonical.treatmentPerformed ?? '';
    expect(treatment.toLowerCase()).toContain('take the tooth out');
    expect(treatment).not.toMatch(/dialogue\s*:/i);
  });
});
