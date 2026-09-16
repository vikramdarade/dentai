import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const { app, invalidateDbCache } = await import('../server.ts');

const dataDir = path.resolve(__dirname, '..', 'data');
const usersPath = path.join(dataDir, 'users.json');
const auditPath = path.join(dataDir, 'audit.json');
const schedulesPath = path.join(dataDir, 'schedules.json');
const settingsPath = path.join(dataDir, 'settings.json');

let usersBackup: string | null = null;
let auditBackup: string | null = null;
let schedulesBackup: string | null = null;
let settingsBackup: string | null = null;

describe('High-Availability, Medico-Legal Resilience & Settings Vault', () => {
  let authToken = '';
  let dentistId = '';

  beforeAll(async () => {
    if (fs.existsSync(usersPath)) usersBackup = fs.readFileSync(usersPath, 'utf-8');
    if (fs.existsSync(auditPath)) auditBackup = fs.readFileSync(auditPath, 'utf-8');
    if (fs.existsSync(schedulesPath)) schedulesBackup = fs.readFileSync(schedulesPath, 'utf-8');
    if (fs.existsSync(settingsPath)) settingsBackup = fs.readFileSync(settingsPath, 'utf-8');

    // Register a test dentist
    const testName = `Dr. Vault Test ${Math.random().toString(36).substring(7)}`;
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ name: testName, specialty: 'General Dentistry', pin: '5555' });

    expect(regRes.status).toBe(201);
    authToken = regRes.body.token;
    dentistId = regRes.body.dentist.id;
  });

  afterAll(() => {
    if (usersBackup !== null) fs.writeFileSync(usersPath, usersBackup);
    if (auditBackup !== null) fs.writeFileSync(auditPath, auditBackup);
    if (schedulesBackup !== null) fs.writeFileSync(schedulesPath, schedulesBackup);
    if (settingsBackup !== null) fs.writeFileSync(settingsPath, settingsBackup);
    else if (fs.existsSync(settingsPath)) fs.unlinkSync(settingsPath);
    invalidateDbCache();
  });

  // ---------------------------------------------------------------------------
  // Pillar 4: Cryptographic SHA-256 Hash-Chained Audit Ledger
  // ---------------------------------------------------------------------------
  describe('Cryptographic SHA-256 Audit Trail', () => {
    it('verifies untampered audit chain via GET /api/audit/verify', async () => {
      const res = await request(app)
        .get('/api/audit/verify')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.verified).toBe(true);
      expect(res.body.genesisRoot).toBe('GENESIS_DENTAI_AHPRA_ROOT');
    });

    it('detects tampering if an audit record hash or payload is modified', async () => {
      // Intentionally insert a tampered record into data/audit.json
      const raw = JSON.parse(fs.readFileSync(auditPath, 'utf-8'));
      raw.events.push({
        event: 'malicious_tamper_attempt',
        dentistId: 'fraudster',
        detail: { forged: true },
        timestamp: new Date().toISOString(),
        prevHash: 'INVALID_PREV_HASH_BREAKING_CHAIN',
        hash: 'DEADBEEF00000000000000000000000000000000000000000000000000000000'
      });
      fs.writeFileSync(auditPath, JSON.stringify(raw, null, 2));
      invalidateDbCache('dentai:audit');

      const verifyRes = await request(app)
        .get('/api/audit/verify')
        .set('Authorization', `Bearer ${authToken}`);

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.verified).toBe(false);
      expect(verifyRes.body.brokenIndex).toBeGreaterThanOrEqual(0);

      // Restore clean audit log
      if (auditBackup !== null) fs.writeFileSync(auditPath, auditBackup);
      invalidateDbCache('dentai:audit');
    });
  });

  // ---------------------------------------------------------------------------
  // Pillar 3: Optimistic Concurrency Control (OCC) on Operatory Schedules
  // ---------------------------------------------------------------------------
  describe('Schedule Optimistic Concurrency Control', () => {
    const testDate = '2026-09-30';

    it('initializes schedule with version 1 on first save', async () => {
      const items = [
        {
          id: 'item-1',
          time: '09:00',
          patientName: 'Test Patient A',
          procedureText: 'Exam & Clean',
          status: 'scheduled'
        }
      ];

      const putRes = await request(app)
        .put('/api/schedule')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ date: testDate, items });

      expect(putRes.status).toBe(200);
      expect(putRes.body.success).toBe(true);
      expect(putRes.body.version).toBeGreaterThanOrEqual(1);

      const getRes = await request(app)
        .get(`/api/schedule?date=${testDate}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.version).toBe(putRes.body.version);
    });

    it('performs non-destructive 3-way item merge when client sends stale version', async () => {
      // Initial schedule version
      const initialGet = await request(app)
        .get(`/api/schedule?date=${testDate}`)
        .set('Authorization', `Bearer ${authToken}`);

      const initialVer = initialGet.body.version;

      // Terminal 1 (Chair 1) adds Item 2 and increments version
      await request(app)
        .put('/api/schedule')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          date: testDate,
          items: [
            ...initialGet.body.items,
            { id: 'item-2-chair1', time: '10:00', patientName: 'Chair 1 Seated', status: 'arrived' }
          ]
        });

      // Terminal 2 (Front Desk) concurrently submits with initialVer (stale) adding Item 3
      const stalePutRes = await request(app)
        .put('/api/schedule')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          date: testDate,
          clientVersion: initialVer, // Stale version!
          items: [
            ...initialGet.body.items,
            { id: 'item-3-reception', time: '11:00', patientName: 'Reception Walk-in', status: 'ready' }
          ]
        });

      expect(stalePutRes.status).toBe(200);
      expect(stalePutRes.body.conflict).toBe(true); // Flagged conflict resolved via merge

      // Both items must exist in merged state!
      const itemIds = stalePutRes.body.items.map((i: any) => i.id);
      expect(itemIds).toContain('item-2-chair1');
      expect(itemIds).toContain('item-3-reception');
    });
  });

  // ---------------------------------------------------------------------------
  // Pillar 6: Centralized Practice Settings Vault & AES-256-GCM Encryption
  // ---------------------------------------------------------------------------
  describe('Practice Settings Vault', () => {
    it('saves custom Gemini API key encrypted and returns masked key on GET /api/settings', async () => {
      const testApiKey = 'AIzaSyAABBCCDDEEFFGGHHIIJJKKLLMMNNOOPPQ';

      const putRes = await request(app)
        .put('/api/settings')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          geminiApiKey: testApiKey,
          feeScheduleTier: 'standard_australian'
        });

      expect(putRes.status).toBe(200);
      expect(putRes.body.success).toBe(true);
      expect(putRes.body.hasCustomKey).toBe(true);
      expect(putRes.body.maskedKey).toContain('AIzaSy...');
      expect(putRes.body.maskedKey).not.toBe(testApiKey); // Never expose raw plaintext in responses

      // Verify server persisted ciphertext in settings.json, not plaintext
      const rawSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const savedEncrypted = rawSettings.settings[dentistId].encryptedGeminiKey;
      expect(savedEncrypted).toBeDefined();
      expect(savedEncrypted).not.toContain(testApiKey); // Encrypted with AES-256-GCM!
      expect(savedEncrypted).toContain(':'); // IV : AuthTag : Ciphertext

      // Verify GET returns masked key
      const getRes = await request(app)
        .get('/api/settings')
        .set('Authorization', `Bearer ${authToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.hasCustomKey).toBe(true);
      expect(getRes.body.maskedKey).toBe(putRes.body.maskedKey);
    });
  });
});
