/**
 * Shared dental domain model for DentAI.
 *
 * This module is imported by BOTH the browser client (React) and the Node
 * server (Express). It must therefore stay free of browser-only globals
 * (localStorage, window, ...) and server-only globals.
 *
 * It owns:
 *  - the appointment / treatment type taxonomy (expanded beyond the original
 *    3 types to 8 core procedure types),
 *  - the built-in note-template library ("owned by us", per product decision),
 *    where every treatment type maps to a default template whose sections
 *    determine which clinical fields the AI extracts from the transcript.
 *
 * Storage keys: a section key that is one of CANONICAL_FIELDS is persisted in
 * the top-level ClinicalFindings fields; every other section key is persisted
 * under findings.customSections[key]. Client and server normalise to exactly
 * this contract.
 */

// ---------------------------------------------------------------------------
// Canonical fields (kept in sync with ClinicalFindings in src/types.ts)
// ---------------------------------------------------------------------------

export const CANONICAL_FIELDS = [
  'chiefComplaint',
  'history',
  'toothFindings',
  'findingsGingival',
  'diagnosis',
  'treatmentPerformed',
  'recommendations',
  'recallRequirements',
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

export const isCanonicalField = (key: string): key is CanonicalField =>
  (CANONICAL_FIELDS as readonly string[]).includes(key);

// ---------------------------------------------------------------------------
// Appointment / treatment types (8 core types)
// ---------------------------------------------------------------------------

export type AppointmentType =
  | 'examination'
  | 'scale_clean'
  | 'emergency'
  | 'restorative'
  | 'endodontic'
  | 'surgical'
  | 'prosthodontic'
  | 'paediatric';

export interface AppointmentTypeInfo {
  /** Stable value persisted on the consultation record. */
  value: AppointmentType;
  /** Human label shown in pickers. */
  label: string;
  /** Short badge label (caps-friendly, e.g. for HistoryHub chips). */
  short: string;
  /** One-line description used in the intake context step. */
  description: string;
  /** Which built-in template is recommended (and pre-selected) for this type. */
  defaultTemplateId: string;
}

export const APPOINTMENT_TYPES: AppointmentTypeInfo[] = [
  {
    value: 'examination',
    label: 'Comprehensive Examination',
    short: 'Exam',
    description: 'Full-mouth assessment, charting, diagnosis and treatment planning for a new or returning patient.',
    defaultTemplateId: 'standard',
  },
  {
    value: 'scale_clean',
    label: 'Scale & Clean (Hygiene)',
    short: 'Scale & Clean',
    description: 'Periodontal assessment, prophylaxis, oral hygiene instruction and recall planning.',
    defaultTemplateId: 'hygiene',
  },
  {
    value: 'emergency',
    label: 'Emergency / Pain',
    short: 'Emergency',
    description: 'Unplanned acute visit — pain, swelling, trauma or broken restoration that needs urgent relief.',
    defaultTemplateId: 'emergency',
  },
  {
    value: 'restorative',
    label: 'Restorative (Filling)',
    short: 'Restorative',
    description: 'Direct restorations — composite/amalgam fillings, including replacement of failing restorations.',
    defaultTemplateId: 'restorative',
  },
  {
    value: 'endodontic',
    label: 'Endodontic (Root Canal)',
    short: 'Endo',
    description: 'Pulp and root canal therapy — diagnosis, access, cleaning/shaping, obturation and review.',
    defaultTemplateId: 'endo',
  },
  {
    value: 'surgical',
    label: 'Surgical (Extraction)',
    short: 'Surgical',
    description: 'Simple and surgical extractions, including third molars, with post-operative care planning.',
    defaultTemplateId: 'surgical',
  },
  {
    value: 'prosthodontic',
    label: 'Prosthodontic (Crown & Bridge)',
    short: 'Prostho',
    description: 'Indirect restorations — crown and bridge preps, provisionals, impressions and fitting visits.',
    defaultTemplateId: 'prostho',
  },
  {
    value: 'paediatric',
    label: 'Paediatric (Child)',
    short: 'Paediatric',
    description: 'Children’s dentistry — behavioural assessment, exams, prevention, restorations and advice to parents.',
    defaultTemplateId: 'paediatric',
  },
];

export const APPOINTMENT_TYPE_BY_VALUE: Record<AppointmentType, AppointmentTypeInfo> = Object.fromEntries(
  APPOINTMENT_TYPES.map((t) => [t.value, t])
) as Record<AppointmentType, AppointmentTypeInfo>;

export const isValidAppointmentType = (v: unknown): v is AppointmentType =>
  typeof v === 'string' && v in APPOINTMENT_TYPE_BY_VALUE;

export const getAppointmentTypeLabel = (v: string): string =>
  isValidAppointmentType(v) ? APPOINTMENT_TYPE_BY_VALUE[v].label : v.replace('_', ' ');

// ---------------------------------------------------------------------------
// Built-in note template library
// ---------------------------------------------------------------------------

export interface TemplateSection {
  /** Stable storage key (== AI JSON schema property). Canonical or custom. */
  key: string;
  /** Display label in the note editor. */
  label: string;
  /** AI prompt guidance / empty-state hint. */
  placeholder: string;
}

export interface NoteTemplate {
  id: string;
  name: string;
  tagline: string;
  description: string;
  /** When set, this template is the recommended default for that treatment type. */
  appointmentType?: AppointmentType;
  /** Format-style templates (AHPRA / SOAP) apply to any treatment type. */
  isFormat?: boolean;
  /** Legacy flag for dentist-defined templates persisted in localStorage. */
  isCustom?: boolean;
  sections: TemplateSection[];
}

export const TEMPLATE_BY_ID: Record<string, NoteTemplate> = {};

const defineTemplate = (t: NoteTemplate): NoteTemplate => {
  TEMPLATE_BY_ID[t.id] = t;
  return t;
};

/**
 * 1. AHPRA Standard (8-point) — default for comprehensive examinations and
 *    the legacy default template id.
 */
defineTemplate({
  id: 'standard',
  name: 'AHPRA Standard (8-Point)',
  tagline: 'Board Record Format',
  description: 'Comprehensive Dental Board (AHPRA/ADA) record format: complaint, history, exam, perio, diagnosis, treatment, advice and recall.',
  appointmentType: 'examination',
  isFormat: true,
  sections: [
    { key: 'chiefComplaint', label: 'Chief Complaint', placeholder: 'Patient reason for visit, symptoms, duration' },
    { key: 'history', label: 'Medical & Dental History', placeholder: 'Relevant medical history, allergies, hygiene habits' },
    { key: 'toothFindings', label: 'Hard Tissue & Tooth Findings', placeholder: 'FDI tooth findings, restorations, decay, mobility' },
    { key: 'findingsGingival', label: 'Periodontal & Soft Tissue', placeholder: 'Gingival health, pocket depths, plaque/calculus' },
    { key: 'diagnosis', label: 'Diagnosis & Clinical Assessment', placeholder: 'Primary and secondary dental diagnoses' },
    { key: 'treatmentPerformed', label: 'Treatment Performed Today', placeholder: 'Procedures, materials, anaesthesia, isolation' },
    { key: 'recommendations', label: 'Preventative Advice & Home Care', placeholder: 'Oral hygiene instructions, dietary advice' },
    { key: 'recallRequirements', label: 'Recall & Next Appointment', placeholder: 'Recommended recall interval and planned treatments' },
  ],
});

/** 2. SOAP format — medical standard, any treatment type. */
defineTemplate({
  id: 'soap',
  name: 'SOAP Format',
  tagline: 'Medical Standard',
  description: 'Concise Subjective, Objective, Assessment and Plan structure used in hospital dentistry and multi-disciplinary clinics.',
  isFormat: true,
  sections: [
    { key: 'subjective', label: 'Subjective (S)', placeholder: 'Patient report, pain scale, symptoms, medical updates' },
    { key: 'objective', label: 'Objective (O)', placeholder: 'Clinical examination, tooth findings, periodontal charting, radiographs' },
    { key: 'assessment', label: 'Assessment (A)', placeholder: 'Diagnosis, caries risk, periodontal classification' },
    { key: 'plan', label: 'Plan (P)', placeholder: 'Treatment performed, prescriptions, patient consent, recall plan' },
  ],
});

/** 3. Hygiene (scale & clean) template — default for scale_clean. */
defineTemplate({
  id: 'hygiene',
  name: 'Hygiene / Periodontal Care',
  tagline: 'Scale & Clean Visit',
  description: 'Periodontal assessment and prophylaxis note: BPE, deposits, hygiene therapy performed, OHI and recall.',
  appointmentType: 'scale_clean',
  sections: [
    { key: 'chiefComplaint', label: 'Patient Report / Concern', placeholder: 'Why the patient booked, bleeding, sensitivity, staining' },
    { key: 'history', label: 'Medical & Smoking History', placeholder: 'Medications (e.g. anticoagulants), diabetes, smoking, pregnancy' },
    { key: 'findingsGingival', label: 'Periodontal Assessment', placeholder: 'BPE scores, pocket depths, bleeding on probing, recession, calculus' },
    { key: 'toothFindings', label: 'Hard Tissue Observations', placeholder: 'Caries, restorations, mobility, sensitivity noted en route' },
    { key: 'diagnosis', label: 'Diagnosis', placeholder: 'e.g. gingivitis, generalised/periodontitis stage, stain only' },
    { key: 'treatmentPerformed', label: 'Hygiene Treatment Performed', placeholder: 'Ultrasonic/hand scaling, polishing, fluoride application, radiographs' },
    { key: 'recommendations', label: 'Oral Hygiene Instruction & Advice', placeholder: 'Brushing/flossing technique, interdental aids, smoking cessation advice' },
    { key: 'recallRequirements', label: 'Recall Interval', placeholder: '3 or 6 month hygiene recall based on risk' },
  ],
});

/** 4. Emergency / pain template — default for emergency. */
defineTemplate({
  id: 'emergency',
  name: 'Emergency & Pain Relief',
  tagline: 'Acute Visit',
  description: 'Focused acute-care note: presenting complaint, differential, immediate treatment provided and urgent follow-up.',
  appointmentType: 'emergency',
  sections: [
    { key: 'chiefComplaint', label: 'Presenting Complaint', placeholder: 'Onset, duration, severity, aggravating/relieving factors' },
    { key: 'history', label: 'History of Complaint & Medical Screen', placeholder: 'Progression, sleep disturbance, relevant medical history/allergies' },
    { key: 'toothFindings', label: 'Clinical Examination', placeholder: 'Offending tooth in FDI notation, caries, fracture, percussion, mobility, swelling' },
    { key: 'findingsGingival', label: 'Soft Tissue / Swelling', placeholder: 'Localised/generalised swelling, sinus tract, trauma to soft tissues' },
    { key: 'diagnosis', label: 'Diagnosis', placeholder: 'e.g. symptomatic irreversible pulpitis, acute apical abscess, cracked tooth' },
    { key: 'treatmentPerformed', label: 'Immediate Treatment Provided', placeholder: 'Relief of occlusion, access, drainage, temporary restoration, prescription' },
    { key: 'recommendations', label: 'Emergency Instructions', placeholder: 'Analgesia, antibiotics if prescribed, red-flag symptoms requiring urgent return' },
    { key: 'recallRequirements', label: 'Follow-up / Next Appointment', placeholder: 'Definitive treatment booked (e.g. RCT or extraction) within days' },
  ],
});

/** 5. Restorative (filling) template — default for restorative (id preserved from legacy). */
defineTemplate({
  id: 'restorative',
  name: 'Restorative (Direct Filling)',
  tagline: 'Filling Appointment',
  description: 'Direct restoration note: tooth and isolation, caries removal, material, shade, occlusion and post-op care.',
  appointmentType: 'restorative',
  sections: [
    { key: 'toothFindings', label: 'Tooth & Reason for Restoration', placeholder: 'FDI tooth number, primary/secondary caries, failing restoration, fracture' },
    { key: 'history', label: 'Sensibility / Symptoms', placeholder: 'Pre-op sensibility testing, symptoms to cold/bite, anaesthesia used' },
    { key: 'diagnosis', label: 'Diagnosis', placeholder: 'e.g. caries into dentine (no pulpal involvement), defective margin' },
    { key: 'treatmentPerformed', label: 'Materials & Technique', placeholder: 'Isolation (rubber dam), caries excavation, liner, etch/bond, composite shade, matrix' },
    { key: 'toothIsolation', label: 'Occlusion & Polish', placeholder: 'Articulating paper check, high spots adjusted, polished, sensitivity check' },
    { key: 'postOpInstructions', label: 'Post-Op Instructions', placeholder: 'Numbness advice, chewing on the tooth, sensitivity expectations' },
    { key: 'recallRequirements', label: 'Review / Recall', placeholder: 'Return if sensitivity persists; routine recall' },
  ],
});

/** 6. Endodontic template — default for endodontic. */
defineTemplate({
  id: 'endo',
  name: 'Endodontic (Root Canal)',
  tagline: 'RCT Session',
  description: 'Endodontic treatment note: pulpal/periapical diagnosis, access, instrumentation, obturation and review.',
  appointmentType: 'endodontic',
  sections: [
    { key: 'chiefComplaint', label: 'Chief Complaint', placeholder: 'Pain history, swelling, sinus, discolouration' },
    { key: 'toothFindings', label: 'Tooth & Diagnostic Testing', placeholder: 'FDI tooth, percussion, palpation, cold/EPT response, mobility, pocket depth' },
    { key: 'diagnosis', label: 'Pulpal & Periapical Diagnosis', placeholder: 'e.g. symptomatic irreversible pulpitis with symptomatic apical periodontitis' },
    { key: 'treatmentPerformed', label: 'Treatment Performed', placeholder: 'Rubber dam, access, working length, instrumentation system, irrigants, medicament or obturation' },
    { key: 'periapicalAssessment', label: 'Radiographic Assessment', placeholder: 'Pre-op/working-length/final radiograph findings, canal anatomy' },
    { key: 'recommendations', label: 'Post-Op Instructions', placeholder: 'Analgesia, avoid chewing on the tooth, definitive restoration planning' },
    { key: 'recallRequirements', label: 'Review / Next Appointment', placeholder: 'Obturation visit or review of symptoms; crown recommendation' },
  ],
});

/** 7. Surgical (extraction) template — default for surgical. */
defineTemplate({
  id: 'surgical',
  name: 'Surgical (Extraction)',
  tagline: 'Extraction Visit',
  description: 'Oral surgery note: indication, medical screen, anaesthesia, procedure, complications and post-op care.',
  appointmentType: 'surgical',
  sections: [
    { key: 'chiefComplaint', label: 'Indication / Reason for Extraction', placeholder: 'Non-restorable tooth, periodontally hopeless, ortho, impacted third molar' },
    { key: 'history', label: 'Medical Screen', placeholder: 'Anticoagulants, bisphosphonates, allergies, ASA status, consent confirmed' },
    { key: 'toothFindings', label: 'Pre-Op Assessment', placeholder: 'FDI tooth, mobility, caries extent, root morphology on radiograph' },
    { key: 'diagnosis', label: 'Diagnosis', placeholder: 'e.g. grossly carious non-restorable tooth 46 with chronic apical periodontitis' },
    { key: 'treatmentPerformed', label: 'Procedure Performed', placeholder: 'LA used, simple forceps or surgical flap/odontectomy, sutures placed, haemostasis' },
    { key: 'postOpInstructions', label: 'Post-Op Instructions', placeholder: 'Bite pack, analgesia, ice, no smoking, socket care, when to seek help' },
    { key: 'recallRequirements', label: 'Review / Follow-up', placeholder: 'Suture removal, review if pain/swelling worsens after 48-72h' },
  ],
});

/** 8. Prosthodontic (crown & bridge) template — default for prosthodontic. */
defineTemplate({
  id: 'prostho',
  name: 'Prosthodontic (Crown & Bridge)',
  tagline: 'Indirect Restoration',
  description: 'Fixed prosthodontics note: prep, provisional, impression/shade, fit and cementation visits.',
  appointmentType: 'prosthodontic',
  sections: [
    { key: 'chiefComplaint', label: 'Patient Concern / Indication', placeholder: 'Fractured cusp, failed crown, endodontically treated tooth needing crown' },
    { key: 'toothFindings', label: 'Tooth & Preparation', placeholder: 'FDI tooth, existing restoration removed, margin design, remaining tooth structure' },
    { key: 'diagnosis', label: 'Diagnosis / Treatment Plan', placeholder: 'e.g. cracked tooth syndrome — full coverage crown planned on tooth 26' },
    { key: 'treatmentPerformed', label: 'Procedure Performed', placeholder: 'Prep, retraction cord, provisional fabricated and cemented, shade taken' },
    { key: 'provisionalNote', label: 'Provisional & Lab Note', placeholder: 'Temporisation cement, occlusion checked, lab slip instructions' },
    { key: 'recommendations', label: 'Provisional Care Advice', placeholder: 'Avoid hard/sticky foods on provisional, sensitivity expectations' },
    { key: 'recallRequirements', label: 'Next Appointment', placeholder: 'Fit/cementation visit booked; review of margins and occlusion' },
  ],
});

/** 9. Paediatric template — default for paediatric. */
defineTemplate({
  id: 'paediatric',
  name: 'Paediatric (Child)',
  tagline: 'Child Visit',
  description: 'Children’s dentistry note: presenting concern, behaviour, examination, preventive care and parent advice.',
  appointmentType: 'paediatric',
  sections: [
    { key: 'chiefComplaint', label: 'Presenting Concern (Parent/Child)', placeholder: 'Pain, caries risk concern, trauma, routine check-up, referral from school dental' },
    { key: 'history', label: 'Medical / Dental History', placeholder: 'Age, medical conditions, fluoride exposure, diet (juice/snacking), brushing' },
    { key: 'behaviourAssessment', label: 'Behaviour & Cooperation', placeholder: 'Frankl scale or description, anxiety, tell-show-do approach used' },
    { key: 'toothFindings', label: 'Clinical Examination', placeholder: 'FDI primary/permanent teeth findings, caries, enamel defects, trauma, occlusion' },
    { key: 'diagnosis', label: 'Diagnosis & Risk Assessment', placeholder: 'Caries risk level, active lesions, hypomineralisation' },
    { key: 'treatmentPerformed', label: 'Treatment / Prevention Provided', placeholder: 'Exam, fluoride varnish, fissure sealants, restorations, radiographs, advice' },
    { key: 'recommendations', label: 'Advice to Parent / Carer', placeholder: 'Dietary advice, supervised brushing with toothpaste strength, follow-up needed' },
    { key: 'recallRequirements', label: 'Recall', placeholder: 'Child recall interval (e.g. 6-12 months based on risk)' },
  ],
});

/** Built-in templates in display order: formats first, then by treatment type. */
export const BUILT_IN_TEMPLATES: NoteTemplate[] = [
  TEMPLATE_BY_ID.standard,
  TEMPLATE_BY_ID.soap,
  TEMPLATE_BY_ID.hygiene,
  TEMPLATE_BY_ID.emergency,
  TEMPLATE_BY_ID.restorative,
  TEMPLATE_BY_ID.endo,
  TEMPLATE_BY_ID.surgical,
  TEMPLATE_BY_ID.prostho,
  TEMPLATE_BY_ID.paediatric,
];

export const getTemplateById = (id: string | undefined | null): NoteTemplate =>
  (id && TEMPLATE_BY_ID[id]) || TEMPLATE_BY_ID.standard;

export const getDefaultTemplateIdForType = (type: AppointmentType): string =>
  APPOINTMENT_TYPE_BY_VALUE[type].defaultTemplateId;

export const getTemplateLabel = (id: string | undefined | null): string =>
  getTemplateById(id).name;
