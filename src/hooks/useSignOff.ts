import { useState, useCallback, useMemo } from 'react';
import type { Consultation } from '../types';
import type { AttestationSeal } from '../lib/attestation';
import { requestSignOff, type SignOffClientResult } from '../lib/signOffClient';

export interface UseSignOffOptions {
  consultation: Consultation | null;
  authToken: string | null;
  onSigned?: (updatedConsultation: Consultation) => void;
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
      const expectedVersion = typeof (consultation as any).version === 'number'
        ? (consultation as any).version
        : consultation.revisions?.length || 1;

      const nonce = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `sign-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const result = await requestSignOff({
        authToken,
        consultationId: consultation.id,
        expectedVersion,
        requestNonce: nonce,
      });

      if (result.ok) {
        const updated: Consultation = {
          ...consultation,
          attestation: result.seal,
          status: 'Completed',
          revisions: [
            ...(consultation.revisions || []),
            {
              id: `rev-sign-${Date.now()}`,
              savedAt: result.signedAt,
              savedBy: result.seal.signedBy || 'Dentist',
              systemGenerated: false,
            },
          ],
        };
        (updated as any).version = result.recordVersion;

        onSigned?.(updated);
        return result;
      } else {
        const failure = result as {
          ok: false;
          code: string;
          message: string;
          currentVersion?: number;
        };
        setLastRefusal({
          code: failure.code,
          message: failure.message,
          currentVersion: failure.currentVersion,
        });
        return result;
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
  }, [consultation, authToken, isSigned, seal, onSigned]);

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
