/**
 * Selective Verification Pipeline (Phase 6)
 *
 * Wires the three deterministic stages together:
 *   triggers → context → verifier → state machine
 *
 * Selective principle: a clean fact set runs the trigger matrix (pure, cheap,
 * deterministic) and NOTHING ELSE — no verifier invocation, no extra LLM call,
 * zero added latency beyond the trigger scan. Only flagged fact sets proceed.
 */

import type { ClinicalFact } from '../../types/clinicalFact';
import type { TimestampedUtterance } from '../../grounding/types';
import {
  evaluateVerificationTriggers,
  type VerificationTrigger,
} from './triggers';
import { collectStatusSignals } from '../treatmentStatus';
import { buildVerificationContext, type VerificationContext } from './context';
import { verifyFacts, assertDecisionIntegrity, type VerificationResult } from './verifier';
import { applyVerificationDecisions, type FactUpdateResult } from './factUpdater';

export interface PipelineRunResult extends FactUpdateResult {
  /** True when the trigger matrix found conditions worth verifying. */
  readonly triggered: boolean;
  readonly triggerCount: number;
  readonly triggers: ReadonlyArray<VerificationTrigger>;
  /** Undefined when verification was not invoked (normal path). */
  readonly verification?: VerificationResult;
  /** PHI-free run summary for telemetry. */
  readonly telemetry: {
    readonly triggered: boolean;
    readonly triggerTypes: ReadonlyArray<string>;
    readonly decisionsByOutcome: Readonly<Record<string, number>>;
    readonly latencyMs: number;
  };
}

export interface PipelineInput {
  /** Per-utterance ASR confidence, when the ASR supplies it. */
  readonly asrConfidence?: ReadonlyMap<string, number>;
  /** Whether the source transcript is diarized (default true). */
  readonly hasDiarization?: boolean;
}

/**
 * Full selective verification pass. Deterministic end-to-end (no LLM call);
 * the decision policy in verifier.ts is conservative and evidence-bound.
 */
export function runSelectiveVerificationPass(
  facts: ReadonlyArray<ClinicalFact>,
  transcript: ReadonlyArray<TimestampedUtterance>,
  input: PipelineInput = {}
): PipelineRunResult {
  const hasDiarization = input.hasDiarization ?? true;

  const utteranceTexts = new Map<string, string>();
  const asrConfidence = new Map<string, number>();
  for (const u of transcript) {
    if (typeof u.text === 'string') utteranceTexts.set(u.id, u.text);
    const conf = (u as { asrConfidence?: number }).asrConfidence;
    if (typeof conf === 'number') asrConfidence.set(u.id, conf);
  }

  const triggers = evaluateVerificationTriggers(facts, {
    hasDiarization,
    utteranceTexts,
    transcriptSignals: collectStatusSignals(transcript.map(u => u.text)),
    asrConfidence: asrConfidence.size > 0 ? asrConfidence : undefined,
  });

  if (triggers.length === 0) {
    // Selective fast path: verification NOT invoked.
    return {
      facts: [...facts],
      applied: [],
      untouchedFactIds: facts.map(f => f.id),
      refusedDecisions: [],
      triggered: false,
      triggerCount: 0,
      triggers: [],
      telemetry: {
        triggered: false,
        triggerTypes: [],
        decisionsByOutcome: {},
        latencyMs: 0,
      },
    };
  }

  const context = buildVerificationContext(facts, transcript);
  const verification = verifyFacts(facts, triggers, context);

  // Provenance integrity must hold unconditionally.
  assertDecisionIntegrity(verification, context);

  const applied = applyVerificationDecisions(facts, verification);

  const decisionsByOutcome: Record<string, number> = {};
  for (const d of verification.decisions) {
    decisionsByOutcome[d.outcome] = (decisionsByOutcome[d.outcome] ?? 0) + 1;
  }

  return {
    ...applied,
    triggered: true,
    triggerCount: triggers.length,
    triggers,
    verification,
    telemetry: {
      triggered: true,
      triggerTypes: triggers.map(t => t.trigger),
      decisionsByOutcome,
      latencyMs: verification.latencyMs,
    },
  };
}
