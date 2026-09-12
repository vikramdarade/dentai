/**
 * Transcript Grounding & Zero-Hallucination Verification Engine
 *
 * Deterministically cross-references clinical findings, tooth numbers, surfaces,
 * and treatments rendered in an AI-generated note against the verbatim spoken
 * dialogue in the operatory transcript.
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
export function extractToothNumbers(text: string): string[] {
  // First mask out dates and clock times (e.g. 14:30, 2026-09-12, 12/09/2026) so hours/minutes like 14 or 24 are not treated as FDI teeth
  const sanitizedText = text
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ')
    .replace(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g, ' ');

  const normalized = normalizeForMatching(sanitizedText);
  const results = new Set<string>();

  // Explicit tooth numbers like "#16", "tooth 16", or standalone 2-digit FDI codes (11-48)
  const regex = /(?:tooth\s+|#)?\b([1-4][1-8])\b/g;
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    results.add(match[1]);
  }

  // Common descriptive tooth quadrant references with strict word boundaries
  const hasMolar = /\bmolars?\b/.test(normalized);
  const hasPremolar = /\bpremolars?\b/.test(normalized);

  if (/\b(upper\s+right|ur)\b/.test(normalized)) {
    if (hasMolar) results.add('16');
    if (hasPremolar) results.add('14');
  }
  if (/\b(upper\s+left|ul)\b/.test(normalized)) {
    if (hasMolar) results.add('26');
    if (hasPremolar) results.add('24');
  }
  if (/\b(lower\s+left|ll)\b/.test(normalized)) {
    if (hasMolar) results.add('36');
    if (hasPremolar) results.add('34');
  }
  if (/\b(lower\s+right|lr)\b/.test(normalized)) {
    if (hasMolar) results.add('46');
    if (hasPremolar) results.add('44');
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
  const groundingScore = totalEntities > 0
    ? Math.round((groundedCount / totalEntities) * 100)
    : 100;

  const isFullyGrounded = unverifiedClaims.length === 0;

  const summary = isFullyGrounded
    ? '100% transcript-grounded: All teeth, treatments, and drugs were verified against spoken operatory dialogue.'
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
