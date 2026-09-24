/**
 * ISO 3950 / FDI Two-Digit Notation & Dental Surface Engine
 *
 * Implements strict compliance with ISO 3950 international dental numbering standard:
 * - Permanent Dentition: Quadrants 1 to 4, tooth positions 1 to 8 (FDI 11–18, 21–28, 31–38, 41–48)
 * - Deciduous (Primary) Dentition: Quadrants 5 to 8, tooth positions 1 to 5 (FDI 51–55, 61–65, 71–75, 81–85)
 * - Anatomical Surface Matrix: Strict anterior (I, M, D, B/F, L/P) vs posterior (O, M, D, B, L/P) validation
 * - Spoken Operatory Phonetics & Syntax Disambiguation
 */

export type DentitionType = 'permanent' | 'deciduous';
export type DentalJaw = 'maxillary' | 'mandibular';
export type DentalSide = 'right' | 'left';

export interface ToothMetadata {
  fdi: number;
  dentition: DentitionType;
  quadrant: number;
  position: number;
  jaw: DentalJaw;
  side: DentalSide;
  name: string;
  quadrantName: string;
  isAnterior: boolean;
  isPosterior: boolean;
  validSurfaces: string[];
}

export interface SurfaceValidationResult {
  isValid: boolean;
  tooth: number;
  surfaces: string[];
  canonicalSurfaceString: string;
  surfaceCount: number;
  errors: string[];
}

export interface SpokenToothDisambiguation {
  raw: string;
  teeth: number[];
  confidence: number;
  ambiguous: boolean;
  ambiguityReason?: string;
  clarificationPrompt?: string;
}

// Permanent teeth: Quadrants 1-4, positions 1-8
export const PERMANENT_FDI_TEETH = new Set<number>([
  11, 12, 13, 14, 15, 16, 17, 18,
  21, 22, 23, 24, 25, 26, 27, 28,
  31, 32, 33, 34, 35, 36, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48
]);

// Deciduous teeth: Quadrants 5-8, positions 1-5
export const DECIDUOUS_FDI_TEETH = new Set<number>([
  51, 52, 53, 54, 55,
  61, 62, 63, 64, 65,
  71, 72, 73, 74, 75,
  81, 82, 83, 84, 85
]);

const TOOTH_POSITION_NAMES: Record<number, string> = {
  1: 'Central Incisor',
  2: 'Lateral Incisor',
  3: 'Canine',
  4: 'First Premolar',
  5: 'Second Premolar',
  6: 'First Molar',
  7: 'Second Molar',
  8: 'Third Molar'
};

const DECIDUOUS_POSITION_NAMES: Record<number, string> = {
  1: 'Primary Central Incisor',
  2: 'Primary Lateral Incisor',
  3: 'Primary Canine',
  4: 'Primary First Molar',
  5: 'Primary Second Molar'
};

const QUADRANT_NAMES: Record<number, { jaw: DentalJaw; side: DentalSide; label: string }> = {
  1: { jaw: 'maxillary', side: 'right', label: 'Upper Right (UR)' },
  2: { jaw: 'maxillary', side: 'left', label: 'Upper Left (UL)' },
  3: { jaw: 'mandibular', side: 'left', label: 'Lower Left (LL)' },
  4: { jaw: 'mandibular', side: 'right', label: 'Lower Right (LR)' },
  5: { jaw: 'maxillary', side: 'right', label: 'Upper Right Primary' },
  6: { jaw: 'maxillary', side: 'left', label: 'Upper Left Primary' },
  7: { jaw: 'mandibular', side: 'left', label: 'Lower Left Primary' },
  8: { jaw: 'mandibular', side: 'right', label: 'Lower Right Primary' }
};

/**
 * Validates whether a number or string represents a valid ISO 3950 / FDI tooth code.
 */
export function isValidFdiTooth(tooth: number | string): boolean {
  const num = typeof tooth === 'string' ? parseInt(tooth.trim(), 10) : tooth;
  if (isNaN(num)) return false;
  return PERMANENT_FDI_TEETH.has(num) || DECIDUOUS_FDI_TEETH.has(num);
}

/**
 * Returns comprehensive anatomical and clinical metadata for any FDI tooth code.
 */
export function getToothMetadata(tooth: number | string): ToothMetadata {
  const num = typeof tooth === 'string' ? parseInt(tooth.trim(), 10) : tooth;
  if (!isValidFdiTooth(num)) {
    throw new Error(`Invalid FDI tooth number '${tooth}'. Must be ISO 3950 (11-48 permanent, 51-85 deciduous).`);
  }

  const quadrant = Math.floor(num / 10);
  const position = num % 10;
  const isDeciduous = quadrant >= 5 && quadrant <= 8;
  const dentition: DentitionType = isDeciduous ? 'deciduous' : 'permanent';

  const quadMeta = QUADRANT_NAMES[quadrant];
  const name = isDeciduous
    ? `${quadMeta.label} ${DECIDUOUS_POSITION_NAMES[position]}`
    : `${quadMeta.label} ${TOOTH_POSITION_NAMES[position]}`;

  // Anterior: Incisors (1, 2) and Canines (3)
  // Posterior: Premolars (4, 5 in permanent) and Molars (6, 7, 8 in permanent; 4, 5 in primary)
  const isAnterior = position <= 3;
  const isPosterior = !isAnterior;

  // Anterior surfaces: Incisal (I), Mesial (M), Distal (D), Labial/Facial/Buccal (B/F/La), Lingual/Palatal (L/P)
  // Posterior surfaces: Occlusal (O), Mesial (M), Distal (D), Buccal (B), Lingual/Palatal (L/P)
  const validSurfaces = isAnterior
    ? ['I', 'M', 'D', 'B', 'F', 'L', 'P', 'LA']
    : ['O', 'M', 'D', 'B', 'L', 'P'];

  return {
    fdi: num,
    dentition,
    quadrant,
    position,
    jaw: quadMeta.jaw,
    side: quadMeta.side,
    name,
    quadrantName: quadMeta.label,
    isAnterior,
    isPosterior,
    validSurfaces
  };
}

/**
 * Surface code canonicalization map.
 */
const SURFACE_SYNONYMS: Record<string, string> = {
  M: 'M',
  MESIAL: 'M',
  D: 'D',
  DISTAL: 'D',
  O: 'O',
  OCCLUSAL: 'O',
  I: 'I',
  INCISAL: 'I',
  B: 'B',
  BUCCAL: 'B',
  F: 'B', // Facial is normalized to Buccal/Labial convention
  FACIAL: 'B',
  LA: 'B',
  LABIAL: 'B',
  L: 'L',
  LINGUAL: 'L',
  P: 'P',
  PALATAL: 'P'
};

// Preferred clinical presentation order: M -> O/I -> D -> B -> L/P (e.g. MOD, MODB, MID, etc.)
const SURFACE_SORT_ORDER: Record<string, number> = {
  M: 1,
  O: 2,
  I: 2,
  D: 3,
  B: 4,
  L: 5,
  P: 5
};

/**
 * Validates dental surfaces against tooth position according to clinical anatomical rules:
 * - Reject Occlusal (O) on anterior teeth (e.g. tooth 11, 21, 31, 41)
 * - Reject Incisal (I) on posterior teeth (e.g. tooth 16, 26, 36, 46)
 */
export function parseAndValidateSurfaces(
  tooth: number | string,
  surfacesInput: string | string[]
): SurfaceValidationResult {
  const num = typeof tooth === 'string' ? parseInt(tooth.trim(), 10) : tooth;
  if (!isValidFdiTooth(num)) {
    return {
      isValid: false,
      tooth: num || 0,
      surfaces: [],
      canonicalSurfaceString: '',
      surfaceCount: 0,
      errors: [`Invalid FDI tooth number '${tooth}'.`]
    };
  }

  const meta = getToothMetadata(num);
  const errors: string[] = [];

  // Parse input into discrete tokens
  const rawTokens: string[] = [];
  if (Array.isArray(surfacesInput)) {
    surfacesInput.forEach(s => rawTokens.push(...s.split(/[\s,\-]+/)));
  } else if (typeof surfacesInput === 'string') {
    const trimmed = surfacesInput.trim();
    // If it's a concatenated surface string like "MOD", "DO", "MO", "MODBL", split into characters
    if (/^[A-Za-z]{1,6}$/.test(trimmed) && !trimmed.toLowerCase().includes('lingual') && !trimmed.toLowerCase().includes('mesial')) {
      rawTokens.push(...trimmed.split(''));
    } else {
      rawTokens.push(...trimmed.split(/[\s,\-]+/));
    }
  }

  const canonicalSurfacesSet = new Set<string>();

  for (const token of rawTokens) {
    const clean = token.toUpperCase().trim();
    if (!clean) continue;

    const canonical = SURFACE_SYNONYMS[clean];
    if (!canonical) {
      errors.push(`Unrecognized dental surface '${token}'. Valid surfaces are M, O, D, B, I, L, P.`);
      continue;
    }

    // Anatomical validation check
    if (meta.isAnterior && canonical === 'O') {
      errors.push(
        `Clinical Conflict: Tooth ${num} is an anterior tooth (${meta.name}) and does not have an occlusal surface. Use incisal (I).`
      );
    } else if (meta.isPosterior && canonical === 'I') {
      errors.push(
        `Clinical Conflict: Tooth ${num} is a posterior tooth (${meta.name}) and does not have an incisal edge. Use occlusal (O).`
      );
    } else {
      canonicalSurfacesSet.add(canonical);
    }
  }

  const sortedSurfaces = Array.from(canonicalSurfacesSet).sort(
    (a, b) => (SURFACE_SORT_ORDER[a] || 99) - (SURFACE_SORT_ORDER[b] || 99)
  );

  const canonicalSurfaceString = sortedSurfaces.join('');

  return {
    isValid: errors.length === 0 && sortedSurfaces.length > 0,
    tooth: num,
    surfaces: sortedSurfaces,
    canonicalSurfaceString,
    surfaceCount: sortedSurfaces.length,
    errors
  };
}

/**
 * Spoken number words mapping to single digits.
 */
const SPOKEN_DIGIT_MAP: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  tree: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8
};

const SPOKEN_TEEN_MAP: Record<string, number> = {
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18
};

/**
 * Disambiguates spoken natural language tooth descriptions into verified FDI codes:
 * - "tooth one six" -> [16]
 * - "teeth one six and one seven" -> [16, 17]
 * - "teeth one, six" -> flags ambiguity between single tooth 16 vs teeth 11 and 16
 * - "tooth sixteen" -> [16] with disambiguation notice
 */
export function disambiguateSpokenTooth(phrase: string): SpokenToothDisambiguation {
  if (!phrase || !phrase.trim()) {
    return { raw: '', teeth: [], confidence: 0, ambiguous: false };
  }

  const text = phrase.toLowerCase().trim();

  // 1. Check for ambiguous list like "teeth one, six" or "teeth 1, 6"
  if (/\bteeth\s+(?:one|[1-8])\s*,\s*(?:six|[1-8])\b/i.test(text)) {
    return {
      raw: phrase,
      teeth: [16],
      confidence: 0.5,
      ambiguous: true,
      ambiguityReason: 'Ambiguous phrasing: "teeth one, six" may mean FDI tooth 16 or separate teeth.',
      clarificationPrompt: 'Did you mean tooth 16 (upper right first molar) or separate teeth?'
    };
  }

  // 2. Direct FDI digit-pair spoken sequences e.g. "one six", "tooth one six", "four seven"
  const digitPairRegex = /\b(?:tooth|teeth)?\s*([1-8])\s*([1-8])\b/g;
  const foundTeeth: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = digitPairRegex.exec(text)) !== null) {
    const fdi = parseInt(`${match[1]}${match[2]}`, 10);
    if (isValidFdiTooth(fdi) && !foundTeeth.includes(fdi)) {
      foundTeeth.push(fdi);
    }
  }

  if (foundTeeth.length > 0) {
    return {
      raw: phrase,
      teeth: foundTeeth,
      confidence: 0.98,
      ambiguous: false
    };
  }

  // 3. Spoken word pairs: "one six", "three six", "two four", "dirty tree"
  const wordPairRegex = /\b(one|two|three|tree|four|five|six|seven|eight)\s+(one|two|three|tree|four|five|six|seven|eight)\b/g;
  while ((match = wordPairRegex.exec(text)) !== null) {
    const d1 = SPOKEN_DIGIT_MAP[match[1]];
    const d2 = SPOKEN_DIGIT_MAP[match[2]];
    if (d1 && d2) {
      const fdi = d1 * 10 + d2;
      if (isValidFdiTooth(fdi) && !foundTeeth.includes(fdi)) {
        foundTeeth.push(fdi);
      }
    }
  }

  if (foundTeeth.length > 0) {
    return {
      raw: phrase,
      teeth: foundTeeth,
      confidence: 0.95,
      ambiguous: false
    };
  }

  // 4. Accent special: "dirty tree" -> 33
  if (/\b(?:dirty|tree)\s*tree\b/.test(text)) {
    return {
      raw: phrase,
      teeth: [33],
      confidence: 0.95,
      ambiguous: false
    };
  }

  // 5. Cardinal teen: "tooth sixteen", "tooth fourteen"
  const teenMatch = text.match(/\b(?:tooth\s+)?(eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen)\b/);
  if (teenMatch) {
    const fdi = SPOKEN_TEEN_MAP[teenMatch[1]];
    if (fdi && isValidFdiTooth(fdi)) {
      return {
        raw: phrase,
        teeth: [fdi],
        confidence: 0.88,
        ambiguous: false
      };
    }
  }

  // 6. Direct numeric FDI e.g. "tooth 16"
  const directNumMatch = text.match(/\btooth\s+([1-8][1-8])\b/);
  if (directNumMatch) {
    const fdi = parseInt(directNumMatch[1], 10);
    if (isValidFdiTooth(fdi)) {
      return {
        raw: phrase,
        teeth: [fdi],
        confidence: 0.99,
        ambiguous: false
      };
    }
  }

  return {
    raw: phrase,
    teeth: [],
    confidence: 0,
    ambiguous: false
  };
}
