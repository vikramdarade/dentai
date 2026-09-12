import { describe, it, expect } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const { app, generateToken } = await import('../server.ts');
import { normalizeSpokenDentalText } from '../src/lib/dentalPhoneticLexicon';
import { generateOfflineDraft, evaluateAudioFallbackNeed } from '../src/lib/draftEngine';
import { getTemplateById } from '../src/lib/dentalLibrary';
import { TranscriptItem } from '../src/types';

describe('TDD: Dual-Stream Universal Dental Transcription & Note Pipeline', () => {
  const authToken = generateToken({
    dentistId: 'ea8e5a3a-d788-45d9-b44b-63faa8db43b3',
    name: 'Dr. Vik',
    specialty: 'Dentist'
  });

  describe('1. Universal Dental Lexicon & ADA Code Extraction', () => {
    it('normalizes ADA codes spoken with "ADA", "code", or "item" prefixes', () => {
      const input = 'We are prescribing an occlusal splint, ADA 965, and root canal therapy code 414';
      const normalized = normalizeSpokenDentalText(input);
      expect(normalized).toContain('965');
      expect(normalized).toContain('414');
    });

    it('normalizes diverse dental specialty terms across all 8 disciplines', () => {
      // Bruxism & TMD
      expect(normalizeSpokenDentalText('Patient has severe brooks ism with wear face its and tender mass setter'))
        .toContain('bruxism');
      expect(normalizeSpokenDentalText('Taking scan for michigan splint for nocturnal grinding'))
        .toContain('occlusal splint');

      // Endodontics
      expect(normalizeSpokenDentalText('Diagnosis is pulp it is on tooth 16, placed leader mix'))
        .toContain('pulpitis');
      expect(normalizeSpokenDentalText('Diagnosis is pulp it is on tooth 16, placed leader mix'))
        .toContain('Ledermix');

      // Restorative
      expect(normalizeSpokenDentalText('Caries on tooth dirty tree requiring feeling'))
        .toContain('tooth 33');
      expect(normalizeSpokenDentalText('Caries on tooth dirty tree requiring feeling'))
        .toContain('restoration');

      // Periodontics
      expect(normalizeSpokenDentalText('Pocket depths tree two tree with bleeding on probe in'))
        .toContain('3-2-3 mm');
      expect(normalizeSpokenDentalText('Pocket depths tree two tree with bleeding on probe in'))
        .toContain('bleeding on probing');

      // Surgery
      expect(normalizeSpokenDentalText('Surgical extraction of tooth four eight with straight elevator and sutures'))
        .toContain('tooth 48');
    });

    it('extracts ADA codes from "ADA 965", "item 965", "code 965"', () => {
      const template = getTemplateById('standard');
      const transcriptWithAda: TranscriptItem[] = [
        { sender: 'Patient', text: 'My jaw aches every morning and I am grinding.' },
        { sender: 'Dentist', text: 'Diagnosis is bruxism. We will provide an occlusal splint under ADA 965.' }
      ];

      const draft = generateOfflineDraft(template, transcriptWithAda, 'Comprehensive');
      const codeNumbers = draft.adaCodes.map(c => c.code);
      expect(codeNumbers).toContain('965');
    });
  });

  describe('2. Universal Clinical Accuracy Across Appointment Types (Zero Generic Notes)', () => {
    it('produces specialized bruxism findings and NEVER generic checkup placeholders', () => {
      const template = getTemplateById('standard');
      const transcript: TranscriptItem[] = [
        { sender: 'Patient', text: 'I wake up with severe tension headaches and my partner hears me grinding.' },
        { sender: 'Dentist', text: 'Wear facets with dentin exposure on 13 to 23. Masseters tender to palpation. Sleep bruxism diagnosed. Occlusal splint ADA 965 recommended.' }
      ];

      const draft = generateOfflineDraft(template, transcript, 'Comprehensive');
      expect(draft.canonical.chiefComplaint.toLowerCase()).toContain('grinding');
      expect(draft.canonical.toothFindings.toLowerCase()).toContain('wear facets');
      expect(draft.canonical.diagnosis.toLowerCase()).toContain('bruxism');
      expect(draft.canonical.recommendations.toLowerCase()).toContain('splint');
      expect(draft.canonical.chiefComplaint).not.toContain('Consultation recorded for');
      expect(draft.canonical.toothFindings).not.toContain('Full clinical examination performed');
    });

    it('produces specialized endodontic findings and NEVER generic checkup placeholders', () => {
      const template = getTemplateById('endo');
      const transcript: TranscriptItem[] = [
        { sender: 'Patient', text: 'Throbbing ache in upper left molar for three days, sensitive to heat.' },
        { sender: 'Dentist', text: 'Tooth 26 is TTP positive, lingering cold sensitivity. Irreversible pulpitis. Starting emergency pulpotomy item 414 today.' }
      ];

      const draft = generateOfflineDraft(template, transcript, 'Endodontic');
      expect(draft.canonical.chiefComplaint.toLowerCase()).toContain('throbbing');
      expect(draft.canonical.toothFindings).toContain('26');
      expect(draft.canonical.diagnosis.toLowerCase()).toContain('pulpitis');
      expect(draft.canonical.treatmentPerformed.toLowerCase()).toContain('pulpotomy');
    });

    it('produces specialized surgical extraction findings and NEVER generic checkup placeholders', () => {
      const template = getTemplateById('surgical');
      const transcript: TranscriptItem[] = [
        { sender: 'Patient', text: 'My lower right wisdom tooth has been painful and swollen.' },
        { sender: 'Dentist', text: 'Tooth 48 is partially impacted with pericoronitis. Surgical extraction performed under local anaesthesia with sectioning and 3-0 vicryl sutures. Item 311.' }
      ];

      const draft = generateOfflineDraft(template, transcript, 'Surgical');
      expect(draft.canonical.chiefComplaint.toLowerCase()).toContain('wisdom tooth');
      expect(draft.canonical.diagnosis.toLowerCase()).toContain('pericoronitis');
      expect(draft.canonical.treatmentPerformed.toLowerCase()).toContain('extraction');
      expect(draft.canonical.treatmentPerformed.toLowerCase()).toContain('sutures');
    });

    it('synthesizes comprehensive TMD findings across all sections (Subjective, Exam, Diagnosis, Treatment & Advice)', () => {
      const template = getTemplateById('standard');
      const tmdTranscript: TranscriptItem[] = [
        {
          sender: 'Patient',
          text: 'Patient presents with persistent facial pain and TMJ discomfort near the ear and eye region on one side, accompanied by a popping sound. Onset was 3 months ago while eating hard crusty bread, presenting as an initial sharp pain with a loud pop followed by constant, aggravated soreness. Patient reports mild temporary relief using warm compresses and heat packs.'
        },
        {
          sender: 'Dentist',
          text: 'Examination of TMJ: palpation of right lateral pole tender, joint clicking on opening at 28 mm, maximum opening restricted to 36 mm with deviation to the right. Palpation of masseter and temporalis reveals moderate hypertonicity and tenderness.'
        },
        {
          sender: 'Dentist',
          text: 'Diagnosis: Temporomandibular disorder with anterior disc displacement with reduction and secondary masseter myofascial pain.'
        },
        {
          sender: 'Dentist',
          text: 'Treatment plan discussed: institute conservative jaw rest protocol. Patient instructed on soft food diet—strictly avoiding crusty bread, tough meats, and chewing gum. Apply moist warm heat compresses to the joint and temple 15 minutes twice daily. Prescribing trial of ibuprofen 400 mg with food. Recommending a hard acrylic stabilization occlusal splint under ADA item 965.'
        }
      ];

      const draft = generateOfflineDraft(template, tmdTranscript, 'Comprehensive');
      
      // 1. Subjective History & Complaint
      expect(draft.canonical.chiefComplaint.toLowerCase()).toMatch(/tmj|facial pain|popping|crusty bread/);
      
      // 2. Objective Examination & Findings
      const findingsText = (draft.canonical.toothFindings + ' ' + draft.canonical.findingsGingival).toLowerCase();
      expect(findingsText).toMatch(/palpation|click|masseter|temporalis|mm/);
      
      // 3. Assessment & Diagnosis
      expect(draft.canonical.diagnosis.toLowerCase()).toMatch(/temporomandibular|tmd|disc displacement|myofascial/);
      
      // 4. Treatment & Home Care Advice
      const planText = (draft.canonical.treatmentPerformed + ' ' + draft.canonical.recommendations).toLowerCase();
      expect(planText).toMatch(/soft diet|warm compress|heat|splint|ibuprofen/);
      
      // 5. ADA Item Code
      const codes = draft.adaCodes.map(c => c.code);
      expect(codes).toContain('965');
    });
  });

  describe('3. Audio Fallback Evaluation for Long & Dropped Sessions', () => {
    it('triggers fallback when a long 18-minute session only has 56 words (3.1 wpm speech loss)', () => {
      const evaluation = evaluateAudioFallbackNeed({
        hasAudioChunks: true,
        wordCount: 56,
        durationSeconds: 1080, // 18 minutes
        transcriptText: 'Patient presents with persistent facial pain and TMJ discomfort near the ear and eye region on one side, accompanied by a popping sound. Onset was 3 months ago while eating hard crusty bread, presenting as an initial sharp pain with a loud pop followed by constant, aggravated soreness. Patient reports mild temporary relief using warm compresses/heat..'
      });

      expect(evaluation.shouldFallback).toBe(true);
      expect(evaluation.reason.toLowerCase()).toContain('low speech density');
    });

    it('triggers fallback when an extended session is missing clinical examination or treatment milestones', () => {
      const evaluation = evaluateAudioFallbackNeed({
        hasAudioChunks: true,
        wordCount: 150,
        durationSeconds: 300, // 5 minutes
        transcriptText: 'Patient arrived today talking about weekend plans and mild toothache on upper right. We discussed previous dental history in another clinic.'
      });

      expect(evaluation.shouldFallback).toBe(true);
      expect(evaluation.reason.toLowerCase()).toContain('missing clinical examination or treatment milestones');
    });

    it('does not trigger fallback when speech recognition was dense and complete', () => {
      const evaluation = evaluateAudioFallbackNeed({
        hasAudioChunks: true,
        wordCount: 450,
        durationSeconds: 240, // 4 minutes
        transcriptText: 'Patient presents with toothache. Examination shows tooth 16 TTP positive, fracture on distal margin. Diagnosis irreversible pulpitis. Extirpation performed under local anaesthetic, placed Ledermix, booked review item 414.'
      });

      expect(evaluation.shouldFallback).toBe(false);
    });

    it('returns shouldFallback: false if no audio chunks exist', () => {
      const evaluation = evaluateAudioFallbackNeed({
        hasAudioChunks: false,
        wordCount: 10,
        durationSeconds: 60,
        transcriptText: 'Short'
      });

      expect(evaluation.shouldFallback).toBe(false);
    });
  });

  describe('4. /api/transcribe-audio Endpoint Resilience & Key Failover', () => {
    it('returns 400 when audioBase64 is missing or empty', async () => {
      const res = await request(app)
        .post('/api/transcribe-audio')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('audioBase64');
    });

    it('attempts transcription and returns structured transcript items or robust fallback without crashing', async () => {
      const dummyAudio = Buffer.from('GkXfo59ChoEBQveBAULygQ8tAQE3BDGJgbUswSdgAQEbBgE=').toString('base64');
      const res = await request(app)
        .post('/api/transcribe-audio')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          audioBase64: dummyAudio,
          mimeType: 'audio/webm'
        });

      if (res.status === 200) {
        expect(res.body).toHaveProperty('items');
        expect(Array.isArray(res.body.items)).toBe(true);
      } else {
        expect([429, 503]).toContain(res.status);
        expect(res.body.error).toBeDefined();
      }
    });
  });
});

