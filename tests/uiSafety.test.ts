/**
 * Phase 12H — safety-critical UI state tests.
 *
 * The UI is a CONSUMER of the canonical clinical architecture, never an
 * authority. These tests pin the fail-closed presentation rules:
 *
 *   T1  missing grounding            → never "Verified from Audio"
 *   T2  isFullyGrounded = false      → never "Verified from Audio"
 *   T3  server-approved audit        → "Verified from Audio"
 *   T4  clinician correction         → stale verified badge disappears
 *   T5  server recomputation         → client cannot preserve a verified state
 *                                        the server no longer asserts
 *   T6  sign-off refusal             → incomplete grounding produces a visible
 *                                        refusal (422 GROUNDING_NOT_APPROVED)
 *   T7  successful sign-off          → ONLY the server response establishes
 *                                        the signed state (seal)
 *   T8  replay                       → replay refusal is represented (409 REPLAY)
 *   T9  stale write                  → 409 does not silently overwrite the
 *                                        clinician's changes; record keeps
 *                                        the server's version
 *   T10 macro provider               → "Template Applied", never "Verified
 *                                        from Audio"
 *
 * Rendering tests use react-dom/server static markup (no new dependencies);
 * transport tests stub fetch; gate tests run against the real Express app,
 * which re-derives every approval server-side.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import request from 'supertest';
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';

dotenv.config({ path: '.env.local' });
dotenv.config();

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'TEST_API_KEY';
process.env.DATABASE_URL = '';
process.env.GROQ_API_KEY = '';
process.env.GROQ_API_PROD_KEY = '';
process.env.LLM_PROVIDER = '';
process.env.OLLAMA_BASE_URL = '';
process.env.LLAMA_CPP_BASE_URL = '';
process.env.OPENAI_BASE_URL = '';
// Throwaway store — never the developer's working data directory.
process.env.DENTAI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dentai-ui-safety-'));
process.env.DENTAI_ALLOW_FILE_STORAGE = 'true';
process.env.DENTAI_DAILY_NOTE_LIMIT = '500';
process.env.DENTAI_DAILY_TOKEN_LIMIT = '5000000';

const { app } = await import('../server.ts');
const { deriveGroundingBadge, deriveFactsForDisplay } = await import('../src/lib/uiVerification.ts');
const { ClinicalNoteEditorPanel } = await import('../src/components/ClinicalNoteEditorPanel.tsx');
const { requestSignOff } = await import('../src/lib/signOffClient.ts');

// ---------------------------------------------------------------------------
// Fixtures: server-shaped records ONLY (what a GET/POST/PUT response returns).
// ---------------------------------------------------------------------------
const groundedFindings = {
  chiefComplaint: '', history: '',
  toothFindings: 'Deep caries 36, percussion positive.',
  findingsGingival: '',
  diagnosis: 'Symptomatic irreversible pulpitis 36.',
  treatmentPerformed: 'Extirpation completed on 36.',
  recommendations: 'Analgesia advice given.', recallRequirements: '', adaCodes: [] as unknown[]
};

const transcript = [
  { sender: 'Dentist', text: 'Tooth 36 has deep caries, percussion positive.' },
  { sender: 'Dentist', text: 'Extirpation completed on 36 today.' },
  { sender: 'Dentist', text: 'Diagnosis is symptomatic irreversible pulpitis on 36.' },
  { sender: 'Dentist', text: 'Analgesia advice given.' }
];

function serverRecord(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'rec-1', firstName: 'Test', lastName: 'Patient', dob: '1980-04-04',
    date: '2026-09-27', time: '09:15', status: 'Completed',
    appointmentType: 'emergency', templateId: 'standard',
    transcript, findings: groundedFindings,
    noteOrigin: { engine: 'groq', needsReview: false, detail: 'server' },
    ...overrides
  };
}

function renderPanel(props: Record<string, unknown>): string {
  return renderToStaticMarkup(
    React.createElement(ClinicalNoteEditorPanel, {
      activeEncounterId: 'rec-1',
      noteText: 'Sample note text.',
      onNoteChange: () => {},
      isGenerating: false,
      onGenerateNote: () => {},
      onApplyMacro: () => {},
      onCopyPMS: () => {},
      copiedFormat: null,
      ...props
    } as any)
  );
}

const VERIFIED = 'Verified from Audio';

// ---------------------------------------------------------------------------
// T1–T5, T10: badge presentation (client = pure consumer of server fields)
// ---------------------------------------------------------------------------
describe('Phase 12H: fail-closed grounding badge (client presentation)', () => {
  it('T1: a record with NO groundingAudit never displays "Verified from Audio"', () => {
    const rec = serverRecord({ groundingAudit: undefined });
    expect(deriveGroundingBadge(rec, false)).toBeNull();
    const html = renderPanel({ groundingBadge: deriveGroundingBadge(rec, false) ?? undefined, serverConsultation: rec });
    expect(html).not.toContain(VERIFIED);
  });

  it('T2: isApprovedForSigning = false never displays "Verified from Audio"', () => {
    const rec = serverRecord({
      groundingAudit: { isApprovedForSigning: false, blockingReasons: ['unverified_claims'], alignment: { statusBadge: 'Clinician Verification Required' } }
    });
    expect(deriveGroundingBadge(rec, false)).toBeNull();
    const html = renderPanel({ groundingBadge: deriveGroundingBadge(rec, false) ?? undefined, serverConsultation: rec });
    expect(html).not.toContain(VERIFIED);
  });

  it('T3: the server-approved audit displays "Verified from Audio"', () => {
    const rec = serverRecord({
      groundingAudit: { isApprovedForSigning: true, blockingReasons: [], alignment: { statusBadge: VERIFIED, isFullyGrounded: true } }
    });
    expect(deriveGroundingBadge(rec, false)).toBe(VERIFIED);
    const html = renderPanel({ groundingBadge: deriveGroundingBadge(rec, false) ?? undefined, serverConsultation: rec });
    expect(html).toContain(VERIFIED);
  });

  it('T4/T5: after a server-recomputed correction the stale verified badge disappears', () => {
    const approved = serverRecord({
      groundingAudit: { isApprovedForSigning: true, blockingReasons: [], alignment: { statusBadge: VERIFIED, isFullyGrounded: true } }
    });
    // The clinician edits; the server recomputes and returns a NON-approving
    // audit. The client's next render consumes the server's new verdict.
    const corrected = serverRecord({
      recordVersion: 2,
      findings: { ...groundedFindings, treatmentPerformed: 'Coronectomy completed on 38.' },
      groundingAudit: { isApprovedForSigning: false, blockingReasons: ['unverified_claims'], alignment: { statusBadge: 'Clinician Verification Required' } }
    });
    expect(deriveGroundingBadge(approved, false)).toBe(VERIFIED);
    expect(deriveGroundingBadge(corrected, false)).toBeNull();
    const htmlAfter = renderPanel({ groundingBadge: deriveGroundingBadge(corrected, false) ?? undefined, serverConsultation: corrected });
    expect(htmlAfter).not.toContain(VERIFIED);
  });

  it('T10: macro/template rendering displays "Template Applied", never a verified claim', () => {
    const rec = serverRecord({
      noteOrigin: { engine: 'australian-clinical-macro', needsReview: true, detail: 'template' },
      // Even a maximally approving audit must not leak through the macro gate.
      groundingAudit: { isApprovedForSigning: true, blockingReasons: [], alignment: { statusBadge: VERIFIED, isFullyGrounded: true } }
    });
    expect(deriveGroundingBadge(rec, true)).toBe('Template Applied');
    const html = renderPanel({ groundingBadge: deriveGroundingBadge(rec, true) ?? undefined, serverConsultation: rec });
    expect(html).toContain('Template Applied');
    expect(html).not.toContain(VERIFIED);
  });

  it('facts display is a verbatim projection of server verification state', () => {
    const rec = serverRecord({
      facts: [
        { id: 'f1', type: 'procedure', status: 'performed', temporality: 'current', verificationState: 'verified', speaker: 'dentist', value: { name: 'Extirpation 36' }, evidenceSpans: [{ utteranceId: 'u2' }] },
        { id: 'f2', type: 'diagnosis', status: 'discussed', temporality: 'current', verificationState: 'flagged', speaker: 'dentist', value: { description: 'pulpitis 36' }, evidenceSpans: [] }
      ]
    });
    const rows = deriveFactsForDisplay(rec);
    expect(rows).toHaveLength(2);
    expect(rows[0].verificationState).toBe('verified');
    expect(rows[0].evidenceCount).toBe(1);
    expect(rows[1].verificationState).toBe('flagged');
    const html = renderPanel({ serverConsultation: rec });
    expect(html).toContain('data-verification-state="verified"');
    expect(html).toContain('data-verification-state="flagged"');
  });
});

// ---------------------------------------------------------------------------
// T6–T8: sign-off transport mirrors the server verdict verbatim
// ---------------------------------------------------------------------------
describe('Phase 12H: sign-off client transport (server verdicts, verbatim)', () => {
  it('T7: success establishes signed state ONLY from the server response', async () => {
    const seal = { signatureHash: 'abc123', signedBy: 'Dr Test', practitionerId: 'd1', signedAt: new Date().toISOString(), contentDigest: 'dd', auditStatus: VERIFIED };
    vi_stubFetchOnce({ status: 200, body: { ok: true, seal, recordVersion: 3, signedAt: seal.signedAt } });
    const result = await requestSignOff({ authToken: 't', consultationId: 'rec-1', expectedVersion: 2 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.seal.signatureHash).toBe('abc123'); // server-minted, verbatim
      expect(result.recordVersion).toBe(3);
    }
  });

  it('T6: an incomplete-grounding refusal surfaces the server message and code', async () => {
    vi_stubFetchOnce({ status: 422, body: { error: 'Clinician Verification Required: the evidentiary grounding audit has not approved this note for signing.', code: 'GROUNDING_NOT_APPROVED' } });
    const result = await requestSignOff({ authToken: 't', consultationId: 'rec-1', expectedVersion: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const refusal = result as Extract<typeof result, { ok: false }>;
      expect(refusal.code).toBe('GROUNDING_NOT_APPROVED');
      expect(refusal.message).toContain('Clinician Verification Required');
    }
  });

  it('T8: a replay refusal carries the server REPLAY code', async () => {
    vi_stubFetchOnce({ status: 409, body: { error: 'Duplicate sign-off request detected.', code: 'REPLAY' } });
    const result = await requestSignOff({ authToken: 't', consultationId: 'rec-1', expectedVersion: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as Extract<typeof result, { ok: false }>).code).toBe('REPLAY');
  });

  it('T9 (transport): a stale-version refusal carries the server current version', async () => {
    vi_stubFetchOnce({ status: 409, body: { error: 'This record changed…', code: 'STALE_VERSION', currentVersion: 5 } });
    const result = await requestSignOff({ authToken: 't', consultationId: 'rec-1', expectedVersion: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as Extract<typeof result, { ok: false }>).currentVersion).toBe(5);
  });
});

function vi_stubFetchOnce(resp: { status: number; body: unknown }): void {
  // Minimal inline stub (vitest `vi` import kept out of the server-gate suites
  // that share this file's module registry).
  (globalThis as any).__origFetch = (globalThis as any).__origFetch || globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: resp.status < 400,
    status: resp.status,
    json: async () => resp.body
  })) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Server gates behind the UI (the authority the UI consumes)
// ---------------------------------------------------------------------------
describe('Phase 12H: server sign-off / stale-write gates consumed by the UI', () => {
  let token: string;
  let approvedId: string;
  let unapprovedId: string;
  let approvedVersion: number;

  beforeAll(async () => {
    const reg = await request(app).post('/api/auth/register')
      .send({ name: 'Dr UI Safety', specialty: 'General Dentistry', pin: '2718' });
    token = reg.body.token;
    expect(token).toBeTruthy();

    const consent = { obtainedAt: new Date().toISOString(), disclosureVersion: 'test', recordedBy: 'd1' };
    const create = async (lastName: string, body: Record<string, unknown>) => {
      const r = await request(app).post('/api/consultations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          firstName: 'Safety', lastName, dob: '1980-04-04',
          date: new Date().toISOString().slice(0, 10), time: '09:15',
          appointmentType: 'emergency', templateId: 'standard',
          transcript, consent,
          findings: { chiefComplaint: '', history: '', toothFindings: '', findingsGingival: '', diagnosis: '', treatmentPerformed: '', recommendations: '', recallRequirements: '', adaCodes: [] },
          ...body
        });
      expect([200, 201]).toContain(r.status);
      return r.body;
    };

    const approved = await create('Approved', {
      status: 'Completed', findings: groundedFindings,
      noteOrigin: { engine: 'groq', needsReview: false, detail: 'server' }
    });
    approvedId = approved.id;
    approvedVersion = approved.recordVersion ?? 1;
    expect(approved.groundingAudit?.isApprovedForSigning).toBe(true);

    // Clinical content present but never spoken in the transcript — the audit
    // disapproves on GROUNDING (not the earlier empty-note guard), which is the
    // refusal the UI must surface for an unapproved note with content.
    const unapproved = await create('Unapproved', {
      status: 'In Review',
      findings: { chiefComplaint: '', history: '', toothFindings: 'Fractured incisal edge 21.', findingsGingival: '', diagnosis: 'Acute pericoronitis 38.', treatmentPerformed: 'Coronectomy completed on 38.', recommendations: 'Review in one week.', recallRequirements: '', adaCodes: [] },
      noteOrigin: { engine: 'groq', needsReview: true, detail: 'server' }
    });
    unapprovedId = unapproved.id;
    expect(unapproved.groundingAudit?.isApprovedForSigning).toBe(false);
  });

  it('T6: sign-off on an unapproved note is refused with a visible reason (422)', async () => {
    const res = await request(app).post(`/api/consultations/${unapprovedId}/sign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedVersion: 1 });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('GROUNDING_NOT_APPROVED');
    expect(res.body.error).toContain('Clinician Verification Required');
  });

  it('T9: sign-off with a stale version is refused 409 with the server version', async () => {
    const res = await request(app).post(`/api/consultations/${approvedId}/sign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedVersion: approvedVersion + 5 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('STALE_VERSION');
    expect(res.body.currentVersion).toBe(approvedVersion);
  });

  it('T7: sign-off with the current version returns the server-minted seal', async () => {
    const res = await request(app).post(`/api/consultations/${approvedId}/sign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedVersion: approvedVersion });
    expect(res.status).toBe(200);
    expect(res.body.seal.signatureHash).toBeTruthy(); // minted server-side
    expect(res.body.recordVersion).toBe(approvedVersion);
  });

  it('T8: a refused sign-off does NOT burn the replay nonce (QLE-2026-0003)', async () => {
    const nonce = `replay-check-${unapprovedId}`;
    const first = await request(app).post(`/api/consultations/${unapprovedId}/sign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedVersion: 1, requestNonce: nonce });
    expect(first.status).toBe(422);
    expect(first.body.code).toBe('GROUNDING_NOT_APPROVED');
    // The clinician fixes whatever blocked them and retries with the same nonce.
    // Burning the nonce on a refusal dead-ended the retry as 409 REPLAY while no
    // seal existed — the defect. The nonce is spent only once a seal is durable.
    const retry = await request(app).post(`/api/consultations/${unapprovedId}/sign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedVersion: 1, requestNonce: nonce });
    expect(retry.status).toBe(422);
    expect(retry.body.code).toBe('GROUNDING_NOT_APPROVED');
  });

  it('T8b: re-signing an already-sealed record is refused 409 REPLAY', async () => {
    const replay = await request(app).post(`/api/consultations/${approvedId}/sign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedVersion: approvedVersion, requestNonce: `replay-check-${approvedId}` });
    expect(replay.status).toBe(409);
    expect(replay.body.code).toBe('REPLAY');
  });

  it('T9: a stale clinician edit is refused 409 and does NOT overwrite the record', async () => {
    // Fetch the server's current record, then attempt an edit based on a
    // deliberately stale version.
    const list = await request(app).get('/api/consultations').set('Authorization', `Bearer ${token}`);
    const current = list.body.find((c: any) => c.id === approvedId);
    expect(current).toBeTruthy();

    const stale = await request(app).put(`/api/consultations/${approvedId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedVersion: Number(current.recordVersion ?? 1) + 3, findings: { ...groundedFindings, treatmentPerformed: 'Clinician-overwritten treatment.' } });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_WRITE');
    expect(stale.body.serverConsultation).toBeTruthy();

    // The clinician's stale content must NOT have landed.
    const after = (await request(app).get('/api/consultations').set('Authorization', `Bearer ${token}`))
      .body.find((c: any) => c.id === approvedId);
    expect(after.findings.treatmentPerformed).toBe(groundedFindings.treatmentPerformed);
    expect(after.recordVersion).toBe(current.recordVersion);
  });
});
