/**
 * Cryptographic Clinician Attestation & Evidentiary Signing Engine (Work Package 5.2)
 *
 * Implements:
 * 1. SHA-256 cryptographic signing of finalized clinical notes upon clinician sign-off.
 * 2. Immutable practitioner attestation adhering to Evidence Act 1995 (Cth) Section 48
 *    and Dental Board of Australia (DBA) Code of Conduct standards.
 */

import crypto from 'crypto';
import type { Consultation, ClinicalFindings } from '../types';
import { pipelineMetrics } from './pipelineMetrics';

export interface AttestationSeal {
  /** SHA-256 cryptographic signature digest */
  signatureHash: string;
  /** Name of the registered practitioner */
  signedBy: string;
  /** Practitioner identifier / account ID */
  practitionerId: string;
  /** ISO 8601 timestamp of chairside attestation */
  signedAt: string;
  /** AHPRA dental registration number */
  ahpraRegistration?: string;
  /** SHA-256 digest of canonical clinical content alone */
  contentDigest: string;
  /** Evidentiary grounding status at signing */
  auditStatus: 'Verified from Audio' | 'Clinician Verification Required';
}

/**
 * Builds a deterministic, normalized canonical text representation of a consultation's clinical record.
 */
export function buildCanonicalTextDigest(consultation: Consultation): string {
  const parts: string[] = [];

  // Names are optional on a stored record (records imported from a daysheet or
  // captured before identity was entered have none). An unguarded .trim() here
  // threw a TypeError that surfaced as a 500 on the sign-off route, so the
  // digest must tolerate absent name fields exactly like the sign gate's
  // canonicalizer already does.
  const firstName = (consultation.firstName ?? '').trim().toLowerCase();
  const lastName = (consultation.lastName ?? '').trim().toLowerCase();
  parts.push(`PATIENT:${firstName} ${lastName}`);
  parts.push(`DOB:${consultation.dob || ''}`);
  parts.push(`APPOINTMENT:${consultation.appointmentType || ''}`);
  parts.push(`TEMPLATE:${consultation.templateId || 'standard'}`);

  const findings: Partial<ClinicalFindings> = consultation.findings || {};
  const canonicalKeys = [
    'chiefComplaint',
    'history',
    'toothFindings',
    'findingsGingival',
    'diagnosis',
    'treatmentPerformed',
    'recommendations',
    'recallRequirements'
  ];

  for (const k of canonicalKeys) {
    const val = (findings as any)[k];
    if (typeof val === 'string' && val.trim()) {
      parts.push(`${k.toUpperCase()}:${val.trim()}`);
    }
  }

  if (findings.customSections) {
    const sortedKeys = Object.keys(findings.customSections).sort();
    for (const k of sortedKeys) {
      const val = findings.customSections[k];
      if (typeof val === 'string' && val.trim()) {
        parts.push(`CUSTOM_${k.toUpperCase()}:${val.trim()}`);
      }
    }
  }

  if (Array.isArray(findings.adaCodes) && findings.adaCodes.length > 0) {
    const codes = findings.adaCodes
      .map(c => `${c.code}:${c.tooth || ''}`)
      .sort()
      .join(';');
    parts.push(`ADA_CODES:${codes}`);
  }

  return parts.join('\n');
}

/**
 * Creates an immutable SHA-256 attestation seal for a consultation at sign-off.
 */
export function createAttestationSeal(
  consultation: Consultation,
  dentistId: string,
  dentistName: string,
  ahpraRegistration: string = '',
  signedAtIso?: string
): AttestationSeal {
  const signedAt = signedAtIso || new Date().toISOString();
  const canonicalText = buildCanonicalTextDigest(consultation);

  const contentDigest = crypto
    .createHash('sha256')
    .update(canonicalText, 'utf8')
    .digest('hex');

  const fullAttestationPayload = [
    contentDigest,
    dentistId,
    dentistName,
    ahpraRegistration,
    signedAt
  ].join('|');

  const signatureHash = crypto
    .createHash('sha256')
    .update(fullAttestationPayload, 'utf8')
    .digest('hex');

  // Phase 5 (fail-closed): only an explicit approving audit supports the
  // verified label. A missing/absent grounding audit is NOT verification —
  // absent evidence of approval must default to clinician verification required.
  const auditStatus = consultation.groundingAudit?.isApprovedForSigning === true
    ? 'Verified from Audio'
    : 'Clinician Verification Required';

  // Phase 9: fail-closed rejections are observable. The rate of notes signing
  // without a verified audit is the single most important clinical-safety
  // signal this platform emits — recorded as a count only, never with content.
  if (auditStatus !== 'Verified from Audio') {
    pipelineMetrics.recordCounter('signOffRejection');
  }

  return {
    signatureHash,
    signedBy: dentistName,
    practitionerId: dentistId,
    signedAt,
    ahpraRegistration,
    contentDigest,
    auditStatus
  };
}

/**
 * Verifies that a signed consultation's contents have not been altered post-attestation.
 */
export function verifyAttestationSeal(
  consultation: Consultation,
  seal: AttestationSeal
): { isValid: boolean; reason?: string } {
  const canonicalText = buildCanonicalTextDigest(consultation);
  const currentContentDigest = crypto
    .createHash('sha256')
    .update(canonicalText, 'utf8')
    .digest('hex');

  if (currentContentDigest !== seal.contentDigest) {
    return {
      isValid: false,
      reason: 'Clinical content has been modified since attestation (content hash mismatch).'
    };
  }

  const expectedPayload = [
    seal.contentDigest,
    seal.practitionerId,
    seal.signedBy,
    seal.ahpraRegistration || '',
    seal.signedAt
  ].join('|');

  const expectedSignature = crypto
    .createHash('sha256')
    .update(expectedPayload, 'utf8')
    .digest('hex');

  if (expectedSignature !== seal.signatureHash) {
    return {
      isValid: false,
      reason: 'Signature seal integrity check failed (practitioner metadata or timestamp altered).'
    };
  }

  return { isValid: true };
}
