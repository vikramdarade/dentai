import { test, expect } from '@playwright/test';

test.describe('DentAI Backend API Test Suite', () => {
  let authToken: string;
  let dentistId: string;

  test('GET /api/health - Production Health Check', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('healthy');
    expect(body.ok).toBe(true);
    expect(body.version).toBeDefined();
    expect(typeof body.uptimeSeconds).toBe('number');
  });

  test('GET /api/speech/status - Google Cloud Speech Streaming Status', async ({ request }) => {
    const res = await request.get('/api/speech/status');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.model).toContain('Chirp 2');
    expect(body.status).toBeDefined();
    expect(body.gcpStatus).toBeDefined();
    expect(typeof body.gcpStatus.ok).toBe('boolean');
  });

  test('GET /api/auth/profiles - List Practitioner Profiles', async ({ request }) => {
    const res = await request.get('/api/auth/profiles');
    expect(res.status()).toBe(200);
    const profiles = await res.json();
    expect(Array.isArray(profiles)).toBe(true);
    expect(profiles.length).toBeGreaterThan(0);
    
    // Check required profile fields
    const first = profiles[0];
    expect(first.id).toBeDefined();
    expect(first.name).toBeDefined();
    expect(first.specialty).toBeDefined();
    dentistId = first.id;
  });

  test('POST /api/auth/login - Universal PIN 1234 Sign-In', async ({ request }) => {
    // Ensure we have a valid dentistId
    if (!dentistId) {
      const pRes = await request.get('/api/auth/profiles');
      const profiles = await pRes.json();
      dentistId = profiles[0].id;
    }

    const res = await request.post('/api/auth/login', {
      data: {
        dentistId,
        pin: '1234'
      }
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.token).toBeDefined();
    expect(body.dentist).toBeDefined();
    expect(body.dentist.id).toBe(dentistId);
    authToken = body.token;
  });

  test('GET /api/auth/me - Authenticated Token Verification', async ({ request }) => {
    expect(authToken).toBeDefined();
    const res = await request.get('/api/auth/me', {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.dentistId).toBe(dentistId);
    expect(body.name).toBeDefined();
  });

  test('GET /api/usage/today - Clinic AI Usage Meter', async ({ request }) => {
    const res = await request.get('/api/usage/today', {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.used).toBe('number');
    expect(typeof body.limit).toBe('number');
    expect(typeof body.exceeded).toBe('boolean');
  });

  test('GET /api/consultations - List Stored Consultations', async ({ request }) => {
    const res = await request.get('/api/consultations', {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    expect(res.status()).toBe(200);
    const consultations = await res.json();
    expect(Array.isArray(consultations)).toBe(true);
  });

  test('POST /api/schedule/parse-image - Validates Missing Image Input', async ({ request }) => {
    const res = await request.post('/api/schedule/parse-image', {
      headers: {
        'Authorization': `Bearer ${authToken}`
      },
      data: {}
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('imageBase64 is required');
  });

  test('GET /api/telemetry - Latency & Request Telemetry', async ({ request }) => {
    const res = await request.get('/api/telemetry');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  test('GET /api/clinics/mine - Clinic Memberships List', async ({ request }) => {
    const res = await request.get('/api/clinics/mine', {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    expect(res.status()).toBe(200);
    const clinics = await res.json();
    expect(Array.isArray(clinics)).toBe(true);
  });

  test('GET /api/pipeline - Treatment Pipeline Opportunities', async ({ request }) => {
    const res = await request.get('/api/pipeline', {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
    expect(Array.isArray(body.opportunities || body)).toBe(true);
  });

  test('GET /api/pipeline/roi - Practice ROI Metrics & Closed-Loop Multiplier', async ({ request }) => {
    const res = await request.get('/api/pipeline/roi', {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
    expect(typeof body.netRoiMultiple).toBe('number');
  });

  test('POST /api/beacon/chair/create & GET status - Operatory Phone Beacon Link Status', async ({ request }) => {
    // 1. Create a chair session
    const createRes = await request.post('/api/beacon/chair/create', {
      data: { roomName: 'Surgery Chair 1', dentistName: 'Dr. Sarah Jenkins' }
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    expect(created.chairId).toBeDefined();
    expect(created.pinCode).toBeDefined();

    // 2. Poll chair status
    const statusRes = await request.get(`/api/beacon/chair/${created.chairId}/status`);
    expect(statusRes.status()).toBe(200);
    const statusBody = await statusRes.json();
    expect(statusBody.chairId).toBe(created.chairId);
    expect(statusBody.roomName).toBe('Surgery Chair 1');
    expect(statusBody.status).toBe('waiting');
  });
});
