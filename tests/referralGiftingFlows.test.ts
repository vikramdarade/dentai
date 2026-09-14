import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

describe('Milestone 4: Viral Chair Gifting & Referral Flywheel Flows', () => {
  let app: any;
  let generateToken: any;
  let authHeader: { Authorization: string };
  let associateAuthHeader: { Authorization: string };
  const seededDentistId = '5a002da7-d8e6-4d5c-8566-000d534e2a32'; // Dr. Vikram Darade

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = '';

    const serverModule = await import('../server.ts');
    app = serverModule.app;
    generateToken = serverModule.generateToken;

    // Sender Dr. Token
    const senderToken = generateToken({
      dentistId: seededDentistId,
      name: 'Dr. Vikram Darade',
      specialty: 'General Dentist',
      clinicId: 'clinic-melbourne-cbd'
    });
    authHeader = { Authorization: `Bearer ${senderToken}` };

    // Associate / Recipient Dr. Token (seeded dentist 2)
    const associateToken = generateToken({
      dentistId: 'ea8e5a3a-d788-45d9-b44b-63faa8db43b3',
      name: 'Dr. Vik Associate',
      specialty: 'Associate Dentist',
      clinicId: 'clinic-melbourne-cbd'
    });
    associateAuthHeader = { Authorization: `Bearer ${associateToken}` };
  });

  let createdGiftCode: string;

  it('1. Generates a 30-Day "Gift Chair 2" referral pass with WhatsApp share link', async () => {
    const res = await request(app)
      .post('/api/referrals/gift-chair')
      .set(authHeader)
      .send({
        recipientChairLabel: 'Operatory 2 (Associate)'
      });

    expect(res.status).toBe(201);
    expect(res.body.gift).toBeDefined();
    expect(res.body.gift.id).toMatch(/^GIFT-CHAIR2-[A-Z0-9]{6}$/);
    expect(res.body.gift.recipientChairLabel).toBe('Operatory 2 (Associate)');
    expect(res.body.gift.passDurationDays).toBe(30);
    expect(res.body.gift.status).toBe('active');
    expect(res.body.inviteUrl).toContain(res.body.gift.id);
    expect(res.body.whatsappShareUrl).toContain('wa.me');

    createdGiftCode = res.body.gift.id;
  });

  it('2. Inspects gift pass details publicly via GET /api/referrals/gift/:code', async () => {
    const res = await request(app)
      .get(`/api/referrals/gift/${createdGiftCode}`);

    expect(res.status).toBe(200);
    expect(res.body.gift).toBeDefined();
    expect(res.body.gift.id).toBe(createdGiftCode);
    expect(res.body.gift.recipientChairLabel).toBe('Operatory 2 (Associate)');
    expect(res.body.gift.status).toBe('active');
  });

  it('3. Returns 404 for non-existent gift code', async () => {
    const res = await request(app)
      .get('/api/referrals/gift/NONEXISTENT-CODE');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('4. Associate dentist claims Chair 2 pass and unlocks Operatory Intercom', async () => {
    const res = await request(app)
      .post('/api/referrals/claim')
      .set(associateAuthHeader)
      .send({
        code: createdGiftCode
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.gift.status).toBe('claimed');
    expect(res.body.operatoryIntercomUnlocked).toBe(true);
    expect(res.body.totalActiveChairs).toBeGreaterThanOrEqual(2);
    expect(res.body.message).toMatch(/Operatory Intercom unlocked/i);
  });

  it('5. Rejects duplicate claim on an already claimed gift pass', async () => {
    const res = await request(app)
      .post('/api/referrals/claim')
      .set(associateAuthHeader)
      .send({
        code: createdGiftCode
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already been claimed/i);
  });

  it('6. Generates Practice Treatment Velocity Report (Owner Upgrade Magnet)', async () => {
    const res = await request(app)
      .get('/api/reports/treatment-velocity')
      .set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.clinicId).toBeDefined();
    expect(res.body.unbookedPipelineValue).toBeGreaterThan(0);
    expect(res.body.unbookedOpportunityCount).toBeGreaterThan(0);
    expect(res.body.categoryBreakdown).toBeDefined();
    expect(res.body.categoryBreakdown.Restorative).toBeDefined();
    expect(res.body.upgradeCallout).toMatch(/Clinic Pro/i);
    expect(res.body.recommendedTier).toBe('clinic_pro');
  });
});
