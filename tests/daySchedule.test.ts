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
  getDateStr,
  fetchScheduleFromCloud,
  syncScheduleToCloud,
  deleteScheduleFromCloud,
  cleanPatientDisplayName,
  normalizeStartTime,
  normalizePatientName,
  generateSlotFingerprint,
  mergeScheduleItems,
  calculateDailyProduction,
  generatePreOpBrief,
  detectTreatmentOpportunity,
  generateAftercareSnippet
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
const schedulesPath = path.join(dataDir, 'schedules.json');

let usersBackup: string | null = null;
let clinicsBackup: string | null = null;
let auditBackup: string | null = null;
let noteJobsBackup: string | null = null;
let schedulesBackup: string | null = null;

beforeAll(() => {
  if (fs.existsSync(usersPath)) usersBackup = fs.readFileSync(usersPath, 'utf-8');
  if (fs.existsSync(clinicsPath)) clinicsBackup = fs.readFileSync(clinicsPath, 'utf-8');
  if (fs.existsSync(auditPath)) auditBackup = fs.readFileSync(auditPath, 'utf-8');
  if (fs.existsSync(noteJobsPath)) noteJobsBackup = fs.readFileSync(noteJobsPath, 'utf-8');
  if (fs.existsSync(schedulesPath)) schedulesBackup = fs.readFileSync(schedulesPath, 'utf-8');
});

afterAll(() => {
  if (usersBackup !== null) fs.writeFileSync(usersPath, usersBackup);
  if (clinicsBackup !== null) fs.writeFileSync(clinicsPath, clinicsBackup);
  if (auditBackup !== null) fs.writeFileSync(auditPath, auditBackup);
  if (schedulesBackup !== null) fs.writeFileSync(schedulesPath, schedulesBackup);
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

  it('cleans messy PMS patient strings into natural Title Case display names', () => {
    // Australian PMS D4W phone & duration clutter
    expect(cleanPatientDisplayName('SMITH, Sarah (0412 345 678) [30m]')).toBe('Sarah Smith');
    expect(cleanPatientDisplayName('MILLER, DAVID (#9942) - Prep #16 Crown')).toBe('David Miller');
    expect(cleanPatientDisplayName("O'CONNOR, Liam [CDBS]")).toBe("Liam O'Connor");

    // Honorifics and title case
    expect(cleanPatientDisplayName('Dr. John Doe')).toBe('John Doe');
    expect(cleanPatientDisplayName('Mr. Robert Brown')).toBe('Robert Brown');
    expect(cleanPatientDisplayName('Mrs Jane Eyre')).toBe('Jane Eyre');
    expect(cleanPatientDisplayName('Miss Emily Blunt')).toBe('Emily Blunt');

    // Hyphenated surnames
    expect(cleanPatientDisplayName('SMITH-JONES, ANNA')).toBe('Anna Smith-Jones');

    // Truncated names with trailing dots
    expect(cleanPatientDisplayName('THOMPSON, ELIZAB...')).toBe('Elizab Thompson');

    // Walk-in and emergency administrative tags
    expect(cleanPatientDisplayName('Walk-in: Davis, Carl (#8819)')).toBe('Carl Davis');
    expect(cleanPatientDisplayName('Emergency: White, Walter')).toBe('Walter White');
  });

  it('normalizes clinical times across all PMS formats (dot, AM/PM, military, ranges)', () => {
    // Standard colon formats
    expect(normalizeStartTime('09:15')).toBe('09:15');
    expect(normalizeStartTime('9:15')).toBe('09:15');
    expect(normalizeStartTime('14:30')).toBe('14:30');

    // Dot notation (common in Australian PMS keyboards)
    expect(normalizeStartTime('09.15')).toBe('09:15');
    expect(normalizeStartTime('9.15')).toBe('09:15');
    expect(normalizeStartTime('14.30')).toBe('14:30');

    // 12-hour AM/PM with dot or colon
    expect(normalizeStartTime('9:15 am')).toBe('09:15');
    expect(normalizeStartTime('9.15am')).toBe('09:15');
    expect(normalizeStartTime('2:30 pm')).toBe('14:30');
    expect(normalizeStartTime('2.30pm')).toBe('14:30');
    expect(normalizeStartTime('9am')).toBe('09:00');
    expect(normalizeStartTime('2pm')).toBe('14:00');
    expect(normalizeStartTime('12:00 pm')).toBe('12:00');

    // 4-digit military time
    expect(normalizeStartTime('0900')).toBe('09:00');
    expect(normalizeStartTime('1430')).toBe('14:30');

    // Time ranges (extract start time)
    expect(normalizeStartTime('09:15 - 10:00')).toBe('09:15');
    expect(normalizeStartTime('9.00 - 9.45')).toBe('09:00');
    expect(normalizeStartTime('14.00-14.45')).toBe('14:00');
  });

  it('deduplicates across differing PMS crops with identical slot fingerprints', () => {
    expect(normalizePatientName('Smith, John')).toBe('johnsmith');
    expect(normalizePatientName('SMITH, JONATH...')).toBe('jonathsmith');
    expect(normalizePatientName("David O'Connor")).toBe('davidoconnor');
    expect(normalizePatientName('SMITH, John (0412 345 678) [30m]')).toBe('johnsmith');
    expect(normalizePatientName('Mr. John Smith')).toBe('johnsmith');

    // All these formats must resolve to the exact same composite fingerprint:
    const fp1 = generateSlotFingerprint('2026-09-12', '09:15 - 10:00', 'Smith, John');
    const fp2 = generateSlotFingerprint('2026-09-12', '9:15 am', 'John Smith');
    const fp3 = generateSlotFingerprint('2026-09-12', '9.15am', 'SMITH, John (0412 345 678) [30m]');
    const fp4 = generateSlotFingerprint('2026-09-12', '09:15', 'Mr. John Smith');

    expect(fp1).toBe(fp2);
    expect(fp2).toBe(fp3);
    expect(fp3).toBe(fp4);
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
  let savedApiKey: string | undefined;
  let savedFallbackKey: string | undefined;

  beforeAll(async () => {
    savedApiKey = process.env.GEMINI_API_KEY;
    savedFallbackKey = process.env.GEMINI_FALLBACK_API_KEY;
    process.env.GEMINI_API_KEY = '';
    process.env.GEMINI_FALLBACK_API_KEY = '';

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

  afterAll(() => {
    process.env.GEMINI_API_KEY = savedApiKey;
    process.env.GEMINI_FALLBACK_API_KEY = savedFallbackKey;
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

    if (res.body.appointments.length > 0) {
      const first = res.body.appointments[0];
      expect(first).toHaveProperty('time');
      expect(first).toHaveProperty('patientName');
      expect(first).toHaveProperty('procedureText');
      expect(first).toHaveProperty('appointmentType');
      expect(first).toHaveProperty('templateId');
    }
  }, 20000);

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

  describe('Autonomous Practice Cockpit Helpers', () => {
    it('generates accurate 1-line pre-op briefings per appointment type', () => {
      const restBrief = generatePreOpBrief('restorative', 'Filling tooth 16 MO');
      expect(restBrief).toContain('cavity surfaces');
      expect(restBrief).toContain('rubber dam');

      const crownBrief = generatePreOpBrief('prosthodontic', 'Prep #26 Ceramic Crown');
      expect(crownBrief).toContain('occlusal clearance');
      expect(crownBrief).toContain('shade');

      const surgBrief = generatePreOpBrief('surgical', 'Extract tooth 38');
      expect(surgBrief).toContain('anticoagulants');
      expect(surgBrief).toContain('consent');

      const emergBrief = generatePreOpBrief('emergency', 'Severe pain upper left');
      expect(emergBrief).toContain('percussion tenderness');
      expect(emergBrief).toContain('vitality');
    });

    it('detects high-value unbooked treatment opportunities from note findings', () => {
      // 1. Ceramic Crown opportunity
      const crownOpp = detectTreatmentOpportunity(
        { procedureText: 'Exam & Consult' },
        'Tooth 16 has a severe fracture line and needs a ceramic crown prep next visit.'
      );
      expect(crownOpp).toBeDefined();
      expect(crownOpp?.code).toBe('611');
      expect(crownOpp?.description).toContain('Crown');
      expect(crownOpp?.estimatedValueAud).toBe(1750);
      expect(crownOpp?.tooth).toBe('16');

      // 2. Dental Implant opportunity
      const implantOpp = detectTreatmentOpportunity(
        { procedureText: 'Surgical consult' },
        'Discussed missing tooth 21, consented for dental implant fixture placement next month.',
        ['688']
      );
      expect(implantOpp).toBeDefined();
      expect(implantOpp?.code).toBe('688');
      expect(implantOpp?.estimatedValueAud).toBe(4200);

      // 3. Root Canal opportunity
      const endoOpp = detectTreatmentOpportunity(
        { procedureText: 'Emergency' },
        'Pulp extirpation initiated on tooth 36, booked for complete root canal therapy.',
        ['414']
      );
      expect(endoOpp).toBeDefined();
      expect(endoOpp?.code).toBe('414');
      expect(endoOpp?.estimatedValueAud).toBe(1150);

      // 4. Regular cleaning (no high value opportunity)
      const noOpp = detectTreatmentOpportunity(
        { procedureText: 'Scale and clean' },
        'Routine calculus debridement completed. Healthy gums.'
      );
      expect(noOpp).toBeUndefined();
    });

    it('generates plain-English patient aftercare advice tailored for SMS', () => {
      const restSms = generateAftercareSnippet('restorative', 'Composite filling');
      expect(restSms).toContain('avoid hot drinks');
      expect(restSms).toContain('numbness');

      const surgSms = generateAftercareSnippet('surgical', 'Tooth extraction');
      expect(smsContainsWords(surgSms, ['gauze', 'smoking', '24 hours'])).toBe(true);

      const hygSms = generateAftercareSnippet('scale_clean', 'Routine prophylaxis');
      expect(hygSms).toContain('Nil by mouth for 30 minutes');
    });

    it('embeds the [FRONT DESK ACTION ITEM] block into the clipboard payload', () => {
      const testItem: DayScheduleItem = {
        id: 'sched_test_pms_action',
        time: '14:00',
        patientName: 'Rachel Green',
        procedureText: 'Tooth #16 Examination',
        appointmentType: 'examination',
        templateId: 'standard',
        status: 'ready',
        clinicalNote: 'Patient presented for examination of tooth 16. Incipient crack detected.',
        treatmentOpportunity: {
          code: '611',
          description: 'Full Ceramic / PFM Crown',
          estimatedValueAud: 1750,
          tooth: '16'
        },
        aftercareSummary: 'Please avoid chewing hard nuts or crusty bread on tooth 16 until crowned.'
      };

      const formatted = formatNoteForPmsClipboard(testItem);

      expect(formatted).toContain('Patient presented for examination of tooth 16');
      expect(formatted).toContain('[FRONT DESK ACTION ITEM]:');
      expect(formatted).toContain('UNBOOKED TREATMENT: Full Ceramic / PFM Crown (Tooth #16) — Est. $1750 AUD');
      expect(formatted).toContain('PATIENT AFTERCARE: Please avoid chewing hard nuts');
    });
  });

  describe('Multi-Device Cloud Schedule Synchronization API', () => {
    let cloudAuthToken: string;
    let neighborAuthToken: string;
    const syncTestDate = '2026-09-15';

    beforeAll(async () => {
      // 1. Register or login primary tester
      const reg1 = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Dr. Cloud Sync Tester', specialty: 'Prosthodontics', pin: '4321' });
      if (reg1.status === 201) {
        cloudAuthToken = reg1.body.token;
      } else {
        const pRes = await request(app).get('/api/auth/profiles');
        const p1 = pRes.body.find((p: any) => p.name === 'Dr. Cloud Sync Tester');
        if (p1) {
          const lRes = await request(app).post('/api/auth/login').send({ dentistId: p1.id, pin: '4321' });
          cloudAuthToken = lRes.body.token;
        }
      }

      // 2. Register or login neighbor tester for isolation check
      const reg2 = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Dr. Neighbor Clinician', specialty: 'Endodontics', pin: '8765' });
      if (reg2.status === 201) {
        neighborAuthToken = reg2.body.token;
      } else {
        const pRes = await request(app).get('/api/auth/profiles');
        const p2 = pRes.body.find((p: any) => p.name === 'Dr. Neighbor Clinician');
        if (p2) {
          const lRes = await request(app).post('/api/auth/login').send({ dentistId: p2.id, pin: '8765' });
          neighborAuthToken = lRes.body.token;
        }
      }
    });

    it('rejects unauthenticated GET /api/schedule with 401', async () => {
      const res = await request(app).get(`/api/schedule?date=${syncTestDate}`);
      expect(res.status).toBe(401);
      expect(res.body.error).toContain('token');
    });

    it('rejects unauthenticated PUT /api/schedule with 401', async () => {
      const res = await request(app)
        .put('/api/schedule')
        .send({ date: syncTestDate, items: [] });
      expect(res.status).toBe(401);
    });

    it('rejects PUT /api/schedule with non-array items with 400', async () => {
      const res = await request(app)
        .put('/api/schedule')
        .set('Authorization', `Bearer ${cloudAuthToken}`)
        .send({ date: syncTestDate, items: 'not an array' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('must be an array');
    });

    it('returns empty array when no schedule is yet stored for a date', async () => {
      const res = await request(app)
        .get(`/api/schedule?date=${syncTestDate}`)
        .set('Authorization', `Bearer ${cloudAuthToken}`);
      expect(res.status).toBe(200);
      expect(res.body.date).toBe(syncTestDate);
      expect(res.body.items).toEqual([]);
    });

    it('persists snipped appointment roster to cloud and returns updatedAt timestamp', async () => {
      const snippedRoster: DayScheduleItem[] = [
        {
          id: 'sched_cloud_1',
          time: '08:30',
          patientName: 'Sarah Connor',
          procedureText: 'Comprehensive Exam & Bitewings',
          appointmentType: 'examination',
          templateId: 'standard',
          status: 'scheduled',
          source: 'snip',
          preOpBrief: 'Check lower quadrant sensitivity.'
        },
        {
          id: 'sched_cloud_2',
          time: '09:15',
          patientName: 'David Miller',
          procedureText: 'Tooth #16 Ceramic Crown Prep',
          appointmentType: 'prosthodontic',
          templateId: 'standard',
          status: 'scheduled',
          source: 'snip',
          preOpBrief: 'Evaluate margin definition.'
        }
      ];

      const putRes = await request(app)
        .put('/api/schedule')
        .set('Authorization', `Bearer ${cloudAuthToken}`)
        .send({ date: syncTestDate, items: snippedRoster });

      expect(putRes.status).toBe(200);
      expect(putRes.body.success).toBe(true);
      expect(putRes.body.items.length).toBe(2);
      expect(putRes.body.updatedAt).toBeTruthy();

      // Verify retrieval on a second device / phone (simulated via GET)
      const getRes = await request(app)
        .get(`/api/schedule?date=${syncTestDate}`)
        .set('Authorization', `Bearer ${cloudAuthToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.date).toBe(syncTestDate);
      expect(getRes.body.items.length).toBe(2);
      expect(getRes.body.items[0].patientName).toBe('Sarah Connor');
      expect(getRes.body.items[1].patientName).toBe('David Miller');
    });

    it('enforces multi-tenant clinician isolation between dentists', async () => {
      // Dr. Neighbor Clinician checks the same date -> must see 0 items
      const neighborRes = await request(app)
        .get(`/api/schedule?date=${syncTestDate}`)
        .set('Authorization', `Bearer ${neighborAuthToken}`);

      expect(neighborRes.status).toBe(200);
      expect(neighborRes.body.items).toEqual([]);
    });

    it('deletes cloud schedule on demand', async () => {
      const delRes = await request(app)
        .delete(`/api/schedule?date=${syncTestDate}`)
        .set('Authorization', `Bearer ${cloudAuthToken}`);

      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);

      const verifyRes = await request(app)
        .get(`/api/schedule?date=${syncTestDate}`)
        .set('Authorization', `Bearer ${cloudAuthToken}`);

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.items).toEqual([]);
    });

    it('getDateStr accurately calculates offsets for yesterday, today, and tomorrow', () => {
      const todayStr = getTodayDateStr();
      expect(getDateStr(0)).toBe(todayStr);

      const dPlus1 = new Date();
      dPlus1.setDate(dPlus1.getDate() + 1);
      const expectedTomorrow = `${dPlus1.getFullYear()}-${String(dPlus1.getMonth() + 1).padStart(2, '0')}-${String(dPlus1.getDate()).padStart(2, '0')}`;
      expect(getDateStr(1)).toBe(expectedTomorrow);

      const dMinus1 = new Date();
      dMinus1.setDate(dMinus1.getDate() - 1);
      const expectedYesterday = `${dMinus1.getFullYear()}-${String(dMinus1.getMonth() + 1).padStart(2, '0')}-${String(dMinus1.getDate()).padStart(2, '0')}`;
      expect(getDateStr(-1)).toBe(expectedYesterday);
    });
  });
});

function smsContainsWords(text: string, words: string[]): boolean {
  const norm = text.toLowerCase();
  return words.every(w => norm.includes(w.toLowerCase()));
}

