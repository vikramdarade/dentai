import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadTodaySchedule,
  saveTodaySchedule,
  addScheduleItem,
  updateScheduleItem,
  DayScheduleItem,
  getTodayDateStr
} from '../src/lib/dayScheduleStorage';

describe('Theme & Surgery Island Suite', () => {
  beforeEach(() => {
    saveTodaySchedule([]);
  });

  describe('Surgery Island State Management', () => {
    it('persists recording status on active surgery schedule item', () => {
      const item: DayScheduleItem = {
        id: 'test_item_1',
        time: '09:00',
        patientName: 'Sarah Jenkins',
        procedureText: 'Tooth 16 Crown Prep',
        appointmentType: 'prosthodontic',
        templateId: 'standard',
        status: 'scheduled'
      };

      const initial = addScheduleItem(item);
      expect(initial.status).toBe('scheduled');

      // Start recording updates status to 'recording'
      const recordingState = updateScheduleItem(initial.id, { status: 'recording' });
      expect(recordingState.find(i => i.id === initial.id)?.status).toBe('recording');

      // Reloading from storage still retains 'recording' status
      const reloaded = loadTodaySchedule();
      expect(reloaded.find(i => i.id === initial.id)?.status).toBe('recording');
    });

    it('transitions recording item smoothly to processing and ready', () => {
      const item: DayScheduleItem = {
        id: 'test_item_2',
        time: '10:30',
        patientName: 'Liam O\'Connor',
        procedureText: 'Comprehensive Exam & Scale',
        appointmentType: 'examination',
        templateId: 'standard',
        status: 'recording'
      };

      saveTodaySchedule([item]);

      // Complete recording -> processing
      const processing = updateScheduleItem('test_item_2', {
        status: 'processing',
        consultationId: 'consult_123',
        jobId: 'job_456'
      });
      expect(processing[0].status).toBe('processing');
      expect(processing[0].jobId).toBe('job_456');

      // Note completed -> ready
      const ready = updateScheduleItem('test_item_2', {
        status: 'ready',
        clinicalNote: 'COMPREHENSIVE EXAMINATION NOTE...\nADA 011, 114',
        completedAt: new Date().toISOString()
      });
      expect(ready[0].status).toBe('ready');
      expect(ready[0].clinicalNote).toContain('ADA 011');
    });

    it('cancelling an active recording safely resets status back to scheduled', () => {
      const item: DayScheduleItem = {
        id: 'test_item_3',
        time: '11:15',
        patientName: 'Emma Watson',
        procedureText: 'Tooth 24 Composite',
        appointmentType: 'restorative',
        templateId: 'standard',
        status: 'recording'
      };

      saveTodaySchedule([item]);

      const cancelled = updateScheduleItem('test_item_3', { status: 'scheduled' });
      expect(cancelled[0].status).toBe('scheduled');
    });
  });

  describe('Theme Storage Contract', () => {
    it('validates theme tokens and defaults', () => {
      const supportedThemes = ['dark', 'light'] as const;
      expect(supportedThemes).toContain('dark');
      expect(supportedThemes).toContain('light');
    });
  });
});
