import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import {
  verifyPmsWebhookSignature,
  signPmsWebhookPayload,
  signaturesMatch
} from '../src/server/pmsWebhookAuth';

// Test environment configuration
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const { app, invalidateDbCache } = await import('../server.ts');

const dbPath = path.join(__dirname, '..', 'data', 'consultations.json');
const usersDbPath = path.join(__dirname, '..', 'data', 'users.json');
const auditDbPath = path.join(__dirname, '..', 'data', 'audit.json');

describe('Inbound PMS Webhook Authentication & Security Gates', () => {
  const TEST_SECRET = 'test_webhook_secret_key_89234789';
  let dbBackup: string | null = null;
  let usersDbBackup: string | null = null;
  let auditDbBackup: string | null = null;

  beforeAll(() => {
    if (fs.existsSync(dbPath)) dbBackup = fs.readFileSync(dbPath, 'utf-8');
    if (fs.existsSync(usersDbPath)) usersDbBackup = fs.readFileSync(usersDbPath, 'utf-8');
    if (fs.existsSync(auditDbPath)) auditDbBackup = fs.readFileSync(auditDbPath, 'utf-8');
  });

  afterAll(() => {
    if (dbBackup !== null) fs.writeFileSync(dbPath, dbBackup);
    if (usersDbBackup !== null) fs.writeFileSync(usersDbPath, usersDbBackup);
    if (auditDbBackup !== null) fs.writeFileSync(auditDbPath, auditDbBackup);
    delete process.env.DENTAI_PMS_WEBHOOK_SECRET;
    invalidateDbCache();
  });

  describe('Pure Signature Verification Unit Tests', () => {
    const payload = JSON.stringify({
      opportunityId: 'consult-1-tx-crown-16',
      clinicId: 'clinic-alpha',
      pmsAppointmentId: 'PMS-8899',
      pmsType: 'cliniko'
    });

    it('verifies a correctly signed payload within timestamp tolerance', () => {
      const now = 1750000000;
      const header = signPmsWebhookPayload(TEST_SECRET, payload, now);
      const res = verifyPmsWebhookSignature({
        secret: TEST_SECRET,
        header,
        payload,
        now: () => now
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.timestamp).toBe(now);
      }
    });

    it('rejects a tampered payload with no_matching_signature', () => {
      const now = 1750000000;
      const header = signPmsWebhookPayload(TEST_SECRET, payload, now);
      const tamperedPayload = payload + ' ';

      const res = verifyPmsWebhookSignature({
        secret: TEST_SECRET,
        header,
        payload: tamperedPayload,
        now: () => now
      });

      expect(res.ok).toBe(false);
      expect((res as any).reason).toBe('no_matching_signature');
    });

    it('rejects a missing signature header with missing_header', () => {
      const res = verifyPmsWebhookSignature({
        secret: TEST_SECRET,
        header: undefined,
        payload
      });
      expect(res.ok).toBe(false);
      expect((res as any).reason).toBe('missing_header');
    });

    it('rejects a malformed header with malformed_header', () => {
      const res = verifyPmsWebhookSignature({
        secret: TEST_SECRET,
        header: 'invalid-header-without-t-and-v1',
        payload
      });
      expect(res.ok).toBe(false);
      expect((res as any).reason).toBe('malformed_header');
    });

    it('rejects signature made with wrong secret', () => {
      const now = 1750000000;
      const header = signPmsWebhookPayload('wrong_secret', payload, now);
      const res = verifyPmsWebhookSignature({
        secret: TEST_SECRET,
        header,
        payload,
        now: () => now
      });

      expect(res.ok).toBe(false);
      expect((res as any).reason).toBe('no_matching_signature');
    });

    it('rejects signature older than tolerance with timestamp_out_of_tolerance', () => {
      const sentTime = 1750000000;
      const header = signPmsWebhookPayload(TEST_SECRET, payload, sentTime);
      const currentTime = sentTime + 305; // 5 seconds past 300s tolerance

      const res = verifyPmsWebhookSignature({
        secret: TEST_SECRET,
        header,
        payload,
        toleranceSeconds: 300,
        now: () => currentTime
      });

      expect(res.ok).toBe(false);
      expect((res as any).reason).toBe('timestamp_out_of_tolerance');
    });

    it('rejects verification when server secret is empty with no_secret', () => {
      const header = signPmsWebhookPayload(TEST_SECRET, payload);
      const res = verifyPmsWebhookSignature({
        secret: '',
        header,
        payload
      });

      expect(res.ok).toBe(false);
      expect((res as any).reason).toBe('no_secret');
    });
  });

  describe('Server Route Integration Tests: POST /api/webhooks/pms-booking', () => {
    const clinicA = 'clinic-sec-test-a';
    const clinicB = 'clinic-sec-test-b';
    const consultAId = 'consult-webhook-sec-a';
    const oppAId = `${consultAId}-tx-crown-16`;

    beforeAll(() => {
      // Seed a test consultation in Clinic A
      const consultRecord = {
        id: consultAId,
        dentistId: 'dentist-sec-01',
        clinicId: clinicA,
        firstName: 'Alice',
        lastName: 'Wonderland',
        date: '2026-09-20',
        appointmentType: 'Emergency',
        status: 'Completed',
        findings: {
          chiefComplaint: 'Severe toothache 16',
          toothFindings: 'Pulpitis on 16',
          proposedTreatments: [
            {
              id: oppAId,
              consultationId: consultAId,
              clinicId: clinicA,
              dentistId: 'dentist-sec-01',
              patientName: 'Alice Wonderland',
              procedureName: 'Full Crown - Non Metallic',
              adaCode: '611',
              estimatedFee: 1650,
              status: 'unscheduled',
              pmsSyncStatus: 'local_only',
              createdAt: new Date().toISOString()
            }
          ]
        }
      };

      fs.writeFileSync(dbPath, JSON.stringify({ consultations: [consultRecord] }, null, 2));
      invalidateDbCache();
    });

    it('returns 503 WEBHOOK_NOT_CONFIGURED when DENTAI_PMS_WEBHOOK_SECRET is not set', async () => {
      delete process.env.DENTAI_PMS_WEBHOOK_SECRET;

      const res = await request(app)
        .post('/api/webhooks/pms-booking')
        .send({
          opportunityId: oppAId,
          clinicId: clinicA,
          pmsAppointmentId: 'PMS-123'
        });

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('WEBHOOK_NOT_CONFIGURED');
    });

    it('returns 401 INVALID_SIGNATURE on unsigned request and leaves record unchanged', async () => {
      process.env.DENTAI_PMS_WEBHOOK_SECRET = TEST_SECRET;

      const res = await request(app)
        .post('/api/webhooks/pms-booking')
        .send({
          opportunityId: oppAId,
          clinicId: clinicA,
          pmsAppointmentId: 'PMS-123'
        });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_SIGNATURE');

      // Verify stored record was NOT mutated
      const consultsData = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      const consult = consultsData.consultations.find((c: any) => c.id === consultAId);
      const opp = consult.findings.proposedTreatments.find((t: any) => t.id === oppAId);
      expect(opp.status).toBe('unscheduled');
    });

    it('rejects requests without opportunityId (OPPORTUNITY_ID_REQUIRED), refusing fuzzy name match', async () => {
      process.env.DENTAI_PMS_WEBHOOK_SECRET = TEST_SECRET;

      const body = {
        patientName: 'Alice',
        clinicId: clinicA,
        pmsAppointmentId: 'PMS-123'
      };
      const rawBody = JSON.stringify(body);
      const signature = signPmsWebhookPayload(TEST_SECRET, rawBody);

      const res = await request(app)
        .post('/api/webhooks/pms-booking')
        .set('Content-Type', 'application/json')
        .set('x-dentai-signature', signature)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('OPPORTUNITY_ID_REQUIRED');
    });

    it('successfully updates opportunity when correctly signed with clinic match', async () => {
      process.env.DENTAI_PMS_WEBHOOK_SECRET = TEST_SECRET;

      const body = {
        opportunityId: oppAId,
        clinicId: clinicA,
        pmsAppointmentId: 'PMS-VERIFIED-9901',
        pmsType: 'cliniko',
        bookedAt: new Date().toISOString()
      };
      const rawBody = JSON.stringify(body);
      const signature = signPmsWebhookPayload(TEST_SECRET, rawBody);

      const res = await request(app)
        .post('/api/webhooks/pms-booking')
        .set('Content-Type', 'application/json')
        .set('x-dentai-signature', signature)
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.opportunity.status).toBe('booked');
      expect(res.body.opportunity.pmsAppointmentId).toBe('PMS-VERIFIED-9901');
      expect(res.body.opportunity.pmsSyncStatus).toBe('auto_synced');
    });

    it('prevents replay attacks on duplicate signed webhook calls', async () => {
      process.env.DENTAI_PMS_WEBHOOK_SECRET = TEST_SECRET;

      const eventId = `evt_test_${Date.now()}`;
      const body = {
        opportunityId: oppAId,
        clinicId: clinicA,
        pmsAppointmentId: 'PMS-VERIFIED-9901',
        pmsType: 'cliniko'
      };
      const rawBody = JSON.stringify(body);
      const signature = signPmsWebhookPayload(TEST_SECRET, rawBody);

      // First call
      const res1 = await request(app)
        .post('/api/webhooks/pms-booking')
        .set('Content-Type', 'application/json')
        .set('x-dentai-signature', signature)
        .set('x-dentai-event-id', eventId)
        .send(body);

      expect(res1.status).toBe(200);

      // Replay call
      const res2 = await request(app)
        .post('/api/webhooks/pms-booking')
        .set('Content-Type', 'application/json')
        .set('x-dentai-signature', signature)
        .set('x-dentai-event-id', eventId)
        .send(body);

      expect(res2.status).toBe(200);
      expect(res2.body.duplicate).toBe(true);
    });

    it('refuses cross-clinic mutation when clinicId does not match consultation clinicId', async () => {
      process.env.DENTAI_PMS_WEBHOOK_SECRET = TEST_SECRET;

      const body = {
        opportunityId: oppAId,
        clinicId: clinicB, // Mismatched clinic attempting to touch Clinic A's opportunity
        pmsAppointmentId: 'PMS-CROSS-ATTACK',
        pmsType: 'cliniko'
      };
      const rawBody = JSON.stringify(body);
      const signature = signPmsWebhookPayload(TEST_SECRET, rawBody);

      const res = await request(app)
        .post('/api/webhooks/pms-booking')
        .set('Content-Type', 'application/json')
        .set('x-dentai-signature', signature)
        .send(body);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('No matching treatment opportunity');
    });
  });
});
