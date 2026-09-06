import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import {
  ADA_FEE_CATALOG,
  lookupAdaFee,
  extractProposedTreatmentsFromFindings
} from '../src/lib/adaFees';

// Set test environment before importing server
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'TEST_API_KEY';
process.env.DATABASE_URL = '';

const { app, invalidateDbCache } = await import('../server.ts');

const dbPath = path.join(__dirname, '..', 'data', 'consultations.json');
const usersDbPath = path.join(__dirname, '..', 'data', 'users.json');
const clinicsDbPath = path.join(__dirname, '..', 'data', 'clinics.json');
const auditDbPath = path.join(__dirname, '..', 'data', 'audit.json');

describe('Treatment Revenue Moat & ADA Valuation Engine', () => {
  let authToken = '';
  let dentistId = '';
  let dbBackup: string | null = null;
  let usersDbBackup: string | null = null;
  let clinicsDbBackup: string | null = null;
  let auditDbBackup: string | null = null;

  beforeAll(async () => {
    if (fs.existsSync(dbPath)) dbBackup = fs.readFileSync(dbPath, 'utf-8');
    if (fs.existsSync(usersDbPath)) usersDbBackup = fs.readFileSync(usersDbPath, 'utf-8');
    if (fs.existsSync(clinicsDbPath)) clinicsDbBackup = fs.readFileSync(clinicsDbPath, 'utf-8');
    if (fs.existsSync(auditDbPath)) auditDbBackup = fs.readFileSync(auditDbPath, 'utf-8');

    // Register a test dentist
    const testName = `Dr. Revenue Test ${Math.random().toString(36).substring(7)}`;
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ name: testName, specialty: 'General Dentistry', pin: '4444' });

    expect(regRes.status).toBe(201);
    authToken = regRes.body.token;
    dentistId = regRes.body.dentist.id;
  });

  afterAll(() => {
    if (dbBackup !== null) fs.writeFileSync(dbPath, dbBackup);
    if (usersDbBackup !== null) fs.writeFileSync(usersDbPath, usersDbBackup);
    if (clinicsDbBackup !== null) {
      fs.writeFileSync(clinicsDbPath, clinicsDbBackup);
    } else if (fs.existsSync(clinicsDbPath)) {
      fs.unlinkSync(clinicsDbPath);
    }
    if (auditDbBackup !== null) fs.writeFileSync(auditDbPath, auditDbBackup);
    invalidateDbCache();
  });

  // -------------------------------------------------------------------------
  // Unit Tests: ADA Fee Catalog & Heuristics
  // -------------------------------------------------------------------------
  describe('ADA Fee Valuation Catalog', () => {
    it('correctly maps standard Australian Dental Association item codes to benchmark fees', () => {
      const crown = lookupAdaFee('611');
      expect(crown.code).toBe('611');
      expect(crown.name).toContain('Full Crown');
      expect(crown.standardFee).toBe(1650);

      const filling = lookupAdaFee('532');
      expect(filling.code).toBe('532');
      expect(filling.name).toContain('Posterior Resin Composite');
      expect(filling.standardFee).toBe(295);

      const perio = lookupAdaFee('222');
      expect(perio.code).toBe('222');
      expect(perio.standardFee).toBe(340);

      const exam = lookupAdaFee('011');
      expect(exam.code).toBe('011');
      expect(exam.standardFee).toBe(75);
    });

    it('gracefully handles missing codes with intelligent procedure heuristics', () => {
      const unknownCrown = lookupAdaFee('999', 'Ceramic crown on molar');
      expect(unknownCrown.standardFee).toBe(1650);

      const unknownRootCanal = lookupAdaFee('888', 'Root canal therapy');
      expect(unknownRootCanal.standardFee).toBe(860);

      const unknownGeneric = lookupAdaFee('000');
      expect(unknownGeneric.standardFee).toBe(250);
    });
  });

  // -------------------------------------------------------------------------
  // Unit Tests: Treatment Opportunity Extraction
  // -------------------------------------------------------------------------
  describe('extractProposedTreatmentsFromFindings', () => {
    it('extracts crown and restoration opportunities from clinical recommendations', () => {
      const findings = {
        chiefComplaint: 'Tenderness on biting lower left',
        toothFindings: 'Tooth 16 exhibits hairline crack under large amalgam. Early enamel caries on tooth 46.',
        diagnosis: 'Cracked tooth syndrome 16, incipient caries 46',
        treatmentPerformed: 'Comprehensive oral examination (item 011), bitewings (item 026)',
        recommendations: 'Recommend full ceramic crown on tooth 16 to protect against fracture. Plan composite filling on tooth 46.',
        recallRequirements: '6 Months (Standard)'
      };

      const extracted = extractProposedTreatmentsFromFindings({
        findings,
        patientName: 'Priya Sharma',
        dentistId: 'test-doc',
        consultationId: 'consult-101'
      });

      expect(extracted.length).toBeGreaterThanOrEqual(2);

      // Check Tooth 16 Crown
      const crownOpp = extracted.find(e => e.tooth === '16' || e.adaCode === '611');
      expect(crownOpp).toBeDefined();
      expect(crownOpp?.adaCode).toBe('611');
      expect(crownOpp?.estimatedFee).toBe(1650);
      expect(crownOpp?.status).toBe('unscheduled');

      // Check Tooth 46 Composite
      const fillingOpp = extracted.find(e => e.tooth === '46' || e.adaCode === '532');
      expect(fillingOpp).toBeDefined();
      expect(fillingOpp?.estimatedFee).toBe(295);
      expect(fillingOpp?.status).toBe('unscheduled');
    });

    it('does not re-extract treatments that were already performed during the visit', () => {
      const findings = {
        chiefComplaint: 'Filling broke yesterday',
        toothFindings: 'Tooth 24 fractured cusp',
        diagnosis: 'Defective restoration 24',
        treatmentPerformed: 'Composite restoration on tooth 24 completed today with shade A2.',
        recommendations: 'Routine hygiene recall.',
        recallRequirements: '6 Months (Standard)'
      };

      const extracted = extractProposedTreatmentsFromFindings({
        findings,
        patientName: 'David Lee',
        dentistId: 'test-doc',
        consultationId: 'consult-102'
      });

      // Tooth 24 was already treated today, so no unscheduled filling for tooth 24
      const tooth24Opp = extracted.find(e => e.tooth === '24');
      expect(tooth24Opp).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Server Integration Tests: /api/pipeline CRUD & Closed-Loop ROI
  // -------------------------------------------------------------------------
  describe('Server Pipeline Endpoints', () => {
    let createdConsultId = '';
    let targetOppId = '';

    it('automatically extracts and stores treatment opportunities when saving a consultation', async () => {
      const newConsult = {
        firstName: 'John',
        lastName: 'Mitchell',
        dob: '1985-06-15',
        appointmentType: 'emergency',
        date: 'Nov 12',
        time: '10:00 AM',
        status: 'Completed',
        transcript: [{ sender: 'Dentist', text: 'Tooth 16 has a crack and requires a crown.' }],
        findings: {
          chiefComplaint: 'Tooth pain on biting',
          history: 'Good health',
          toothFindings: 'Tooth 16 cracked cusp',
          findingsGingival: 'Normal pockets',
          diagnosis: 'Cracked tooth syndrome 16',
          treatmentPerformed: 'Emergency exam 013',
          recommendations: 'Full ceramic crown recommended on tooth 16.',
          recallRequirements: 'Next Available (Urgent)'
        },
        patientSummary: 'Hi John, tooth 16 has a crack that needs a crown.'
      };

      const postRes = await request(app)
        .post('/api/consultations')
        .set('Authorization', `Bearer ${authToken}`)
        .send(newConsult);

      expect(postRes.status).toBe(201);
      createdConsultId = postRes.body.id;
      expect(postRes.body.findings.proposedTreatments).toBeDefined();
      expect(postRes.body.findings.proposedTreatments.length).toBeGreaterThan(0);

      const opp = postRes.body.findings.proposedTreatments[0];
      targetOppId = opp.id;
      expect(opp.adaCode).toBe('611');
      expect(opp.estimatedFee).toBe(1650);
      expect(opp.status).toBe('unscheduled');
    });

    it('retrieves treatment pipeline via GET /api/pipeline with value aggregations', async () => {
      const res = await request(app)
        .get('/api/pipeline')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.opportunities).toBeDefined();
      expect(res.body.opportunities.length).toBeGreaterThan(0);
      expect(res.body.totalIdentifiedValue).toBeGreaterThanOrEqual(1650);
      expect(res.body.unscheduledValue).toBeGreaterThanOrEqual(1650);

      const found = res.body.opportunities.find((o: any) => o.id === targetOppId);
      expect(found).toBeDefined();
      expect(found.patientName).toContain('John Mitchell');
    });

    it('updates opportunity status via PATCH /api/pipeline/:id to contacted and booked', async () => {
      // 1) Mark Contacted
      const contactedRes = await request(app)
        .patch(`/api/pipeline/${targetOppId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'contacted', notes: 'Sent SMS reminder' });

      expect(contactedRes.status).toBe(200);
      expect(contactedRes.body.opportunity.status).toBe('contacted');
      expect(contactedRes.body.opportunity.lastContactedAt).toBeDefined();

      // 2) Mark Booked (conversion to chair production)
      const bookedRes = await request(app)
        .patch(`/api/pipeline/${targetOppId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'booked' });

      expect(bookedRes.status).toBe(200);
      expect(bookedRes.body.opportunity.status).toBe('booked');
      expect(bookedRes.body.opportunity.bookedAt).toBeDefined();
    });

    it('computes closed-loop owner ROI metrics via GET /api/pipeline/roi', async () => {
      const roiRes = await request(app)
        .get('/api/pipeline/roi')
        .set('Authorization', `Bearer ${authToken}`);

      expect(roiRes.status).toBe(200);
      expect(roiRes.body.totalBookedValue).toBeGreaterThanOrEqual(1650);
      expect(roiRes.body.bookedCount).toBeGreaterThanOrEqual(1);
      expect(roiRes.body.subscriptionCost).toBe(149);

      // Booked production ($1,650) / subscription ($149) = ~11.1x ROI
      expect(roiRes.body.netRoiMultiple).toBeGreaterThanOrEqual(10);
    });

    it('rejects invalid status on PATCH /api/pipeline/:id with 400', async () => {
      const res = await request(app)
        .patch(`/api/pipeline/${targetOppId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'invalid_status' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid status');
    });

    it('returns 404 on PATCH /api/pipeline/:id for non-existent opportunity', async () => {
      const res = await request(app)
        .patch('/api/pipeline/non-existent-opp-id')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'booked' });

      expect(res.status).toBe(404);
    });

    it('surfaces treatment pipeline opportunities for pre-existing consultations without clinicId or pre-computed treatments', async () => {
      // Direct raw insertion simulating a consultation saved prior to this feature
      const legacyConsult = {
        id: 'legacy-prior-feature-1',
        firstName: 'Jessica',
        lastName: 'Taylor',
        dob: '1990-08-15',
        appointmentType: 'emergency',
        date: 'Aug 22',
        time: '10:41 AM',
        status: 'Completed',
        dentistId, // belonging to this dentist, but no clinicId and no proposedTreatments
        findings: {
          chiefComplaint: 'Acute throbbing sensitivity on upper right molar.',
          toothFindings: 'FDI Tooth 16: Pulpitis detected requiring root canal treatment. Tooth 33: Deep carious lesion.',
          diagnosis: 'Symptomatic pulpitis on tooth 16; caries on 33.',
          treatmentPerformed: 'Initial emergency extirpation.',
          recommendations: 'Complete root canal therapy on tooth 16 and composite restoration on tooth 33.'
        }
      };

      const consultationsRaw = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      consultationsRaw.consultations.push(legacyConsult);
      fs.writeFileSync(dbPath, JSON.stringify(consultationsRaw, null, 2));
      invalidateDbCache();

      // Query pipeline as the logged-in dentist
      const res = await request(app)
        .get('/api/pipeline')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      const jessicaOpps = res.body.opportunities.filter((o: any) => o.patientName.includes('Jessica Taylor'));
      expect(jessicaOpps.length).toBeGreaterThan(0);

      // Verify endodontic treatment opportunity was extracted
      const endoOpp = jessicaOpps.find((o: any) => o.adaCode === '417' && o.tooth === '16');
      expect(endoOpp).toBeDefined();
      expect(endoOpp.estimatedFee).toBe(440);
      expect(endoOpp.status).toBe('unscheduled');
    });

    it('updates opportunity status to declined with patient barrier reasons and tracks in metrics', async () => {
      const declineRes = await request(app)
        .patch(`/api/pipeline/${targetOppId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          status: 'declined',
          notes: 'Cost / Insurance Limitation: Patient unable to cover private health gap fee'
        });

      expect(declineRes.status).toBe(200);
      expect(declineRes.body.opportunity.status).toBe('declined');
      expect(declineRes.body.opportunity.patientBarrier).toContain('Cost / Insurance Limitation');

      // Verify pipeline aggregates track declined cases
      const pipeRes = await request(app)
        .get('/api/pipeline')
        .set('Authorization', `Bearer ${authToken}`);

      expect(pipeRes.status).toBe(200);
      expect(pipeRes.body.declinedCount).toBeGreaterThanOrEqual(1);
      expect(pipeRes.body.declinedValue).toBeGreaterThanOrEqual(1650);

      // Verify ROI metrics reflect decline metrics
      const roiRes = await request(app)
        .get('/api/pipeline/roi')
        .set('Authorization', `Bearer ${authToken}`);

      expect(roiRes.status).toBe(200);
      expect(roiRes.body.declinedCount).toBeGreaterThanOrEqual(1);
      expect(roiRes.body.declinedValue).toBeGreaterThanOrEqual(1650);
    });

    it('re-opens a declined opportunity back to unscheduled status', async () => {
      const reopenRes = await request(app)
        .patch(`/api/pipeline/${targetOppId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          status: 'unscheduled',
          notes: 'Re-opened into active pipeline'
        });

      expect(reopenRes.status).toBe(200);
      expect(reopenRes.body.opportunity.status).toBe('unscheduled');

      const pipeRes = await request(app)
        .get('/api/pipeline')
        .set('Authorization', `Bearer ${authToken}`);

      expect(pipeRes.status).toBe(200);
      const reopened = pipeRes.body.opportunities.find((o: any) => o.id === targetOppId);
      expect(reopened).toBeDefined();
      expect(reopened.status).toBe('unscheduled');
    });

    it('supports high-scale query pagination and fast O(1) targeting', async () => {
      // 1. Pagination: request limit of 1
      const pageRes = await request(app)
        .get('/api/pipeline?limit=1&offset=0')
        .set('Authorization', `Bearer ${authToken}`);

      expect(pageRes.status).toBe(200);
      expect(pageRes.body.opportunities.length).toBe(1);
      expect(pageRes.body.totalCount).toBeGreaterThanOrEqual(2);
      expect(pageRes.body.hasMore).toBe(true);

      // 2. Fast direct update using composite consultation-prefixed ID
      const patchRes = await request(app)
        .patch(`/api/pipeline/${targetOppId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'contacted', notes: 'High-speed targeted update' });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.opportunity.status).toBe('contacted');
    });
  });
});
