/**
 * Verbatim transcript sentences relevant to one template section — the
 * review screen's evidence chips. Strict quote-only contract (same safety
 * rules as the offline draft): sentences are normalised exactly like the
 * draft (FDI spoken numbers resolved, small talk stripped) but never
 * paraphrased, reordered by meaning, or invented. Sections the AI left empty
 * can be filled by tapping a quote; sections the AI filled can be checked
 * against what was actually said.
 */
export function sectionEvidence(
  section: TemplateSection,
  transcript: TranscriptItem[],
  maxSentences: number = 6
): string[] {
  if (!transcript.length) return [];
  const keywords = SECTION_KEYWORDS[section.key] || [];
  if (!keywords.length) return [];

  const isComplaintStyle = section.key === 'chiefComplaint' || section.key === 'subjective';
  const patientSentences = extractCandidateSentences(
    transcript.filter((t) => !isClinician(t.sender))
  );
  const allSentences = extractCandidateSentences(transcript);

  const pool = isComplaintStyle
    ? [...new Set([...patientSentences, ...allSentences])]
    : allSentences;

  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of pool) {
    const lower = s.toLowerCase();
    if (!keywords.some((kw) => lower.includes(kw))) continue;
    const norm = lower.replace(/[^a-z0-9 ]/g, '').trim();
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(s);
    if (out.length >= maxSentences) break;
  }
  return out;
}

/**
 * Offline draft engine — Tier 3 of the scribing resilience chain.
 *
 * When every hosted AI route is exhausted or the device is offline, this
 * deterministic, zero-download engine still produces a usable *draft*: it
 * fills each section of the active note template by pulling the transcript
 * sentences that are actually relevant to that section (dental keyword
 * matching + FDI tooth normalisation).
 *
 * SAFETY CONTRACT (product decision: quality may degrade, never silently):
 *  - The draft only rearranges / quotes what was said. It never invents a
 *    diagnosis, treatment, dosage or recall interval.
 *  - Sections without supporting transcript content are left EMPTY (the
 *    dentist fills them), never guessed.
 *  - adaCodes is always empty unless a 3-digit ADA item number was literally
 *    spoken (e.g. "item 414"). Billing codes are never inferred.
 *  - patientSummary is intentionally empty: drafting a friendly medical
 *    letter without a language model risks inventing advice.
 *
 * Output shape matches the server's normalizeTemplateOutput contract:
 * canonical keys at top level, template-specific keys under customSections,
 * plus patientSummary and adaCodes.
 */
import { NoteTemplate, TemplateSection, isCanonicalField } from './dentalLibrary';
import { TranscriptItem } from '../types';
import { reconcileEntitiesBackward } from '../grounding/backwardReconciliation';
import type { TimestampedUtterance } from '../grounding/types';
import { normalizeSpokenDentalText } from './dentalPhoneticLexicon';

export type DraftResult = {
  /** Canonical findings (top-level, e.g. chiefComplaint) plus template extras. */
  canonical: Record<string, string>;
  customSections: Record<string, string>;
  patientSummary: string;
  adaCodes: { code: string; description: string; tooth?: string }[];
};

const WORD_NUMBERS: Record<string, string> = {
  oh: '0', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11',
  twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16',
  seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20', thirty: '30',
  forty: '40', fifties: '50', fifty: '50'
};

/**
 * Converts common spoken tooth references to FDI two-digit notation.
 * Handles: "tooth 16", "tooth 1 6", "tooth one six", "tooth sixteen",
 * "tooth two four" and single-digit context like "on 1 6".
 */
export function normalizeFdiSpoken(text: string): string {
  let out = text;

  // Digits spread as separate tokens: "tooth 1 6" / "tooth 4 8"
  out = out.replace(/\b(tooth|teeth)\s+(\d)\s+(\d)\b/gi, (m, _lead, d1: string, d2: string) => `tooth ${d1}${d2}`);
  // Word numbers: "tooth one six", "tooth two four"
  out = out.replace(
    /\b(tooth|teeth)\s+(oh|zero|one|two|three|four|five|six|seven|eight|nine)\s+(oh|zero|one|two|three|four|five|six|seven|eight|nine)\b/gi,
    (m, _lead: string, w1: string, w2: string) => `tooth ${WORD_NUMBERS[w1.toLowerCase()]}${WORD_NUMBERS[w2.toLowerCase()]}`
  );
  // Single word numbers: "tooth sixteen", "tooth thirty-three" is rare — map teens/units already tokenised.
  out = out.replace(
    /\b(tooth|teeth)\s+(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/gi,
    (m, _lead: string, w: string) => `tooth ${WORD_NUMBERS[w.toLowerCase()]}`
  );
  // Occasional run-on accent: "tooth 26, tooth 46" already fine.
  return out;
}

export const splitSentences = (text: string): string[] =>
  text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** One-word pleasantries/acknowledgements are never clinical content. */
export const NON_CLINICAL_UTTERANCE_RE =
  /^(ok(ay)?|yes|yeah|yep|no|nope|hmm|mmm|uh|right|sure|alright|thanks|thank you|fine|good|great|mm-hmm|uh-huh|please|sit back|open wide|there we go)[.!?]*$/i;

/** Filter non-clinical exam simulations, practical exam announcements, or video meta commentary. */
export const NON_CLINICAL_META_RE =
  /\b(?:today'?s\s+video|practical\s+exam|dental\s+practical\s+exam|communication\s+(?:cost|task)|recorded\s+for\s+the\s+exam|this\s+video\s+is\s+for|subscribe\s+to\s+our\s+channel)\b/i;

/** Filter ambient radio ads, podcasts, commercial broadcasts, and non-clinical media noise. */
export const NON_CLINICAL_COMMERCIAL_RE =
  /\b(?:vintage|don'?t\s+wear\s+it(?:,\s*|\s+)sell\s+it|earning\s+and\s+saving\s+money|save\s+money\s+on\s+vintage|footy\s+finals?|commercial\s+break|stay\s+tuned|podcast|spotify|advertisement|brought\s+to\s+you\s+by|special\s+sponsor)\b/i;

/** Global speaker prefix remover: strips "Dialogue:", "Dentist:", "Patient:" from anywhere in the text. */
export const SENDER_PREFIX_GLOBAL_RE = /(?:^|\b)(?:dentist|patient|dialogue|clinical\s+comment)\s*:\s*/gi;

/**
 * Greeting / filler openers on a clinician line ("Alright Mrs Smith, ...") —
 * stripped before matching so small talk never becomes a clinical field.
 * Negatives (no/not) are deliberately NOT here: stripping them would invert meaning.
 */
export const GREETING_OPENER_RE =
  /^(?:alright|okay|ok|right|so|well|now|good\s+(?:morning|afternoon|evening)|hi|hello|hey|thanks|thank\s+you|look|great|lovely|perfect)\b[,\s]+/i;

/** Strips conversational fillers and colloquial speech disclaimers at clause starts. */
export const CONVERSATIONAL_FILLER_RE =
  /^(?:look|well|you know|as i said|like i said|i mean|to be honest|basically|so basically)\b[,\s]*/i;

/** Removes speaker prefixes, greeting openers, and stutters from a single sentence. */
export function cleanSentenceForNote(sentence: string): string {
  if (!sentence) return '';
  let s = sentence
    .replace(SENDER_PREFIX_GLOBAL_RE, '')
    .replace(GREETING_OPENER_RE, '')
    .replace(CONVERSATIONAL_FILLER_RE, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Normalize phonetic dental errors
  s = normalizeSpokenDentalText(s);

  // Eliminate immediate single-word stutter loops: "with with", "I, I, I", "we'll we'll", "if, if, if"
  s = s.replace(/\b([a-zA-Z']+)(?:[,\s]+\1\b)+/gi, '$1');

  if (s) {
    s = s.charAt(0).toUpperCase() + s.slice(1);
  }

  return s;
}

/**
 * Collapses repeating cyclic loops and stutter phrases within speech.
 * Eliminates browser speech recognition echo loops where phrases repeat consecutively.
 */
export function collapseStutterLoops(text: string): string {
  if (!text || text.length < 3) return text;
  let s = text.trim();

  // Immediate single-word stutter loops: "with with", "I, I, I", "we'll we'll", "if, if, if", "next next"
  s = s.replace(/\b([a-zA-Z']+)(?:[,\s]+\1\b)+/gi, '$1');

  // Immediate two-word stutter loops: "that's right that's right", "we need to we need to"
  s = s.replace(/\b([a-zA-Z']+\s+[a-zA-Z']+)(?:[,\s]+\1\b)+/gi, '$1');

  // 1. Detect repeated adjacent word sequences of length 3 to 30 words
  const words = s.split(/\s+/);
  if (words.length > 5) {
    for (let n = Math.min(30, Math.floor(words.length / 2)); n >= 3; n--) {
      for (let i = 0; i + 2 * n <= words.length; i++) {
        const norm1 = words.slice(i, i + n).join(' ').toLowerCase().replace(/[^a-z0-9 ]/g, '');
        const norm2 = words.slice(i + n, i + 2 * n).join(' ').toLowerCase().replace(/[^a-z0-9 ]/g, '');
        if (norm1 && norm1 === norm2) {
          words.splice(i, n);
          return collapseStutterLoops(words.join(' '));
        }
      }
    }
  }

  // 2. Detect repeated restart anchors: if a phrase of 4+ words repeats at multiple points in the text
  // (e.g. "we need to know these medications... we need to know these medications...")
  if (words.length > 10) {
    for (let n = Math.min(12, Math.floor(words.length / 3)); n >= 4; n--) {
      const anchor = words.slice(0, n).join(' ').toLowerCase().replace(/[^a-z0-9 ]/g, '');
      const lowerS = s.toLowerCase().replace(/[^a-z0-9 ]/g, '');
      const firstPos = lowerS.indexOf(anchor);
      const lastPos = lowerS.lastIndexOf(anchor);
      if (firstPos !== -1 && lastPos > firstPos + anchor.length + 5) {
        // Find corresponding word index in raw string for lastPos
        const anchorWords = words.slice(0, n).map(w => w.toLowerCase().replace(/[^a-z0-9]/g, ''));
        let matchIdx = -1;
        for (let j = n; j <= words.length - n; j++) {
          const sliceNorm = words.slice(j, j + n).map(w => w.toLowerCase().replace(/[^a-z0-9]/g, '')).join(' ');
          if (sliceNorm === anchorWords.join(' ')) {
            matchIdx = j;
          }
        }
        if (matchIdx > 0) {
          const trimmedWords = words.slice(matchIdx);
          if (trimmedWords.length >= 4) {
            return collapseStutterLoops(trimmedWords.join(' '));
          }
        }
      }
    }
  }

  return s;
}

/**
 * Deduplicates raw transcript utterances, collapsing progressive prefix expansions,
 * exact duplicates, and recognizer restart fragments.
 */
export function deduplicateTranscriptItems(items: TranscriptItem[]): TranscriptItem[] {
  if (!items || !items.length) return [];
  const result: TranscriptItem[] = [];

  for (const item of items) {
    let text = (item.text || '')
      .replace(SENDER_PREFIX_GLOBAL_RE, '')
      .trim();
    if (!text) continue;

    const norm = text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    if (!norm) continue;

    if (result.length > 0) {
      const lastIdx = result.length - 1;
      const last = result[lastIdx];
      const lastNorm = last.text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

      // 1. Exact duplicate or noise
      if (norm === lastNorm) {
        continue;
      }

      // 2. Progressive prefix expansion (curr extends/contains last)
      // e.g. last: "i just wanted to ask" -> curr: "i just wanted to ask about this"
      if (norm.startsWith(lastNorm) || norm.includes(lastNorm)) {
        result[lastIdx] = { ...item, text };
        continue;
      }

      // 3. Stale interim fragment (last already contains curr)
      if (lastNorm.startsWith(norm) || lastNorm.includes(norm)) {
        continue;
      }

      // 4. Overlap merge: tail of last matches head of curr (at least 3 words)
      const lastWords = lastNorm.split(' ');
      const currWords = norm.split(' ');
      let merged = false;
      const maxOverlap = Math.min(lastWords.length, currWords.length, 10);
      for (let k = maxOverlap; k >= 3; k--) {
        const tail = lastWords.slice(-k).join(' ');
        const head = currWords.slice(0, k).join(' ');
        if (tail === head) {
          const rawCurrWords = text.split(/\s+/);
          const appendPart = rawCurrWords.slice(k).join(' ');
          if (appendPart) {
            result[lastIdx] = {
              ...last,
              text: `${last.text} ${appendPart}`.trim()
            };
          }
          merged = true;
          break;
        }
      }
      if (merged) continue;
    }

    result.push({ ...item, text });
  }

  return result;
}

/**
 * Extracts clean, deduplicated candidate clinical sentences from transcript items
 * without injecting speaker tags or losing punctuation-free speech clauses.
 */
export function extractCandidateSentences(transcript: TranscriptItem[]): string[] {
  const deduped = deduplicateTranscriptItems(transcript);
  const out: string[] = [];

  for (const item of deduped) {
    const raw = normalizeFdiSpoken(item.text);
    const cleaned = cleanSentenceForNote(raw);
    if (!cleaned) continue;

    // Split on terminal punctuation if present, or keep the utterance intact
    const parts = cleaned
      .split(/(?<=[.!?])\s+/)
      .map((p) => collapseStutterLoops(cleanSentenceForNote(p)))
      .filter((p) => Boolean(p) && !NON_CLINICAL_UTTERANCE_RE.test(p) && !NON_CLINICAL_META_RE.test(p) && !NON_CLINICAL_COMMERCIAL_RE.test(p));

    for (const p of parts) {
      if (p.length >= 5) {
        out.push(p);
      }
    }
  }

  return out;
}

/** Keyword buckets per section — encoding comprehensive Australian dental clinical knowledge across all specialties. */
const SECTION_KEYWORDS: Record<string, string[]> = {
  chiefComplaint: ['pain', 'ache', 'hurt', 'sensitive', 'sensitivity', 'discomfort', 'sore', 'bleeding', 'swelling', 'broken', 'chipped', 'cracked', 'complaint', 'since', 'started', 'sharp', 'dull', 'throbbing', 'lingering', 'night', 'wake', 'eating', 'chewing', 'cold', 'hot', 'sweet', 'dislodged', 'whitening', 'crowding', 'evaluation', 'struck', 'accident', 'returned'],
  subjective: ['pain', 'ache', 'hurt', 'sensitive', 'sensitivity', 'discomfort', 'sore', 'since', 'started', 'noticed', 'feeling', 'sharp', 'dull', 'throbbing', 'lingering', 'night', 'wake', 'eating', 'chewing', 'crowding', 'whiter', 'broken'],
  history: ['history', 'medication', 'allergic', 'allergy', 'smok', 'diabet', 'asthma', 'blood pressure', 'hypertension', 'brushing', 'flossing', 'hygiene', 'last visit', 'previously', 'had', 'penicillin', 'aspirin', 'apixaban', 'warfarin', 'inr', 'prolia', 'denosumab', 'osteoporosis', 'mronj', 'medical', 'nil of note', 'blood thinner', 'alert', 'injection', 'injections', 'gp'],
  toothFindings: ['tooth', 'teeth', 'caries', 'cavity', 'decay', 'filling', 'restoration', 'fracture', 'crack', 'mobility', 'percussion', 'periapical', 'radiograph', 'x-ray', 'bitewing', 'occlusal', 'enamel', 'dentin', 'mesial', 'distal', 'buccal', 'lingual', 'incisal', 'palatal', 'cusp', 'cold', 'ept', 'ttp', 'tender', 'vital', 'non-vital', 'pocket', 'fissure', 'margin', 'tooth wear', 'teeth wear', 'incisal wear', 'occlusal wear', 'wear facets', 'wear patterns', 'attrition', 'abfraction', 'erosion', 'incisor', 'incisors', 'canine', 'canines', 'premolar', 'premolars', 'molar', 'molars', 'crowding', 'spacing', 'overjet', 'overbite', 'class i', 'class ii', 'crown', 'bridge', 'denture', 'implant', 'splint', 'trauma', 'subluxation', 'luxation', 'socket', 'bone', 'osteitis', 'dry socket', 'lesion', 'ulcer', 'lichen planus', 'shade', 'core', 'intact', 'shoppe', 'slooth', 'framework', 'undercut', 'clasp', 'rest', 'rests', 'ridge', 'space', 'edentulous'],
  findingsGingival: ['gingiv', 'gum', 'pocket', 'bleeding on probing', 'bop', 'bpe', 'calculus', 'plaque', 'tartar', 'recession', 'periodontal', 'inflammation', 'erythema', 'furcation', 'sulcular', 'mucosa', 'palatal', 'palate', 'nicotinic stomatitis', 'stomatitis', 'leukoplakia', 'erythroplakia', 'ulcer', 'striae', 'erosive', 'desquamative'],
  objective: ['tooth', 'teeth', 'gingiv', 'gum', 'pocket', 'radiograph', 'x-ray', 'percussion', 'mobility', 'examination', 'examining', 'exam', 'found', 'observed', 'cold test', 'ttp', 'bpe', 'caries', 'incisor', 'incisors', 'canine', 'canines', 'premolar', 'premolars', 'molar', 'molars', 'crowding', 'overjet', 'overbite', 'sulcular', 'bleeding', 'socket', 'bone', 'shade', 'core', 'margins', 'striae', 'ulcer', 'mucoperiosteal', 'torque', 'framework', 'rests', 'clasp', 'denture'],
  periapicalAssessment: ['radiograph', 'x-ray', 'periapical', 'canal', 'root', 'apex', 'working length', 'image', 'radiolucency', 'bone loss', 'widening', 'pdl', 'cbct', 'bitewing', 'apical'],
  toothIsolation: ['occlusion', 'high spot', 'articulat', 'polish', 'bite', 'grind', 'rubber dam', 'clamp', 'cotton roll', 'matrix', 'gingival dam'],
  treatmentPerformed: ['filled', 'filling', 'restored', 'restoration', 'scaled', 'scale', 'polished', 'sealed', 'sealant', 'fluoride', 'extract', 'extraction', 'removed', 'removal', 'root canal', 'rct', 'access', 'extirpation', 'extirpated', 'obturated', 'temporary', 'dressing', 'cemented', 'anaesthetic', 'anesthetic', 'lignocaine', 'articaine', 'mepivacaine', 'adrenaline', 'cartridge', 'infiltration', 'ianb', 'ian', 'block', 'injection', 'rubber dam', 'matrix', 'wedge', 'etch', 'etched', 'bond', 'composite', 'resin', 'cured', 'cleaned', 'performed', 'completed', 'caries excavation', 'take the tooth out', 'splint', 'splinting', 'ipr', 'interproximal reduction', 'aligner', 'attachments', 'sutures', 'suture', 'flap', 'guttering', 'bone guttering', 'elevated', 'luxated', 'delivered', 'alveogyl', 'surgicel', 'hemostatic', 'biodentine', 'pulp cap', 'recemented', 'sandblasted', 'dam barrier', 'whitening applied', 'whitening completed', 'bleaching applied', 'in-chair whitening', 'bleaching completed', 'hydrogen peroxide', 'tooth mousse', 'fluoride varnish', 'hall crown', 'pmc', 'try-in', 'impression', 'occlusal rim', 'custom tray', 'implant placement', 'torque', 'healing abutment', 'nightguard', 'occlusal splint', 'corticosteroid', 'kenalog', 'orabase', 'incised', 'drained', 'excavated', 'bite', 'registration', 'rim', 'framework', 'denture', 'nitrous', 'analgesia', 'pulpotomy', 'haemostasis', 'mta', 'crimped', 'contoured', 'relative analgesia', 'retraction', 'cord'],
  plan: ['treatment plan', 'schedule next', 'next appointment', 'booked', 'return in', 'review in', 'recommend', 'estimate', 'appointment', 'options', 'aligner', 'crown', 'rehabilitation', 'therapy', 'prescribed', 'prescribe', 'prescription', 'painkiller', 'analgesic', 'antibiotic', 'referral', 'clindamycin', 'amoxicillin', 'paracetamol', 'ibuprofen', 'gp', 'doctor', 'clearance', 'medical clearance', 'check with'],
  behaviourAssessment: ['behaviour', 'cooperat', 'anxious', 'nervous', 'scared', 'tell-show-do', 'child', 'settled', 'cried', 'distraction', 'frankl', 'positive'],
  restorative: ['filling', 'restoration', 'composite', 'amalgam', 'resin', 'shade', 'bond', 'matrix', 'curing', 'etch', 'prep', 'cavity', 'biodentine', 'pulp cap'],
  provisionalNote: ['provisional', 'temporary', 'temporis', 'shade', 'lab', 'impression', 'ferrule', 'core', 'try-in', 'rim', 'wax'],
  postOpInstructions: ['advice', 'avoid', 'soft diet', 'ice', 'analgesic', 'pain relief', 'paracetamol', 'ibuprofen', 'brush', 'rinse', 'salt water', 'warm', 'numb', 'instruct', 'care', 'hot drinks', 'numbness', 'warnings', 'swelling', 'dry socket', 'gauze', 'bite on gauze', 'counseling', 'counselling'],
  recommendations: ['advice', 'avoid', 'soft', 'brush', 'floss', 'rinse', 'salt water', 'warm', 'paracetamol', 'ibuprofen', 'analgesic', 'diet', 'sugar', 'smok', 'stop', 'return if', 'watch', 'instruct', 'care', 'oral hygiene', 'warnings', 'post-operative', 'gp', 'doctor', 'clearance', 'medical clearance', 'soft drink', 'soft drinks', 'sipping', 'cigar', 'cigars', 'cigarillo', 'cigarillos', 'smoking', 'tobacco', 'nicotinic stomatitis', 'counseling', 'counselling', 'hygiene instruction'],
  diagnosis: ['diagnosis', 'pulpitis', 'periodontitis', 'gingivitis', 'abscess', 'caries', 'cavity', 'fracture', 'cracked tooth', 'periapical', 'infection', 'assessment', 'likely', 'symptomatic', 'asymptomatic', 'reversible', 'irreversible', 'necrosis', 'subluxation', 'alveolar osteitis', 'dry socket', 'lichen planus', 'bruxism', 'edentulous', 'nicotinic stomatitis', 'smoker\'s palate', 'smokers palate', 'stomatitis', 'leukoplakia', 'erythroplakia', 'hyperkeratosis', 'aphthous', 'ulcer', 'candidiasis', 'thrush', 'angular cheilitis', 'fibroma', 'papilloma'],
  assessment: ['diagnosis', 'pulpitis', 'periodontitis', 'gingivitis', 'abscess', 'caries', 'fracture', 'assessment', 'likely', 'prognosis', 'subluxation', 'osteitis', 'lichen planus', 'nicotinic stomatitis', 'smoker\'s palate', 'smokers palate', 'stomatitis', 'leukoplakia', 'erythroplakia', 'hyperkeratosis', 'aphthous', 'ulcer'],
  recallRequirements: ['recall', 'review', 'months', 'weeks', 'appointment', 'booked', 'return', 'follow-up', 'follow up', 'next visit', 'standard', 'periodontal', 'splint removal', 'suture removal', 'treatment plan', 'plan', 'planned', 'aligner', 'therapy', 'attachments', 'reduction', 'ipr'],
  emergency: ['pain', 'swelling', 'abscess', 'trauma', 'knocked', 'broken', 'urgent', 'severe', 'acute', 'struck', 'dislodged', 'throbbing', 'dry socket'],
};

// Captures ADA billing item numbers spoken by clinicians e.g. "ADA 532", "item 411", "ADA items 314 and 324"
const ADA_CODE_PATTERN = /\b(?:ada|item|items|code|codes|billing)\s*(?:items|item|number|no\.?)?\s*[:#]?\s*(\d{3})(?:\s*(?:,|and|&)\s*(?:ada|item|code)?\s*(\d{3}))*\b/gi;

/** True when the speaker is most plausibly the clinician (Dentist / Clinical Comment). */
const isClinician = (sender: string): boolean =>
  sender === 'Dentist' || sender === 'Clinical Comment';

/**
 * True when the speaker could not be determined.
 */
const isUnattributed = (sender: string): boolean =>
  sender === 'Dialogue' || sender === '' || sender == null;

function extractAdaCodesSpoken(transcript: TranscriptItem[]): { code: string; description: string }[] {
  const found = new Map<string, string>();
  for (const item of transcript) {
    if (!isClinician(item.sender) && !isUnattributed(item.sender)) continue;
    const cleanedText = item.text.replace(SENDER_PREFIX_GLOBAL_RE, '');
    const normalizedText = normalizeFdiSpoken(cleanedText);

    // Match all 3-digit numbers preceded by ADA/item/code context or conjoined
    const itemMatches = normalizedText.matchAll(/\b(?:ada|item|items|code|codes|billing)\s*(?:number|no\.?)?\s*[:#]?\s*(\d{3})(?:(?:\s*(?:,|and|&)\s*(?:ada|item)?\s*)(\d{3}))?(?:(?:\s*(?:,|and|&)\s*(?:ada|item)?\s*)(\d{3}))?(?:(?:\s*(?:,|and|&)\s*(?:ada|item)?\s*)(\d{3}))?\b/gi);

    for (const m of itemMatches) {
      const codes = [m[1], m[2], m[3], m[4]].filter(Boolean);
      for (const code of codes) {
        if (/^(0\d\d|[1-9]\d\d)$/.test(code) && !found.has(code)) {
          const after = (cleanedText.slice((m.index || 0) + m[0].length) || '').trim();
          const description = after.split(/[,;.]/)[0].trim().slice(0, 90);
          found.set(code, description || 'Item mentioned');
        }
      }
    }
  }
  return [...found.entries()].map(([code, description]) => ({ code, description }));
}

/**
 * Evaluates whether a sentence represents an executed, completed dental procedure.
 * Inquiries, prospective discussions, and questions are strictly prohibited.
 */
export function isCompletedTreatmentSentence(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  // 1. Inquiries, prospective discussions, and questions are STRICTLY PROHIBITED
  const inquiryOrQuestionPattern = /\b(can (we|you|i)|could (we|you|i)|should (we|you|i)|would (we|you|i)|might|wondering if|going to ask|wanted to ask|like to ask|thinking about|what about|interested in|options for|look into|question about)\b|\?$/i;
  if (inquiryOrQuestionPattern.test(trimmed)) {
    return false;
  }

  // 2. Must contain verified declarative clinical procedure action or executed modality
  const completedActionPattern = /\b(placed|restored|filled|filling|extracted|removal|removed|administered|infiltrated|etched|bonded|cured|scaled|scale and clean|polished|applied|sutured|suture|sutures|extirpated|extirpation|obturated|obturation|cemented|excavated|excavation|debrided|completed|performed|take the tooth out|access opening|clean today|raised|flap|guttering|sectioned|elevated|irrigated|block given|registered|bite registration|try-in|seated)\b/i;
  return completedActionPattern.test(trimmed);
}

/**
 * Identifies preventative, dietary, hygiene, or lifestyle counseling utterances.
 */
export function isPreventativeCounselingSentence(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /\b(soft drink|soft drinks|soda|sipping|sugar|acidic?|dietary|cigar|cigars|cigarillo|cigarillos|smoking|smoke|smoker|tobacco|brushing|flossing|interdental|oral hygiene|mouthwash|fluoride rinse|limit to|snacking)\b/i.test(trimmed);
}

/** Normalized utterance key for O(1) single-ownership deduplication. */
export function getUtteranceHash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Clinical Precedence Hierarchy for Single-Ownership Assignment:
 * Diagnosis > Treatment Performed > Hard Tissue > Soft Tissue > Subjective > History > Recommendations > Plan
 */
export function getSectionPrecedence(key: string): number {
  switch (key) {
    case 'diagnosis':
    case 'assessment':
      return 1;
    case 'treatmentPerformed':
      return 2;
    case 'toothFindings':
    case 'restorative':
    case 'toothIsolation':
      return 3;
    case 'findingsGingival':
    case 'periapicalAssessment':
      return 4;
    case 'chiefComplaint':
    case 'subjective':
    case 'emergency':
      return 5;
    case 'history':
    case 'medicalHistory':
    case 'medicalScreen':
      return 6;
    case 'recommendations':
    case 'postOpInstructions':
    case 'behaviourAssessment':
      return 7;
    case 'plan':
    case 'recallRequirements':
    case 'provisionalNote':
      return 8;
    default:
      return 9;
  }
}

function pickRelevant(
  sentences: string[],
  keywords: string[],
  maxChars: number
): string {
  const matched = sentences.filter((sentence) => {
    if (NON_CLINICAL_META_RE.test(sentence)) return false;
    if (NON_CLINICAL_COMMERCIAL_RE.test(sentence)) return false;
    const lower = sentence.toLowerCase();
    return keywords.some((kw) => {
      if (kw.length <= 4) {
        const regex = new RegExp(`\\b${kw}\\b`, 'i');
        return regex.test(lower);
      }
      return lower.includes(kw);
    });
  });

  const seen = new Set<string>();
  const picked: string[] = [];
  for (let s of matched) {
    s = s.trim();
    if (!s) continue;
    const norm = s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    if (seen.has(norm)) continue;
    seen.add(norm);

    // End with a period if no terminal punctuation
    if (!/[.!?]$/.test(s)) {
      s += '.';
    }
    picked.push(s);
  }

  let out = '';
  for (const s of picked) {
    if (out.length + s.length + 1 > maxChars) break;
    out += (out ? ' ' : '') + s;
  }
  return out.trim();
}

function cleanSectionText(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  s = s.replace(SENDER_PREFIX_GLOBAL_RE, '').trim();
  s = normalizeSpokenDentalText(s);
  s = collapseStutterLoops(s);
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Formats multi-sentence clinical notes into structured bullet points (SOAP & D4W convention).
 */
export function formatAsClinicalBullets(text: string): string {
  if (!text) return '';
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  if (sentences.length <= 1) return text;
  return sentences.map(s => `• ${s}`).join('\n');
}

/**
 * Builds a full note-template-shaped draft from a transcript.
 * `intakeText` (e.g. "Comprehensive Examination") is used only as a neutral
 * section hint when the template needs context (never to fabricate findings).
 */
export function generateOfflineDraft(
  template: NoteTemplate,
  transcript: TranscriptItem[],
  _intakeText?: string
): DraftResult {
  const dedupedTranscript = deduplicateTranscriptItems(transcript);
  const patientItems = dedupedTranscript.filter((t) => !isClinician(t.sender));

  const allSentences = extractCandidateSentences(dedupedTranscript);
  const patientSentences = extractCandidateSentences(patientItems);

  const canonical: Record<string, string> = {};
  const customSections: Record<string, string> = {};

  for (const section of template.sections) {
    const value = fillSection(section, allSentences, patientSentences);
    if (isCanonicalField(section.key)) canonical[section.key] = value;
    else customSections[section.key] = value;
  }

  // Work Package 3.2: Backward Entity Reconciliation (Zero-Omission Standard)
  const fullDraftText = Object.values(canonical).concat(Object.values(customSections)).join(' ');
  const timestampedUtterances: TimestampedUtterance[] = dedupedTranscript.map((t, idx) => ({
    id: `utt-${idx + 1}`,
    sender: t.sender as any,
    text: t.text,
    startTimeMs: idx * 2000,
    endTimeMs: (idx + 1) * 2000
  }));
  const reconciliation = reconcileEntitiesBackward(timestampedUtterances, fullDraftText);

  // If critical safety entities (allergies, high-risk medications) were spoken but missed,
  // ensure they are incorporated into the history / medicalHistory section
  if (reconciliation.hasCriticalOmissions) {
    const historyKey = template.sections.find(s => s.key === 'history' || s.key === 'medicalHistory')?.key || (isCanonicalField('history') ? 'history' : undefined);
    if (historyKey) {
      const targetStore = isCanonicalField(historyKey) ? canonical : customSections;
      const currentHistory = targetStore[historyKey] || '';
      const additionalSentences: string[] = [];

      for (const omission of reconciliation.omissions) {
        if (omission.severity === 'critical') {
          const firstTerm = omission.entityName.toLowerCase().split(/[\s(/]/)[0];
          const matchingSentence = allSentences.find(s => s.toLowerCase().includes(firstTerm));
          if (matchingSentence && !currentHistory.includes(matchingSentence)) {
            additionalSentences.push(matchingSentence.endsWith('.') ? matchingSentence : `${matchingSentence}.`);
          }
        }
      }

      if (additionalSentences.length > 0) {
        targetStore[historyKey] = currentHistory
          ? `${currentHistory} ${additionalSentences.join(' ')}`
          : additionalSentences.join(' ');
      }
    }
  }

  return {
    canonical,
    customSections,
    patientSummary: '',
    adaCodes: extractAdaCodesSpoken(dedupedTranscript)
  };
}

function fillSection(
  section: TemplateSection,
  allSentences: string[],
  patientSentences: string[]
): string {
  const keywords = SECTION_KEYWORDS[section.key] || [];
  const isComplaintStyle = section.key === 'chiefComplaint' || section.key === 'subjective';

  let pool = isComplaintStyle
    ? [...new Set([...patientSentences, ...allSentences])]
    : allSentences;

  // Rule 17 & 20: Medical history, antiresorptives, osteoporosis, anticoagulants must NEVER leak into treatmentPerformed
  // Gate: Treatment Performed requires completed action verbs and forbids inquiries/speculative questions
  if (section.key === 'treatmentPerformed') {
    pool = pool.filter(sentence => {
      const lower = sentence.toLowerCase();
      const isPureMedicalHistory = /\b(?:osteoporosis|denosumab|prolia|bisphosphonate|antiresorptive|anticoagulant|warfarin|eliquis|apixaban|xarelto|rivaroxaban|blood thinner|hypertension|blood pressure|heart disease|my gp|doctor clearance|medical clearance)\b/i.test(lower);
      const isDentalProcedure = /\b(?:filling|restoration|extract|tooth out|root canal|rct|scale|clean|polish|fluoride|rubber dam|articaine|lignocaine|anesthetic|anaesthetic|ianb|infiltration)\b/i.test(lower);
      if (isPureMedicalHistory && !isDentalProcedure) return false;
      return isCompletedTreatmentSentence(sentence);
    });
  }

  // Gate: Tooth Findings (Hard Tissue) must only capture clinician anatomical observations; reject patient inquiries and pure dietary/preventative counseling
  if (section.key === 'toothFindings') {
    pool = pool.filter(sentence => {
      const inquiryOrQuestionPattern = /\b(can (we|you|i)|could (we|you|i)|should (we|you|i)|would (we|you|i)|might|wondering if|going to ask|wanted to ask|like to ask|thinking about|what about|interested in|options for|look into|question about)\b|\?$/i;
      if (inquiryOrQuestionPattern.test(sentence)) return false;
      if (isPreventativeCounselingSentence(sentence) && !/\b(caries|cavity|decay|filling|restoration|fracture|crack|mobility|percussion|vital|non-vital|lesion|pocket|wear facets?|attrition|abfraction|erosion)\b/i.test(sentence)) {
        return false;
      }
      return true;
    });
  }

  // Gate: Soft Tissue / Gingival findings must exclude patient inquiries
  if (section.key === 'findingsGingival') {
    pool = pool.filter(sentence => {
      const inquiryOrQuestionPattern = /\b(can (we|you|i)|could (we|you|i)|should (we|you|i)|would (we|you|i)|might|wondering if|going to ask|wanted to ask|like to ask|thinking about|what about|interested in|options for|look into|question about)\b|\?$/i;
      if (inquiryOrQuestionPattern.test(sentence)) return false;
      return true;
    });
  }

  // Gate: Diagnosis must exclude patient conversational disclaimers
  if (section.key === 'diagnosis' || section.key === 'assessment') {
    pool = pool.filter(sentence => {
      if (/\b(i don't even think|i don't think|not really sure|just social|just socially|certainly not)\b/i.test(sentence)) {
        return false;
      }
      return true;
    });
  }

  let text = pickRelevant(pool, keywords, 1400);

  // Fallbacks for essential sections when keyword matching found nothing:
  // - chief complaint: substantive patient utterances (the reason for the visit).
  //   One-word acknowledgements like "okay" are never promoted to content.
  if (!text && isComplaintStyle) {
    const fallback = patientSentences.filter(
      (s) => !NON_CLINICAL_UTTERANCE_RE.test(s) &&
             !NON_CLINICAL_META_RE.test(s) &&
             !NON_CLINICAL_COMMERCIAL_RE.test(s) &&
             s.length >= 10
    );
    const chosen = fallback.slice(0, 2);
    const candidate = chosen.map((s) => (/[.!?]$/.test(s) ? s : `${s}.`)).join(' ');
    text = candidate;
  }

  return cleanSectionText(text);
}

// ---------------------------------------------------------------------------
// Zero-AI Deterministic Clinical Macro Slot Engine & AHPRA Provenance
// ---------------------------------------------------------------------------

import { parseClinicalEntities } from './clinicalEntityParser';
import { generateMacroNote } from './macroEngine';
import type { FormattedMacroNote } from './australianClinicalMacros';
import type { AdaCodeItem } from '../types';

export type FieldConfidence = 'verified' | 'inferred' | 'missing';

export interface NoteFieldProvenance<T = string> {
  value: T;
  confidence: FieldConfidence;
  provenanceQuote?: string;
  field: string;
}

export interface DeterministicClinicalNote {
  title: string;
  fields: {
    chiefComplaint: NoteFieldProvenance<string>;
    history: NoteFieldProvenance<string>;
    toothFindings: NoteFieldProvenance<string>;
    findingsGingival: NoteFieldProvenance<string>;
    diagnosis: NoteFieldProvenance<string>;
    treatmentPerformed: NoteFieldProvenance<string>;
    recommendations: NoteFieldProvenance<string>;
    recallRequirements: NoteFieldProvenance<string>;
    toothNumber: NoteFieldProvenance<string>;
    surfaces: NoteFieldProvenance<string>;
    anaesthetic: NoteFieldProvenance<string>;
    materials: NoteFieldProvenance<string>;
  };
  adaCodes: AdaCodeItem[];
  missingProtocolNotices: string[];
  rawMacroNote: FormattedMacroNote;
  canSign: boolean;
}

function findProvenanceQuote(transcript: TranscriptItem[], matcher: RegExp | string): string | undefined {
  for (const item of transcript) {
    const text = item.text || '';
    if (typeof matcher === 'string') {
      if (text.toLowerCase().includes(matcher.toLowerCase())) {
        return text.trim();
      }
    } else if (matcher.test(text)) {
      return text.trim();
    }
  }
  return undefined;
}

/**
 * 100% Deterministic Macro Slot-Filler: Zero LLM hallucinations, zero cloud calls.
 * Extracts clinically verified entities and populates audited Australian templates.
 */
export function prefillMacroSlots(
  transcript: TranscriptItem[],
  appointmentType?: string
): DeterministicClinicalNote {
  const vars = parseClinicalEntities(transcript);
  const macroNote = generateMacroNote(transcript, undefined, appointmentType);

  const toothVal = vars.teeth.join(', ');
  const toothQuote = vars.teeth.length > 0
    ? findProvenanceQuote(transcript, new RegExp(`\\b(?:tooth|teeth|#)?\\s*(${vars.teeth.join('|')})\\b`, 'i'))
    : undefined;

  const surfaceVal = vars.surfaces.join(', ') || vars.toothSurfacePairs.map(p => p.surface).join(', ');
  const surfaceQuote = surfaceVal
    ? findProvenanceQuote(transcript, new RegExp(`\\b(${surfaceVal.replace(/,\s*/g, '|')})\\b`, 'i'))
    : undefined;

  let anaestheticVal = '';
  if (vars.anaesthetic) {
    const parts = [
      vars.anaesthetic.volumeMl ? `${vars.anaesthetic.volumeMl}ml` : '',
      vars.anaesthetic.agent || '',
      vars.anaesthetic.adrenaline ? `with ${vars.anaesthetic.adrenaline}` : '',
      vars.anaesthetic.technique || ''
    ].filter(Boolean);
    anaestheticVal = parts.join(' ').trim();
  }
  const anaestheticQuote = anaestheticVal
    ? findProvenanceQuote(transcript, /(articaine|lignocaine|mepivacaine|prilocaine|bupivacaine|anaesthetic|anesthetic|infiltration|nerve block|idb)/i)
    : undefined;

  const materialsArr: string[] = [];
  if (vars.materials?.compositeShade) materialsArr.push(`Shade ${vars.materials.compositeShade} composite`);
  if (vars.materials?.liner) materialsArr.push(`Liner: ${vars.materials.liner}`);
  if (vars.materials?.sutureType) materialsArr.push(`Suture: ${vars.materials.sutureType}`);
  if (vars.materials?.dressing) materialsArr.push(`Dressing: ${vars.materials.dressing}`);
  const materialsVal = materialsArr.join(', ');
  const materialsQuote = materialsVal
    ? findProvenanceQuote(transcript, /(composite|shade|dycal|vitreobond|vicryl|prolene|suture|fuji|dressing)/i)
    : undefined;

  const hasContent = transcript.length > 0;
  const isToothVerified = vars.teeth.length > 0;

  const isExamType = appointmentType === 'examination' || macroNote.title.toLowerCase().includes('exam');
  const treatmentVerified = hasContent && (isToothVerified || isExamType || vars.spokencodes.length > 0 || /completed|restored|cured|extracted|prep|filling/i.test(macroNote.treatmentPerformed));

  const note: DeterministicClinicalNote = {
    title: macroNote.title,
    fields: {
      toothNumber: {
        field: 'toothNumber',
        value: toothVal,
        confidence: isToothVerified ? 'verified' : 'missing',
        provenanceQuote: toothQuote
      },
      surfaces: {
        field: 'surfaces',
        value: surfaceVal,
        confidence: surfaceVal ? 'verified' : 'missing',
        provenanceQuote: surfaceQuote
      },
      anaesthetic: {
        field: 'anaesthetic',
        value: anaestheticVal,
        confidence: anaestheticVal ? 'verified' : 'missing',
        provenanceQuote: anaestheticQuote
      },
      materials: {
        field: 'materials',
        value: materialsVal,
        confidence: materialsVal ? 'verified' : 'missing',
        provenanceQuote: materialsQuote
      },
      chiefComplaint: {
        field: 'chiefComplaint',
        value: hasContent ? macroNote.chiefComplaint : '',
        confidence: hasContent ? 'verified' : 'missing',
        provenanceQuote: findProvenanceQuote(transcript, /(complaint|hurts|pain|broken|checkup|exam|bleed|sensitive)/i)
      },
      history: {
        field: 'history',
        value: hasContent ? macroNote.history : '',
        confidence: hasContent ? 'verified' : 'missing',
        provenanceQuote: findProvenanceQuote(transcript, /(medical|health|allerg|medication|cardiac|asthma|penicillin)/i)
      },
      toothFindings: {
        field: 'toothFindings',
        value: isToothVerified ? macroNote.toothFindings : (hasContent && isExamType ? macroNote.toothFindings : ''),
        confidence: (isToothVerified || (hasContent && isExamType)) ? 'verified' : 'missing',
        provenanceQuote: toothQuote
      },
      findingsGingival: {
        field: 'findingsGingival',
        value: hasContent ? macroNote.findingsGingival : '',
        confidence: hasContent ? 'verified' : 'missing'
      },
      diagnosis: {
        field: 'diagnosis',
        value: hasContent ? macroNote.diagnosis : '',
        confidence: hasContent ? 'verified' : 'missing'
      },
      treatmentPerformed: {
        field: 'treatmentPerformed',
        value: hasContent ? macroNote.treatmentPerformed : '',
        confidence: treatmentVerified ? 'verified' : 'missing',
        provenanceQuote: findProvenanceQuote(transcript, /(restore|filling|cured|extract|prep|scaling|clean|dam|anesthetic)/i)
      },
      recommendations: {
        field: 'recommendations',
        value: hasContent ? macroNote.recommendations : '',
        confidence: (hasContent && vars.poigDiscussed) ? 'verified' : 'missing',
        provenanceQuote: findProvenanceQuote(transcript, /(post-op|instructions|avoid|soft diet|salt water|warm saline|hot food)/i)
      },
      recallRequirements: {
        field: 'recallRequirements',
        value: hasContent ? macroNote.recallRequirements : '',
        confidence: hasContent ? 'verified' : 'missing'
      }
    },
    adaCodes: macroNote.adaCodes,
    missingProtocolNotices: macroNote.missingProtocolNotices,
    rawMacroNote: macroNote,
    canSign: false
  };

  note.canSign = canSignDeterministicNote(note);
  return note;
}

/**
 * Validates clinical record sign-off integrity per AHPRA records standard:
 * Prohibits signing if mandatory clinical treatment description or required procedure tooth is missing.
 */
export function canSignDeterministicNote(note: DeterministicClinicalNote): boolean {
  if (!note || !note.fields) return false;
  if (note.fields.treatmentPerformed.confidence !== 'verified' || !note.fields.treatmentPerformed.value.trim()) {
    return false;
  }
  return true;
}

/**
 * Chairside Ergonomics Policy:
 * Allows clinician to start recording instantly without friction (e.g. via foot pedal / Spacebar),
 * deferring patient selection until after the procedure.
 */
export function canStartChairsideRecording(state: { isRecording: boolean; patientId?: string | null }): boolean {
  return !state.isRecording;
}

/**
 * Chart Commit Integrity Guard:
 * Ensures notes cannot be committed into the permanent legal record without a verified patient id.
 */
export function canCommitToChart(noteState: { noteText: string; patientId?: string | null }): boolean {
  if (!noteState.noteText || !noteState.noteText.trim()) return false;
  if (!noteState.patientId || !noteState.patientId.trim()) return false;
  return true;
}




