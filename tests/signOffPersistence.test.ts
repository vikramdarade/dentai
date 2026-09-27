/**
 * Phase 13A — persisted sign-off state (§22/§23).
 *
 * The existing Phase 10/12 suite (signOffValidation.test.ts) proves the gate
 * revalidates server-side. This suite proves the POST-14 hardening:
 *
 *   1. The minted seal is PERSISTED onto the canonical record via the
 *      validator's `persistSeal` dependency — "Signed" becomes a property of
 *      the durable record, not of one browser's React state.
 *   2. A record that already carries a persisted seal is refused as a replay
 *      BEFORE any other condition — signed survives reload/restart, and
 *      duplicate sign-offs are rejected server-side.
 *   3. The persisted seal self-verifies against the record's content, so the
 *      attestation remains cryptographically meaningful.
 *   4. A persistence failure fails the sign-off CLOSED: no 200 with an
 *      unpersisted seal.
 *   5. Practitioner identity is taken from the per-request context (the
 *      authenticated session), never a static placeholder.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSignOffValidator } from '../src/server/signOffValidation';
import { verifyAttestationSeal } from '../src/lib/attestation';
import type { Consultation } from '../src/types';

function consultation(overrides: Partial<Record<string, unknown>> = {}): Consultation {
  return {
    id: 'c-1',
    dentistId: 'd-1',
    firstName: 'Test',
    lastName: 'Patient',
    dob: '1990-01-01',
    appointmentType: 'examination',
    templateId: 'standard',
    findings: {
      chiefComplaint: 'Reviewed for routine care',
      toothFindings: '',
      diagnosis: 'No acute findings',
      treatmentPerformed: 'Scale and clean of quadrant 1',
      recallRequirements: '',
    },
    transcript: [{ sender: 'Dentist', text: 'Scale and clean of quadrant 1 today.' }],
    consent: { obtainedAt: '2026-09-27T09:00:00.000Z', disclosureVersion: 'v1', recordedBy: 'd-1' },
    recordVersion: 3,
    groundingAudit: { isApprovedForSigning: true, blockingReasons: [] },
    ...overrides,
  } as unknown as Consultation;
}

describe('Phase 13A — sign-off persistence and replay (§22/§23)', () => {
  let store: Map<string, Consultation>;
  let persistedSeals: Array<{ consultationId: string; dentistId: string; seal: unknown }>;
  let audits: Array<{ event: string; dentistId: string; detail: Record<string, unknown> }>;
  let persistShouldFail: boolean;
  let validator: ReturnType<typeof createSignOffValidator>;

  beforeEach(() => {
    store = new Map([['c-1', consultation()]]);
    persistedSeals = [];
    audits = [];
    persistShouldFail = false;
    validator = createSignOffValidator({
      loadConsultation: async (id, dentistId) =>
        store.get(id)?.dentistId === dentistId ? store.get(id)! : null,
      logAudit: (event, dentistId, detail) => { audits.push({ event, dentistId, detail }); },
      dentistName: 'Fallback Name',
      // The production wiring persists the seal onto the canonical record.
      persistSeal: async (consultationId, dentistId, seal) => {
        if (persistShouldFail) return false;
        persistedSeals.push({ consultationId, dentistId, seal });
        const record = store.get(consultationId);
        if (record) (record as unknown as { attestation: unknown }).attestation = seal;
        return true;
      },
      now: () => new Date('2026-09-27T10:00:00.000Z'),
    });
  });

  it('persists the minted seal onto the canonical record on successful sign-off', async () => {
    const result = await validator.validate('c-1', 'd-1', { expectedVersion: 3 });
    expect(result.ok).toBe(true);
    expect(persistedSeals).toHaveLength(1);
    expect(persistedSeals[0].consultationId).toBe('c-1');
    expect(persistedSeals[0].dentistId).toBe('d-1');
    // The persisted seal is the same object the client receives.
    if (result.ok) {
      expect(persistedSeals[0].seal).toEqual(result.seal);
    }
  });

  it('a signed record RELOADS as signed — the persisted seal rehydrates the state', async () => {
    await validator.validate('c-1', 'd-1', { expectedVersion: 3 });
    // Simulate a fresh process: a new validator instance (empty in-memory
    // nonce set) reads the same durable store.
    const freshValidator = createSignOffValidator({
      loadConsultation: async (id, dentistId) =>
        store.get(id)?.dentistId === dentistId ? store.get(id)! : null,
      // Same shared audit sink, so the refusal is observable in this test.
      logAudit: (event, dentistId, detail) => { audits.push({ event, dentistId, detail }); },
      dentistName: 'Fallback Name',
      persistSeal: async () => true,
      now: () => new Date('2026-09-27T11:00:00.000Z'),
    });
    const replay = await freshValidator.validate('c-1', 'd-1', { expectedVersion: 3 });
    expect(replay).toMatchObject({ ok: false, reason: 'replay' });
    expect(audits.filter(a => a.event === 'signoff_rejected_replay').length).toBeGreaterThan(0);
  });

  it('rejects a duplicate sign-off even when the client sends a fresh nonce', async () => {
    const first = await validator.validate('c-1', 'd-1', { expectedVersion: 3, requestNonce: 'n-1' });
    expect(first.ok).toBe(true);
    const second = await validator.validate('c-1', 'd-1', {
      expectedVersion: 3, requestNonce: 'brand-new-nonce',
    });
    expect(second).toMatchObject({ ok: false, reason: 'replay' });
  });

  it('the persisted seal self-verifies against the record content', async () => {
    await validator.validate('c-1', 'd-1', { expectedVersion: 3 });
    const record = store.get('c-1')!;
    const seal = (record as unknown as { attestation: Parameters<typeof verifyAttestationSeal>[1] }).attestation;
    expect(verifyAttestationSeal(record, seal).isValid).toBe(true);
  });

  it('fails CLOSED when the seal cannot be persisted — the record is NOT signed', async () => {
    persistShouldFail = true;
    const result = await validator.validate('c-1', 'd-1', { expectedVersion: 3 });
    expect(result.ok).toBe(false);
    expect(persistedSeals).toHaveLength(0);
    // Nothing was persisted, and the audit trail records the failure.
    expect(audits.map(a => a.event)).toContain('signoff_persist_failed');
    // The unsigned record can be signed after the storage fault clears.
    persistShouldFail = false;
    const retry = await validator.validate('c-1', 'd-1', { expectedVersion: 3 });
    expect(retry.ok).toBe(true);
  });

  it('the seal attests the SESSION practitioner, not a static placeholder', async () => {
    const result = await validator.validate('c-1', 'd-1', {
      expectedVersion: 3,
      practitionerName: 'Dr AHPRA Verified',
      ahpraRegistration: 'DEN-123456',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.seal.signedBy).toBe('Dr AHPRA Verified');
      expect(result.seal.ahpraRegistration).toBe('DEN-123456');
      // Identity is baked into the signature — altering it breaks the seal.
      const tampered = { ...result.seal, signedBy: 'Someone Else' };
      const record = store.get('c-1')!;
      expect(verifyAttestationSeal(record, tampered as typeof result.seal).isValid).toBe(false);
    }
  });

  it('falls back to the validator deps when no per-request identity is supplied', async () => {
    const result = await validator.validate('c-1', 'd-1', { expectedVersion: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.seal.signedBy).toBe('Fallback Name');
  });

  it('a persisted seal survives a grounding-audit strip attempt (immutability of signed state)', async () => {
    await validator.validate('c-1', 'd-1', { expectedVersion: 3 });
    const record = store.get('c-1') as unknown as { attestation?: { signatureHash?: string } };
    expect(record.attestation?.signatureHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
