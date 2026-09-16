/**
 * Audit-trail hash chain.
 *
 * Why: the access log is the evidence that answers "who looked at this
 * patient's record, and when". Until now an audit row could be edited or
 * deleted by anyone with database access, and nothing would show it.
 *
 * How it works: every audit entry gets a `contentHash` over its own fields and
 * a `hash` that mixes in the previous entry's hash. Two checks then become
 * possible:
 *
 *   - **Content check.** Recompute the hash from the row's own fields. A row
 *     whose content was edited no longer matches.
 *   - **Link check.** Each row's `prev_hash` must equal the previous row's
 *     `hash`. Deleting or reordering a row breaks the link at that point.
 *
 * Honest limits, because this is a control a clinic will ask about:
 *   - It is tamper-*evident*, not tamper-proof. Someone who can edit rows can
 *     also recompute the whole chain from that point forward. Detecting that
 *     requires the chain head to be witnessed somewhere the attacker does not
 *     control (append-only storage, or a periodic digest emailed to the
 *     practice). The verifier reports the chain head hash so it can be
 *     witnessed; that is its main operational use.
 *   - Concurrent appends from two server instances can briefly branch (two
 *     entries sharing the same predecessor). Branching is reported separately
 *     from tampering, so a busy morning is never mistaken for an incident.
 *
 * Nothing here contains PHI: the hash covers the event type, the actor id, the
 * non-PHI detail object and the timestamp.
 */

import crypto from 'crypto';

/** The value `prev_hash` takes for the first entry in the chain. */
export const GENESIS_HASH = 'genesis';

export interface AuditEntryLike {
  event: string;
  dentistId: string | null;
  detail: Record<string, any>;
  createdAt: string;
  prevHash?: string | null;
  hash?: string | null;
}

/**
 * Canonical serialisation. Key order is normalised so the same event produces
 * the same hash regardless of how the detail object was built.
 */
function canonicalDetail(detail: Record<string, any> | null | undefined): string {
  if (!detail || typeof detail !== 'object') return '{}';
  const keys = Object.keys(detail).sort();
  const ordered: Record<string, any> = {};
  for (const key of keys) ordered[key] = detail[key];
  return JSON.stringify(ordered);
}

export function auditContentHash(entry: {
  event: string;
  dentistId: string | null;
  detail: Record<string, any>;
  createdAt: string;
}): string {
  const payload = [
    entry.event || '',
    entry.dentistId || '',
    canonicalDetail(entry.detail),
    entry.createdAt || '',
  ].join('\u0000');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/** Combines the previous entry's hash with this entry's content hash. */
export function auditLinkHash(prevHash: string | null | undefined, contentHash: string): string {
  return crypto
    .createHash('sha256')
    .update(`${prevHash || GENESIS_HASH}\u0000${contentHash}`)
    .digest('hex');
}

/** Convenience: the stored hash for an entry, given its predecessor. */
export function auditEntryHash(
  prevHash: string | null | undefined,
  entry: { event: string; dentistId: string | null; detail: Record<string, any>; createdAt: string }
): string {
  return auditLinkHash(prevHash, auditContentHash(entry));
}

export interface ChainVerification {
  /** Number of entries examined. */
  checked: number;
  /** Entry indexes whose stored hash does not match their content. */
  tampered: number[];
  /** Entry indexes whose `prev_hash` does not match the preceding entry's hash. */
  brokenLinks: number[];
  /**
   * Entry indexes that share a predecessor with an earlier entry. This is the
   * expected signature of two concurrent writers, not of tampering.
   */
  branches: number[];
  /** Entries with no stored hash (written before the chain existed). */
  unchained: number[];
  intact: boolean;
  /** Hash of the last entry — publish this somewhere off-platform to witness it. */
  headHash: string | null;
  /** Which control was used to compute hashes, for the record. */
  algorithm: 'sha256';
}

/**
 * Verifies a chain ordered oldest-first. Pass every row; entries written before
 * the chain existed are reported as `unchained` rather than as failures.
 */
export function verifyAuditChain(entries: AuditEntryLike[]): ChainVerification {
  const tampered: number[] = [];
  const brokenLinks: number[] = [];
  const branches: number[] = [];
  const unchained: number[] = [];
  const seenHashes = new Map<string, number>();
  let previousHash: string | null = null;

  entries.forEach((entry, index) => {
    if (!entry.hash) {
      unchained.push(index);
      previousHash = null;
      return;
    }

    const expected = auditLinkHash(entry.prevHash, auditContentHash(entry));
    if (expected !== entry.hash) tampered.push(index);

    if (index > 0) {
      const predecessor = entries[index - 1];
      if (predecessor.hash && entry.prevHash !== predecessor.hash) {
        // Only a problem if some earlier entry *does* match this row's
        // predecessor — which means the rows were reordered or a row was
        // removed. A shared predecessor between two writers is a branch.
        const branchPoint = seenHashes.get(String(entry.prevHash));
        if (branchPoint !== undefined) branches.push(index);
        else brokenLinks.push(index);
      }
    }

    seenHashes.set(entry.hash, index);
    previousHash = entry.hash;
  });

  return {
    checked: entries.length,
    tampered,
    brokenLinks,
    branches,
    unchained,
    intact: tampered.length === 0 && brokenLinks.length === 0,
    headHash: previousHash,
    algorithm: 'sha256',
  };
}
