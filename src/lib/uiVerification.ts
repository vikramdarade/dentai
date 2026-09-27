/**
 * Phase 12 — UI-side consumer of the canonical clinical architecture.
 *
 * This module is the ONLY place a component may turn a consultation record
 * into a verification/sign-off presentation state. It is a pure projection of
 * SERVER-DERIVED fields:
 *
 *   - `groundingAudit` is recomputed by the server on every consultation
 *     create/update (recordGovernance + PUT route) and is stripped from any
 *     client-supplied write, so it can only ever be the server's verdict.
 *   - `attestation` is minted by the server's sign-off endpoint; the client
 *     never generates a seal.
 *
 * Fail-closed rules enforced here:
 *   - An absent or non-approving audit NEVER yields "Verified from Audio".
 *   - The verified badge requires the explicit server-derived condition
 *     `groundingAudit.isApprovedForSigning === true`.
 *   - A deterministic macro/template rendering is presented as
 *     "Template Applied" even when its (few) grounded claims passed — a
 *     template is not a verified transcript event.
 *   - A locally cached attestation is NOT proof of signing: the server's
 *     sign-off response establishes the signed state.
 */

import type { Consultation } from '../types';

/** Explicit non-verified states the UI may present. */
export type UiBadge =
  | 'Verified from Audio'
  | 'Template Applied'
  | 'Clinician Verification Required';

/** Sign-off presentation state, fully derived from server responses. */
export type UiSignOffState = {
  /** True ONLY when the server's sign-off endpoint returned a seal. */
  readonly isSigned: boolean;
  /** Server-minted seal, displayed verbatim after a successful sign-off. */
  readonly seal: Consultation['attestation'] | null;
  /** Machine-readable refusal reason from the last server sign-off attempt. */
  readonly lastRefusalReason: string | null;
};

/**
 * The grounding badge for a consultation record.
 *
 * @param isMacroEngine — true when `noteOrigin.engine === 'australian-clinical-macro'`.
 *   Passed separately (rather than read inside) so callers cannot accidentally
 *   bypass the macro gate by passing a constructed record.
 */
export function deriveGroundingBadge(consultation: Consultation | null | undefined, isMacroEngine: boolean): UiBadge | null {
  if (isMacroEngine) return 'Template Applied';
  // Fail-closed: only the server's approving audit yields the verified badge.
  if (consultation?.groundingAudit?.isApprovedForSigning === true) {
    return 'Verified from Audio';
  }
  return null;
}

/**
 * Sign-off presentation state from the SERVER's record plus the server's
 * sign-off response. `serverSealedRecord` is the consultation as last returned
 * by a server write/sign response — never a locally constructed object.
 */
export function deriveSignOffState(consultation: Consultation | null | undefined, serverSeal: Consultation['attestation'] | null | undefined): UiSignOffState {
  const seal = serverSeal ?? null;
  return {
    // A record is signed only when the server handed back (or persists) a seal.
    isSigned: Boolean(seal?.signatureHash),
    seal,
    lastRefusalReason: null,
  };
}

/**
 * Facts view-model for display. The UI renders evidence, status, temporality
 * and verification state exactly as the server recorded them — it never
 * re-derives or re-verifies any of them.
 */
export function deriveFactsForDisplay(consultation: Consultation | null | undefined): ReadonlyArray<{
  readonly id: string;
  readonly type: string;
  readonly status: string;
  readonly temporality: string;
  readonly verificationState: string;
  readonly speaker: string;
  readonly summary: string;
  readonly evidenceCount: number;
}> {
  const facts = (consultation as unknown as { facts?: ReadonlyArray<Record<string, unknown>> } | undefined)?.facts;
  if (!Array.isArray(facts)) return [];
  return facts.map((f) => {
    const evidence = Array.isArray(f.evidenceSpans) ? (f.evidenceSpans as unknown[]) : [];
    const value = f.value;
    let summary = '';
    if (typeof value === 'string') {
      summary = value;
    } else if (value && typeof value === 'object') {
      const v = value as Record<string, unknown>;
      const candidate = v.name ?? v.description ?? v.drugName ?? v.complaint ?? v.condition ?? v.summary;
      summary = typeof candidate === 'string' ? candidate : '';
    }
    return {
      id: String(f.id ?? ''),
      type: String(f.type ?? ''),
      status: String(f.status ?? ''),
      temporality: String(f.temporality ?? ''),
      verificationState: String(f.verificationState ?? ''),
      speaker: String(f.speaker ?? ''),
      summary,
      evidenceCount: evidence.length,
    };
  });
}
