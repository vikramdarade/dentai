/**
 * Unified Deterministic Grounding & Evidentiary Verification Engine (Work Package 3.0)
 *
 * Combines:
 * 1. Sub-second forward utterance alignment (subsecondAlignment.ts)
 * 2. Backward entity reconciliation & zero-omission detector (backwardReconciliation.ts)
 * 3. Rogers v Whitaker informed consent gate (rogersConsentGate.ts)
 */

export * from './types';
export * from './subsecondAlignment';
export * from './backwardReconciliation';
export * from './rogersConsentGate';

import {
  TimestampedUtterance,
  UnifiedGroundingAudit
} from './types';
import { extractClinicalClaims, alignClaimsToUtterances } from './subsecondAlignment';
import { reconcileEntitiesBackward } from './backwardReconciliation';
import { verifyRogersConsent } from './rogersConsentGate';

/**
 * Executes full evidentiary grounding audit for a clinical note against operatory audio transcript.
 */
export function verifyNoteGrounding(
  consultationId: string,
  utterances: (TimestampedUtterance | { sender: string; text: string; timestamp?: string })[],
  note: string | { canonical?: Record<string, string>; customSections?: Record<string, string>; [k: string]: any }
): UnifiedGroundingAudit {
  // Normalize utterances to TimestampedUtterance
  const normalizedUtterances: TimestampedUtterance[] = utterances.map((u, idx) => {
    if ('startTimeMs' in u && typeof (u as any).startTimeMs === 'number') {
      return u as TimestampedUtterance;
    }
    const baseTimeMs = idx * 3000;
    const validSender: 'Dentist' | 'Patient' | 'Assistant' | 'Dialogue' =
      u.sender === 'Dentist' || u.sender === 'Patient' || u.sender === 'Assistant'
        ? u.sender
        : 'Dialogue';

    return {
      id: `utt-${idx + 1}`,
      sender: validSender,
      text: u.text,
      startTimeMs: baseTimeMs,
      endTimeMs: baseTimeMs + 2500,
      audioSliceId: `chunk-${String(idx + 1).padStart(3, '0')}`
    };
  });

  const noteObj = typeof note === 'string' ? { fullContent: note } : note;

  // Aggregate all note text
  const textParts: string[] = [];
  if (noteObj.canonical) {
    textParts.push(...Object.values(noteObj.canonical));
  }
  if (noteObj.customSections) {
    textParts.push(...Object.values(noteObj.customSections));
  }
  for (const [key, val] of Object.entries(noteObj)) {
    if (key !== 'canonical' && key !== 'customSections' && typeof val === 'string') {
      textParts.push(val);
    }
  }
  const fullNoteText = textParts.join(' \n ');

  // 1. Forward Alignment
  const claims = extractClinicalClaims(noteObj);
  const alignment = alignClaimsToUtterances(claims, normalizedUtterances);

  // 2. Backward Reconciliation
  const reconciliation = reconcileEntitiesBackward(normalizedUtterances, fullNoteText);

  // 3. Rogers v Whitaker Consent Gate
  const rogersConsent = verifyRogersConsent(normalizedUtterances, fullNoteText);

  // 4. Determine Sign-Off Approval & Blocking Reasons
  const blockingReasons: string[] = [];

  if (reconciliation.hasCriticalOmissions) {
    for (const omission of reconciliation.omissions) {
      if (omission.severity === 'critical') {
        blockingReasons.push(`Critical Safety Omission: Spoken ${omission.entityType} (${omission.entityName}) was not recorded in notes.`);
      }
    }
  }

  if (rogersConsent.isBoilerplateFabrication) {
    blockingReasons.push('Boilerplate Fabrication Detected: Note claims informed consent risk discussion that was absent from operatory audio (Rule 12).');
  }

  if (alignment.overallGroundingScore < 0.85 && alignment.unverifiedCount > 2) {
    blockingReasons.push(`Low Grounding Score (${Math.round(alignment.overallGroundingScore * 100)}%): Multiple clinical claims lack audio corroboration.`);
  }

  const isApprovedForSigning = blockingReasons.length === 0;

  return {
    consultationId,
    alignment,
    reconciliation,
    rogersConsent,
    isApprovedForSigning,
    blockingReasons
  };
}
