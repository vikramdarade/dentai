import { useState, useCallback, useMemo } from 'react';
import type { Consultation } from '../types';
import type { AttestationSeal } from '../lib/attestation';
import { requestSignOff, type SignOffClientResult } from '../lib/signOffClient';

export interface UseSignOffOptions {
  consultation: Consultation | null;
  authToken: string | null;
  onSigned?: (updatedConsultation: Consultation) => void;
  onBeforeSign?: () => Promise<Consultation | void>;
}

export interface UseSignOffReturn {
  isSigning: boolean;
  isSigned: boolean;
  seal: AttestationSeal | null;
  lastRefusal: { code: string; message: string; currentVersion?: number } | null;
  refusalMessage: string | null;
  signRecord: () => Promise<SignOffClientResult | null>;
  clearRefusal: () => void;
}

/**
 * Headless React hook for the server-authoritative clinical sign-off gate (WP 5.2 / J1 / J5).
 * Sends expectedVersion and idempotency nonces, handling server-minted seals and refusal codes.
 */
export function useSignOff({
  consultation,
  authToken,
  onSigned,
  onBeforeSign,
}: UseSignOffOptions): UseSignOffReturn {
  const [isSigning, setIsSigning] = useState(false);
  const [lastRefusal, setLastRefusal] = useState<{
    code: string;
    message: string;
    currentVersion?: number;
  } | null>(null);

  const seal = useMemo<AttestationSeal | null>(() => {
    return consultation?.attestation || null;
  }, [consultation?.attestation]);

  const isSigned = useMemo(() => {
    return Boolean(seal?.signatureHash);
  }, [seal]);

  const refusalMessage = useMemo(() => {
    if (!lastRefusal) return null;
    return lastRefusal.message;
  }, [lastRefusal]);

  const clearRefusal = useCallback(() => {
    setLastRefusal(null);
  }, []);

  const signRecord = useCallback(async (): Promise<SignOffClientResult | null> => {
    if (!consultation?.id || !authToken) {
      setLastRefusal({
        code: 'CLIENT_PRECONDITION',
        message: 'No consultation or authorization available for signing.',
      });
      return null;
    }

    if (isSigned) {
      return {
        ok: true,
        seal: seal!,
        recordVersion: (consultation as any).version || 1,
        signedAt: seal!.signedAt,
      };
    }

    setIsSigning(true);
    setLastRefusal(null);

    try {
      let activeConsult = consultation;
      if (onBeforeSign) {
        try {
          const saved = await onBeforeSign();
          if (saved && typeof saved === 'object' && saved.id === consultation.id) {
            activeConsult = saved;
          }
        } catch (err) {
          console.warn('[useSignOff] onBeforeSign failed:', err);
        }
      }

      const expectedVersion = typeof activeConsult.recordVersion === 'number'
        ? activeConsult.recordVersion
        : typeof (activeConsult as any).version === 'number'
        ? (activeConsult as any).version
        : activeConsult.revisions?.length || 1;

      const nonce = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `sign-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      let result = await requestSignOff({
        authToken,
        consultationId: activeConsult.id,
        expectedVersion,
        requestNonce: nonce,
      });

      let finalResult: SignOffClientResult = result;

      // Self-healing optimistic concurrency reconciliation:
      // If the refusal was specifically STALE_VERSION and the server provided currentVersion
      // (typically caused by pre-sign auto-save advancing the server record version):
      if (!result.ok) {
        const failure = result as Extract<SignOffClientResult, { ok: false }>;
        if (failure.code === 'STALE_VERSION' && typeof failure.currentVersion === 'number') {
          const retryNonce = typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `sign-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

          finalResult = await requestSignOff({
            authToken,
            consultationId: activeConsult.id,
            expectedVersion: failure.currentVersion,
            requestNonce: retryNonce,
          });
        }
      }

      if (finalResult.ok) {
        const approval = finalResult as Extract<SignOffClientResult, { ok: true }>;
        const updated: Consultation = {
          ...activeConsult,
          attestation: approval.seal,
          recordVersion: approval.recordVersion,
          status: 'Completed',
          revisions: [
            ...(activeConsult.revisions || []),
            {
              id: `rev-sign-${Date.now()}`,
              savedAt: approval.signedAt,
              savedBy: approval.seal.signedBy || 'Dentist',
              systemGenerated: false,
            },
          ],
        };
        (updated as any).version = approval.recordVersion;

        onSigned?.(updated);
        return finalResult;
      } else {
        const refusal = finalResult as Extract<SignOffClientResult, { ok: false }>;
        setLastRefusal({
          code: refusal.code,
          message: refusal.message,
          currentVersion: refusal.currentVersion,
        });
        return finalResult;
      }
    } catch (err: any) {
      const refusal = {
        code: 'NETWORK',
        message: err?.message || 'Network error during sign-off request.',
      };
      setLastRefusal(refusal);
      return { ok: false, ...refusal };
    } finally {
      setIsSigning(false);
    }
  }, [consultation, authToken, isSigned, seal, onSigned, onBeforeSign]);

  return {
    isSigning,
    isSigned,
    seal,
    lastRefusal,
    refusalMessage,
    signRecord,
    clearRefusal,
  };
}
