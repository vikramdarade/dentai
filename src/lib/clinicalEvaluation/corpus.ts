/**
 * Curated Gold-Standard Clinical Evaluation Corpus (v1.1.0 Remediated)
 *
 * Authoritative benchmark dataset containing standard and adversarial dental encounters.
 * At least 30% of cases are deliberately designed adversarial traps covering:
 * - Speaker attribution inversion
 * - Negation vs uncertainty distinction
 * - Temporal context confusion (planned vs performed, historical vs current)
 * - Anatomical adjacency and surface disambiguation
 * - Hedged diagnostic ambiguity
 * - Systemic pharmacology & anticoagulation status
 *
 * ALL EXPECTED FACTS ARE DETERMINISTICALLY AUTHORED CANONICAL DOMAIN ASSERTIONS.
 * FULLY CONFORMS TO FactValueTypeMap WITHOUT Record<string, unknown> ESCAPES.
 */

import type { ClinicalEvaluationCase } from './types';

export const CLINICAL_EVALUATION_CORPUS_VERSION = 'v1.1.0';

export const CLINICAL_EVALUATION_CORPUS_V1: ReadonlyArray<ClinicalEvaluationCase> = [
  // =========================================================================
  // 1. SECTION 20 GOLDEN BENCHMARK CASE
  // =========================================================================
  {
    id: 'case-golden-001',
    datasetVersion: CLINICAL_EVALUATION_CORPUS_VERSION,
    category: 'adversarial',
    difficulty: 'complex',
    isAdversarial: true,
    clinicalDomain: 'General Operative & Diagnostic',
    description: 'Section 20 Canonical Multi-Fact Encounter: Cold sensitivity, MOD caries, and planned restoration',
    transcript: [
      {
        utteranceId: 'u1',
        speaker: 'patient',
        text: "I've had sensitivity around the lower left molar."
      },
      {
        utteranceId: 'u2',
        speaker: 'clinician',
        text: "Tooth 36 is sensitive to cold but there is no lingering pain. I can see an MOD carious lesion. We'll restore it at the next visit."
      }
    ],
    expectedFacts: [
      {
        type: 'symptom',
        speaker: 'patient',
        evidenceType: 'patient_reported',
        status: 'reported',
        temporal: 'current',
        certainty: 'certain',
        anatomy: { quadrant: 3, arch: 'mandibular' },
        expectedEvidenceKeywords: ['sensitivity', 'lower left molar'],
        value: {
          description: 'sensitivity around the lower left molar',
          patientPhrase: "I've had sensitivity around the lower left molar."
        }
      },
      {
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'observed',
        temporal: 'current',
        certainty: 'certain',
        anatomy: { teeth: [36], surfaces: ['M', 'O', 'D'] },
        expectedEvidenceKeywords: ['MOD carious lesion'],
        value: { condition: 'caries' }
      },
      {
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'observed',
        temporal: 'current',
        certainty: 'certain',
        anatomy: { teeth: [36] },
        expectedEvidenceKeywords: ['sensitive to cold', 'no lingering pain'],
        // Remediated: percussion: 'negative' removed because percussion was never tested in transcript
        value: {
          condition: 'vitality test',
          vitality: { coldTest: 'exaggerated' }
        }
      },
      {
        type: 'treatment_plan',
        speaker: 'clinician',
        evidenceType: 'instruction',
        status: 'planned',
        temporal: 'next_appointment',
        certainty: 'certain',
        anatomy: { teeth: [36] },
        expectedEvidenceKeywords: ["restore it at the next visit"],
        value: { proposedProcedures: ['composite restoration'] }
      }
    ],
    rationale: 'Tests 4 orthogonal assertions across 2 speakers, separating cold sensitivity from negated lingering pain, and planned future treatment from today.'
  },

  // =========================================================================
  // 2. SPEAKER & ATTRIBUTION CASES
  // =========================================================================
  {
    id: 'case-speaker-001',
    datasetVersion: CLINICAL_EVALUATION_CORPUS_VERSION,
    category: 'speaker',
    difficulty: 'basic',
    isAdversarial: false,
    clinicalDomain: 'Diagnostic Examination',
    description: 'Direct patient symptom report vs clinician objective check',
    transcript: [
      { utteranceId: 's1', speaker: 'patient', text: 'Tooth 21 has been aching when I bite down.' },
      { utteranceId: 's2', speaker: 'clinician', text: 'Tooth 21 is tender to vertical percussion.' }
    ],
    expectedFacts: [
      {
        type: 'symptom',
        speaker: 'patient',
        evidenceType: 'patient_reported',
        status: 'reported',
        temporal: 'current',
        certainty: 'certain',
        anatomy: { teeth: [21] },
        expectedEvidenceKeywords: ['aching', 'bite down'],
        value: { description: 'pain on biting' }
      },
      {
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'observed',
        temporal: 'current',
        certainty: 'certain',
        anatomy: { teeth: [21] },
        expectedEvidenceKeywords: ['tender to vertical percussion'],
        value: { condition: 'tenderness to percussion', vitality: { percussion: 'tender' } }
      }
    ]
  },
  {
    id: 'case-speaker-002-adv',
    datasetVersion: CLINICAL_EVALUATION_CORPUS_VERSION,
    category: 'speaker',
    difficulty: 'adversarial',
    isAdversarial: true,
    clinicalDomain: 'Diagnostic Examination',
    description: 'Adversarial: Clinician relaying patient history vs clinician observation',
    transcript: [
      { utteranceId: 's3', speaker: 'clinician', text: 'The patient mentions she felt sharp pain on tooth 46 yesterday.' },
      { utteranceId: 's4', speaker: 'clinician', text: 'On examination, tooth 46 shows normal probing depths and no mobility.' }
    ],
    expectedFacts: [
      {
        type: 'symptom',
        speaker: 'clinician',
        evidenceType: 'patient_reported',
        status: 'reported',
        temporal: 'historical',
        certainty: 'certain',
        anatomy: { teeth: [46] },
        expectedEvidenceKeywords: ['sharp pain on tooth 46 yesterday'],
        value: { description: 'sharp pain yesterday' }
      },
      {
        type: 'periodontal_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'observed',
        temporal: 'current',
        certainty: 'certain',
        anatomy: { teeth: [46] },
        expectedEvidenceKeywords: ['normal probing depths', 'no mobility'],
        value: { diagnosis: 'normal probing depths and no mobility' }
      }
    ],
    rationale: 'Clinician is speaking, but fact 1 is patient-reported history, not a direct clinician observation.'
  },

  // =========================================================================
  // 3. NEGATION & CERTAINTY CASES
  // =========================================================================
  {
    id: 'case-negation-001',
    datasetVersion: CLINICAL_EVALUATION_CORPUS_VERSION,
    category: 'negation',
    difficulty: 'basic',
    isAdversarial: false,
    clinicalDomain: 'Routine Examination',
    description: 'Direct negation of caries on tooth 16',
    transcript: [
      { utteranceId: 'n1', speaker: 'clinician', text: 'No caries detected on tooth 16.' }
    ],
    expectedFacts: [
      {
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'negated',
        temporal: 'current',
        certainty: 'certain',
        anatomy: { teeth: [16] },
        negationScope: 'caries',
        expectedEvidenceKeywords: ['No caries detected on tooth 16'],
        value: { condition: 'caries' }
      }
    ]
  },
  {
    id: 'case-negation-002-adv',
    datasetVersion: CLINICAL_EVALUATION_CORPUS_VERSION,
    category: 'negation',
    difficulty: 'adversarial',
    isAdversarial: true,
    clinicalDomain: 'Diagnostic Examination',
    description: 'Adversarial: Adjacent tooth contrast — 36 has no decay, but 37 has deep caries',
    transcript: [
      { utteranceId: 'n2', speaker: 'clinician', text: 'Tooth 36 has no decay, but 37 shows deep occlusal caries.' }
    ],
    expectedFacts: [
      {
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'negated',
        temporal: 'current',
        certainty: 'certain',
        anatomy: { teeth: [36] },
        negationScope: 'caries',
        expectedEvidenceKeywords: ['Tooth 36 has no decay'],
        value: { condition: 'caries' }
      },
      {
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'observed',
        temporal: 'current',
        certainty: 'certain',
        anatomy: { teeth: [37], surfaces: ['O'] },
        expectedEvidenceKeywords: ['37 shows deep occlusal caries'],
        value: { condition: 'caries', depth: 'dentine' }
      }
    ],
    rationale: 'Tests against leaking negation from 36 onto 37, or attributing caries to 36.'
  },
  {
    id: 'case-negation-003-adv',
    datasetVersion: CLINICAL_EVALUATION_CORPUS_VERSION,
    category: 'negation',
    difficulty: 'adversarial',
    isAdversarial: true,
    clinicalDomain: 'Diagnostic Examination',
    description: 'Adversarial: Uncertainty vs Negation — "I don\'t think there is caries"',
    transcript: [
      { utteranceId: 'n3', speaker: 'clinician', text: "I don't think there is any caries on 45, but we should monitor it." }
    ],
    expectedFacts: [
      {
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'observed',
        temporal: 'current',
        certainty: 'uncertain',
        anatomy: { teeth: [45] },
        expectedEvidenceKeywords: ["don't think there is any caries on 45"],
        value: { condition: 'caries' }
      },
      {
        type: 'treatment_plan',
        speaker: 'clinician',
        evidenceType: 'instruction',
        status: 'planned',
        temporal: 'future',
        certainty: 'certain',
        anatomy: { teeth: [45] },
        expectedEvidenceKeywords: ['monitor it'],
        value: { proposedProcedures: ['monitor'] }
      }
    ],
    rationale: 'Hedged clinician statement expressing diagnostic uncertainty must NOT become status: negated.'
  },

  // =========================================================================
  // 4. TEMPORAL CONTEXT CASES
  // =========================================================================
  {
    id: 'case-temporal-001',
    datasetVersion: CLINICAL_EVALUATION_CORPUS_VERSION,
    category: 'temporal',
    difficulty: 'basic',
    isAdversarial: false,
    clinicalDomain: 'Restorative Operative',
    description: 'Treatment performed today: composite restoration on 14 DO',
    transcript: [
      { utteranceId: 't1', speaker: 'clinician', text: 'Completed a 2-surface composite restoration on tooth 14 DO today.' }
    ],
    expectedFacts: [
      {
        type: 'procedure',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'performed',
        temporal: 'completed_today',
        certainty: 'certain',
        anatomy: { teeth: [14], surfaces: ['D', 'O'] },
        expectedEvidenceKeywords: ['composite restoration on tooth 14 DO today'],
        value: { name: 'composite restoration' }
      }
    ]
  },
  {
    id: 'case-temporal-002-adv',
    datasetVersion: CLINICAL_EVALUATION_CORPUS_VERSION,
    category: 'temporal',
    difficulty: 'adversarial',
    isAdversarial: true,
    clinicalDomain: 'Oral Surgery & Treatment Planning',
    description: 'Adversarial: Historical extraction vs Planned extraction',
    transcript: [
      { utteranceId: 't2', speaker: 'clinician', text: 'We extracted tooth 45 last appointment. Today we plan to extract 46 next visit.' }
    ],
    expectedFacts: [
      {
        type: 'procedure',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'performed',
        temporal: 'previous_appointment',
        certainty: 'certain',
        anatomy: { teeth: [45] },
        expectedEvidenceKeywords: ['extracted tooth 45 last appointment'],
        value: { name: 'extraction' }
      },
      {
        type: 'treatment_plan',
        speaker: 'clinician',
        evidenceType: 'instruction',
        status: 'planned',
        temporal: 'next_appointment',
        certainty: 'certain',
        anatomy: { teeth: [46] },
        expectedEvidenceKeywords: ['plan to extract 46 next visit'],
        value: { proposedProcedures: ['extraction'] }
      }
    ],
    rationale: 'Neither extraction was performed today. Confusing previous appointment with completed today is a critical billing violation.'
  },
  {
    id: 'case-temporal-003-adv',
    datasetVersion: CLINICAL_EVALUATION_CORPUS_VERSION,
    category: 'temporal',
    difficulty: 'adversarial',
    isAdversarial: true,
    clinicalDomain: 'Diagnostic Examination',
    description: 'Adversarial: Historical symptom that is resolved today',
    transcript: [
      { utteranceId: 't3', speaker: 'patient', text: 'I had severe throbbing pain in tooth 36 last week, but it feels completely fine now.' }
    ],
    expectedFacts: [
      {
        type: 'symptom',
        speaker: 'patient',
        evidenceType: 'patient_reported',
        status: 'reported',
        temporal: 'historical',
        certainty: 'certain',
        anatomy: { teeth: [36] },
        expectedEvidenceKeywords: ['severe throbbing pain in tooth 36 last week'],
        value: { description: 'severe throbbing pain last week' }
      },
      {
        type: 'symptom',
        speaker: 'patient',
        evidenceType: 'patient_reported',
        status: 'negated',
        temporal: 'current',
        certainty: 'certain',
        anatomy: { teeth: [36] },
        negationScope: 'pain',
        expectedEvidenceKeywords: ['feels completely fine now'],
        value: { description: 'pain' }
      }
    ],
    rationale: 'Must not chart current active throbbing pain.'
  },

  // =========================================================================
  // 5. ANATOMY & SURFACE DISAMBIGUATION CASES
  // =========================================================================
  {
    id: 'case-anatomy-001',
    datasetVersion: CLINICAL_EVALUATION_CORPUS_VERSION,
    category: 'anatomy',
    difficulty: 'basic',
    isAdversarial: false,
    clinicalDomain: 'Restorative Operative',
    description: 'Posterior multi-surface composite: tooth 46 MODB',
    transcript: [
      { utteranceId: 'a1', speaker: 'clinician', text: 'Restored tooth 46 with MODB composite.' }
    ],
    expectedFacts: [
      {
        type: 'procedure',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'performed',
        temporal: 'completed_today',
        certainty: 'certain',
        anatomy: { teeth: [46], surfaces: ['M', 'O', 'D', 'B'] },
        expectedEvidenceKeywords: ['Restored tooth 46 with MODB composite'],
        value: { name: 'composite restoration' }
      }
    ]
  },
  {
    id: 'case-anatomy-002-adv',
    datasetVersion: CLINICAL_EVALUATION_CORPUS_VERSION,
    category: 'anatomy',
    difficulty: 'adversarial',
    isAdversarial: true,
    clinicalDomain: 'Restorative & Aesthetics',
    description: 'Adversarial: Anterior incisal fracture (11 MI) vs posterior occlusion',
    transcript: [
      { utteranceId: 'a2', speaker: 'clinician', text: 'Chipped front tooth 11 on the mesial incisal edge. Restored with MI composite.' }
    ],
    expectedFacts: [
      {
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'observed',
        temporal: 'current',
        certainty: 'certain',
        anatomy: { teeth: [11], surfaces: ['M', 'I'] },
        expectedEvidenceKeywords: ['Chipped front tooth 11 on the mesial incisal edge'],
        value: { condition: 'fracture' }
      },
      {
        type: 'procedure',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'performed',
        temporal: 'completed_today',
        certainty: 'certain',
        anatomy: { teeth: [11], surfaces: ['M', 'I'] },
        expectedEvidenceKeywords: ['Restored with MI composite'],
        value: { name: 'composite restoration' }
      }
    ],
    rationale: 'Tooth 11 is an anterior incisor. Must accept incisal (I), must not convert to occlusal (O).'
  },
  {
    id: 'case-anatomy-003-adv',
    datasetVersion: CLINICAL_EVALUATION_CORPUS_VERSION,
    category: 'anatomy',
    difficulty: 'adversarial',
    isAdversarial: true,
    clinicalDomain: 'Diagnostic Examination',
    description: 'Adversarial: Existing MOD restoration examined, no procedure performed today',
    transcript: [
      { utteranceId: 'a3', speaker: 'clinician', text: 'Tooth 36 has an existing MOD amalgam with marginal breakdown, but no restoration was placed today.' }
    ],
    expectedFacts: [
      {
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'observed',
        temporal: 'current',
        certainty: 'certain',
        anatomy: { teeth: [36], surfaces: ['M', 'O', 'D'] },
        expectedEvidenceKeywords: ['existing MOD amalgam with marginal breakdown', 'no restoration was placed today'],
        value: { condition: 'defective restoration', details: 'existing MOD amalgam' }
      }
    ],
    rationale: 'Clinician explicitly notes no restoration was placed today. Must not generate a performed restoration fact.'
  },

  // =========================================================================
  // 6. PHARMACOLOGY & MEDICAL HISTORY CASES
  // =========================================================================
  {
    id: 'case-med-001',
    datasetVersion: CLINICAL_EVALUATION_CORPUS_VERSION,
    category: 'medication',
    difficulty: 'basic',
    isAdversarial: false,
    clinicalDomain: 'Medical History',
    description: 'Active anticoagulant medication verification',
    transcript: [
      { utteranceId: 'm1', speaker: 'patient', text: 'I am taking Eliquis 5mg twice daily.' }
    ],
    expectedFacts: [
      {
        type: 'medication',
        speaker: 'patient',
        evidenceType: 'patient_reported',
        status: 'observed',
        temporal: 'current',
        certainty: 'certain',
        expectedEvidenceKeywords: ['taking Eliquis 5mg twice daily'],
        value: { drugName: 'Eliquis', dose: '5mg', frequency: 'twice daily', category: 'anticoagulant', bleedingRisk: true }
      }
    ]
  },
  {
    id: 'case-med-002-adv',
    datasetVersion: CLINICAL_EVALUATION_CORPUS_VERSION,
    category: 'medication',
    difficulty: 'adversarial',
    isAdversarial: true,
    clinicalDomain: 'Medical History & Surgical Risk',
    description: 'Adversarial: Patient explicitly denies blood thinners',
    transcript: [
      { utteranceId: 'm2', speaker: 'clinician', text: 'Are you taking any blood thinners like Warfarin or Xarelto?' },
      { utteranceId: 'm3', speaker: 'patient', text: 'No, I deny taking any blood thinners.' }
    ],
    expectedFacts: [
      {
        type: 'medication',
        speaker: 'patient',
        evidenceType: 'patient_reported',
        status: 'negated',
        temporal: 'current',
        certainty: 'certain',
        negationScope: 'blood thinners',
        expectedEvidenceKeywords: ['deny taking any blood thinners'],
        value: { drugName: 'blood thinners', category: 'anticoagulant', bleedingRisk: false }
      }
    ],
    rationale: 'Must not record positive Warfarin or Xarelto medication.'
  },

  // =========================================================================
  // 7. INFORMED CONSENT & REFUSAL CASES
  // =========================================================================
  {
    id: 'case-consent-001-adv',
    datasetVersion: CLINICAL_EVALUATION_CORPUS_VERSION,
    category: 'consent',
    difficulty: 'adversarial',
    isAdversarial: true,
    clinicalDomain: 'Informed Consent & Treatment Planning',
    description: 'Adversarial: Extraction discussed with risks, but patient has not decided',
    transcript: [
      { utteranceId: 'c1', speaker: 'clinician', text: "We discussed extracting tooth 48 including risks of nerve damage and dry socket, but the patient hasn't decided yet." }
    ],
    expectedFacts: [
      {
        type: 'consent',
        speaker: 'clinician',
        evidenceType: 'discussion',
        status: 'discussed',
        temporal: 'current',
        certainty: 'uncertain',
        anatomy: { teeth: [48] },
        expectedEvidenceKeywords: ['discussed extracting tooth 48', "hasn't decided yet"],
        value: {
          procedureDiscussed: 'extraction',
          materialRisksWarned: ['nerve damage', 'dry socket'],
          alternativesDiscussed: [],
          patientResponse: 'requested_time'
        }
      }
    ],
    rationale: 'Treatment discussed but NOT consented and NOT performed. Must not record consent: granted or procedure: performed.'
  },

  // =========================================================================
  // 8. ANAESTHESIA CASES
  // =========================================================================
  {
    id: 'case-anaesthesia-001',
    datasetVersion: CLINICAL_EVALUATION_CORPUS_VERSION,
    category: 'anaesthesia',
    difficulty: 'basic',
    isAdversarial: false,
    clinicalDomain: 'Operative Anaesthesia',
    description: 'Standard local anaesthetic administration',
    transcript: [
      { utteranceId: 'an1', speaker: 'clinician', text: 'Administered 2.2 mL of 4% Articaine with 1:100,000 adrenaline via infiltration for tooth 16.' }
    ],
    expectedFacts: [
      {
        type: 'anaesthetic',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        status: 'performed',
        temporal: 'completed_today',
        certainty: 'certain',
        anatomy: { teeth: [16] },
        expectedEvidenceKeywords: ['4% Articaine with 1:100,000 adrenaline', 'infiltration'],
        value: { agent: 'Articaine', volumeMl: 2.2, adrenaline: '1:100,000', technique: 'infiltration' }
      }
    ]
  },

  // =========================================================================
  // 9. CLINICAL AMBIGUITY & DIFFERENTIAL DIAGNOSIS
  // =========================================================================
  {
    id: 'case-ambiguity-001-adv',
    datasetVersion: CLINICAL_EVALUATION_CORPUS_VERSION,
    category: 'clinical_ambiguity',
    difficulty: 'adversarial',
    isAdversarial: true,
    clinicalDomain: 'Diagnostic Examination',
    description: 'Adversarial: Differential diagnosis without definitive finding',
    transcript: [
      { utteranceId: 'am1', speaker: 'clinician', text: 'Tooth 26 has vague symptoms. Could be a cracked tooth, or possibly early reversible pulpitis.' }
    ],
    expectedFacts: [
      {
        type: 'differential_diagnosis',
        speaker: 'clinician',
        evidenceType: 'clinician_interpretation',
        status: 'observed',
        temporal: 'current',
        certainty: 'uncertain',
        anatomy: { teeth: [26] },
        expectedEvidenceKeywords: ['cracked tooth', 'reversible pulpitis'],
        value: { conditions: ['cracked tooth', 'reversible pulpitis'] }
      }
    ],
    rationale: 'Hedging must be captured as a differential diagnosis with uncertain certainty, not a single definitive diagnosis.'
  }
];
