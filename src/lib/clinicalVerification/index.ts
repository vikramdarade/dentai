/**
 * Selective Clinical Verification (Phase 6) — public surface.
 *
 * Architecture:
 *   ClinicalFact[] + transcript
 *     → evaluateVerificationTriggers (deterministic, selective)
 *     → buildVerificationContext (minimal evidence windows)
 *     → verifyFacts (evidence-grounded structured decisions)
 *     → applyVerificationDecisions (state machine, fail-closed)
 *
 * Safety invariants live in verifier.ts and factUpdater.ts and are proven by
 * tests/clinicalVerification.test.ts.
 */

export {
  evaluateVerificationTriggers,
  type VerificationTrigger,
  type VerificationTriggerType,
  type VerificationTriggerSeverity,
} from './triggers';

export {
  buildVerificationContext,
  type VerificationContext,
  type VerificationUtterance,
} from './context';

export {
  verifyFacts,
  assertDecisionIntegrity,
  type VerificationDecision,
  type VerificationDecisionOutcome,
  type VerificationResult,
} from './verifier';

export {
  applyVerificationDecisions,
  type AppliedVerification,
  type FactUpdateResult,
} from './factUpdater';

export {
  runSelectiveVerificationPass,
  type PipelineRunResult,
  type PipelineInput,
} from './pipeline';
