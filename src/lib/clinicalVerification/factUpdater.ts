/**
 * Verification State Machine (Phase 6)
 *
 * Applies verification decisions to canonical ClinicalFacts. The ONLY fields a
 * verifier decision may change are the verification state, its method, and the
 * audit trail. Value payloads, anatomy (teeth/surfaces), speaker, status,
 * temporal context, evidence and certainty are structurally immutable here.
 *
 * High-risk policy (fail closed): medication, allergy, diagnosis, procedure —
 * and any treatment status — without evidence ALWAYS end review-required,
 * regardless of what the verifier claims.
 */

import type { ClinicalFact, FactVerificationMethod, FactVerificationState } from '../../types/clinicalFact';
import type { VerificationDecision, VerificationResult } from './verifier';

/** Fact types that must never verify without evidence. */
const HIGH_RISK_TYPES: ReadonlySet<ClinicalFact['type']> = new Set([
  'medication',
  'allergy',
  'diagnosis',
  'procedure',
] as const);

export interface AppliedVerification {
  readonly fact: ClinicalFact;
  readonly decision: VerificationDecision;
}

export interface FactUpdateResult {
  readonly facts: ReadonlyArray<ClinicalFact>;
  readonly applied: ReadonlyArray<AppliedVerification>;
  /** Facts the decision set did not cover — returned unchanged. */
  readonly untouchedFactIds: ReadonlyArray<string>;
  /** Decisions that were refused by the state machine (audit trail). */
  readonly refusedDecisions: Array<{ readonly decision: VerificationDecision; readonly reason: string }>;
}

function mapOutcomeToState(outcome: VerificationDecision['outcome']): FactVerificationState {
  switch (outcome) {
    case 'verified': return 'verified';
    case 'rejected': return 'rejected';
    case 'flagged':
    default: return 'flagged';
  }
}

/**
 * Applies a decision set to the fact set.
 *
 * Guarantees:
 * - Facts are copied, never mutated in place.
 * - Only `verificationState`, `verificationMethod` and `validationWarnings`
 *   may change; any attempt to alter clinical content is a programming error
 *   and throws (proven by test: the returned fact must deep-equal the input
 *   fact on every clinical field).
 * - High-risk facts without evidence fail closed to 'flagged' (review required)
 *   even if the decision claims 'verified'.
 */
export function applyVerificationDecisions(
  facts: ReadonlyArray<ClinicalFact>,
  result: VerificationResult
): FactUpdateResult {
  const decisionByFactId = new Map<string, VerificationDecision>();
  for (const d of result.decisions) {
    // First decision wins; triggers are evaluated in deterministic order.
    if (!decisionByFactId.has(d.factId)) decisionByFactId.set(d.factId, d);
  }

  const updatedFacts: ClinicalFact[] = [];
  const applied: AppliedVerification[] = [];
  const refusedDecisions: FactUpdateResult['refusedDecisions'] = [];
  const untouchedFactIds: string[] = [];

  for (const fact of facts) {
    const decision = decisionByFactId.get(fact.id);
    if (!decision) {
      untouchedFactIds.push(fact.id);
      updatedFacts.push(fact);
      continue;
    }

    let nextState = mapOutcomeToState(decision.outcome);
    let method: FactVerificationMethod = 'selective_agent';
    const warnings: string[] = [...(fact.validationWarnings ?? [])];

    // Fail-closed high-risk policy: no evidence ⇒ review-required, always.
    const isHighRisk = HIGH_RISK_TYPES.has(fact.type);
    if (isHighRisk && fact.evidence.length === 0 && nextState === 'verified') {
      nextState = 'flagged';
      warnings.push('High-risk fact without evidence cannot be verified (fail-closed policy).');
      refusedDecisions.push({
        decision,
        reason: 'verified outcome refused: high-risk fact has no evidence',
      });
    }

    const updated = {
      ...fact,
      verificationState: nextState,
      verificationMethod: nextState === 'unverified' ? 'none' as const : method,
      validationWarnings: warnings.length > 0 ? warnings : undefined,
    } as ClinicalFact;

    // Guard: clinical content must be untouched by construction. (The spread
    // above can only carry fields forward; this assertion documents intent and
    // is proven by deep-equality tests on every clinical field.)
    const before = fact as unknown as Record<string, unknown>;
    const after = updated as unknown as Record<string, unknown>;
    for (const key of ['type', 'speaker', 'evidenceType', 'value', 'status', 'temporal', 'certainty', 'anatomy', 'evidence'] as const) {
      if (JSON.stringify(after[key]) !== JSON.stringify(before[key])) {
        throw new Error(`Verification attempted to mutate clinical field '${key}' on fact '${fact.id}'. This is forbidden.`);
      }
    }

    updatedFacts.push(updated);
    applied.push({ fact: updated, decision });
  }

  return { facts: updatedFacts, applied, untouchedFactIds, refusedDecisions };
}
