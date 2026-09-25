/**
 * Dynamic Clinical Entity Parser for Australian Operatory Transcripts
 *
 * Deterministically extracts FDI tooth numbers, surfaces, anaesthetics,
 * materials, isolation methods, informed consent status, and ADA item numbers
 * in sub-millisecond execution with zero network egress.
 */

import { TranscriptItem } from '../types';
import { ExtractedClinicalVariables } from './australianClinicalMacros';
import { isValidFdiTooth } from './fdiNotationEngine';

// Surface normalization map
const SURFACE_SYNONYMS: Record<string, string> = {
  mesial: 'M',
  distal: 'D',
  occlusal: 'O',
  buccal: 'B',
  lingual: 'L',
  palatal: 'P',
  incisal: 'I',
  facial: 'F',
  cervical: 'B', // usually buccal cervical in standard charting
};

export type TranscriptInputItem = { text?: string; sender?: string };

export function parseClinicalEntities(
  input: TranscriptInputItem[] | string
): ExtractedClinicalVariables {
  const fullText = typeof input === 'string'
    ? input
    : input.map(item => item.text || '').join(' ');

  const lower = fullText.toLowerCase();

  // 1. Teeth extraction (FDI 11-48, 51-85)
  const teethSet = new Set<string>();
  // Match "tooth 16", "teeth 16, 26, 36, 46", "teeth 14 and 16", "#16"
  const teethListRegex = /\b(?:teeth|tooth|#)\s*([1-8][1-8](?:(?:\s*,\s*|\s+and\s+|\s*-\s*|\s+to\s+)[1-8][1-8])*)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = teethListRegex.exec(fullText)) !== null) {
    const listStr = match[1];
    const subMatches = listStr.match(/\b[1-8][1-8]\b/g);
    if (subMatches) {
      for (const t of subMatches) {
        const num = parseInt(t, 10);
        if (isValidFdiTooth(num)) {
          teethSet.add(String(num));
        }
      }
    }
  }

  const directToothRegex = /\b(?:tooth|teeth|#)\s*([1-8][1-8])\b/gi;
  while ((match = directToothRegex.exec(fullText)) !== null) {
    const num = parseInt(match[1], 10);
    if (isValidFdiTooth(num)) {
      teethSet.add(String(num));
    }
  }

  // Spoken word pairs: "tooth one six", "one six", "three six"
  const wordDigitMap: Record<string, string> = {
    one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8'
  };
  const spokenWordRegex = /\b(?:tooth|teeth)?\s*(one|two|three|four|five|six|seven|eight)\s+(one|two|three|four|five|six|seven|eight)\b/gi;
  while ((match = spokenWordRegex.exec(lower)) !== null) {
    const d1 = wordDigitMap[match[1]];
    const d2 = wordDigitMap[match[2]];
    if (d1 && d2) {
      const num = parseInt(`${d1}${d2}`, 10);
      if (isValidFdiTooth(num)) {
        teethSet.add(String(num));
      }
    }
  }

  // Standalone numbers in dental context (e.g., "cavity on the 16", "restoring 36")
  const contextToothRegex = /\b(?:on\s+(?:the\s+)?|restore\s+|filling\s+|extracted\s+|extracting\s+|numb\s+up\s+)([1-8][1-8])\b/gi;
  while ((match = contextToothRegex.exec(fullText)) !== null) {
    const num = parseInt(match[1], 10);
    if (isValidFdiTooth(num)) {
      teethSet.add(String(num));
    }
  }

  const teeth = [...teethSet];

  // 2. Surfaces & Tooth-Surface Pairs
  const toothSurfacePairs: { tooth: string; surface: string }[] = [];
  const surfacesSet = new Set<string>();

  // Look for combinations like "16 MO", "36 occlusal", "MO on the 16", "MOD composite"
  const surfaceCombos = ['modbl', 'modb', 'modp', 'modl', 'mod', 'mob', 'dob', 'mol', 'dol', 'mop', 'dop', 'mo', 'do', 'ob', 'ol', 'op', 'o', 'b', 'l', 'p', 'i'];
  for (const combo of surfaceCombos) {
    const upperCombo = combo.toUpperCase();
    // Pattern: tooth followed by surface e.g. "16 MO" or "#16 (MO)" or "tooth 16 occlusal"
    const toothSurfaceRegex = new RegExp(`\\b(?:#|tooth\\s+)?([1-8][1-8])\\s*\\(?\\s*${combo}\\b`, 'gi');
    while ((match = toothSurfaceRegex.exec(fullText)) !== null) {
      const t = match[1];
      if (isValidFdiTooth(parseInt(t, 10)) && !toothSurfacePairs.some(p => p.tooth === t)) {
        toothSurfacePairs.push({ tooth: t, surface: upperCombo });
        surfacesSet.add(upperCombo);
      }
    }

    // Pattern: surface before tooth e.g. "MO on 16" or "occlusal restoration on the 36"
    const surfaceToothRegex = new RegExp(`\\b${combo}\\s+(?:restoration|filling|cavity|decay|prep)?\\s*(?:on|in)?\\s*(?:the|tooth|#)?\\s*([1-8][1-8])\\b`, 'gi');
    while ((match = surfaceToothRegex.exec(fullText)) !== null) {
      const t = match[1];
      if (isValidFdiTooth(parseInt(t, 10)) && !toothSurfacePairs.some(p => p.tooth === t)) {
        toothSurfacePairs.push({ tooth: t, surface: upperCombo });
        surfacesSet.add(upperCombo);
      }
    }

    // Pattern: standalone surface combination e.g. "MODB surfaces", "on the MOD", "DO composite"
    if (new RegExp(`\\b${combo}\\s+surfaces?\\b|\\b(?:on|the)\\s+${combo}\\b|\\b${combo}\\s+(?:restoration|composite|filling)\\b`, 'i').test(lower)) {
      surfacesSet.add(upperCombo);
      if (teeth.length === 1 && !toothSurfacePairs.some(p => p.tooth === teeth[0])) {
        toothSurfacePairs.push({ tooth: teeth[0], surface: upperCombo });
      }
    }
  }

  // If surfaces mentioned without explicit pair, record them
  for (const [name, abbr] of Object.entries(SURFACE_SYNONYMS)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(lower)) {
      surfacesSet.add(abbr);
    }
  }

  // 3. Local Anaesthesia (Agent, Volume, Technique, Adrenaline)
  let anaesthetic: ExtractedClinicalVariables['anaesthetic'] = undefined;
  const laDetected = /\b(?:anaesthetic|anesthetic|numb|lignocaine|xylocaine|articaine|septanest|mepivacaine|scandonest|prilocaine|citanest|infiltration|block)\b/i.test(lower);

  if (laDetected) {
    let agent = '4% Articaine';
    if (/ligno|xylo/i.test(lower)) agent = '2% Lignocaine';
    else if (/mepivacaine|scandonest/i.test(lower)) agent = '3% Mepivacaine';
    else if (/prilocaine|citanest/i.test(lower)) agent = '3% Prilocaine';
    else if (/articaine|septanest/i.test(lower)) agent = '4% Articaine';

    let adrenaline = 'with 1:100,000 adrenaline';
    if (/1:80[,.]?000/i.test(lower) || (/ligno/i.test(agent) && !/1:100/i.test(lower))) {
      adrenaline = 'with 1:80,000 adrenaline';
    } else if (/plain|without\s+adrenaline/i.test(lower)) {
      adrenaline = 'plain';
    }

    let technique = 'infiltration';
    if (/ianb|ian\s+block|inferior\s+alveolar|mandibular\s+block/i.test(lower)) {
      technique = 'IAN block';
    } else if (/palatal/i.test(lower)) {
      technique = 'buccal & palatal infiltration';
    } else if (/mental\s+block/i.test(lower)) {
      technique = 'mental nerve block';
    } else if (/intraligamentary/i.test(lower)) {
      technique = 'intraligamentary injection';
    }

    let volumeMl = 2.2;
    const volMatch = lower.match(/(\d+(?:\.\d+)?)\s*ml\b/i);
    if (volMatch) {
      volumeMl = parseFloat(volMatch[1]);
    } else {
      const cartMatch = lower.match(/(\d+)\s*cartridge/i);
      if (cartMatch) {
        volumeMl = Math.round(parseInt(cartMatch[1], 10) * 2.2 * 10) / 10;
      }
    }

    const topical = /topical|xylo\s+gel|ointment/i.test(lower) ? 'Topical LA: xylo 5% applied' : undefined;

    anaesthetic = {
      agent,
      adrenaline,
      volumeMl,
      technique,
      topical,
      isProfound: true,
    };
  }

  // 4. Isolation
  let isolation: ExtractedClinicalVariables['isolation'] = 'Cotton roll and gauze';
  if (/rubber\s*dam|dam\s+isolation|clamp\s+#/i.test(lower)) {
    isolation = 'Rubber dam';
  } else if (/gingival\s+dam|barrier/i.test(lower)) {
    isolation = 'Gingival barrier';
  }

  // 5. Materials
  const materials: ExtractedClinicalVariables['materials'] = {};

  // Composite shade (e.g. A1, A2, A3, A3.5, B1, B2, C2)
  const shadeMatch = lower.match(/\b(?:shade\s+)?(a1|a2|a3|a3\.5|a4|b1|b2|b3|c1|c2|d2|bleach|bl2|bl3)\b/i);
  if (shadeMatch) {
    materials.compositeShade = shadeMatch[1].toUpperCase();
  }

  // Liners
  if (/dycal/i.test(lower)) materials.liner = 'Dycal';
  if (/vitrebond|vitreobond/i.test(lower)) {
    materials.liner = materials.liner ? `${materials.liner} + Vitreobond` : 'Vitreobond';
  }
  if (/biodentine/i.test(lower)) materials.liner = 'Biodentine bioactive dentine substitute';
  if (/theracal/i.test(lower)) materials.liner = 'TheraCal LC';
  if (/fuji\s*(?:ix|9|ii|2)/i.test(lower)) materials.liner = 'Fuji IX glass ionomer';

  // Sutures & Haemostats
  if (/prolene/i.test(lower)) materials.sutureType = 'Non-absorbable 3-0 Prolene suture placed';
  else if (/vicryl/i.test(lower)) materials.sutureType = 'Resorbable 4-0 Vicryl suture placed';
  else if (/silk/i.test(lower)) materials.sutureType = 'Black silk 3-0 suture placed';

  if (/gelatemp/i.test(lower)) materials.haemostaticAgent = 'Gelatemp placed';
  else if (/surgicel/i.test(lower)) materials.haemostaticAgent = 'Surgicel haemostatic pack placed';
  else if (/alveogyl/i.test(lower)) materials.haemostaticAgent = 'Alveogyl socket dressing placed';

  // Endo dressings
  if (/odontopaste/i.test(lower)) materials.dressing = 'Odontopaste dressing placed in canal orifices';
  else if (/ledermix/i.test(lower)) materials.dressing = 'Ledermix antibiotic/corticosteroid dressing placed';
  else if (/calcium\s+hydroxide|calcept/i.test(lower)) materials.dressing = 'Non-setting calcium hydroxide placed';

  if (/cavit/i.test(lower)) materials.temporisation = 'Cavit + Fuji IX';

  // 6. Informed Consent detection
  const consentObtained = /\b(?:consent|verbal\s+consent|agreed|happy\s+to\s+proceed|patient\s+agrees|informed\s+consent|discussed\s+risks)\b/i.test(lower);

  // 7. POIG / Aftercare instructions detection
  const poigDiscussed = /\b(?:poig|post[\s-]op|aftercare|soft\s+diet|avoid\s+(?:hot|rinsing|chewing)|salt\s*water|sensitivity|pain\s+relief|numbness|bite\s+on\s+gauze)\b/i.test(lower);

  // 8. Canals count
  let canalsCount: number | undefined = undefined;
  const canalMatch = lower.match(/\b([1-4])\s*canals?\b/i);
  if (canalMatch) {
    canalsCount = parseInt(canalMatch[1], 10);
  }

  // 9. Quadrants
  const quadrants: string[] = [];
  const quadMatch = lower.match(/\b(?:quadrant|quad)\s*([1-4])\b/gi);
  if (quadMatch) {
    for (const q of quadMatch) {
      quadrants.push(q.toUpperCase());
    }
  }

  // 10. Spoken ADA codes
  const spokencodes: ExtractedClinicalVariables['spokencodes'] = [];
  const adaRegex = /\b(?:ada|item|code)\s*(?:items|item|number|no\.?)?\s*[:#]?\s*([0-9]{3})\b/gi;
  while ((match = adaRegex.exec(fullText)) !== null) {
    const code = match[1];
    if (!spokencodes.some(c => c.code === code)) {
      spokencodes.push({ code, description: `Item ${code} spoken` });
    }
  }

  // 11. Chief Complaint & Presenting Symptoms
  let complaint: string | undefined = undefined;
  if (/(?:pain|ache|toothache|sensitive|sensitivity|broken|chipped|lost\s+filling|crack|food\s+packing|can't\s+sleep|couldn't\s+sleep|sleep\s+last\s+night|moving|wobbly)/i.test(lower)) {
    const complaintParts: string[] = [];
    if (/sensitive\s+to\s+(?:cold|hot|sweet|ice)/i.test(lower)) {
      complaintParts.push('Sensitivity to thermal stimuli (cold/sweet)');
    } else if (/sensitive|sensitivity/i.test(lower)) {
      complaintParts.push('Mild sensitivity reported');
    }
    if (/throbbing|sharp\s+pain|dull\s+ache|toothache|severe|terrible|awful/i.test(lower)) {
      complaintParts.push('Severe acute localised toothache reported');
    }
    if (/can't\s+sleep|couldn't\s+sleep|unable\s+to\s+sleep|waking\s+at\s+night|sleep\s+last\s+night/i.test(lower)) {
      complaintParts.push('Pain severe enough to disrupt sleep overnight');
    }
    if (/moving|wobbly|loose\s+tooth/i.test(lower)) {
      complaintParts.push('Tooth reported mobile and wobbly');
    }
    if (/broken|chipped|fracture/i.test(lower)) {
      complaintParts.push('Patient reported broken/chipped tooth');
    }
    if (/lost\s+filling/i.test(lower)) {
      complaintParts.push('Lost previous restoration');
    }
    if (complaintParts.length > 0) {
      complaint = complaintParts.join('. ') + '.';
    }
  } else if (/routine\s+(?:checkup|exam|clean)|check\s*up/i.test(lower)) {
    complaint = 'Routine examination and clean; no acute pain reported.';
  }

  // 12. Medical & Social History (Pharmacology & Systemic Conditions)
  let history: string | undefined = undefined;
  const historyParts: string[] = [];

  // Anticoagulant / bleeding risk
  if (/warfarin/i.test(lower)) {
    historyParts.push('Medication: Warfarin (blood thinner) - increased bleeding risk, GP consultation/INR check required prior to any future surgical procedure');
  } else if (/blood\s+thinner|anticoagulant|apixaban|eliquis|xarelto|rivaroxaban|dabigatran|clopidogrel/i.test(lower)) {
    historyParts.push('Medication: Anticoagulant / blood thinner noted - bleeding risk assessed');
  }

  // Antiresorptive / bone modifying agents (MRONJ Risk)
  if (/denosuma[b]?|prolia|osteoporosis(?:\s+(?:injection|medication))?|for\s+(?:the\s+)?osteoporosis/i.test(lower)) {
    historyParts.push('Medication: Denosumab (Prolia / osteoporosis antiresorptive) - high MRONJ risk; surgical extraction contraindicated without GP clearance');
  } else if (/bisphosphonate|alendronate|fosamax|zoledron/i.test(lower)) {
    historyParts.push('Medication: Antiresorptive / bisphosphonate therapy noted - MRONJ risk');
  }

  // Systemic conditions
  if (/hypertension|high\s+blood\s+pressure/i.test(lower)) {
    historyParts.push('Hypertension');
  }
  if (/heart\s+disease|cardiac/i.test(lower)) {
    historyParts.push('Heart disease');
  }

  if (/no\s+medical\s+(?:issues|conditions|history)|fit\s+and\s+well/i.test(lower)) {
    historyParts.push('Medical history: Fit and well; nil significant medical conditions');
  } else if (/medical\s+history/i.test(lower) && historyParts.length === 0) {
    historyParts.push('Medical history reviewed and confirmed with patient');
  }

  if (/allerg(?:y|ies)|penicillin|latex/i.test(lower)) {
    const allergyMatch = lower.match(/(?:allergy|allergic)\s+to\s+([a-z\s]+?)(?:\.|,|$)/i);
    if (allergyMatch) {
      historyParts.push(`Known allergy: ${allergyMatch[1].trim()}`);
    } else if (/no\s+allergies|nkda/i.test(lower)) {
      historyParts.push('NKDA (No known drug allergies)');
    }
  }
  if (/non[- ]smoker/i.test(lower)) {
    historyParts.push('Non-smoker');
  } else if (/smok(?:er|ing)/i.test(lower)) {
    historyParts.push('Smoker');
  }
  if (historyParts.length > 0) {
    history = historyParts.join('; ') + '.';
  }

  return {
    teeth,
    surfaces: [...surfacesSet],
    toothSurfacePairs,
    anaesthetic,
    isolation,
    materials,
    consentObtained,
    poigDiscussed,
    canalsCount,
    quadrants,
    complaint,
    history,
    spokencodes,
  };
}

