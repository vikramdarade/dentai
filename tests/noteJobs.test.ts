import { describe, it, expect } from 'vitest';
import {
  PRIORITY_WEIGHT,
  JOB_CONFIG,
  NOTE_JOB_CLIENT_POLL,
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
  it('buckets by the clinic calendar day, not UTC', () => {
    // 09:00 Sydney on 6 Sep is 23:00 UTC on 5 Sep. Bucketing on UTC (the old
    // behaviour) both reset a clinic's daily allowance mid-morning and split one
    // clinic day across two buckets.
    expect(meteringDay(new Date('2026-09-05T23:00:00Z'), 'Australia/Sydney')).toBe('2026-09-06');
    expect(meteringDay(new Date('2026-09-06T13:00:00Z'), 'Australia/Sydney')).toBe('2026-09-06');
    // Rollover is at local midnight — 14:00 UTC while Sydney is on AEST (+10).
    expect(meteringDay(new Date('2026-09-06T13:59:00Z'), 'Australia/Sydney')).toBe('2026-09-06');
    expect(meteringDay(new Date('2026-09-06T14:30:00Z'), 'Australia/Sydney')).toBe('2026-09-07');
  });

  it('reports exceeded at the limit, not before it', () => {
    const at = usageSnapshotFor('clinic-1', 40, 40);
    const under = usageSnapshotFor('clinic-1', 39, 40);
    expect(at.exceeded).toBe(true);
    expect(under.exceeded).toBe(false);
  });
});

describe('client poll budget vs the worker retry ladder (QLE-2026-0018)', () => {
  it('waits through the first server retry instead of abandoning the job', () => {
    // The defect: a 25s client deadline against a 45s minimum server backoff. The
    // client rendered the offline draft, the durable job later completed, and one
    // encounter ended up with two different notes and no signal.
    expect(NOTE_JOB_CLIENT_POLL.deadlineMs).toBeGreaterThan(JOB_CONFIG.backoffBaseMs);
    expect(NOTE_JOB_CLIENT_POLL.deadlineMs).toBeGreaterThan(backoffDelayMs(1));
  });

  it('stays within the worker attempt budget so a poll always ends', () => {
    const worstCaseMs = backoffDelayMs(1) + backoffDelayMs(2) + backoffDelayMs(3);
    expect(NOTE_JOB_CLIENT_POLL.deadlineMs).toBeLessThanOrEqual(worstCaseMs);
    expect(JOB_CONFIG.maxAttempts).toBeGreaterThanOrEqual(3);
  });

  it('polls on a bounded interval, so the wait is a handful of requests', () => {
    expect(NOTE_JOB_CLIENT_POLL.intervalMs).toBeGreaterThanOrEqual(1_000);
    const polls = NOTE_JOB_CLIENT_POLL.deadlineMs / NOTE_JOB_CLIENT_POLL.intervalMs;
    expect(polls).toBeLessThanOrEqual(100);
  });
});
