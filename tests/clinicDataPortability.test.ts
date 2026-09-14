import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';

describe('Slice 5A: 1-Click Clinic Data Portability & Diligence Escrow Export', () => {
  let app: any;
  let generateToken: any;
  let clinic1AuthHeader: { Authorization: string };
  let clinic2AuthHeader: { Authorization: string };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = '';

    const serverModule = await import('../server.ts');
    app = serverModule.app;
    generateToken = serverModule.generateToken;

    // Clinician 1 in clinic-melbourne-cbd
    const token1 = generateToken({
      dentistId: '5a002da7-d8e6-4d5c-8566-000d534e2a32',
      name: 'Dr. Vikram Darade',
      specialty: 'General Dentist',
      clinicId: 'clinic-melbourne-cbd'
    });
    clinic1AuthHeader = { Authorization: `Bearer ${token1}` };

    // Clinician 2 in clinic-sydney-darlinghurst
    const token2 = generateToken({
      dentistId: 'ea8e5a3a-d788-45d9-b44b-63faa8db43b3',
      name: 'Dr. Vik Sydney',
      specialty: 'Orthodontist',
      clinicId: 'clinic-sydney-darlinghurst'
    });
    clinic2AuthHeader = { Authorization: `Bearer ${token2}` };
  });

  it('1. Rejects unauthenticated export request with HTTP 401', async () => {
    const res = await request(app).get('/api/clinic/export');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/token/i);
  });

  it('2. Exports structured clinic archive with AHPRA compliance metadata and attachment headers', async () => {
    const res = await request(app)
      .get('/api/clinic/export')
      .set(clinic1AuthHeader);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toContain('attachment; filename="dentai-escrow-export-clinic-melbourne-cbd-');

    expect(res.body.manifestVersion).toBe('2.0.0-escrow');
    expect(res.body.complianceStandard).toContain('AHPRA');
    expect(res.body.complianceStandard).toContain('Privacy Act 1988');
    expect(res.body.clinicId).toBe('clinic-melbourne-cbd');
    expect(res.body.exportingDentist.id).toBe('5a002da7-d8e6-4d5c-8566-000d534e2a32');
    expect(res.body.summary).toBeDefined();
    expect(res.body.summary.hashAlgorithm).toBe('SHA-256');
    expect(res.body.summary.dataIntegrityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Array.isArray(res.body.encounters)).toBe(true);
    expect(Array.isArray(res.body.members)).toBe(true);
  });

  it('3. Verifies cryptographic SHA-256 data integrity checksum on encounters', async () => {
    const res = await request(app)
      .get('/api/clinic/export')
      .set(clinic1AuthHeader);

    expect(res.status).toBe(200);

    const recomputedPayload = JSON.stringify({
      clinicId: res.body.clinicId,
      exportedAt: res.body.exportedAt,
      encounterCount: res.body.encounters.length,
      encounters: res.body.encounters
    });

    const expectedHash = crypto.createHash('sha256').update(recomputedPayload).digest('hex');
    expect(res.body.summary.dataIntegrityHash).toBe(expectedHash);
  });

  it('4. Enforces multi-tenant isolation: Clinic 1 archive never leaks Clinic 2 records', async () => {
    const res1 = await request(app)
      .get('/api/clinic/export')
      .set(clinic1AuthHeader);

    const res2 = await request(app)
      .get('/api/clinic/export')
      .set(clinic2AuthHeader);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    expect(res1.body.clinicId).toBe('clinic-melbourne-cbd');
    expect(res2.body.clinicId).toBe('clinic-sydney-darlinghurst');

    // Cross-tenant data inspection: Encounters in Clinic 1 must not belong to Clinic 2
    for (const enc of res1.body.encounters) {
      expect(enc.clinicId).not.toBe('clinic-sydney-darlinghurst');
    }

    for (const enc of res2.body.encounters) {
      expect(enc.clinicId).not.toBe('clinic-melbourne-cbd');
    }
  });
});
