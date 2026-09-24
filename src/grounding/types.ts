/**
 * Type Contracts for Deterministic Source Grounding & Evidentiary Verification (Work Package 3.0)
 *
 * Implements strict evidentiary verification standards under:
 * - Dental Board of Australia (DBA) Code of Conduct
 * - Rogers v Whitaker (1992) 175 CLR 479 informed consent standards
 * - Australian Privacy Principle 8 (APP 8)
 * - Zero-hallucination / zero-fabrication clinical safety rules
 */

export interface TimestampedUtterance {
  id: string;
  sender: 'Dentist' | 'Patient' | 'Assistant' | 'Dialogue';
  text: string;
  /** Millisecond offset from start of consultation recording */
  startTimeMs: number;
  endTimeMs: number;
  /** Audio slice ID in persistent storage (e.g. chunk-001) */
  audioSliceId?: string;
}

export type ClinicalClaimCategory =
  | 'tooth'
  | 'surface'
  | 'diagnosis'
  | 'procedure'
  | 'material'
  | 'anaesthetic'
  | 'drug_dosage'
  | 'medical_history'
  | 'allergy'
  | 'risk_warning'
  | 'patient_consent';

export interface GroundedClaim {
  claimId: string;
  category: ClinicalClaimCategory;
  text: string;
  section: string;
  /** Whether the claim is corroborated by verbatim audio in transcript */
  isCorroborated: boolean;
  /** Grounding confidence score: 0.00 to 1.00 */
  confidenceScore: number;
  /** Bound audio evidence */
  evidence?: {
    utteranceId: string;
    speaker: string;
    verbatimText: string;
    startTimeMs: number;
    endTimeMs: number;
    audioSliceId?: string;
  };
  /** Explanatory status note */
  verificationNote: string;
}

export interface SubsecondAlignmentResult {
  totalClaimsCount: number;
  corroboratedCount: number;
  unverifiedCount: number;
  overallGroundingScore: number; // 0.00 to 1.00
  isFullyGrounded: boolean;
  claims: GroundedClaim[];
  /** Receptionist-friendly badge label adhering to Rule 9 (e.g. "Verified from Audio") */
  statusBadge: 'Verified from Audio' | 'Clinician Verification Required' | 'Unverified Claims Detected';
}

export interface OmissionAlert {
  alertId: string;
  entityType: 'allergy' | 'medication' | 'systemic_condition' | 'reported_pain' | 'discussed_tooth';
  entityName: string;
  spokenInUtterance: {
    utteranceId: string;
    speaker: string;
    verbatimText: string;
    timestampMs: number;
  };
  severity: 'critical' | 'high' | 'warning';
  title: string;
  reconciliationPrompt: string;
}

export interface BackwardReconciliationResult {
  hasCriticalOmissions: boolean;
  omissionsCount: number;
  detectedSpokenEntities: {
    allergies: string[];
    medications: string[];
    conditions: string[];
    teeth: number[];
  };
  omissions: OmissionAlert[];
}

export interface RogersRiskDiscussion {
  riskType:
    | 'nerve_damage_paresthesia'
    | 'sinus_perforation'
    | 'excessive_bleeding'
    | 'dry_socket'
    | 'tooth_fracture'
    | 'pulp_necrosis'
    | 'post_op_pain_infection'
    | 'restoration_failure'
    | 'general_surgical_risk';
  riskLabel: string;
  explainedByClinician: boolean;
  acknowledgedByPatient: boolean;
  clinicianUtterance?: TimestampedUtterance;
  patientUtterance?: TimestampedUtterance;
}

export interface RogersConsentVerification {
  procedureName: string;
  isInvasiveProcedure: boolean;
  requiresWrittenConsent: boolean;
  /** Whether the consent documented in notes is grounded in transcript or fabricated */
  isLegallyCorroborated: boolean;
  isBoilerplateFabrication: boolean;
  materialRisksDiscussed: RogersRiskDiscussion[];
  alternativesDiscussed: {
    alternative: string;
    corroborated: boolean;
    utterance?: TimestampedUtterance;
  }[];
  costDiscussed: boolean;
  patientAgreementGrounded: boolean;
  evidentiarySummary: string;
  legalDefensibilityGrade: 'A_Defensible' | 'B_Conditional' | 'C_Vulnerable' | 'D_NonCompliant';
}

export interface UnifiedGroundingAudit {
  consultationId: string;
  alignment: SubsecondAlignmentResult;
  reconciliation: BackwardReconciliationResult;
  rogersConsent?: RogersConsentVerification;
  isApprovedForSigning: boolean;
  blockingReasons: string[];
}
