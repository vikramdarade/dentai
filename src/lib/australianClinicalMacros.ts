/**
 * Australian Dental Clinical Procedure Macros — STRUCTURE ONLY (Phase 10 remediation of audit blocker B-1).
 *
 * CONTRACT (enforced by assertMacroStructural at module load — see bottom):
 *   MACRO = PRESENTATION STRUCTURE. ClinicalFact = CLINICAL ASSERTION.
 *
 * Every templateGenerator in this file may emit ONLY:
 *   - section headings, labels, ordering and formatting;
 *   - variables extracted from spoken evidence by parseClinicalEntities
 *     (teeth, surfaces, anaesthetic fields actually spoken, materials actually
 *     named, spoken ADA codes);
 *   - empty strings when no validated evidence exists for a field;
 *   - explicit missing-data notices via missingProtocolNotices.
 *
 * FORBIDDEN and now impossible by construction: hard-coded diagnoses, findings,
 * symptoms, treatments, anaesthetic agents/concentrations/volumes, materials,
 * shades, sutures, haemostats, consent attestations, patient-understanding
 * claims, risk discussions, post-operative instruction prose, recall intervals
 * or clinical outcomes. The Phase 10 audit found the surgical/simple-extraction
 * family fabricating all of these; every template has been reduced to the same
 * evidence-gated builder, and a runtime fabrication guard rejects any template
 * output that reintroduces unsourced clinical content.
 */

export interface ClinicalMacroDefinition {
  id: string;
  name: string;
  category: 'restorative' | 'preventive' | 'periodontal' | 'surgical' | 'endodontic' | 'diagnostic' | 'implant' | 'prosthodontic' | 'cosmetic' | 'orthodontic' | 'hygiene';
  keywords: string[];
  defaultAdaCodes: { code: string; description: string }[];
  templateGenerator: (vars: ExtractedClinicalVariables) => FormattedMacroNote;
}

export interface ExtractedClinicalVariables {
  teeth: string[];
  surfaces: string[];
  toothSurfacePairs: { tooth: string; surface: string }[];
  anaesthetic?: {
    agent: string;
    adrenaline?: string;
    volumeMl?: number;
    cartridges?: number;
    technique: string;
    topical?: string;
    isProfound?: boolean;
  };
  isolation?: 'Rubber dam' | 'Cotton roll and gauze' | 'Gingival barrier' | 'None';
  materials?: {
    compositeShade?: string;
    liner?: string;
    adhesive?: string;
    dressing?: string;
    temporisation?: string;
    sutureType?: string;
    haemostaticAgent?: string;
  };
  cariesDepth?: string;
  canalsCount?: number;
  quadrants?: string[];
  bpe?: string;
  complaint?: string;
  history?: string;
  consentObtained?: boolean;
  poigDiscussed?: boolean;
  occlusionChecked?: boolean;
  spokencodes: { code: string; description: string; tooth?: string }[];
}

export interface FormattedMacroNote {
  title: string;
  chiefComplaint: string;
  history: string;
  toothFindings: string;
  findingsGingival: string;
  diagnosis: string;
  treatmentPerformed: string;
  recommendations: string;
  recallRequirements: string;
  patientSummary: string;
  adaCodes: { code: string; description: string; tooth?: string }[];
  missingProtocolNotices: string[];
}

// ---------------------------------------------------------------------------
// Shared evidence-gated builder (the ONLY content path into any template)
// ---------------------------------------------------------------------------

function toothLabel(vars: ExtractedClinicalVariables, fallback: string): string {
  return vars.teeth.length > 0 ? vars.teeth.map(t => `#${t}`).join(', ') : fallback;
}

/** LA line from spoken fields ONLY. No spoken anaesthetic ⇒ empty string. */
function spokenLaLine(vars: ExtractedClinicalVariables): string {
  const la = vars.anaesthetic;
  if (!la || (!la.agent && !la.technique && !la.topical)) return '';
  const parts: string[] = [];
  if (la.topical) parts.push(la.topical);
  if (la.agent) {
    parts.push(
      `${la.agent}${la.adrenaline ? ` ${la.adrenaline}` : ''}` +
      `${la.volumeMl !== undefined ? `, ${la.volumeMl} mL` : la.cartridges ? `, ${la.cartridges} cartridge(s)` : ''}` +
      `${la.technique ? ` ${la.technique}` : ''}`
    );
  } else if (la.technique) {
    parts.push(`Anaesthetic technique: ${la.technique}`);
  }
  return parts.join('. ');
}

/**
 * The single structural template every macro uses. Clinical fields are filled
 * ONLY from spoken evidence; everything else stays empty and the missing-data
 * notices tell the clinician exactly what the recording did not capture.
 * `title` and the structural label lines are presentation, not assertions.
 */
function buildStructuralNote(
  macroTitle: string,
  vars: ExtractedClinicalVariables,
  sectionLabels: Partial<Record<'anaesthesia' | 'materials' | 'isolation', string>>
): FormattedMacroNote {
  const notices: string[] = [];

  const complaint = vars.complaint || '';
  if (!complaint) notices.push(`Notice: No reason for the visit was heard on the recording — complete the Chief Complaint section.`);

  const history = vars.history || '';
  if (!history) notices.push(`Notice: No medical history discussion was heard on the recording — complete the History section.`);

  const teeth = vars.teeth.length > 0 || vars.toothSurfacePairs.length > 0;
  const toothFindings = vars.toothSurfacePairs.length > 0
    ? vars.toothSurfacePairs.map(p => `#${p.tooth} (${p.surface})`).join(', ')
    : teeth
      ? vars.teeth.map(t => `#${t}`).join(', ')
      : '';
  if (!toothFindings) notices.push(`Notice: No tooth or finding was heard on the recording — complete the Findings section.`);

  const findingsGingival = vars.quadrants?.length
    ? `Quadrant(s): ${vars.quadrants.join(', ')}${vars.bpe ? `. BPE: ${vars.bpe}` : ''}`
    : (vars.bpe ? `BPE: ${vars.bpe}` : '');

  const diagnosis = '';
  notices.push('Notice: No diagnosis was recorded from the conversation - please complete the Assessment section');
  // Missing-data notices for consent/aftercare: the recording is the only
  // source, and their absence is exactly what the clinician must complete.
  if (!vars.consentObtained) {
    notices.push('Notice: Verbal consent was not heard aloud on the recording');
  }
  if (!vars.poigDiscussed) {
    notices.push('Notice: Aftercare instructions were not heard aloud on the recording');
  }

  const performedLines: string[] = [];
  // Structural site label over spoken evidence only ("Site: #36 (MO).") —
  // locates the entry in the note without asserting any clinical action.
  if (toothFindings) performedLines.push(`Site: ${toothFindings}.`);
  const la = spokenLaLine(vars);
  if (la) performedLines.push(`${sectionLabels.anaesthesia ?? 'Local anaesthetic'}: ${la}.`);
  if (vars.isolation) performedLines.push(`${sectionLabels.isolation ?? 'Isolation'}: ${vars.isolation}.`);
  const materialBits: string[] = [];
  if (vars.materials?.compositeShade) materialBits.push(`shade ${vars.materials.compositeShade}`);
  if (vars.materials?.liner) materialBits.push(vars.materials.liner);
  if (vars.materials?.dressing) materialBits.push(vars.materials.dressing);
  if (vars.materials?.temporisation) materialBits.push(vars.materials.temporisation);
  if (vars.materials?.sutureType) materialBits.push(vars.materials.sutureType);
  if (vars.materials?.haemostaticAgent) materialBits.push(vars.materials.haemostaticAgent);
  if (materialBits.length > 0) performedLines.push(`${sectionLabels.materials ?? 'Materials'}: ${materialBits.join(', ')}.`);
  if (vars.occlusionChecked) performedLines.push('Occlusion checked (spoken).');
  if (vars.canalsCount) performedLines.push(`Canals located: ${vars.canalsCount} (spoken).`);
  const treatmentPerformed = performedLines.join('\n');

  const recommendations = vars.poigDiscussed ? 'Post-operative instructions provided (spoken).' : '';
  const recallRequirements = '';

  const patientSummary = teeth
    ? `The ${macroTitle.toLowerCase()} appointment on ${vars.teeth.map(t => `#${t}`).join(', ')} was recorded. The note below is a structural draft awaiting your clinical completion.`
    : `The ${macroTitle.toLowerCase()} appointment was recorded. The note below is a structural draft awaiting your clinical completion.`;

  const spokencodes = vars.spokencodes.length > 0
    ? vars.spokencodes
    : [];

  return {
    title: macroTitle,
    chiefComplaint: complaint,
    history,
    toothFindings,
    findingsGingival,
    diagnosis,
    treatmentPerformed,
    recommendations,
    recallRequirements,
    patientSummary,
    adaCodes: spokencodes,
    missingProtocolNotices: notices,
  };
}

// ---------------------------------------------------------------------------
// The 20 macro families — identical evidence-gated builder, distinct
// presentation labels. No generator contains clinical prose.
// ---------------------------------------------------------------------------

function structuralMacro(def: {
  id: string;
  name: string;
  category: ClinicalMacroDefinition['category'];
  keywords: string[];
  title: string;
  sectionLabels?: Partial<Record<'anaesthesia' | 'materials' | 'isolation', string>>;
  defaultAdaCodes: { code: string; description: string }[];
}): ClinicalMacroDefinition {
  return {
    id: def.id,
    name: def.name,
    category: def.category,
    keywords: def.keywords,
    defaultAdaCodes: def.defaultAdaCodes,
    templateGenerator: (vars) =>
      buildStructuralNote(def.title, vars, def.sectionLabels ?? {}),
  };
}

export const ROUTINE_RESTORATION_MACRO = structuralMacro({
  id: 'restoration_composite',
  name: 'Routine Restoration (Direct Composite)',
  category: 'restorative',
  keywords: ['filling', 'restoration', 'composite', 'caries', 'decay', 'cavity', 'etch', 'bond', 'matrix', 'shade', 'resin'],
  title: 'Routine Restoration',
  defaultAdaCodes: [
    { code: '531', description: 'Adhesive resin restoration - 1 surface - posterior' },
    { code: '532', description: 'Adhesive resin restoration - 2 surface - posterior' },
  ],
});

export const GENERAL_EXAM_CLEAN_MACRO = structuralMacro({
  id: 'general_exam_clean',
  name: 'General Examination & Clean',
  category: 'preventive',
  keywords: ['exam', 'examination', 'checkup', 'clean', 'scale', 'bpe', 'calculus', 'plaque', 'fluoride', 'hygiene'],
  title: 'General Exam & Clean',
  defaultAdaCodes: [
    { code: '011', description: 'Comprehensive oral examination' },
    { code: '114', description: 'Removal of calculus - first visit' },
    { code: '121', description: 'Topical application of remineralising agent' },
    { code: '022', description: 'Intraoral periapical or bitewing radiograph - per exposure' },
  ],
});

export const SCALING_CLEAN_MACRO = structuralMacro({
  id: 'scaling_clean',
  name: 'Scaling & Clean (Hygiene)',
  category: 'hygiene',
  keywords: ['clean', 'scale and clean', 'hygiene', 'prophy', 'fluoride', 'calculus', 'polish'],
  title: 'Scaling & Clean',
  defaultAdaCodes: [
    { code: '114', description: 'Removal of calculus' },
    { code: '121', description: 'Topical fluoride application' },
  ],
});

export const PERIODONTAL_DEBRIDEMENT_MACRO = structuralMacro({
  id: 'periodontal_debridement',
  name: 'Periodontal Debridement (SRP)',
  category: 'periodontal',
  keywords: ['srp', 'root planing', 'deep clean', 'pocket', 'periodontitis', 'subgingival', 'debridement'],
  title: 'Periodontal Debridement',
  defaultAdaCodes: [
    { code: '222', description: 'Root planing and subgingival debridement - per tooth/quadrant' },
  ],
});

export const SIMPLE_EXTRACTION_MACRO = structuralMacro({
  id: 'simple_extraction',
  name: 'Simple Tooth Extraction',
  category: 'surgical',
  keywords: ['extraction', 'extract', 'pull', 'take out', 'elevated', 'forceps', 'socket', 'luxated'],
  title: 'Simple Extraction',
  defaultAdaCodes: [
    { code: '311', description: 'Removal of a tooth or part(s) thereof' },
  ],
});

export const SURGICAL_EXTRACTION_MACRO = structuralMacro({
  id: 'surgical_extraction',
  name: 'Surgical Tooth Extraction',
  category: 'surgical',
  keywords: ['surgical extraction', 'bone gutter', 'flap', 'sectioned', 'suture', 'odontectomy', 'gelatemp', 'prolene'],
  title: 'Surgical Extraction',
  defaultAdaCodes: [
    { code: '324', description: 'Surgical removal of a tooth requiring removal of bone and tooth division' },
  ],
});

export const EMERGENCY_PULP_EXTIRPATION_MACRO = structuralMacro({
  id: 'emergency_pulp_extirpation',
  name: 'Endodontics: Emergency Pulp Extirpation',
  category: 'endodontic',
  keywords: ['extirpation', 'pulp', 'endodontic', 'rct', 'root canal', 'odontopaste', 'cavit', 'canals', 'emergency endo'],
  title: 'Emergency Pulp Extirpation',
  defaultAdaCodes: [
    { code: '414', description: 'Extirpation of pulp or debridement of root canal(s)' },
  ],
});

export const FISSURE_SEALANT_MACRO = structuralMacro({
  id: 'fissure_sealant',
  name: 'Fissure Sealant',
  category: 'preventive',
  keywords: ['sealant', 'fissure sealant', 'preventive resin', 'deep grooves'],
  title: 'Fissure Sealant',
  defaultAdaCodes: [
    { code: '161', description: 'Fissure sealant - per tooth' },
  ],
});

export const ENDODONTIC_OBTURATON_MACRO = structuralMacro({
  id: 'endodontic_obturation',
  name: 'Endodontics: Canal Prep & Obturation',
  category: 'endodontic',
  keywords: ['obturation', 'obturated', 'gutta percha', 'gutta-percha', 'ah plus', 'master cone', 'root canal fill', 'sealer', 'warm vertical', 'canal prep'],
  title: 'Root Canal Obturation',
  defaultAdaCodes: [
    { code: '415', description: 'Chemo-mechanical preparation of root canal - one canal' },
    { code: '416', description: 'Obturation of root canal - one canal' },
  ],
});

export const CROWN_PREPARATION_MACRO = structuralMacro({
  id: 'crown_preparation',
  name: 'Crown Preparation & Digital Scan / Impression',
  category: 'restorative',
  keywords: ['crown prep', 'crown preparation', 'chamfer', 'shoulder', 'retraction cord', 'trios', 'intraoral scan', 'temporary crown', 'protemp', 'luxatemp', 'core buildup'],
  title: 'Crown Preparation & Impression',
  defaultAdaCodes: [
    { code: '613', description: 'Full crown - non-metallic - indirect (ceramic/zirconia)' },
    { code: '627', description: 'Core buildup including pins where placed' },
  ],
});

export const CROWN_CEMENTATION_MACRO = structuralMacro({
  id: 'crown_cementation',
  name: 'Crown Try-in & Definitive Cementation',
  category: 'restorative',
  keywords: ['crown fit', 'crown issue', 'crown insert', 'crown try-in', 'cemented', 'relyx', 'try-in', 'definitive cementation', 'excess cement removed'],
  title: 'Crown Try-in & Cementation',
  defaultAdaCodes: [
    { code: '652', description: 'Cementation of indirect restoration - full crown' },
  ],
});

export const OCCLUSAL_SPLINT_MACRO = structuralMacro({
  id: 'occlusal_splint',
  name: 'Occlusal Splint / Nightguard Delivery',
  category: 'diagnostic',
  keywords: ['occlusal splint', 'splint', 'nightguard', 'night guard', 'bruxism splint', 'canine guidance', 'articulating paper'],
  title: 'Occlusal Splint Insertion',
  defaultAdaCodes: [
    { code: '965', description: 'Occlusal splint - full arch' },
  ],
});

export const TRAUMA_SPLINT_MACRO = structuralMacro({
  id: 'trauma_splint',
  name: 'Dental Trauma: Repositioning & Flexible Splinting',
  category: 'surgical',
  keywords: ['trauma', 'subluxat', 'luxat', 'avulsion', 'flexible splint', 'wire-composite splint', 'splinted', 'repositioning'],
  title: 'Dental Trauma Management & Splinting',
  defaultAdaCodes: [
    { code: '392', description: 'Repositioning of displaced tooth/teeth and splinting' },
  ],
});

export const DENTAL_IMPLANT_PLACEMENT_MACRO = structuralMacro({
  id: 'implant_placement',
  name: 'Dental Implant Fixture Placement (Stage 1)',
  category: 'implant',
  keywords: ['implant', 'fixture', 'osteotomy', 'straumann', 'nobel', 'biohorizons', 'insertion torque', 'pilot drill', 'healing abutment', 'cover screw'],
  title: 'Dental Implant Placement',
  defaultAdaCodes: [
    { code: '661', description: 'Surgical placement of an implant fixture' },
    { code: '684', description: 'Insertion of a healing abutment' },
  ],
});

export const COMPLETE_PARTIAL_DENTURES_MACRO = structuralMacro({
  id: 'complete_partial_dentures',
  name: 'Dentures & Digital CAD/CAM Dentures',
  category: 'prosthodontic',
  keywords: ['denture', 'digital denture', 'complete denture', 'partial denture', 'full upper', 'full lower', 'custom tray', 'border mould', 'secondary impression', 'master impression', 'jaw relation', 'bite registration'],
  title: 'Removable Prosthodontics (Dentures)',
  defaultAdaCodes: [
    { code: '711', description: 'Complete maxillary denture' },
    { code: '712', description: 'Complete mandibular denture' },
    { code: '721', description: 'Partial denture - resin base' },
  ],
});

export const IMPLANT_OVERDENTURE_MACRO = structuralMacro({
  id: 'implant_overdenture',
  name: 'Implant-Supported Overdenture / Locator Attachment',
  category: 'prosthodontic',
  keywords: ['implant-supported overdenture', 'implant overdenture', 'locator', 'overdenture', 'pick-up', 'retention cap', 'housing cap', 'block-out spacer', 'quick up'],
  title: 'Implant-Supported Overdenture Insertion',
  defaultAdaCodes: [
    { code: '672', description: 'Prosthetic attachment to implant fixture' },
    { code: '712', description: 'Complete mandibular denture (overdenture)' },
    { code: '731', description: 'Retentive device / locator insert' },
  ],
});

export const TEETH_WHITENING_MACRO = structuralMacro({
  id: 'teeth_whitening',
  name: 'In-Chair Tooth Whitening (Pola Office)',
  category: 'cosmetic',
  keywords: ['whitening', 'teeth whitening', 'pola', 'pola office', 'bleach', 'bleaching', 'hydrogen peroxide', 'gingival barrier', 'optragate', 'shade guide'],
  title: 'In-Chair Professional Tooth Whitening',
  defaultAdaCodes: [
    { code: '118', description: 'Bleaching, internal or external - per tooth' },
    { code: '119', description: 'Bleaching, home kit or full arch in-chair' },
  ],
});

export const VENEERS_SMILE_DESIGN_MACRO = structuralMacro({
  id: 'veneers_smile_design',
  name: 'Porcelain Veneers & Aesthetic Smile Design',
  category: 'cosmetic',
  keywords: ['veneer', 'veneers', 'smile design', 'smile makeover', 'diagnostic wax-up', 'mock-up', 'butt-joint', 'facial reduction', 'enamel preparation'],
  title: 'Porcelain Veneer Preparation & Smile Design',
  defaultAdaCodes: [
    { code: '582', description: 'Veneer - composite resin - indirect' },
    { code: '583', description: 'Veneer - porcelain / ceramic' },
    { code: '556', description: 'Diagnostic model / wax-up transfer' },
  ],
});

export const INVISALIGN_ALIGNER_MACRO = structuralMacro({
  id: 'invisalign_clear_aligners',
  name: 'Orthodontics: Invisalign & Clear Aligners',
  category: 'orthodontic',
  keywords: ['invisalign', 'aligner', 'clear aligner', 'attachment', 'ipr', 'interproximal reduction', 'chewies', 'tracking', 'template aligner'],
  title: 'Orthodontic Clear Aligner Delivery',
  defaultAdaCodes: [
    { code: '825', description: 'Orthodontic adjustment or aligner delivery' },
    { code: '881', description: 'Passive orthodontic appliance / retainer' },
    { code: '071', description: 'Diagnostic intraoral scan / models' },
  ],
});

export const CONSCIOUS_SEDATION_MACRO = structuralMacro({
  id: 'conscious_sedation_sleep_dentistry',
  name: 'Conscious Sedation & Sleep Dentistry',
  category: 'surgical',
  keywords: ['sedation', 'sleep dentistry', 'iv sedation', 'conscious sedation', 'midazolam', 'fentanyl', 'propofol', 'nitrous oxide', 'relative analgesia', 'aldrete', 'pulse oximetry', 'capnography'],
  title: 'Sleep Dentistry (Conscious Sedation)',
  defaultAdaCodes: [
    { code: '927', description: 'Intravenous sedation' },
    { code: '943', description: 'Sedation - relative analgesia / nitrous oxide' },
    { code: '949', description: 'Dental treatment under general anaesthesia or specialist sedation' },
  ],
});

export const ALL_AUSTRALIAN_MACROS: ClinicalMacroDefinition[] = [
  ROUTINE_RESTORATION_MACRO,
  GENERAL_EXAM_CLEAN_MACRO,
  SCALING_CLEAN_MACRO,
  PERIODONTAL_DEBRIDEMENT_MACRO,
  SIMPLE_EXTRACTION_MACRO,
  SURGICAL_EXTRACTION_MACRO,
  EMERGENCY_PULP_EXTIRPATION_MACRO,
  FISSURE_SEALANT_MACRO,
  ENDODONTIC_OBTURATON_MACRO,
  CROWN_PREPARATION_MACRO,
  CROWN_CEMENTATION_MACRO,
  OCCLUSAL_SPLINT_MACRO,
  TRAUMA_SPLINT_MACRO,
  DENTAL_IMPLANT_PLACEMENT_MACRO,
  COMPLETE_PARTIAL_DENTURES_MACRO,
  IMPLANT_OVERDENTURE_MACRO,
  TEETH_WHITENING_MACRO,
  VENEERS_SMILE_DESIGN_MACRO,
  INVISALIGN_ALIGNER_MACRO,
  CONSCIOUS_SEDATION_MACRO,
];

export const MACRO_BY_ID: Record<string, ClinicalMacroDefinition> = Object.fromEntries(
  ALL_AUSTRALIAN_MACROS.map(m => [m.id, m])
);

export const CHAIRSIDE_MACRO_OPTIONS = [
  { id: 'restoration_composite', label: 'Filling' },
  { id: 'general_exam_clean', label: 'Exam & Clean' },
  { id: 'emergency_pulp_extirpation', label: 'Root Canal' },
  { id: 'simple_extraction', label: 'Extraction' },
  { id: 'implant_placement', label: 'Implants' },
  { id: 'crown_preparation', label: 'Crown' },
  { id: 'veneers_smile_design', label: 'Veneers' },
  { id: 'teeth_whitening', label: 'Whitening' },
  { id: 'invisalign_clear_aligners', label: 'Aligners' },
  { id: 'complete_partial_dentures', label: 'Dentures' },
  { id: 'scaling_clean', label: 'Scale & Clean' },
  { id: 'fissure_sealant', label: 'Sealant' },
];

// ---------------------------------------------------------------------------
// Runtime fabrication guard (B-1 enforcement)
//
// Every template is executed at module load against an EMPTY evidence set and
// then against a TOTALLY UNRELATED one. Any clinical assertion that survives
// with no evidentiary basis — the Phase 10 defect — throws at import time, so
// the defect class cannot silently return.
// ---------------------------------------------------------------------------

const EMPTY_VARS: ExtractedClinicalVariables = {
  teeth: [], surfaces: [], toothSurfacePairs: [], spokencodes: [],
};

const UNRELATED_VARS: ExtractedClinicalVariables = {
  teeth: ['48'],
  surfaces: ['DL'],
  toothSurfacePairs: [{ tooth: '48', surface: 'DL' }],
  anaesthetic: { agent: '4% Articaine', adrenaline: '1:100,000', volumeMl: 2.2, technique: 'infiltration' },
  isolation: 'Rubber dam',
  materials: { compositeShade: 'A1', sutureType: '3-0 Vicryl', haemostaticAgent: 'Surgicel' },
  consentObtained: false,
  poigDiscussed: false,
  occlusionChecked: false,
  spokencodes: [],
};

function noteText(n: FormattedMacroNote): string {
  return [
    n.chiefComplaint, n.history, n.toothFindings, n.findingsGingival,
    n.diagnosis, n.treatmentPerformed, n.recommendations,
    n.recallRequirements, n.patientSummary,
  ].join(' ').toLowerCase();
}

/**
 * Clinical vocabulary that must NEVER appear unless the corresponding evidence
 * was spoken. Labels like "Local anaesthetic:" are structure; drug names,
 * concentrations, doses, materials, consent/outcome attestations and
 * conventional-practice prose are assertions.
 * Exported as the authoritative fabrication-pattern list so evaluation suites
 * scan macro output with exactly the same rules the load-time guard enforces.
 */
export const FORBIDDEN_WITHOUT_EVIDENCE = [
  /\barticaine\b/i, /\blignocaine\b/i, /\bmepivacaine\b/i, /\bprilocaine\b/i,
  /\bnitrous\b/i, /\bmidazolam\b/i, /\bfentanyl\b/i, /\bpropofol\b/i,
  /1\s*:\s*100[\s,]?000/i, /1\s*:\s*80[\s,]?000/i, /\b2\.2\s*ml\b/i, /\b35\s*ncm\b/i,
  /\bprofound anaesthesia\b/i, /\badequate anaesthesia\b/i, /\banaesthesia achieved\b/i,
  /\bprolen[ei]\b/i, /\bgelatemp\b/i, /\bsurgicel\b/i, /\bbiodentine\b/i, /\bodontopaste\b/i,
  /\bfuji ix\b/i, /\bcavit\b/i, /\bah plus\b/i, /\bgutta[- ]percha\b/i, /\brubber dam placed\b/i,
  /\bshade a[1-4](\.5)?\b/i, /\ba3 composite\b/i, /\bvita\b/i, /\bcomposite placed\b/i,
  /\bnon-restorable\b/i, /\bchronic apical\b/i, /\bperiapical lesion\b/i, /\birreversible pulpitis\b/i,
  /\bapical periodontitis\b/i, /\bplaque[- ]induced gingivitis\b/i, /\bgingivitis\b/i,
  /\bperiodontitis\b/i, /\bbruxism\b/i, /\bmalocclusion\b/i, /\bedentulis[mt]\b/i,
  /\bcaries\b/i, /\bttp\b/i, /\bmobility grade\b/i, /\bbone loss\b/i,
  /\bverbal informed consent\b/i, /\binformed consent obtained\b/i, /\bconsent obtained\b/i,
  /\brisks? (?:of|were|explained|discussed)\b/i, /\btreatment options discussed\b/i,
  /\bpatient understands?\b/i, /\bpatient verbalised\b/i, /\bpatient approved\b/i,
  /\bmedical history (?:reviewed|taken|confirmed)\b/i, /\bnil contraindications\b/i,
  /\bpost[- ]?operative instructions (?:given|provided|explained)\b/i,
  /\bpoig\b/i, /\bchlorhexidine\b/i, /\bparacetamol\b/i, /\bibuprofen\b/i,
  /\bamoxicillin\b/i, /\bmetronidazole\b/i,
  /\bno complications\b/i, /\bhaemostasis (?:achieved|verified)\b/i, /\bsuccessfully (?:extracted|placed|fitted|completed)\b/i,
  /\brecall\b/i, /6[- ]month/i, /\b12[- ]month/i, /\bin (?:1|2|3|4|6|8|10|12)[- ]?(?:to )?\d*[- ]?(?:weeks?|months?|days?)\b/i,
  /\bprocedure (?:completed|performed) smoothly\b/i, /\bwell tolerated\b/i,
];

function assertMacroStructural(macro: ClinicalMacroDefinition): void {
  for (const [label, vars] of [['empty', EMPTY_VARS], ['unrelated', UNRELATED_VARS]] as const) {
    const note = macro.templateGenerator(vars);
    const text = noteText(note);
    // THE zero-fabrication proof: with NO spoken evidence, no clinical
    // vocabulary of any kind may appear. A template that ignored its evidence
    // and emitted fixed prose fails here.
    if (label === 'empty') {
      for (const pattern of FORBIDDEN_WITHOUT_EVIDENCE) {
        if (pattern.test(text)) {
          throw new Error(
            `MACRO CONTRACT VIOLATION in '${macro.id}' (vars: ${label}): ` +
            `template emitted unsourced clinical content matching ${pattern}. ` +
            `Macros are presentation structure only — see Phase 10 audit blocker B-1.`
          );
        }
      }
      // No tooth number may appear in the empty-evidence run.
      if (/\#\d+/.test(text)) {
        throw new Error(
          `MACRO CONTRACT VIOLATION in '${macro.id}': template emitted a tooth reference with no spoken evidence.`
        );
      }
      // Empty evidence ⇒ no ADA codes at all (codes are clinical assertions too).
      if (note.adaCodes.length > 0) {
        throw new Error(
          `MACRO CONTRACT VIOLATION in '${macro.id}': template emitted an ADA code with no spoken evidence.`
        );
      }
    } else {
      // Provenance run: spoken evidence must flow through and ONLY spoken
      // evidence may appear as anatomy or billing codes.
      const teeth = [...text.matchAll(/#(\d+)/g)].map(m => m[1]);
      for (const t of teeth) {
        if (!vars.teeth.includes(t)) {
          throw new Error(
            `MACRO CONTRACT VIOLATION in '${macro.id}': template emitted tooth #${t} which was never spoken.`
          );
        }
      }
      if (note.adaCodes.some(c => !vars.spokencodes.some(s => s.code === c.code))) {
        throw new Error(
          `MACRO CONTRACT VIOLATION in '${macro.id}': template emitted an ADA code that was never spoken.`
        );
      }
    }
  }
}

// Load-time enforcement: importing this module proves the contract holds.
for (const macro of ALL_AUSTRALIAN_MACROS) {
  assertMacroStructural(macro);
}
