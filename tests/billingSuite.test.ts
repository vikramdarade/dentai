import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PLANS, isPlanId, isSeatAvailable } from '../src/lib/plans';
import { calculateRecallDueDate, extractRecallItems } from '../src/lib/recallEngine';
import fs from 'fs';
import path from 'path';

/**
 * Billing dependencies for `applyStripeEvent`, with the two lookups kept
 * separate on purpose: `known` is what the clinic already has stored, and
 * `existing` is what Stripe's ids resolve to. Several tests need them to differ
 * so the outcome can only have come from the code under test.
 */
function billingDeps(options: {
  known?: any;
  existing?: any;
  env?: Record<string, string>;
  sent?: any[];
  written?: any[];
  recorded?: any[];
} = {}) {
  const sent = options.sent ?? [];
  const written = options.written ?? [];
  const recorded = options.recorded ?? [];
  return {
    store: {
      forClinic: async () => options.known ?? null,
      byStripeSubscriptionId: async () => options.existing ?? null,
      byStripeCustomerId: async () => options.existing ?? null,
      upsert: async (record: any) => {
        written.push(record);
      },
    } as any,
    events: {
      has: async () => false,
      record: async (event: any) => {
        recorded.push(event);
      },
    } as any,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    env: options.env ?? {},
    sendReceiptEmail: async (params: any) => {
      sent.push(params);
    },
  };
}

describe('Commercial Plans & Entitlements', () => {
  it('defines Solo as Free Forever ($0/mo, 15 notes, 1 seat)', () => {
    const solo = PLANS.solo;
    expect(solo).toBeDefined();
    expect(solo.monthlyAudExGst).toBe(0);
    expect(solo.dailyNotes).toBe(15);
    expect(solo.dailyTokens).toBe(150_000);
    expect(solo.seats).toBe(1);
    expect(solo.features.some((f) => f.toLowerCase().includes('free'))).toBe(true);
  });

  it('defines Practice Tier at $149/mo ex GST with 6 clinician seats', () => {
    const practice = PLANS.practice;
    expect(practice).toBeDefined();
    expect(practice.monthlyAudExGst).toBe(149);
    expect(practice.dailyNotes).toBe(200);
    expect(practice.dailyTokens).toBe(2_000_000);
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
    expect(result).not.toBeNull();
    expect(result!.intervalMonths).toBe(6);
    expect(result!.urgency).toBe('routine');
    // September 2026 + 6 months = March 2027
    expect(result!.dueDateIso.startsWith('2027-03')).toBe(true);
  });

  it('clamps month-end dates without rolling into March (e.g. 31 Aug + 6mo -> 28 Feb)', () => {
    const result = calculateRecallDueDate('2026-08-31T10:00:00.000Z', '6 Months');
    expect(result).not.toBeNull();
    // Must land on February 28, 2027 (not March 3, 2027)
    expect(result!.dueDateIso.startsWith('2027-02-28')).toBe(true);
  });

  it('returns null and does not fabricate interval when recall requirement is missing', () => {
    const result = calculateRecallDueDate(baseDate, '');
    expect(result).toBeNull();
    const resultUndefined = calculateRecallDueDate(baseDate, undefined);
    expect(resultUndefined).toBeNull();
  });

  it('calculates 3-month periodontal recall due date', () => {
    const result = calculateRecallDueDate(baseDate, '3 Months (Periodontal)');
    expect(result).not.toBeNull();
    expect(result!.intervalMonths).toBe(3);
    expect(result!.urgency).toBe('periodontal');
    // September 2026 + 3 months = December 2026
    expect(result!.dueDateIso.startsWith('2026-12')).toBe(true);
  });

  it('calculates urgent next available recall due date (2 weeks)', () => {
    const result = calculateRecallDueDate(baseDate, 'Next Available (Urgent)');
    expect(result).not.toBeNull();
    expect(result!.intervalMonths).toBe(0.5);
    expect(result!.urgency).toBe('urgent');
    // September 15 + 14 days = September 29
    expect(result!.dueDateIso.startsWith('2026-09-29')).toBe(true);
  });

  it('extracts recall items from consultations, deduplicates by patient, and determines status', () => {
    const mockConsultations: any[] = [
      {
        id: 'c-1',
        dentistId: 'dentist-1',
        clinicId: 'clinic-1',
        patientId: 'p-1',
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
        patientId: 'p-2',
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
        patientId: 'p-3',
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

  it('enforces 1 seat limit on an unsubscribed trial clinic without writing any subscription', async () => {
    const request = (await import('supertest')).default;
    const { app } = await import('../server.ts');

    // Register a fresh owner (no subscription written — resolves naturally to trial)
    const ownerName = `Dr. Trial Owner ${Math.random().toString(36).substring(7)}`;
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

    // Colleague attempts to join
    const colleagueName = `Dr. Trial Colleague ${Math.random().toString(36).substring(7)}`;
    const colleagueReg = await request(app)
      .post('/api/auth/register')
      .send({ name: colleagueName, specialty: 'General Dentistry', pin: '4921', inviteCode });
    expect(colleagueReg.status).toBe(201);
    const colleagueId = colleagueReg.body.dentist.id;

    // Owner attempts to approve colleague on Trial plan (already 1 active member = owner)
    const approveRes = await request(app)
      .post(`/api/clinics/${clinicId}/members/${colleagueId}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`);

    // Must be blocked because trial is 1 seat!
    expect(approveRes.status).toBe(409);
    expect(approveRes.body.code).toBe('SEAT_LIMIT_REACHED');
    expect(approveRes.body.seats).toBe(1);
  });

  it('fulfils checkout.session.completed carrying checkout-generated metadata (clinic_id, plan) and flips entitlements to Practice (6 seats)', async () => {
    const { applyStripeEvent, createEntitlementResolver } = await import('../src/server/billing');
    const subscriptions = new Map<string, any>();
    const processedEvents = new Set<string>();

    const store = {
      forClinic: async (clinicId: string) => subscriptions.get(clinicId) ?? null,
      byStripeSubscriptionId: async (id: string) =>
        [...subscriptions.values()].find((s) => s.stripeSubscriptionId === id) ?? null,
      byStripeCustomerId: async (id: string) =>
        [...subscriptions.values()].find((s) => s.stripeCustomerId === id) ?? null,
      upsert: async (record: any) => {
        subscriptions.set(record.clinicId, record);
      },
    };

    const events = {
      has: async (id: string) => processedEvents.has(id),
      record: async (event: any) => {
        processedEvents.add(event.id);
      },
    };

    const logger = { info: () => {}, warn: () => {}, error: () => {} };
    const entitlementsResolver = createEntitlementResolver({ store: store as any, logger: logger as any });
    const onChanged = (cid: string) => entitlementsResolver.invalidate(cid);

    const deps = { store: store as any, events: events as any, logger: logger as any, onChanged };

    // This is the EXACT payload created by POST /api/billing/checkout:
    // params.append('client_reference_id', clinic.clinicId);
    // params.append('metadata[clinic_id]', clinic.clinicId);
    // params.append('metadata[dentist_id]', req.dentist.id);
    // params.append('metadata[plan]', 'practice');
    const event = {
      id: 'evt_checkout_live_123',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_session_123',
          customer: 'cus_au_dentist_123',
          subscription: 'sub_practice_123',
          client_reference_id: 'clinic-north-sydney-1',
          metadata: {
            clinic_id: 'clinic-north-sydney-1',
            dentist_id: 'dentist-sydney-1',
            plan: 'practice',
          },
        },
      },
    };

    // Before checkout fulfilment, entitlements resolve to trial (1 seat)
    const before = await entitlementsResolver.resolve('clinic-north-sydney-1');
    expect(before.plan).toBe('trial');
    expect(before.seats).toBe(1);

    const result = await applyStripeEvent(event as any, deps);

    // REGRESSION ASSERTIONS:
    expect(result.handled).toBe(true);
    expect(result.clinicId).toBe('clinic-north-sydney-1');
    expect(result.plan).toBe('practice');

    const sub = subscriptions.get('clinic-north-sydney-1');
    expect(sub).toBeDefined();
    expect(sub.plan).toBe('practice');
    expect(sub.status).toBe('active');
    expect(sub.seats).toBe(6);
    expect(sub.stripeCustomerId).toBe('cus_au_dentist_123');
    expect(sub.stripeSubscriptionId).toBe('sub_practice_123');

    // Entitlements must now be flipped to Practice (6 seats)
    const after = await entitlementsResolver.resolve('clinic-north-sydney-1');
    expect(after.plan).toBe('practice');
    expect(after.seats).toBe(6);
  });

  it('rejects duplicate webhook event IDs (idempotency guard)', async () => {
    const { applyStripeEvent } = await import('../src/server/billing');
    const processedEvents = new Set<string>(['evt_already_processed_999']);

    const deps = {
      store: { upsert: vi.fn(), byStripeSubscriptionId: vi.fn(), forClinic: vi.fn() } as any,
      events: {
        has: async (id: string) => processedEvents.has(id),
        record: vi.fn(),
      } as any,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    };

    const event = {
      id: 'evt_already_processed_999',
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'clinic-1',
          metadata: { clinic_id: 'clinic-1', plan: 'practice' },
        },
      },
    };

    const res = await applyStripeEvent(event as any, deps);
    expect(res.handled).toBe(false);
    expect(res.duplicate).toBe(true);
    expect(deps.store.upsert).not.toHaveBeenCalled();
  });

  it('refuses to default to free solo plan when plan is missing or invalid on checkout.session.completed', async () => {
    const { applyStripeEvent } = await import('../src/server/billing');

    const deps = {
      store: { upsert: vi.fn(), byStripeSubscriptionId: vi.fn(), forClinic: vi.fn() } as any,
      events: {
        has: async () => false,
        record: vi.fn(),
      } as any,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    };

    const event = {
      id: 'evt_corrupted_plan_404',
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'clinic-victim-1',
          metadata: { clinic_id: 'clinic-victim-1', plan: 'invalid_unrecognized_plan' },
        },
      },
    };

    await expect(applyStripeEvent(event as any, deps)).rejects.toThrow(/without a valid plan/);
    expect(deps.store.upsert).not.toHaveBeenCalled();
  });

  it('generates an Australian GST-compliant tax invoice email on invoice.paid', async () => {
    const { receiptEmail } = await import('../src/server/email');

    const invoice = receiptEmail({
      practiceName: 'North Sydney Dental Practice',
      planName: 'Practice',
      amountAud: 163.90,
      periodEnd: '2026-10-20T00:00:00.000Z',
      invoiceUrl: 'https://stripe.com/invoice/inv_test_123',
      abn: '51 824 753 556',
      // Stripe's reported tax. Previously this argument did not exist and the
      // GST line was derived as amount/11, which is a guess, not a fact.
      gstAud: 14.90,
      customerAbn: '98 765 432 109',
    });

    expect(invoice.subject).toContain('Tax Invoice / Receipt');
    expect(invoice.text).toContain('TAX INVOICE / RECEIPT - DentAI (ABN: 51 824 753 556)');
    expect(invoice.text).toContain('Customer: North Sydney Dental Practice');
    expect(invoice.text).toContain('Customer ABN: 98 765 432 109');
    expect(invoice.text).toContain('Subtotal (ex GST): A$149.00 AUD');
    expect(invoice.text).toContain('GST: A$14.90 AUD');
    expect(invoice.text).toContain('Total Paid (inc GST): A$163.90 AUD');
    expect(invoice.text).toContain('Invoice: https://stripe.com/invoice/inv_test_123');
  });

  it('issues a receipt, not a tax invoice, when Stripe reports no tax figure', async () => {
    const { receiptEmail } = await import('../src/server/email');

    const receipt = receiptEmail({
      practiceName: 'North Sydney Dental Practice',
      planName: 'Practice',
      amountAud: 163.90,
      periodEnd: '2026-10-20T00:00:00.000Z',
      abn: '51 824 753 556',
    });

    // A tax invoice must state the GST actually charged. Guessing 10% here would
    // assert a figure that may never have been collected.
    expect(receipt.subject).toContain('Payment Receipt');
    expect(receipt.text).toContain('PAYMENT RECEIPT - DentAI');
    expect(receipt.text).not.toContain('TAX INVOICE');
    expect(receipt.text).not.toContain('GST');
    expect(receipt.text).toContain('Total Paid: A$163.90 AUD');
  });

  it('issues a receipt rather than a tax invoice when the supplier ABN is missing', async () => {
    const { receiptEmail } = await import('../src/server/email');
    const previousAbn = process.env.DENTAI_ABN;
    try {
      delete process.env.DENTAI_ABN;
      const receipt = receiptEmail({
        practiceName: 'North Sydney Dental Practice',
        planName: 'Practice',
        amountAud: 163.90,
        periodEnd: '2026-10-20T00:00:00.000Z',
        abn: '',
        gstAud: 14.90,
      });
      // Without a supplier ABN a document cannot be a valid tax invoice.
      expect(receipt.text).not.toContain('TAX INVOICE');
      expect(receipt.text).not.toContain('GST');
    } finally {
      if (previousAbn === undefined) delete process.env.DENTAI_ABN;
      else process.env.DENTAI_ABN = previousAbn;
    }
  });

  it('handles signed HTTP POST /api/billing/webhook and flips clinic entitlements', async () => {
    const request = (await import('supertest')).default;
    const { app } = await import('../server.ts');
    const crypto = await import('crypto');

    const testWebhookSecret = 'whsec_test_suite_secret_123';
    process.env.STRIPE_WEBHOOK_SECRET = testWebhookSecret;

    // Register clinic owner
    const ownerName = `Dr. Webhook Owner ${Math.random().toString(36).substring(7)}`;
    const ownerReg = await request(app)
      .post('/api/auth/register')
      .send({ name: ownerName, specialty: 'General Dentistry', pin: '5192' });
    expect(ownerReg.status).toBe(201);
    const ownerToken = ownerReg.body.token;

    const ownerClinics = await request(app)
      .get('/api/clinics/mine')
      .set('Authorization', `Bearer ${ownerToken}`);
    const clinicId = ownerClinics.body[0].clinicId;

    // Verify initial billing status is trial (1 seat)
    const initialStatus = await request(app)
      .get('/api/billing/status')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(initialStatus.body.entitlements.plan).toBe('trial');
    expect(initialStatus.body.entitlements.seats).toBe(1);

    const eventPayload = JSON.stringify({
      id: `evt_test_http_${Date.now()}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_test_http_${Date.now()}`,
          customer: `cus_test_${Date.now()}`,
          subscription: `sub_test_${Date.now()}`,
          client_reference_id: clinicId,
          metadata: {
            clinic_id: clinicId,
            plan: 'practice',
          },
        },
      },
    });

    const timestamp = Math.floor(Date.now() / 1000);
    const sig = crypto
      .createHmac('sha256', testWebhookSecret)
      .update(`${timestamp}.${eventPayload}`)
      .digest('hex');
    const stripeHeader = `t=${timestamp},v1=${sig}`;

    const webhookRes = await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', stripeHeader)
      .send(eventPayload);

    expect(webhookRes.status).toBe(200);
    expect(webhookRes.body.received).toBe(true);
    expect(webhookRes.body.handled).toBe(true);
    expect(webhookRes.body.clinicId).toBe(clinicId);
    expect(webhookRes.body.plan).toBe('practice');

    // Verify billing status is now flipped to Practice (6 seats)
    const updatedStatus = await request(app)
      .get('/api/billing/status')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(updatedStatus.body.entitlements.plan).toBe('practice');
    expect(updatedStatus.body.entitlements.seats).toBe(6);
  });

  it("uses Stripe's own tax figure and the customer ABN on the tax invoice, not a derived 10%", async () => {
    const { applyStripeEvent } = await import('../src/server/billing');
    const sent: any[] = [];
    const written: any[] = [];
    const deps = billingDeps({
      existing: {
        id: 'sub-tax-1',
        clinicId: 'clinic-tax-1',
        plan: 'practice',
        status: 'active',
        stripeCustomerId: 'cus_tax_1',
        stripeSubscriptionId: 'sub_tax_1',
      },
      sent,
      written,
    });

    const res = await applyStripeEvent(
      {
        id: 'evt_invoice_paid_tax',
        type: 'invoice.paid',
        data: {
          object: {
            id: 'in_tax_1',
            customer: 'cus_tax_1',
            // Deliberately NOT 11x the tax: a prorated invoice where 10% of the
            // total is not the tax charged. amount/11 would report $15.00.
            amount_paid: 16500,
            total: 16500,
            total_tax: 900,
            customer_name: 'North Sydney Dental Practice',
            customer_email: 'owner@practice.example',
            hosted_invoice_url: 'https://stripe.com/invoice/in_tax_1',
            customer_tax_ids: [{ type: 'au_abn', value: '98 765 432 109' }],
            lines: { data: [{ period: { end: 1792454400 } }] },
          },
        },
      } as any,
      deps
    );

    expect(res.handled).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].amountAud).toBe(165);
    expect(sent[0].gstAud).toBe(9);
    expect(sent[0].gstAud).not.toBe(15);
    expect(sent[0].customerAbn).toBe('98 765 432 109');
    expect(written[0].status).toBe('active');
  });

  it('issues no tax invoice when Stripe reports no amount paid, instead of inventing one', async () => {
    const { applyStripeEvent } = await import('../src/server/billing');
    const sent: any[] = [];
    const written: any[] = [];
    const deps = billingDeps({
      existing: {
        id: 'sub-tax-1',
        clinicId: 'clinic-tax-1',
        plan: 'practice',
        status: 'active',
        stripeCustomerId: 'cus_tax_1',
        stripeSubscriptionId: 'sub_tax_1',
      },
      sent,
      written,
    });

    const res = await applyStripeEvent(
      {
        id: 'evt_invoice_paid_no_amount',
        type: 'invoice.paid',
        data: {
          object: {
            id: 'in_no_amount',
            customer: 'cus_tax_1',
            customer_email: 'owner@practice.example',
          },
        },
      } as any,
      deps
    );

    // Previously this fell back to a hardcoded 16390 and emailed a tax invoice
    // for A$163.90 that nobody was charged.
    expect(sent).toHaveLength(0);
    // The subscription itself is still brought up to date.
    expect(res.handled).toBe(true);
    expect(written[0].status).toBe('active');
  });

  it('resolves the plan from the Stripe Price for a subscription that predates plan metadata', async () => {
    const { applyStripeEvent } = await import('../src/server/billing');
    const written: any[] = [];
    const deps = billingDeps({
      // The clinic's stored row says something different on purpose: the plan can
      // only have come from the Price.
      known: null,
      existing: {
        id: 'sub-legacy-1',
        clinicId: 'clinic-legacy-1',
        plan: 'solo',
        status: 'active',
        stripeCustomerId: 'cus_legacy_1',
        stripeSubscriptionId: 'sub-legacy-1',
      },
      env: { STRIPE_PRICE_PRACTICE: 'price_practice_au' },
      written,
    });

    const res = await applyStripeEvent(
      {
        id: 'evt_legacy_updated_1',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub-legacy-1',
            customer: 'cus_legacy_1',
            status: 'past_due',
            metadata: {}, // created before subscription_data metadata existed
            items: { data: [{ price: { id: 'price_practice_au' } }] },
            current_period_end: 1792454400,
          },
        },
      } as any,
      deps
    );

    expect(res.handled).toBe(true);
    expect(res.plan).toBe('practice');
    expect(written).toHaveLength(1);
    // The point of the fix: dunning is recorded rather than retried forever.
    expect(written[0].status).toBe('past_due');
    expect(written[0].plan).toBe('practice');
  });

  it('records a legacy cancellation instead of throwing and being retried forever', async () => {
    const { applyStripeEvent } = await import('../src/server/billing');
    const written: any[] = [];
    const deps = billingDeps({
      known: { id: 'sub-legacy-2', clinicId: 'clinic-legacy-2', plan: 'practice', status: 'active' },
      existing: {
        id: 'sub-legacy-2',
        clinicId: 'clinic-legacy-2',
        plan: 'practice',
        status: 'active',
        stripeCustomerId: 'cus_legacy_2',
        stripeSubscriptionId: 'sub-legacy-2',
      },
      env: {},
      written,
    });

    const res = await applyStripeEvent(
      {
        id: 'evt_legacy_deleted_1',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub-legacy-2',
            customer: 'cus_legacy_2',
            metadata: {},
            current_period_end: 1792454400,
          },
        },
      } as any,
      deps
    );

    expect(res.handled).toBe(true);
    expect(written[0].status).toBe('canceled');
    // The paid period is preserved, so entitlements resolve as period_ended
    // rather than dropping the practice mid-term.
    expect(written[0].currentPeriodEnd).toBe(new Date(1792454400 * 1000).toISOString());
  });

  it('keeps the clinic’s known plan when nothing else identifies it, and still records the event', async () => {
    const { applyStripeEvent } = await import('../src/server/billing');
    const written: any[] = [];
    const deps = billingDeps({
      known: { id: 'sub-x', clinicId: 'clinic-known-1', plan: 'enterprise', status: 'active' },
      existing: {
        id: 'sub-x',
        clinicId: 'clinic-known-1',
        plan: 'enterprise',
        status: 'active',
        stripeCustomerId: 'cus_known_1',
        stripeSubscriptionId: 'sub-x',
      },
      env: {},
      written,
    });

    const res = await applyStripeEvent(
      {
        id: 'evt_known_plan_1',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub-x',
            customer: 'cus_known_1',
            status: 'active',
            metadata: {},
            cancel_at_period_end: true,
            current_period_end: 1792454400,
          },
        },
      } as any,
      deps
    );

    expect(res.handled).toBe(true);
    expect(res.plan).toBe('enterprise');
    expect(written[0].cancelAtPeriodEnd).toBe(true);
  });

  it('records a subscription event with no resolvable plan rather than throwing, so Stripe stops retrying', async () => {
    const { applyStripeEvent } = await import('../src/server/billing');
    const written: any[] = [];
    const recorded: any[] = [];
    const deps = billingDeps({
      known: null,
      existing: {
        id: 'sub-planless-1',
        clinicId: 'clinic-planless-1',
        plan: 'legacy-tier-unknown',
        status: 'active',
        stripeCustomerId: 'cus_planless_1',
        stripeSubscriptionId: 'sub-planless-1',
      },
      env: {},
      written,
      recorded,
    });

    const res = await applyStripeEvent(
      {
        id: 'evt_planless_1',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub-planless-1',
            customer: 'cus_planless_1',
            status: 'past_due',
            metadata: {},
          },
        },
      } as any,
      deps
    );

    // No throw: a 500 would mean Stripe retries a permanent condition for three
    // days and the event is never marked processed.
    expect(res.handled).toBe(false);
    expect(res.message).toContain('no resolvable plan');
    expect(written).toHaveLength(0);
    expect(recorded.some((event) => event.detail?.unresolvedPlan === true)).toBe(true);
  });
});



