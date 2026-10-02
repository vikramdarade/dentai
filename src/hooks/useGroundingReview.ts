import { useMemo } from 'react';
import type { Consultation } from '../types';
import { deriveGroundingBadge, deriveFactsForDisplay, type UiBadge } from '../lib/uiVerification';

export interface UseGroundingReviewReturn {
  badge: UiBadge | null;
  isApprovedForSigning: boolean;
  facts: ReadonlyArray<{
    id: string;
    type: string;
    status: string;
    temporality: string;
    verificationState: string;
    speaker: string;
    summary: string;
    evidenceCount: number;
  }>;
  unverifiedFactsCount: number;
  groundingExplanation: string;
}

/**
 * Headless React hook for evidentiary grounding review (Phase 12 / J1 / J5).
 * Translates server-governed groundingAudit and facts into strict, fail-closed UI presentation state.
 */
export function useGroundingReview(
  consultation: Consultation | null | undefined,
  isMacroEngine: boolean = false
): UseGroundingReviewReturn {
  const badge = useMemo(() => {
    return deriveGroundingBadge(consultation, isMacroEngine);
  }, [consultation, isMacroEngine]);

  const isApprovedForSigning = useMemo(() => {
    return consultation?.groundingAudit?.isApprovedForSigning === true;
  }, [consultation?.groundingAudit]);

  const facts = useMemo(() => {
    return deriveFactsForDisplay(consultation);
  }, [consultation]);

  const unverifiedFactsCount = useMemo(() => {
    return facts.filter(f => f.verificationState !== 'verified' && f.verificationState !== 'approved').length;
  }, [facts]);

  const groundingExplanation = useMemo(() => {
    if (isMacroEngine) {
      return 'Note generated via structured dental clinical macro. Findings require clinician verification.';
    }
    if (isApprovedForSigning) {
      return 'All clinical claims have been ground-verified against the audio transcript.';
    }
    const audit = consultation?.groundingAudit;
    const reasons = audit?.blockingReasons || (audit as any)?.rejectionReasons;
    if (Array.isArray(reasons) && reasons.length > 0) {
      return reasons.join('; ');
    }
    return 'Clinician verification required prior to finalizing clinical record.';
  }, [isMacroEngine, isApprovedForSigning, consultation?.groundingAudit]);

  return {
    badge,
    isApprovedForSigning,
    facts,
    unverifiedFactsCount,
    groundingExplanation,
  };
}
