/**
 * Transcript Grounding Verification Engine
 *
 * Cross-references the teeth, surfaces, drugs and treatments in an AI-generated
 * note against what was actually said in the operatory transcript.
 *
 * On the limits of this module, because the UI turns its output into a trust
 * badge: it is a keyword cross-check, not a proof. It can only find claims it
 * recognises, so "no unverified claims" means "nothing recognisable was
 * contradicted", not "everything in this note is true". It is written to fail in
 * the safe direction — an unrecognisable note reports as needing review rather
 * than as verified — and every extraction rule below is deliberately biased
 * against inventing a finding, because a false positive here actively clears a
 * hallucinated tooth as though the audio had confirmed it.
 */

export interface GroundingEntity {
  category: 'tooth' | 'procedure' | 'surface' | 'anaesthetic' | 'diagnosis';
  term: string;
  foundInTranscript: boolean;
  transcriptLineIndex?: number;
  matchedText?: string;
}

export interface GroundingReport {
  groundingScore: number; // 0 to 100
  isFullyGrounded: boolean;
  groundedEntities: string[];
  unverifiedClaims: string[];
  entityDetails: GroundingEntity[];
  summary: string;
}

export interface TranscriptUtterance {
  sender: string;
  text: string;
  timestamp?: string;
}

// Common Australian dental anaesthetics
const DENTAL_DRUGS = [
  'scandonest', 'lignocaine', 'lidocaine', 'articaine', 'septanest',
  'mepivacaine', 'prilocaine', 'citanest', 'adrenaline', 'epinephrine',
  'topical', 'infiltration', 'id block', 'inferior dental block'
];

// Common clinical procedures
const DENTAL_PROCEDURES = [
  'composite', 'amalgam', 'filling', 'restoration', 'crown', 'ceramic',
  'bridge', 'veneer', 'root canal', 'extirpation', 'instrumentation',
  'obturation', 'extraction', 'elevated', 'luxated', 'forceps',
  'scale and clean', 'prophylaxis', 'calculus', 'fluoride', 'bitewing',
  'periapical', 'radiograph', 'x-ray', 'fissure sealant', 'rubber dam'
];

// Surfaces (FDI / Australian convention)
const DENTAL_SURFACES = [
  'mesial', 'distal', 'occlusal', 'buccal', 'lingual', 'palatal', 'incisal',
  'mo', 'do', 'mod', 'modbl', 'ob', 'ol', 'mb', 'db'
];

// Common Australian Dental Association codes to spoken keyword mappings
const COMMON_ADA_TERMS: Record<string, string[]> = {
  '011': ['exam', 'comprehensive', 'check'],
  '012': ['exam', 'periodic', 'check'],
  '022': ['bitewing', 'periapical', 'radiograph', 'x-ray'],
  '114': ['scale', 'clean', 'calculus', 'prophy'],
  '121': ['fluoride'],
  '161': ['fissure', 'sealant'],
  '311': ['extract', 'extraction', 'elevat', 'luxat', 'forceps'],
  '414': ['extirpation', 'pulp', 'root canal', 'rct'],
  '417': ['instrumentation', 'root canal', 'canal'],
  '531': ['composite', 'filling', 'restoration', 'resin'],
  '532': ['composite', 'filling', 'restoration', 'resin'],
  '533': ['composite', 'filling', 'restoration', 'resin'],
  '611': ['crown', 'ceramic', 'prep'],
  '615': ['crown', 'pfm']
};

/**
 * Normalizes text for fuzzy token matching
 */
function normalizeForMatching(text: string): string {
  return text.toLowerCase()
    .replace(/[^a-z0-9#\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts 2-digit FDI tooth numbers (e.g. 16, 24, 36, 48) and tooth mentions (#16, tooth 16, upper right first molar)
 */
/**
 * Surfaces that may follow a bare FDI number as tooth notation ("16 MOD").
 *
 * Only combinations that are not ordinary English are accepted. Two-letter
 * surfaces like "do" and "mo" are extremely common words, and reading "...aged
 * 24. Do you..." as tooth 24 is precisely the false positive this verifier is
 * supposed to catch, so they are excluded.
 */
const TOOTH_NOTATION_SURFACES = 'modbl|mod|mob|dob|ob|ol|mb|db|ml|dl|mi';

/**
 * A quadrant phrase followed, within the same clause, by a tooth type.
 *
 * Word-boundary matching is essential. The previous `includes('ur')` test also
 * matched "your", "sure", "during" and "burn" — so "your lower left molar"
 * invented an upper-right molar (tooth 16) out of the word "your".
 */
const QUADRANT_TOOTH_PATTERN =
  /\b(upper right|upper left|lower left|lower right|maxillary right|maxillary left|mandibular right|mandibular left|ur|ul|ll|lr)\b[^.]{0,40}?\b(molars?|premolars?)\b/g;

const QUADRANT_FDI: Record<string, { molar: string; premolar: string }> = {
  'upper right': { molar: '16', premolar: '14' },
  ur: { molar: '16', premolar: '14' },
  'maxillary right': { molar: '16', premolar: '14' },
  'upper left': { molar: '26', premolar: '24' },
  ul: { molar: '26', premolar: '24' },
  'maxillary left': { molar: '26', premolar: '24' },
  'lower left': { molar: '36', premolar: '34' },
  ll: { molar: '36', premolar: '34' },
  'mandibular left': { molar: '36', premolar: '34' },
  'lower right': { molar: '46', premolar: '44' },
  lr: { molar: '46', premolar: '44' },
  'mandibular right': { molar: '46', premolar: '44' }
};

/**
 * Extracts 2-digit FDI tooth numbers (11-18, 21-28, 31-38, 41-48).
 *
 * Deliberately conservative. A bare 2-digit number is not a tooth: "see you in
 * 16 weeks", "24 hours", "age 36" and "45 minutes" all read as FDI codes to a
 * naive match. That mattered because the same loose rule ran over both the note
 * and the transcript, so an incidental number in the conversation could ground a
 * fabricated tooth in the note. A number is only read as a tooth when the text
 * says so: an explicit introducer ("tooth 16", "#16", "FDI 24"), FDI notation
 * with a surface ("16 MOD"), or a quadrant phrase ("upper right molar").
 *
 * Recall is intentionally traded for precision — a missed tooth simply does not
 * appear in the report, whereas an invented one can certify treatment that was
 * never discussed.
 */
export function extractToothNumbers(text: string): string[] {
  const normalized = normalizeForMatching(text);
  const results = new Set<string>();
  let match;

  // Explicit introducers: "tooth 16", "teeth 24", "FDI 36", "#48".
  const explicit = /(?:tooth|teeth|fdi|#)\s*#?\s*([1-4][1-8])\b/g;
  while ((match = explicit.exec(normalized)) !== null) {
    results.add(match[1]);
  }

  // FDI notation carrying a surface suffix: "16 MOD", "24 ob".
  const withSurface = new RegExp(`\\b([1-4][1-8])\\s*(?:${TOOTH_NOTATION_SURFACES})\\b`, 'g');
  while ((match = withSurface.exec(normalized)) !== null) {
    results.add(match[1]);
  }

  // Quadrant phrases: quadrant and tooth type must share a clause.
  QUADRANT_TOOTH_PATTERN.lastIndex = 0;
  while ((match = QUADRANT_TOOTH_PATTERN.exec(normalized)) !== null) {
    const mapping = QUADRANT_FDI[match[1]];
    if (!mapping) continue;
    results.add(match[2].startsWith('premolar') ? mapping.premolar : mapping.molar);
  }

  return Array.from(results);
}

/**
 * Cross-references clinical notes against spoken transcript utterances
 */
export function verifyTranscriptGrounding(
  noteText: string,
  transcript: TranscriptUtterance[],
  adaCodes?: any[]
): GroundingReport {
  const fullTranscriptText = transcript.map(t => `${t.sender}: ${t.text}`).join(' ');
  const normalizedTranscript = normalizeForMatching(fullTranscriptText);
  const normalizedNote = normalizeForMatching(noteText);

  const entities: GroundingEntity[] = [];

  // 1. Verify Teeth
  const noteTeeth = extractToothNumbers(noteText);
  const transcriptTeeth = new Set(extractToothNumbers(fullTranscriptText));

  for (const tooth of noteTeeth) {
    const found = transcriptTeeth.has(tooth);
    entities.push({
      category: 'tooth',
      term: `Tooth #${tooth}`,
      foundInTranscript: found,
      matchedText: found ? `Tooth #${tooth} mentioned in transcript` : undefined
    });
  }

  // 2. Verify Drugs / Local Anaesthetics
  for (const drug of DENTAL_DRUGS) {
    if (normalizedNote.includes(drug)) {
      const found = normalizedTranscript.includes(drug);
      entities.push({
        category: 'anaesthetic',
        term: drug.charAt(0).toUpperCase() + drug.slice(1),
        foundInTranscript: found,
        matchedText: found ? drug : undefined
      });
    }
  }

  // 3. Verify Procedures
  for (const proc of DENTAL_PROCEDURES) {
    if (normalizedNote.includes(proc)) {
      const found = normalizedTranscript.includes(proc);
      entities.push({
        category: 'procedure',
        term: proc.charAt(0).toUpperCase() + proc.slice(1),
        foundInTranscript: found,
        matchedText: found ? proc : undefined
      });
    }
  }

  // 4. Verify ADA codes if provided
  if (Array.isArray(adaCodes) && adaCodes.length > 0) {
    for (const item of adaCodes) {
      const codeStr = typeof item === 'string' ? item : item?.code || '';
      const cleanCode = codeStr.replace(/[^0-9]/g, '');
      if (cleanCode.length === 3) {
        // Check if the 3-digit code was spoken, or if its associated procedure was spoken
        const codeSpoken = normalizedTranscript.includes(cleanCode);
        const desc = typeof item === 'object' ? item.description?.toLowerCase() : '';
        const descSpoken = desc ? desc.split(' ').some((word: string) => word.length > 4 && normalizedTranscript.includes(word)) : false;
        const keywords = COMMON_ADA_TERMS[cleanCode] || [];
        const keywordSpoken = keywords.some(kw => normalizedTranscript.includes(kw));

        const found = codeSpoken || descSpoken || keywordSpoken;
        entities.push({
          category: 'procedure',
          term: `ADA Item ${cleanCode}`,
          foundInTranscript: found,
          matchedText: found ? `Code ${cleanCode}` : undefined
        });
      }
    }
  }

  // 4. Verify surfaces. Full words only: the two-letter surfaces (MO, DO, OB)
  //    collide with ordinary English and would manufacture findings.
  for (const surface of DENTAL_SURFACES) {
    if (surface.length < 5) continue;
    const rx = new RegExp(`\\b${surface}\\b`);
    if (!rx.test(normalizedNote)) continue;
    const found = rx.test(normalizedTranscript);
    entities.push({
      category: 'surface',
      term: surface.charAt(0).toUpperCase() + surface.slice(1),
      foundInTranscript: found,
      matchedText: found ? surface : undefined
    });
  }

  // A note with nothing recognisable in it has not been verified. Reporting 100%
  // here told the clinician a bare note had been cross-checked against the audio
  // when there was nothing to check, and it suppressed the needs-review flag
  // (isFullyGrounded drives noteOrigin.needsReview). Unverifiable is the unsafe
  // direction, so it is reported as needing review.
  if (entities.length === 0) {
    return {
      groundingScore: 0,
      isFullyGrounded: false,
      groundedEntities: [],
      unverifiedClaims: [],
      entityDetails: [],
      summary:
        'Nothing in this note could be cross-checked against the conversation (no teeth, treatments, drugs or surfaces were recognised). Review it before saving.'
    };
  }

  // Compile scores and unverified items
  const groundedEntities: string[] = [];
  const unverifiedClaims: string[] = [];

  for (const e of entities) {
    if (e.foundInTranscript) {
      groundedEntities.push(e.term);
    } else {
      unverifiedClaims.push(e.term);
    }
  }

  const totalEntities = entities.length;
  const groundedCount = groundedEntities.length;
  const groundingScore = Math.round((groundedCount / totalEntities) * 100);

  const isFullyGrounded = unverifiedClaims.length === 0;

  const summary = isFullyGrounded
    ? `Grounded in the conversation: all ${totalEntities} recognised item(s) were traced back to what was said.`
    : `Attention: ${unverifiedClaims.length} item(s) in note were not explicitly spoken in operatory dialogue (${unverifiedClaims.join(', ')}).`;

  return {
    groundingScore,
    isFullyGrounded,
    groundedEntities,
    unverifiedClaims,
    entityDetails: entities,
    summary
  };
}
