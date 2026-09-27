/**
 * Verification Context Builder (Phase 6)
 *
 * Assembles the MINIMUM evidence context for the verifier. The verifier never
 * receives the full appointment transcript unless a specific trigger requires
 * it; default windows are narrow (a few utterances around each evidence span).
 *
 * Provenance rules:
 * - Timestamps pass through ONLY when measured (timingProvenance / startMs).
 * - Unmeasured timing is represented explicitly as unavailable — never inferred.
 */

import type { ClinicalFact } from '../../types/clinicalFact';
import type { TimestampedUtterance } from '../../grounding/types';

/** How many utterances of surrounding context to include on each side. */
const CONTEXT_WINDOW_RADIUS = 2;

export interface VerificationUtterance {
  readonly id: string;
  readonly sender: string;
  readonly text: string;
  /** Present ONLY when measured from real audio; absent = unavailable. */
  readonly startMs?: number;
  readonly endMs?: number;
  readonly timingProvenance: 'measured' | 'unavailable';
  /** ASR confidence when the provider supplies it; otherwise undefined. */
  readonly asrConfidence?: number;
}

export interface VerificationContext {
  readonly utterances: ReadonlyArray<VerificationUtterance>;
  /** Total utterances in the source transcript (for scope telemetry only). */
  readonly transcriptSize: number;
}

/**
 * Builds a narrow context: for each fact evidence span, the span's utterance
 * plus up to N utterances on each side. Deduplicated in transcript order.
 */
export function buildVerificationContext(
  facts: ReadonlyArray<ClinicalFact>,
  transcript: ReadonlyArray<TimestampedUtterance>
): VerificationContext {
  const indexById = new Map<string, number>();
  transcript.forEach((u, i) => indexById.set(u.id, i));

  const selected = new Set<number>();

  for (const fact of facts) {
    for (const span of fact.evidence) {
      const idx = indexById.get(span.utteranceId);
      if (idx === undefined) continue;
      for (let j = Math.max(0, idx - CONTEXT_WINDOW_RADIUS); j <= Math.min(transcript.length - 1, idx + CONTEXT_WINDOW_RADIUS); j++) {
        selected.add(j);
      }
    }
  }

  const utterances: VerificationUtterance[] = [...selected]
    .sort((a, b) => a - b)
    .map(i => {
      const u = transcript[i];
      const measured = u.timingProvenance === 'measured' || (u.timingProvenance === undefined && typeof u.startTimeMs === 'number');
      return {
        id: u.id,
        sender: u.sender,
        text: u.text,
        startMs: measured ? u.startTimeMs : undefined,
        endMs: measured ? u.endTimeMs : undefined,
        timingProvenance: measured ? 'measured' as const : 'unavailable' as const,
      };
    });

  return {
    utterances,
    transcriptSize: transcript.length,
  };
}
