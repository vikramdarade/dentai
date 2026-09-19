import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PLANS, isPlanId, isSeatAvailable } from '../src/lib/plans';
import { calculateRecallDueDate, extractRecallItems } from '../src/lib/recallEngine';
import fs from 'fs';
import path from 'path';

describe('Commercial Plans & Entitlements', () => {
  it('defines Solo as Free Forever ($0/mo, 15 notes, 1 seat)', () => {
    const solo = PLANS.solo;
    expect(solo).toBeDefined();
    expect(solo.monthlyAudExGst).toBe(0);
    expect(solo.dailyNotes).toBe(15);
    expect(solo.dailyTokens).toBe(60_000);
    expect(solo.seats).toBe(1);
    expect(solo.features.some((f) => f.toLowerCase().includes('free'))).toBe(true);
  });

  it('defines Practice Tier at $149/mo ex GST with 6 clinician seats', () => {
    const practice = PLANS.practice;
    expect(practice).toBeDefined();
    expect(practice.monthlyAudExGst).toBe(149);
    expect(practice.dailyNotes).toBe(200);
    expect(practice.dailyTokens).toBe(750_000);
    expect(practice.seats).toBe(6);
    expect(practice.features.some((f) => f.toLowerCase().includes('seat') || f.toLowerCase().includes('clinician'))).toBe(true);
  });

  it('correctly calculates seat availability', () => {
    // Solo allows 1 seat
    expect(isSeatAvailable(0, 'solo')).toBe(true);
    expect(isSeatAvailable(1, 'solo')).toBe(false);
    expect(isSeatAvailable(2, 'solo')).toBe(false);

    // Practice allows 6 seats
    expect(isSeatAvailable(0, 'practice')).toBe(true);
    expect(isSeatAvailable(5, 'practice')).toBe(true);
    expect(isSeatAvailable(6, 'practice')).toBe(false);
    expect(isSeatAvailable(7, 'practice')).toBe(false);
  });
});

describe('Recall Due-Date Engine', () => {
  const baseDate = '2026-09-15T10:00:00.000Z';

  it('calculates 6-month standard recall due date', () => {
    const result = calculateRecallDueDate(baseDate, '6 Months (Standard)');
    expect(result.intervalMonths).toBe(6);
    expect(result.urgency).toBe('routine');
    // September 2026 + 6 months = March 2027
    expect(result.dueDateIso.startsWith('2027-03')).toBe(true);
  });

  it('calculates 3-month periodontal recall due date', () => {
    const result = calculateRecallDueDate(baseDate, '3 Months (Periodontal)');
    expect(result.intervalMonths).toBe(3);
    expect(result.urgency).toBe('periodontal');
    // September 2026 + 3 months = December 2026
    expect(result.dueDateIso.startsWith('2026-12')).toBe(true);
  });

  it('calculates urgent next available recall due date (2 weeks)', () => {
    const result = calculateRecallDueDate(baseDate, 'Next Available (Urgent)');
    expect(result.intervalMonths).toBe(0.5);
    expect(result.urgency).toBe('urgent');
    // September 15 + 14 days = September 29
    expect(result.dueDateIso.startsWith('2026-09-29')).toBe(true);
  });

  it('extracts recall items from consultations and determines status', () => {
    const mockConsultations: any[] = [
      {
        id: 'c-1',
        dentistId: 'dentist-1',
        clinicId: 'clinic-1',
        firstName: 'Alice',
        lastName: 'Smith',
        date: '2026-03-01T09:00:00.000Z',
        findings: {
          recallRequirements: '6 Months (Standard)',
        },
      },
      {
        id: 'c-2',
        dentistId: 'dentist-1',
        clinicId: 'clinic-1',
        firstName: 'Bob',
        lastName: 'Jones',
        date: '2026-08-01T09:00:00.000Z',
        findings: {
          recallRequirements: '3 Months (Periodontal)',
        },
      },
      {
        id: 'c-3',
        dentistId: 'dentist-1',
        clinicId: 'clinic-1',
        firstName: 'Carol',
        lastName: 'White',
        date: '2026-03-15T09:00:00.000Z',
        findings: {
          recallRequirements: '6 Months (Standard)',
        },
      },
    ];

    const recalls = extractRecallItems(mockConsultations, '2026-09-19T00:00:00.000Z');
    expect(recalls.length).toBe(3);

    // Alice: March 1, 2026 + 6 months = Sept 1, 2026. Ref is Sept 19 (>14 days past) -> overdue
    const aliceRecall = recalls.find((r) => r.patientName === 'Alice Smith');
    expect(aliceRecall).toBeDefined();
    expect(aliceRecall?.status).toBe('overdue');

    // Carol: March 15, 2026 + 6 months = Sept 15, 2026. Ref is Sept 19 (4 days past, within [-14, 30]) -> due_now
    const carolRecall = recalls.find((r) => r.patientName === 'Carol White');
    expect(carolRecall).toBeDefined();
    expect(carolRecall?.status).toBe('due_now');

    // Bob: August 1, 2026 + 3 months = Nov 1, 2026 -> Upcoming
    const bobRecall = recalls.find((r) => r.patientName === 'Bob Jones');
    expect(bobRecall).toBeDefined();
    expect(bobRecall?.status).toBe('upcoming');
  });
});

describe('Billing & Member Approval API Integration', () => {
  const dataDir = process.env.DENTAI_DATA_DIR || path.resolve('./data');
  const filesToBackup = ['clinics.json', 'users.json', 'subscriptions.json'];
  const backups: Record<string, string | null> = {};

  beforeAll(() => {
    for (const f of filesToBackup) {
      const p = path.resolve(dataDir, f);
      backups[f] = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
    }
  });

  afterAll(async () => {
    for (const f of filesToBackup) {
      const p = path.resolve(dataDir, f);
      if (backups[f] !== null) {
        fs.writeFileSync(p, backups[f]!, 'utf-8');
      } else if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    }
    const { invalidateDbCache } = await import('../server.ts');
    invalidateDbCache();
  });

  it('enforces seat limit when a clinic has an explicit Solo subscription', async () => {
    const request = (await import('supertest')).default;
    const { app } = await import('../server.ts');

    // Register an owner
    const ownerName = `Dr. Solo Owner ${Math.random().toString(36).substring(7)}`;
    const ownerReg = await request(app)
      .post('/api/auth/register')
      .send({ name: ownerName, specialty: 'General Dentistry', pin: '5192' });
    expect(ownerReg.status).toBe(201);
    const ownerToken = ownerReg.body.token;

    const ownerClinics = await request(app)
      .get('/api/clinics/mine')
      .set('Authorization', `Bearer ${ownerToken}`);
    const clinicId = ownerClinics.body[0].clinicId;
    const inviteCode = ownerClinics.body[0].inviteCode;

    // Simulate clinic having an explicit Solo subscription (seats = 1)
    const fs = await import('fs');
    const path = await import('path');
    const dataDir = process.env.DENTAI_DATA_DIR || path.resolve('./data');
    const subFile = path.resolve(dataDir, 'subscriptions.json');
    let subData = { subscriptions: [] as any[] };
    if (fs.existsSync(subFile)) {
      try {
        subData = JSON.parse(fs.readFileSync(subFile, 'utf-8'));
      } catch {}
    }
    subData.subscriptions = subData.subscriptions || [];
    subData.subscriptions.push({
      id: `sub-${clinicId}`,
      clinicId,
      plan: 'solo',
      tier: 'solo',
      status: 'active',
      seats: 1,
      stripeCustomerId: 'cus_test',
      stripeSubscriptionId: 'sub_test',
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
      cancelAtPeriodEnd: false,
      activatedBy: 'test',
      updatedAt: new Date().toISOString(),
    });
    fs.writeFileSync(subFile, JSON.stringify(subData, null, 2));

    // Colleague attempts to join
    const colleagueName = `Dr. Colleague ${Math.random().toString(36).substring(7)}`;
    const colleagueReg = await request(app)
      .post('/api/auth/register')
      .send({ name: colleagueName, specialty: 'General Dentistry', pin: '4921', inviteCode });
    expect(colleagueReg.status).toBe(201);
    const colleagueId = colleagueReg.body.dentist.id;

    // Owner attempts to approve colleague on Solo plan (already 1 active member = owner)
    const approveRes = await request(app)
      .post(`/api/clinics/${clinicId}/members/${colleagueId}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(approveRes.status).toBe(409);
    expect(approveRes.body.code).toBe('SEAT_LIMIT_REACHED');
    expect(approveRes.body.seats).toBe(1);

    // Verify billing status endpoint returns Solo plan with 1 seat
    const statusRes = await request(app)
      .get('/api/billing/status')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.plans).toBeDefined();
    expect(statusRes.body.entitlements.plan).toBe('solo');
    expect(statusRes.body.entitlements.seats).toBe(1);

    // Verify checkout validation rejects Solo (already free) and requires Practice
    const checkoutSoloRes = await request(app)
      .post('/api/billing/checkout')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ plan: 'solo' });
    expect(checkoutSoloRes.status).toBe(400);
    expect(checkoutSoloRes.body.error).toContain('Solo is free forever');
  });
});
