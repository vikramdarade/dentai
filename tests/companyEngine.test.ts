import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env.local' });
dotenv.config();

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = ''; // Ensure JSON test isolation

const { app, generateToken, invalidateDbCache } = await import('../server.ts');

const usersPath = path.join(process.cwd(), 'data', 'users.json');
const ticketsPath = path.join(process.cwd(), 'data', 'tickets.json');
const feedbackPath = path.join(process.cwd(), 'data', 'feedback.json');

describe('Solo Founder Autonomous Company Engine & Support Endpoints', () => {
  let usersBackup: string | null = null;
  let ticketsBackup: string | null = null;
  let feedbackBackup: string | null = null;

  let founderToken: string;
  let clinicianToken: string;

  const founderId = 'founder-vikram-id';
  const clinicianId = 'clinician-dr-smith-id';

  beforeAll(() => {
    // 1. Backup existing persistent JSON database files
    if (fs.existsSync(usersPath)) usersBackup = fs.readFileSync(usersPath, 'utf-8');
    if (fs.existsSync(ticketsPath)) ticketsBackup = fs.readFileSync(ticketsPath, 'utf-8');
    if (fs.existsSync(feedbackPath)) feedbackBackup = fs.readFileSync(feedbackPath, 'utf-8');

    // 2. Prepare test users with clean founder vs non-founder segregation
    const validPinHash = '7a96d4fcd143098082eac02f684418cf33c2d8075fc1062961c9ce774808422aef2b66b52ecae906da54a6da5669292ff602ddf922449ca6ed86f87418e0a338';
    const validSalt = '50d557a766f03038edf170a579e0b30ef0a787649763ee06e7c5d3c29b6f8c69';

    const testUsers = {
      dentists: [
        {
          id: founderId,
          name: 'Dr. Vikram Darade',
          specialty: 'General & Implant Dentistry',
          pinHash: validPinHash,
          salt: validSalt,
          isFounder: true,
          founderAccessStatus: 'approved'
        },
        {
          id: 'ea8e5a3a-d788-45d9-b44b-63faa8db43b3',
          name: 'Vik',
          specialty: 'Dentist',
          pinHash: validPinHash,
          salt: validSalt,
          isFounder: true,
          founderAccessStatus: 'approved'
        },
        {
          id: clinicianId,
          name: 'Dr. Sarah Smith',
          specialty: 'Orthodontics',
          pinHash: validPinHash,
          salt: validSalt,
          isFounder: false,
          founderAccessStatus: 'none'
        }
      ]
    };

    fs.writeFileSync(usersPath, JSON.stringify(testUsers, null, 2));
    fs.writeFileSync(ticketsPath, JSON.stringify({ tickets: [] }, null, 2));
    fs.writeFileSync(feedbackPath, JSON.stringify({ feedback: [] }, null, 2));

    invalidateDbCache();

    // 3. Generate signed HMAC authentication tokens
    founderToken = generateToken({
      dentistId: founderId,
      name: 'Dr. Vikram Darade',
      specialty: 'General & Implant Dentistry'
    });

    clinicianToken = generateToken({
      dentistId: clinicianId,
      name: 'Dr. Sarah Smith',
      specialty: 'Orthodontics'
    });
  });

  afterAll(() => {
    // Restore persistent database files to prevent polluting development fixtures
    if (usersBackup) fs.writeFileSync(usersPath, usersBackup);
    if (ticketsBackup) fs.writeFileSync(ticketsPath, ticketsBackup);
    if (feedbackBackup) fs.writeFileSync(feedbackPath, feedbackBackup);
    invalidateDbCache();
  });

  describe('1. Support Ticket Ingestion & Triage', () => {
    let createdTicketId = '';

    it('creates a new clinic chairside support ticket', async () => {
      const res = await request(app)
        .post('/api/support/tickets')
        .set('Authorization', `Bearer ${clinicianToken}`)
        .send({
          clinicId: 'clinic-melbourne-cbd',
          category: 'PMS Pasting',
          title: 'D4W paste note not splitting',
          description: 'Receptionist pasted whole note into invoice notes.',
          diagnostics: { browser: 'Chrome 128', resolution: '1920x1080' },
          priority: 'P1'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.ticket).toBeDefined();
      expect(res.body.ticket.id).toMatch(/^TICKET-/);
      expect(res.body.ticket.status).toBe('open');
      expect(res.body.ticket.title).toBe('D4W paste note not splitting');

      createdTicketId = res.body.ticket.id;
    });

    it('lists support tickets for authenticated clinicians', async () => {
      const res = await request(app)
        .get('/api/support/tickets')
        .set('Authorization', `Bearer ${clinicianToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body.some((t: any) => t.id === createdTicketId)).toBe(true);
    });

    it('patches and resolves a support ticket', async () => {
      const res = await request(app)
        .patch(`/api/support/tickets/${createdTicketId}`)
        .set('Authorization', `Bearer ${founderToken}`)
        .send({
          status: 'resolved',
          resolutionNotes: 'Verified Trojan Horse format with front desk.'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.ticket.status).toBe('resolved');
      expect(res.body.ticket.resolutionNotes).toContain('Trojan Horse');
    });
  });

  describe('2. Clinic Feedback Submission', () => {
    it('submits clinician ratings and feature suggestions', async () => {
      const res = await request(app)
        .post('/api/feedback')
        .set('Authorization', `Bearer ${clinicianToken}`)
        .send({
          clinicId: 'clinic-melbourne-cbd',
          rating: 5,
          category: 'Feature Request',
          pmsType: 'Dental4Windows',
          comments: 'Would love automated SMS recall for tooth 48 impactions.'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.feedback.id).toMatch(/^FB-/);
      expect(res.body.feedback.rating).toBe(5);
    });

    it('retrieves feedback list for authenticated clinicians', async () => {
      const res = await request(app)
        .get('/api/feedback')
        .set('Authorization', `Bearer ${clinicianToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });
  });

  describe('3. Founder-Only RBAC Guarding & Registration Approvals', () => {
    it('blocks non-founder clinicians from accessing the Executive Hub (403)', async () => {
      const res = await request(app)
        .get('/api/company/briefing/latest')
        .set('Authorization', `Bearer ${clinicianToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Founder executive clearance required');
    });

    it('allows non-founder clinician to request founder access', async () => {
      const res = await request(app)
        .post('/api/auth/founder-access/request')
        .set('Authorization', `Bearer ${clinicianToken}`)
        .send({ reason: 'Practice Co-Founder equity review' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('executive approval');
    });

    it('allows Founder to list and approve registration requests', async () => {
      // 1. Founder checks pending requests
      const listRes = await request(app)
        .get('/api/auth/founder-access/requests')
        .set('Authorization', `Bearer ${founderToken}`);

      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body)).toBe(true);

      // 2. Founder approves the clinician
      const reviewRes = await request(app)
        .post('/api/auth/founder-access/review')
        .set('Authorization', `Bearer ${founderToken}`)
        .send({ dentistId: clinicianId, approve: true });

      expect(reviewRes.status).toBe(200);
      expect(reviewRes.body.approved).toBe(true);

      // 3. Formerly non-founder clinician now has founder access!
      const accessRes = await request(app)
        .get('/api/company/briefing/latest')
        .set('Authorization', `Bearer ${clinicianToken}`);

      expect(accessRes.status).toBe(200);
    });

    it('allows Founder to access company briefings and run autonomous cycles', async () => {
      const res = await request(app)
        .get('/api/company/briefings')
        .set('Authorization', `Bearer ${founderToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('4. Resilient Login & Founder Identification', () => {
    it('authenticates Dr. Vikram Darade with PIN 1234 and returns isFounder: true', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'Dr. Vikram Darade', pin: '1234' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.dentist).toBeDefined();
      expect(res.body.dentist.isFounder).toBe(true);
    });

    it('authenticates Vik with PIN 1234 and returns isFounder: true', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'Vik', pin: '1234' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.dentist.isFounder).toBe(true);
    });

    it('authenticates normalized input "Vikram" with PIN 1234', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'Vikram', pin: '1234' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.dentist.name).toMatch(/Vik/i);
    });
  });
});

