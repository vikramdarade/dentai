/**
 * Selective Clinical Verifier (Phase 6)
 *
 * Evidence-grounded decision engine over canonical ClinicalFacts. Invoked ONLY
 * for facts flagged by the deterministic trigger matrix — never routinely.
 *
 * HARD SAFETY INVARIANTS (enforced structurally and by assertion):
 * 1. The verifier CANNOT invent clinical content. The decision type carries no
 *    value/tooth/medication/speaker payload at all — only an outcome, reason
 *    and references to evidence examined. There is no field it could populate
 *    with an invented tooth, dose, medication, diagnosis or procedure.
 * 2. The verifier CANNOT manufacture provenance. Decisions reference existing
 *    evidence utterance ids; any reference to an utterance that is not in the
 *    supplied context is rejected.
 * 3. The verifier CANNOT produce the final clinical note. Its output is a
 *    per-fact decision; note rendering is a separate, downstream concern.
 * 4. Rejection and ambiguity ALWAYS fail closed to review-required states.
 */

import type { ClinicalFact } from '../../types/clinicalFact';
import type { VerificationContext } from './context';

/** Outcome of a single verification decision. */
export type VerificationDecisionOutcome =
  | 'verified'      // evidence supports the fact as recorded
  | 'flagged'       // ambiguity or conflict remains — clinician must review
  | 'rejected';     // evidence contradicts the fact as recorded

export interface VerificationDecision {
  readonly factId: string;
  readonly outcome: VerificationDecisionOutcome;
  /** Evidence-grounded explanation; references evidence, never invents content. */
  readonly reason: string;
  /** Utterance ids in the supplied context that the decision relied on. */
  readonly evidenceUtteranceIds: ReadonlyArray<string>;
  /** Trigger that prompted this decision (auditability). */
  readonly trigger: string;
}

/** Structured result of a verification run. */
export interface VerificationResult {
  readonly decisions: ReadonlyArray<VerificationDecision>;
  /** Facts for which no decision was produced (never silently dropped). */
  readonly undecidedFactIds: ReadonlyArray<string>;
  /** Wall-clock verification latency in ms (observable, PHI-free). */
  readonly latencyMs: number;
}

/**
 * Normative text comparison: light stemming so inflection ("feels"/"feel")
 * does not defeat a genuine evidence match. Both sides normalised identically.
 */
function normaliseForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(w => (w.length >= 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ');
}

/**
 * Deterministic evidence-grounded verifier core.
 *
 * This function implements the conservative decision policy that the Phase 6
 * safety invariants demand. It examines ONLY the supplied evidence context and
 * the fact as recorded; it never fabricates an alternative interpretation. A
 * future LLM-backed verifier (if ever added) must return the SAME decision
 * shape and pass the SAME assertion contract below.
 */
export function verifyFacts(
  facts: ReadonlyArray<ClinicalFact>,
  triggers: ReadonlyArray<{ trigger: string; factIds: ReadonlyArray<string>; severity: string; reason: string }>,
  context: VerificationContext
): VerificationResult {
  const started = Date.now();
  const decisions: VerificationDecision[] = [];
  const decidedFactIds = new Set<string>();

  const utteranceById = new Map(context.utterances.map(u => [u.id, u]));

  for (const trigger of triggers) {
    for (const factId of trigger.factIds) {
      if (decidedFactIds.has(factId)) continue;
      const fact = facts.find(f => f.id === factId);
      if (!fact) continue;

      // Provenance integrity: every referenced utterance must exist in the
      // context actually supplied to the verifier. A verifier that claims to
      // have examined utterances it never received is manufacturing evidence.
      const evidenceIds = fact.evidence.map(span => span.utteranceId);
      const knownIds = evidenceIds.filter(id => utteranceById.has(id));
      if (evidenceIds.length > 0 && knownIds.length === 0) {
        decisions.push({
          factId,
          outcome: 'flagged',
          trigger: trigger.trigger,
          reason: 'No evidence utterances were available in the verification context; the fact remains unverified pending clinician review.',
          evidenceUtteranceIds: [],
        });
        decidedFactIds.add(factId);
        continue;
      }

      // Evidence-grounded corroboration: does the evidence text still support
      // the fact's core assertion? Conservative token corroboration against
      // the fact's own recorded value fields — the verifier never proposes a
      // different value, so it can never invent one.
      const factText = normaliseForMatch(JSON.stringify(fact.value ?? {}));
      const evidenceText = knownIds
        .map(id => normaliseForMatch(utteranceById.get(id)!.text))
        .join(' ');

      let outcome: VerificationDecisionOutcome;
      let reason: string;

      const evidenceHasNegation = /\b(no|not|denies|denied|without)\b/i.test(evidenceText);

      if (fact.status !== 'negated' && evidenceHasNegation) {
        // SAFETY (negation handling): evidence containing a negation cue can
        // never corroborate a positively-asserted fact. "No caries detected"
        // must not verify a caries finding. Always fail to review.
        outcome = 'flagged';
        reason = `Evidence contains a negation cue while the fact asserts '${fact.status}'; clinician must confirm whether the finding is positive or negated.`;
      } else if (fact.status === 'negated') {
        // Negated facts verify when the negation cue is present in evidence.
        const hasNegation = /\b(no|not|denies|denied|without)\b/i.test(evidenceText);
        outcome = hasNegation ? 'verified' : 'flagged';
        reason = hasNegation
          ? 'Evidence contains the negation the fact records.'
          : 'Negated fact lacks a negation cue in available evidence; clinician must confirm.';
      } else {
        const tokens = factText.split(' ').filter(w => w.length > 3);
        const corroborated = tokens.length === 0
          ? evidenceText.length > 0
          : tokens.filter(w => evidenceText.includes(w)).length / tokens.length >= 0.5;
        if (trigger.severity === 'critical') {
          // Critical conflicts (performed-vs-negated, dose, allergy, promoted
          // statements) are never cleared by corroboration alone — the
          // deterministic layer already established a contradiction.
          outcome = 'flagged';
          reason = `Critical trigger '${trigger.trigger}' requires clinician review even though evidence corroboration is ${corroborated ? 'present' : 'absent'}.`;
        } else if (corroborated) {
          outcome = 'verified';
          reason = `Evidence in the verification context corroborates the recorded assertion (trigger '${trigger.trigger}').`;
        } else {
          outcome = 'flagged';
          reason = `Evidence available does not corroborate the recorded assertion (trigger '${trigger.trigger}'); clinician must review.`;
        }
      }

      decisions.push({
        factId,
        outcome,
        reason,
        evidenceUtteranceIds: knownIds,
        trigger: trigger.trigger,
      });
      decidedFactIds.add(factId);
    }
  }

  return {
    decisions,
    undecidedFactIds: facts
      .filter(f => !decidedFactIds.has(f.id))
      .map(f => f.id),
    latencyMs: Date.now() - started,
  };
}

/**
 * Safety contract assertion (invariant enforcement): a decision set is valid
 * only if every decision references only utterances present in the context.
 * Throws on violation — used in tests to prove no-invention of provenance.
 */
export function assertDecisionIntegrity(
  result: VerificationResult,
  context: VerificationContext
): void {
  const known = new Set(context.utterances.map(u => u.id));
  for (const d of result.decisions) {
    for (const id of d.evidenceUtteranceIds) {
      if (!known.has(id)) {
        throw new Error(`Decision for fact '${d.factId}' references utterance '${id}' that was never supplied to the verifier.`);
      }
    }
  }
}
