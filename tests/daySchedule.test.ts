import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
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
  findScheduleItemBySlot,
  mergeScheduleItems,
  mintScheduleItemId,
  generateSafeUuid,
  calculateDailyProduction,
  parseTimeToMinutes
} from '../src/lib/dayScheduleStorage';
import { consentFromCapture } from '../src/lib/aiConsent';
import { verifyTranscriptGrounding, extractToothNumbers } from '../src/lib/transcriptGrounding';
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
    expect(items[0].status).toBe('ready');
    expect(items[1].patientName).toBe('Emma Watson');
    expect(items[1].time).toBe('10:00');
  });

  it('correctly parses 12-hour and 24-hour time strings to minutes from midnight', () => {
    expect(parseTimeToMinutes('08:30')).toBe(510);
    expect(parseTimeToMinutes('09:00')).toBe(540);
    expect(parseTimeToMinutes('9:30 AM')).toBe(570);
    expect(parseTimeToMinutes('11:45 am')).toBe(705);
    expect(parseTimeToMinutes('12:00 PM')).toBe(720);
    expect(parseTimeToMinutes('12:30 PM')).toBe(750);
    expect(parseTimeToMinutes('1:15 PM')).toBe(795);
    expect(parseTimeToMinutes('14:30')).toBe(870);
    expect(parseTimeToMinutes('5:00 pm')).toBe(1020);
    expect(parseTimeToMinutes('invalid')).toBe(9999);
    expect(parseTimeToMinutes('')).toBe(9999);
  });

  it('strictly sorts multiple appointments from earliest to latest regardless of entry order', () => {
    const appointments = [
      { time: '2:15 PM', patientName: 'Patient 4 (14:15)', procedureText: 'Exam', appointmentType: 'examination' as const, templateId: 'std' },
      { time: '08:30', patientName: 'Patient 1 (08:30)', procedureText: 'Exam', appointmentType: 'examination' as const, templateId: 'std' },
      { time: '11:00 AM', patientName: 'Patient 3 (11:00)', procedureText: 'Exam', appointmentType: 'examination' as const, templateId: 'std' },
      { time: '09:15', patientName: 'Patient 2 (09:15)', procedureText: 'Exam', appointmentType: 'examination' as const, templateId: 'std' },
      { time: '4:45 PM', patientName: 'Patient 5 (16:45)', procedureText: 'Exam', appointmentType: 'examination' as const, templateId: 'std' }
    ];

    for (const app of appointments) {
      addScheduleItem(app, testDate);
    }

    const items = loadTodaySchedule(testDate);
    expect(items.length).toBe(5);
    expect(items.map(i => i.time)).toEqual(['08:30', '09:15', '11:00 AM', '2:15 PM', '4:45 PM']);
    expect(items[0].patientName).toBe('Patient 1 (08:30)');
    expect(items[4].patientName).toBe('Patient 5 (16:45)');
  });

  it('updates appointment status as the clinical workflow progresses: ready -> recording -> processing -> note_generated -> recreate -> done', () => {
    const item = addScheduleItem({
      time: '09:15',
      patientName: 'David Miller',
      procedureText: 'Tooth #16 Crown Prep',
      appointmentType: 'prosthodontic',
      templateId: 'standard',
      status: 'ready'
    }, testDate);

    // Initial state: ready
    expect(item.status).toBe('ready');

    // 1. Transition to recording (live audio session)
    let updated = updateScheduleItem(item.id, { status: 'recording' }, testDate);
    expect(updated.find(i => i.id === item.id)?.status).toBe('recording');

    // 2. Transition to processing / note synthesis
    updated = updateScheduleItem(item.id, {
      status: 'processing',
      jobId: 'job_123',
      consultationId: 'consult_456'
    }, testDate);
    const processingItem = updated.find(i => i.id === item.id);
    expect(processingItem?.status).toBe('processing');
    expect(processingItem?.jobId).toBe('job_123');

    // 3. Transition to note_generated / ready
    updated = updateScheduleItem(item.id, {
      status: 'note_generated',
      clinicalNote: 'Tooth #16 Crown Prep Completed.',
      adaCodes: ['611']
    }, testDate);
    const generatedItem = updated.find(i => i.id === item.id);
    expect(generatedItem?.status).toBe('note_generated');
    expect(generatedItem?.clinicalNote).toContain('Tooth #16 Crown Prep');
    expect(generatedItem?.adaCodes).toEqual(['611']);

    // 4. Test error / recreate state on failure
    updated = updateScheduleItem(item.id, {
      status: 'recreate',
      error: 'Microphone was silent'
    }, testDate);
    const recreateItem = updated.find(i => i.id === item.id);
    expect(recreateItem?.status).toBe('recreate');
    expect(recreateItem?.error).toBe('Microphone was silent');

    // 5. Transition to done when copied to PMS
    updated = updateScheduleItem(item.id, {
      status: 'done'
    }, testDate);
    const doneItem = updated.find(i => i.id === item.id);
    expect(doneItem?.status).toBe('done');
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
      .send({ name: 'Dr. Vision Tester', specialty: 'General Dentistry', pin: '6194' });
    if (regRes.status === 201) {
      authToken = regRes.body.token;
    } else {
      const profilesRes = await request(app).get('/api/auth/profiles');
      const tester = profilesRes.body.find((p: any) => p.name === 'Dr. Vision Tester');
      if (tester) {
        const loginRes = await request(app)
          .post('/api/auth/login')
          .send({ dentistId: tester.id, pin: '6194' });
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

  it('never reads an incidental number as a tooth (durations, ages, quantities)', () => {
    // "see you in 16 weeks" used to yield tooth 16. Because the same loose rule
    // ran over the note too, that matched a fabricated tooth and cleared it as
    // grounded — which is exactly how a hallucinated tooth passed verification.
    expect(extractToothNumbers('see you in 16 weeks, 24 hours, age 36')).toEqual([]);
    expect(extractToothNumbers('45 minutes in the chair, 12 months recall')).toEqual([]);

    // The same sentence must not fabricate a tooth from the word "your":
    // the old quadrant test was a bare includes('ur').
    expect(extractToothNumbers('your lower left molar')).toEqual(['36']);

    // Real notation still works: explicit introducers, #-notation, FDI+surface.
    expect(extractToothNumbers('tooth 16 and #48 reviewed')).toEqual(['16', '48']);
    expect(extractToothNumbers('24 mod composite placed')).toEqual(['24']);
  });

  it('flags a fabricated tooth instead of clearing it via an unrelated number', () => {
    const transcript = [{ sender: 'Dialogue', text: 'see you in 16 weeks for a review' }];
    const report = verifyTranscriptGrounding('Extraction of tooth 16 performed.', transcript, []);

    // Tooth 16 was never discussed, so it must be reported as unverified.
    expect(report.isFullyGrounded).toBe(false);
    expect(report.unverifiedClaims).toContain('Tooth #16');
    expect(report.groundedEntities).not.toContain('Tooth #16');
  });

  it('does not report an unverifiable note as grounded', () => {
    // A note with nothing recognisable in it has not been checked. Reporting
    // 100% here suppressed needsReview on the least specific notes.
    const report = verifyTranscriptGrounding('Patient attended for a routine visit.', [], []);
    expect(report.isFullyGrounded).toBe(false);
    expect(report.groundingScore).toBe(0);
    expect(report.entityDetails).toEqual([]);
    expect(report.summary).toMatch(/cross-checked|Review/i);
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

describe('Day-sheet slot ↔ encounter linkage', () => {
  const testDate = '2026-09-12';

  beforeEach(() => {
    clearTodaySchedule(testDate);
  });

  it('finds the row a slot already is, so a re-import links rather than duplicates', () => {
    const row = addScheduleItem({
      time: '11:30',
      patientName: 'Zed Zephyr',
      dob: '11/10/1976',
      procedureText: 'Check up and clean',
      appointmentType: 'examination',
      templateId: 'standard',
      consultationId: 'enc-zed-1',
      consentObtained: true,
      consentCapturedAt: '2026-09-12T09:30:00.000Z',
      consentPractitionerId: 'dentist-1'
    }, testDate);

    const loaded = loadTodaySchedule(testDate);
    // The exact slot resolves to the row...
    expect(findScheduleItemBySlot(loaded, testDate, '11:30', 'Zed Zephyr')?.id).toBe(row.id);
    // ...a differently-shaped but equivalent time does too...
    expect(findScheduleItemBySlot(loaded, testDate, '11:30 AM', 'Zed  Zephyr')?.id).toBe(row.id);
    // ...and a different patient at the same time is a different appointment.
    expect(findScheduleItemBySlot(loaded, testDate, '11:30', 'Someone Else')).toBeUndefined();
  });

  it('re-importing a slot updates the row it already has instead of appending a second one', () => {
    const row = addScheduleItem({
      time: '09:00',
      patientName: 'Justin Tran',
      dob: '14/05/2012',
      procedureText: 'CDBS Paediatric Exam',
      appointmentType: 'examination',
      templateId: 'standard'
    }, testDate);

    // The linked encounter the first import created.
    const encounterId = '11111111-2222-4333-8444-555555555555';
    updateScheduleItem(row.id, { consultationId: encounterId }, testDate);

    // A second import of the same slot finds the row, not a new one.
    const secondImport = findScheduleItemBySlot(loadTodaySchedule(testDate), testDate, '9:00 AM', 'Justin Tran');
    expect(secondImport?.id).toBe(row.id);
    expect(secondImport?.consultationId).toBe(encounterId);

    if (secondImport) {
      updateScheduleItem(secondImport.id, { dob: '15/05/2012', procedureText: 'Updated procedure' }, testDate);
    }
    const rows = loadTodaySchedule(testDate);
    expect(rows.length).toBe(1);
    expect(rows[0].dob).toBe('15/05/2012');
    // The link — and any consent captured on the row — survives the re-import.
    expect(rows[0].consultationId).toBe(encounterId);
  });

  it('carries a captured consent from the row into canonical form, and never invents one', () => {
    const row = addScheduleItem({
      time: '12:00',
      patientName: 'Consent Carry',
      procedureText: 'Exam',
      appointmentType: 'examination',
      templateId: 'standard',
      consentObtained: true,
      consentCapturedAt: '2026-09-12T02:00:00.000Z',
      consentPractitionerId: 'dentist-9'
    }, testDate);
    expect(consentFromCapture(row, 'fallback-dentist')?.obtainedAt).toBe('2026-09-12T02:00:00.000Z');
    expect(consentFromCapture(row, 'fallback-dentist')?.recordedBy).toBe('dentist-9');

    const bare = addScheduleItem({
      time: '12:30',
      patientName: 'No Capture',
      procedureText: 'Exam',
      appointmentType: 'examination',
      templateId: 'standard',
      consentObtained: true
    }, testDate);
    expect(consentFromCapture(bare, 'fallback-dentist')).toBeNull();
  });
});

describe('Async Note Jobs API with Verbal Consent Audit Logging', () => {
  let authToken = '';

  beforeAll(async () => {
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Dr. Consent Tester', specialty: 'General Dentistry', pin: '4086' });
    if (regRes.status === 201) {
      authToken = regRes.body.token;
    } else {
      const profilesRes = await request(app).get('/api/auth/profiles');
      const tester = profilesRes.body.find((p: any) => p.name === 'Dr. Consent Tester');
      if (tester) {
        const loginRes = await request(app)
          .post('/api/auth/login')
          .send({ dentistId: tester.id, pin: '4086' });
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
  }, 60000);
});

describe('Day-sheet row identity', () => {
  const testDate = '2026-09-14';

  beforeEach(() => {
    clearTodaySchedule(testDate);
  });

  it('mints distinct ids for a whole import batch inside a single millisecond', () => {
    // A day-sheet import (and a vision parse) mints many rows at once, so the
    // id must not need luck to stay distinct — it is built from the clock and
    // a counter, never from Math.random.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-14T08:00:00.000Z'));
      const ids = new Set<string>();
      for (let i = 0; i < 40; i++) {
        const row = addScheduleItem(
          {
            time: `${String(9 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`,
            patientName: `Batch Patient ${i}`,
            procedureText: 'Check up',
            appointmentType: 'examination',
            templateId: 'standard',
            source: 'snip'
          },
          testDate
        );
        expect(row.id).toMatch(/^sched_\d+_[a-z0-9]+$/);
        ids.add(row.id);
      }
      expect(ids.size).toBe(40);
    } finally {
      vi.useRealTimers();
    }
  });

  it('mints an id for a genuinely new row in a merge, and keeps the id a row already has', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-14T09:00:00.000Z'));
      const kept: DayScheduleItem = {
        id: 'sched_1758000000000_kept',
        time: '09:30',
        patientName: 'Kept Patient',
        procedureText: 'Existing',
        appointmentType: 'examination',
        templateId: 'standard',
        status: 'ready',
        source: 'snip'
      };
      const merged = mergeScheduleItems(
        [kept],
        [
          { ...kept },
          {
            ...kept,
            id: '',
            time: '10:00',
            patientName: 'New Patient A'
          },
          {
            ...kept,
            id: '',
            time: '10:30',
            patientName: 'New Patient B'
          }
        ],
        testDate
      );
      const byName = new Map(merged.map((row) => [row.patientName, row]));
      expect(byName.get('Kept Patient')?.id).toBe('sched_1758000000000_kept');
      const a = byName.get('New Patient A')?.id ?? '';
      const b = byName.get('New Patient B')?.id ?? '';
      expect(a).toMatch(/^sched_\d+_[a-z0-9]+$/);
      expect(b).toMatch(/^sched_\d+_[a-z0-9]+$/);
      expect(a).not.toBe(b);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never repeats a minted row id inside one realm', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i++) ids.add(mintScheduleItemId());
    expect(ids.size).toBe(500);
  });

  it('the consultation-id fallback stays unique without WebCrypto', () => {
    vi.stubGlobal('crypto', undefined);
    try {
      const ids = new Set<string>();
      for (let i = 0; i < 200; i++) {
        const id = generateSafeUuid();
        expect(id).toMatch(/^consult_\d+_[a-z0-9]+$/);
        ids.add(id);
      }
      expect(ids.size).toBe(200);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

