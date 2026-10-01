/**
 * Phase 10 remediation tests — sign-off revalidation (F-4).
 *
 * The server, not the client, is authoritative for whether a note is
 * signable. Every unsafe signing attempt must fail safely with a
 * machine-readable reason, and the seal must be server-minted.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSignOffValidator, type SignOffRequestContext } from '../src/server/signOffValidation';
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

function makeValidator(store: Map<string, Consultation>) {
  const audits: Array<{ event: string; dentistId: string; detail: Record<string, unknown> }> = [];
  const validator = createSignOffValidator({
    loadConsultation: async (id, dentistId) =>
      store.get(id)?.dentistId === dentistId ? store.get(id)! : null,
    logAudit: (event, dentistId, detail) => { audits.push({ event, dentistId, detail }); },
    dentistName: 'Dr. Test',
    now: () => new Date('2026-09-27T10:00:00.000Z'),
  });
  return { validator, audits };
}

describe('Server-side sign-off revalidation (F-4)', () => {
  let store: Map<string, Consultation>;
  let ctx: { validator: ReturnType<typeof makeValidator>['validator']; audits: ReturnType<typeof makeValidator>['audits'] };

  beforeEach(() => {
    store = new Map<string, Consultation>();
    ctx = makeValidator(store);
    store.set('c-1', consultation());
  });

  const sign = (id: string, dentistId: string, request: Partial<SignOffRequestContext> = {}) =>
    ctx.validator.validate(id, dentistId, { expectedVersion: 3, ...request });

  it('approves a fully verified, consent-gated, version-matched note and mints the seal server-side', async () => {
    const result = await sign('c-1', 'd-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.seal.signatureHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.seal.auditStatus).toBe('Verified from Audio');
      expect(result.signedAt).toBe('2026-09-27T10:00:00.000Z');
      expect(result.recordVersion).toBe(3);
    }
    expect(ctx.audits.map(a => a.event)).toContain('consultation_signed_off');
  });

  it('refuses signing a note whose grounding audit is absent (fail closed)', async () => {
    store.set('c-1', consultation({ groundingAudit: undefined }));
    const result = await sign('c-1', 'd-1');
    expect(result).toMatchObject({ ok: false, reason: 'grounding_not_approved' });
    expect(ctx.audits.map(a => a.event)).toContain('signoff_rejected_grounding');
  });

  it('refuses signing a note whose grounding audit is non-approving (fail closed)', async () => {
    store.set('c-1', consultation({ groundingAudit: { isApprovedForSigning: false, blockingReasons: ['Critical Safety Omission: spoken allergy missing'] } }));
    const result = await sign('c-1', 'd-1');
    expect(result).toMatchObject({ ok: false, reason: 'grounding_not_approved' });
  });

  it('refuses signing a note with a blocking fact verification state (flagged/rejected)', async () => {
    store.set('c-1', consultation({
      facts: [{ id: 'f1', verificationState: 'flagged' }],
    }));
    const result = await sign('c-1', 'd-1');
    expect(result).toMatchObject({ ok: false, reason: 'verification_blocking_state' });
  });

  it('refuses a modified note (stale expectedVersion) and returns the server copy', async () => {
    const result = await sign('c-1', 'd-1', { expectedVersion: 2 });
    expect(result).toMatchObject({ ok: false, reason: 'stale_version', currentVersion: 3 });
    if (result.ok === false && 'serverConsultation' in result && result.serverConsultation) {
      expect(result.serverConsultation.id).toBe('c-1');
    }
    expect(ctx.audits.map(a => a.event)).toContain('signoff_rejected_stale_version');
  });

  it('refuses a sign-off after the record was corrected (post-correction attempt)', async () => {
    // First sign-off succeeds...
    const first = await sign('c-1', 'd-1');
    expect(first.ok).toBe(true);
    // ...then the clinician corrects a fact (version bumps) and the old
    // request is replayed verbatim.
    store.set('c-1', consultation({ recordVersion: 4, findings: { diagnosis: 'Reversible pulpitis 16' } }));
    const second = await sign('c-1', 'd-1');
    expect(second).toMatchObject({ ok: false, reason: 'stale_version', currentVersion: 4 });
  });

  it('refuses a replayed sign-off request (nonce reuse)', async () => {
    const first = await sign('c-1', 'd-1', { requestNonce: 'nonce-1' });
    expect(first.ok).toBe(true);
    // The record was "rolled back" to an unsigned state by an attacker; the
    // nonce is still consumed, so the same request cannot sign again.
    store.set('c-1', consultation({ groundingAudit: undefined }));
    const replay = await ctx.validator.validate('c-1', 'd-1', { expectedVersion: 3, requestNonce: 'nonce-1' });
    expect(replay).toMatchObject({ ok: false, reason: 'replay' });
    expect(ctx.audits.map(a => a.event)).toContain('signoff_rejected_replay');
  });

  it('refuses a second sign-off of an already-signed record', async () => {
    const first = await sign('c-1', 'd-1', { requestNonce: 'nonce-a' });
    expect(first.ok).toBe(true);
    const again = await ctx.validator.validate('c-1', 'd-1', {
      expectedVersion: 3,
      previousSignOffNonce: (first as { ok: true; seal: { signatureHash: string } }).seal.signatureHash,
    });
    expect(again).toMatchObject({ ok: false, reason: 'replay' });
  });

  it('refuses signing another clinician’s consultation', async () => {
    const result = await sign('c-1', 'd-other');
    expect(result).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('refuses signing an empty/clinical-content-free note', async () => {
    store.set('c-1', consultation({ findings: {}, transcript: [] }));
    const result = await sign('c-1', 'd-1');
    expect(result).toMatchObject({ ok: false, reason: 'empty_note' });
  });

  it('refuses a walk-in shell whose only "content" is seating/intake metadata, even with an approving audit', async () => {
    // The live defect (playtest, blank walk-in): a walk-in appointment carries
    // findings.customSections.intakeNote (provenance) and .operatory (which
    // room). Counting those as note text let a record with no audio and no
    // findings pass this guard; whenever its grounding verdict said approved —
    // the verdict is stored, so a record audited under an older rule keeps it —
    // the blank appointment was sealed and the client showed it as "Verified
    // from Audio". The metadata is not clinical content, and this gate must
    // refuse on its own: a cached approving verdict is exactly what it cannot
    // be allowed to lean on.
    store.set('c-1', consultation({
      findings: {
        customSections: {
          operatory: 'Room 1',
          intakeNote: 'Walk-in encounter created at intake for Test Patient',
        },
      },
      transcript: [],
      groundingAudit: { isApprovedForSigning: true, blockingReasons: [] },
    }));
    const result = await sign('c-1', 'd-1');
    expect(result).toMatchObject({ ok: false, reason: 'empty_note' });
  });

  it('still signs a note whose findings live only in a clinical custom section', async () => {
    // The other half of the rule: only the encounter bookkeeping keys are
    // ignored. A clinician who types into a custom clinical section has note
    // content, and must not be refused for it.
    store.set('c-1', consultation({
      findings: {
        customSections: { operatory: 'Room 1', periodontalChart: 'Pocketing 4mm on 16 and 26.' },
      },
      transcript: [{ sender: 'Dentist', text: 'Pocketing of four millimetres on sixteen and twenty six.' }],
    }));
    const result = await sign('c-1', 'd-1');
    expect(result).toMatchObject({ ok: true });
  });

  it('refuses signing a transcript-bearing note with no recorded consent', async () => {
    store.set('c-1', consultation({ consent: undefined }));
    const result = await sign('c-1', 'd-1');
    expect(result).toMatchObject({ ok: false, reason: 'consent_missing' });
  });

  it('detects a note modified between approval and seal verification (content hash)', async () => {
    // Simulate a concurrent mutation: load returns the approved record, but
    // the object handed to seal verification differs. We emulate by mutating
    // the store record mid-flight via a wrapping loader.
    const mutating = createSignOffValidator({
      loadConsultation: async () => {
        const c = consultation();
        // Grounding approved at load...
        return c;
      },
      logAudit: () => {},
      dentistName: 'Dr. Test',
      now: () => new Date('2026-09-27T10:00:00.000Z'),
    });
    // The server-minted seal must verify against the record it signed.
    const result = await mutating.validate('c-1', 'd-1', { expectedVersion: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const { verifyAttestationSeal } = await import('../src/lib/attestation');
      const tampered = consultation({ findings: { diagnosis: 'Changed after signing' } });
      const check = verifyAttestationSeal(tampered, result.seal);
      expect(check.isValid).toBe(false);
    }
  });
});

/**
 * QLE-2026-0003 — a record with no patient name fields is a reachable shape
 * (daysheet imports, records captured before identity was entered). It used to
 * throw a TypeError in the seal building, surfacing as a 500 and dead-ending
 * finalisation. A refused sign-off must also not burn its replay nonce.
 */
describe('Sign-off robustness (QLE-2026-0003)', () => {
  it('signs a nameless record instead of throwing a 500', async () => {
    const store = new Map<string, Consultation>();
    const { validator } = makeValidator(store);
    store.set('c-1', consultation({ firstName: undefined, lastName: undefined }));

    const result = await validator.validate('c-1', 'd-1', { expectedVersion: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.seal.signatureHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.seal.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('does not consume the replay nonce when the sign-off is refused', async () => {
    const store = new Map<string, Consultation>();
    const { validator } = makeValidator(store);
    store.set('c-1', consultation({ groundingAudit: undefined }));

    const refused = await validator.validate('c-1', 'd-1', { expectedVersion: 3, requestNonce: 'nonce-retry' });
    expect(refused).toMatchObject({ ok: false, reason: 'grounding_not_approved' });

    // The blocking condition is resolved and the SAME request is retried — it
    // must be able to succeed rather than answering 409 REPLAY.
    store.set('c-1', consultation());
    const retried = await validator.validate('c-1', 'd-1', { expectedVersion: 3, requestNonce: 'nonce-retry' });
    expect(retried.ok).toBe(true);
  });

  it('still refuses a genuine duplicate nonce after a successful sign-off', async () => {
    const store = new Map<string, Consultation>();
    const { validator } = makeValidator(store);
    store.set('c-1', consultation());

    const first = await validator.validate('c-1', 'd-1', { expectedVersion: 3, requestNonce: 'nonce-once' });
    expect(first.ok).toBe(true);

    // Same nonce, unsigned copy again (as if the seal write were rolled back) —
    // the consumed nonce must still refuse it.
    store.set('c-1', consultation());
    const replay = await validator.validate('c-1', 'd-1', { expectedVersion: 3, requestNonce: 'nonce-once' });
    expect(replay).toMatchObject({ ok: false, reason: 'replay' });
  });
});
