import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const { app, invalidateDbCache } = await import('../server.ts');

import {
  DayScheduleItem,
  addScheduleItem,
  loadTodaySchedule,
  updateScheduleItem,
  deleteScheduleItem,
  clearTodaySchedule,
  formatNoteForPmsClipboard,
  getTodayDateStr,
  normalizeStartTime,
  normalizePatientName,
  generateSlotFingerprint,
  mergeScheduleItems,
  calculateDailyProduction
} from '../src/lib/dayScheduleStorage';
import { verifyTranscriptGrounding, extractToothNumbers } from '../src/lib/transcriptGrounding';
import { generateOfflineDraft } from '../src/lib/draftEngine';
import { getTemplateById } from '../src/lib/dentalLibrary';
import { isPmsPreviewEnabled } from '../src/utils/previewMode';

const dataDir = path.resolve(__dirname, '..', 'data');
const usersPath = path.join(dataDir, 'users.json');
const clinicsPath = path.join(dataDir, 'clinics.json');
const auditPath = path.join(dataDir, 'audit.json');
const noteJobsPath = path.join(dataDir, 'note_jobs.json');

let usersBackup: string | null = null;
let clinicsBackup: string | null = null;
let auditBackup: string | null = null;
let noteJobsBackup: string | null = null;

beforeAll(() => {
  if (fs.existsSync(usersPath)) usersBackup = fs.readFileSync(usersPath, 'utf-8');
  if (fs.existsSync(clinicsPath)) clinicsBackup = fs.readFileSync(clinicsPath, 'utf-8');
  if (fs.existsSync(auditPath)) auditBackup = fs.readFileSync(auditPath, 'utf-8');
  if (fs.existsSync(noteJobsPath)) noteJobsBackup = fs.readFileSync(noteJobsPath, 'utf-8');
});

afterAll(() => {
  if (usersBackup !== null) fs.writeFileSync(usersPath, usersBackup);
  if (clinicsBackup !== null) fs.writeFileSync(clinicsPath, clinicsBackup);
  if (auditBackup !== null) fs.writeFileSync(auditPath, auditBackup);
  if (noteJobsBackup !== null) {
    fs.writeFileSync(noteJobsPath, noteJobsBackup);
  } else if (fs.existsSync(noteJobsPath)) {
    try { fs.unlinkSync(noteJobsPath); } catch {}
  }
  if (typeof invalidateDbCache === 'function') {
    invalidateDbCache();
  }
});

describe('Day Schedule Queue Storage & Helpers', () => {
  const testDate = '2026-09-11';

  beforeEach(() => {
    clearTodaySchedule(testDate);
  });

  it('adds and loads scheduled appointments in chronological order', () => {
    addScheduleItem({
      time: '10:00',
      patientName: 'Emma Watson',
      procedureText: 'Scale & Clean',
      appointmentType: 'scale_clean',
      templateId: 'concise',
      source: 'snip'
    }, testDate);

    addScheduleItem({
      time: '08:30',
      patientName: 'Sarah Connor',
      procedureText: 'Comprehensive Examination',
      appointmentType: 'examination',
      templateId: 'standard',
      source: 'snip'
    }, testDate);

    const items = loadTodaySchedule(testDate);
    expect(items.length).toBe(2);
    // Chronologically sorted by time
    expect(items[0].patientName).toBe('Sarah Connor');
    expect(items[0].time).toBe('08:30');
    expect(items[0].status).toBe('scheduled');
    expect(items[1].patientName).toBe('Emma Watson');
    expect(items[1].time).toBe('10:00');
  });

  it('updates appointment status as the clinical workflow progresses', () => {
    const item = addScheduleItem({
      time: '09:15',
      patientName: 'David Miller',
      procedureText: 'Tooth #16 Crown Prep',
      appointmentType: 'prosthodontic',
      templateId: 'standard'
    }, testDate);

    // Transition to recording
    let updated = updateScheduleItem(item.id, { status: 'recording' }, testDate);
    expect(updated.find(i => i.id === item.id)?.status).toBe('recording');

    // Transition to background synthesis
    updated = updateScheduleItem(item.id, {
      status: 'processing',
      jobId: 'job_123',
      consultationId: 'consult_456'
    }, testDate);
    const processingItem = updated.find(i => i.id === item.id);
    expect(processingItem?.status).toBe('processing');
    expect(processingItem?.jobId).toBe('job_123');

    // Transition to ready for PMS paste
    updated = updateScheduleItem(item.id, {
      status: 'ready',
      clinicalNote: 'Tooth #16 Crown Prep Completed.',
      adaCodes: ['611']
    }, testDate);
    const readyItem = updated.find(i => i.id === item.id);
    expect(readyItem?.status).toBe('ready');
    expect(readyItem?.clinicalNote).toContain('Tooth #16 Crown Prep');
    expect(readyItem?.adaCodes).toEqual(['611']);
  });

  it('deletes an appointment from the queue', () => {
    const item = addScheduleItem({
      time: '14:00',
      patientName: 'Cancelled Patient',
      procedureText: 'Exam',
      appointmentType: 'examination',
      templateId: 'standard'
    }, testDate);

    expect(loadTodaySchedule(testDate).length).toBe(1);
    deleteScheduleItem(item.id, testDate);
    expect(loadTodaySchedule(testDate).length).toBe(0);
  });

  it('formats clinical notes cleanly for Australian PMS clipboard (D4W & Praktika)', () => {
    const item: DayScheduleItem = {
      id: 'test_1',
      time: '09:00',
      patientName: 'John Smith',
      procedureText: 'Tooth #16 Restoration',
      appointmentType: 'restorative',
      templateId: 'standard',
      status: 'ready'
    };

    const mockConsultation = {
      firstName: 'John',
      lastName: 'Smith',
      date: '2026-09-11',
      appointmentType: 'restorative',
      findings: {
        chiefComplaint: 'Cold sensitivity upper right molar',
        clinicalFindings: '#16 MO deep carious lesion into dentin',
        treatmentRendered: 'Local anaesthesia 2.2mL Scandonest 2%. Rubber dam placed. Caries excavated. 2-surface composite resin placed.',
        localAnaesthetic: '1x 2.2mL Scandonest 2% with 1:100k adrenaline',
        postOpAdvice: 'Avoid chewing hard foods until numbness subsides',
        nextVisit: '6 months routine recall'
      },
      adaCodes: ['532', '022']
    };

    const formatted = formatNoteForPmsClipboard(item, mockConsultation);
    expect(formatted).toContain('=== DENTAI AMBIENT CLINICAL NOTE ===');
    expect(formatted).toContain('Patient: John Smith');
    expect(formatted).toContain('CHIEF COMPLAINT:');
    expect(formatted).toContain('Cold sensitivity upper right molar');
    expect(formatted).toContain('TREATMENT PERFORMED:');
    expect(formatted).toContain('ADA ITEM CODES:\n532, 022');
  });

  it('normalizes times and patient names across differing PMS crop formats', () => {
    expect(normalizeStartTime('09:15 - 10:00')).toBe('09:15');
    expect(normalizeStartTime('9:15 am')).toBe('09:15');
    expect(normalizeStartTime('2:30 pm')).toBe('14:30');

    expect(normalizePatientName('Smith, John')).toBe('johnsmith');
    expect(normalizePatientName('SMITH, JONATH...')).toBe('jonathsmith');
    expect(normalizePatientName("David O'Connor")).toBe('davidoconnor');

    const fp1 = generateSlotFingerprint('2026-09-12', '09:15 - 10:00', 'Smith, John');
    const fp2 = generateSlotFingerprint('2026-09-12', '9:15 am', 'John Smith');
    expect(fp1).toBe(fp2);
  });

  it('3-way merges midday PMS snips with zero duplicate cards and protects completed consults', () => {
    const existingRoster: DayScheduleItem[] = [
      {
        id: 'item_1',
        time: '08:30',
        patientName: 'Sarah Connor',
        procedureText: 'Check & Clean',
        appointmentType: 'examination',
        templateId: 'standard',
        status: 'ready', // Completed & immutable!
        clinicalNote: 'Patient examined and teeth charted.'
      },
      {
        id: 'item_2',
        time: '09:15',
        patientName: 'David Miller',
        procedureText: 'Crown Prep',
        appointmentType: 'prosthodontic',
        templateId: 'standard',
        status: 'scheduled'
      }
    ];

    // Midday snip: contains Sarah Connor again (overlapping crop), David Miller with updated notes, and a new walk-in!
    const incomingSnip: DayScheduleItem[] = [
      {
        id: 'incoming_1',
        time: '08:30',
        patientName: 'Sarah Connor',
        procedureText: 'Check & Clean',
        appointmentType: 'examination',
        templateId: 'standard',
        status: 'scheduled'
      },
      {
        id: 'incoming_2',
        time: '09:15',
        patientName: 'David Miller',
        procedureText: 'Tooth #16 Ceramic Crown Prep (611)', // Updated procedure details!
        appointmentType: 'prosthodontic',
        templateId: 'standard',
        status: 'scheduled'
      },
      {
        id: 'incoming_3',
        time: '10:30',
        patientName: 'Liam O\'Connor',
        procedureText: 'Emergency Toothache',
        appointmentType: 'emergency',
        templateId: 'soap',
        status: 'scheduled'
      },
      // Internal duplicate row in the same snip
      {
        id: 'incoming_3_dup',
        time: '10:30',
        patientName: 'Liam O\'Connor',
        procedureText: 'Emergency Toothache',
        appointmentType: 'emergency',
        templateId: 'soap',
        status: 'scheduled'
      }
    ];

    const merged = mergeScheduleItems(existingRoster, incomingSnip, '2026-09-12');

    // Exactly 3 unique appointments (zero duplicates!)
    expect(merged.length).toBe(3);

    // Rule 1: Sarah Connor was 'ready' -> remains 'ready' and kept original clinicalNote!
    const sarah = merged.find(i => i.patientName === 'Sarah Connor');
    expect(sarah?.status).toBe('ready');
    expect(sarah?.clinicalNote).toBe('Patient examined and teeth charted.');
    expect(sarah?.id).toBe('item_1');

    // Rule 2: David Miller was 'scheduled' -> updated with richer procedure notes!
    const david = merged.find(i => i.patientName === 'David Miller');
    expect(david?.procedureText).toContain('Ceramic Crown Prep');

    // Rule 3: Liam O'Connor is inserted once, sorted chronologically
    const liam = merged.find(i => i.patientName.includes('Connor') && i.time === '10:30');
    expect(liam).toBeDefined();
    expect(merged[2].patientName).toContain('Connor');
  });

  it('preserves double-booked patients at the same start time', () => {
    const incomingDoubleBooked: DayScheduleItem[] = [
      {
        id: 'd1',
        time: '10:00',
        patientName: 'Alice Springs',
        procedureText: 'Scale & Clean',
        appointmentType: 'scale_clean',
        templateId: 'concise',
        status: 'scheduled'
      },
      {
        id: 'd2',
        time: '10:00',
        patientName: 'Bob Dylan',
        procedureText: 'Emergency',
        appointmentType: 'emergency',
        templateId: 'soap',
        status: 'scheduled'
      }
    ];

    const merged = mergeScheduleItems([], incomingDoubleBooked, '2026-09-12');
    expect(merged.length).toBe(2);
    expect(merged[0].patientName).toBe('Alice Springs');
    expect(merged[1].patientName).toBe('Bob Dylan');
  });

  it('calculates daily ADA production value accurately', () => {
    const completedItems: DayScheduleItem[] = [
      {
        id: '1',
        time: '08:30',
        patientName: 'Patient A',
        procedureText: 'Crown Prep',
        appointmentType: 'prosthodontic',
        templateId: 'standard',
        status: 'ready',
        adaCodes: ['611'] // $1750
      },
      {
        id: '2',
        time: '09:30',
        patientName: 'Patient B',
        procedureText: 'Scale & Clean',
        appointmentType: 'scale_clean',
        templateId: 'concise',
        status: 'ready',
        adaCodes: ['114', '121'] // $165 + $45 = $210
      },
      {
        id: '3',
        time: '10:30',
        patientName: 'Patient C',
        procedureText: 'Filling',
        appointmentType: 'restorative',
        templateId: 'standard',
        status: 'scheduled' // Not completed -> $0
      }
    ];

    const total = calculateDailyProduction(completedItems);
    expect(total).toBe(1750 + 165 + 45); // $1,960
  });

  it('safely handles raw object adaCodes from AI note jobs without crashing (TypeError protection)', () => {
    const aiJobItems: any[] = [
      {
        id: 'job_item_1',
        time: '11:00',
        patientName: 'David Miller',
        procedureText: 'Crown Prep',
        appointmentType: 'prosthodontic',
        status: 'ready',
        // Raw object format returned by AI synthesis before string normalization
        adaCodes: [
          { code: '611', description: 'Full crown - ceramic' },
          { code: '022', description: 'Intraoral periapical radiograph' }
        ]
      }
    ];

    // Must never throw "code.replace is not a function"
    expect(() => calculateDailyProduction(aiJobItems)).not.toThrow();
    const production = calculateDailyProduction(aiJobItems);
    expect(production).toBe(1750 + 50); // $1,800
  });

  it('formats ADA codes from object format cleanly without [object Object]', () => {
    const item: DayScheduleItem = {
      id: 'test_obj',
      time: '09:00',
      patientName: 'Jane Doe',
      procedureText: 'Filling #16',
      appointmentType: 'restorative',
      templateId: 'standard',
      status: 'ready'
    };

    const consultWithObjectCodes = {
      firstName: 'Jane',
      lastName: 'Doe',
      date: '2026-09-12',
      appointmentType: 'restorative',
      findings: {
        treatmentRendered: 'Composite resin placed.'
      },
      adaCodes: [
        { code: '532', description: '2-surface composite resin', tooth: '16' }
      ]
    };

    const formatted = formatNoteForPmsClipboard(item, consultWithObjectCodes);
    expect(formatted).not.toContain('[object Object]');
    expect(formatted).toContain('532 (2-surface composite resin) [Tooth #16]');
  });
});

describe('Preview Mode Gate', () => {
  it('enables preview when on localhost', () => {
    expect(isPmsPreviewEnabled()).toBe(true);
  });
});

describe('PMS Schedule Vision API (/api/schedule/parse-image)', () => {
  let authToken = '';

  beforeAll(async () => {
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Dr. Vision Tester', specialty: 'General Dentistry', pin: '5555' });
    if (regRes.status === 201) {
      authToken = regRes.body.token;
    } else {
      const profilesRes = await request(app).get('/api/auth/profiles');
      const tester = profilesRes.body.find((p: any) => p.name === 'Dr. Vision Tester');
      if (tester) {
        const loginRes = await request(app)
          .post('/api/auth/login')
          .send({ dentistId: tester.id, pin: '5555' });
        authToken = loginRes.body.token;
      }
    }
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app)
      .post('/api/schedule/parse-image')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('token');
  });

  it('rejects requests missing imageBase64 with 400 when authenticated', async () => {
    const res = await request(app)
      .post('/api/schedule/parse-image')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('imageBase64');
  });

  it('returns structured appointment cards from base64 image input when authenticated', async () => {
    // 1x1 transparent PNG base64
    const samplePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const res = await request(app)
      .post('/api/schedule/parse-image')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        imageBase64: samplePng,
        mimeType: 'image/png',
        providerName: 'Dr. Sarah Chen'
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('appointments');
    expect(Array.isArray(res.body.appointments)).toBe(true);
    expect(res.body.appointments.length).toBeGreaterThan(0);

    const first = res.body.appointments[0];
    expect(first).toHaveProperty('time');
    expect(first).toHaveProperty('patientName');
    expect(first).toHaveProperty('procedureText');
    expect(first).toHaveProperty('appointmentType');
    expect(first).toHaveProperty('templateId');
  });

  it('marks isSampleFallback: true and provides fallbackReason when server AI key quota is depleted', async () => {
    const samplePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const res = await request(app)
      .post('/api/schedule/parse-image')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        imageBase64: samplePng,
        mimeType: 'image/png'
      });

    expect(res.status).toBe(200);
    expect(res.body.isSampleFallback).toBe(true);
    expect(res.body.fallbackReason).toBeDefined();
    expect(typeof res.body.fallbackReason).toBe('string');
  }, 20000);

  it('accepts userApiKey in payload or header without throwing 500', async () => {
    const samplePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const res = await request(app)
      .post('/api/schedule/parse-image')
      .set('Authorization', `Bearer ${authToken}`)
      .set('x-gemini-api-key', 'dummy_key_for_test')
      .send({
        imageBase64: samplePng,
        mimeType: 'image/png',
        userApiKey: 'dummy_key_for_test'
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('appointments');
  }, 20000);
});

describe('Transcript Grounding & Zero-Hallucination Verification Engine', () => {
  it('extracts FDI two-digit tooth numbers from clinical dialogue and notes', () => {
    const text1 = 'Examined tooth 16 and tooth 24 for occlusal caries. #36 has existing amalgam.';
    const teeth1 = extractToothNumbers(text1);
    expect(teeth1).toContain('16');
    expect(teeth1).toContain('24');
    expect(teeth1).toContain('36');

    const text2 = 'Patient reported pain in upper right molar and lower left premolar.';
    const teeth2 = extractToothNumbers(text2);
    expect(teeth2).toContain('16');
    expect(teeth2).toContain('34');
  });

  it('produces 100% grounding report when note is fully grounded in verbatim dialogue', () => {
    const transcript = [
      { sender: 'Dentist', text: 'Good morning, today we are preparing tooth 16 for a ceramic crown.' },
      { sender: 'Patient', text: 'Yes, the upper right tooth has been cracked for two months.' },
      { sender: 'Dentist', text: 'Administered one cartridge of 4% Articaine with 1:100000 adrenaline via infiltration.' },
      { sender: 'Dentist', text: 'Composite core build-up completed and crown preparation refined.' }
    ];

    const note = `
      CHIEF COMPLAINT: Tooth 16 cracked tooth.
      TREATMENT: Tooth 16 crown preparation.
      LOCAL ANAESTHETIC: Articaine infiltration.
      MATERIALS: Composite core.
    `;

    const report = verifyTranscriptGrounding(note, transcript, ['611']);
    expect(report.isFullyGrounded).toBe(true);
    expect(report.groundingScore).toBe(100);
    expect(report.unverifiedClaims).toEqual([]);
    expect(report.groundedEntities).toContain('Tooth #16');
    expect(report.groundedEntities).toContain('Articaine');
  });

  it('flags ungrounded inferences when note contains teeth or drugs not spoken in audio', () => {
    const transcript = [
      { sender: 'Dentist', text: 'Examined tooth 24 for a simple composite filling.' },
      { sender: 'Patient', text: 'No pain at all.' }
    ];

    // Hallucinated note: mentions tooth 48 and Scandonest which were NEVER spoken
    const hallucinatedNote = `
      CHIEF COMPLAINT: Tooth 24 and tooth 48 restoration.
      LOCAL ANAESTHETIC: Scandonest 3% plain.
      TREATMENT: Composite filling tooth 24.
    `;

    const report = verifyTranscriptGrounding(hallucinatedNote, transcript);
    expect(report.isFullyGrounded).toBe(false);
    expect(report.groundingScore).toBeLessThan(100);
    expect(report.unverifiedClaims).toContain('Tooth #48');
    expect(report.unverifiedClaims).toContain('Scandonest');
    expect(report.summary).toContain('Attention');
  });
});

describe('Chairside Verbal Recording Consent Capture', () => {
  const testDate = '2026-09-12';

  beforeEach(() => {
    clearTodaySchedule(testDate);
  });

  it('captures and stamps verbal recording consent against appointment records', () => {
    const item = addScheduleItem({
      time: '09:00',
      patientName: 'David Miller',
      procedureText: 'Crown Prep #16',
      appointmentType: 'prosthodontic',
      templateId: 'standard'
    }, testDate);

    expect(item.consentObtained).toBeFalsy();

    // Toggle verbal consent
    const nowIso = new Date().toISOString();
    const updated = updateScheduleItem(item.id, {
      consentObtained: true,
      consentCapturedAt: nowIso,
      consentPractitionerId: 'Dr. Sarah Chen'
    }, testDate);

    const saved = updated.find(i => i.id === item.id);
    expect(saved?.consentObtained).toBe(true);
    expect(saved?.consentCapturedAt).toBe(nowIso);
    expect(saved?.consentPractitionerId).toBe('Dr. Sarah Chen');

    // Verify PMS clipboard note omits the internal consent tag to keep notes clinical
    const pmsNote = formatNoteForPmsClipboard(saved!);
    expect(pmsNote).not.toContain('Verbal Consent');
    expect(pmsNote).not.toContain('consentCapturedAt');
  });

  it('preserves consent across status transitions into recording and processing', () => {
    const item = addScheduleItem({
      time: '11:00',
      patientName: 'Emma Watson',
      procedureText: 'Adult Hygiene (114, 121)',
      appointmentType: 'scale_clean',
      templateId: 'concise',
      consentObtained: true,
      consentCapturedAt: '2026-09-12T10:55:00.000Z',
      consentPractitionerId: 'Dr. Sarah Chen'
    }, testDate);

    // Transition to recording
    let roster = updateScheduleItem(item.id, { status: 'recording' }, testDate);
    expect(roster.find(i => i.id === item.id)?.consentObtained).toBe(true);

    // Transition to processing with transcript
    const transcript = [
      { sender: 'Dentist', text: 'Full mouth ultrasonic scale completed.' }
    ];
    roster = updateScheduleItem(item.id, {
      status: 'processing',
      transcript,
      jobId: 'job_sample_123'
    }, testDate);

    const processing = roster.find(i => i.id === item.id);
    expect(processing?.consentObtained).toBe(true);
    expect(processing?.transcript?.length).toBe(1);
  });
});

describe('Async Note Jobs API with Verbal Consent Audit Logging', () => {
  let authToken = '';

  beforeAll(async () => {
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Dr. Consent Tester', specialty: 'General Dentistry', pin: '7777' });
    if (regRes.status === 201) {
      authToken = regRes.body.token;
    } else {
      const profilesRes = await request(app).get('/api/auth/profiles');
      const tester = profilesRes.body.find((p: any) => p.name === 'Dr. Consent Tester');
      if (tester) {
        const loginRes = await request(app)
          .post('/api/auth/login')
          .send({ dentistId: tester.id, pin: '7777' });
        authToken = loginRes.body.token;
      }
    }
  });

  it('accepts consentObtained in /api/notes/jobs payload and queues job successfully', async () => {
    const res = await request(app)
      .post('/api/notes/jobs')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        intakeData: {
          firstName: 'Consent',
          lastName: 'Patient',
          dob: '1985-05-15',
          appointmentType: 'examination',
          templateId: 'standard'
        },
        transcript: [
          { sender: 'Dentist', text: 'Periodic oral exam tooth 16 and tooth 26 sound.' }
        ],
        consentObtained: true,
        consentCapturedAt: new Date().toISOString(),
        consentPractitionerId: 'Dr. Consent Tester'
      });

    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('jobId');
    expect(res.body.status).toBe('queued');
  });

  it('preserves captured transcript on synthesis failure and allows 1-click offline recovery into ready note', () => {
    const testDate = '2026-09-12';
    clearTodaySchedule(testDate);

    // 1. Add appointment and simulate recording with real transcript
    const scheduled = addScheduleItem({
      time: '14:30',
      patientName: 'Robert Langdon',
      procedureText: 'Tooth #46 Occlusal Composite Restoration',
      appointmentType: 'restorative',
      templateId: 'standard',
      source: 'snip'
    }, testDate);

    const consultationTranscript = [
      { sender: 'Patient' as const, text: 'I felt a sharp edge on my lower right molar when eating crusty bread.' },
      { sender: 'Dentist' as const, text: 'Clinical exam shows defective restoration on tooth 46 occlusal. Cold test positive and normal. No lingering pain.' },
      { sender: 'Dentist' as const, text: 'Administered 2.2mL Scandonest 3% plain for infiltration. Cavity prepared, resin composite placed on 46 occlusal, polished, occlusion checked.' }
    ];

    // 2. Mark processing
    updateScheduleItem(scheduled.id, {
      status: 'processing',
      transcript: consultationTranscript
    }, testDate);

    // 3. Mark failed with transparent quota error
    const failedItem = updateScheduleItem(scheduled.id, {
      status: 'failed',
      error: 'Google Gemini API quota depleted (429). Retries exhausted.'
    }, testDate).find(i => i.id === scheduled.id);

    expect(failedItem).toBeDefined();
    expect(failedItem?.status).toBe('failed');
    expect(failedItem?.error).toContain('429');
    // Critical Invariant: Transcript must be completely preserved
    expect(failedItem?.transcript).toHaveLength(3);
    expect(failedItem?.transcript?.[0].text).toContain('lower right molar');

    // 4. Trigger deterministic offline recovery
    const template = getTemplateById(failedItem!.templateId || 'standard');
    const typedTranscript = failedItem!.transcript!.map(t => ({
      sender: t.sender as 'Dentist' | 'Patient' | 'Dialogue' | 'Clinical Comment',
      text: t.text
    }));
    const draft = generateOfflineDraft(template, typedTranscript, 'Restorative Consultation');

    const formatted = formatNoteForPmsClipboard({
      id: failedItem!.id,
      time: failedItem!.time,
      patientName: failedItem!.patientName,
      procedureText: failedItem!.procedureText,
      appointmentType: failedItem!.appointmentType,
      templateId: failedItem!.templateId,
      status: 'ready'
    }, {
      firstName: 'Robert',
      lastName: 'Langdon',
      date: testDate,
      appointmentType: failedItem!.appointmentType,
      findings: {
        chiefComplaint: draft.canonical.chiefComplaint || failedItem!.procedureText,
        clinicalFindings: draft.canonical.clinicalFindings || draft.canonical.toothFindings,
        treatmentRendered: draft.canonical.treatmentRendered || draft.canonical.treatmentPerformed || failedItem!.procedureText,
        localAnaesthetic: draft.canonical.localAnaesthetic || '',
        prescriptions: draft.canonical.prescriptions || '',
        postOpAdvice: draft.canonical.postOpAdvice || 'Maintain regular oral hygiene.',
        nextVisit: draft.canonical.nextVisit || '6 Months Recall'
      },
      adaCodes: draft.adaCodes
    });

    const grounding = verifyTranscriptGrounding(formatted, failedItem!.transcript!, draft.adaCodes);

    const recoveredItem = updateScheduleItem(failedItem!.id, {
      status: 'ready',
      clinicalNote: formatted,
      completedAt: new Date().toISOString(),
      groundingScore: grounding.groundingScore,
      isFullyGrounded: grounding.isFullyGrounded,
      error: undefined
    }, testDate).find(i => i.id === failedItem!.id);

    expect(recoveredItem?.status).toBe('ready');
    expect(recoveredItem?.error).toBeUndefined();
    expect(recoveredItem?.clinicalNote).toContain('Robert Langdon');
    expect(recoveredItem?.clinicalNote).toContain('EXAMINATION & FINDINGS:');
    expect(recoveredItem?.isFullyGrounded).toBe(true);
  });
});

