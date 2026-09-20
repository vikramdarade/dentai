import type { AppointmentType } from './lib/dentalLibrary';
import type { GroundingReport } from './lib/transcriptGrounding';

export type { AppointmentType };

export interface TranscriptProvenance {
  /**
   * 'none' is a real state, not a failure: nothing was captured, and the note
   * must say so rather than implying a transcript exists.
   */
  source: 'server-diarized' | 'browser-live' | 'manual' | 'none';
  /** Model that produced the transcript, when it came from recorded audio. */
  modelId?: string;
  chairId?: string;
  generatedAt?: string;
  durationSeconds?: number;
  chunks?: number;
  /** Chunks that never arrived. Non-zero means missing speech. */
  missingChunks?: number;
  contiguous?: boolean;
  speakerCounts?: Record<string, number>;
  /** Operator-facing caveats, carried with the record rather than only shown once. */
  warnings?: string[];
}

export interface TranscriptItem {
  sender: 'Dentist' | 'Patient' | 'Dialogue' | 'Clinical Comment';
  text: string;
}

export interface AdaCodeItem {
  code: string;
  description: string;
  tooth?: string;
}

export type TreatmentStatus = 'unscheduled' | 'contacted' | 'booked' | 'completed' | 'declined';

export type PmsType = 'cliniko' | 'corepractice' | 'd4w' | 'exact' | 'dentrix' | 'other';

export interface TreatmentOpportunity {
  id: string;
  consultationId: string;
  dentistId: string;
  clinicId?: string;
  patientName: string;
  patientPhone?: string;
  patientEmail?: string;
  tooth?: string; // FDI notation e.g. "16"
  surfaces?: string; // e.g. "MOD"
  adaCode: string; // e.g. "611"
  procedureName: string; // e.g. "Full Crown - Ceramic"
  estimatedFee: number; // e.g. 1650
  clinicalReason: string;
  patientBarrier?: string;
  status: TreatmentStatus;
  lastContactedAt?: string;
  bookedAt?: string;
  createdAt: string;
  // Closed-loop PMS verification fields
  pmsType?: PmsType;
  pmsAppointmentId?: string;
  pmsBookingRef?: string;
  pmsSyncStatus?: 'unlinked' | 'verified' | 'auto_synced';
}

export interface PracticeRoiSummary {
  clinicId: string;
  month: string;
  totalIdentifiedValue: number;
  totalBookedValue: number;
  totalCompletedValue: number;
  unscheduledCount: number;
  bookedCount: number;
  declinedCount?: number;
  declinedValue?: number;
  subscriptionCost: number;
  netRoiMultiple: number;
  // Closed-loop verified metrics
  verifiedBookedValue?: number;
  verifiedBookedCount?: number;
  conversionRatePct?: number;
  averageDaysToBook?: number;
}

export interface SpecialistReferral {
  required: boolean;
  specialty?: 'Endodontics' | 'Periodontics' | 'Oral & Maxillofacial Surgery' | 'Orthodontics' | 'Prosthodontics' | 'Paediatric Dentistry' | 'General Referral';
  specialistName?: string;
  recipientClinic?: string;
  teethInvolved?: string[]; // FDI notation e.g. ["16"]
  urgency?: 'Routine' | 'Urgent' | 'Immediate (Emergency)';
  clinicalQuestion: string; // e.g. "Assessment and root canal therapy for tooth 16"
  backgroundAndFindings: string; // concise clinical summary, pulp vitality, radiographic signs
  provisionalDiagnosis: string;
  interimTreatmentProvided?: string; // e.g. "Pulp extirpation under rubber dam, ledermix dressing placed"
  medicalAlerts?: string;
  letterText: string; // ready-to-send formal referral letter
}

export interface PatientConsentOption {
  optionName: string;
  benefits: string;
  risks: string;
  estimatedCost?: string;
}

export interface PatientConsentAndCare {
  plainSummary: string;
  optionsDiscussed: PatientConsentOption[];
  risksOfNoTreatment: string;
  postOpCareInstructions: string;
  redFlagsWarning: string;
  consentStatus?: 'discussed_pending_signature' | 'verbally_consented' | 'written_consent_signed';
}

export interface TreatmentQuoteItem {
  adaCode: string;
  description: string;
  tooth?: string;
  fee: number;
  healthFundEstimatedRebate: number;
  gapEstimate: number;
  category: 'Diagnostic' | 'Preventive' | 'Periodontics' | 'Endodontics' | 'Restorative' | 'Crown & Bridge' | 'Surgery' | 'Orthodontics';
}

export interface TreatmentQuoteData {
  items: TreatmentQuoteItem[];
  totalFee: number;
  estimatedRebate: number;
  netGap: number;
  visualCaseCategory?: 'crown' | 'implant' | 'endo' | 'veneer' | 'aligner' | 'perio' | 'general';
  rebateMode?: 'practice_fees_only' | 'show_rebate_estimate';
  rebateDisclaimer?: string;
  phasedMilestones?: Array<{
    phaseNumber: number;
    phaseTitle: string;
    items: string[];
    totalPhaseFee: number;
  }>;
}

export interface ClinicalFindings {
  chiefComplaint: string;
  history: string;
  toothFindings: string;
  findingsGingival: string;
  diagnosis: string;
  treatmentPerformed: string;
  recommendations: string;
  recallRequirements: string;
  customSections?: Record<string, string>;
  adaCodes?: AdaCodeItem[];
  proposedTreatments?: TreatmentOpportunity[];
}

/** How the note content in this record was produced — surfaced transparently in the UI. */
export interface NoteOrigin {
  engine: 'gemini' | 'offline-draft' | 'on-device';
  /** True when the content was auto-generated by a fallback path and needs clinician review. */
  needsReview: boolean;
  /** Short human note, e.g. 'Generated while Gemini quota was exhausted'. */
  detail?: string;
  /** Model/engine identifier that produced the content (audit provenance). */
  modelId?: string;
  /** When generation happened (ISO). */
  generatedAt?: string;
  /** Disclosure version the patient was shown when this content was captured. */
  disclosureVersion?: string;
}

/**
 * Patient consent to AI-assisted charting, captured before a recording starts.
 * Stored with the consultation so the clinic can evidence what the patient was
 * told and when (APP 3/5 — see the in-app notice in src/components/LegalPage.tsx
 * and docs/legal/data-flow-and-subprocessors.md).
 */
export interface ConsultationConsent {
  /** ISO timestamp of the verbal consent. */
  obtainedAt: string;
  /** Which disclosure wording was used (src/lib/compliance.ts). */
  disclosureVersion: string;
  /** Who recorded it. */
  recordedBy: string;
}

/**
 * One saved revision of a consultation. Clinical records are append-only in
 * intent: the current state is the consultation body, and every save appends
 * who changed it and when, so an edit can never silently rewrite history.
 */
export interface ConsultationRevision {
  id: string;
  savedAt: string;
  savedBy: string;
  engine?: NoteOrigin['engine'];
  /** True when this revision was written by the async AI worker. */
  systemGenerated?: boolean;
}

/**
 * Engine-agnostic note payload produced by every note source (hosted Gemini,
 * secondary key, offline draft engine, on-device WebLLM). `canonical` holds
 * the eight standard clinical fields; `customSections` holds any additional
 * template-specific sections.
 */
export interface GeneratedNotePayload {
  engine?: 'gemini' | 'offline-draft' | 'on-device';
  modelId?: string;
  canonical: Record<string, string>;
  customSections: Record<string, string>;
  patientSummary: string;
  adaCodes: AdaCodeItem[];
  proposedTreatments?: TreatmentOpportunity[];
  specialistReferral?: SpecialistReferral;
  patientConsent?: PatientConsentAndCare;
  treatmentQuote?: TreatmentQuoteData;
}

export interface Consultation {
  id: string;
  dentistId?: string;
  dentistName?: string;
  /** Clinic this consultation was recorded in (stamped server-side). */
  clinicId?: string;
  /**
   * Registry id of the patient this record belongs to.
   *
   * Absent means patient identity was not established — either the record
   * predates the registry, or several same-named patients exist and a human has
   * not yet confirmed which one this is. Consumers must treat an absent id as
   * "unknown patient": never fall back to matching on the name, because that is
   * how one patient's history ended up on another patient's chart.
   */
  patientId?: string;
  /**
   * True when same-named patients exist and one must be confirmed by a human
   * before this record is attached to a chart. The record is still saved —
   * clinical work is never discarded over an identity question.
   */
  identityNeedsReview?: boolean;
  /**
   * ISO timestamp of when the record was created.
   *
   * `date`/`time` below are display labels ("Oct 24", no year) and cannot be
   * ordered reliably — "Oct 1" sorts before "Sep 19". Anything that needs
   * chronological order (prior-visit history, retention, the audit trail) must
   * use a real timestamp.
   */
  createdAt?: string;
  firstName: string;
  lastName: string;
  dob: string;
  appointmentType: AppointmentType;
  date: string; // e.g., 'Oct 24'
  time: string; // e.g., '09:45 AM'
  status: 'Completed' | 'In Review';
  transcript: TranscriptItem[];
  findings: ClinicalFindings;
  patientSummary: string;
  templateId?: string;
  noteOrigin?: NoteOrigin;
  /**
   * Deterministic verification of the generated note against the spoken
   * transcript (every tooth, surface, material, drug and ADA code cross-checked).
   * Stored with the record so the clinician can see which claims in an
   * AI-drafted note were not actually spoken — and so a later reviewer can.
   */
  grounding?: GroundingReport;
  /**
   * Which capture produced `transcript`, and how good it was.
   *
   * A note's accuracy claim is only as good as its transcript, and the two
   * capture paths are not equivalent: recorded audio is diarized (dentist and
   * patient separated), live speech recognition is not. Recording the source
   * means a later reviewer can tell why a section looks the way it does — and it
   * is what lets `/api/transcribe` avoid paying twice for the same recording.
   */
  transcriptProvenance?: TranscriptProvenance;
  /** AI-assist consent captured at intake (required for new records). */
  consent?: ConsultationConsent;
  /** Append-only revision trail (server-maintained). */
  revisions?: ConsultationRevision[];
  // Treatment-revenue surface (revenue engine, quote and referral pipeline).
  proposedTreatments?: TreatmentOpportunity[];
  specialistReferral?: SpecialistReferral;
  patientConsent?: PatientConsentAndCare;
  treatmentQuote?: TreatmentQuoteData;
}

export const getTodayStr = (when: Date = new Date()) => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[when.getMonth()]} ${when.getDate()}`;
};

export const getYesterdayStr = () => {
  const dateObj = new Date();
  dateObj.setDate(dateObj.getDate() - 1);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[dateObj.getMonth()]} ${dateObj.getDate()}`;
};

export const getCurrentTimeStr = (when: Date = new Date()) => {
  const minutes = when.getMinutes().toString().padStart(2, '0');
  let hours = when.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours.toString().padStart(2, '0')}:${minutes} ${ampm}`;
};
