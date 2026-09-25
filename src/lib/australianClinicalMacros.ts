/**
 * Australian Dental Clinical Procedure Macros
 *
 * Gold-standard clinical templates provided by practicing Australian dental clinicians.
 * Compliant with AHPRA, Dental Board of Australia record-keeping guidelines,
 * and Australian Dental Association (ADA) billing item conventions.
 */

export interface ClinicalMacroDefinition {
  id: string;
  name: string;
  category: 'restorative' | 'preventive' | 'periodontal' | 'surgical' | 'endodontic' | 'diagnostic' | 'implant' | 'prosthodontic' | 'cosmetic' | 'orthodontic';
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

// ─────────────────────────────────────────────────────────────────────────────
// 1. ROUTINE RESTORATION / FILLING MACRO
// ─────────────────────────────────────────────────────────────────────────────
export const ROUTINE_RESTORATION_MACRO: ClinicalMacroDefinition = {
  id: 'restoration_composite',
  name: 'Routine Restoration (Direct Composite)',
  category: 'restorative',
  keywords: ['filling', 'restoration', 'composite', 'caries', 'decay', 'cavity', 'etch', 'bond', 'matrix', 'shade', 'resin'],
  defaultAdaCodes: [
    { code: '531', description: 'Adhesive resin restoration - 1 surface - posterior' },
    { code: '532', description: 'Adhesive resin restoration - 2 surface - posterior' },
  ],
  templateGenerator: (vars) => {
    const toothDisplay = vars.teeth.length > 0 ? vars.teeth.map(t => `#${t}`).join(', ') : 'tooth';
    const surfaceDisplay = vars.surfaces.length > 0 ? `(${vars.surfaces.join('')})` : '';
    const teethSurfaces = vars.toothSurfacePairs.length > 0
      ? vars.toothSurfacePairs.map(p => `#${p.tooth} (${p.surface})`).join(', ')
      : `${toothDisplay} ${surfaceDisplay}`.trim();

    const missingNotices: string[] = [];
    if (!vars.consentObtained) {
      missingNotices.push('Notice: Verbal consent was not heard aloud on the recording');
    }
    if (!vars.poigDiscussed) {
      missingNotices.push('Notice: Aftercare instructions were not heard aloud on the recording');
    }

    const laText = vars.anaesthetic
      ? `${vars.anaesthetic.agent}${vars.anaesthetic.adrenaline ? ` ${vars.anaesthetic.adrenaline}` : ''}, ${vars.anaesthetic.volumeMl ? `${vars.anaesthetic.volumeMl} mL` : vars.anaesthetic.cartridges ? `${vars.anaesthetic.cartridges} cartridge(s)` : '2.2 mL'} ${vars.anaesthetic.technique}.\nAdequate anaesthesia achieved.`
      : 'Topical LA: xylo 5% applied.\nLA 4% Articaine with 1:100,000 adrenaline, 2.2 mL infiltration.\nAdequate anaesthesia achieved.';

    const isolation = vars.isolation || 'Cotton roll and gauze isolation throughout.';
    const shade = vars.materials?.compositeShade || 'A3';
    const liner = vars.materials?.liner ? `\n${vars.materials.liner} applied over deepest areas.` : '';

    const treatmentPerformed = `Discussion of Treatment Options:
1) No treatment – explained risk of disease progression including pain, infection, and potential pulpal involvement.
2) Attempt restoration – discussed that removal of carious tooth structure is required; restoration may fail in future.
Warned of post-operative sensitivity. Warned of possible pulpal involvement or exposure.
${vars.consentObtained ? 'Patient provided verbal informed consent to proceed with restorative treatment under LA.' : 'Patient verbal informed consent confirmed.'}

Anaesthesia:
${laText}

Isolation:
${isolation}

Procedure:
Caries accessed and removed on ${teethSurfaces} (deep and peripheral).
Cavity preparation refined.
Etch, SB+ adhesive, light-cured.${liner}
${shade} composite resin placed and cured incrementally.
Occlusion checked and adjusted.
Margins sound; no overhangs or deficiencies.
Patient satisfied with aesthetics and occlusion.`;

    const recommendations = `Provided POIG (Post-Operative Instructions Given).
Explained expected sensitivity for up to ~2 weeks, should gradually settle.
Advised that persistent or worsening pain may indicate pulpal involvement; may require root canal treatment to save the tooth or extraction if non-restorable.
Patient verbalised understanding.`;

    const toothCodes = vars.toothSurfacePairs.map(p => {
      const surfaceCount = p.surface.length;
      const code = surfaceCount >= 3 ? '533' : surfaceCount === 2 ? '532' : '531';
      return {
        code,
        description: `Adhesive resin restoration - ${surfaceCount} surface - tooth ${p.tooth}`,
        tooth: p.tooth,
      };
    });

    const finalCodes = toothCodes.length > 0
      ? toothCodes
      : (vars.spokencodes.length > 0 ? vars.spokencodes : [{ code: '532', description: 'Adhesive resin restoration - 2 surface', tooth: vars.teeth[0] }]);

    return {
      title: 'Routine Restoration',
      chiefComplaint: vars.complaint || `Patient booked for routine direct restoration on ${teethSurfaces}.`,
      history: vars.history || 'Medical history reviewed with patient; no relevant contraindications to LA.',
      toothFindings: `${teethSurfaces}: Primary/recurrent dental caries into dentine. TTP (-), no mobility.`,
      findingsGingival: 'Gingival margin healthy, isolated bleeding controlled.',
      diagnosis: `${teethSurfaces}: Dental caries into dentine, asymptomatic/reversible pulpitis.`,
      treatmentPerformed,
      recommendations,
      recallRequirements: 'Routine recall in 6 months. Return earlier if bite feels high or sensitivity escalates.',
      patientSummary: `Completed restorative filling on ${teethSurfaces} today using composite resin. Mild sensitivity is normal for 1-2 weeks as the tooth settles. Please contact us if pain worsens or bite feels uneven.`,
      adaCodes: finalCodes,
      missingProtocolNotices: missingNotices,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. GENERAL EXAMINATION & CLEAN MACRO
// ─────────────────────────────────────────────────────────────────────────────
export const GENERAL_EXAM_CLEAN_MACRO: ClinicalMacroDefinition = {
  id: 'general_exam_clean',
  name: 'General Examination & Clean',
  category: 'preventive',
  keywords: ['exam', 'examination', 'checkup', 'clean', 'scale', 'bpe', 'calculus', 'plaque', 'fluoride', 'hygiene'],
  defaultAdaCodes: [
    { code: '011', description: 'Comprehensive oral examination' },
    { code: '114', description: 'Removal of calculus - first visit' },
    { code: '121', description: 'Topical application of remineralising agent' },
    { code: '022', description: 'Intraoral periapical or bitewing radiograph - per exposure' },
  ],
  templateGenerator: (vars) => {
    return {
      title: 'General Exam & Clean',
      chiefComplaint: vars.complaint || 'RFA: General examination and routine clean. Nil acute pain reported.',
      history: vars.history || 'Medical History: Written and verbal medical history taken; no changes reported.\nSocial History: Non-smoker. Regular toothbrushing reported.',
      toothFindings: 'E/O: NAD.\nI/O: Soft tissues NAD.\nDentition charted. Occlusal surfaces intact. Enamel margins sound. Radiographs reviewed (no interproximal caries detected).',
      findingsGingival: `Periodontal Assessment:
Perio status: Generalised mild marginal gingivitis.
OH: Fair to good.
Calculus: Supragingival deposits lower lingual anterior & upper buccal molars.
Plaque: Minimal cervical plaque.
Stains: Mild extrinsic stain.
Gingiva: Pink, firm with minimal bleeding on probing.
BPE: ${vars.bpe || '1 / 1 / 1 / 1 / 1 / 1'}`,
      diagnosis: 'Generalised mild plaque-induced gingivitis. Low caries risk.',
      treatmentPerformed: `Treatment Today:
Supra s/c (supragingival scaling) performed using ultrasonic scaler; all quadrants debrided.
Prophy completed using rotary brush and prophy paste to remove extrinsic stain and plaque.
Topical fluoride application (F-) provided for remineralisation and caries prevention.
OHI provided with demonstration:
• Electric toothbrush technique and 2-minute timer reinforced
• Interdental cleaning (flossing & interdental brushes) demonstrated
• Non-alcoholic fluoride mouthwash recommended`,
      recommendations: 'Continue brushing twice daily with 1450ppm fluoride toothpaste. Daily interdental cleaning with floss/interdental brushes.',
      recallRequirements: 'CON: Bitewings / clinical review in 12-24 months.\nMAINT: 6-month recall for routine exam and scale & clean.',
      patientSummary: 'Comprehensive examination and routine dental clean completed today. Teeth and gums are in good health. Fluoride varnish was applied to strengthen enamel. We look forward to seeing you for your 6-month checkup.',
      adaCodes: vars.spokencodes.length > 0 ? vars.spokencodes : [
        { code: '011', description: 'Comprehensive oral examination' },
        { code: '114', description: 'Removal of calculus - first visit' },
        { code: '121', description: 'Topical application of remineralising agent' },
      ],
      missingProtocolNotices: [],
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. SCALING & CLEAN (HYGIENE) MACRO
// ─────────────────────────────────────────────────────────────────────────────
export const SCALING_CLEAN_MACRO: ClinicalMacroDefinition = {
  id: 'scaling_clean',
  name: 'Scaling & Clean (Hygiene)',
  category: 'hygiene' as any,
  keywords: ['clean', 'scale and clean', 'hygiene', 'prophy', 'fluoride', 'calculus', 'polish'],
  defaultAdaCodes: [
    { code: '114', description: 'Removal of calculus' },
    { code: '121', description: 'Topical fluoride application' },
  ],
  templateGenerator: (vars) => {
    return {
      title: 'Scaling & Clean',
      chiefComplaint: vars.complaint || 'Routine hygiene visit for scaling and clean.',
      history: vars.history || 'Medical history reviewed and confirmed; nil changes.',
      toothFindings: 'Dentition sound; no obvious gross cavitations noted during cleaning.',
      findingsGingival: 'Mild generalised marginal gingivitis. Supragingival calculus and extrinsic tea/coffee stain.',
      diagnosis: 'Plaque-induced gingivitis.',
      treatmentPerformed: `S/C performed with ultrasonic scaler; all quadrants debrided.
Prophy completed using rotary brush/paste to remove remaining plaque and extrinsic stains.
Topical fluoride application provided (F-).
OHI given – reinforced correct technique and frequency for:
• Electric toothbrush use
• Flossing
• Interdental brushes
• Interdental sticks
• Mouthwashes (non-alcoholic recommended)`,
      recommendations: 'Maintain meticulous daily interdental cleaning. Soft diet for 30 minutes following fluoride treatment.',
      recallRequirements: '6-month recall for routine preventive hygiene.',
      patientSummary: 'Completed full mouth scaling and polishing with fluoride application. Please avoid eating or rinsing for 30 minutes to allow the fluoride treatment to take full effect.',
      adaCodes: vars.spokencodes.length > 0 ? vars.spokencodes : [
        { code: '114', description: 'Removal of calculus' },
        { code: '121', description: 'Topical fluoride application' },
      ],
      missingProtocolNotices: [],
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. PERIODONTAL DEBRIDEMENT (SRP) MACRO
// ─────────────────────────────────────────────────────────────────────────────
export const PERIODONTAL_DEBRIDEMENT_MACRO: ClinicalMacroDefinition = {
  id: 'periodontal_debridement',
  name: 'Periodontal Debridement (SRP)',
  category: 'periodontal',
  keywords: ['srp', 'root planing', 'deep clean', 'pocket', 'periodontitis', 'subgingival', 'debridement'],
  defaultAdaCodes: [
    { code: '222', description: 'Root planing and subgingival debridement - per tooth/quadrant' },
  ],
  templateGenerator: (vars) => {
    const quads = vars.quadrants?.length ? vars.quadrants.join(', ') : 'Q1-Q4';
    return {
      title: 'Periodontal Debridement',
      chiefComplaint: vars.complaint || 'Scheduled for subgingival periodontal debridement and root planing.',
      history: vars.history || 'Periodontal history discussed; smoking status confirmed.',
      toothFindings: 'Multiple teeth with subgingival root surface roughness and calculus.',
      findingsGingival: `Localised pocketing 4-6mm with bleeding on probing in quadrant(s): ${quads}.`,
      diagnosis: 'Periodontitis (Stage II/III, Grade B).',
      treatmentPerformed: `Subgingival debridement and root planing completed using ultrasonic scaler and Gracey curette hand instruments in quadrant(s): ${quads}.
Thorough removal of supra- and subgingival calculus, biofilm, and deposits.
Prophy completed with rotary brush/paste to remove residual plaque and extrinsic staining.
Topical fluoride application provided (F-) for sensitivity control and remineralisation support.
OHI given, including instruction and demonstration for:
• Electric toothbrush technique and frequency
• Flossing
• Interdental brushes (sizes selected and explained)
• Interdental sticks
• Mouthrinses – advised non-alcoholic, fluoride-containing or chlorhexidine mouthrinse depending on periodontal status; discussed correct usage and duration
Oral hygiene aids discussed and provided, including tailored recommendations for interdental cleaning tools and appropriate mouthrinse selection.`,
      recommendations: 'Chlorhexidine 0.2% mouthrinse 10mL twice daily for 7 days. Gentle brushing over treated areas.',
      recallRequirements: 'Periodontal review and pocket re-evaluation in 6-8 weeks; 3-month periodontal maintenance recall.',
      patientSummary: `Completed deep periodontal cleaning in ${quads} to remove tartar below the gumline. Minor gum tenderness and sensitivity is normal for 48 hours. Use the recommended interdental brushes daily.`,
      adaCodes: vars.spokencodes.length > 0 ? vars.spokencodes : [
        { code: '222', description: `Subgingival debridement - ${quads}` },
      ],
      missingProtocolNotices: [],
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. SIMPLE EXTRACTION MACRO
// ─────────────────────────────────────────────────────────────────────────────
export const SIMPLE_EXTRACTION_MACRO: ClinicalMacroDefinition = {
  id: 'simple_extraction',
  name: 'Simple Tooth Extraction',
  category: 'surgical',
  keywords: ['extraction', 'extract', 'pull', 'take out', 'elevated', 'forceps', 'socket', 'luxated'],
  defaultAdaCodes: [
    { code: '311', description: 'Removal of a tooth or part(s) thereof' },
  ],
  templateGenerator: (vars) => {
    const tooth = vars.teeth[0] ? `#${vars.teeth[0]}` : 'offending tooth';
    const missingNotices: string[] = [];
    if (!vars.consentObtained) {
      missingNotices.push('Notice: Verbal consent was not heard aloud on the recording');
    }
    if (!vars.poigDiscussed) {
      missingNotices.push('Notice: Aftercare instructions were not heard aloud on the recording');
    }

    const laText = vars.anaesthetic
      ? `${vars.anaesthetic.agent}${vars.anaesthetic.adrenaline ? ` ${vars.anaesthetic.adrenaline}` : ''}, ${vars.anaesthetic.volumeMl || 2.2} mL ${vars.anaesthetic.technique}.\nAdequate anaesthesia achieved.`
      : '4% Articaine with 1:100,000 adrenaline, 2.2 mL infiltration / block technique used.\nAdequate anaesthesia achieved.';

    return {
      title: 'Simple Extraction',
      chiefComplaint: vars.complaint || `Extraction of ${tooth}. Non-restorable / symptomatic.`,
      history: vars.history || 'Medical history reviewed with patient. Pre-operative assessment completed.',
      toothFindings: `${tooth}: Gross caries / non-restorable structure. Pre-operative radiograph checked.`,
      findingsGingival: 'Normal gingival margin without acute purulence.',
      diagnosis: `${tooth}: Non-restorable dental caries with chronic apical periodontitis.`,
      treatmentPerformed: `LA administered:
${laText}

Extraction:
Simple extraction of ${tooth} performed.
Tooth elevated and removed using standard forceps technique.
No complications during removal.
Socket inspected; no residual root fragments.
Socket irrigated with saline.
Haemostasis achieved with gauze pressure.

Medications:
Analgesics discussed (e.g., paracetamol/ibuprofen as appropriate).
No antibiotics indicated unless symptoms arise.`,
      recommendations: `Post-operative instructions:
• Avoid rinsing or spitting for 24 hours.
• Soft, cool diet today; chew on opposite side.
• No smoking or alcohol for minimum 48 hours.
• Warm saltwater rinses gently starting from tomorrow (1/2 tsp salt in warm water after meals).
• Avoid disturbing the socket with tongue, finger, or straws.
• Expected mild pain and oozing explained; bite firmly on sterile gauze pack if oozing occurs.
• Red flags: return immediately if severe throbbing pain, expanding swelling, fever, or continuous bleeding.
Patient verbalised understanding of post-op care and risks.`,
      recallRequirements: 'Review in 1-2 weeks if symptoms fail to resolve. Discuss future restorative/replacement options (bridge, implant) once socket heals in 3 months.',
      patientSummary: `Successfully extracted tooth ${tooth}. Please bite on gauze for 20 minutes if needed. Do not rinse or spit today, stick to soft food, and do not smoke. Start gentle warm salt water rinses tomorrow. Contact us immediately if bleeding persists.`,
      adaCodes: vars.spokencodes.length > 0 ? vars.spokencodes : [
        { code: '311', description: `Removal of tooth ${tooth}`, tooth: vars.teeth[0] },
      ],
      missingProtocolNotices: missingNotices,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. SURGICAL EXTRACTION MACRO
// ─────────────────────────────────────────────────────────────────────────────
export const SURGICAL_EXTRACTION_MACRO: ClinicalMacroDefinition = {
  id: 'surgical_extraction',
  name: 'Surgical Tooth Extraction',
  category: 'surgical',
  keywords: ['surgical extraction', 'bone gutter', 'flap', 'sectioned', 'suture', 'odontectomy', 'gelatemp', 'prolene'],
  defaultAdaCodes: [
    { code: '324', description: 'Surgical removal of a tooth requiring removal of bone and tooth division' },
  ],
  templateGenerator: (vars) => {
    const tooth = vars.teeth[0] ? `#${vars.teeth[0]}` : 'offending tooth';
    const missingNotices: string[] = [];
    if (!vars.consentObtained) {
      missingNotices.push('Notice: Verbal consent was not heard aloud on the recording');
    }
    if (!vars.poigDiscussed) {
      missingNotices.push('Notice: Aftercare instructions were not heard aloud on the recording');
    }

    const suture = vars.materials?.sutureType || 'Non-absorbable 3-0 Prolene (polypropylene) suture placed.';
    const haemostat = vars.materials?.haemostaticAgent || 'Gelatemp placed.';

    return {
      title: 'Surgical Extraction',
      chiefComplaint: vars.complaint || `RFA: Surgical extraction of ${tooth}.`,
      history: vars.history || 'E/O: NAD.\nI/O: Soft tissues NAD.\nMedical history reviewed with patient. Allergies nil of note.',
      toothFindings: `Pre-operative Assessment of ${tooth}:
Diagnostic tests: TTP (+), Radiograph checked (convergent/curved roots, bone proximity).
Treatment options discussed (restoration, RCT, extraction, no treatment).
Verbal informed consent obtained.`,
      findingsGingival: 'Normal attached mucosa with adequate keratinised tissue for flap reflection.',
      diagnosis: `${tooth}: Gross structural failure / retained root with chronic periapical lesion.`,
      treatmentPerformed: `Anaesthesia:
2% Lignocaine 1:80,000 Adrenaline & 4% Articaine 1:100,000 Adrenaline buccal/lingual infiltration.
Profound local anaesthesia confirmed.

Surgical Procedure:
Tooth ${tooth} luxated and elevated.
Mucoperiosteal flap raised.
Bone gutter created under copious sterile saline irrigation.
Tooth sectioned and delivered in pieces.
Both apices intact on inspection.
Socket irrigated with saline.
${haemostat}
${suture}
Haemostasis achieved with firm gauze pressure.`,
      recommendations: `Post-operative Instructions:
POIG provided.
Analgesics discussed:
• Paracetamol (max 4000mg/day)
• Ibuprofen (max 1200mg-2400mg/day as indicated)
• Explained alternating dosing strategy as general dental pain management.
Advised on normal post-op symptoms (mild pain, swelling, slight oozing).
Red-flag symptoms explained; advised to return if worsening pain, expanding swelling, fever, or persistent bleeding.`,
      recallRequirements: 'NV: Review + suture removal in 7-10 days.',
      patientSummary: `Surgical extraction of tooth ${tooth} completed. Stitches were placed to protect the area. Please rest today, apply cold packs intermittently, and take pain relief as directed. We will see you in 7-10 days for suture removal.`,
      adaCodes: vars.spokencodes.length > 0 ? vars.spokencodes : [
        { code: '324', description: `Surgical removal of tooth ${tooth} with bone removal and sectioning`, tooth: vars.teeth[0] },
      ],
      missingProtocolNotices: missingNotices,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. ENDODONTIC: EMERGENCY PULP EXTIRPATION MACRO
// ─────────────────────────────────────────────────────────────────────────────
export const EMERGENCY_PULP_EXTIRPATION_MACRO: ClinicalMacroDefinition = {
  id: 'emergency_pulp_extirpation',
  name: 'Endodontics: Emergency Pulp Extirpation',
  category: 'endodontic',
  keywords: ['extirpation', 'pulp', 'endodontic', 'rct', 'root canal', 'odontopaste', 'cavit', 'canals', 'emergency endo'],
  defaultAdaCodes: [
    { code: '414', description: 'Extirpation of pulp or debridement of root canal(s)' },
  ],
  templateGenerator: (vars) => {
    const tooth = vars.teeth[0] ? `#${vars.teeth[0]}` : 'tooth';
    const canals = vars.canalsCount ? `${vars.canalsCount} canals located` : 'Canals located (MB, DB, P / M, D)';
    const missingNotices: string[] = [];
    if (!vars.consentObtained) {
      missingNotices.push('Notice: Verbal consent was not heard aloud on the recording');
    }

    return {
      title: 'Emergency Pulp Extirpation',
      chiefComplaint: vars.complaint || `Acute severe pain on ${tooth}. Throbbing, lingering to cold, waking at night.`,
      history: vars.history || 'Medical history reviewed. Nil contraindications to endodontic treatment.',
      toothFindings: `${tooth}: TTP (++), Cold lingering (>30s), EPT (+), Pre-op radiograph shows deep caries approximating pulp chamber, normal PDL width.`,
      findingsGingival: 'Gingival tissues normal, no sinus tract, no fluctuant swelling.',
      diagnosis: `${tooth}: Symptomatic irreversible pulpitis with symptomatic apical periodontitis.`,
      treatmentPerformed: `Discussion of Treatment Options:
Discussed advantages, disadvantages, risks, alternatives (extraction), and consequences of no treatment.
Referral to Endodontist discussed.
Risks of RCT explained, including:
• Persistent or recurring pain/infection requiring further visits or redressing
• Calcified canals, complex anatomy, perforation, or file fracture → may require specialist referral
• Discolouration of tooth
• Reduced structural strength → higher risk of fracture; likely need for cuspal coverage crown after RCT
• Possible crown/root fracture
Explained that 100% success cannot be guaranteed.
Patient understands and consents.

LA:
Topical 5% xylocaine gel.
2% Lignocaine 1:80,000 / 4% Articaine 1:100,000 adrenaline – infiltration/IAN block.
Profound anaesthesia achieved.

Procedure:
Rubber dam placed and tooth ${tooth} isolated.
Access cavity prepared under water cooling.
${canals}.
Pulp extirpated using barbed broaches / rotary files with copious NaOCl irrigation.
Canals dried with sterile paper points.
${vars.materials?.dressing || 'Odontopaste dressing placed in canal orifices.'}
Cotton pellet + Cavit + ${vars.materials?.temporisation ? vars.materials.temporisation.replace(/^Cavit\s*\+\s*/i, '') : 'Fuji IX'} temporisation.
Occlusion checked and fully relieved out of occlusion.`,
      recommendations: `Post-op instructions given:
• Avoid chewing on ${tooth} until definitive crown is placed.
• Mild tenderness to bite is normal for 48-72 hours; manage with paracetamol/ibuprofen.
• Return immediately if swelling develops or temporary dressing dislodges.`,
      recallRequirements: 'Book Stage 2 RCT (Cleaning and shaping / chemomechanical preparation) in 1-2 weeks.',
      patientSummary: `Completed emergency nerve extirpation on tooth ${tooth} to relieve your toothache. A calming medicated dressing (Odontopaste) and temporary filling were placed. Please avoid chewing on this side until your next visit in 1-2 weeks.`,
      adaCodes: vars.spokencodes.length > 0 ? vars.spokencodes : [
        { code: '414', description: `Extirpation of pulp - tooth ${tooth}`, tooth: vars.teeth[0] },
      ],
      missingProtocolNotices: missingNotices,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 8. FISSURE SEALANT MACRO
// ─────────────────────────────────────────────────────────────────────────────
export const FISSURE_SEALANT_MACRO: ClinicalMacroDefinition = {
  id: 'fissure_sealant',
  name: 'Fissure Sealant',
  category: 'preventive',
  keywords: ['sealant', 'fissure sealant', 'preventive resin', 'deep grooves'],
  defaultAdaCodes: [
    { code: '161', description: 'Fissure sealant - per tooth' },
  ],
  templateGenerator: (vars) => {
    const teeth = vars.teeth.length > 0 ? vars.teeth.map(t => `#${t}`).join(', ') : 'molar teeth';
    return {
      title: 'Fissure Sealant',
      chiefComplaint: vars.complaint || `Preventive fissure sealant placement on ${teeth}.`,
      history: 'Medical screen confirmed clear.',
      toothFindings: `${teeth}: Deep occlusal fissures, non-carious, susceptible to plaque retention.`,
      findingsGingival: 'Healthy gingival margins.',
      diagnosis: `${teeth}: Deep, caries-susceptible occlusal morphology (high caries risk).`,
      treatmentPerformed: `Discussed advantages, disadvantages, risks, alternatives, and consequences of no treatment.
Verbal informed consent obtained.

Procedure:
Plaque removed from occlusal surfaces using prophy brush; checked for caries (none detected).
Etch applied for 20s → washed and dried thoroughly → fissure sealant placed into pits and fissures of ${teeth}.
Sealant light-cured.
Sealant margins intact; occlusion checked with articulating paper (no high spots).`,
      recommendations: 'POIG provided. Explained sealants help prevent decay but may wear or chip over time; advised routine monitoring at future visits. Patient understands.',
      recallRequirements: 'Routine 6-month recall to monitor sealant integrity.',
      patientSummary: `Preventive fissure sealants applied to ${teeth}. The protective coating seals deep grooves to guard against decay. Normal eating can resume immediately.`,
      adaCodes: vars.teeth.length > 0
        ? vars.teeth.map(t => ({ code: '161', description: `Fissure sealant - tooth ${t}`, tooth: t }))
        : [{ code: '161', description: 'Fissure sealant - per tooth' }],
      missingProtocolNotices: [],
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 9. ENDODONTIC: CHEMO-MECHANICAL PREPARATION & OBTURATION (STAGE 2/3 RCT)
// ─────────────────────────────────────────────────────────────────────────────
export const ENDODONTIC_OBTURATON_MACRO: ClinicalMacroDefinition = {
  id: 'endodontic_obturation',
  name: 'Endodontics: Canal Prep & Obturation',
  category: 'endodontic',
  keywords: ['obturation', 'obturated', 'gutta percha', 'gutta-percha', 'ah plus', 'master cone', 'root canal fill', 'sealer', 'warm vertical', 'canal prep'],
  defaultAdaCodes: [
    { code: '415', description: 'Chemo-mechanical preparation of root canal - one canal' },
    { code: '416', description: 'Obturation of root canal - one canal' },
  ],
  templateGenerator: (vars) => {
    const tooth = vars.teeth[0] ? `#${vars.teeth[0]}` : 'tooth';
    const canals = vars.canalsCount ? `${vars.canalsCount} canals` : 'all located canals';
    return {
      title: 'Root Canal Obturation',
      chiefComplaint: vars.complaint || `Stage 2/3 Endodontic treatment (obturation) for ${tooth}. Asymptomatic.`,
      history: vars.history || 'Medical history reviewed. Nil changes.',
      toothFindings: `${tooth}: Asymptomatic, tooth restored with temporary restoration. TTP (-), palpation (-). Sinus tract absent.`,
      findingsGingival: 'Normal gingival margins without acute inflammation.',
      diagnosis: `${tooth}: Previously initiated root canal therapy / pulpless tooth.`,
      treatmentPerformed: `Verbal informed consent confirmed for completion of root canal treatment.
Isolation:
${vars.isolation || 'Rubber dam placed and tooth isolated.'}

Procedure:
Temporary restoration removed.
${canals} identified.
Chemo-mechanical preparation completed to confirmed working lengths using rotary nickel-titanium instrumentation under copious 4% NaOCl and 17% EDTA irrigation.
Canals dried with sterile paper points.
Obturation completed using master Gutta-Percha cones and AH Plus / bioceramic resin sealer.
Warm vertical / cold lateral condensation technique utilised.
Master cone / obturation radiograph checked: dense, well-condensed 3D fill ending 0.5-1.0mm from radiographic apex with no voids.
Coronal seal established with composite resin / glass ionomer core.`,
      recommendations: `Post-operative instructions:
• Avoid biting hard foods on ${tooth} until definitive cuspal-coverage crown is completed.
• Mild transient tenderness to bite may occur over 48 hours; manage with paracetamol/ibuprofen.
• Book definitive crown preparation visit in 2-4 weeks.`,
      recallRequirements: 'Review in 6 months for periapical healing radiograph. Schedule crown preparation in 2-4 weeks.',
      patientSummary: `Completed the final root canal filling (obturation) on tooth ${tooth}. The root canals have been sealed with gutta-percha and a protective core was placed. Please protect this tooth from hard chewing until a permanent crown is placed.`,
      adaCodes: vars.spokencodes.length > 0 ? vars.spokencodes : [
        { code: '415', description: `Chemo-mechanical canal preparation - tooth ${tooth}`, tooth: vars.teeth[0] },
        { code: '416', description: `Root canal obturation - tooth ${tooth}`, tooth: vars.teeth[0] },
      ],
      missingProtocolNotices: [],
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 10. FIXED PROSTHODONTICS: CROWN PREPARATION & SCAN / IMPRESSION
// ─────────────────────────────────────────────────────────────────────────────
export const CROWN_PREPARATION_MACRO: ClinicalMacroDefinition = {
  id: 'crown_preparation',
  name: 'Crown Preparation & Digital Scan / Impression',
  category: 'restorative',
  keywords: ['crown prep', 'crown preparation', 'chamfer', 'shoulder', 'retraction cord', 'trios', 'intraoral scan', 'temporary crown', 'protemp', 'luxatemp', 'core buildup'],
  defaultAdaCodes: [
    { code: '613', description: 'Full crown - non-metallic - indirect (ceramic/zirconia)' },
    { code: '627', description: 'Core buildup including pins where placed' },
  ],
  templateGenerator: (vars) => {
    const tooth = vars.teeth[0] ? `#${vars.teeth[0]}` : 'tooth';
    const laText = vars.anaesthetic
      ? `${vars.anaesthetic.agent}${vars.anaesthetic.adrenaline ? ` ${vars.anaesthetic.adrenaline}` : ''}, ${vars.anaesthetic.volumeMl || 2.2} mL ${vars.anaesthetic.technique}.\nAdequate anaesthesia achieved.`
      : '4% Articaine with 1:100,000 adrenaline, 2.2 mL infiltration / block.\nAdequate anaesthesia achieved.';
    const shade = vars.materials?.compositeShade || 'A2';

    return {
      title: 'Crown Preparation & Impression',
      chiefComplaint: vars.complaint || `Crown preparation for ${tooth} due to extensive structural compromise / crack.`,
      history: vars.history || 'Medical history reviewed and confirmed.',
      toothFindings: `${tooth}: Structural failure, cracked tooth or extensive restoration requiring full coronal coverage.`,
      findingsGingival: 'Gingival margins healthy, adequate biological width.',
      diagnosis: `${tooth}: Cracked tooth syndrome / non-vital tooth / structurally compromised tooth requiring full coverage crown.`,
      treatmentPerformed: `Discussion of Treatment Options:
Discussed benefits, longevity, risks (nerve irritation / pulp necrosis, crown debond, marginal fracture), and need for strict oral hygiene.
Verbal informed consent obtained.

Anaesthesia:
${laText}

Procedure:
Pre-operative core buildup placed using dual-cure resin / composite (${tooth}).
Tooth ${tooth} prepared for full coverage crown:
• 1.5mm - 2.0mm occlusal reduction to provide adequate bulk for restorative material.
• 1.0mm axial reduction with distinct, smooth circumferential chamfer/shoulder margins.
• Retraction cord (#00 / #0) placed for gingival deflection and sulcular haemostasis.
• High-precision digital intraoral scan (Trios / iTero) / PVS impression taken of prepared tooth, opposing dentition and interocclusal bite relationship.
• Shade ${shade} confirmed with patient and lab prescription sent.
• Interim temporary crown fabricated (Protemp / Luxatemp), trimmed, polished, and cemented with non-eugenol temporary cement.
• Occlusion checked in centric and excursions (out of occlusion). Excess cement removed.`,
      recommendations: `Post-operative instructions:
• Avoid sticky or hard foods on ${tooth} while temporary crown is in place.
• Pull floss out to the side rather than popping up to avoid dislodging temporary crown.
• Contact surgery immediately if temporary crown comes loose.`,
      recallRequirements: 'Book crown insert / cementation in 2-3 weeks.',
      patientSummary: `Prepared tooth ${tooth} for a permanent dental crown and placed a temporary crown. An intraoral scan was sent to the dental laboratory. Please avoid chewing sticky or hard foods on this side until your permanent crown is fitted in 2-3 weeks.`,
      adaCodes: vars.spokencodes.length > 0 ? vars.spokencodes : [
        { code: '613', description: `Full crown prep & scan - tooth ${tooth}`, tooth: vars.teeth[0] },
        { code: '627', description: `Core buildup - tooth ${tooth}`, tooth: vars.teeth[0] },
      ],
      missingProtocolNotices: [],
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 11. FIXED PROSTHODONTICS: CROWN TRY-IN & DEFINITIVE CEMENTATION
// ─────────────────────────────────────────────────────────────────────────────
export const CROWN_CEMENTATION_MACRO: ClinicalMacroDefinition = {
  id: 'crown_cementation',
  name: 'Crown Try-in & Definitive Cementation',
  category: 'restorative',
  keywords: ['crown fit', 'crown issue', 'crown insert', 'crown try-in', 'cemented', 'relyx', 'try-in', 'definitive cementation', 'excess cement removed'],
  defaultAdaCodes: [
    { code: '652', description: 'Cementation of indirect restoration - full crown' },
  ],
  templateGenerator: (vars) => {
    const tooth = vars.teeth[0] ? `#${vars.teeth[0]}` : 'tooth';
    return {
      title: 'Crown Try-in & Cementation',
      chiefComplaint: vars.complaint || `Crown issue / fit appointment for tooth ${tooth}.`,
      history: vars.history || 'Medical history reviewed. Nil issues with temporary crown.',
      toothFindings: `${tooth}: Temporary crown intact, tooth asymptomatic.`,
      findingsGingival: 'Gingiva pink, healthy, and free of acute inflammation.',
      diagnosis: `${tooth}: Completed laboratory-fabricated definitive crown ready for cementation.`,
      treatmentPerformed: `Verbal informed consent confirmed.
Temporary crown removed carefully.
Tooth preparation cleaned of temporary cement using pumice slurry, rinsed, and dried.
Crown Try-in:
• Marginal fit verified with sharp dental explorer (sound, continuous margins with zero catch or overhang).
• Interproximal contacts checked with dental floss (firm, anatomical, flossable).
• Occlusion checked with 8-micron articulating film in centric occlusion and lateral excursions.
• Aesthetics, shade, and contour shown to and approved by patient.
Definitive Cementation:
• Tooth isolated with cotton rolls and dry angles.
• Crown intaglio surface prepped/primed.
• Crown cemented definitively with RelyX Unicem / Panavia self-adhesive resin cement under firm finger pressure.
• Initial tack-cure performed; interproximal and subgingival excess cement meticulously removed with explorer and floss.
• Final light-cure completed from all aspects.
• Final occlusion verified in centric relation and all excursive movements.`,
      recommendations: `Post-operative instructions:
• Avoid hard, crunchy or sticky foods on ${tooth} today.
• Maintain normal gentle brushing and flossing starting tomorrow.
• Expected mild transient temperature sensitivity; return if bite feels high or uncomfortable.`,
      recallRequirements: 'Review at routine 6-month checkup.',
      patientSummary: `Successfully fitted and permanently cemented your new dental crown on tooth ${tooth}. The fit, bite, and colour were all verified. Avoid hard or sticky foods on that side for the rest of today.`,
      adaCodes: vars.spokencodes.length > 0 ? vars.spokencodes : [
        { code: '652', description: `Definitive crown cementation - tooth ${tooth}`, tooth: vars.teeth[0] },
      ],
      missingProtocolNotices: [],
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 12. OCCLUSAL SPLINTS / NIGHTGUARDS (BRUXISM & WEAR)
// ─────────────────────────────────────────────────────────────────────────────
export const OCCLUSAL_SPLINT_MACRO: ClinicalMacroDefinition = {
  id: 'occlusal_splint',
  name: 'Occlusal Splint / Nightguard Delivery',
  category: 'diagnostic',
  keywords: ['occlusal splint', 'splint', 'nightguard', 'night guard', 'bruxism splint', 'canine guidance', 'articulating paper'],
  defaultAdaCodes: [
    { code: '965', description: 'Occlusal splint - full arch' },
  ],
  templateGenerator: (vars) => {
    return {
      title: 'Occlusal Splint Insertion',
      chiefComplaint: vars.complaint || 'Delivery and adjustment of custom occlusal splint for nocturnal bruxism and wear.',
      history: vars.history || 'Medical history reviewed. Sleep bruxism and jaw clenching noted.',
      toothFindings: 'Generalized enamel attrition, incisal/occlusal wear facets, TMJ asymptomatic.',
      findingsGingival: 'Healthy gingival margins.',
      diagnosis: 'Nocturnal sleep bruxism, tooth wear, and masticatory muscle hyperactivity.',
      treatmentPerformed: `Discussion of Splint Therapy:
Discussed purpose of splint to protect dentition from bruxism wear, reduce muscular strain, and unload TMJ joints.
Verbal informed consent obtained.

Procedure:
Laboratory-fabricated hard acrylic occlusal splint tried in maxillary arch.
Retention, stability, and fit verified; comfortable seated position with zero rocking.
Occlusion meticulously adjusted using articulating paper:
• Even, simultaneous bilateral posterior contact points in centric relation.
• Smooth, unhindered canine guidance in lateral excursion discluding posterior teeth.
• Symmetrical anterior ramp guidance in protrusion discluding posterior teeth.
Splint smoothed and polished.`,
      recommendations: `Patient instructions given:
• Wear every night during sleep.
• Clean daily with soft toothbrush and liquid soap/cold water; avoid hot water (will distort acrylic).
• Store dry in ventilated case when not in use.
• Bring splint to all future checkup visits for occlusal reassessment.`,
      recallRequirements: 'Splint review and occlusal check in 4-6 weeks.',
      patientSummary: 'Delivered your custom nightguard/occlusal splint. The fit and bite have been balanced to protect your teeth from night-time grinding and clenching. Wear it every night and clean it with cold water and mild soap.',
      adaCodes: vars.spokencodes.length > 0 ? vars.spokencodes : [
        { code: '965', description: 'Occlusal splint - full arch' },
      ],
      missingProtocolNotices: [],
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 13. DENTAL TRAUMA & TOOTH SPLINTING
// ─────────────────────────────────────────────────────────────────────────────
export const TRAUMA_SPLINT_MACRO: ClinicalMacroDefinition = {
  id: 'trauma_splint',
  name: 'Dental Trauma: Repositioning & Flexible Splinting',
  category: 'surgical',
  keywords: ['trauma', 'subluxat', 'luxat', 'avulsion', 'flexible splint', 'wire-composite splint', 'splinted', 'repositioning'],
  defaultAdaCodes: [
    { code: '392', description: 'Repositioning of displaced tooth/teeth and splinting' },
  ],
  templateGenerator: (vars) => {
    const teeth = vars.teeth.length > 0 ? vars.teeth.map(t => `#${t}`).join(', ') : 'traumatized tooth';
    return {
      title: 'Dental Trauma Management & Splinting',
      chiefComplaint: vars.complaint || `Acute dental trauma presentation involving ${teeth}.`,
      history: vars.history || 'Acute trauma history: mechanism of injury, time of incident, head injury / loss of consciousness ruled out. Tetanus status checked.',
      toothFindings: `${teeth}: Displaced / subluxated / tender to percussion. Radiographs reviewed; nil alveolar bone fracture or root fracture identified.`,
      findingsGingival: 'Mild gingival laceration / sulcular bleeding around traumatized teeth.',
      diagnosis: `${teeth}: Acute dental trauma (subluxation / lateral luxation).`,
      treatmentPerformed: `Emergency Trauma Assessment & Management:
Clinical photographs and baseline periapical radiographs taken.
Verbal informed consent obtained from patient / guardian.
Local anaesthetic administered if required.
Displaced tooth/teeth (${teeth}) gently repositioned into anatomically correct position with digital pressure.
Teeth isolated and etched (mid-facial thirds).
Flexible physiological wire-and-composite splint placed across adjacent stable anchor teeth using flowable composite.
Splint verified: allows physiological movement, free from occlusal interferences.
Pulp sensibility baseline documented.`,
      recommendations: `Post-trauma instructions:
• Soft, non-chewing diet for 2 weeks.
• Chlorhexidine 0.2% mouthrinse twice daily for 10-14 days.
• Avoid contact sports or biting directly on front teeth.
• Strict oral hygiene with ultra-soft brush.
• Advised on risks of pulp necrosis, internal/external resorption, and need for long-term monitoring.`,
      recallRequirements: 'Review in 2 weeks for splint removal and pulp vitality testing. Long-term follow-up at 1, 3, 6, and 12 months.',
      patientSummary: `Stabilized and splinted tooth ${teeth} following dental trauma. A flexible wire splint was placed to support healing. Eat soft foods, rinse with chlorhexidine mouthwash, and do not chew on the front teeth. Return in 2 weeks for splint removal.`,
      adaCodes: vars.spokencodes.length > 0 ? vars.spokencodes : [
        { code: '392', description: `Repositioning and splinting - ${teeth}` },
      ],
      missingProtocolNotices: [],
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 14. DENTAL IMPLANT SURGICAL FIXTURE PLACEMENT (STAGE 1)
// ─────────────────────────────────────────────────────────────────────────────
export const DENTAL_IMPLANT_PLACEMENT_MACRO: ClinicalMacroDefinition = {
  id: 'implant_placement',
  name: 'Dental Implant Fixture Placement (Stage 1)',
  category: 'implant',
  keywords: ['implant', 'fixture', 'osteotomy', 'straumann', 'nobel', 'biohorizons', 'insertion torque', 'pilot drill', 'healing abutment', 'cover screw'],
  defaultAdaCodes: [
    { code: '661', description: 'Surgical placement of an implant fixture' },
    { code: '684', description: 'Insertion of a healing abutment' },
  ],
  templateGenerator: (vars) => {
    const teeth = vars.teeth.length > 0 ? vars.teeth.map(t => `#${t}`).join(', ') : 'implant site';
    const laSummary = vars.anaesthetic
      ? `${vars.anaesthetic.technique} using ${vars.anaesthetic.agent}${vars.anaesthetic.adrenaline ? ` ${vars.anaesthetic.adrenaline}` : ''}. Profound anaesthesia confirmed.`
      : 'Local anaesthesia administered. Profound anaesthesia verified prior to incision.';

    return {
      title: `Dental Implant Placement - ${teeth}`,
      chiefComplaint: vars.complaint || `Surgical implant placement for missing tooth / teeth ${teeth}.`,
      history: vars.history || 'CBCT and pre-operative digital prosthetic plan reviewed. Medical history reviewed; nil contraindications to implant surgery. Chlorhexidine 0.2% pre-procedural mouthrinse completed.',
      toothFindings: `Missing / edentulous site ${teeth}. Bone width and height adequate per pre-op 3D CBCT imaging.`,
      findingsGingival: 'Healthy keratinized mucosa at edentulous site.',
      diagnosis: `Partial edentulism site ${teeth}.`,
      treatmentPerformed: `Surgical Implant Fixture Placement:
${laSummary}
Aseptic surgical operatory protocol maintained.
Mid-crestal incision made with sulcular releasing incisions. Full-thickness mucoperiosteal flap carefully elevated to visualize crestal ridge morphology.
Sequential osteotomy prepared with copious chilled sterile saline irrigation under 800 RPM:
• Pilot drill used to predetermined depth, angulation and depth verified with direction indicator and periapical radiograph.
• Sequential widening drills completed per manufacturer surgical protocol.
Dental implant fixture placed into site ${teeth}.
Primary stability achieved with insertion torque 35 Ncm.
Healing abutment / cover screw placed hand-tight.
Surgical site irrigated with sterile saline. Flaps repositioned tension-free and closed with interrupted non-resorbable / resorbable sutures.
Haemostasis verified. Post-operative periapical radiograph taken confirming optimal fixture position.`,
      recommendations: `Implant Post-Operative Instructions:
• Nil hot foods or drinks today. Avoid chewing on surgical site.
• Chlorhexidine 0.2% mouthwash twice daily starting tomorrow for 10-14 days.
• Prescribed analgesic / antibiotic regimen explained and script provided if indicated.
• Normal swelling and mild bruising expected; cold pack applied intermittently.
• Avoid smoking and strenuous physical exertion for 48 hours.`,
      recallRequirements: 'Review in 10-14 days for suture removal and soft tissue healing evaluation. Osseointegration monitoring for 3-4 months prior to Stage 2 restorative phase.',
      patientSummary: `Successfully placed dental implant fixture at tooth site ${teeth}. An osteotomy was prepared with chilled saline, the implant inserted with excellent stability, and a healing cap and sutures were placed. Keep the area clean, avoid chewing on this side, rinse gently with antiseptic mouthwash from tomorrow, and return in 2 weeks for suture removal.`,
      adaCodes: vars.spokencodes.length > 0 ? vars.spokencodes : [
        { code: '661', description: `Implant fixture placement - ${teeth}` },
        { code: '684', description: `Healing abutment insertion - ${teeth}` },
      ],
      missingProtocolNotices: [],
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 15. DENTURES & DIGITAL CAD/CAM DENTURES
// ─────────────────────────────────────────────────────────────────────────────
export const COMPLETE_PARTIAL_DENTURES_MACRO: ClinicalMacroDefinition = {
  id: 'complete_partial_dentures',
  name: 'Dentures & Digital CAD/CAM Dentures',
  category: 'prosthodontic',
  keywords: ['denture', 'digital denture', 'complete denture', 'partial denture', 'full upper', 'full lower', 'custom tray', 'border mould', 'secondary impression', 'master impression', 'jaw relation', 'bite registration'],
  defaultAdaCodes: [
    { code: '711', description: 'Complete maxillary denture' },
    { code: '712', description: 'Complete mandibular denture' },
    { code: '721', description: 'Partial denture - resin base' },
  ],
  templateGenerator: (vars) => {
    return {
      title: 'Removable Prosthodontics (Dentures / Digital Dentures)',
      chiefComplaint: vars.complaint || 'Patient attending for complete / partial denture impression or trial insertion.',
      history: vars.history || 'Prosthetic history reviewed. Discussed aesthetic desires, phonetics, masticatory efficiency and ridge resorption patterns.',
      toothFindings: vars.teeth.length > 0 ? `Abutment teeth evaluated: ${vars.teeth.map(t => `#${t}`).join(', ')}.` : 'Edentulous ridge assessment completed.',
      findingsGingival: 'Oral mucosa firm and pink. Peripheral sulci free from ulceration or flabby tissue.',
      diagnosis: 'Edentulism / partial edentulism requiring prosthetic oral rehabilitation.',
      treatmentPerformed: `Removable Denture Clinical Procedure:
Custom tray evaluated intraorally for extension 2mm short of functional vestibule.
Border moulding completed with green stick compound to establish peripheral seal and accommodate frenal attachments.
Secondary master impression taken with light body polyvinyl siloxane wash under light finger pressure.
Anatomical landmarks clearly recorded: hamular notches, vibrating line, retromolar pads, buccal shelves, and lingual sulcus.
Jaw relations recorded: occlusal vertical dimension (OVD), freeway space (2-3mm), and centric relation registered with bite registration material.
Digital CAD/CAM facial reference scan / tooth shade selection completed (VITA shade guide).
Impression and records disinfected and dispatched to dental laboratory with prescription for trial setup / digital 3D printed try-in.`,
      recommendations: `Denture Care and Hygiene Protocol:
• Clean dentures twice daily using a soft brush and non-abrasive denture cleanser.
• Do not wear dentures overnight; store dry or in fresh water in a safe container.
• Contact clinic if any localized sore spots or pressure areas develop.`,
      recallRequirements: 'Next appointment scheduled for wax try-in / digital printed trial base insertion in 2-3 weeks.',
      patientSummary: `Completed custom impressions and jaw measurements for your dentures. We captured detailed moulds of your gums and bite alignment to ensure a secure, comfortable fit. The records have been sent to our lab, and you will return for a trial fitting before the final dentures are completed.`,
      adaCodes: vars.spokencodes.length > 0 ? vars.spokencodes : [
        { code: '711', description: 'Complete maxillary denture - impression / trial' },
        { code: '712', description: 'Complete mandibular denture - impression / trial' },
      ],
      missingProtocolNotices: [],
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 16. IMPLANT-SUPPORTED OVERDENTURE & LOCATOR ATTACHMENTS
// ─────────────────────────────────────────────────────────────────────────────
export const IMPLANT_OVERDENTURE_MACRO: ClinicalMacroDefinition = {
  id: 'implant_overdenture',
  name: 'Implant-Supported Overdenture / Locator Attachment',
  category: 'prosthodontic',
  keywords: ['implant-supported overdenture', 'implant overdenture', 'locator', 'overdenture', 'pick-up', 'retention cap', 'housing cap', 'block-out spacer', 'quick up'],
  defaultAdaCodes: [
    { code: '672', description: 'Prosthetic attachment to implant fixture' },
    { code: '712', description: 'Complete mandibular denture (overdenture)' },
    { code: '731', description: 'Retentive device / locator insert' },
  ],
  templateGenerator: (vars) => {
    const teeth = vars.teeth.length > 0 ? vars.teeth.map(t => `#${t}`).join(', ') : 'implant fixtures';
    return {
      title: 'Implant-Supported Overdenture Insertion & Locator Pick-Up',
      chiefComplaint: vars.complaint || `Delivery and chairside pick-up for implant-supported overdenture on ${teeth}.`,
      history: vars.history || 'Implants well osseointegrated. Soft tissues stable around perimucosal cuffs.',
      toothFindings: `Implant fixtures ${teeth} stable, non-mobile, asymptomatic.`,
      findingsGingival: 'Healthy keratinized perimucosal tissues, nil inflammation or mucositis.',
      diagnosis: 'Edentulous arch rehabilitated with implant-retained overdenture.',
      treatmentPerformed: `Chairside Locator Attachment Pick-Up & Delivery:
Healing abutments removed and implant hexes cleansed with chlorhexidine.
Locator abutments placed and torqued to manufacturer specification (30 Ncm) using torque ratchet.
White block-out spacers placed over locator heads to prevent undercut locking.
Titanium housing caps with black processing inserts seated onto locator abutments.
Intaglio surface of overdenture relieved at implant sites to allow passive seating without interference.
Dual-cure pick-up resin (Quick Up) injected into housing recesses; denture seated firmly in centric occlusion until cured.
Denture removed, block-out spacers discarded. Excess resin trimmed, lingual escape holes filled, and borders smoothed and polished.
Black processing inserts replaced with final retention caps (medium retention).
Denture seated with audible positive click, outstanding retention and stability achieved. Occlusion verified.`,
      recommendations: `Overdenture Care & Maintenance Instructions:
• Insert and remove overdenture using finger pressure on both sides evenly; do not bite into place.
• Remove and clean daily. Clean locator abutments intraorally with soft brush.
• Retention inserts wear over time and typically require routine replacement every 12-18 months.`,
      recallRequirements: 'Review in 1-2 weeks for occlusal and tissue check. 6-monthly check-ups for abutment inspection and hygiene maintenance.',
      patientSummary: `Successfully connected and fitted your implant-supported overdenture on ${teeth}. The snap attachments were secured into the denture and tested for strong, stable retention. Practice taking it out with both hands and snap it in gently. Return in 2 weeks for a routine comfort review.`,
      adaCodes: vars.spokencodes.length > 0 ? vars.spokencodes : [
        { code: '672', description: `Prosthetic locator attachment - ${teeth}` },
        { code: '712', description: 'Complete mandibular overdenture' },
        { code: '731', description: 'Retentive housing inserts fitted' },
      ],
      missingProtocolNotices: [],
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 17. TEETH WHITENING (POLA IN-CHAIR BLEACHING)
// ─────────────────────────────────────────────────────────────────────────────
export const TEETH_WHITENING_MACRO: ClinicalMacroDefinition = {
  id: 'teeth_whitening',
  name: 'In-Chair Tooth Whitening (Pola Office)',
  category: 'cosmetic',
  keywords: ['whitening', 'teeth whitening', 'pola', 'pola office', 'bleach', 'bleaching', 'hydrogen peroxide', 'gingival barrier', 'optragate', 'shade guide'],
  defaultAdaCodes: [
    { code: '118', description: 'Bleaching, internal or external - per tooth' },
    { code: '119', description: 'Bleaching, home kit or full arch in-chair' },
  ],
  templateGenerator: (vars) => {
    return {
      title: 'In-Chair Professional Tooth Whitening (Pola Office)',
      chiefComplaint: vars.complaint || 'Patient seeking cosmetic improvement of tooth shade and smile brightening.',
      history: vars.history || 'Pre-operative aesthetic consultation completed. Enamel examined; nil active untreated caries or severe hypersensitivity.',
      toothFindings: 'Upper and lower anterior teeth inspected. Pre-operative VITA Classical shade recorded and clinical baseline photos taken.',
      findingsGingival: 'Gingival tissues healthy, firm, and free from active inflammation.',
      diagnosis: 'Intrinsic / extrinsic enamel discolouration amenable to vital tooth bleaching.',
      treatmentPerformed: `In-Chair Tooth Whitening Procedure:
Pre-operative baseline shade documented with VITA shade guide.
Protective lip balm applied and OptraGate lip and cheek retractor positioned comfortably.
Protective safety eyewear provided to patient and operator.
Liquid gingival barrier resin carefully applied along the gingival margins of upper and lower teeth, overlapping enamel 0.5mm, and thoroughly light-cured.
Seal verified with explorer to prevent any peroxide contact with soft tissues.
Pola Office 35% hydrogen peroxide bleaching gel mixed and applied to facial enamel surfaces in 1mm even layer.
Treatment performed in 3 consecutive 15-minute cycles with continuous chairside monitoring.
Gel thoroughly suctioned and washed off with cold water spray.
Gingival barrier cleanly removed in one piece. Gums inspected: nil soft tissue irritation or blanching.
Post-operative shade confirmed with VITA shade guide, showing noticeable brightening.
Soothe potassium nitrate desensitising gel applied for 5 minutes.`,
      recommendations: `Post-Whitening Care Protocol:
• Strict "White Diet" for 48 hours: avoid dark-staining foods and beverages (coffee, tea, red wine, curry, tomato sauce, berries, cola) and tobacco.
• Mild transient tooth sensitivity is normal over the next 24-48 hours; use sensitivity toothpaste or provided relief gel.
• Routine oral hygiene with non-abrasive fluoride toothpaste.`,
      recallRequirements: 'Review in 2 weeks or routine 6-monthly check and clean. Maintenance top-up discussed.',
      patientSummary: `Completed in-chair professional tooth whitening using Pola Office. We protected your gums with a light-cured barrier and applied 3 cycles of whitening gel, achieving a noticeably lighter, brighter shade. Please follow the "white diet" for the next 48 hours to avoid restaining.`,
      adaCodes: vars.spokencodes.length > 0 ? vars.spokencodes : [
        { code: '118', description: 'Bleaching external - maxillary & mandibular arches' },
        { code: '119', description: 'Bleaching full arch in-chair treatment' },
      ],
      missingProtocolNotices: [],
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 18. PORCELAIN VENEERS & DIGITAL SMILE DESIGN
// ─────────────────────────────────────────────────────────────────────────────
export const VENEERS_SMILE_DESIGN_MACRO: ClinicalMacroDefinition = {
  id: 'veneers_smile_design',
  name: 'Porcelain Veneers & Aesthetic Smile Design',
  category: 'cosmetic',
  keywords: ['veneer', 'veneers', 'smile design', 'smile makeover', 'diagnostic wax-up', 'mock-up', 'butt-joint', 'facial reduction', 'enamel preparation'],
  defaultAdaCodes: [
    { code: '582', description: 'Veneer - composite resin - indirect' },
    { code: '583', description: 'Veneer - porcelain / ceramic' },
    { code: '556', description: 'Diagnostic model / wax-up transfer' },
  ],
  templateGenerator: (vars) => {
    const teeth = vars.teeth.length > 0 ? vars.teeth.map(t => `#${t}`).join(', ') : 'anterior teeth';
    return {
      title: `Porcelain Veneer Preparation & Smile Design - ${teeth}`,
      chiefComplaint: vars.complaint || `Aesthetic smile makeover consultation and veneer preparation for teeth ${teeth}.`,
      history: vars.history || 'Diagnostic smile design completed. Diagnostic wax-up and silicone matrix prepared. Patient aesthetic goals confirmed.',
      toothFindings: `Teeth ${teeth}: Enamel shade, proportions, alignment, and incisal display evaluated in dynamic smile animation.`,
      findingsGingival: 'Gingival zeniths symmetrical and healthy. Good biological width verified.',
      diagnosis: `Aesthetic disharmony / enamel defects involving teeth ${teeth}.`,
      treatmentPerformed: `Porcelain Veneer Preparation & Digital Workflow:
Local anaesthesia administered if required.
Intraoral mock-up placed using bis-acryl resin over diagnostic wax-up matrix. Patient approved smile arc, proportions, and phonetics in mirror.
Conservative depth-groove guided facial enamel reduction (0.3mm - 0.5mm) maintaining preparation entirely in enamel.
Incisal butt-joint preparation with rounded internal line angles. Interproximal contacts preserved where indicated.
#00 Ultrapak retraction cord placed for gingival deflection and clear margin exposure.
High-precision digital intraoral scan taken (upper, lower, and dynamic occlusion).
Shade, translucency, surface texture, and characterization photographed and specified for Master Dental Ceramist.
Direct composite temporary veneers fabricated using spot-etch technique with Telio CS / flowable composite, polished and occlusion cleared.`,
      recommendations: `Temporary Veneer Care Instructions:
• Avoid biting into hard, crusty, or sticky foods with front teeth.
• Brush gently around gums; do not flick floss up through contacts (slide floss through sideways).
• Contact clinic promptly if any temporary veneer debonds.`,
      recallRequirements: 'Review in 2 weeks for definitive porcelain veneer try-in, cementation, and occlusal equilibration.',
      patientSummary: `Prepared teeth ${teeth} for custom porcelain veneers following our smile design mock-up. Minimal enamel was reshaped, digital 3D scans were taken for the laboratory ceramist, and comfortable temporary veneers were placed. Avoid biting hard foods on your front teeth until the final veneers are cemented in 2 weeks.`,
      adaCodes: vars.spokencodes.length > 0 ? vars.spokencodes : [
        { code: '583', description: `Porcelain ceramic veneer preparation - ${teeth}` },
        { code: '556', description: 'Diagnostic wax-up transfer / mock-up' },
      ],
      missingProtocolNotices: [],
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 19. INVISALIGN & CLEAR ALIGNERS
// ─────────────────────────────────────────────────────────────────────────────
export const INVISALIGN_ALIGNER_MACRO: ClinicalMacroDefinition = {
  id: 'invisalign_clear_aligners',
  name: 'Orthodontics: Invisalign & Clear Aligners',
  category: 'orthodontic',
  keywords: ['invisalign', 'aligner', 'clear aligner', 'attachment', 'ipr', 'interproximal reduction', 'chewies', 'tracking', 'template aligner'],
  defaultAdaCodes: [
    { code: '825', description: 'Orthodontic adjustment or aligner delivery' },
    { code: '881', description: 'Passive orthodontic appliance / retainer' },
    { code: '071', description: 'Diagnostic intraoral scan / models' },
  ],
  templateGenerator: (vars) => {
    return {
      title: 'Orthodontic Clear Aligner Delivery & Attachment Bonding',
      chiefComplaint: vars.complaint || 'Patient attending for Invisalign clear aligner issue, attachment placement, and IPR.',
      history: vars.history || 'ClinCheck digital treatment plan approved. Tooth movements staged per orthodontic protocol.',
      toothFindings: 'Teeth evaluated for plaque-free enamel surfaces prior to bonding.',
      findingsGingival: 'Healthy gingival tissues, nil marginal bleeding.',
      diagnosis: 'Malocclusion (crowding / spacing / rotation) undergoing clear aligner orthodontic therapy.',
      treatmentPerformed: `Clear Aligner Clinical Workflow:
Teeth cleaned with fluoride-free pumice slurry and dried.
Attachment template aligner trial fitted. Selected tooth surfaces etched with 37% phosphoric acid for 20 seconds, rinsed and dried.
Adhesive resin (Prime & Bond) applied, air-thinned and light cured.
Template aligner loaded with flowable composite resin, seated firmly, and light cured 20 seconds per tooth surface.
Template removed; excess flash carefully removed with fine fluted finishing bur. Attachment shape and retention verified.
Interproximal Reduction (IPR) performed per digital staging schedule using calibrated diamond oscillating / hand strips. Reduction verified with precision thickness gauges.
First aligner sets seated intraorally: excellent fit, flush margins, and positive engagement over attachments confirmed.
Chewies and removal tool provided. Full insertion, removal, and hygiene instructions demonstrated.`,
      recommendations: `Clear Aligner Patient Guidelines:
• Wear aligners 20 to 22 hours per day, removing only for eating, drinking non-water beverages, and brushing.
• Use chewies for 5 minutes twice daily to seat aligners fully and ensure optimal tracking.
• Switch to next aligner every 7 to 10 days as directed, always at bedtime.
• Bring all previous and current aligners to every review appointment.`,
      recallRequirements: 'Review in 6-8 weeks for tracking verification, contact evaluation, and next aligner box issue.',
      patientSummary: `Fitted your Invisalign clear aligners today and placed discreet composite attachments to help guide tooth movement. IPR was performed as planned to create space. Wear your aligners 22 hours every day, use your chewies to keep them seated, and change to the next aligner on schedule.`,
      adaCodes: vars.spokencodes.length > 0 ? vars.spokencodes : [
        { code: '825', description: 'Orthodontic clear aligner delivery / adjustment' },
        { code: '881', description: 'Orthodontic attachments bonded' },
      ],
      missingProtocolNotices: [],
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 20. SLEEP DENTISTRY & CONSCIOUS SEDATION
// ─────────────────────────────────────────────────────────────────────────────
export const CONSCIOUS_SEDATION_MACRO: ClinicalMacroDefinition = {
  id: 'conscious_sedation_sleep_dentistry',
  name: 'Conscious Sedation & Sleep Dentistry',
  category: 'surgical',
  keywords: ['sedation', 'sleep dentistry', 'iv sedation', 'conscious sedation', 'midazolam', 'fentanyl', 'propofol', 'nitrous oxide', 'relative analgesia', 'aldrete', 'pulse oximetry', 'capnography'],
  defaultAdaCodes: [
    { code: '927', description: 'Intravenous sedation' },
    { code: '943', description: 'Sedation - relative analgesia / nitrous oxide' },
    { code: '949', description: 'Dental treatment under general anaesthesia or specialist sedation' },
  ],
  templateGenerator: (vars) => {
    return {
      title: 'Sleep Dentistry (Conscious IV Sedation / Relative Analgesia)',
      chiefComplaint: vars.complaint || 'Patient attending for comprehensive dental treatment under conscious sedation for dental anxiety / surgical comfort.',
      history: vars.history || 'Pre-sedation medical assessment completed (ASA I/II). Nil by mouth (NPO) guidelines strictly verified (fasted 6 hours solids, 2 hours clear fluids). Adult escort present.',
      toothFindings: 'Teeth treated per planned dental restorative / surgical schedule under sedation.',
      findingsGingival: 'Normal perioral and intraoral mucosa.',
      diagnosis: 'Dental phobia / complex dental surgical treatment requiring sedation support.',
      treatmentPerformed: `Conscious Sedation Protocol:
Baseline physiological parameters recorded: BP, HR, SpO2, and respiratory rate.
Intravenous cannulation established in upper extremity with 22G cannula; saline infusion running.
Supplemental oxygen delivered via nasal cannula at 2-3 L/min.
Continuous physiological monitoring throughout procedure: 3-lead ECG, automated NIBP, continuous pulse oximetry, and capnography (EtCO2).
Sedative medication (Midazolam / Fentanyl) titrated slowly to achieve light-to-moderate conscious sedation (Ramsay Sedation Score 2-3).
Verbal contact maintained throughout; protective airway reflexes fully preserved.
Local anaesthesia administered without patient distress. Dental procedures completed smoothly.
Recovery: Patient monitored in recovery bay until fully awake, alert, and ambulatory.
Aldrete discharge score reached 10/10. Cannula removed with haemostasis confirmed.
Discharged into the care of a responsible adult escort with written post-sedation care instructions.`,
      recommendations: `Post-Sedation Instructions:
• Rest quietly for the remainder of the day in the care of an adult.
• Do not drive a motor vehicle, operate machinery, or sign legal documents for 24 hours.
• Light, easily digestible diet. Avoid alcohol for 24 hours.
• Take prescribed pain relief as directed before local anaesthetic wears off.`,
      recallRequirements: 'Phone follow-up tomorrow. Routine dental recall per completed clinical procedure requirements.',
      patientSummary: `Completed dental care comfortably under sleep dentistry / conscious sedation. All procedures were finished while you were relaxed and comfortable. Please rest at home for the rest of the day with your companion, avoid driving or operating machinery for 24 hours, and follow the dietary advice.`,
      adaCodes: vars.spokencodes.length > 0 ? vars.spokencodes : [
        { code: '927', description: 'Intravenous conscious sedation' },
        { code: '943', description: 'Sedation relative analgesia monitoring' },
      ],
      missingProtocolNotices: [],
    };
  },
};

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

