import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

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

// Dynamically import the app to ensure environment variables are evaluated first
const { app } = await import('../server.ts');

// Mock the GoogleGenAI library globally for unit tests
vi.mock('@google/genai', () => {
  return {
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

describe('DentAI Server - Mocked Unit Tests', () => {
  let authToken = '';
  const dbPath = path.join(__dirname, '..', 'data', 'consultations.json');
  let dbBackup: string | null = null;

  beforeAll(async () => {
    if (fs.existsSync(dbPath)) {
      dbBackup = fs.readFileSync(dbPath, 'utf-8');
    }
    const profilesRes = await request(app).get('/api/auth/profiles');
    expect(profilesRes.status).toBe(200);
    const sarah = profilesRes.body.find((p: any) => p.name === 'Dr. Sarah Jenkins');
    expect(sarah).toBeDefined();

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ dentistId: sarah.id, pin: '1234' });
    expect(loginRes.status).toBe(200);
    authToken = loginRes.body.token;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'TEST_API_KEY';
    process.env.NODE_ENV = 'test';
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
      .send({ dentistId: sarah.id, pin: '1234' });
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
        pin: '9999'
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
        pin: '9999'
      });
    const regToken = regRes.body.token;

    const listRes = await request(app)
      .get('/api/consultations')
      .set('Authorization', `Bearer ${regToken}`);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body.length).toBe(0);
  });

  afterAll(() => {
    if (dbBackup !== null) {
      fs.writeFileSync(dbPath, dbBackup);
    }
  });
});

// Run live integration tests only if a real API key is configured
const hasRealKey = !!realApiKey;

describe.runIf(hasRealKey)('DentAI Server - Live LLM Integration & Accent Resilience Tests', () => {
  let realGoogleGenAIClass: any;
  let authToken = '';

  beforeAll(async () => {
    const profilesRes = await request(app).get('/api/auth/profiles');
    expect(profilesRes.status).toBe(200);
    const sarah = profilesRes.body.find((p: any) => p.name === 'Dr. Sarah Jenkins');
    expect(sarah).toBeDefined();

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ dentistId: sarah.id, pin: '1234' });
    expect(loginRes.status).toBe(200);
    authToken = loginRes.body.token;
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
  });

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
  });

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
  });
});
