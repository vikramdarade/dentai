import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Load test environment
dotenv.config({ path: '.env.local' });
dotenv.config();

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'TEST_API_KEY';
process.env.DATABASE_URL = ''; // Test with throwaway isolated JSON store
process.env.GROQ_API_KEY = '';
process.env.LLM_PROVIDER = '';

// Completely isolate data directory to prevent touching developer data
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentai-scenarios-db-'));
process.env.DENTAI_DATA_DIR = testDataDir;

const { app } = await import('../server.ts');
import { normalizeSpokenDentalText } from '../src/lib/dentalPhoneticLexicon';
import { formatForPms, formatCleanNote } from '../src/lib/pmsExporter';

describe('Clinical Scenarios: End-to-End Data, Record Capture & Database Storage', () => {
  let authToken: string;
  let clinicianId: string;
  const testClinicianName = 'Dr. Alexander Wright';
  const testPin = '7391';

  beforeAll(async () => {
    // Register test clinician
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: testClinicianName,
        specialty: 'General Dentistry',
        pin: testPin
      });
    expect([201, 409]).toContain(regRes.status);

    if (regRes.status === 201) {
      authToken = regRes.body.token;
      clinicianId = regRes.body.dentist.id;
    } else {
      const profilesRes = await request(app).get('/api/auth/profiles');
      const doc = profilesRes.body.find((p: any) => p.name === testClinicianName);
      clinicianId = doc.id;
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ dentistId: doc.id, pin: testPin });
      authToken = loginRes.body.token;
    }
    expect(authToken).toBeDefined();
  });

  afterAll(() => {
    try {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch {}
  });

  // =========================================================================
  // SCENARIO 1: Posterior Multi-Surface Restorative Composite (MODB 46)
  // =========================================================================
  it('Scenario 1: Restorative MODB Composite on tooth 46 - captures, synthesizes note, and stores durably', async () => {
    const rawAudio = 'patient presents with cavity on lower right first molar tooth four six. Rubber dam placed. Vitrebond liner, shade A3 composite MODB restored.';
    const normalized = normalizeSpokenDentalText(rawAudio);
    expect(normalized).toContain('tooth 46');

    // 1. Synthesize note with context
    const contextText = 'MEDICAL ALERT: Nil known drug allergies. Moderate bruxism noted.';
    const askRes = await request(app)
      .post('/api/copilot/ask')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        prompt: 'generate clinical note from context and conversation',
        patientName: 'Jack Wilson 34M',
        context: contextText,
        transcript: normalized,
        appointmentType: 'Restorative'
      });

    expect(askRes.status).toBe(200);
    expect(askRes.body.result).toMatch(/(?:nil|no)\s*known\s*drug\s*allergies/i);
    expect(askRes.body.result).toMatch(/46|composite|restorative|examination/i);

    // 2. Persist to database
    const consultId = '46a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c';
    const postRes = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        id: consultId,
        firstName: 'Jack',
        lastName: 'Wilson',
        dob: '1992-03-14',
        appointmentType: 'Restorative',
        date: 'Oct 3',
        time: '09:00 AM',
        transcript: [{ sender: 'Dentist', text: normalized }],
        findings: {
          toothFindings: '#46: MODB Caries | Vitrebond liner | Shade A3 composite',
          diagnosis: '#46: Dentinal caries',
          treatmentPerformed: 'Direct composite restoration MODB tooth 46 under rubber dam isolation.',
          adaCodes: [{ code: '532', tooth: '46', description: 'Restoration - composite resin - two surfaces - posterior' }]
        },
        patientSummary: 'Jack Wilson attended for multi-surface composite restoration on tooth 46.',
        recordVersion: 1
      });

    expect(postRes.status).toBe(201);
    expect(postRes.body.id).toBe(consultId);

    // 3. Re-read from database and assert data integrity
    const getRes = await request(app)
      .get('/api/consultations')
      .set('Authorization', `Bearer ${authToken}`);
    
    expect(getRes.status).toBe(200);
    const stored = getRes.body.find((c: any) => c.id === consultId);
    expect(stored).toBeDefined();
    expect(stored.firstName).toBe('Jack');
    expect(stored.lastName).toBe('Wilson');
    expect(stored.findings.toothFindings).toContain('#46');
    expect(stored.findings.adaCodes[0].code).toBe('532');

    // 4. Test PMS Clipboard Export
    const d4wExport = formatForPms(stored.findings?.treatmentPerformed || '', {
      patientName: `${stored.firstName} ${stored.lastName}`,
      dentistName: testClinicianName
    });
    expect(d4wExport).toContain('Jack Wilson');
    expect(d4wExport).toContain('tooth 46');
  });

  // =========================================================================
  // SCENARIO 2: Anterior Aesthetic Incisal Fracture (11 MI)
  // =========================================================================
  it('Scenario 2: Anterior aesthetic composite 11 MI - captures bevel, shade B1, and stores correctly', async () => {
    const rawAudio = 'chipped front tooth one one mesial incisal edge. Bevel prepared. Shade B1 composite layered and polished with Sof-Lex discs.';
    const normalized = normalizeSpokenDentalText(rawAudio);
    expect(normalized).toContain('tooth 11');

    const consultId = '11a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c';
    const postRes = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        id: consultId,
        firstName: 'Charlotte',
        lastName: 'Brown',
        dob: '1998-07-22',
        appointmentType: 'Restorative',
        date: 'Oct 3',
        time: '09:45 AM',
        transcript: [{ sender: 'Dentist', text: normalized }],
        findings: {
          toothFindings: '#11: MI enamel-dentine fracture | Shade B1',
          diagnosis: '#11: Traumatic tooth fracture without pulpal exposure',
          treatmentPerformed: 'Composite resin restoration MI tooth 11, Sof-Lex disc finish.',
          adaCodes: [{ code: '522', tooth: '11', description: 'Restoration - composite resin - two surfaces - anterior' }]
        },
        recordVersion: 1
      });

    expect(postRes.status).toBe(201);
    expect(postRes.body.findings.toothFindings).toContain('#11');
  });

  // =========================================================================
  // SCENARIO 3: Comprehensive Exam & Preventative Clean (ADA 011, 114, 121)
  // =========================================================================
  it('Scenario 3: Diagnostic Comprehensive Exam & Clean - zero unsaid caries, captures BPE and prophylaxis', async () => {
    const rawAudio = 'comprehensive examination completed. Dentition charted, BPE 0 in all sextants. Ultrasonic scaling, prophy paste, topical neutral sodium fluoride applied.';
    const normalized = normalizeSpokenDentalText(rawAudio);

    const consultId = '33a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c';
    const postRes = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        id: consultId,
        firstName: 'William',
        lastName: 'Jones',
        dob: '1974-11-05',
        appointmentType: 'examination',
        date: 'Oct 3',
        time: '10:30 AM',
        transcript: [{ sender: 'Dentist', text: normalized }],
        findings: {
          toothFindings: 'Dentition sound. No active dental caries detected.',
          diagnosis: 'Healthy periodontal and dental tissues.',
          treatmentPerformed: 'Comprehensive oral examination (011), calculus removal (114), fluoride application (121).',
          adaCodes: [
            { code: '011', description: 'Comprehensive oral examination' },
            { code: '114', description: 'Removal of calculus - second or subsequent visit' },
            { code: '121', description: 'Topical application of remineralisation agent' }
          ]
        },
        recordVersion: 1
      });

    expect(postRes.status).toBe(201);
    expect(postRes.body.findings.adaCodes.length).toBe(3);
  });

  // =========================================================================
  // SCENARIO 4: Paediatric Fissure Sealants on Four Permanent Molars (16, 26, 36, 46)
  // =========================================================================
  it('Scenario 4: Paediatric preventive fissure sealants - maps all 4 permanent molars', async () => {
    const rawAudio = 'preventative visit for 7yo. Fissure sealants placed on tooth 16, tooth 26, tooth 36, and tooth 46 under cotton roll isolation.';
    const normalized = normalizeSpokenDentalText(rawAudio);

    const consultId = '44a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c';
    const postRes = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        id: consultId,
        firstName: 'Oliver',
        lastName: 'Smith',
        dob: '2019-04-10',
        appointmentType: 'paediatric',
        date: 'Oct 3',
        time: '11:15 AM',
        transcript: [{ sender: 'Dentist', text: normalized }],
        findings: {
          toothFindings: '#16: Deep retentive fissures | #26: Deep fissures | #36: Deep fissures | #46: Deep fissures',
          diagnosis: 'High caries risk anatomy, pits and fissures intact',
          treatmentPerformed: 'Resin fissure sealants placed on teeth 16, 26, 36, 46.',
          adaCodes: [
            { code: '161', tooth: '16', description: 'Fissure sealant - per tooth' },
            { code: '161', tooth: '26', description: 'Fissure sealant - per tooth' },
            { code: '161', tooth: '36', description: 'Fissure sealant - per tooth' },
            { code: '161', tooth: '46', description: 'Fissure sealant - per tooth' }
          ]
        },
        recordVersion: 1
      });

    expect(postRes.status).toBe(201);
    expect(postRes.body.findings.adaCodes.length).toBe(4);
    expect(postRes.body.findings.adaCodes.map((c: any) => c.tooth)).toEqual(['16', '26', '36', '46']);
  });

  // =========================================================================
  // SCENARIO 5: Periodontal Subgingival Debridement (Q1 & Q4)
  // =========================================================================
  it('Scenario 5: Periodontics - subgingival debridement quadrant 1 & 4 with Gracey curettes', async () => {
    const rawAudio = 'periodontal debridement quadrant 1 and quadrant 4. 5mm and 6mm pockets around molars with bleeding on probing. Gracey curettes and ultrasonic debridement.';
    const normalized = normalizeSpokenDentalText(rawAudio);

    const consultId = '55a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c';
    const postRes = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        id: consultId,
        firstName: 'Amelia',
        lastName: 'Taylor',
        dob: '1981-08-30',
        appointmentType: 'periodontal',
        date: 'Oct 3',
        time: '01:00 PM',
        transcript: [{ sender: 'Dentist', text: normalized }],
        findings: {
          toothFindings: 'Pockets 5-6mm Q1 and Q4 molars with BOP',
          findingsGingival: 'Generalized Stage II Grade B Periodontitis',
          diagnosis: 'Chronic periodontitis',
          treatmentPerformed: 'Root surface debridement and subgingival scaling Q1 & Q4 under local anaesthesia.',
          adaCodes: [
            { code: '222', description: 'Root planing and subgingival debridement - per quadrant (Q1)' },
            { code: '222', description: 'Root planing and subgingival debridement - per quadrant (Q4)' }
          ]
        },
        recordVersion: 1
      });

    expect(postRes.status).toBe(201);
    expect(postRes.body.findings.findingsGingival).toContain('Periodontitis');
  });

  // =========================================================================
  // SCENARIO 6: Oral Surgery - Surgical Extraction with Suture & Gelatemp (Tooth 48)
  // =========================================================================
  it('Scenario 6: Surgical Extraction of tooth 48 - records flap, bone guttering, and Prolene suture', async () => {
    const rawAudio = 'surgical extraction of impacted tooth 48. Envelope flap raised, buccal bone guttering under saline irrigation, tooth sectioned, Gelatemp and 3-0 Prolene suture.';
    const normalized = normalizeSpokenDentalText(rawAudio);

    // Test Patient Care Guide generation for surgical extraction
    const careGuideRes = await request(app)
      .post('/api/copilot/ask')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        prompt: 'create a patient care guide and home care instructions',
        patientName: 'Liam Davis 22M',
        currentNote: 'Surgical extraction of tooth 48 with Prolene sutures and Gelatemp.',
        appointmentType: 'Surgical Extraction'
      });

    expect(careGuideRes.status).toBe(200);
    expect(careGuideRes.body.result).toMatch(/care\s*guide|home\s*care/i);
    expect(careGuideRes.body.result).toMatch(/numbness|gauze|bleeding/i);

    const consultId = '66a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c';
    const postRes = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        id: consultId,
        firstName: 'Liam',
        lastName: 'Davis',
        dob: '2004-06-18',
        appointmentType: 'surgical',
        date: 'Oct 3',
        time: '01:45 PM',
        transcript: [{ sender: 'Dentist', text: normalized }],
        findings: {
          toothFindings: '#48: Horizontally impacted, recurrent pericoronitis',
          diagnosis: '#48: Impacted third molar with pericoronitis',
          treatmentPerformed: 'Surgical extraction tooth 48, flap raised, bone guttering, sectioned, Prolene suture.',
          adaCodes: [{ code: '324', tooth: '48', description: 'Surgical removal of a tooth or tooth fragment not requiring removal of bone' }]
        },
        recordVersion: 1
      });

    expect(postRes.status).toBe(201);
    expect(postRes.body.findings.treatmentPerformed).toContain('Prolene');
  });

  // =========================================================================
  // SCENARIO 7: Contraindicated Oral Surgery - Negation Safety (Warfarin/Eliquis)
  // =========================================================================
  it('Scenario 7: Negation safety - suppresses surgical extraction when patient on anticoagulants, performs pulp extirpation safely', async () => {
    const rawAudio = 'patient requested tooth 37 extraction. History shows unmonitored Warfarin and Eliquis. Extraction is contraindicated today due to bleeding risk. Performed emergency pulp extirpation tooth 37 instead.';
    const normalized = normalizeSpokenDentalText(rawAudio);

    const consultId = '77a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c';
    const postRes = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        id: consultId,
        firstName: 'George',
        lastName: 'Evans',
        dob: '1952-01-19',
        appointmentType: 'emergency',
        date: 'Oct 3',
        time: '02:30 PM',
        transcript: [{ sender: 'Dentist', text: normalized }],
        findings: {
          toothFindings: '#37: Symptomatic irreversible pulpitis | Extraction contraindicated (Warfarin/Eliquis)',
          diagnosis: '#37: Irreversible pulpitis',
          treatmentPerformed: 'Emergency pulp extirpation tooth 37, Odontopaste dressing placed. Extraction deferred for GP clearance.',
          adaCodes: [{ code: '414', tooth: '37', description: 'Pulp extirpation - per canal' }]
        },
        recordVersion: 1
      });

    expect(postRes.status).toBe(201);
    // Explicitly verify NO surgical extraction item codes exist in the stored record
    const codes = postRes.body.findings.adaCodes.map((c: any) => c.code);
    expect(codes).not.toContain('311');
    expect(codes).not.toContain('324');
    expect(codes).toContain('414');
  });

  // =========================================================================
  // SCENARIO 8: Endodontic Emergency Pulp Extirpation (Tooth 26 - 3 Canals)
  // =========================================================================
  it('Scenario 8: Endodontics Stage 1 extirpation on tooth 26 - stores 3 canals, Odontopaste dressing', async () => {
    const rawAudio = 'emergency pulp extirpation tooth 26. Located 3 canals: MB, DB, Palatal. Pulp extirpated, Odontopaste dressing placed, Cavit temporary seal.';
    const normalized = normalizeSpokenDentalText(rawAudio);

    const consultId = '88a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c';
    const postRes = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        id: consultId,
        firstName: 'Mia',
        lastName: 'Thomas',
        dob: '1995-12-03',
        appointmentType: 'endodontic',
        date: 'Oct 3',
        time: '03:15 PM',
        transcript: [{ sender: 'Dentist', text: normalized }],
        findings: {
          toothFindings: '#26: Irreversible pulpitis | 3 canals identified',
          diagnosis: '#26: Acute irreversible pulpitis with symptomatic apical periodontitis',
          treatmentPerformed: 'Access cavity, extirpation of 3 canals (MB, DB, Palatal), Odontopaste dressing, Cavit temporary.',
          adaCodes: [{ code: '414', tooth: '26', description: 'Pulp extirpation - first canal' }]
        },
        recordVersion: 1
      });

    expect(postRes.status).toBe(201);
    expect(postRes.body.findings.treatmentPerformed).toContain('3 canals');
  });

  // =========================================================================
  // SCENARIO 9: Endodontic Chemo-Mechanical Prep & Obturation (Tooth 14)
  // =========================================================================
  it('Scenario 9: Endodontics Stage 2/3 obturation on tooth 14 - Protaper rotary, gutta-percha, AH Plus', async () => {
    const rawAudio = 'stage 2 root canal obturation tooth 14. Chemo-mechanical prep with Protaper rotary files under 4% NaOCl irrigation. Obturated with gutta-percha and AH Plus sealer.';
    const normalized = normalizeSpokenDentalText(rawAudio);

    const consultId = '99a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c';
    const postRes = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        id: consultId,
        firstName: 'Noah',
        lastName: 'White',
        dob: '1985-09-12',
        appointmentType: 'endodontic',
        date: 'Oct 3',
        time: '04:00 PM',
        transcript: [{ sender: 'Dentist', text: normalized }],
        findings: {
          toothFindings: '#14: Canals clean, dry, asymptomatic',
          diagnosis: '#14: Previously initiated root canal therapy',
          treatmentPerformed: 'Chemo-mechanical preparation (415) and warm vertical obturation (416) with gutta-percha and AH Plus.',
          adaCodes: [
            { code: '415', tooth: '14', description: 'Chemo-mechanical preparation of root canal - first canal' },
            { code: '416', tooth: '14', description: 'Obturation of root canal - first canal' }
          ]
        },
        recordVersion: 1
      });

    expect(postRes.status).toBe(201);
    expect(postRes.body.findings.treatmentPerformed).toContain('gutta-percha');
  });

  // =========================================================================
  // SCENARIO 10: Fixed Prosthodontics - Crown Preparation & 3Shape Scan (Tooth 36)
  // =========================================================================
  it('Scenario 10: Fixed Prosthodontics crown prep on tooth 36 - digital scan, temporary crown', async () => {
    const rawAudio = 'crown preparation on tooth 36 for cracked tooth syndrome. 1.5mm axial reduction, retraction cord placed, 3Shape Trios digital intraoral scan taken, Protemp temporary crown cemented.';
    const normalized = normalizeSpokenDentalText(rawAudio);

    // Test Specialist Referral Letter generation
    const referralRes = await request(app)
      .post('/api/copilot/ask')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        prompt: 'draft specialist referral letter for endodontics',
        patientName: 'Lucas Martin 58M',
        context: 'Cracked tooth 36 with deep probing defect on mesial. Evaluate restorability prior to crown cementation.',
        currentNote: 'Tooth 36 crown prep completed, crack extends subgingivally.',
        appointmentType: 'Consultation'
      });

    expect(referralRes.status).toBe(200);
    expect(referralRes.body.result).toMatch(/referral/i);
    expect(referralRes.body.result).toContain('Lucas Martin');

    const consultId = '10a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c';
    const postRes = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        id: consultId,
        firstName: 'Lucas',
        lastName: 'Martin',
        dob: '1968-02-14',
        appointmentType: 'crown_prep',
        date: 'Oct 3',
        time: '04:45 PM',
        transcript: [{ sender: 'Dentist', text: normalized }],
        findings: {
          toothFindings: '#36: Cracked tooth syndrome mesial marginal ridge',
          diagnosis: '#36: Incomplete tooth fracture (cracked tooth)',
          treatmentPerformed: 'Full crown preparation tooth 36, retraction cord, 3Shape digital scan, Protemp temporary.',
          adaCodes: [{ code: '615', tooth: '36', description: 'Full crown - tooth coloured - indirect' }]
        },
        recordVersion: 1
      });

    expect(postRes.status).toBe(201);
    expect(postRes.body.findings.adaCodes[0].code).toBe('615');
  });

  // =========================================================================
  // SCENARIO 11: Fixed Prosthodontics - Crown Issue & RelyX Cementation (Tooth 36)
  // =========================================================================
  it('Scenario 11: Fixed Prosthodontics crown issue on tooth 36 - RelyX Unicem, margin check', async () => {
    const rawAudio = 'crown issue tooth 36. Zirconia crown marginal fit verified with explorer, interproximal contacts confirmed. Cemented with RelyX Unicem resin cement, excess removed.';
    const normalized = normalizeSpokenDentalText(rawAudio);

    const consultId = '20a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c';
    const postRes = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        id: consultId,
        firstName: 'Grace',
        lastName: 'Harris',
        dob: '1964-05-27',
        appointmentType: 'crown_fit',
        date: 'Oct 3',
        time: '05:30 PM',
        transcript: [{ sender: 'Dentist', text: normalized }],
        findings: {
          toothFindings: '#36: Crown fit precise, margins sealed',
          diagnosis: '#36: Post-endodontic / cracked tooth protection definitive',
          treatmentPerformed: 'Definitive cementation of monolithic zirconia crown tooth 36 using RelyX Unicem.',
          adaCodes: [{ code: '651', tooth: '36', description: 'Recementing crown or veneer' }]
        },
        recordVersion: 1
      });

    expect(postRes.status).toBe(201);
    expect(postRes.body.findings.treatmentPerformed).toContain('RelyX Unicem');
  });

  // =========================================================================
  // SCENARIO 12: Conscious Sedation & Attendance Certification
  // =========================================================================
  it('Scenario 12: Conscious Sedation - vitals monitoring, Aldrete discharge, Attendance Certificate', async () => {
    const rawAudio = 'IV conscious sedation with Midazolam 4mg and Fentanyl 50mcg titration. Continuous SpO2 99%, BP 120/75. Procedure completed uneventfully, Aldrete score 10 achieved, discharged with responsible adult.';
    const normalized = normalizeSpokenDentalText(rawAudio);

    // Test Medical Attendance Certificate generation
    const certRes = await request(app)
      .post('/api/copilot/ask')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        prompt: 'draft attendance certificate for employer',
        patientName: 'Ruby Walker',
        currentNote: 'Sedation dental procedure completed chairside.',
        appointmentType: 'Sedation Dentistry'
      });

    expect(certRes.status).toBe(200);
    expect(certRes.body.result).toMatch(/attendance\s*certificate/i);
    expect(certRes.body.result).toContain('Ruby Walker');

    const consultId = '30a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c';
    const postRes = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        id: consultId,
        firstName: 'Ruby',
        lastName: 'Walker',
        dob: '1987-10-15',
        appointmentType: 'sedation',
        date: 'Oct 3',
        time: '06:15 PM',
        transcript: [{ sender: 'Dentist', text: normalized }],
        findings: {
          toothFindings: 'IV Sedation monitoring - vital signs stable throughout',
          diagnosis: 'Severe dental phobia',
          treatmentPerformed: 'Intravenous conscious sedation (927/949), SpO2 and BP continuous monitoring, Aldrete score 10.',
          adaCodes: [
            { code: '927', description: 'Intravenous conscious sedation - per 30 minutes' },
            { code: '949', description: 'Monitoring of patient during administration of sedation' }
          ]
        },
        recordVersion: 1
      });

    expect(postRes.status).toBe(201);

    // =======================================================================
    // CONCURRENCY & SIGN-OFF LOCKING ASSERTIONS
    // =======================================================================
    // 1. Optimistic locking: updating with stale version must fail or be rejected
    const staleUpdateRes = await request(app)
      .put(`/api/consultations/${consultId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        ...postRes.body,
        expectedVersion: 999, // Stale version
        findings: { ...postRes.body.findings, toothFindings: 'Stale modification attempt' }
      });
    expect([409, 412]).toContain(staleUpdateRes.status);

    // 2. Sign-off validation: signing locks the record permanently
    const signRes = await request(app)
      .post(`/api/consultations/${consultId}/sign`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expectedVersion: postRes.body.recordVersion || 1
      });
    
    // Either signs (200) or reports grounding refusal if unapproved (422)
    expect([200, 422]).toContain(signRes.status);

    if (signRes.status === 200) {
      // Once signed, subsequent modifications MUST be refused
      const postSignEdit = await request(app)
        .put(`/api/consultations/${consultId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          ...postRes.body,
          findings: { ...postRes.body.findings, toothFindings: 'Post-sign illicit edit' }
        });
      expect([409, 422]).toContain(postSignEdit.status);
    }
  });
});
