import { describe, it, expect } from 'vitest';
import {
  PRIORITY_WEIGHT,
  JOB_CONFIG,
  backoffDelayMs,
  isQuotaError,
  meteringDay,
  priorityForAppointmentType,
  usageSnapshotFor,
  pickNextJob
} from '../src/lib/noteJobs';

describe('priority ordering (emergency work jumps the queue)', () => {
  it('maps treatment types to the documented priority classes', () => {
    expect(priorityForAppointmentType('emergency')).toBe('emergency');
    expect(priorityForAppointmentType('endodontic')).toBe('urgent');
    expect(priorityForAppointmentType('surgical')).toBe('urgent');
    expect(priorityForAppointmentType('examination')).toBe('routine');
    expect(priorityForAppointmentType('scale_clean')).toBe('routine');
  });

  it('picks emergency over urgent over routine, oldest first within a class', () => {
    const jobs = [
      { id: 'routine-old', status: 'queued' as const, priority: 'routine' as const, createdAt: '2026-01-01T10:00:00Z' },
      { id: 'urgent', status: 'queued' as const, priority: 'urgent' as const, createdAt: '2026-01-01T09:00:00Z' },
      { id: 'emergency', status: 'queued' as const, priority: 'emergency' as const, createdAt: '2026-01-01T11:00:00Z' }
    ];
    expect(pickNextJob(jobs)?.id).toBe('emergency');
  });

  it('never picks done/failed/processing jobs', () => {
    const jobs = [
      { id: 'done', status: 'done' as const, priority: 'emergency' as const, createdAt: '2026-01-01T10:00:00Z' },
      { id: 'failed', status: 'failed' as const, priority: 'emergency' as const, createdAt: '2026-01-01T10:01:00Z' }
    ];
    expect(pickNextJob(jobs)).toBeUndefined();
  });

  it('weights are ordered emergency > urgent > routine', () => {
    expect(PRIORITY_WEIGHT.emergency).toBeGreaterThan(PRIORITY_WEIGHT.urgent);
    expect(PRIORITY_WEIGHT.urgent).toBeGreaterThan(PRIORITY_WEIGHT.routine);
  });
});

describe('exponential backoff', () => {
  it('doubles per attempt and never exceeds the cap', () => {
    expect(backoffDelayMs(1)).toBe(JOB_CONFIG.backoffBaseMs);
    expect(backoffDelayMs(2)).toBe(JOB_CONFIG.backoffBaseMs * 2);
    expect(backoffDelayMs(10)).toBe(JOB_CONFIG.backoffMaxMs);
  });
});

describe('quota error classification', () => {
  it('recognises every quota-class failure surface', () => {
    expect(isQuotaError({ status: 429 })).toBe(true);
    expect(isQuotaError({ message: 'RESOURCE_EXHAUSTED on project' })).toBe(true);
    expect(isQuotaError({ message: 'Billing quota exceeded' })).toBe(true);
    expect(isQuotaError({ message: 'rate limit hit' })).toBe(true);
  });

  it('never classifies non-quota failures as quota', () => {
    expect(isQuotaError({ status: 500, message: 'Internal error' })).toBe(false);
    expect(isQuotaError({ message: 'Invalid JSON in response' })).toBe(false);
  });
});

describe('per-clinic daily metering', () => {
  it('buckets by UTC day', () => {
    expect(meteringDay(new Date('2026-09-05T23:59:59Z'))).toBe('2026-09-05');
    expect(meteringDay(new Date('2026-09-06T00:00:01Z'))).toBe('2026-09-06');
  });

  it('reports exceeded at the limit, not before it', () => {
    const at = usageSnapshotFor('clinic-1', 40, 40);
    const under = usageSnapshotFor('clinic-1', 39, 40);
    expect(at.exceeded).toBe(true);
    expect(under.exceeded).toBe(false);
  });
});
