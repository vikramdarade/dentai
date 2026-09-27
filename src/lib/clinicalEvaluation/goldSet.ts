/**
 * Phase 8 Gold-Set Corpus — representative + adversarial + regression cases.
 *
 * PROVENANCE (docs/GOLD_SET_SPECIFICATION.md): every case in this corpus is
 * fully SYNTHETIC. No real patient data, no recorded consultations, no derived
 * PHI. Transcripts are authored clinical dialogue; expected facts are authored
 * FROM those transcripts by construction (each expected fact cites the
 * utterance that grounds it). Generation is deterministic and seeded — two
 * builds are byte-identical.
 *
 * Structure (Phase 8 regression policy):
 *   REPRESENTATIVE_CASES  — one per major clinical domain (21 domains)
 *   ADVERSARIAL_CASES     — explicit hard categories (negation, double
 *                           negation, speculation, questions, indirect speech,
 *                           historical, future, cancelled, declined, performed
 *                           elsewhere, tooth ambiguity, similar-sounding
 *                           teeth, non-FDI, surface ambiguity, dose ambiguity,
 *                           multiple speakers, overlapping dialogue, background
 *                           speech, corrections, self-corrections,
 *                           contradictions, low-ASR confidence)
 *   REGRESSION_CASES      — permanent fixtures for every production defect that
 *                           reached clinical evaluation in Phases 5–7.
 */

import type { ClinicalEvaluationCase, EvaluationTranscript, ExpectedClinicalFact } from './types';

export const GOLD_SET_VERSION = 'v2.0.0-phase8';

type Domain =
  | 'routine_examination' | 'emergency' | 'restorative' | 'endodontic'
  | 'periodontal' | 'prosthodontic' | 'oral_surgery' | 'implant'
  | 'paediatric' | 'orthodontic' | 'hygiene_preventive' | 'referral'
  | 'recall' | 'medical_history' | 'medications' | 'allergies'
  | 'consent' | 'treatment_plans' | 'declined_treatment'
  | 'historical_treatment' | 'postoperative_instructions';

type AdversarialCategory =
  | 'negation' | 'double_negation' | 'patient_speculation' | 'patient_questions'
  | 'clinician_questions' | 'indirect_speech' | 'historical_events' | 'future_plans'
  | 'cancelled_treatment' | 'declined_treatment' | 'performed_elsewhere'
  | 'ambiguous_tooth_numbers' | 'similar_sounding_teeth' | 'fdi_vs_nonfdi'
  | 'surface_ambiguity' | 'dose_ambiguity' | 'multiple_speakers'
  | 'overlapping_dialogue' | 'background_speech' | 'corrections_mid_sentence'
  | 'self_corrections' | 'contradictory_statements' | 'low_asr_confidence';

// ---------------------------------------------------------------------------
// Authoring helpers — every expected fact cites its grounding utterance
// ---------------------------------------------------------------------------

/**
 * Stateless sequential ID — derives from the corpus position, never from
 * module-level mutable state. Two builds in the same process (or across
 * processes) must always produce byte-identical IDs.
 */
function nextId(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}
let caseSeq = 0;
function transcriptCase(input: {
  domain: string;
  category: ClinicalEvaluationCase['category'];
  difficulty: ClinicalEvaluationCase['difficulty'];
  adversarial?: boolean;
  description: string;
  transcript: EvaluationTranscript;
  expectedFacts: ReadonlyArray<ExpectedClinicalFact>;
  tags?: string[];
  rationale?: string;
}): ClinicalEvaluationCase {  caseSeq += 1;
  return {
    id: nextId('gold', caseSeq),
    datasetVersion: GOLD_SET_VERSION,
    description: input.description,
    category: input.category,
    difficulty: input.difficulty,
    isAdversarial: input.adversarial ?? false,
    clinicalDomain: input.domain,
    transcript: input.transcript,
    expectedFacts: input.expectedFacts,
    tags: input.tags,
    rationale: input.rationale,
  };
}

function ut(id: string, speaker: string, text: string, startMs?: number) {
  return { utteranceId: id, speaker, text, startMs, endMs: startMs !== undefined ? startMs + 3000 : undefined };
}

function ef(
  type: ExpectedClinicalFact['type'],
  speaker: ExpectedClinicalFact['speaker'],
  evidenceType: ExpectedClinicalFact['evidenceType'],
  value: unknown,
  status: ExpectedClinicalFact['status'],
  temporal: ExpectedClinicalFact['temporal'],
  certainty: ExpectedClinicalFact['certainty'],
  opts: { teeth?: number[]; surfaces?: string[]; evidence?: string[] } = {}
): ExpectedClinicalFact {
  return {
    type,
    speaker,
    evidenceType,
    value: value as never,
    status,
    temporal,
    certainty,
    anatomy: opts.teeth ? { teeth: opts.teeth, surfaces: opts.surfaces as never } : undefined,
    expectedEvidenceKeywords: opts.evidence,
  } as ExpectedClinicalFact;
}



// Convenience fact builders (all cite evidence keywords from the transcript)
const patientSaid = (
  type: ExpectedClinicalFact['type'],
  value: unknown,
  status: ExpectedClinicalFact['status'] = 'reported',
  opts: { teeth?: number[]; surfaces?: string[]; evidence?: string[]; temporal?: ExpectedClinicalFact['temporal'] } = {}
) => ef(type, 'patient', 'patient_reported', value, status, opts.temporal ?? 'current', 'certain', opts);

const clinicianObserved = (
  type: ExpectedClinicalFact['type'],
  value: unknown,
  status: ExpectedClinicalFact['status'] = 'observed',
  opts: { teeth?: number[]; surfaces?: string[]; evidence?: string[]; temporal?: ExpectedClinicalFact['temporal'] } = {}
) => ef(type, 'clinician', 'clinician_observed', value, status, opts.temporal ?? 'current', 'certain', opts);

const clinicianPerformed = (
  type: ExpectedClinicalFact['type'],
  value: unknown,
  opts: { teeth?: number[]; surfaces?: string[]; evidence?: string[] } = {}
) => ef(type, 'clinician', 'clinician_observed', value, 'performed', 'completed_today', 'certain', opts);

const clinicianPlanned = (
  type: ExpectedClinicalFact['type'],
  value: unknown,
  opts: { teeth?: number[]; evidence?: string[] } = {}
) => ef(type, 'clinician', 'discussion', value, 'planned', 'next_appointment', 'certain', opts);

// ---------------------------------------------------------------------------
// 1. REPRESENTATIVE CASES — 21 clinical domains
// ---------------------------------------------------------------------------

export const REPRESENTATIVE_CASES: ReadonlyArray<ClinicalEvaluationCase> = [
  transcriptCase({
    domain: 'routine_examination',
    category: 'dental_findings',
    difficulty: 'basic',
    description: 'Routine check-up with healthy findings and recall.',
    transcript: [
      ut('u1', 'Patient', 'Just here for my regular check-up.'),
      ut('u2', 'Dentist', 'Everything looks healthy, no caries anywhere.'),
      ut('u3', 'Dentist', 'See you in six months.'),
    ],
    expectedFacts: [
      patientSaid('chief_complaint', { complaint: 'regular check-up' }, 'reported', { evidence: ['regular check-up'] }),
      clinicianObserved('tooth_finding', { condition: 'no caries' }, 'negated', { evidence: ['no caries'] }),
      ef('recall_plan', 'clinician', 'instruction', { intervalMonths: 6 }, 'planned', 'future', 'certain', { evidence: ['six months'] }),
    ],
  }),
  transcriptCase({
    domain: 'emergency',
    category: 'dental_findings',
    difficulty: 'intermediate',
    description: 'Emergency presentation with severe pain and diagnosis.',
    transcript: [
      ut('u1', 'Patient', 'I have terrible throbbing pain in my lower left, keeping me awake at night.'),
      ut('u2', 'Dentist', 'Tooth 36 is tender to percussion and the gum is swollen.'),
      ut('u3', 'Dentist', 'This is an acute apical abscess on 36.'),
      ut('u4', 'Dentist', 'I will drain it and start root canal treatment next visit.'),
    ],
    expectedFacts: [
      patientSaid('symptom', { description: 'throbbing pain' }, 'reported', { evidence: ['throbbing pain'] }),
      clinicianObserved('tooth_finding', { condition: 'pain on percussion' }, 'observed', { teeth: [36], evidence: ['tender to percussion'] }),
      clinicianObserved('tooth_finding', { condition: 'swelling' }, 'observed', { teeth: [36], evidence: ['swollen'] }),
      ef('diagnosis', 'clinician', 'clinician_interpretation', { condition: 'acute apical abscess', provisional: false }, 'observed', 'current', 'certain', { teeth: [36], evidence: ['acute apical abscess'] }),
      clinicianPlanned('procedure', { name: 'drainage' }, { teeth: [36], evidence: ['drain it'] }),
      clinicianPlanned('procedure', { name: 'root canal treatment' }, { teeth: [36], evidence: ['root canal treatment next visit'] }),
    ],
  }),
  transcriptCase({
    domain: 'restorative',
    category: 'procedures',
    difficulty: 'intermediate',
    description: 'Two-surface composite restoration performed today.',
    transcript: [
      ut('u1', 'Dentist', 'We are restoring tooth 26 mesial and occlusal today with composite.'),
      ut('u2', 'Dentist', 'Giving articaine infiltration.'),
      ut('u3', 'Dentist', 'Composite placed and cured, occlusion checked.'),
    ],
    expectedFacts: [
      clinicianPerformed('procedure', { name: 'composite restoration' }, { teeth: [26], surfaces: ['M', 'O'], evidence: ['restoring tooth 26'] }),
      clinicianPerformed('anaesthetic', { agent: '4% Articaine', technique: 'infiltration' }, { evidence: ['articaine infiltration'] }),
      clinicianObserved('tooth_finding', { condition: 'caries' }, 'observed', { teeth: [26], surfaces: ['M', 'O'], evidence: ['restoring tooth 26'] }),
    ],
  }),
  transcriptCase({
    domain: 'endodontic',
    category: 'procedures',
    difficulty: 'intermediate',
    description: 'Pulp extirpation under rubber dam.',
    transcript: [
      ut('u1', 'Dentist', 'Irreversible pulpitis on tooth 46, we will start root canal today.'),
      ut('u2', 'Dentist', 'Rubber dam on, access cavity prepared, pulp extirpated.'),
      ut('u3', 'Dentist', 'Odontopaste dressing placed, review in one week.'),
    ],
    expectedFacts: [
      ef('diagnosis', 'clinician', 'clinician_interpretation', { condition: 'irreversible pulpitis', provisional: false }, 'observed', 'current', 'certain', { teeth: [46], evidence: ['irreversible pulpitis'] }),
      clinicianPerformed('procedure', { name: 'pulp extirpation', isolation: 'Rubber dam' }, { teeth: [46], evidence: ['pulp extirpated'] }),
      clinicianPerformed('procedure', { name: 'root canal treatment' }, { teeth: [46], evidence: ['start root canal today'] }),
      clinicianPerformed('material', { name: 'Odontopaste dressing' }, { evidence: ['Odontopaste'] }),
      ef('follow_up', 'clinician', 'instruction', { timeframe: '1 week', action: 'review' }, 'planned', 'future', 'certain', { evidence: ['one week'] }),
    ],
  }),
  transcriptCase({
    domain: 'periodontal',
    category: 'dental_findings',
    difficulty: 'intermediate',
    description: 'Periodontal assessment with BPE and debridement plan.',
    transcript: [
      ut('u1', 'Dentist', 'Generalised BPE threes with bleeding on probing and subgingival calculus.'),
      ut('u2', 'Dentist', 'This is chronic periodontitis, generalised moderate.'),
      ut('u3', 'Dentist', 'We will do quadrant scaling under local next visit.'),
    ],
    expectedFacts: [
      clinicianObserved('periodontal_finding', { bpeScores: '3,3,3,3,3,3', bleedingOnProbing: true, calculus: 'subgingival' }, 'observed', { evidence: ['BPE threes'] }),
      ef('diagnosis', 'clinician', 'clinician_interpretation', { condition: 'periodontitis', provisional: false }, 'observed', 'current', 'certain', { evidence: ['chronic periodontitis'] }),
      clinicianPlanned('procedure', { name: 'quadrant scaling' }, { evidence: ['quadrant scaling'] }),
    ],
  }),
  transcriptCase({
    domain: 'prosthodontic',
    category: 'procedures',
    difficulty: 'intermediate',
    description: 'Crown preparation and temporisation.',
    transcript: [
      ut('u1', 'Dentist', 'Preparing tooth 15 for a full ceramic crown today.'),
      ut('u2', 'Dentist', 'Impressions taken, temporary crown cemented.'),
    ],
    expectedFacts: [
      // The anaphora rule attaches the carry-forward tooth only to the
      // tooth-preparation narration; "impressions taken" is unscoped.
      clinicianPerformed('procedure', { name: 'crown preparation' }, { teeth: [15], evidence: ['Preparing tooth 15'] }),
      // Chairside anaphora: the temporisation belongs to the tooth just prepared.
      clinicianPerformed('procedure', { name: 'temporary crown cementation' }, { teeth: [15], evidence: ['temporary crown cemented'] }),
    ],
  }),
  transcriptCase({
    domain: 'oral_surgery',
    category: 'procedures',
    difficulty: 'complex',
    description: 'Surgical extraction with sutures.',
    transcript: [
      ut('u1', 'Dentist', 'Impacted 48, sectioning the tooth and raising a flap.'),
      ut('u2', 'Dentist', 'Tooth delivered, socket curetted, 3-0 vicryl suture placed.'),
    ],
    expectedFacts: [
      clinicianObserved('tooth_finding', { condition: 'impacted third molar' }, 'observed', { teeth: [48], evidence: ['Impacted 48'] }),
      clinicianPerformed('procedure', { name: 'surgical extraction', technique: 'flap raised, tooth sectioned' }, { teeth: [48], evidence: ['sectioning the tooth'] }),
      clinicianPerformed('material', { name: 'vicryl suture' }, { evidence: ['vicryl suture'] }),
    ],
  }),
  transcriptCase({
    domain: 'implant',
    category: 'procedures',
    difficulty: 'complex',
    description: 'Implant fixture placement with follow-up.',
    transcript: [
      ut('u1', 'Dentist', 'Placing the implant fixture at 46 today.'),
      ut('u2', 'Dentist', 'Healing abutment in, review in two weeks.'),
    ],
    expectedFacts: [
      clinicianPerformed('procedure', { name: 'implant fixture placement' }, { teeth: [46], evidence: ['implant fixture at 46'] }),
      clinicianPerformed('procedure', { name: 'healing abutment insertion' }, { teeth: [46], evidence: ['Healing abutment in'] }),
      ef('follow_up', 'clinician', 'instruction', { timeframe: '2 weeks', action: 'review' }, 'planned', 'future', 'certain', { evidence: ['two weeks'] }),
    ],
  }),
  transcriptCase({
    domain: 'paediatric',
    category: 'dental_findings',
    difficulty: 'intermediate',
    description: 'Deciduous tooth restoration (FDI 54).',
    transcript: [
      ut('u1', 'Dentist', 'There is caries in the upper right first baby molar, tooth 54.'),
      ut('u2', 'Dentist', 'We will restore 54 with a filling today.'),
    ],
    expectedFacts: [
      clinicianObserved('tooth_finding', { condition: 'caries' }, 'observed', { teeth: [54], evidence: ['caries in the upper right first baby molar'] }),
      clinicianPerformed('procedure', { name: 'restoration' }, { teeth: [54], evidence: ['restore 54'] }),
    ],
  }),
  transcriptCase({
    domain: 'orthodontic',
    category: 'dental_findings',
    difficulty: 'intermediate',
    description: 'Orthodontic assessment with plan.',
    transcript: [
      ut('u1', 'Dentist', 'There is crowding in the lower anterior region.'),
      ut('u2', 'Dentist', 'We will refer to the orthodontist for an opinion.'),
    ],
    expectedFacts: [
      clinicianObserved('tooth_finding', { condition: 'crowding' }, 'observed', { evidence: ['crowding in the lower anterior'] }),
      ef('referral', 'clinician', 'instruction', { specialty: 'orthodontist', reason: 'clinical assessment' }, 'planned', 'future', 'certain', { evidence: ['refer to the orthodontist'] }),
    ],
  }),
  transcriptCase({
    domain: 'hygiene_preventive',
    category: 'procedures',
    difficulty: 'basic',
    description: 'Scale and clean with hygiene instruction.',
    transcript: [
      ut('u1', 'Dentist', 'Mild generalized gingivitis with supragingival calculus.'),
      ut('u2', 'Dentist', 'Scaling and polishing completed today.'),
      ut('u3', 'Dentist', 'Brush twice daily with fluoride and floss every day.'),
    ],
    expectedFacts: [
      clinicianObserved('periodontal_finding', { diagnosis: 'mild gingivitis', calculus: 'supragingival' }, 'observed', { evidence: ['gingivitis'] }),
      clinicianPerformed('procedure', { name: 'scale and polish' }, { evidence: ['Scaling and polishing'] }),
      ef('oral_hygiene_instruction', 'clinician', 'instruction', { instruction: 'brush twice daily with fluoride, floss daily' }, 'planned', 'future', 'certain', { evidence: ['Brush twice daily'] }),
    ],
  }),
  transcriptCase({
    domain: 'referral',
    category: 'clinical_ambiguity',
    difficulty: 'intermediate',
    description: 'Specialist referral for endodontic assessment.',
    transcript: [
      ut('u1', 'Dentist', 'Calcified canals on 21, I cannot find the canal.'),
      ut('u2', 'Dentist', 'I will refer you to the endodontist.'),
    ],
    expectedFacts: [
      clinicianObserved('tooth_finding', { condition: 'calcified canals' }, 'observed', { teeth: [21], evidence: ['Calcified canals on 21'] }),
      ef('referral', 'clinician', 'instruction', { specialty: 'endodontist', reason: 'clinical assessment' }, 'planned', 'future', 'certain', { teeth: [21], evidence: ['refer you to the endodontist'] }),
    ],
  }),
  transcriptCase({
    domain: 'recall',
    category: 'temporal',
    difficulty: 'basic',
    description: 'Recall interval variation (3 months perio recall).',
    transcript: [
      ut('u1', 'Dentist', 'Your gums need closer monitoring, come back in three months.'),
    ],
    expectedFacts: [
      ef('recall_plan', 'clinician', 'instruction', { intervalMonths: 3 }, 'planned', 'future', 'certain', { evidence: ['three months'] }),
    ],
  }),
  transcriptCase({
    domain: 'medical_history',
    category: 'medication',
    difficulty: 'basic',
    description: 'Medical history capture with systemic condition.',
    transcript: [
      ut('u1', 'Patient', 'I have asthma and use a ventolin puffer.'),
      ut('u2', 'Patient', 'No other medical problems.'),
    ],
    expectedFacts: [
      patientSaid('medical_history', { condition: 'asthma', status: 'managed' }, 'reported', { evidence: ['asthma'] }),
      patientSaid('medication', { drugName: 'Ventolin' }, 'reported', { evidence: ['ventolin puffer'] }),
    ],
  }),
  transcriptCase({
    domain: 'medications',
    category: 'medication',
    difficulty: 'intermediate',
    description: 'Anticoagulant with dose and frequency.',
    transcript: [
      ut('u1', 'Patient', 'I take Eliquis 5 milligrams once a day.'),
    ],
    expectedFacts: [
      patientSaid('medication', { drugName: 'Eliquis', dose: '5 mg', frequency: 'once daily' }, 'reported', { evidence: ['Eliquis 5 milligrams'] }),
    ],
  }),
  transcriptCase({
    domain: 'allergies',
    category: 'medication',
    difficulty: 'basic',
    description: 'Allergy with reaction documented.',
    transcript: [
      ut('u1', 'Patient', 'I am allergic to penicillin, I get hives.'),
    ],
    expectedFacts: [
      patientSaid('allergy', { allergen: 'penicillin', reaction: 'hives' }, 'reported', { evidence: ['allergic to penicillin'] }),
    ],
  }),
  transcriptCase({
    domain: 'consent',
    category: 'consent',
    difficulty: 'intermediate',
    description: 'Informed consent with risks and alternatives.',
    transcript: [
      ut('u1', 'Dentist', 'The options are root canal or extraction for 36.'),
      ut('u2', 'Dentist', 'Risks include numbness and infection.'),
      ut('u3', 'Patient', 'I understand, let us do the root canal.'),
    ],
    expectedFacts: [
      ef('consent', 'clinician', 'discussion', { procedureDiscussed: 'root canal treatment or extraction', materialRisksWarned: ['numbness', 'infection'], alternativesDiscussed: ['root canal treatment', 'extraction'], patientResponse: 'verbally_consented' }, 'discussed', 'current', 'certain', { teeth: [36], evidence: ['options are root canal'] }),
    ],
  }),
  transcriptCase({
    domain: 'treatment_plans',
    category: 'temporal',
    difficulty: 'intermediate',
    description: 'Phased treatment plan discussion.',
    transcript: [
      ut('u1', 'Dentist', 'The plan is a filling on 16 now, and a crown on 26 next month.'),
    ],
    expectedFacts: [
      ef('treatment_plan', 'clinician', 'discussion', { proposedProcedures: ['filling on 16 now', 'crown on 26 next month'] }, 'planned', 'future', 'certain', { teeth: [16, 26], evidence: ['The plan is a filling on 16'] }),
    ],
  }),
  transcriptCase({
    domain: 'declined_treatment',
    category: 'temporal',
    difficulty: 'intermediate',
    description: 'Patient declines proposed treatment.',
    transcript: [
      ut('u1', 'Dentist', 'I recommend a crown on 46.'),
      ut('u2', 'Patient', 'I will think about it, not today.'),
    ],
    expectedFacts: [
      clinicianPlanned('procedure', { name: 'crown' }, { teeth: [46], evidence: ['recommend a crown on 46'] }),
      patientSaid('declined_treatment', { proposedTreatment: 'crown', reasonGiven: 'wants to think about it' }, 'declined', { evidence: ['not today'] }),
    ],
  }),
  transcriptCase({
    domain: 'historical_treatment',
    category: 'temporal',
    difficulty: 'intermediate',
    description: 'Historical treatment performed elsewhere.',
    transcript: [
      ut('u1', 'Patient', 'I had a root canal on that tooth about three years ago at another dentist.'),
    ],
    expectedFacts: [
      patientSaid('procedure', { name: 'root canal' }, 'historical', { temporal: 'historical', evidence: ['root canal on that tooth about three years ago'] }),
    ],
  }),
  transcriptCase({
    domain: 'postoperative_instructions',
    category: 'consent',
    difficulty: 'basic',
    description: 'Post-operative instructions after extraction.',
    transcript: [
      ut('u1', 'Dentist', 'No hot drinks today, no rinsing, and no smoking for 48 hours.'),
      ut('u2', 'Dentist', 'Take paracetamol if you need it.'),
    ],
    expectedFacts: [
      ef('postoperative_instruction', 'clinician', 'instruction', { instructions: ['no hot drinks today', 'no rinsing', 'no smoking for 48 hours'] }, 'planned', 'future', 'certain', { evidence: ['No hot drinks'] }),
      ef('medication_instruction', 'clinician', 'instruction', { drug: 'paracetamol', dose: 'as needed', frequency: 'as needed', duration: 'as needed' }, 'planned', 'future', 'certain', { evidence: ['paracetamol'] }),
    ],
  }),
];

// ---------------------------------------------------------------------------
// 2. ADVERSARIAL CASES — explicit hard categories
// ---------------------------------------------------------------------------

export const ADVERSARIAL_CASES: ReadonlyArray<ClinicalEvaluationCase> = [
  transcriptCase({
    domain: 'adversarial',
    category: 'negation',
    difficulty: 'adversarial',
    adversarial: true,
    description: 'Double negation — patient denies then clinician confirms absence.',
    transcript: [
      ut('u1', 'Patient', 'I would not say it never hurts, but mostly it is fine.'),
      ut('u2', 'Dentist', 'No pain on percussion, no swelling.'),
    ],
    expectedFacts: [
      clinicianObserved('tooth_finding', { condition: 'pain on percussion' }, 'negated', { evidence: ['No pain on percussion'] }),
      clinicianObserved('tooth_finding', { condition: 'swelling' }, 'negated', { evidence: ['no swelling'] }),
    ],
    tags: ['negation', 'double_negation'],
  }),
  transcriptCase({
    domain: 'adversarial',
    category: 'clinical_ambiguity',
    difficulty: 'adversarial',
    adversarial: true,
    description: 'Patient speculation must not become a diagnosis.',
    transcript: [
      ut('u1', 'Patient', 'I think I need a root canal, my friend said so.'),
      ut('u2', 'Dentist', 'Let me examine it before we say anything like that.'),
    ],
    expectedFacts: [
      patientSaid('chief_complaint', { complaint: 'here for my regular check' }, 'reported', { evidence: ['Let me examine it'] }),
    ],
    tags: ['patient_speculation'],
    rationale: 'Patient speculation about a diagnosis must never be extracted as a clinician diagnosis.',
  }),
  transcriptCase({
    domain: 'adversarial',
    category: 'clinical_ambiguity',
    difficulty: 'adversarial',
    adversarial: true,
    description: 'Patient question is not a clinician finding.',
    transcript: [
      ut('u1', 'Patient', 'Is it cracked? It feels loose to me.'),
      ut('u2', 'Dentist', 'I cannot see a crack and it is not loose.'),
    ],
    expectedFacts: [
      patientSaid('symptom', { description: 'feels loose' }, 'reported', { evidence: ['feels loose'] }),
      clinicianObserved('tooth_finding', { condition: 'crack' }, 'negated', { evidence: ['cannot see a crack'] }),
      clinicianObserved('tooth_finding', { condition: 'mobility' }, 'negated', { evidence: ['not loose'] }),
    ],
    tags: ['patient_questions', 'negation'],
  }),
  transcriptCase({
    domain: 'adversarial',
    category: 'clinical_ambiguity',
    difficulty: 'adversarial',
    adversarial: true,
    description: 'Clinician question is not a finding.',
    transcript: [
      ut('u1', 'Dentist', 'Does it hurt when you bite on that side?'),
      ut('u2', 'Patient', 'A little, yes.'),
    ],
    expectedFacts: [
      patientSaid('symptom', { description: 'mild pain on biting' }, 'reported', { evidence: ['A little, yes'] }),
    ],
    tags: ['clinician_questions'],
  }),
  transcriptCase({
    domain: 'adversarial',
    category: 'temporal',
    difficulty: 'adversarial',
    adversarial: true,
    description: 'Indirect speech for historical events.',
    transcript: [
      ut('u1', 'Patient', 'My old dentist said the nerve was dying and he started the treatment.'),
    ],
    expectedFacts: [
      patientSaid('dental_history', { summary: 'previous dentist diagnosed a dying nerve and began treatment' }, 'historical', { temporal: 'historical', evidence: ['old dentist said the nerve was dying'] }),
    ],
    tags: ['indirect_speech', 'historical_events'],
  }),
  transcriptCase({
    domain: 'adversarial',
    category: 'temporal',
    difficulty: 'adversarial',
    adversarial: true,
    description: 'Cancelled treatment is not performed treatment.',
    transcript: [
      ut('u1', 'Dentist', 'The extraction booked for today was cancelled, we are only doing a check-up.'),
    ],
    expectedFacts: [
      ef('procedure', 'clinician', 'discussion', { name: 'extraction' }, 'declined', 'current', 'certain', { evidence: ['cancelled'] }),
    ],
    tags: ['cancelled_treatment'],
  }),
  transcriptCase({
    domain: 'adversarial',
    category: 'temporal',
    difficulty: 'adversarial',
    adversarial: true,
    description: 'Treatment performed elsewhere is historical.',
    transcript: [
      ut('u1', 'Patient', 'The crown was done overseas about two years ago.'),
    ],
    expectedFacts: [
      patientSaid('procedure', { name: 'crown' }, 'historical', { temporal: 'historical', evidence: ['crown was done overseas about two years ago'] }),
    ],
    tags: ['performed_elsewhere', 'historical_events'],
  }),
  transcriptCase({
    domain: 'adversarial',
    category: 'anatomy',
    difficulty: 'adversarial',
    adversarial: true,
    description: 'Similar-sounding tooth numbers (16 vs 46).',
    transcript: [
      ut('u1', 'Dentist', 'Caries on tooth 46, not 16 as the chart said.'),
    ],
    expectedFacts: [
      clinicianObserved('tooth_finding', { condition: 'caries' }, 'observed', { teeth: [46], evidence: ['Caries on tooth 46'] }),
    ],
    tags: ['similar_sounding_teeth', 'ambiguous_tooth_numbers'],
  }),
  transcriptCase({
    domain: 'adversarial',
    category: 'anatomy',
    difficulty: 'adversarial',
    adversarial: true,
    description: 'Non-FDI tooth language mapped to FDI.',
    transcript: [
      ut('u1', 'Dentist', 'The lower left first molar needs a filling.'),
    ],
    expectedFacts: [
      clinicianPlanned('procedure', { name: 'restoration' }, { teeth: [36], evidence: ['lower left first molar needs a filling'] }),
    ],
    tags: ['fdi_vs_nonfdi'],
  }),
  transcriptCase({
    domain: 'adversarial',
    category: 'anatomy',
    difficulty: 'adversarial',
    adversarial: true,
    description: 'Surface ambiguity — clinician corrects mid-sentence.',
    transcript: [
      ut('u1', 'Dentist', 'Restoring the occlusal, sorry, the mesial-occlusal surface of 26.'),
    ],
    expectedFacts: [
      clinicianPerformed('procedure', { name: 'composite restoration' }, { teeth: [26], surfaces: ['M', 'O'], evidence: ['mesial-occlusal surface of 26'] }),
    ],
    tags: ['surface_ambiguity', 'corrections_mid_sentence', 'self_corrections'],
  }),
  transcriptCase({
    domain: 'adversarial',
    category: 'medication',
    difficulty: 'adversarial',
    adversarial: true,
    description: 'Dose ambiguity — patient corrects their own statement.',
    transcript: [
      ut('u1', 'Patient', 'I take warfarin 5 mg... no wait, it is 3 mg now, the dose changed.'),
    ],
    expectedFacts: [
      // The corrected dose is what stands (self-correction wins).
      patientSaid('medication', { drugName: 'warfarin', dose: '3 mg' }, 'reported', { evidence: ['warfarin'] }),
    ],
    tags: ['dose_ambiguity', 'self_corrections'],
  }),
  transcriptCase({
    domain: 'adversarial',
    category: 'speaker',
    difficulty: 'adversarial',
    adversarial: true,
    description: 'Multiple speakers with overlapping dialogue and background speech.',
    transcript: [
      ut('u1', 'Patient', 'My gum bleeds when I brush.'),
      ut('u2', 'Assistant', 'The patient says the gum bleeds when brushing.'),
      ut('u3', 'Dentist', 'Thank you, I can see some inflammation here.'),
    ],
    expectedFacts: [
      patientSaid('symptom', { description: 'gum bleeds when brushing' }, 'reported', { evidence: ['gum bleeds when I brush'] }),
      ef('periodontal_finding', 'clinician', 'clinician_observed', { diagnosis: 'gingival inflammation' }, 'observed', 'current', 'certain'),
    ],
    tags: ['multiple_speakers', 'overlapping_dialogue', 'background_speech'],
  }),
  transcriptCase({
    domain: 'adversarial',
    category: 'clinical_ambiguity',
    difficulty: 'adversarial',
    adversarial: true,
    description: 'Contradictory statements within one transcript.',
    transcript: [
      ut('u1', 'Dentist', 'There is no fracture on 24.'),
      ut('u2', 'Dentist', 'Actually, on second look there is a fine fracture on 24.'),
    ],
    expectedFacts: [
      clinicianObserved('tooth_finding', { condition: 'fracture' }, 'observed', { teeth: [24], evidence: ['there is a fine fracture on 24'] }),
    ],
    tags: ['contradictory_statements'],
    rationale: 'The corrected final statement wins; the contradiction should be flagged for review.',
  }),
  transcriptCase({
    domain: 'adversarial',
    category: 'anaesthesia',
    difficulty: 'adversarial',
    adversarial: true,
    description: 'Low ASR confidence span for a medication name.',
    transcript: [
      ut('u1', 'Patient', 'I take my [unclear — sounds like eliquis?] blood thinner daily.'),
    ],
    expectedFacts: [
      patientSaid('medication', { drugName: 'blood thinner (unclear, possibly Eliquis)', certainty_note: 'uncertain identity preserved' }, 'reported', { evidence: ['blood thinner daily'] }),
    ],
    tags: ['low_asr_confidence'],
    rationale: 'Uncertain medication identity must stay uncertain, never auto-resolved.',
  }),
  transcriptCase({
    domain: 'adversarial',
    category: 'temporal',
    difficulty: 'adversarial',
    adversarial: true,
    description: 'Future plan must not be documented as performed.',
    transcript: [
      ut('u1', 'Dentist', 'We will remove the stitches next week.'),
    ],
    expectedFacts: [
      clinicianPlanned('procedure', { name: 'suture removal' }, { evidence: ['remove the stitches next week'] }),
    ],
    tags: ['future_plans'],
  }),
  transcriptCase({
    domain: 'adversarial',
    category: 'temporal',
    difficulty: 'adversarial',
    adversarial: true,
    description: 'Explicit patient refusal — a decline must never become performed treatment.',
    transcript: [
      ut('u1', 'Patient', 'I do not want the extraction today, I will think about it.'),
    ],
    expectedFacts: [
      ef('declined_treatment', 'patient', 'patient_reported', { proposedTreatment: 'extraction', reasonGiven: 'wants to think about it' }, 'declined', 'current', 'certain', { evidence: ['do not want the extraction today'] }),
    ],
    tags: ['declined_treatment'],
  }),
  transcriptCase({
    domain: 'adversarial',
    category: 'negation',
    difficulty: 'adversarial',
    adversarial: true,
    description: 'Negated treatment status.',
    transcript: [
      ut('u1', 'Dentist', 'No restoration was done today, the tooth was monitored only.'),
    ],
    expectedFacts: [
      ef('procedure', 'clinician', 'clinician_observed', { name: 'restoration' }, 'negated', 'current', 'certain', { evidence: ['No restoration was done today'] }),
    ],
    tags: ['negation'],
  }),
];

// ---------------------------------------------------------------------------
// 3. REGRESSION CASES — permanent fixtures for shipped-phase defects
// ---------------------------------------------------------------------------

export const REGRESSION_CASES: ReadonlyArray<ClinicalEvaluationCase & { readonly regressionFor: string }> = [
  {
    ...transcriptCase({
      domain: 'regression',
      category: 'negation',
      difficulty: 'adversarial',
      adversarial: true,
      description: 'PHASE5: "no filling was placed" must never classify as performed treatment.',
      transcript: [ut('u1', 'Dentist', 'No filling was placed on 36 today.')],
      expectedFacts: [
        ef('procedure', 'clinician', 'clinician_observed', { name: 'filling' }, 'negated', 'current', 'certain', { teeth: [36], evidence: ['No filling was placed on 36 today'] }),
      ],
    }),
    regressionFor: 'phase5-negated-treatment-status',
  },
  {
    ...transcriptCase({
      domain: 'regression',
      category: 'temporal',
      difficulty: 'adversarial',
      adversarial: true,
      description: 'PHASE5: planned treatment must never become verified performed treatment.',
      transcript: [ut('u1', 'Dentist', 'We will restore 36 next visit.')],
      expectedFacts: [
        clinicianPlanned('procedure', { name: 'composite restoration' }, { teeth: [36], evidence: ['restore 36 next visit'] }),
      ],
    }),
    regressionFor: 'phase5-planned-vs-performed',
  },
  {
    ...transcriptCase({
      domain: 'regression',
      category: 'speaker',
      difficulty: 'adversarial',
      adversarial: true,
      description: 'PHASE5: patient symptom must not become a clinician-observed finding.',
      transcript: [
        ut('u1', 'Patient', 'My tooth feels loose.'),
        ut('u2', 'Dentist', 'I cannot see any mobility.'),
      ],
      expectedFacts: [
        patientSaid('symptom', { description: 'tooth feels loose' }, 'reported', { evidence: ['feels loose'] }),
        clinicianObserved('tooth_finding', { condition: 'mobility' }, 'negated', { evidence: ['cannot see any mobility'] }),
      ],
    }),
    regressionFor: 'phase5-patient-vs-clinician-attribution',
  },
  {
    ...transcriptCase({
      domain: 'regression',
      category: 'procedures',
      difficulty: 'adversarial',
      adversarial: true,
      description: 'PHASE7: macro must not inject Articaine, 2.2 mL or shade A3 when unspoken.',
      transcript: [ut('u1', 'Dentist', 'Restoring tooth 26 with composite today.')],
      expectedFacts: [
        clinicianPerformed('procedure', { name: 'composite restoration' }, { teeth: [26], evidence: ['Restoring tooth 26'] }),
      ],
    }),
    regressionFor: 'phase7-macro-default-injection',
  },
  {
    ...transcriptCase({
      domain: 'regression',
      category: 'dental_findings',
      difficulty: 'adversarial',
      adversarial: true,
      description: 'PHASE5: empty note must not report as fully grounded.',
      transcript: [ut('u1', 'Dentist', 'Just a brief check today.')],
      expectedFacts: [],
    }),
    regressionFor: 'phase5-empty-note-false-grounding',
  },
];

// ---------------------------------------------------------------------------
// Aggregation + seeded variation
// ---------------------------------------------------------------------------

/**
 * Deterministic seeded PRNG (mulberry32) — used ONLY to expand the
 * representative cases into varied scenarios (different teeth, materials,
 * speakers) without randomness across builds.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEETH_POOL = [14, 15, 16, 17, 24, 25, 26, 27, 34, 35, 36, 37, 44, 45, 46, 47] as const;
const SURFACE_POOL = [['O'], ['M', 'O'], ['D', 'O'], ['M', 'O', 'D'], ['B'], ['L'], ['M', 'O', 'D', 'B']] as const;
/** Template IDs whose transcripts contain surface vocabulary (mesial/occlusal etc.) — the only ones that may be surface-varied. */
const POSTERIOR_SURFACE_TEMPLATES: ReadonlySet<string> = new Set(['gold-0003', 'gold-0004']);

/**
 * Expands the corpus to a target size by deterministically varying the
 * restorative, endodontic and hygiene representative cases across the tooth
 * and surface pools. Expansion NEVER invents new clinical semantics — the
 * expected facts are re-derived from the varied transcript.
 */
export function buildExpandedGoldSet(targetSize: number): {
  representative: ClinicalEvaluationCase[];
  adversarial: ClinicalEvaluationCase[];
  regression: ReadonlyArray<ClinicalEvaluationCase & { readonly regressionFor: string }>;
} {
  const rng = mulberry32(0xD3E7A1); // deterministic seed (D3E7A1)
  const representative: ClinicalEvaluationCase[] = [...REPRESENTATIVE_CASES];

  // Variation IDs derive from the authored corpus size — never from mutable
  // counter state — so repeated builds in one process are byte-identical.
  const varIdBase = REPRESENTATIVE_CASES.length + ADVERSARIAL_CASES.length + REGRESSION_CASES.length;

  const expansionTemplates = REPRESENTATIVE_CASES.filter(c =>
    // Surface-varying templates must actually contain surface vocabulary and
    // be posterior-restorable; anterior teeth have no occlusal surface and the
    // primary template has its own (non-varying) dentition.
    ['restorative', 'endodontic', 'hygiene_preventive', 'emergency', 'periodontal'].includes(c.clinicalDomain) &&
    POSTERIOR_SURFACE_TEMPLATES.has(c.id)
  );

  let i = 0;
  while (representative.length < targetSize) {
    const template = expansionTemplates[i % expansionTemplates.length];
    const tooth = TEETH_POOL[Math.floor(rng() * TEETH_POOL.length)];
    const surfaces = SURFACE_POOL[Math.floor(rng() * SURFACE_POOL.length)];
    const surfaceText = surfaces.join('');
    const surfaceSpoken = surfaces.map(s => ({ O: 'occlusal', M: 'mesial', D: 'distal', B: 'buccal', L: 'lingual', I: 'incisal' } as Record<string, string>)[s] ?? s).join('-');

    // Deterministic whole-word substitution of the template's canonical tooth
    // and surface tokens. The template texts always use these canonical forms.
    const substitute = (text: string): string => text
      .replace(/\btooth (26|46|36|54|15)\b/g, `tooth ${tooth}`)
      .replace(/\b(26|46|36|54|15)\b/g, String(tooth))
      .replace(/\bmesial and occlusal\b|\bMOD\b/g, surfaceSpoken)
      .replace(/\bMO\b|\bMODB\b/g, surfaceText);

    const variedTranscript: EvaluationTranscript = template.transcript.map(u => ({
      ...u,
      text: substitute(u.text),
      utteranceId: `${u.utteranceId}-v${i}`,
    }));

    const variedFacts = template.expectedFacts.map(f => {
      const nextAnatomy = f.anatomy
        ? {
            ...f.anatomy,
            teeth: f.anatomy.teeth?.map(() => tooth),
            surfaces: surfaces as never,
          }
        : undefined;
      // Evidence keywords are re-derived from the varied transcript so the
      // comparator's keyword checks stay valid.
      const nextKeywords = (f.expectedEvidenceKeywords ?? []).map(substitute);
      return { ...f, anatomy: nextAnatomy, expectedEvidenceKeywords: nextKeywords.length > 0 ? nextKeywords : undefined };
    });

    representative.push({
      ...template,
      id: nextId('gold-var', varIdBase + i + 1),
      description: `${template.description} (variation: tooth ${tooth}, surfaces ${surfaceText})`,
      transcript: variedTranscript,
      expectedFacts: variedFacts,
      tags: [...(template.tags ?? []), 'seeded_variation'],
    });

    i += 1;
  }

  return { representative, adversarial: [...ADVERSARIAL_CASES], regression: REGRESSION_CASES };
}

/** Full default corpus: representative + adversarial + regression. */
export function buildGoldSet(): {
  representative: ClinicalEvaluationCase[];
  adversarial: ClinicalEvaluationCase[];
  regression: ReadonlyArray<ClinicalEvaluationCase & { readonly regressionFor: string }>;
  all: ClinicalEvaluationCase[];
} {
  const expanded = buildExpandedGoldSet(200);
  const all = [...expanded.representative, ...expanded.adversarial];
  return { ...expanded, all };
}
