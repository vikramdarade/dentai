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

/** Global speaker prefix remover: strips "Dialogue:", "Dentist:", "Patient:" from anywhere in the text. */
export const SENDER_PREFIX_GLOBAL_RE = /(?:^|\b)(?:dentist|patient|dialogue|clinical\s+comment)\s*:\s*/gi;

/**
 * Greeting / filler openers on a clinician line ("Alright Mrs Smith, ...") —
 * stripped before matching so small talk never becomes a clinical field.
 * Negatives (no/not) are deliberately NOT here: stripping them would invert meaning.
 */
export const GREETING_OPENER_RE =
  /^(?:alright|okay|ok|right|so|well|now|good\s+(?:morning|afternoon|evening)|hi|hello|hey|thanks|thank\s+you|look|great|lovely|perfect)\b[,\s]+/i;

/** Removes speaker prefixes and greeting openers from a single sentence. */
export function cleanSentenceForNote(sentence: string): string {
  if (!sentence) return '';
  return sentence
    .replace(SENDER_PREFIX_GLOBAL_RE, '')
    .replace(GREETING_OPENER_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Collapses repeating cyclic loops and stutter phrases within speech.
 * Eliminates browser speech recognition echo loops where phrases repeat consecutively.
 */
export function collapseStutterLoops(text: string): string {
  if (!text || text.length < 15) return text;
  let s = text.trim();

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
      .filter((p) => Boolean(p) && !NON_CLINICAL_UTTERANCE_RE.test(p));

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
  history: ['history', 'medication', 'allergic', 'allergy', 'smok', 'diabet', 'asthma', 'blood pressure', 'hypertension', 'brushing', 'flossing', 'hygiene', 'last visit', 'previously', 'had', 'penicillin', 'aspirin', 'apixaban', 'warfarin', 'inr', 'prolia', 'denosumab', 'osteoporosis', 'mronj', 'medical', 'nil of note', 'blood thinner', 'alert'],
  toothFindings: ['tooth', 'teeth', 'caries', 'cavity', 'decay', 'filling', 'restoration', 'fracture', 'crack', 'mobility', 'percussion', 'periapical', 'radiograph', 'x-ray', 'bitewing', 'occlusal', 'enamel', 'dentin', 'mesial', 'distal', 'buccal', 'lingual', 'incisal', 'palatal', 'cusp', 'cold', 'ept', 'ttp', 'tender', 'vital', 'non-vital', 'pocket', 'fissure', 'margin', 'wear', 'attrition', 'abfraction', 'erosion', 'incisor', 'incisors', 'canine', 'canines', 'premolar', 'premolars', 'molar', 'molars', 'crowding', 'spacing', 'overjet', 'overbite', 'class i', 'class ii', 'crown', 'bridge', 'denture', 'implant', 'splint', 'trauma', 'subluxation', 'luxation', 'socket', 'bone', 'osteitis', 'dry socket', 'lesion', 'ulcer', 'lichen planus', 'whitening', 'shade', 'bleaching', 'core', 'intact', 'shoppe', 'slooth', 'framework', 'undercut', 'clasp', 'rest', 'rests', 'ridge', 'space', 'edentulous'],
  findingsGingival: ['gingiv', 'gum', 'pocket', 'bleeding on probing', 'bop', 'bpe', 'calculus', 'plaque', 'tartar', 'recession', 'periodontal', 'inflammation', 'stain', 'erythema', 'furcation', 'sulcular', 'mucosa', 'striae', 'erosive', 'desquamative'],
  objective: ['tooth', 'teeth', 'gingiv', 'gum', 'pocket', 'radiograph', 'x-ray', 'percussion', 'mobility', 'examination', 'examining', 'exam', 'found', 'observed', 'cold test', 'ttp', 'bpe', 'caries', 'incisor', 'incisors', 'canine', 'canines', 'premolar', 'premolars', 'molar', 'molars', 'crowding', 'overjet', 'overbite', 'sulcular', 'bleeding', 'socket', 'bone', 'shade', 'core', 'margins', 'striae', 'ulcer', 'mucoperiosteal', 'torque', 'framework', 'rests', 'clasp', 'denture'],
  periapicalAssessment: ['radiograph', 'x-ray', 'periapical', 'canal', 'root', 'apex', 'working length', 'image', 'radiolucency', 'bone loss', 'widening', 'pdl', 'cbct', 'bitewing', 'apical'],
  toothIsolation: ['occlusion', 'high spot', 'articulat', 'polish', 'bite', 'grind', 'rubber dam', 'clamp', 'cotton roll', 'matrix', 'gingival dam'],
  treatmentPerformed: ['filled', 'filling', 'restored', 'restoration', 'scaled', 'scale', 'polished', 'sealed', 'sealant', 'fluoride', 'extract', 'extraction', 'removed', 'removal', 'root canal', 'rct', 'access', 'extirpation', 'extirpated', 'obturated', 'temporary', 'dressing', 'cemented', 'anaesthetic', 'anesthetic', 'lignocaine', 'articaine', 'mepivacaine', 'adrenaline', 'cartridge', 'infiltration', 'ianb', 'ian', 'block', 'injection', 'rubber dam', 'matrix', 'wedge', 'etch', 'etched', 'bond', 'composite', 'resin', 'cured', 'cleaned', 'performed', 'completed', 'caries excavation', 'take the tooth out', 'splint', 'splinting', 'ipr', 'interproximal reduction', 'aligner', 'attachments', 'sutures', 'suture', 'flap', 'guttering', 'bone guttering', 'elevated', 'luxated', 'delivered', 'alveogyl', 'surgicel', 'hemostatic', 'biodentine', 'pulp cap', 'recemented', 'sandblasted', 'dam barrier', 'whitening', 'bleaching', 'hydrogen peroxide', 'tooth mousse', 'fluoride varnish', 'hall crown', 'pmc', 'try-in', 'impression', 'occlusal rim', 'custom tray', 'implant placement', 'torque', 'healing abutment', 'nightguard', 'occlusal splint', 'corticosteroid', 'kenalog', 'orabase', 'incised', 'drained', 'excavated', 'bite', 'registration', 'rim', 'framework', 'denture', 'nitrous', 'analgesia', 'pulpotomy', 'haemostasis', 'mta', 'crimped', 'contoured', 'relative analgesia', 'retraction', 'cord'],
  plan: ['plan', 'treatment plan', 'booked', 'schedule', 'return', 'review', 'next', 'will', 'arrange', 'recommend', 'estimate', 'appointment', 'options', 'aligner', 'crown', 'rehabilitation', 'therapy', 'prescribed', 'clindamycin', 'paracetamol', 'ibuprofen'],
  behaviourAssessment: ['behaviour', 'cooperat', 'anxious', 'nervous', 'scared', 'tell-show-do', 'child', 'settled', 'cried', 'distraction', 'frankl', 'positive'],
  restorative: ['filling', 'restoration', 'composite', 'amalgam', 'resin', 'shade', 'bond', 'matrix', 'curing', 'etch', 'prep', 'cavity', 'biodentine', 'pulp cap'],
  provisionalNote: ['provisional', 'temporary', 'temporis', 'shade', 'lab', 'impression', 'ferrule', 'core', 'try-in', 'rim', 'wax'],
  postOpInstructions: ['advice', 'avoid', 'soft diet', 'ice', 'analgesic', 'pain relief', 'paracetamol', 'ibuprofen', 'brush', 'rinse', 'salt water', 'warm', 'numb', 'instruct', 'care', 'hot drinks', 'numbness', 'warnings', 'swelling', 'dry socket', 'gauze', 'bite on gauze'],
  recommendations: ['advice', 'avoid', 'soft', 'brush', 'floss', 'rinse', 'salt water', 'warm', 'paracetamol', 'ibuprofen', 'analgesic', 'diet', 'sugar', 'smok', 'stop', 'return if', 'watch', 'instruct', 'care', 'oral hygiene', 'warnings', 'post-operative'],
  diagnosis: ['diagnosis', 'pulpitis', 'periodontitis', 'gingivitis', 'abscess', 'caries', 'cavity', 'fracture', 'cracked tooth', 'periapical', 'infection', 'assessment', 'think', 'believe', 'likely', 'symptomatic', 'asymptomatic', 'reversible', 'irreversible', 'necrosis', 'subluxation', 'alveolar osteitis', 'dry socket', 'lichen planus', 'bruxism', 'edentulous'],
  assessment: ['diagnosis', 'pulpitis', 'periodontitis', 'gingivitis', 'abscess', 'caries', 'fracture', 'assessment', 'likely', 'prognosis', 'subluxation', 'osteitis', 'lichen planus'],
  recallRequirements: ['recall', 'review', 'months', 'weeks', 'appointment', 'booked', 'return', 'follow-up', 'follow up', 'next visit', 'standard', 'periodontal', 'splint removal', 'suture removal'],
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

function pickRelevant(sentences: string[], keywords: string[], maxChars: number): string {
  const matched = sentences.filter((sentence) => {
    const lower = sentence.toLowerCase();
    return keywords.some((kw) => lower.includes(kw));
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

  const pool = isComplaintStyle
    ? [...new Set([...patientSentences, ...allSentences])]
    : allSentences;

  let text = pickRelevant(pool, keywords, 1400);

  // Fallbacks for essential sections when keyword matching found nothing:
  // - chief complaint: substantive patient utterances (the reason for the visit).
  //   One-word acknowledgements like "okay" are never promoted to content.
  if (!text && isComplaintStyle) {
    const fallback = patientSentences.filter(
      (s) => !NON_CLINICAL_UTTERANCE_RE.test(s) && s.length >= 10
    );
    const candidate = fallback.slice(0, 2).map((s) => (/[.!?]$/.test(s) ? s : `${s}.`)).join(' ');
    text = candidate;
  }

  return cleanSectionText(text);
}


