import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const { app } = await import('../server.ts');

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
import { isPmsPreviewEnabled } from '../src/utils/previewMode';

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
  it('rejects requests missing imageBase64 with 400', async () => {
    const res = await request(app)
      .post('/api/schedule/parse-image')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('imageBase64');
  });

  it('returns structured appointment cards from base64 image input', async () => {
    // 1x1 transparent PNG base64
    const samplePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const res = await request(app)
      .post('/api/schedule/parse-image')
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
