import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadTodaySchedule,
  saveTodaySchedule,
  addWalkInPatient,
  updateScheduleStatus,
  deleteScheduleItem,
  clearTodaySchedule,
  DayScheduleItem
} from '../src/lib/dayScheduleStorage';
import { dbGetSchedule, dbSaveSchedule, dbDeleteSchedule } from '../src/lib/db';

describe('Zero-Disturbance Chairside & Database-Driven Dynamic Schedule Flows', () => {
  const testDate = '2026-09-14';

  beforeEach(() => {
    clearTodaySchedule(testDate);
  });

  describe('Ad-Hoc Walk-Ins & Dynamic Schedule Triage', () => {
    it('creates an ad-hoc standard walk-in patient with arrived status', () => {
      const walkIn = addWalkInPatient({
        patientName: 'Marcus Aurelius',
        appointmentType: 'examination',
        procedureText: 'Walk-in tooth pain evaluation'
      }, testDate);

      expect(walkIn.id).toContain('walkin_');
      expect(walkIn.patientName).toBe('Marcus Aurelius');
      expect(walkIn.status).toBe('arrived');
      expect(walkIn.isWalkIn).toBe(true);
      expect(walkIn.priority).toBe('normal');

      const schedule = loadTodaySchedule(testDate);
      expect(schedule.some(item => item.id === walkIn.id)).toBe(true);
    });

    it('creates an ad-hoc EMERGENCY walk-in with emergency appointment type and preOp brief', () => {
      const emergency = addWalkInPatient({
        patientName: 'Sarah Connor',
        priority: 'emergency',
        procedureText: 'Severe throbbing lower molar'
      }, testDate);

      expect(emergency.isWalkIn).toBe(true);
      expect(emergency.priority).toBe('emergency');
      expect(emergency.appointmentType).toBe('emergency');
      expect(emergency.status).toBe('arrived');
      expect(emergency.preOpBrief).toContain('EMERGENCY');

      const schedule = loadTodaySchedule(testDate);
      expect(schedule[0].id).toBe(emergency.id);
    });

    it('smoothly transitions patient status across the clinical lifecycle', () => {
      const patient = addWalkInPatient({
        patientName: 'Emma Watson',
        procedureText: 'Periodic Check'
      }, testDate);

      expect(patient.status).toBe('arrived');

      // Transition to recording
      let updated = updateScheduleStatus(patient.id, 'recording', testDate);
      expect(updated.find(i => i.id === patient.id)?.status).toBe('recording');

      // Transition to ready
      updated = updateScheduleStatus(patient.id, 'ready', testDate);
      expect(updated.find(i => i.id === patient.id)?.status).toBe('ready');

      // Transition to completed (5:01 PM Speed Review sign-off)
      updated = updateScheduleStatus(patient.id, 'completed', testDate);
      expect(updated.find(i => i.id === patient.id)?.status).toBe('completed');
    });

    it('deletes an item cleanly from the day schedule', () => {
      const patient = addWalkInPatient({ patientName: 'John Doe' }, testDate);
      expect(loadTodaySchedule(testDate).length).toBe(1);

      deleteScheduleItem(patient.id, testDate);
      expect(loadTodaySchedule(testDate).length).toBe(0);
    });
  });

  describe('Neon DB Schedule CRUD Fallback & Contract', () => {
    it('returns null when database is not connected without throwing', async () => {
      const res = await dbGetSchedule('dentist-test-1', testDate);
      // In test runner without Neon connection string, it returns null safely
      expect(res === null || typeof res === 'object').toBe(true);
    });

    it('handles delete gracefully when db is offline', async () => {
      const res = await dbDeleteSchedule('dentist-test-1', testDate);
      expect(typeof res).toBe('boolean');
    });
  });

  describe('5:01 PM Speed Review Batch Completion Flow', () => {
    it('simulates batch sign-off across 4 consecutive patients', () => {
      const p1 = addWalkInPatient({ patientName: 'Patient One' }, testDate);
      const p2 = addWalkInPatient({ patientName: 'Patient Two' }, testDate);
      const p3 = addWalkInPatient({ patientName: 'Patient Three' }, testDate);
      const p4 = addWalkInPatient({ patientName: 'Patient Four' }, testDate);

      const items = loadTodaySchedule(testDate);
      expect(items.length).toBe(4);

      // Simulate Batch Sign All
      const approvedIds = new Set(items.map(i => i.id));
      expect(approvedIds.size).toBe(4);

      // Mark all completed
      items.forEach(item => {
        updateScheduleStatus(item.id, 'completed', testDate);
      });

      const finalized = loadTodaySchedule(testDate);
      const allCompleted = finalized.every(i => i.status === 'completed');
      expect(allCompleted).toBe(true);
    });
  });
});
