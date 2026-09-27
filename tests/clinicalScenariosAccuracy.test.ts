import { describe, it, expect } from 'vitest';
import { detectMacroFromContext, generateMacroNote } from '../src/lib/macroEngine';
import { parseClinicalEntities } from '../src/lib/clinicalEntityParser';
import {
  ROUTINE_RESTORATION_MACRO,
  GENERAL_EXAM_CLEAN_MACRO,
  FISSURE_SEALANT_MACRO,
  PERIODONTAL_DEBRIDEMENT_MACRO,
  SIMPLE_EXTRACTION_MACRO,
  SURGICAL_EXTRACTION_MACRO,
  EMERGENCY_PULP_EXTIRPATION_MACRO,
} from '../src/lib/australianClinicalMacros';

/**
 * Multi-specialty scenario coverage under the Phase 10 macro contract (B-1):
 *   MACRO = PRESENTATION STRUCTURE. ClinicalFact = CLINICAL ASSERTION.
 *
 * Every scenario keeps its original transcript and macro-detection expectation.
 * Content assertions now verify TWO things per note:
 *   1. spoken evidence flows through (site labels, spoken LA/materials/codes);
 *   2. NO fabricated clinical prose appears — diagnosis stays empty with a
 *      completion notice, no consent attestations, no outcome claims, no
 *      invented recalls, and codes only when the item number was spoken.
 */

// Shared structural-contract assertions applied to every generated note.
function expectStructuralNote(note: ReturnType<typeof generateMacroNote>, opts: { spokenCodes?: string[] } = {}) {
  // Diagnosis is never invented — spoken diagnosis classification does not
  // exist in the macro layer, so the section stays empty + notice.
  expect(note.diagnosis).toBe('');
  expect(note.missingProtocolNotices.join(' ')).toMatch(/no diagnosis/i);
  // No consent attestation prose may ever be emitted by a template.
  const all = JSON.stringify(note);
  expect(all).not.toMatch(/verbal informed consent obtained|consent obtained\.|patient verbalised|patient understands and consents/i);
  // No outcome claims.
  expect(all).not.toMatch(/no complications|successfully (extracted|placed|fitted|completed)|haemostasis (achieved|verified)\b(?! with gauze)/i);
  // Recall: only what was spoken (none of these scenarios speaks a recall
  // item number; the recall section stays empty).
  expect(note.recallRequirements).toBe('');
  // Codes: only spoken item numbers.
  if (opts.spokenCodes && opts.spokenCodes.length > 0) {
    expect(note.adaCodes.length).toBeGreaterThan(0);
  } else {
    expect(note.adaCodes.length).toBe(0);
  }
}

describe('TDD: Multi-Specialty Dental Clinic Clinical Scenarios', () => {

  // =========================================================================
  // 1. RESTORATIVE: Multi-Surface Posterior & Anterior Aesthetic Fillings
  // =========================================================================
  describe('Restorative Procedures', () => {
    it('detects and generates a structural note for a multi-surface posterior composite (MODB 46)', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Good morning John. Today we are restoring tooth 46 with a large composite filling.' },
        { sender: 'Dentist', text: 'Administering 4% Articaine infiltration, 2.2 mL. Rubber dam placed on tooth 46.' },
        { sender: 'Dentist', text: 'Caries excavated into deep dentine. Vitrebond resin-modified glass ionomer liner applied to the pulpal floor.' },
        { sender: 'Dentist', text: 'Sectional matrix band and wedge placed. Selective etch, Scotchbond Universal adhesive cured.' },
        { sender: 'Dentist', text: 'Placed shade A3 composite on the MODB surfaces in increments and cured thoroughly. Occlusion checked and adjusted with fine diamond bur.' }
      ];

      const macro = detectMacroFromContext(transcript, 'restorative');
      expect(macro.id).toBe(ROUTINE_RESTORATION_MACRO.id);

      const vars = parseClinicalEntities(transcript);
      expect(vars.teeth).toContain('46');
      expect(vars.surfaces).toContain('MODB');
      expect(vars.materials?.liner).toContain('Vitreobond');
      expect(vars.materials?.compositeShade).toBe('A3');
      expect(vars.isolation).toBe('Rubber dam');

      const note = generateMacroNote(transcript, macro.id, 'restorative');
      expect(note.treatmentPerformed).toContain('Site: #46');
      expect(note.treatmentPerformed).toContain('Rubber dam');
      expect(note.treatmentPerformed).toContain('Vitreobond');
      expect(note.treatmentPerformed).toContain('shade A3');
      expect(note.treatmentPerformed).toContain('Occlusion checked');
      expectStructuralNote(note);
    });

    it('detects and generates a structural note for an anterior composite (11 MI)', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Patient presented with chipped front tooth 11 on the mesial incisal edge.' },
        { sender: 'Dentist', text: 'No anaesthetic needed, superficial enamel and dentine fracture. Shade B1 selected.' },
        { sender: 'Dentist', text: 'Bevel prepared on facial margin. Total etch for 15 seconds, adhesive applied, composite layered and polished with Sof-Lex discs.' }
      ];

      const macro = detectMacroFromContext(transcript, 'restorative');
      expect(macro.id).toBe(ROUTINE_RESTORATION_MACRO.id);

      const vars = parseClinicalEntities(transcript);
      expect(vars.teeth).toContain('11');
      expect(vars.materials?.compositeShade).toBe('B1');

      const note = generateMacroNote(transcript, macro.id, 'restorative');
      expect(note.treatmentPerformed).toContain('Site: #11');
      expect(note.treatmentPerformed).toContain('shade B1');
      expectStructuralNote(note);
    });
  });

  // =========================================================================
  // 2. DIAGNOSTIC & PREVENTATIVE: Full Exam, Scale & Clean, Sealants
  // =========================================================================
  describe('Diagnostic & Preventative Procedures', () => {
    it('detects exam & clean and renders only spoken evidence (recall only when spoken)', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Welcome in for your regular checkup and clean. Dentition charted, soft tissues NAD.' },
        { sender: 'Dentist', text: 'BPE scores recorded: all sextants 0 and 1, no deep pockets. Bitewing radiographs taken showing no interproximal caries.' },
        { sender: 'Dentist', text: 'Ultrasonic scaling completed to remove supragingival calculus. Prophy with fine mint paste, topical neutral sodium fluoride applied.' },
        { sender: 'Dentist', text: 'Discussed interdental flossing daily. Recall in 6 months.' }
      ];

      const macro = detectMacroFromContext(transcript, 'examination');
      expect(macro.id).toBe(GENERAL_EXAM_CLEAN_MACRO.id);

      const note = generateMacroNote(transcript, macro.id, 'examination');
      // Diagnosis and codes are not spoken → structural note carries neither.
      expectStructuralNote(note);
      // The spoken recall interval is NOT an item code; the structural macro
      // renders no recall prose at all — completion is left to the clinician.
      expect(JSON.stringify(note)).not.toMatch(/12-24 months|MAINT/i);
    });

    it('detects paediatric fissure sealants and renders spoken teeth only', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Preventive visit for 7 year old child. Behaviour excellent, Frankl 4.' },
        { sender: 'Dentist', text: 'Applying fissure sealants on all four first permanent molars: tooth 16, tooth 26, tooth 36, and tooth 46.' },
        { sender: 'Dentist', text: 'Cotton roll isolation. Etched deep grooves for 20 seconds, washed and dried. Resin fissure sealant applied and light-cured. Checked with explorer.' }
      ];

      const macro = detectMacroFromContext(transcript, 'paediatric');
      expect(macro.id).toBe(FISSURE_SEALANT_MACRO.id);

      const vars = parseClinicalEntities(transcript);
      expect(vars.teeth).toEqual(expect.arrayContaining(['16', '26', '36', '46']));

      const note = generateMacroNote(transcript, macro.id, 'paediatric');
      expect(note.toothFindings).toContain('#16');
      expect(note.treatmentPerformed).toContain('Site: #16');
      expect(note.treatmentPerformed).toContain('Cotton roll and gauze');
      expectStructuralNote(note);
    });
  });

  // =========================================================================
  // 3. PERIODONTICS: Deep Subgingival Debridement / Root Planing
  // =========================================================================
  describe('Periodontal Procedures', () => {
    it('detects quadrant debridement and renders spoken quadrant/LA evidence', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Patient returns for deep periodontal debridement of quadrant 1 and quadrant 4.' },
        { sender: 'Dentist', text: 'Localized 5mm and 6mm pocketing around upper and lower right molars with bleeding on probing.' },
        { sender: 'Dentist', text: 'Numbed up with 2% Lignocaine 1:80,000 IAN block and infiltration.' },
        { sender: 'Dentist', text: 'Ultrasonic subgingival debridement and Gracey curette root planing performed until root surfaces smooth. Irrigated with 0.2% chlorhexidine.' },
        { sender: 'Dentist', text: 'Post-op: warm salt water mouthwashes, mild tenderness expected. Review in 6 weeks for perio re-evaluation.' }
      ];

      const macro = detectMacroFromContext(transcript, 'periodontal');
      expect(macro.id).toBe(PERIODONTAL_DEBRIDEMENT_MACRO.id);

      const vars = parseClinicalEntities(transcript);
      expect(vars.quadrants).toEqual(expect.arrayContaining(['QUADRANT 1', 'QUADRANT 4']));

      const note = generateMacroNote(transcript, macro.id, 'periodontal');
      expect(note.treatmentPerformed).toContain('Lignocaine');
      expect(note.findingsGingival).toContain('QUADRANT 1');
      expectStructuralNote(note);
    });
  });

  // =========================================================================
  // 4. ORAL SURGERY: Simple vs Surgical Extractions & Contraindications
  // =========================================================================
  describe('Oral Surgery Procedures', () => {
    it('detects simple forceps extraction and renders spoken evidence structurally', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Symptomatic non-restorable tooth 27 due to extensive recurrent subgingival caries.' },
        { sender: 'Dentist', text: 'Medical history clear, no bleeding disorders, non-smoker.' },
        { sender: 'Dentist', text: '4% Articaine infiltration administered. Straight elevator used to luxate tooth 27, delivered with upper molar forceps intact.' },
        { sender: 'Dentist', text: 'Socket inspected and curetted, haemostasis achieved with sterile gauze pressure pack. POIG given.' }
      ];

      const macro = detectMacroFromContext(transcript, 'surgical');
      expect(macro.id).toBe(SIMPLE_EXTRACTION_MACRO.id);

      const note = generateMacroNote(transcript, macro.id, 'surgical');
      expect(note.treatmentPerformed).toContain('Site: #27');
      expect(note.treatmentPerformed).toContain('Articaine');
      expectStructuralNote(note);
      // The template must not narrate an extraction technique that was not
      // reduced to evidence — no forceps prose, no socket narrative.
      expect(note.treatmentPerformed).not.toMatch(/forceps|socket inspected|curetted/i);
    });

    it('detects surgical extraction and renders spoken materials only', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Surgical extraction of impacted lower right wisdom tooth 48.' },
        { sender: 'Dentist', text: 'Profound IAN block and long buccal infiltration with 4% Articaine.' },
        { sender: 'Dentist', text: 'Mucoperiosteal envelope flap raised with #15 blade. Buccal bone guttering created with surgical handpiece under copious saline irrigation.' },
        { sender: 'Dentist', text: 'Tooth sectioned at cervical neck, crown delivered, roots elevated separately and retrieved intact.' },
        { sender: 'Dentist', text: 'Socket debrided, Gelatemp placed, 3-0 Prolene suture placed to approximate flap. Haemostasis verified.' }
      ];

      const macro = detectMacroFromContext(transcript, 'surgical');
      expect(macro.id).toBe(SURGICAL_EXTRACTION_MACRO.id);

      const vars = parseClinicalEntities(transcript);
      expect(vars.materials?.sutureType).toBe('Prolene');
      expect(vars.materials?.haemostaticAgent).toBe('Gelatemp');

      const note = generateMacroNote(transcript, macro.id, 'surgical');
      expect(note.treatmentPerformed).toContain('Site: #48');
      expect(note.treatmentPerformed).toContain('Prolene');
      expect(note.treatmentPerformed).toContain('Gelatemp');
      expectStructuralNote(note);
    });

    it('keeps refused extraction out of the note when dentist defers surgery (negation safety)', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Patient wants tooth 37 taken out because it is hurting.' },
        { sender: 'Dentist', text: 'Checking medical history: patient is on Warfarin with unmonitored INR and Eliquis. High bleeding risk.' },
        { sender: 'Dentist', text: 'I explained to the patient that we are not going to extract this tooth today. Extraction is contraindicated until we consult your GP and check INR.' },
        { sender: 'Dentist', text: 'We will open the tooth and perform emergency nerve removal instead to get you out of pain safely.' }
      ];

      const macro = detectMacroFromContext(transcript, 'emergency');
      expect(macro.id).toBe(EMERGENCY_PULP_EXTIRPATION_MACRO.id);

      const note = generateMacroNote(transcript, macro.id, 'emergency');
      // Codes only from spoken item numbers — no extraction items may appear.
      expect(note.adaCodes.some(c => c.code === '311')).toBe(false);
      expect(note.adaCodes.some(c => c.code === '324')).toBe(false);
      expect(note.adaCodes.some(c => c.code === '414')).toBe(false);
      expectStructuralNote(note);
      // No extraction narrative may be invented by the template.
      expect(JSON.stringify(note)).not.toMatch(/forceps|socket inspected|elevated and removed/i);
    });
  });

  // =========================================================================
  // 5. ENDODONTICS: Extirpation, Chemo-Mechanical Prep & Obturation
  // =========================================================================
  describe('Endodontic Procedures', () => {
    it('detects emergency pulp extirpation and renders spoken canal/dressing evidence', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Emergency appointment for severe throbbing pain on tooth 26 waking patient up.' },
        { sender: 'Dentist', text: 'Diagnosis: symptomatic irreversible pulpitis with acute apical periodontitis.' },
        { sender: 'Dentist', text: 'Administered 4% Articaine infiltration. Rubber dam isolated on tooth 26.' },
        { sender: 'Dentist', text: 'Access cavity prepared. 3 canals located: MB, DB, Palatal. Pulp extirpated with barbed broaches and copious sodium hypochlorite irrigation.' },
        { sender: 'Dentist', text: 'Canals dried with paper points. Odontopaste dressing placed in canal orifices. Cavit and Fuji IX temporary restoration placed. Out of occlusion.' }
      ];

      const macro = detectMacroFromContext(transcript, 'endodontic');
      expect(macro.id).toBe(EMERGENCY_PULP_EXTIRPATION_MACRO.id);

      const vars = parseClinicalEntities(transcript);
      expect(vars.canalsCount).toBe(3);
      expect(vars.materials?.dressing).toContain('Odontopaste');

      const note = generateMacroNote(transcript, macro.id, 'endodontic');
      expect(note.treatmentPerformed).toContain('Site: #26');
      expect(note.treatmentPerformed).toContain('Canals located: 3');
      expect(note.treatmentPerformed).toContain('Odontopaste');
      expectStructuralNote(note);
      // A spoken diagnosis sentence must not leak into the note as template
      // prose — diagnosis classification is the clinician's assessment.
      expect(note.diagnosis).toBe('');
    });

    it('detects root canal completion / obturation and renders structural evidence', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Stage 2 root canal treatment for tooth 14. Tooth completely asymptomatic since extirpation.' },
        { sender: 'Dentist', text: 'Rubber dam isolation placed. Cavit temporary removed. 2 canals located: buccal and palatal.' },
        { sender: 'Dentist', text: 'Chemo-mechanical preparation to working length: Buccal 21mm size 30/.04, Palatal 21.5mm size 35/.04 with rotary Protaper files.' },
        { sender: 'Dentist', text: 'Copious irrigation with 4% NaOCl and 17% EDTA with ultrasonic activation. Canals dried.' },
        { sender: 'Dentist', text: 'Obturation completed using gutta-percha master cones and AH Plus epoxy resin sealer using warm vertical condensation. Coronal seal with composite core.' }
      ];

      const macro = detectMacroFromContext(transcript, 'endodontic');
      expect(macro.category).toBe('endodontic');

      const vars = parseClinicalEntities(transcript);
      expect(vars.teeth).toContain('14');

      const note = generateMacroNote(transcript, macro.id, 'endodontic');
      expect(note.treatmentPerformed).toContain('Site: #14');
      expect(note.treatmentPerformed).toContain('Rubber dam');
      expectStructuralNote(note);
    });
  });

  // =========================================================================
  // 6. FIXED PROSTHODONTICS: Crown Preparation & Crown Cementation
  // =========================================================================
  describe('Fixed Prosthodontics (Crown & Bridge)', () => {
    it('detects crown preparation and renders structural spoken evidence', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Booked for crown preparation on tooth 36 due to cracked tooth syndrome across the mesial marginal ridge.' },
        { sender: 'Dentist', text: '2% Lignocaine 1:80,000 IAN block given. Core buildup placed with dual-cure composite.' },
        { sender: 'Dentist', text: 'Axial reduction 1.5mm with 1mm circumferential deep chamfer margin. #00 Ultrapak retraction cord placed for gingival deflection.' },
        { sender: 'Dentist', text: '3Shape Trios digital intraoral scan taken of upper, lower and bite registration. Sent to lab for monolithic zirconia crown, shade A2.' },
        { sender: 'Dentist', text: 'Protemp temporary crown fabricated, trimmed, and cemented with Temp-Bond NE. Excess cement cleared.' }
      ];

      const macro = detectMacroFromContext(transcript, 'prosthodontic');
      expect(macro.category).toBe('restorative');
      expect(macro.id).toMatch(/crown_prep|crown/);

      const note = generateMacroNote(transcript, macro.id, 'prosthodontic');
      expect(note.treatmentPerformed).toContain('Site: #36');
      expect(note.treatmentPerformed).toContain('Lignocaine');
      expectStructuralNote(note);
    });

    it('detects crown issue / cementation visit and renders structural spoken evidence', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Patient in for crown issue on tooth 36. Zirconia crown returned from laboratory.' },
        { sender: 'Dentist', text: 'Temporary crown removed, tooth preparation cleaned with pumice slurry and dried.' },
        { sender: 'Dentist', text: 'Crown try-in: marginal fit verified with sharp explorer, tight interproximal contacts confirmed with dental floss, occlusion checked with 8-micron shimstock.' },
        { sender: 'Dentist', text: 'Patient approved aesthetics and shade A2. Crown intaglio sandblasted with alumina, primed with Z-Prime Plus.' },
        { sender: 'Dentist', text: 'Cemented definitively with RelyX Unicem self-adhesive resin cement under firm finger pressure. Light cured, excess cement thoroughly removed.' }
      ];

      const macro = detectMacroFromContext(transcript, 'prosthodontic');
      expect(macro.id).toMatch(/crown_fit|crown_issue|crown_cementation/);

      const note = generateMacroNote(transcript, macro.id, 'prosthodontic');
      expect(note.treatmentPerformed).toContain('Site: #36');
      expectStructuralNote(note);
    });

    it('detects 3-unit bridge preparation and renders spoken abutments structurally', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Bridge preparation visit for fixed 3-unit bridge replacing missing tooth 15, with abutment teeth 14 and 16.' },
        { sender: 'Dentist', text: 'Administered 4% Articaine buccal and palatal infiltrations on upper right quadrant.' },
        { sender: 'Dentist', text: 'Parallel axial reductions completed on teeth 14 and 16 with clear common path of insertion and 1mm chamfer margins.' },
        { sender: 'Dentist', text: 'Retraction cord #00 placed. Digital intraoral 3Shape scan completed for monolithic zirconia 3-unit bridge.' },
        { sender: 'Dentist', text: 'Fabricated 3-unit acrylic temporary bridge, cemented with Temp-Bond NE. Occlusion checked.' }
      ];

      const macro = detectMacroFromContext(transcript, 'prosthodontic');
      expect(macro.category).toBe('restorative');
      expect(macro.id).toMatch(/crown_prep|bridge/);

      const vars = parseClinicalEntities(transcript);
      expect(vars.teeth).toContain('14');
      expect(vars.teeth).toContain('16');

      const note = generateMacroNote(transcript, macro.id, 'prosthodontic');
      expect(note.treatmentPerformed).toContain('#14');
      expect(note.treatmentPerformed).toContain('#16');
      expectStructuralNote(note);
    });
  });

  // =========================================================================
  // 7. OCCLUSAL SPLINTS & BRUXISM
  // =========================================================================
  describe('Occlusal Splints / Nightguards', () => {
    it('detects occlusal splint delivery and renders structural spoken evidence', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Delivery of hard acrylic maxillary occlusal splint for severe nocturnal bruxism and attrition.' },
        { sender: 'Dentist', text: 'Splint tried in upper arch. Retention firm and comfortable, no rocking.' },
        { sender: 'Dentist', text: 'Occlusion adjusted with blue articulating paper: even simultaneous contacts on all posterior teeth in centric relation, smooth canine guidance in lateral excursions, no balancing interferences.' },
        { sender: 'Dentist', text: 'Splint polished. Care instructions provided: rinse with cold water, store dry in ventilated box, clean with soft toothbrush and mild soap. Review in 4 weeks.' }
      ];

      const macro = detectMacroFromContext(transcript, 'examination');
      expect(macro.id).toMatch(/occlusal_splint|splint/);

      const note = generateMacroNote(transcript, macro.id, 'examination');
      expectStructuralNote(note);
      // Bruxism prose is not classified evidence — must not appear from the template.
      expect(JSON.stringify(note)).not.toMatch(/sleep bruxism, tooth wear|masticatory muscle hyperactivity/i);
    });
  });

  // =========================================================================
  // 8. DENTAL TRAUMA & EMERGENCY SPLINTING
  // =========================================================================
  describe('Dental Trauma Management', () => {
    it('detects trauma splinting and renders structural spoken evidence', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Emergency trauma presentation: 14 year old patient suffered direct impact to mouth playing soccer 1 hour ago.' },
        { sender: 'Dentist', text: 'Examination: tooth 11 subluxated, grade 2 mobility, tender to percussion. Radiograph checks show no root fracture.' },
        { sender: 'Dentist', text: 'Tooth 11 repositioned into anatomical alignment under gentle digital pressure.' },
        { sender: 'Dentist', text: 'Flexible wire-composite splint placed from tooth 12 to tooth 21 using Flowable composite.' },
        { sender: 'Dentist', text: 'Occlusion cleared. Instructions: soft diet for 2 weeks, chlorhexidine mouthrinse twice daily, do not bite on front teeth. Splint removal and pulp vitality check in 2 weeks.' }
      ];

      const macro = detectMacroFromContext(transcript, 'emergency');
      expect(macro.category).toBe('surgical');

      const note = generateMacroNote(transcript, macro.id, 'emergency');
      expect(note.treatmentPerformed).toContain('Site: #11');
      expectStructuralNote(note);
    });
  });

  // =========================================================================
  // 9. DENTAL IMPLANTS: Surgical Fixture Placement (Stage 1)
  // =========================================================================
  describe('Dental Implants (Fixture Placement)', () => {
    it('detects implant placement and renders structural spoken evidence', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Implant surgery scheduled for missing tooth 46 site.' },
        { sender: 'Dentist', text: 'Pre-op chlorhexidine 0.2% mouthrinse 1 minute. Administered 4% Articaine 1:100,000 IAN block and long buccal infiltration.' },
        { sender: 'Dentist', text: 'Mid-crestal incision with sulcular releasing incisions. Full thickness mucoperiosteal flap reflected to expose edentulous ridge.' },
        { sender: 'Dentist', text: 'Sequential osteotomy prepared with copious chilled saline irrigation under 800 RPM: 2.0mm pilot drill to 10mm depth, verified with direction indicator.' },
        { sender: 'Dentist', text: 'Straumann Bone Level Tapered implant 4.1mm diameter by 10mm length inserted. Primary stability achieved with insertion torque 35 Ncm.' },
        { sender: 'Dentist', text: 'Healing abutment 2mm placed hand-tight. Flaps approximated tension-free and closed with 4-0 PTFE interrupted sutures. Good haemostasis achieved.' }
      ];

      const macro = detectMacroFromContext(transcript, 'implant');
      expect(macro.category).toBe('implant');

      const vars = parseClinicalEntities(transcript);
      expect(vars.teeth).toContain('46');

      const note = generateMacroNote(transcript, macro.id, 'implant');
      expect(note.treatmentPerformed).toContain('Site: #46');
      expect(note.treatmentPerformed).toContain('Articaine');
      expectStructuralNote(note);
      // Technique numbers (35 Ncm etc.) are not template inventions to assert.
      expect(JSON.stringify(note)).not.toMatch(/insertion torque 35 Ncm/i);
    });
  });

  // =========================================================================
  // 10. DENTURES: Digital Dentures & Implant-Supported Overdentures
  // =========================================================================
  describe('Removable Prosthodontics (Dentures & Digital Dentures)', () => {
    it('detects denture impressions and renders structural spoken evidence', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Patient attending for secondary master impressions for complete upper and complete lower digital dentures.' },
        { sender: 'Dentist', text: 'Border moulding completed using green stick compound on custom trays to capture peripheral seal and frenal attachments.' },
        { sender: 'Dentist', text: 'Polyvinyl siloxane light body wash impression taken under light finger pressure. Clear definition of retromolar pads, hamular notches, and vibrating line.' },
        { sender: 'Dentist', text: 'Digital CAD/CAM facial scanning and jaw relation records registered. Sent to dental laboratory for digital 3D printed denture base try-in.' }
      ];

      const macro = detectMacroFromContext(transcript, 'prosthodontic');
      expect(macro.category).toBe('prosthodontic');
      expect(macro.id).toMatch(/denture/);

      const note = generateMacroNote(transcript, macro.id, 'prosthodontic');
      expectStructuralNote(note);
    });

    it('detects implant overdenture pick-up and renders structural spoken evidence', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Delivery and chairside pick-up for lower implant-supported overdenture on teeth 33 and 43 implants.' },
        { sender: 'Dentist', text: 'Locator abutments torqued to 30 Ncm on implants. White block-out spacers placed.' },
        { sender: 'Dentist', text: 'Titanium housing caps with black processing inserts seated onto locators. Intaglio recesses of lower acrylic denture relieved.' },
        { sender: 'Dentist', text: 'Chairside pick-up completed using dual-cure Quick Up pick-up resin under centric occlusion. Denture removed, excess resin trimmed and polished.' },
        { sender: 'Dentist', text: 'Processing inserts replaced with blue 1.5lb retention caps. Denture seated with positive audible click and excellent retention.' }
      ];

      const macro = detectMacroFromContext(transcript, 'prosthodontic');
      expect(macro.id).toMatch(/implant_overdenture|overdenture|denture/);

      const note = generateMacroNote(transcript, macro.id, 'prosthodontic');
      expect(note.treatmentPerformed).toContain('#33');
      expect(note.treatmentPerformed).toContain('#43');
      expectStructuralNote(note);
    });
  });

  // =========================================================================
  // 11. TEETH WHITENING: In-Chair Pola Advanced Whitening
  // =========================================================================
  describe('Teeth Whitening (Pola In-Chair Bleaching)', () => {
    it('detects in-chair whitening and renders structural spoken evidence', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Patient attending for Pola Office in-chair professional tooth whitening.' },
        { sender: 'Dentist', text: 'Baseline tooth shade recorded: A3.5 on maxillary anterior teeth using VITA Classical Shade Guide.' },
        { sender: 'Dentist', text: 'OptraGate lip and cheek retractor inserted. Gingival barrier resin applied along cervical margins of teeth 15 to 25 and 35 to 45 and light cured.' },
        { sender: 'Dentist', text: 'Pola Office 35% hydrogen peroxide gel applied to labial surfaces. 3 consecutive 15-minute cycles completed.' },
        { sender: 'Dentist', text: 'Gel thoroughly suctioned and washed off. Gingival barrier peeled off cleanly. Post-operative shade achieved: A1 (5 shades lighter).' },
        { sender: 'Dentist', text: 'Soothe desensitising potassium nitrate gel applied for 5 minutes. Post-op white diet instructions given for 48 hours.' }
      ];

      const macro = detectMacroFromContext(transcript, 'cosmetic');
      expect(macro.category).toBe('cosmetic');
      expect(macro.id).toMatch(/whitening|bleach/);

      const note = generateMacroNote(transcript, macro.id, 'cosmetic');
      expectStructuralNote(note);
    });
  });

  // =========================================================================
  // 12. VENEERS & DIGITAL SMILE DESIGN
  // =========================================================================
  describe('Veneers & Aesthetic Smile Design', () => {
    it('detects veneer preparation and renders structural spoken evidence', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Aesthetic smile makeover appointment: porcelain veneer preparation for teeth 13, 12, 11, 21, 22, 23.' },
        { sender: 'Dentist', text: 'Diagnostic wax-up transfer mock-up evaluated intraorally with bis-acryl resin. Patient confirmed smile arc, incisal display and symmetry.' },
        { sender: 'Dentist', text: 'Conservative depth-groove guided facial enamel reduction 0.4mm to 0.6mm with butt-joint incisal preparation maintaining enamel peripheral margin.' },
        { sender: 'Dentist', text: 'Subgingival retraction cord #00 placed. Digital 3Shape intraoral scan captured for Master Ceramicist. Shade requested: BL3.' },
        { sender: 'Dentist', text: 'Direct composite temporary veneers placed using spot-etch technique with Telio CS.' }
      ];

      const macro = detectMacroFromContext(transcript, 'cosmetic');
      expect(macro.id).toMatch(/veneer|smile_design/);

      const note = generateMacroNote(transcript, macro.id, 'cosmetic');
      expect(note.treatmentPerformed).toContain('Site: #13');
      expectStructuralNote(note);
    });
  });

  // =========================================================================
  // 13. CLEAR ALIGNERS / INVISALIGN
  // =========================================================================
  describe('Orthodontics (Invisalign / Clear Aligners)', () => {
    it('detects aligner delivery, IPR and attachments, rendering structural spoken evidence', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Invisalign aligner delivery and composite attachment bonding appointment.' },
        { sender: 'Dentist', text: 'Teeth cleaned with pumice, etched with 37% phosphoric acid, Prime & Bond applied.' },
        { sender: 'Dentist', text: 'Template aligner loaded with Filtek Supreme flowable composite and seated firmly. Light cured 20s per tooth. Attachments verified on teeth 14, 13, 23, 24, 34, 44.' },
        { sender: 'Dentist', text: 'Interproximal reduction (IPR) performed: 0.2mm between 12-11 and 21-22 using diamond hand strips, verified with thickness gauge.' },
        { sender: 'Dentist', text: 'Aligners #1 delivered and seated. Tight fit with good tracking. Chewies and removal tool provided. Patient instructed on 22 hours daily wear, change every 7 days.' }
      ];

      const macro = detectMacroFromContext(transcript, 'orthodontic');
      expect(macro.category).toBe('orthodontic');
      expect(macro.id).toMatch(/aligner|invisalign|ortho/);

      const note = generateMacroNote(transcript, macro.id, 'orthodontic');
      expect(note.treatmentPerformed).toContain('Site: #14');
      expectStructuralNote(note);
    });
  });

  // =========================================================================
  // 14. SLEEP DENTISTRY & CONSCIOUS SEDATION
  // =========================================================================
  describe('Sleep Dentistry (Conscious IV Sedation / Relative Analgesia)', () => {
    it('detects sedation visit and renders structural spoken evidence without sedation prose', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Dental treatment under conscious IV sedation for dental phobia.' },
        { sender: 'Dentist', text: 'Cannula 22G sited in left dorsum of hand. Pre-op vitals: BP 124/78, HR 72, SpO2 99% on room air.' },
        { sender: 'Dentist', text: 'Midazolam 3.5mg and Fentanyl 50mcg titrated incrementally under specialist anaesthetist supervision.' },
        { sender: 'Dentist', text: 'Continuous monitoring: ECG, NIBP, pulse oximetry, capnography. Patient responsive to verbal commands throughout (Ramsay Sedation Score 3).' },
        { sender: 'Dentist', text: 'Local anaesthesia administered. Dental procedures completed smoothly without patient distress.' },
        { sender: 'Dentist', text: 'Post-op recovery uneventful. Aldrete discharge score 10/10 reached at 45 minutes. Discharged home in the care of responsible adult escort.' }
      ];

      const macro = detectMacroFromContext(transcript, 'surgical');
      expect(macro.id).toMatch(/sedation/);

      const note = generateMacroNote(transcript, macro.id, 'surgical');
      expectStructuralNote(note);
      // Sedation drug/monitoring prose must never be invented by the template —
      // only what parseClinicalEntities extracted may render.
      expect(JSON.stringify(note)).not.toMatch(/midazolam|fentanyl|propofol|capnography|aldrete/i);
    });
  });
});
