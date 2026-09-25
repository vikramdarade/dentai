import { describe, it, expect } from 'vitest';
import { detectMacroFromContext, generateMacroNote } from '../src/lib/macroEngine';
import { parseClinicalEntities } from '../src/lib/clinicalEntityParser';
import {
  ROUTINE_RESTORATION_MACRO,
  GENERAL_EXAM_CLEAN_MACRO,
  SCALING_CLEAN_MACRO,
  PERIODONTAL_DEBRIDEMENT_MACRO,
  SIMPLE_EXTRACTION_MACRO,
  SURGICAL_EXTRACTION_MACRO,
  EMERGENCY_PULP_EXTIRPATION_MACRO,
  FISSURE_SEALANT_MACRO,
} from '../src/lib/australianClinicalMacros';

describe('TDD: Multi-Specialty Dental Clinic Clinical Scenarios', () => {

  // =========================================================================
  // 1. RESTORATIVE: Multi-Surface Posterior & Anterior Aesthetic Fillings
  // =========================================================================
  describe('Restorative Procedures', () => {
    it('detects and generates accurate notes for a multi-surface posterior composite (MODB 46)', () => {
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
      expect(note.treatmentPerformed).toContain('#46');
      expect(note.treatmentPerformed).toContain('MODB');
      expect(note.treatmentPerformed).toContain('Rubber dam');
      expect(note.treatmentPerformed).toContain('Vitreobond');
      expect(note.treatmentPerformed).toContain('A3');
    });

    it('detects and generates accurate notes for an anterior composite (11 MI)', () => {
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
      expect(note.treatmentPerformed).toContain('#11');
      expect(note.treatmentPerformed).toContain('B1');
    });
  });

  // =========================================================================
  // 2. DIAGNOSTIC & PREVENTATIVE: Full Exam, Scale & Clean, Sealants
  // =========================================================================
  describe('Diagnostic & Preventative Procedures', () => {
    it('detects and generates comprehensive examination & hygiene clean', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Welcome in for your regular checkup and clean. Dentition charted, soft tissues NAD.' },
        { sender: 'Dentist', text: 'BPE scores recorded: all sextants 0 and 1, no deep pockets. Bitewing radiographs taken showing no interproximal caries.' },
        { sender: 'Dentist', text: 'Ultrasonic scaling completed to remove supragingival calculus. Prophy with fine mint paste, topical neutral sodium fluoride applied.' },
        { sender: 'Dentist', text: 'Discussed interdental flossing daily. Recall in 6 months.' }
      ];

      const macro = detectMacroFromContext(transcript, 'examination');
      expect(macro.id).toBe(GENERAL_EXAM_CLEAN_MACRO.id);

      const note = generateMacroNote(transcript, macro.id, 'examination');
      expect(note.adaCodes.some(c => c.code === '011')).toBe(true);
      expect(note.adaCodes.some(c => c.code === '114')).toBe(true);
      expect(note.recallRequirements).toContain('6');
    });

    it('detects and generates paediatric fissure sealants (teeth 16, 26, 36, 46)', () => {
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
      expect(note.treatmentPerformed).toContain('sealant');
      expect(note.adaCodes.some(c => c.code === '161')).toBe(true);
    });
  });

  // =========================================================================
  // 3. PERIODONTICS: Deep Subgingival Debridement / Root Planing
  // =========================================================================
  describe('Periodontal Procedures', () => {
    it('detects and generates quadrant subgingival root planing with local anaesthetic', () => {
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
      expect(note.treatmentPerformed).toContain('root planing');
      expect(note.treatmentPerformed).toContain('Gracey');
      expect(note.adaCodes.some(c => c.code === '222')).toBe(true);
    });
  });

  // =========================================================================
  // 4. ORAL SURGERY: Simple vs Surgical Extractions & Contraindications
  // =========================================================================
  describe('Oral Surgery Procedures', () => {
    it('detects and generates simple forceps extraction when not contraindicated', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Symptomatic non-restorable tooth 27 due to extensive recurrent subgingival caries.' },
        { sender: 'Dentist', text: 'Medical history clear, no bleeding disorders, non-smoker.' },
        { sender: 'Dentist', text: '4% Articaine infiltration administered. Straight elevator used to luxate tooth 27, delivered with upper molar forceps intact.' },
        { sender: 'Dentist', text: 'Socket inspected and curetted, haemostasis achieved with sterile gauze pressure pack. POIG given.' }
      ];

      const macro = detectMacroFromContext(transcript, 'surgical');
      expect(macro.id).toBe(SIMPLE_EXTRACTION_MACRO.id);

      const note = generateMacroNote(transcript, macro.id, 'surgical');
      expect(note.treatmentPerformed).toContain('Simple extraction');
      expect(note.treatmentPerformed).toContain('forceps');
      expect(note.adaCodes.some(c => c.code === '311')).toBe(true);
    });

    it('detects and generates surgical extraction with bone guttering, tooth sectioning and sutures', () => {
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
      expect(vars.materials?.sutureType).toContain('Prolene');
      expect(vars.materials?.haemostaticAgent).toContain('Gelatemp');

      const note = generateMacroNote(transcript, macro.id, 'surgical');
      expect(note.treatmentPerformed).toContain('Bone gutter');
      expect(note.treatmentPerformed).toContain('Tooth sectioned');
      expect(note.treatmentPerformed).toContain('Prolene');
      expect(note.adaCodes.some(c => c.code === '324')).toBe(true);
    });

    it('strictly negates extraction when patient is on blood thinners and dentist refuses surgery', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Patient wants tooth 37 taken out because it is hurting.' },
        { sender: 'Dentist', text: 'Checking medical history: patient is on Warfarin with unmonitored INR and Eliquis. High bleeding risk.' },
        { sender: 'Dentist', text: 'I explained to the patient that we are not going to extract this tooth today. Extraction is contraindicated until we consult your GP and check INR.' },
        { sender: 'Dentist', text: 'We will open the tooth and perform emergency nerve removal instead to get you out of pain safely.' }
      ];

      const macro = detectMacroFromContext(transcript, 'emergency');
      expect(macro.id).not.toBe(SIMPLE_EXTRACTION_MACRO.id);
      expect(macro.id).not.toBe(SURGICAL_EXTRACTION_MACRO.id);
      expect(macro.id).toBe(EMERGENCY_PULP_EXTIRPATION_MACRO.id);

      const note = generateMacroNote(transcript, macro.id, 'emergency');
      expect(note.adaCodes.some(c => c.code === '311')).toBe(false);
      expect(note.adaCodes.some(c => c.code === '324')).toBe(false);
      expect(note.adaCodes.some(c => c.code === '414')).toBe(true);
    });
  });

  // =========================================================================
  // 5. ENDODONTICS: Extirpation, Chemo-Mechanical Prep & Obturation
  // =========================================================================
  describe('Endodontic Procedures', () => {
    it('detects and generates emergency pulp extirpation (Stage 1 RCT)', () => {
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
      expect(note.adaCodes.some(c => c.code === '414')).toBe(true);
      expect(note.treatmentPerformed).toContain('3 canals located');
      expect(note.treatmentPerformed).toContain('Odontopaste');
    });

    it('detects and generates root canal completion / obturation (Stage 2/3 RCT)', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Stage 2 root canal treatment for tooth 14. Tooth completely asymptomatic since extirpation.' },
        { sender: 'Dentist', text: 'Rubber dam isolation placed. Cavit temporary removed. 2 canals located: buccal and palatal.' },
        { sender: 'Dentist', text: 'Chemo-mechanical preparation to working length: Buccal 21mm size 30/.04, Palatal 21.5mm size 35/.04 with rotary Protaper files.' },
        { sender: 'Dentist', text: 'Copious irrigation with 4% NaOCl and 17% EDTA with ultrasonic activation. Canals dried.' },
        { sender: 'Dentist', text: 'Obturation completed using gutta-percha master cones and AH Plus epoxy resin sealer using warm vertical condensation. Coronal seal with composite core.' }
      ];

      const macro = detectMacroFromContext(transcript, 'endodontic');
      // Must identify as endodontic completion / obturation
      expect(macro.category).toBe('endodontic');

      const vars = parseClinicalEntities(transcript);
      expect(vars.teeth).toContain('14');

      const note = generateMacroNote(transcript, macro.id, 'endodontic');
      expect(note.treatmentPerformed.toLowerCase()).toMatch(/obturat|gutta[- ]percha/);
      // ADA 416 is Root Canal Obturation
      expect(note.adaCodes.some(c => c.code === '416' || c.code === '415')).toBe(true);
    });
  });

  // =========================================================================
  // 6. FIXED PROSTHODONTICS: Crown Preparation & Crown Cementation
  // =========================================================================
  describe('Fixed Prosthodontics (Crown & Bridge)', () => {
    it('detects and generates crown preparation and digital intraoral scan', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Booked for crown preparation on tooth 36 due to cracked tooth syndrome across the mesial marginal ridge.' },
        { sender: 'Dentist', text: '2% Lignocaine 1:80,000 IAN block given. Core buildup placed with dual-cure composite.' },
        { sender: 'Dentist', text: 'Axial reduction 1.5mm with 1mm circumferential deep chamfer margin. #00 Ultrapak retraction cord placed for gingival deflection.' },
        { sender: 'Dentist', text: '3Shape Trios digital intraoral scan taken of upper, lower and bite registration. Sent to lab for monolithic zirconia crown, shade A2.' },
        { sender: 'Dentist', text: 'Protemp temporary crown fabricated, trimmed, and cemented with Temp-Bond NE. Excess cement cleared.' }
      ];

      const macro = detectMacroFromContext(transcript, 'prosthodontic');
      expect(macro.category).toBe('restorative'); // or prosthodontic
      expect(macro.id).toMatch(/crown_prep|crown/);

      const note = generateMacroNote(transcript, macro.id, 'prosthodontic');
      expect(note.treatmentPerformed.toLowerCase()).toMatch(/chamfer|reduction|scan|temporary/);
      expect(note.adaCodes.some(c => c.code === '613' || c.code === '615' || c.code === '618' || c.code === '627')).toBe(true);
    });

    it('detects and generates crown issue / cementation visit', () => {
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
      expect(note.treatmentPerformed.toLowerCase()).toMatch(/try-in|contacts|relyx|cement/);
      expect(note.adaCodes.some(c => c.code === '651' || c.code === '652')).toBe(true);
    });

    it('detects and generates 3-unit fixed bridge preparation (abutments 14, 16 with pontic 15)', () => {
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
      expect(note.treatmentPerformed.toLowerCase()).toMatch(/bridge|chamfer|scan|temporary/);
      expect(note.adaCodes.some(c => c.code === '613' || c.code === '615' || c.code === '643' || c.code === '627')).toBe(true);
    });
  });

  // =========================================================================
  // 7. OCCLUSAL SPLINTS & BRUXISM
  // =========================================================================
  describe('Occlusal Splints / Nightguards', () => {
    it('detects and generates occlusal splint delivery for sleep bruxism', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Delivery of hard acrylic maxillary occlusal splint for severe nocturnal bruxism and attrition.' },
        { sender: 'Dentist', text: 'Splint tried in upper arch. Retention firm and comfortable, no rocking.' },
        { sender: 'Dentist', text: 'Occlusion adjusted with blue articulating paper: even simultaneous contacts on all posterior teeth in centric relation, smooth canine guidance in lateral excursions, no balancing interferences.' },
        { sender: 'Dentist', text: 'Splint polished. Care instructions provided: rinse with cold water, store dry in ventilated box, clean with soft toothbrush and mild soap. Review in 4 weeks.' }
      ];

      const macro = detectMacroFromContext(transcript, 'examination');
      expect(macro.id).toMatch(/occlusal_splint|splint/);

      const note = generateMacroNote(transcript, macro.id, 'examination');
      expect(note.treatmentPerformed.toLowerCase()).toMatch(/splint|bruxism|canine guidance/);
      expect(note.adaCodes.some(c => c.code === '965')).toBe(true);
    });
  });

  // =========================================================================
  // 8. DENTAL TRAUMA & EMERGENCY SPLINTING
  // =========================================================================
  describe('Dental Trauma Management', () => {
    it('detects and generates trauma stabilization and flexible splinting', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Emergency trauma presentation: 14 year old patient suffered direct impact to mouth playing soccer 1 hour ago.' },
        { sender: 'Dentist', text: 'Examination: tooth 11 subluxated, grade 2 mobility, tender to percussion. Radiograph checks show no root fracture.' },
        { sender: 'Dentist', text: 'Tooth 11 repositioned into anatomical alignment under gentle digital pressure.' },
        { sender: 'Dentist', text: 'Flexible wire-composite splint placed from tooth 12 to tooth 21 using Flowable composite.' },
        { sender: 'Dentist', text: 'Occlusion cleared. Instructions: soft diet for 2 weeks, chlorhexidine mouthrinse twice daily, do not bite on front teeth. Splint removal and pulp vitality check in 2 weeks.' }
      ];

      const macro = detectMacroFromContext(transcript, 'emergency');
      expect(macro.category).toBe('surgical'); // or emergency trauma

      const note = generateMacroNote(transcript, macro.id, 'emergency');
      expect(note.treatmentPerformed.toLowerCase()).toMatch(/splint|reposition/);
      expect(note.adaCodes.some(c => c.code === '392')).toBe(true);
    });
  });

  // =========================================================================
  // 9. DENTAL IMPLANTS: Surgical Fixture Placement (Stage 1)
  // =========================================================================
  describe('Dental Implants (Fixture Placement)', () => {
    it('detects and generates surgical dental implant fixture placement', () => {
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
      expect(note.treatmentPerformed.toLowerCase()).toMatch(/implant|osteotomy|straumann|insertion torque/);
      expect(note.adaCodes.some(c => c.code === '661' || c.code === '684' || c.code === '688')).toBe(true);
    });
  });

  // =========================================================================
  // 10. DENTURES: Digital Dentures & Implant-Supported Overdentures
  // =========================================================================
  describe('Removable Prosthodontics (Dentures & Digital Dentures)', () => {
    it('detects and generates full upper and lower denture impressions / digital try-in', () => {
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
      expect(note.treatmentPerformed.toLowerCase()).toMatch(/denture|impression|border mould|custom tray/);
      expect(note.adaCodes.some(c => c.code === '711' || c.code === '712' || c.code === '719' || c.code === '721')).toBe(true);
    });

    it('detects and generates implant-supported overdenture insertion / locator pick-up', () => {
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
      expect(note.treatmentPerformed.toLowerCase()).toMatch(/locator|overdenture|retention|pick-up/);
      expect(note.adaCodes.some(c => c.code === '672' || c.code === '712' || c.code === '731')).toBe(true);
    });
  });

  // =========================================================================
  // 11. TEETH WHITENING: In-Chair Pola Advanced Whitening
  // =========================================================================
  describe('Teeth Whitening (Pola In-Chair Bleaching)', () => {
    it('detects and generates in-chair tooth whitening procedure', () => {
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
      expect(note.treatmentPerformed.toLowerCase()).toMatch(/whitening|peroxide|barrier|shade/);
      expect(note.adaCodes.some(c => c.code === '118' || c.code === '119')).toBe(true);
    });
  });

  // =========================================================================
  // 12. VENEERS & DIGITAL SMILE DESIGN
  // =========================================================================
  describe('Veneers & Aesthetic Smile Design', () => {
    it('detects and generates porcelain veneer preparation and smile design mock-up', () => {
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
      expect(note.treatmentPerformed.toLowerCase()).toMatch(/veneer|reduction|mock-up|enamel/);
      expect(note.adaCodes.some(c => c.code === '582' || c.code === '583' || c.code === '556')).toBe(true);
    });
  });

  // =========================================================================
  // 13. CLEAR ALIGNERS / INVISALIGN
  // =========================================================================
  describe('Orthodontics (Invisalign / Clear Aligners)', () => {
    it('detects and generates Invisalign attachment placement, IPR, and aligner issue', () => {
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
      expect(note.treatmentPerformed.toLowerCase()).toMatch(/attachment|ipr|aligner|tracking/);
      expect(note.adaCodes.some(c => c.code === '825' || c.code === '881' || c.code === '071')).toBe(true);
    });
  });

  // =========================================================================
  // 14. SLEEP DENTISTRY & CONSCIOUS SEDATION
  // =========================================================================
  describe('Sleep Dentistry (Conscious IV Sedation / Relative Analgesia)', () => {
    it('detects and generates dental treatment performed under IV sedation / relative analgesia', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Dental treatment under conscious IV sedation for dental phobia.' },
        { sender: 'Dentist', text: 'Cannula 22G sited in left dorsum of hand. Pre-op vitals: BP 124/78, HR 72, SpO2 99% on room air.' },
        { sender: 'Dentist', text: 'Midazolam 3.5mg and Fentanyl 50mcg titrated incrementally under specialist anaesthetist supervision.' },
        { sender: 'Dentist', text: 'Continuous monitoring: ECG, NIBP, pulse oximetry, capnography. Patient responsive to verbal commands throughout (Ramsay Sedation Score 3).' },
        { sender: 'Dentist', text: 'Local anaesthesia administered. Dental procedures completed smoothly without patient distress.' },
        { sender: 'Dentist', text: 'Post-op recovery uneventful. Aldrete discharge score 10/10 reached at 45 minutes. Discharged home in the care of responsible adult escort.' }
      ];

      const macro = detectMacroFromContext(transcript, 'surgical');
      expect(macro.id).toMatch(/sedation|sleep_dentistry|general_anaesthesia/);

      const note = generateMacroNote(transcript, macro.id, 'surgical');
      expect(note.treatmentPerformed.toLowerCase()).toMatch(/sedation|midazolam|monitoring|recovery|aldrete/);
      expect(note.adaCodes.some(c => c.code === '927' || c.code === '943' || c.code === '949')).toBe(true);
    });
  });
});

