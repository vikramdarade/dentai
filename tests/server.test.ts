import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { totpAt } from '../src/lib/totp';

// Load environment variables (such as from .env.local)
dotenv.config({ path: '.env.local' });
dotenv.config();

const realApiKey = process.env.GEMINI_API_KEY && 
                   process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY' && 
                   process.env.GEMINI_API_KEY !== 'TEST_API_KEY'
                   ? process.env.GEMINI_API_KEY
                   : undefined;

// Set test environment before importing server to prevent mounting Vite middleware
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'TEST_API_KEY';
// Unit tests must run deterministically against the JSON fallback store — never
// against a real database, even when DATABASE_URL is present in .env.local.
// Use an empty string (not delete): src/lib/db.ts loads .env.local itself at
// import time, but dotenv never overrides a key that already exists, so an empty
// value keeps the DB layer disabled for the whole test process.
process.env.DATABASE_URL = '';
// Tests must never read or write the developer's working data directory: that
// directory holds real patient records and clinician PIN hashes. Every test run
// gets a throwaway store instead.
process.env.DENTAI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dentai-test-'));
// Give the metering ceilings room so a test asserting generation behaviour is
// never rejected for quota reasons; quota behaviour is asserted explicitly.
process.env.DENTAI_DAILY_NOTE_LIMIT = '500';
process.env.DENTAI_DAILY_TOKEN_LIMIT = '5000000';

// Dynamically import the app to ensure environment variables are evaluated first
const { app } = await import('../server.ts');

// Mock the GoogleGenAI library globally for unit tests.
//
// The real module is spread in first so that every export the server imports
// exists here: a hand-written mock that lists only the members it happens to
// know about breaks the suite the moment production code imports anything else
// (which is exactly what happened when note generation started using the SDK's
// ThinkingLevel enum).
vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/genai')>();
  return {
    ...actual,
    GoogleGenAI: vi.fn().mockImplementation(function () {
      return {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: JSON.stringify({
              chiefComplaint: 'Tapped tooth sensitivity',
              history: 'Daily brushing, flossing is irregular.',
              toothFindings: 'Tooth 16 percussion positive',
              findingsGingival: 'Standard pockets (2-3mm)',
              diagnosis: 'Symptomatic irreversible pulpitis on tooth 16',
              treatmentPerformed: 'Vitality tests completed',
              recommendations: 'Avoid cold fluids',
              recallRequirements: 'Next Available (Urgent)',
              patientSummary: 'Hi Sarah, tooth 16 is inflamed.'
            })
          })
        }
      };
    }),
    Type: {
      OBJECT: 'OBJECT',
      STRING: 'STRING'
    }
  };
});

// Every store path is derived from the throwaway directory configured above, so
// neither this suite nor the live suite below can read or write the developer's
// working data directory — that directory holds real patient records and
// clinician PIN hashes.
const testDataDir = process.env.DENTAI_DATA_DIR as string;
const dbPath = path.join(testDataDir, 'consultations.json');
const usersDbPath = path.join(testDataDir, 'users.json');
const clinicsDbPath = path.join(testDataDir, 'clinics.json');
const auditDbPath = path.join(testDataDir, 'audit.json');
const jobsDbPath = path.join(testDataDir, 'note_jobs.json');
const usageDbPath = path.join(testDataDir, 'usage_events.json');
let clinicsDbBackup: string | null = null;

describe('DentAI Server - Mocked Unit Tests', () => {
  let authToken = '';
  let dbBackup: string | null = null;
  let usersDbBackup: string | null = null;
  let auditDbBackup: string | null = null;
  let jobsDbBackup: string | null = null;
  let usageDbBackup: string | null = null;

  beforeAll(async () => {
    if (fs.existsSync(dbPath)) {
      dbBackup = fs.readFileSync(dbPath, 'utf-8');
    }
    if (fs.existsSync(usersDbPath)) {
      usersDbBackup = fs.readFileSync(usersDbPath, 'utf-8');
    }
    // Registration auto-creates personal clinics and every request appends an
    // audit event, so the clinics and audit stores are backed up alongside the
    // other data files and restored in afterAll (tests must not grow them).
    if (fs.existsSync(clinicsDbPath)) {
      clinicsDbBackup = fs.readFileSync(clinicsDbPath, 'utf-8');
    }
    if (fs.existsSync(auditDbPath)) {
      auditDbBackup = fs.readFileSync(auditDbPath, 'utf-8');
    }
    if (fs.existsSync(jobsDbPath)) {
      jobsDbBackup = fs.readFileSync(jobsDbPath, 'utf-8');
    }
    if (fs.existsSync(usageDbPath)) {
      usageDbBackup = fs.readFileSync(usageDbPath, 'utf-8');
    }
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Dr. Sarah Jenkins', specialty: 'General Dentistry', pin: '4826' });
    if (regRes.status === 201) {
      authToken = regRes.body.token;
    } else {
      const profilesRes = await request(app).get('/api/auth/profiles');
      const sarah = profilesRes.body.find((p: any) => p.name === 'Dr. Sarah Jenkins');
      if (sarah) {
        const loginRes = await request(app)
          .post('/api/auth/login')
          .send({ dentistId: sarah.id, pin: '4826' });
        authToken = loginRes.body.token;
      }
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'TEST_API_KEY';
    process.env.NODE_ENV = 'test';
  });

  it('should return 200 OK with healthy status and metadata on GET /api/health', async () => {
    // The authoritative /api/health is registered by registerOpsRoutes
    // (src/server/opsRoutes.ts): status 'ok'|'degraded', storage + database
    // probe, schemaVersion. It is the contract the README, ROLLOUT_PLAYBOOK
    // and the healthSuite tests all assert on. The older inline handler in
    // server.ts is shadowed by it and must not drift the contract.
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('not-configured');
    expect(res.body.storage).toBe('file-fallback');
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  it('should return 400 Bad Request if intakeData is missing', async () => {
    const res = await request(app)
      .post('/api/generate-notes')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        transcript: [{ sender: 'Dentist', text: 'Check tooth 16' }]
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing or invalid');
  });

  it('should return 400 Bad Request if transcript is missing or not an array', async () => {
    const res = await request(app)
      .post('/api/generate-notes')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        intakeData: { firstName: 'Sarah', lastName: 'Jenkins', dob: '1988-04-12', appointmentType: 'emergency' }
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing or invalid');
  });

  it('should return 503 Service Unavailable if GEMINI_API_KEY is not set', async () => {
    process.env.GEMINI_API_KEY = 'MY_GEMINI_API_KEY'; // reset to placeholder env
    const res = await request(app)
      .post('/api/generate-notes')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        intakeData: { firstName: 'Sarah', lastName: 'Jenkins', dob: '1988-04-12', appointmentType: 'emergency' },
        transcript: [{ sender: 'Dentist', text: 'Check tooth 16' }]
      });

    expect(res.status).toBe(503);
    expect(res.body.error).toContain('Gemini API key is not configured');
  });

  it('should return 200 and structured notes on successful mock API call', async () => {
    const res = await request(app)
      .post('/api/generate-notes')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        intakeData: { firstName: 'Sarah', lastName: 'Jenkins', dob: '1988-04-12', appointmentType: 'emergency' },
        transcript: [{ sender: 'Dentist', text: 'Tapping tooth 16 exhibits tenderness' }]
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('chiefComplaint');
    expect(res.body.toothFindings).toContain('Tooth 16 percussion positive');
  });

  it('should contain security and rate-limiting headers', async () => {
    const res = await request(app).get('/api/invalid-route');
    
    // Check for Helmet headers
    expect(res.headers).toHaveProperty('x-dns-prefetch-control');
    expect(res.headers).toHaveProperty('x-content-type-options');
    
    // Check for rate-limiting headers
    expect(res.headers).toHaveProperty('ratelimit-limit');
    expect(res.headers).toHaveProperty('ratelimit-remaining');
  });

  it('should reject invalid firstName or lastName with 400', async () => {
    const res = await request(app)
      .post('/api/generate-notes')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        intakeData: { firstName: '', lastName: 'Jenkins', dob: '1988-04-12', appointmentType: 'emergency' },
        transcript: [{ sender: 'Dentist', text: 'Check tooth 16' }]
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('First name and last name must be non-empty');
  });

  it('should reject invalid dob format with 400', async () => {
    const res = await request(app)
      .post('/api/generate-notes')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        intakeData: { firstName: 'Sarah', lastName: 'Jenkins', dob: '12-04-1988', appointmentType: 'emergency' },
        transcript: [{ sender: 'Dentist', text: 'Check tooth 16' }]
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Date of birth must be in YYYY-MM-DD format');
  });

  it('should reject invalid appointmentType with 400', async () => {
    const res = await request(app)
      .post('/api/generate-notes')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        intakeData: { firstName: 'Sarah', lastName: 'Jenkins', dob: '1988-04-12', appointmentType: 'invalid_type' },
        transcript: [{ sender: 'Dentist', text: 'Check tooth 16' }]
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Appointment type must be one of');
  });

  it('should reject excessively long transcript items with 400', async () => {
    const res = await request(app)
      .post('/api/generate-notes')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        intakeData: { firstName: 'Sarah', lastName: 'Jenkins', dob: '1988-04-12', appointmentType: 'emergency' },
        transcript: [{ sender: 'Dentist', text: 'A'.repeat(1001) }]
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('has an invalid or excessively long text');
  });

  it('should reject payload size exceeding 1mb with 413 Payload Too Large', async () => {
    // Generate a payload ~1.1MB in size
    const largeText = 'A'.repeat(1.1 * 1024 * 1024);
    const res = await request(app)
      .post('/api/generate-notes')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        intakeData: { firstName: 'Sarah', lastName: 'Jenkins', dob: '1988-04-12', appointmentType: 'emergency' },
        transcript: [{ sender: 'Dentist', text: largeText }]
      });
    expect(res.status).toBe(413);
  });

  // Authentication and Session Gate tests
  it('should reject requests without a token with 401', async () => {
    const res = await request(app)
      .post('/api/generate-notes')
      .send({
        intakeData: { firstName: 'Sarah', lastName: 'Jenkins', dob: '1988-04-12', appointmentType: 'emergency' },
        transcript: [{ sender: 'Dentist', text: 'Check tooth 16' }]
      });
    expect(res.status).toBe(401);
  });

  it('should reject requests with an invalid token with 403', async () => {
    const res = await request(app)
      .post('/api/generate-notes')
      .set('Authorization', 'Bearer invalidtoken')
      .send({
        intakeData: { firstName: 'Sarah', lastName: 'Jenkins', dob: '1988-04-12', appointmentType: 'emergency' },
        transcript: [{ sender: 'Dentist', text: 'Check tooth 16' }]
      });
    expect(res.status).toBe(403);
  });

  it('should strip html tags (< >) from firstName and lastName on note generation and consultations', async () => {
    // 1. Check note generation does not crash and processes sanitization
    const genRes = await request(app)
      .post('/api/generate-notes')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        intakeData: { firstName: '<script>Sarah</script>', lastName: 'Jenkins', dob: '1988-04-12', appointmentType: 'emergency' },
        transcript: [{ sender: 'Dentist', text: 'Tapping tooth 16 exhibits tenderness' }]
      });
    expect(genRes.status).toBe(200);

    // 2. Check consultation creation sanitizes patient details
    const consultRes = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        firstName: '<div id="test">John</div>',
        lastName: 'Smith',
        dob: '1990-05-20',
        appointmentType: 'examination',
        date: 'Oct 24',
        time: '10:00 AM',
        status: 'In Review',
        transcript: [],
        findings: {
          chiefComplaint: '',
          history: '',
          toothFindings: '',
          findingsGingival: '',
          diagnosis: '',
          treatmentPerformed: '',
          recommendations: '',
          recallRequirements: '6 Months (Standard)',
        },
        patientSummary: '',
      });
    expect(consultRes.status).toBe(201);
    expect(consultRes.body.firstName).not.toContain('<');
    expect(consultRes.body.firstName).not.toContain('>');
    expect(consultRes.body.firstName).toBe('div id="test"John/div');
  });

  it('should login successfully with correct PIN and get a token', async () => {
    const profilesRes = await request(app).get('/api/auth/profiles');
    const sarah = profilesRes.body.find((p: any) => p.name === 'Dr. Sarah Jenkins');
    
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ dentistId: sarah.id, pin: '4826' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body).toHaveProperty('token');
  });

  it('should fail login with incorrect PIN', async () => {
    const profilesRes = await request(app).get('/api/auth/profiles');
    const sarah = profilesRes.body.find((p: any) => p.name === 'Dr. Sarah Jenkins');
    
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ dentistId: sarah.id, pin: '9999' });
    expect(loginRes.status).toBe(401);
  });

  it('should register a new dentist profile and auto-login', async () => {
    const testName = `Dr. Test ${Math.random().toString(36).substring(7)}`;
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: testName,
        specialty: 'Testing Dentistry',
        pin: '7294'
      });
    expect(regRes.status).toBe(201);
    expect(regRes.body).toHaveProperty('token');
    expect(regRes.body.dentist.name).toBe(testName);
  });

  it('should retrieve consultations for the logged-in dentist, initially empty for new registrar', async () => {
    const testName = `Dr. Test ${Math.random().toString(36).substring(7)}`;
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: testName,
        specialty: 'Testing Dentistry',
        pin: '7294'
      });
    const regToken = regRes.body.token;

    const listRes = await request(app)
      .get('/api/consultations')
      .set('Authorization', `Bearer ${regToken}`);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body.length).toBe(0);
  });

  it("should stamp consultations with the dentist's selected active clinic, never a clinic they don't belong to", async () => {
    // Owner registers and gets a personal clinic with an invite code.
    const ownerName = `Dr. Owner ${Math.random().toString(36).substring(7)}`;
    const ownerReg = await request(app)
      .post('/api/auth/register')
      .send({ name: ownerName, specialty: 'General Dentistry', pin: '8053' });
    expect(ownerReg.status).toBe(201);
    const ownerToken = ownerReg.body.token;

    const ownerClinics = await request(app)
      .get('/api/clinics/mine')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(ownerClinics.status).toBe(200);
    const ownedClinic = ownerClinics.body.find((c: any) => c.role === 'owner' && c.status === 'active');
    expect(ownedClinic).toBeDefined();
    expect(ownedClinic.inviteCode).toBeTruthy();

    // Colleague joins via the invite code, then the owner approves them.
    const memberName = `Dr. Member ${Math.random().toString(36).substring(7)}`;
    const memberReg = await request(app)
      .post('/api/auth/register')
      .send({ name: memberName, specialty: 'General Dentistry', pin: '6172', inviteCode: ownedClinic.inviteCode });
    expect(memberReg.status).toBe(201);
    const memberToken = memberReg.body.token;
    const memberDentistId = memberReg.body.dentist.id;

    const approveRes = await request(app)
      .post(`/api/clinics/${ownedClinic.clinicId}/members/${memberDentistId}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(approveRes.status).toBe(200);

    // Member now belongs to the owner's clinic (active) AND owns a personal clinic.
    const memberClinics = await request(app)
      .get('/api/clinics/mine')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(memberClinics.status).toBe(200);
    const memberOwned = memberClinics.body.find((c: any) => c.role === 'owner' && c.status === 'active');
    const memberJoined = memberClinics.body.find(
      (c: any) => c.clinicId === ownedClinic.clinicId && c.status === 'active'
    );
    expect(memberOwned).toBeDefined();
    expect(memberJoined).toBeDefined();

    const basePayload = {
      firstName: 'Pat',
      lastName: 'Smith',
      dob: '1980-01-01',
      appointmentType: 'examination',
      status: 'In Review',
      findings: { chiefComplaint: 'Pain', history: '', toothFindings: '' },
      patientSummary: ''
    };

    // 1) The selected clinic is honored when it is an active membership.
    const inJoined = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ ...basePayload, clinicId: ownedClinic.clinicId });
    expect(inJoined.status).toBe(201);
    expect(inJoined.body.clinicId).toBe(ownedClinic.clinicId);

    // 2) A clinic the dentist does NOT belong to is rejected → falls back to owned clinic.
    const inBogus = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ ...basePayload, clinicId: 'not-a-real-clinic' });
    expect(inBogus.status).toBe(201);
    expect(inBogus.body.clinicId).toBe(memberOwned.clinicId);

    // 3) No clinicId at all → falls back to the owned clinic.
    const noClinic = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ ...basePayload });
    expect(noClinic.status).toBe(201);
    expect(noClinic.body.clinicId).toBe(memberOwned.clinicId);

    // 4) Owner sees the colleague's note under the clinic; the member's own
    //    list also contains it, and the member cannot read clinic-wide notes.
    const clinicNotes = await request(app)
      .get(`/api/clinics/${ownedClinic.clinicId}/consultations`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(clinicNotes.status).toBe(200);
    expect(clinicNotes.body.some((c: any) => c.id === inJoined.body.id)).toBe(true);

    const memberList = await request(app)
      .get('/api/consultations')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(memberList.status).toBe(200);
    expect(memberList.body.some((c: any) => c.id === inJoined.body.id)).toBe(true);

    const forbidden = await request(app)
      .get(`/api/clinics/${ownedClinic.clinicId}/consultations`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(forbidden.status).toBe(403);
  });

  it('should validate active session via /api/auth/me for logged-in dentist', async () => {
    const profilesRes = await request(app).get('/api/auth/profiles');
    const sarah = profilesRes.body.find((p: any) => p.name === 'Dr. Sarah Jenkins');
    
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ dentistId: sarah.id, pin: '4826' });
    expect(loginRes.status).toBe(200);
    const token = loginRes.body.token;

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.id).toBe(sarah.id);
    expect(meRes.body.name).toBe('Dr. Sarah Jenkins');

    const invalidMeRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid.token.signature');
    expect(invalidMeRes.status).toBe(403);
  });

  it('profile deletion requires a session for that same account (and the PIN)', async () => {
    const testDentistName = `Dr. Deletion Test ${Math.random().toString(36).substring(7)}`;
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ name: testDentistName, specialty: 'Temporary', pin: '4086' });
    expect(regRes.status).toBe(201);
    const dentistId = regRes.body.dentist.id;
    const ownToken = regRes.body.token;

    // 1) Unauthenticated deletion is refused outright — knowing an id is not
    //    enough, which is what previously allowed deleting a colleague.
    const anonRes = await request(app)
      .delete(`/api/auth/profiles/${dentistId}`)
      .send({ pin: '4086' });
    expect(anonRes.status).toBe(401);

    // 2) A signed-in clinician cannot delete somebody else's account.
    const crossRes = await request(app)
      .delete(`/api/auth/profiles/${dentistId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ pin: '4826' });
    expect(crossRes.status).toBe(403);

    // 3) Wrong PIN still fails, even with a valid session.
    const failRes = await request(app)
      .delete(`/api/auth/profiles/${dentistId}`)
      .set('Authorization', `Bearer ${ownToken}`)
      .send({ pin: '0000' });
    expect(failRes.status).toBe(401);

    // 4) The account owner, with their PIN, can delete their own profile.
    const successRes = await request(app)
      .delete(`/api/auth/profiles/${dentistId}`)
      .set('Authorization', `Bearer ${ownToken}`)
      .send({ pin: '4086' });
    expect(successRes.status).toBe(200);
    expect(successRes.body.success).toBe(true);

    const profilesRes = await request(app).get('/api/auth/profiles');
    const exists = profilesRes.body.some((p: any) => p.id === dentistId);
    expect(exists).toBe(false);
  });

  it('rejects trivially guessable PINs at registration', async () => {
    for (const weak of ['1234', '0000', '1111', '4321']) {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: `Dr. Weak ${weak} ${Math.random().toString(36).substring(7)}`, specialty: 'Testing', pin: weak });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('WEAK_PIN');
    }
  });

  it('locks an account out after repeated wrong PINs (durable, not in-process)', async () => {
    const name = `Dr. Lockout ${Math.random().toString(36).substring(7)}`;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ name, specialty: 'Testing', pin: '5083' });
    expect(reg.status).toBe(201);
    const target = reg.body.dentist.id;

    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/api/auth/login').send({ dentistId: target, pin: '9173' });
      expect(res.status).toBe(401);
    }

    // The sixth attempt is refused BEFORE the PIN is checked, and the correct
    // PIN does not bypass the lockout.
    const locked = await request(app).post('/api/auth/login').send({ dentistId: target, pin: '5083' });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('LOCKED_OUT');
  });

  it('logout revokes the session server-side', async () => {
    const name = `Dr. Logout ${Math.random().toString(36).substring(7)}`;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ name, specialty: 'Testing', pin: '6194' });
    expect(reg.status).toBe(201);
    const token = reg.body.token;

    const before = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);

    const out = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
    expect(out.status).toBe(204);

    const after = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(403);
  });

  it('PIN change requires the current PIN and retires other sessions', async () => {
    const name = `Dr. PinChange ${Math.random().toString(36).substring(7)}`;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ name, specialty: 'Testing', pin: '3628' });
    expect(reg.status).toBe(201);
    const oldToken = reg.body.token;

    // A weak new PIN is refused.
    const weak = await request(app)
      .post('/api/auth/change-pin')
      .set('Authorization', `Bearer ${oldToken}`)
      .send({ currentPin: '3628', newPin: '1234' });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe('WEAK_PIN');

    // A wrong current PIN is refused.
    const wrong = await request(app)
      .post('/api/auth/change-pin')
      .set('Authorization', `Bearer ${oldToken}`)
      .send({ currentPin: '1111', newPin: '7529' });
    expect(wrong.status).toBe(401);

    const ok = await request(app)
      .post('/api/auth/change-pin')
      .set('Authorization', `Bearer ${oldToken}`)
      .send({ currentPin: '3628', newPin: '7529' });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();

    // Every token minted before the change is dead (shared-workstation safety).
    const stale = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldToken}`);
    expect(stale.status).toBe(403);
    expect(stale.body.code).toBe('SESSION_SUPERSEDED');

    // The refreshed token works, and the new PIN signs in.
    const fresh = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${ok.body.token}`);
    expect(fresh.status).toBe(200);
    const login = await request(app).post('/api/auth/login').send({ dentistId: reg.body.dentist.id, pin: '7529' });
    expect(login.status).toBe(200);
  });

  it('recovery tokens are single-use and reject unknown values', async () => {
    const bogus = await request(app)
      .post('/api/auth/recovery/redeem')
      .send({ token: 'not-a-real-recovery-token-value-000000', newPin: '8461' });
    expect(bogus.status).toBe(401);

    const weak = await request(app)
      .post('/api/auth/recovery/redeem')
      .send({ token: 'not-a-real-recovery-token-value-000000', newPin: '1111' });
    expect(weak.status).toBe(400);
  });

  it('generation is metered on every path, including the legacy endpoint', async () => {
    const previousLimit = process.env.DENTAI_DAILY_NOTE_LIMIT;
    process.env.DENTAI_DAILY_NOTE_LIMIT = '1';
    try {
      const name = `Dr. Metered ${Math.random().toString(36).substring(7)}`;
      const reg = await request(app)
        .post('/api/auth/register')
        .send({ name, specialty: 'Testing', pin: '4917' });
      expect(reg.status).toBe(201);
      const token = reg.body.token;
      const payload = {
        intakeData: { firstName: 'Sarah', lastName: 'Jenkins', dob: '1988-04-12', appointmentType: 'emergency' },
        transcript: [{ sender: 'Dentist', text: 'Tapping tooth 16 exhibits tenderness' }]
      };

      const first = await request(app)
        .post('/api/generate-notes')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);
      expect(first.status).toBe(200);

      // The same clinic is now out of allowance — the legacy route can no
      // longer be used to bypass the daily cap.
      const second = await request(app)
        .post('/api/generate-notes')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);
      expect(second.status).toBe(429);
      expect(second.body.code).toBe('QUOTA_DAILY');

      const usage = await request(app).get('/api/usage/today').set('Authorization', `Bearer ${token}`);
      expect(usage.status).toBe(200);
      expect(usage.body.used).toBe(1);
    } finally {
      if (previousLimit === undefined) delete process.env.DENTAI_DAILY_NOTE_LIMIT;
      else process.env.DENTAI_DAILY_NOTE_LIMIT = previousLimit;
    }
  });

  it('stamps consent, privacy version and append-only revisions on records', async () => {
    const name = `Dr. Consent ${Math.random().toString(36).substring(7)}`;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ name, specialty: 'Testing', pin: '5739' });
    expect(reg.status).toBe(201);
    const token = reg.body.token;

    const created = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Pat',
        lastName: 'Nguyen',
        dob: '1975-03-02',
        appointmentType: 'examination',
        status: 'In Review',
        transcript: [{ sender: 'Dentist', text: 'Upper right discomfort, tooth 16 tender to percussion.' }],
        findings: { chiefComplaint: 'Discomfort', history: '', toothFindings: '' },
        patientSummary: '',
        consent: { obtainedAt: new Date().toISOString(), disclosureVersion: 'test-disclosure-v1', recordedBy: 'clinician' }
      });
    expect(created.status).toBe(201);
    expect(created.body.consent.obtainedAt).toBeTruthy();
    expect(created.body.consent.disclosureVersion).toBe('test-disclosure-v1');
    expect(created.body.privacyNoticeVersion).toBeTruthy();
    expect(created.body.retentionYears).toBeGreaterThan(0);
    expect(created.body.revisions).toHaveLength(1);

    // A later save appends a revision and cannot erase the recorded consent.
    const updated = await request(app)
      .put(`/api/consultations/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        findings: { chiefComplaint: 'Discomfort', history: 'Reviewed', toothFindings: '16 tender' },
        status: 'Completed'
      });
    expect(updated.status).toBe(200);
    expect(updated.body.consent.disclosureVersion).toBe('test-disclosure-v1');
    expect(updated.body.revisions).toHaveLength(2);
    expect(updated.body.revisions[0].savedAt).toBeTruthy();
  });

  it('exposes a public health probe and keeps telemetry operator-only', async () => {
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');
    expect(health.body.storage).toBe('file-fallback');

    const telemetry = await request(app).get('/api/telemetry');
    expect(telemetry.status).toBe(401);

    const ops = await request(app).get('/api/ops/telemetry');
    expect(ops.status).toBe(503); // ops surface disabled until DENTAI_OPS_SECRET is set
  });

  it('drains the note queue on a scheduled (ops-authenticated) request', async () => {
    const previousSecret = process.env.DENTAI_OPS_SECRET;
    process.env.DENTAI_OPS_SECRET = 'test-ops-secret-value';
    try {
      const unauthorised = await request(app).post('/api/ops/drain').send({});
      expect(unauthorised.status).toBe(401);

      const drained = await request(app)
        .post('/api/ops/drain')
        .set('Authorization', 'Bearer test-ops-secret-value')
        .send({});
      expect(drained.status).toBe(200);
      expect(drained.body.ok).toBe(true);
    } finally {
      if (previousSecret === undefined) delete process.env.DENTAI_OPS_SECRET;
      else process.env.DENTAI_OPS_SECRET = previousSecret;
    }
  });

  it('signs in by practitioner name (case-insensitive) without leaking the staff directory', async () => {
    const testName = `Dr. Privacy Test ${Math.random().toString(36).substring(7)}`;
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ name: testName, specialty: 'Endodontics', pin: '5842' });
    expect(regRes.status).toBe(201);

    // 1) Case-insensitive sign-in with the full name.
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ identifier: testName.toLowerCase(), pin: '5842' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeDefined();
    expect(loginRes.body.dentist.name).toBe(testName);

    // 2) A wrong PIN is refused.
    const failPinRes = await request(app)
      .post('/api/auth/login')
      .send({ identifier: testName, pin: '1057' });
    expect(failPinRes.status).toBe(401);

    // 3) An unknown practitioner is refused with the SAME status and message as
    //    a wrong PIN, so sign-in cannot be used to enumerate the practice's
    //    clinicians.
    const failNameRes = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'Dr. Nonexistent Practitioner', pin: '5842' });
    expect(failNameRes.status).toBe(failPinRes.status);
    expect(failNameRes.body.error).toBe(failPinRes.body.error);
  });

  it('withholds a session until the account\u2019s own TOTP code is supplied', async () => {
    const name = `Dr. Totp ${Math.random().toString(36).substring(7)}`;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ name, specialty: 'Testing', pin: '7361' });
    expect(reg.status).toBe(201);
    const sessionToken = reg.body.token;
    expect(sessionToken).toBeTruthy();

    // Enrolment happens while signed in and completes only once the code from
    // the account's own secret is verified. There is no client-supplied
    // "mfaEnabled" flag to set at registration any more.
    const enrol = await request(app)
      .post('/api/auth/mfa/enroll')
      .set('Authorization', `Bearer ${sessionToken}`);
    expect(enrol.status).toBe(200);
    const secret = enrol.body.secret;
    expect(secret).toBeTruthy();

    const confirm = await request(app)
      .post('/api/auth/mfa/confirm')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send({ code: totpAt(secret) });
    expect(confirm.status).toBe(200);
    expect(confirm.body.success).toBe(true);
    expect(confirm.body.recoveryCodes.length).toBeGreaterThan(0);

    // Sign-in now stops at the second factor: no session token is minted, and
    // the response says so in a machine-readable way for the sign-in screen.
    const noCode = await request(app)
      .post('/api/auth/login')
      .send({ identifier: name, pin: '7361' });
    expect(noCode.status).toBe(401);
    expect(noCode.body.code).toBe('MFA_REQUIRED');
    expect(noCode.body.token).toBeUndefined();

    // A challenge token is no longer a credential: the verifier needs a session,
    // and the login body reads only mfaCode/recoveryCode.
    const legacy = await request(app)
      .post('/api/auth/mfa/verify')
      .send({ mfaToken: 'anything', code: '123456' });
    expect(legacy.status).toBe(401);

    // A code from this account's own secret completes the sign-in.
    const withCode = await request(app)
      .post('/api/auth/login')
      .send({ identifier: name, pin: '7361', mfaCode: totpAt(secret) });
    expect(withCode.status).toBe(200);
    expect(withCode.body.token).toBeDefined();

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${withCode.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.name).toBe(name);
  });

  /** Polls a note job until it reaches a terminal state (or times out). */
  const pollJob = async (jobId: string, token: string, timeoutMs = 8000) => {
    const deadline = Date.now() + timeoutMs;
    let last: any = null;
    while (Date.now() < deadline) {
      const res = await request(app)
        .get(`/api/notes/jobs/${jobId}`)
        .set('Authorization', `Bearer ${token}`);
      if (res.status !== 200) return res;
      last = res;
      if (res.body.status === 'done' || res.body.status === 'failed') return res;
      await new Promise((r) => setTimeout(r, 100));
    }
    return last;
  };

  it('async job fabric: submit → done → durable consultation persisted server-side', async () => {
    const consultationId = 'a1b2c3d4-0000-4000-8000-000000000001';
    const submitRes = await request(app)
      .post('/api/notes/jobs')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        intakeData: { firstName: 'Sarah', lastName: 'Jenkins', dob: '1988-04-12', appointmentType: 'emergency' },
        transcript: [{ sender: 'Dentist', text: 'Tapping tooth 16 exhibits tenderness' }],
        consultationId
      });
    expect(submitRes.status).toBe(202);
    expect(submitRes.body.jobId).toBe(consultationId);
    expect(submitRes.body.priority).toBe('emergency');
    expect(submitRes.body.usage).toBeDefined();

    const doneRes = await pollJob(submitRes.body.jobId, authToken);
    expect(doneRes.status).toBe(200);
    expect(doneRes.body.status).toBe('done');
    expect(doneRes.body.result.chiefComplaint).toContain('Tapped tooth sensitivity');

    // Durable completion: the finished note must already exist as a
    // consultation under the SAME id — a browser death mid-generate loses
    // nothing.
    const listRes = await request(app)
      .get('/api/consultations')
      .set('Authorization', `Bearer ${authToken}`);
    expect(listRes.status).toBe(200);
    const persisted = listRes.body.find((c: any) => c.id === consultationId);
    expect(persisted).toBeDefined();
    expect(persisted.findings.chiefComplaint).toContain('Tapped tooth sensitivity');
    expect(persisted.noteOrigin.engine).toBe('gemini');
    expect(persisted.status).toBe('In Review');
    expect(persisted.clinicId).toBeDefined();
  });

  it('async job fabric: a completed job increments the clinic daily usage meter by exactly one', async () => {
    const before = await request(app)
      .get('/api/usage/today')
      .set('Authorization', `Bearer ${authToken}`);
    expect(before.status).toBe(200);

    const submitRes = await request(app)
      .post('/api/notes/jobs')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        intakeData: { firstName: 'Sarah', lastName: 'Jenkins', dob: '1988-04-12', appointmentType: 'examination' },
        transcript: [{ sender: 'Dentist', text: 'Routine check, all stable' }]
      });
    expect(submitRes.status).toBe(202);
    const doneRes = await pollJob(submitRes.body.jobId, authToken);
    expect(doneRes.body.status).toBe('done');

    const after = await request(app)
      .get('/api/usage/today')
      .set('Authorization', `Bearer ${authToken}`);
    expect(after.status).toBe(200);
    expect(after.body.used).toBe(before.body.used + 1);
    expect(after.body.limit).toBe(before.body.limit);
  });

  it('async job fabric: a dentist can never poll another dentist\u2019s job', async () => {
    const otherName = `Dr. Job Isolation ${Math.random().toString(36).substring(7)}`;
    const otherReg = await request(app)
      .post('/api/auth/register')
      .send({ name: otherName, specialty: 'Orthodontics', pin: '9351' });
    expect(otherReg.status).toBe(201);
    const otherToken = otherReg.body.token;

    const submitRes = await request(app)
      .post('/api/notes/jobs')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        intakeData: { firstName: 'Sarah', lastName: 'Jenkins', dob: '1988-04-12', appointmentType: 'emergency' },
        transcript: [{ sender: 'Dentist', text: 'Private note for my patient' }]
      });
    expect(submitRes.status).toBe(202);

    const forbiddenRes = await request(app)
      .get(`/api/notes/jobs/${submitRes.body.jobId}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(forbiddenRes.status).toBe(404);
  });

  it('async job fabric: quota failures requeue the job with backoff instead of failing it', async () => {
    // First hosted-AI attempt rejects with a quota-class error; the worker must
    // requeue the job (status stays queued, attempts increments) rather than
    // marking it failed — the dentist never sees a dead end.
    const { GoogleGenAI } = await import('@google/genai');
    (GoogleGenAI as any).mockImplementationOnce(function () {
      return {
        models: {
          generateContent: vi.fn().mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED - quota exceeded for project'))
        }
      };
    });

    const submitRes = await request(app)
      .post('/api/notes/jobs')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        intakeData: { firstName: 'Sarah', lastName: 'Jenkins', dob: '1988-04-12', appointmentType: 'emergency' },
        transcript: [{ sender: 'Dentist', text: 'Tooth 14 cracked cusp' }]
      });
    expect(submitRes.status).toBe(202);

    // Wait for the worker to burn the mocked quota failure and requeue.
    const deadline = Date.now() + 8000;
    let jobState: any = null;
    while (Date.now() < deadline) {
      const res = await request(app)
        .get(`/api/notes/jobs/${submitRes.body.jobId}`)
        .set('Authorization', `Bearer ${authToken}`);
      jobState = res.body;
      if (res.status === 200 && res.body.attempts >= 1) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(jobState.status).toBe('queued');
    expect(jobState.attempts).toBeGreaterThanOrEqual(1);
    expect(jobState.error).toBeTruthy();
    expect(jobState.nextAttemptAt).toBeTruthy();
  });

  afterAll(() => {
    if (dbBackup !== null) {
      fs.writeFileSync(dbPath, dbBackup);
    }
    if (usersDbBackup !== null) {
      fs.writeFileSync(usersDbPath, usersDbBackup);
    }
    if (clinicsDbBackup !== null) {
      fs.writeFileSync(clinicsDbPath, clinicsDbBackup);
    } else if (fs.existsSync(clinicsDbPath)) {
      fs.unlinkSync(clinicsDbPath);
    }
    if (auditDbBackup !== null) {
      fs.writeFileSync(auditDbPath, auditDbBackup);
    }
    if (jobsDbBackup !== null) {
      fs.writeFileSync(jobsDbPath, jobsDbBackup);
    } else if (fs.existsSync(jobsDbPath)) {
      fs.unlinkSync(jobsDbPath);
    }
    if (usageDbBackup !== null) {
      fs.writeFileSync(usageDbPath, usageDbBackup);
    } else if (fs.existsSync(usageDbPath)) {
      fs.unlinkSync(usageDbPath);
    }
  });
});

// Run live integration tests only if a real API key is configured
const hasRealKey = !!realApiKey;

describe.runIf(hasRealKey)('DentAI Server - Live LLM Integration & Accent Resilience Tests', () => {
  let realGoogleGenAIClass: any;
  let authToken = '';

  let liveAuditBackup: string | null = null;

  beforeAll(async () => {
    if (fs.existsSync(auditDbPath)) {
      liveAuditBackup = fs.readFileSync(auditDbPath, 'utf-8');
    }
    const profilesRes = await request(app).get('/api/auth/profiles');
    expect(profilesRes.status).toBe(200);
    const sarah = profilesRes.body.find((p: any) => p.name === 'Dr. Sarah Jenkins');
    expect(sarah).toBeDefined();

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ dentistId: sarah.id, pin: '4826' });
    expect(loginRes.status).toBe(200);
    authToken = loginRes.body.token;
  });

  afterAll(() => {
    if (liveAuditBackup !== null) {
      fs.writeFileSync(auditDbPath, liveAuditBackup);
    }
    if (clinicsDbBackup !== null) {
      fs.writeFileSync(clinicsDbPath, clinicsDbBackup);
    } else if (fs.existsSync(clinicsDbPath)) {
      fs.unlinkSync(clinicsDbPath);
    }
  });

  beforeEach(async () => {
    // Restore the real API key for live integration tests
    process.env.GEMINI_API_KEY = realApiKey;

    // Dynamically load the actual unmocked GoogleGenAI library using importActual
    const actualModule = await vi.importActual<typeof import('@google/genai')>('@google/genai');
    realGoogleGenAIClass = actualModule.GoogleGenAI;

    // Temporarily replace the mocked class for this suite
    vi.mocked(await import('@google/genai')).GoogleGenAI = realGoogleGenAIClass;
  });

  const makeNotesRequest = async (payload: any, retries = 3, delay = 2500): Promise<any> => {
    const res = await request(app)
      .post('/api/generate-notes')
      .set('Authorization', `Bearer ${authToken}`)
      .send(payload);

    if (res.status === 429 && retries > 0) {
      console.warn(`[Integration Tests] Quota rate-limited (429). Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return makeNotesRequest(payload, retries - 1, delay * 1.5);
    }
    return res;
  };

  it('Integration Test Case A: should resolve Indian Accent phonetic errors to FDI 33', async () => {
    const res = await makeNotesRequest({
      intakeData: {
        firstName: 'Rajesh',
        lastName: 'Kumar',
        dob: '1984-05-15',
        appointmentType: 'emergency'
      },
      transcript: [
        { sender: 'Patient', text: "I have pain on the bottom left side when tapping." },
        { sender: 'Dentist', text: "Ok patient has decay on tooth dirty tree and needs a composite feeling... pocket depths are tree two tree." }
      ]
    });

    if (res.status === 429) {
      console.warn('[Integration Tests] Skipping Test Case A due to Gemini API daily quota exhaustion (RESOURCE_EXHAUSTED).');
      return;
    }
    expect(res.status).toBe(200);
    
    const bodyText = JSON.stringify(res.body).toLowerCase();
    
    // Check FDI translation: 'dirty tree' should resolve to tooth '33'
    expect(bodyText).toContain('33');
    // Check homophone resolution: 'feeling' should resolve to 'filling' or 'restoration'
    expect(bodyText).toMatch(/filling|restoration|composite/);
    // Check periodontal findings
    expect(res.body.findingsGingival).toContain('3-2-3');
  }, 30000);

  it('Integration Test Case B: should resolve Broad Australian Accent & check en-AU spelling', async () => {
    const res = await makeNotesRequest({
      intakeData: {
        firstName: 'Bruce',
        lastName: 'Miller',
        dob: '1979-11-20',
        appointmentType: 'scale_clean'
      },
      transcript: [
        { sender: 'Dentist', text: "No decay on tooth two four, scale and clean mate, check forty two for mobility. Tissues have good pink colour, let's minimise future staining with a custom brushing programme." }
      ]
    });

    if (res.status === 429) {
      console.warn('[Integration Tests] Skipping Test Case B due to Gemini API daily quota exhaustion (RESOURCE_EXHAUSTED).');
      return;
    }
    expect(res.status).toBe(200);

    const bodyText = JSON.stringify(res.body).toLowerCase();

    // Check FDI notation parsing: "two four" -> "24", "forty two" -> "42"
    expect(bodyText).toContain('24');
    expect(bodyText).toContain('42');
    
    // Check Australian English spelling in patient summary: e.g. "colour", "minimise", "programme"
    const patientLetter = res.body.patientSummary;
    expect(patientLetter).toBeDefined();
    
    // Standard checks for en-AU spelling patterns
    const containsEnAuSpelling = /colour|minimise|programme|haem|anaesth/i.test(patientLetter);
    expect(containsEnAuSpelling).toBe(true);
  }, 30000);

  it('Integration Test Case C: should resolve mumbled speech and pulpitis diagnosis on tooth 16', async () => {
    const res = await makeNotesRequest({
      intakeData: {
        firstName: 'Sarah',
        lastName: 'Jenkins',
        dob: '1988-04-12',
        appointmentType: 'emergency'
      },
      transcript: [
        { sender: 'Dentist', text: "Probably need a root can all on tooth one six due to pulp it is." }
      ]
    });

    if (res.status === 429) {
      console.warn('[Integration Tests] Skipping Test Case C due to Gemini API daily quota exhaustion (RESOURCE_EXHAUSTED).');
      return;
    }
    expect(res.status).toBe(200);
    
    // FDI notation check: 'one six' -> 16
    expect(res.body.toothFindings).toContain('16');
    
    // Mumbled corrections check: 'root can all' -> 'root canal', 'pulp it is' -> 'pulpitis'
    expect(res.body.diagnosis.toLowerCase()).toContain('pulpitis');
    const combinedTreatmentAndRecs = (res.body.treatmentPerformed + ' ' + res.body.recommendations).toLowerCase();
    expect(combinedTreatmentAndRecs).toContain('root canal');
  }, 30000);
});

/**
 * The operator surface is what makes the product supportable by one person:
 * a public health probe, metered/authenticated telemetry, and a scheduler that
 * advances the note queue with no browser open. These tests pin the contract
 * (which endpoint is public, which needs which secret) so a future refactor
 * cannot quietly re-publish process metrics or leave the queue with no driver.
 */
describe('DentAI Server - Operator surface', () => {
  const originalEnv = {
    ops: process.env.DENTAI_OPS_SECRET,
    cron: process.env.CRON_SECRET,
    signup: process.env.DENTAI_ALLOW_SELF_SIGNUP,
    directory: process.env.DENTAI_DISABLE_PROFILE_DIRECTORY,
  };

  afterAll(() => {
    process.env.DENTAI_OPS_SECRET = originalEnv.ops;
    process.env.CRON_SECRET = originalEnv.cron;
    process.env.DENTAI_ALLOW_SELF_SIGNUP = originalEnv.signup;
    process.env.DENTAI_DISABLE_PROFILE_DIRECTORY = originalEnv.directory;
  });

  it('serves /api/health without authentication and names the storage mode', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    // Tests run against the JSON store, so the health output must say so rather
    // than implying Postgres is protecting the records.
    expect(res.body.storage).toBe('file-fallback');
    expect(res.body.database).toBe('not-configured');
  });

  it('no longer publishes process telemetry to anonymous callers', async () => {
    const res = await request(app).get('/api/telemetry');
    expect(res.status).toBe(401);
  });

  it('disables operator endpoints until DENTAI_OPS_SECRET is configured', async () => {
    delete process.env.DENTAI_OPS_SECRET;
    const res = await request(app).get('/api/ops/telemetry');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('OPS_DISABLED');
  });

  it('rejects a wrong operator secret and accepts the right one', async () => {
    process.env.DENTAI_OPS_SECRET = 'ops-secret-for-tests';

    const wrong = await request(app).get('/api/ops/telemetry').set('x-dentai-ops-secret', 'nope');
    expect(wrong.status).toBe(401);

    const right = await request(app).get('/api/ops/telemetry').set('x-dentai-ops-secret', 'ops-secret-for-tests');
    expect(right.status).toBe(200);
    expect(right.body).toHaveProperty('totalRequests');
    expect(right.body.storage).toBe('file-fallback');
  });

  it('will not drain the queue without CRON_SECRET, and drains it with the right one', async () => {
    delete process.env.CRON_SECRET;
    const unconfigured = await request(app).get('/api/cron/drain');
    expect(unconfigured.status).toBe(503);
    expect(unconfigured.body.code).toBe('CRON_DISABLED');

    process.env.CRON_SECRET = 'cron-secret-for-tests';
    const wrong = await request(app).get('/api/cron/drain').set('x-cron-secret', 'nope');
    expect(wrong.status).toBe(401);

    // Vercel Cron sends the secret as a bearer token.
    const right = await request(app)
      .get('/api/cron/drain')
      .set('Authorization', 'Bearer cron-secret-for-tests');
    expect(right.status).toBe(200);
    expect(right.body.ok).toBe(true);
    expect(typeof right.body.openNoteJobs).toBe('number');
  });

  it('lets signup be closed without a code change', async () => {
    process.env.DENTAI_ALLOW_SELF_SIGNUP = 'false';
    const res = await request(app).post('/api/auth/register').send({
      name: 'Dr Blocked Onboarding',
      specialty: 'General Dentistry',
      pin: '9317',
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SIGNUP_CLOSED');
  });

  it('can hide the clinician directory so accounts cannot be enumerated', async () => {
    process.env.DENTAI_DISABLE_PROFILE_DIRECTORY = 'true';
    const res = await request(app).get('/api/auth/profiles');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('DIRECTORY_DISABLED');
  });
});
