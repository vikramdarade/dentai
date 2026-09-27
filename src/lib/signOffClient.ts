/**
 * Phase 12E — client transport for the server-authoritative sign-off gate.
 *
 * The client only REQUESTS sign-off. Every approval condition is re-derived
 * server-side (version, content digest, grounding approval, blocking fact
 * states, consent) and the seal is minted by the server. This helper performs
 * no validation of its own and never constructs a seal.
 */

import type { AttestationSeal } from './attestation';

export type SignOffClientResult =
  | { ok: true; seal: AttestationSeal; recordVersion: number; signedAt: string }
  | {
      ok: false;
      /** Server machine-readable refusal code (STALE_VERSION, REPLAY, GROUNDING_NOT_APPROVED, …). */
      code: string;
      message: string;
      /** Current server-side version on a stale/replay refusal, for reconciliation. */
      currentVersion?: number;
    };

/**
 * Requests sign-off from the server.
 *
 * @param requestNonce — client-generated idempotency key. A replayed nonce is
 *   refused by the server, which is the correct fail-closed behaviour.
 */
export async function requestSignOff(opts: {
  authToken: string;
  consultationId: string;
  /** The record version the client's request is based on (required by the server). */
  expectedVersion: number;
  requestNonce?: string;
}): Promise<SignOffClientResult> {
  try {
    const res = await fetch(`/api/consultations/${encodeURIComponent(opts.consultationId)}/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.authToken}`
      },
      body: JSON.stringify({
        expectedVersion: opts.expectedVersion,
        ...(opts.requestNonce ? { requestNonce: opts.requestNonce } : {})
      })
    });

    if (res.ok) {
      const body = await res.json();
      // The seal comes from the server and is displayed verbatim — never validated
      // or re-derived here; the server already self-checked it before responding.
      return {
        ok: true,
        seal: body.seal as AttestationSeal,
        recordVersion: Number(body.recordVersion),
        signedAt: String(body.signedAt)
      };
    }

    const body = await res.json().catch(() => ({}));
    return {
      ok: false,
      code: String(body.code || `HTTP_${res.status}`),
      message: String(body.error || 'Sign-off could not be validated.'),
      currentVersion: typeof body.currentVersion === 'number' ? body.currentVersion : undefined
    };
  } catch (err: any) {
    return {
      ok: false,
      code: 'NETWORK',
      message: err?.message || 'Sign-off request failed. Check your connection and try again.'
    };
  }
}
