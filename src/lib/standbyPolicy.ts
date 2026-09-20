/**
 * Clinical Standby & Cross-Patient Boundary Ingestion Policy.
 *
 * Pure decision functions governing audio ingestion across patient boundaries.
 * Prevents contamination of chart data when room audio arrives late or after
 * a patient switch has occurred.
 */

export interface SessionBoundaryContext {
  activeConsultationId?: string;
  isClosed?: boolean;
}

export type ChunkIngestionVerdict =
  | { action: 'accept' }
  | { action: 'refuse'; code: 'PATIENT_MISMATCH' | 'SESSION_CLOSED' | 'CONSULTATION_REQUIRED'; reason: string };

/**
 * Pure evaluation of whether an incoming audio chunk belongs to the active consultation.
 */
export function evaluateChunkIngestion(
  session: SessionBoundaryContext,
  incomingConsultationId?: string
): ChunkIngestionVerdict {
  if (session.isClosed) {
    return {
      action: 'refuse',
      code: 'SESSION_CLOSED',
      reason: 'This session has been completed and closed for new audio ingestion.'
    };
  }

  // If the session is bound to an active consultation, the chunk must match
  if (session.activeConsultationId) {
    if (!incomingConsultationId) {
      return {
        action: 'refuse',
        code: 'CONSULTATION_REQUIRED',
        reason: 'Session is bound to an active patient consultation, but chunk provided no consultationId.'
      };
    }
    if (session.activeConsultationId !== incomingConsultationId) {
      return {
        action: 'refuse',
        code: 'PATIENT_MISMATCH',
        reason: 'Incoming audio chunk belongs to a different consultation than the active patient.'
      };
    }
  }

  return { action: 'accept' };
}
