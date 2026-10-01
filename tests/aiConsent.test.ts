import { describe, it, expect } from 'vitest';
import { consentFromCapture, recordedConsent, consentForWrite } from '../src/lib/aiConsent';
import { AI_DISCLOSURE_VERSION } from '../src/lib/compliance';

/**
 * AI-assist consent — the conversion from a capture to the canonical object.
 *
 * These tests pin the property the server's write gate depends on: a consent
 * object exists only when a capture exists (`obtainedAt` included), and a
 * record's own recorded consent is never rewritten by a session capture.
 */
describe('AI-assist consent', () => {
  it('a capture produces the canonical object with the disclosure version', () => {
    const consent = consentFromCapture(
      { consentObtained: true, consentCapturedAt: '2026-09-30T01:05:00.000Z', consentPractitionerId: 'Dr A' },
      'dentist-1'
    );
    expect(consent).toEqual({
      obtainedAt: '2026-09-30T01:05:00.000Z',
      disclosureVersion: AI_DISCLOSURE_VERSION,
      recordedBy: 'Dr A',
    });
  });

  it('falls back to the authenticated practitioner when the capture named nobody', () => {
    const consent = consentFromCapture(
      { consentObtained: true, consentCapturedAt: '2026-09-30T01:05:00.000Z' },
      'dentist-1'
    );
    expect(consent?.recordedBy).toBe('dentist-1');
  });

  it('never invents a consent: no capture, no object', () => {
    expect(consentFromCapture(undefined, 'dentist-1')).toBeNull();
    expect(consentFromCapture(null, 'dentist-1')).toBeNull();
    expect(consentFromCapture({}, 'dentist-1')).toBeNull();
    // A ticked flag with no capture instant is not a capture — it cannot say
    // when the patient was told anything.
    expect(consentFromCapture({ consentObtained: true }, 'dentist-1')).toBeNull();
    expect(consentFromCapture({ consentObtained: true, consentCapturedAt: '   ' }, 'dentist-1')).toBeNull();
    // An instant with no flag is a timestamp, not a consent.
    expect(consentFromCapture({ consentCapturedAt: '2026-09-30T01:05:00.000Z' }, 'dentist-1')).toBeNull();
    expect(consentFromCapture({ consentObtained: false, consentCapturedAt: '2026-09-30T01:05:00.000Z' })).toBeNull();
  });

  it('reads a recorded consent verbatim, and only when it has an instant', () => {
    expect(
      recordedConsent({ consent: { obtainedAt: ' 2026-09-30T01:05:00.000Z ', disclosureVersion: 'v9', recordedBy: 'Dr B' } })
    ).toEqual({ obtainedAt: '2026-09-30T01:05:00.000Z', disclosureVersion: 'v9', recordedBy: 'Dr B' });

    expect(recordedConsent({ consent: { disclosureVersion: 'v9' } as any })).toBeNull();
    expect(recordedConsent({ consent: { obtainedAt: '' } as any })).toBeNull();
    expect(recordedConsent({})).toBeNull();
    expect(recordedConsent(null)).toBeNull();
    // A version-less consent is still a consent; the current disclosure wording
    // is the only one this build can name.
    expect(recordedConsent({ consent: { obtainedAt: '2026-09-30T01:05:00.000Z' } as any })?.disclosureVersion).toBe(
      AI_DISCLOSURE_VERSION
    );
  });

  it('a recorded consent wins over a later session capture (append-only)', () => {
    const onFile = { obtainedAt: '2026-09-30T00:00:00.000Z', disclosureVersion: 'v1', recordedBy: 'Dr A' };
    const capture = { obtainedAt: '2026-09-30T02:00:00.000Z', disclosureVersion: 'v2', recordedBy: 'Dr B' };
    expect(consentForWrite({ consent: onFile }, capture)).toEqual(onFile);
    expect(consentForWrite({}, capture)).toEqual(capture);
    expect(consentForWrite({}, null)).toBeNull();
    expect(consentForWrite(undefined, undefined)).toBeNull();
  });
});
