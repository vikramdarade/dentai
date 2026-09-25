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
  category: 'restorative' | 'preventive' | 'periodontal' | 'surgical' | 'endodontic' | 'diagnostic';
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
      treatmentPerformed: `SRP completed using ultrasonic scaler and hand instruments in quadrant(s): ${quads}.
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
      history: vars.history || 'Medical screen completed. Verified nil blood thinners, bisphosphonates or bleeding disorders.',
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
      history: vars.history || 'E/O: NAD.\nI/O: Soft tissues NAD.\nMedical screen clear. Allergies nil of note.',
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

export const ALL_AUSTRALIAN_MACROS: ClinicalMacroDefinition[] = [
  ROUTINE_RESTORATION_MACRO,
  GENERAL_EXAM_CLEAN_MACRO,
  SCALING_CLEAN_MACRO,
  PERIODONTAL_DEBRIDEMENT_MACRO,
  SIMPLE_EXTRACTION_MACRO,
  SURGICAL_EXTRACTION_MACRO,
  EMERGENCY_PULP_EXTIRPATION_MACRO,
  FISSURE_SEALANT_MACRO,
];

export const MACRO_BY_ID: Record<string, ClinicalMacroDefinition> = Object.fromEntries(
  ALL_AUSTRALIAN_MACROS.map(m => [m.id, m])
);
