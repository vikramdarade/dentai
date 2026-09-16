/**
 * DentAI Clinical Note Templates & Discrepancy Engine
 * Standards-compliant Australian dental templates (AHPRA / ADA)
 * with zero-click appointment book reason matching and
 * side-by-side verbatim spoken word vs structured note discrepancy analysis.
 */

export interface ClinicalTemplateSection {
  id: string;
  title: string;
  prompt: string;
  defaultBoilerplate?: string;
}

export interface ClinicalTemplate {
  id: string;
  name: string;
  defaultAdaCodes: string[];
  description: string;
  sections: ClinicalTemplateSection[];
}

export const CLINICAL_TEMPLATES: Record<string, ClinicalTemplate> = {
  crown_preparation: {
    id: 'crown_preparation',
    name: 'Crown Preparation & Impression',
    defaultAdaCodes: ['613', '615', '022'],
    description: 'Full/partial crown preparation, margin refinement, digital scan/impression, and temp crown.',
    sections: [
      { id: 'tooth_indication', title: 'Tooth & Indication', prompt: 'Tooth number, pre-op diagnosis, reason for full coronal coverage.' },
      { id: 'anaesthesia', title: 'Local Anaesthesia', prompt: 'Type, concentration, vasoconstrictor, batch number and expiry, injection technique.', defaultBoilerplate: '1 cartridge 2% lignocaine with 1:80,000 adrenaline via infiltration. Good depth achieved.' },
      { id: 'prep_design', title: 'Preparation Design', prompt: 'Margin type (chamfer/shoulder), occlusal reduction, clearance, core buildup if placed.' },
      { id: 'retraction_impression', title: 'Gingival Retraction & Scan', prompt: 'Cord size, hemostatic agent, digital intraoral scan or PVS impression.' },
      { id: 'temporary_crown', title: 'Temporary Crown', prompt: 'Material, shade, temporary cement used, margin check, occlusion verified.', defaultBoilerplate: 'Protemp temporary crown cemented with Temp-Bond NE. Excess removed, contact points and occlusion verified.' },
      { id: 'shade_lab', title: 'Shade & Lab Prescription', prompt: 'Target shade, stump shade, lab instructions and turnaround time.' },
      { id: 'post_op', title: 'Post-Operative Instructions', prompt: 'Numbness caution, avoidance of sticky foods, hygiene around temp crown.', defaultBoilerplate: 'Post-op instructions given: avoid sticky foods on temporary crown; call clinic immediately if temp crown dislodges.' }
    ]
  },
  restorative_composite: {
    id: 'restorative_composite',
    name: 'Restorative (Composite Resin)',
    defaultAdaCodes: ['531', '532', '533'],
    description: 'Direct composite restorations for anterior and posterior teeth with FDI surface notation.',
    sections: [
      { id: 'tooth_surfaces', title: 'Tooth & Surfaces', prompt: 'FDI tooth number and exact surfaces restored (e.g. 16 MOD, 24 DO).' },
      { id: 'anaesthesia', title: 'Local Anaesthesia', prompt: 'Anaesthetic type, cartridge count, injection type.', defaultBoilerplate: '1 cartridge 2% lignocaine with 1:80,000 adrenaline administered.' },
      { id: 'isolation_excavation', title: 'Isolation & Caries Removal', prompt: 'Rubber dam or moisture control, caries indicator, excavation depth, pulp protection if needed.', defaultBoilerplate: 'Rubber dam isolation placed. Recurrent caries excavated to hard dentine. Cavity cleaned and dried.' },
      { id: 'restoration_material', title: 'Etch, Bond & Composite', prompt: 'Bonding system, composite type, shade, curing method.', defaultBoilerplate: 'Selective enamel etch 37% H3PO4 for 15s. Single-bond adhesive applied and light cured for 20s. Nanohybrid composite placed in increments.' },
      { id: 'finishing_occlusion', title: 'Finishing & Occlusion', prompt: 'Articulating paper check, high spots removed, diamond bur and silicone polish.', defaultBoilerplate: 'Occlusion verified with 40µ articulating paper in static and dynamic excursions. Polished with Sof-Lex discs and Enhance points.' },
      { id: 'post_op', title: 'Post-Operative Advice', prompt: 'Instructions given to patient.', defaultBoilerplate: 'Advised caution eating while numb. Mild transient sensitivity to cold is normal for 1-2 weeks.' }
    ]
  },
  comprehensive_exam: {
    id: 'comprehensive_exam',
    name: 'Comprehensive Exam & Scale/Clean',
    defaultAdaCodes: ['011', '114', '121'],
    description: 'Full baseline examination, periodontal screening, dental charting, calculus debridement, and fluoride.',
    sections: [
      { id: 'chief_complaint', title: 'Chief Complaint & History', prompt: 'Patient reported symptoms, medical history update, medication changes.' },
      { id: 'extra_intra_oral', title: 'Soft Tissue & Cancer Screening', prompt: 'Lips, cheeks, tongue, floor of mouth, lymph nodes, TMJ assessment.', defaultBoilerplate: 'Extraoral lymph nodes non-tender. TMJ normal without clicking or crepitus. Intraoral soft tissues pink, moist, and free from ulceration or suspicious lesions.' },
      { id: 'perio_charting', title: 'Periodontal Screening (PSR)', prompt: 'Gingival health, calculus deposits, generalized probing depths, bleeding on probing.' },
      { id: 'radiographs', title: 'Radiographic Examination', prompt: 'Bitewings or OPG taken, justification, caries or crestal bone loss detected.', defaultBoilerplate: '2x bitewing radiographs taken (ADA 022). Normal bone levels, no interproximal caries detected.' },
      { id: 'clean_fluoride', title: 'Prophylaxis & Fluoride', prompt: 'Ultrasonic scaling, prophy paste polish, topical fluoride varnish applied.', defaultBoilerplate: 'Ultrasonic scaling of supragingival and subgingival calculus. Prophy paste polish. 5% sodium fluoride varnish applied (ADA 121).' },
      { id: 'treatment_plan', title: 'Treatment Plan & Recall', prompt: 'Identified treatment needs, preventative advice, next recall schedule.', defaultBoilerplate: 'Advised daily interdental flossing. Routine 6-monthly preventative recall recommended.' }
    ]
  },
  endodontic_therapy: {
    id: 'endodontic_therapy',
    name: 'Endodontic Treatment (RCT)',
    defaultAdaCodes: ['411', '415', '417'],
    description: 'Root canal treatment stages: diagnostic testing, chemo-mechanical instrumentation, dressing, or obturation.',
    sections: [
      { id: 'symptoms_tests', title: 'Symptoms & Diagnostic Tests', prompt: 'Cold test (Endo-Ice), percussion, palpation, electric pulp test, periapical radiograph findings.' },
      { id: 'anaesthesia_isolation', title: 'Anaesthesia & Isolation', prompt: 'LA type, nerve block or infiltration, rubber dam clamp and isolation.', defaultBoilerplate: 'Inferior dental block or infiltration given with good profound anaesthesia. Rubber dam isolated single tooth field.' },
      { id: 'canals_instrumentation', title: 'Canals & Working Lengths', prompt: 'Number of canals located (e.g. MB1, MB2, DB, P), apex locator readings, rotary file system.' },
      { id: 'irrigation_medicament', title: 'Irrigation & Medicament', prompt: '1% / 4% NaOCl, EDTA, ultrasonic activation, Odontopaste or Ledermix intracanal dressing.', defaultBoilerplate: 'Copious irrigation with 4% NaOCl and 17% EDTA. Canals dried with sterile paper points. Odontopaste placed.' },
      { id: 'temporary_seal', title: 'Coronal Temporary Seal', prompt: 'Cavit or GIC temporary restoration, thickness, occlusal clearance.', defaultBoilerplate: 'Cotton pellet placed in pulp chamber. Sealed with minimum 3.5mm Cavit temporary restoration.' },
      { id: 'next_appointment', title: 'Next Stage & Warnings', prompt: 'Stage 2 instrumentation or obturation booking, pain advice, warning on chewing on tooth.', defaultBoilerplate: 'Patient warned of mild post-op tenderness. Instructed not to bite hard food on this tooth until crowned.' }
    ]
  },
  emergency_relief: {
    id: 'emergency_relief',
    name: 'Emergency & Relief of Pain',
    defaultAdaCodes: ['013', '022'],
    description: 'Focused emergency examination for acute dental pain, trauma, swelling, or fractured cusp.',
    sections: [
      { id: 'presenting_complaint', title: 'Presenting Complaint', prompt: 'Patient pain description, onset, duration, triggers (hot, cold, biting, spontaneous nocturnal pain).' },
      { id: 'clinical_findings', title: 'Clinical Examination & Tests', prompt: 'Tooth involved, percussion sensitivity, mobility, swelling, radiograph findings.' },
      { id: 'diagnosis', title: 'Definitive Diagnosis', prompt: 'e.g. Irreversible pulpitis, acute apical abscess, cusp fracture.' },
      { id: 'treatment_rendered', title: 'Treatment Provided Today', prompt: 'Excavation, pulp extirpation, temporary dressing, smoothing sharp cusp, prescription.' },
      { id: 'prescriptions_advice', title: 'Prescriptions & Definite Plan', prompt: 'Analgesia advice, antibiotics if indicated, follow-up appointment booked for definitive care.' }
    ]
  }
};

/**
 * Fuzzy matches PMS appointment book booking text to a clinical template
 */
export function matchTemplateFromAppointmentReason(reasonText: string): ClinicalTemplate {
  if (!reasonText || typeof reasonText !== 'string') {
    return CLINICAL_TEMPLATES.comprehensive_exam;
  }

  const clean = reasonText.toLowerCase().trim();

  // 1. Crown / Prostho
  if (clean.includes('crown') || clean.includes('bridge') || clean.includes('veneer') || clean.includes('prep') || clean.includes('scan')) {
    return CLINICAL_TEMPLATES.crown_preparation;
  }

  // 2. Endodontics / RCT
  if (clean.includes('rct') || clean.includes('root canal') || clean.includes('endo') || clean.includes('extirpation') || clean.includes('nerve')) {
    return CLINICAL_TEMPLATES.endodontic_therapy;
  }

  // 3. Restorative / Fillings
  if (/\b(fill|filling|fillings|restor|restoration|composite|caries|mod|mob|dob|modb)\b/i.test(clean) || /\b(mo|do)\b/i.test(clean)) {
    return CLINICAL_TEMPLATES.restorative_composite;
  }

  // 4. Emergency / Pain
  if (clean.includes('pain') || clean.includes('toothache') || clean.includes('emerg') || clean.includes('broken') || clean.includes('swell') || clean.includes('trauma')) {
    return CLINICAL_TEMPLATES.emergency_relief;
  }

  // 5. Default: Comprehensive Exam & Clean
  return CLINICAL_TEMPLATES.comprehensive_exam;
}

export interface DiscrepancyItem {
  id: string;
  fieldId: string;
  fieldTitle: string;
  statement: string;
  status: 'grounded' | 'template_default' | 'conflict';
  reason: string;
  suggestedAction: 'keep' | 'verify' | 'remove';
}

/**
 * Compares the exact verbatim speech transcript against the generated structured note fields.
 * Highlights:
 * - Grounded (Green): Clinical facts directly stated aloud.
 * - Template Default (Amber): Boilerplate or clinical defaults not explicitly heard.
 * - Conflict (Red/Amber Alert): Mismatch between appointment booking reason and spoken findings.
 */
export function analyzeNoteGrounding(
  verbatimTranscript: string,
  noteFields: Record<string, string>,
  appointmentReason?: string
): DiscrepancyItem[] {
  const discrepancies: DiscrepancyItem[] = [];
  const lowerTranscript = (verbatimTranscript || '').toLowerCase();

  // 1. Check Appointment Reason vs Spoken Tooth Conflict
  if (appointmentReason) {
    const bookingToothMatch = appointmentReason.match(/\b([1-4][1-8])\b/);
    if (bookingToothMatch) {
      const bookedTooth = bookingToothMatch[1];
      const spokenTeeth = Array.from(lowerTranscript.matchAll(/\b(?:tooth\s+)?([1-4][1-8])\b/g)).map(m => m[1]);
      if (spokenTeeth.length > 0 && !spokenTeeth.includes(bookedTooth)) {
        discrepancies.push({
          id: 'conflict_tooth',
          fieldId: 'appointment_conflict',
          fieldTitle: 'Tooth Discrepancy Alert',
          statement: `Booked for Tooth ${bookedTooth}, but spoken dialogue discussed Tooth ${spokenTeeth.join(', ')}.`,
          status: 'conflict',
          reason: `Appointment book shows ${bookedTooth}, but chairside speech diagnosed ${spokenTeeth.join(', ')}.`,
          suggestedAction: 'verify'
        });
      }
    }
  }

  // 2. Evaluate each section of the structured note
  for (const [key, content] of Object.entries(noteFields)) {
    if (!content || typeof content !== 'string' || content.trim().length === 0) continue;

    const sentences = content.split(/(?<=[.!?])\s+/);
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i].trim();
      if (sentence.length < 10) continue;

      const lowerSentence = sentence.toLowerCase();
      // Extract key clinical tokens (teeth, materials, numbers)
      const keywords = lowerSentence
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 4 && !['patient', 'advised', 'applied', 'checked', 'verified', 'dentine', 'normal'].includes(w));

      const matchedWords = keywords.filter(w => lowerTranscript.includes(w));
      const matchRatio = keywords.length > 0 ? matchedWords.length / keywords.length : 0;

      if (matchRatio >= 0.4 || lowerTranscript.includes(lowerSentence.substring(0, 20))) {
        discrepancies.push({
          id: `disc_${key}_${i}`,
          fieldId: key,
          fieldTitle: key.replace(/_/g, ' ').toUpperCase(),
          statement: sentence,
          status: 'grounded',
          reason: 'Verbatim evidence found in chairside audio.',
          suggestedAction: 'keep'
        });
      } else {
        // Not found in verbatim audio -> Standard template default or unstated assumption
        discrepancies.push({
          id: `disc_${key}_${i}`,
          fieldId: key,
          fieldTitle: key.replace(/_/g, ' ').toUpperCase(),
          statement: sentence,
          status: 'template_default',
          reason: 'Template default not explicitly spoken aloud chairside.',
          suggestedAction: 'verify'
        });
      }
    }
  }

  return discrepancies;
}

/**
 * Formats a verified clinical note for 1-click clipboard paste into Dental4Windows / EXACT / Cliniko.
 */
export function formatNoteForPmsClipboard(params: {
  patientName: string;
  templateName: string;
  fields: Record<string, string>;
  adaCodes: string[];
  dentistName?: string;
}): string {
  const dateStr = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });

  let text = `=====================================================\n`;
  text += `DENTAI CLINICAL EXAMINATION & PROCEDURE NOTE\n`;
  text += `Date: ${dateStr} ${timeStr} | Practitioner: ${params.dentistName || 'Dentist'}\n`;
  text += `Patient: ${params.patientName} | Procedure: ${params.templateName}\n`;
  text += `=====================================================\n\n`;

  for (const [key, val] of Object.entries(params.fields)) {
    if (!val || val.trim().length === 0) continue;
    const sectionName = key.replace(/_/g, ' ').toUpperCase();
    text += `[${sectionName}]\n${val.trim()}\n\n`;
  }

  if (params.adaCodes && params.adaCodes.length > 0) {
    text += `[ITEMISED ADA BILLING CODES]\n`;
    text += params.adaCodes.map(c => `Item ${c}`).join(', ') + `\n\n`;
  }

  text += `[CLINICAL SIGN-OFF]\n`;
  text += `Examined, verified and signed chairside by ${params.dentistName || 'Clinician'}.\n`;

  return text;
}
