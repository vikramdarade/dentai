import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import dotenv from 'dotenv';

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
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'TEST_API_KEY';
    process.env.NODE_ENV = 'test';
  });

  it('should return 400 Bad Request if intakeData is missing', async () => {
    const res = await request(app)
      .post('/api/generate-notes')
      .send({
        transcript: [{ sender: 'Dentist', text: 'Check tooth 16' }]
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing or invalid');
  });

  it('should return 400 Bad Request if transcript is missing or not an array', async () => {
    const res = await request(app)
      .post('/api/generate-notes')
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
      .send({
        intakeData: { firstName: 'Sarah', lastName: 'Jenkins', dob: '1988-04-12', appointmentType: 'emergency' },
        transcript: [{ sender: 'Dentist', text: largeText }]
      });
    expect(res.status).toBe(413);
  });
});

// Run live integration tests only if a real API key is configured
const hasRealKey = !!realApiKey;

describe.runIf(hasRealKey)('DentAI Server - Live LLM Integration & Accent Resilience Tests', () => {
  let realGoogleGenAIClass: any;

  beforeEach(async () => {
    // Restore the real API key for live integration tests
    process.env.GEMINI_API_KEY = realApiKey;

    // Dynamically load the actual unmocked GoogleGenAI library using importActual
    const actualModule = await vi.importActual<typeof import('@google/genai')>('@google/genai');
    realGoogleGenAIClass = actualModule.GoogleGenAI;

    // Temporarily replace the mocked class for this suite
    vi.mocked(await import('@google/genai')).GoogleGenAI = realGoogleGenAIClass;
  });

  it('Integration Test Case A: should resolve Indian Accent phonetic errors to FDI 33', async () => {
    const res = await request(app)
      .post('/api/generate-notes')
      .send({
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
    const res = await request(app)
      .post('/api/generate-notes')
      .send({
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
    const res = await request(app)
      .post('/api/generate-notes')
      .send({
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

    expect(res.status).toBe(200);
    
    // FDI notation check: 'one six' -> 16
    expect(res.body.toothFindings).toContain('16');
    
    // Mumbled corrections check: 'root can all' -> 'root canal', 'pulp it is' -> 'pulpitis'
    expect(res.body.diagnosis.toLowerCase()).toContain('pulpitis');
    const combinedTreatmentAndRecs = (res.body.treatmentPerformed + ' ' + res.body.recommendations).toLowerCase();
    expect(combinedTreatmentAndRecs).toContain('root canal');
  });
});
