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
  getTodayDateStr
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
