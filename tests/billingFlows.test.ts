import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import dotenv from 'dotenv';
import { dbSaveSubscription, type SubscriptionRecord } from '../src/lib/db';

dotenv.config({ path: '.env.local' });
dotenv.config();

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'TEST_API_KEY';
process.env.DATABASE_URL = '';

const { app, generateToken } = await import('../server.ts');

describe('Slice 1: Automated Stripe Self-Service Billing & Customer Portal', () => {
  const dentistId = '5a002da7-d8e6-4d5c-8566-000d534e2a32';
  const clinicId = 'clinic-billing-bondi';
  let token: string;

  beforeAll(() => {
    token = generateToken({
      dentistId,
      name: 'Dr. Vikram Darade',
      specialty: 'General & Implant Dentistry'
    });
  });

  describe('GET /api/billing/status', () => {
    it('returns default Solo tier (free) when no subscription is present', async () => {
      const res = await request(app)
        .get('/api/billing/status')
        .set('Authorization', `Bearer ${token}`)
        .query({ clinicId: 'unsubscribed-clinic-999' });

      expect(res.status).toBe(200);
      expect(res.body.tier).toBe('solo');
      expect(res.body.status).toBe('active');
      expect(res.body.seats).toBe(1);
      expect(res.body.isSubscribed).toBe(false);
      expect(res.body.features.speedReviewBatchSign).toBe(false);
      expect(res.body.features.crossChairAggregation).toBe(false);
    });

    it('returns active Clinic Pro tier with unlocked features when subscription exists', async () => {
      const proSub: SubscriptionRecord = {
        id: 'sub_test_pro_1',
        clinicId,
        stripeCustomerId: 'cus_test_123',
        stripeSubscriptionId: 'sub_stripe_pro_1',
        tier: 'clinic_pro',
        status: 'active',
        seats: 3,
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await dbSaveSubscription(proSub);

      const res = await request(app)
        .get('/api/billing/status')
        .set('Authorization', `Bearer ${token}`)
        .query({ clinicId });

      expect(res.status).toBe(200);
      expect(res.body.tier).toBe('clinic_pro');
      expect(res.body.status).toBe('active');
      expect(res.body.seats).toBe(3);
      expect(res.body.isSubscribed).toBe(true);
      expect(res.body.features.speedReviewBatchSign).toBe(true);
      expect(res.body.features.receptionHandoffManifest).toBe(true);
    });
  });

  describe('POST /api/billing/create-checkout', () => {
    it('rejects invalid tiers', async () => {
      const res = await request(app)
        .post('/api/billing/create-checkout')
        .set('Authorization', `Bearer ${token}`)
        .send({ tier: 'ultra_mega_tier' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid subscription tier');
    });

    it('creates an autonomous mock checkout session in test environment', async () => {
      const res = await request(app)
        .post('/api/billing/create-checkout')
        .set('Authorization', `Bearer ${token}`)
        .send({
          tier: 'clinic_pro',
          clinicId,
          successUrl: 'https://app.dentai.com/settings?billing=success'
        });

      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('mock');
      expect(res.body.sessionId).toContain('cs_test_');
      expect(res.body.url).toContain('billing=success');
      expect(res.body.tier).toBe('clinic_pro');
      expect(res.body.clinicId).toBe(clinicId);
    });
  });

  describe('POST /api/billing/portal', () => {
    it('generates self-service customer portal link', async () => {
      const res = await request(app)
        .post('/api/billing/portal')
        .set('Authorization', `Bearer ${token}`)
        .send({ clinicId });

      expect(res.status).toBe(200);
      expect(res.body.url).toBeDefined();
    });
  });

  describe('POST /api/billing/webhook', () => {
    it('rejects empty or malformed webhook event', async () => {
      const res = await request(app)
        .post('/api/billing/webhook')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('provisions a new subscription upon checkout.session.completed', async () => {
      const targetClinic = 'clinic-webhook-auto-provision';
      const eventPayload = {
        type: 'checkout.session.completed',
        data: {
          object: {
            client_reference_id: targetClinic,
            customer: 'cus_webhook_99',
            subscription: 'sub_webhook_99',
            metadata: {
              clinicId: targetClinic,
              tier: 'enterprise'
            }
          }
        }
      };

      const res = await request(app)
        .post('/api/billing/webhook')
        .send(eventPayload);

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);

      // Verify the subscription record was persisted
      const checkRes = await request(app)
        .get('/api/billing/status')
        .set('Authorization', `Bearer ${token}`)
        .query({ clinicId: targetClinic });

      expect(checkRes.status).toBe(200);
      expect(checkRes.body.tier).toBe('enterprise');
      expect(checkRes.body.seats).toBe(10);
      expect(checkRes.body.features.crossChairAggregation).toBe(true);
      expect(checkRes.body.features.backupEscrow).toBe(true);
    });

    it('cancels subscription upon customer.subscription.deleted', async () => {
      const cancelPayload = {
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_webhook_99'
          }
        }
      };

      const res = await request(app)
        .post('/api/billing/webhook')
        .send(cancelPayload);

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);

      const checkRes = await request(app)
        .get('/api/billing/status')
        .set('Authorization', `Bearer ${token}`)
        .query({ clinicId: 'clinic-webhook-auto-provision' });

      expect(checkRes.status).toBe(200);
      expect(checkRes.body.status).toBe('canceled');
      expect(checkRes.body.isSubscribed).toBe(false);
    });
  });
});
