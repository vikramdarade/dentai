import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * The exact production path of the consent bug, end to end through the real app.
 *
 * On a deployment with `DENTAI_REQUIRE_CONSENT=true`, a chairside transcript
 * could be recorded but never persisted: every save that carried the transcript
 * was refused 400 CONSENT_REQUIRED, queued, and retried forever. The cockpit had
 * no way to produce the canonical consent object the gate wants, and a save of a
 * record that ALREADY held consent was refused for not re-asserting it.
 *
 * This suite drives the flag-on app the way the product does:
 *
 *   1. seat the patient — a shell with no transcript is persisted (audio needs
 *      a consultation to be stored against);
 *   2. save the transcript before consent exists — refused, visibly;
 *   3. record the patient's consent, then save the transcript — accepted;
 *   4. save again without repeating the consent — accepted, because the consent
 *      is already on the record and is append-only.
 *
 * The setting has to be in place before the server module is imported, so this
 * lives in its own file (each test file gets its own module registry).
 */

process.env.NODE_ENV = 'test';
process.env.DENTAI_REQUIRE_CONSENT = 'true';
process.env.DATABASE_URL = '';
process.env.GEMINI_API_KEY = 'TEST_API_KEY';
process.env.GROQ_API_KEY = '';
process.env.GROQ_API_PROD_KEY = '';
process.env.LLM_PROVIDER = '';
process.env.OLLAMA_BASE_URL = '';
process.env.LLAMA_CPP_BASE_URL = '';
process.env.OPENAI_BASE_URL = '';
process.env.DENTAI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dentai-consent-e2e-'));

const { app } = await import('../server.ts');

const transcript = [
  { sender: 'Dentist', text: 'Upper right discomfort, tooth 16 tender to percussion.' },
  { sender: 'Patient', text: 'It started about a week ago and is worse with cold.' },
];

describe('consultation consent, end to end (DENTAI_REQUIRE_CONSENT=true)', () => {
  let token = '';
  const appointmentId = crypto.randomUUID();
  const consent = {
    obtainedAt: '2026-09-30T02:15:00.000Z',
    disclosureVersion: '2026-09-ai-assist-v1',
    recordedBy: 'clinician-e2e',
  };

  beforeAll(async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ name: `Dr. Consent E2E ${Math.random().toString(36).slice(2, 8)}`, specialty: 'Testing', pin: '4815' });
    expect(reg.status).toBe(201);
    token = reg.body.token;
  });

  it('persists a content-free seating shell before any consent exists', async () => {
    const res = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${token}`)
      .send({ id: appointmentId, date: '2026-09-30', time: '2:05 PM', status: 'In Review', transcript: [] });
    expect(res.status).toBe(201);
    // No consent was claimed and none is fabricated.
    expect(res.body.consent?.obtainedAt).toBe('');
  });

  it('refuses a transcript save that carries no consent', async () => {
    const res = await request(app)
      .put(`/api/consultations/${appointmentId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ id: appointmentId, transcript });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CONSENT_REQUIRED');
  });

  it('accepts the transcript once the clinician has recorded consent', async () => {
    const res = await request(app)
      .put(`/api/consultations/${appointmentId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ id: appointmentId, transcript, consent });
    expect(res.status).toBe(200);
    expect(res.body.consent).toMatchObject(consent);

    const list = await request(app).get('/api/consultations').set('Authorization', `Bearer ${token}`);
    const stored = list.body.find((c: any) => c.id === appointmentId);
    expect(stored.transcript).toHaveLength(transcript.length);
  });

  it('accepts a later save without the consent being re-sent (it is on the record)', async () => {
    const res = await request(app)
      .put(`/api/consultations/${appointmentId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        id: appointmentId,
        transcript,
        findings: { chiefComplaint: 'Upper right discomfort', toothFindings: 'Tooth 16 percussion positive' },
      });
    expect(res.status).toBe(200);
    // The recorded consent survives the write that did not repeat it, and is
    // not replaced by anything the request invented.
    expect(res.body.consent).toMatchObject(consent);

    const list = await request(app).get('/api/consultations').set('Authorization', `Bearer ${token}`);
    const stored = list.body.find((c: any) => c.id === appointmentId);
    expect(stored.findings.toothFindings).toBe('Tooth 16 percussion positive');
  });
});
