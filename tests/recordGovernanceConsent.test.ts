import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRecordGovernance } from '../src/server/recordGovernance';

/**
 * The consent gate, exercised directly.
 *
 * `DENTAI_REQUIRE_CONSENT=true` exists so an enforcing deployment refuses
 * clinical content it cannot legally justify. The gate must therefore:
 *
 *   - refuse a create that carries a transcript and no consent;
 *   - accept a create without a transcript (the seating shell) — the visit has
 *     to be persisted before it has any content, or audio cannot be stored
 *     against it;
 *   - accept an update whose RECORD already holds consent, even though the
 *     request does not repeat it — consent is captured once and append-only,
 *     so a save that re-sends the record must not be refused for not
 *     re-asserting it (that refusal made every later save of a consented
 *     consultation impossible and queued it forever);
 *   - keep refusing an update when neither the request nor the record has any.
 */

const canonicalConsent = {
  obtainedAt: '2026-09-30T01:05:00.000Z',
  disclosureVersion: 'v1',
  recordedBy: 'dentist-1',
};

function buildApp(opts: { requireConsent: boolean; records?: any[] }) {
  const store: any[] = opts.records ? opts.records.map((r) => ({ ...r })) : [];
  const audits: { event: string; detail?: Record<string, any> }[] = [];
  let lastBody: any = null;

  const app = express();
  app.use(express.json());
  app.use(
    createRecordGovernance({
      logger: { warn: () => {}, error: () => {} },
      authenticate: (req: any, _res: any, next: (err?: any) => void) => {
        req.dentist = { id: 'dentist-1' };
        next();
      },
      aiDisclosureVersion: 'test-disclosure',
      privacyNoticeVersion: 'test-notice',
      retentionYears: 7,
      requireConsent: opts.requireConsent,
      logAudit: (event: string, _dentistId: string, detail?: Record<string, any>) => {
        audits.push({ event, detail });
      },
      listConsultations: async () => store.map((r) => ({ ...r })),
    })
  );
  app.post('/api/consultations', (req, res) => {
    lastBody = req.body;
    res.status(201).json({ ok: true });
  });
  app.put('/api/consultations/:id', (req, res) => {
    lastBody = req.body;
    res.json({ ok: true });
  });

  return { app, audits, body: () => lastBody };
}

const transcript = [{ sender: 'Dentist', text: 'Tooth 16 has a composite.' }];

describe('record governance: AI-assist consent gate (DENTAI_REQUIRE_CONSENT)', () => {
  it('refuses a create that carries a transcript without consent', async () => {
    const { app, audits } = buildApp({ requireConsent: true });
    const res = await request(app)
      .post('/api/consultations')
      .send({ id: 'c1', transcript });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CONSENT_REQUIRED');
    expect(audits.some((a) => a.event === 'consultation_rejected_no_consent')).toBe(true);
  });

  it('accepts a create that carries consent, and stamps it canonically', async () => {
    const { app, body } = buildApp({ requireConsent: true });
    const res = await request(app)
      .post('/api/consultations')
      .send({ id: 'c1', transcript, consent: { obtainedAt: canonicalConsent.obtainedAt, recordedBy: 'Dr A' } });
    expect(res.status).toBe(201);
    expect(body().consent).toEqual({
      obtainedAt: canonicalConsent.obtainedAt,
      disclosureVersion: 'test-disclosure',
      recordedBy: 'Dr A',
    });
  });

  it('accepts the seating shell with no transcript and no consent', async () => {
    const { app, body } = buildApp({ requireConsent: true });
    const res = await request(app)
      .post('/api/consultations')
      .send({ id: 'a7f3d2c0-330f-44be-a929-de39835da302', status: 'In Review', transcript: [] });
    expect(res.status).toBe(201);
    // No consent was claimed, and none is fabricated: the empty obtainedAt is
    // the record saying "not captured".
    expect(body().consent.obtainedAt).toBe('');
  });

  it('accepts an update covered by the consent already on the record', async () => {
    const { app, body } = buildApp({
      requireConsent: true,
      records: [{ id: 'c1', recordVersion: 1, consent: { ...canonicalConsent }, transcript: [] }],
    });
    const res = await request(app)
      .put('/api/consultations/c1')
      .send({ id: 'c1', transcript, findings: { toothFindings: 'Composite 16' } });
    expect(res.status).toBe(200);
    expect(body().consent).toEqual(canonicalConsent);
    expect(body().recordVersion).toBe(2);
  });

  it('accepts an update covered by the legacy flat capture pair', async () => {
    const { app, body } = buildApp({
      requireConsent: true,
      records: [
        {
          id: 'c1',
          recordVersion: 1,
          transcript: [],
          consentObtained: true,
          consentCapturedAt: '2026-09-30T00:30:00.000Z',
          consentPractitionerId: 'Dr Legacy',
        },
      ],
    });
    const res = await request(app).put('/api/consultations/c1').send({ id: 'c1', transcript });
    expect(res.status).toBe(200);
    // The canonical object is NOT invented from the legacy pair: naming the
    // disclosure wording shown at an earlier capture is not something this
    // request knows. The pair stays as the record's own evidence.
    expect(body().consent).toBeUndefined();
  });

  it('still refuses an update when neither the request nor the record has consent', async () => {
    const { app } = buildApp({
      requireConsent: true,
      records: [{ id: 'c1', recordVersion: 1, transcript: [] }],
    });
    const res = await request(app).put('/api/consultations/c1').send({ id: 'c1', transcript });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CONSENT_REQUIRED');
  });

  it('keeps consent append-only: a supplied consent cannot replace the recorded one', async () => {
    const { app, body } = buildApp({
      requireConsent: true,
      records: [{ id: 'c1', recordVersion: 1, consent: { ...canonicalConsent }, transcript: [] }],
    });
    const res = await request(app)
      .put('/api/consultations/c1')
      .send({ id: 'c1', transcript, consent: { obtainedAt: '2026-10-01T00:00:00.000Z', recordedBy: 'someone-else' } });
    expect(res.status).toBe(200);
    expect(body().consent).toEqual(canonicalConsent);
  });

  it('with the flag off, a transcript-bearing write is accepted and the gap is audited', async () => {
    const { app, audits, body } = buildApp({ requireConsent: false });
    const res = await request(app).post('/api/consultations').send({ id: 'c1', transcript });
    expect(res.status).toBe(201);
    expect(body().consent.obtainedAt).toBe('');
    expect(audits.some((a) => a.event === 'consultation_without_consent_captured')).toBe(true);
  });
});
