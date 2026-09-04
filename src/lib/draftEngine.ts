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

const splitSentences = (text: string): string[] =>
  text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** One-word pleasantries/acknowledgements are never clinical content. */
const NON_CLINICAL_UTTERANCE_RE =
  /^(ok(ay)?|yes|yeah|yep|no|nope|hmm|mmm|uh|right|sure|alright|thanks|thank you|fine|good|great|mm-hmm|uh-huh|please|sit back|open wide|there we go)[.!?]*$/i;

/** "Dentist: ..." / "Patient: ..." prefixes are presentation noise, not note content. */
const SENDER_PREFIX_RE = /^\s*(?:dentist|patient|dialogue|clinical\s+comment)\s*:\s*/i;

/**
 * Greeting / filler openers on a clinician line ("Alright Mrs Smith, ...") —
 * stripped before matching so small talk never becomes a clinical field.
 * Negatives (no/not) are deliberately NOT here: stripping them would invert meaning.
 */
const GREETING_OPENER_RE =
  /^(?:alright|okay|ok|right|so|well|now|good\s+(?:morning|afternoon|evening)|hi|hello|hey|thanks|thank\s+you|look|great|lovely|perfect)\b[,\s]+/i;

/** Removes speaker prefixes and greeting openers from a single sentence. */
function cleanSentenceForNote(sentence: string): string {
  return sentence.replace(SENDER_PREFIX_RE, '').replace(GREETING_OPENER_RE, '').trim();
}

/** Keyword buckets per section — the only place the engine encodes dental knowledge. */
const SECTION_KEYWORDS: Record<string, string[]> = {
  chiefComplaint: ['pain', 'ache', 'hurt', 'sensitive', 'sensitivity', 'discomfort', 'sore', 'bleeding', 'swelling', 'broken', 'chipped', 'cracked', 'complaint', 'since', 'started'],
  subjective: ['pain', 'ache', 'hurt', 'sensitive', 'discomfort', 'sore', 'since', 'started', 'noticed', 'feeling'],
  history: ['history', 'medication', 'allergic', 'allergy', 'smok', 'diabet', 'asthma', 'blood pressure', 'brushing', 'flossing', 'hygiene', 'last visit', 'previously', 'had'],
  toothFindings: ['tooth', 'caries', 'cavity', 'decay', 'filling', 'restoration', 'fracture', 'crack', 'mobility', 'percussion', 'periapical', 'radiograph', 'x-ray', 'bitewing', 'occlusal', 'enamel', 'dentin'],
  findingsGingival: ['gingiv', 'gum', 'pocket', 'bleeding on probing', 'bpe', 'calculus', 'plaque', 'tartar', 'recession', 'periodontal', 'inflammation', 'stain'],
  objective: ['tooth', 'gingiv', 'gum', 'pocket', 'radiograph', 'x-ray', 'percussion', 'mobility', 'examination', 'found', 'observed'],
  periapicalAssessment: ['radiograph', 'x-ray', 'periapical', 'canal', 'root', 'apex', 'working length', 'image'],
  toothIsolation: ['occlusion', 'high spot', 'articulat', 'polish', 'bite', 'grind'],
  treatmentPerformed: ['filled', 'filling', 'restored', 'restoration', 'scaled', 'scale', 'polished', 'sealed', 'sealant', 'fluoride', 'extract', 'removed', 'root canal', 'rct', 'access', 'obturated', 'temporary', 'dressing', 'cemented', 'anaesthetic', 'anesthetic', 'injection', 'rubber dam', 'cleaned', 'performed', 'completed'],
  plan: ['plan', 'booked', 'schedule', 'return', 'review', 'next', 'will', 'arrange'],
  behaviourAssessment: ['behaviour', 'cooperat', 'anxious', 'nervous', 'scared', 'tell-show-do', 'child', 'settled', 'cried'],
  restorative: ['filling', 'restoration', 'composite', 'amalgam', 'shade', 'bond', 'matrix', 'curing'],
  provisionalNote: ['provisional', 'temporary', 'temporis', 'shade', 'lab', 'impression'],
  postOpInstructions: ['advice', 'avoid', 'soft diet', 'ice', 'analgesic', 'pain relief', 'paracetamol', 'ibuprofen', 'brush', 'rinse', 'salt water', 'warm', 'numb', 'instruct'],
  recommendations: ['advice', 'avoid', 'soft', 'brush', 'floss', 'rinse', 'salt water', 'warm', 'paracetamol', 'ibuprofen', 'analgesic', 'diet', 'sugar', 'smok', 'stop', 'return if', 'watch'],
  diagnosis: ['diagnosis', 'pulpitis', 'periodontitis', 'gingivitis', 'abscess', 'caries', 'cavity', 'fracture', 'cracked tooth', 'periapical', 'infection', 'assessment', 'think', 'believe', 'likely'],
  assessment: ['diagnosis', 'pulpitis', 'periodontitis', 'gingivitis', 'abscess', 'caries', 'fracture', 'assessment', 'likely'],
  recallRequirements: ['recall', 'review', 'months', 'weeks', 'appointment', 'booked', 'return', 'follow-up', 'follow up', 'next visit'],
  emergency: ['pain', 'swelling', 'abscess', 'trauma', 'knocked', 'broken', 'urgent'],
};

// Conservative: ADA item numbers are only captured when explicitly flagged as
// an item/code/billing reference by the clinician (e.g. "item 414"), never from
// a bare number that happens to be three digits (e.g. a fee or dosage mention).
const ADA_ITEM_REF_RE = /\b(?:item|code|billing)\s*(?:number|no\.?)?\s*[:#]?\s*(\d{3})\b/gi;

/** True when the speaker is most plausibly the clinician (Dentist / Clinical Comment). */
const isClinician = (sender: string): boolean =>
  sender === 'Dentist' || sender === 'Clinical Comment';

function extractAdaCodesSpoken(transcript: TranscriptItem[]): { code: string; description: string }[] {
  const found = new Map<string, string>();
  for (const item of transcript) {
    if (!isClinician(item.sender)) continue;
    const matches = [...normalizeFdiSpoken(item.text).matchAll(ADA_ITEM_REF_RE)];
    for (const m of matches) {
      const code = m[1];
      if (!/^(0\d\d|[1-9]\d\d)$/.test(code)) continue;
      if (found.has(code)) continue;
      // Description: the clinician's own words after the flagged reference.
      const after = (item.text.slice((m.index || 0) + m[0].length) || '').trim();
      const description = after.split(/[,;.]/)[0].trim().slice(0, 90);
      found.set(code, description || 'Item mentioned');
    }
  }
  return [...found.entries()].map(([code, description]) => ({ code, description }));
}

function pickRelevant(text: string, keywords: string[], maxChars: number): string {
  const sentences = splitSentences(text);
  const matched = sentences.filter((sentence) => {
    const lower = sentence.toLowerCase();
    return keywords.some((kw) => lower.includes(kw));
  });
  // De-duplicate near-identical lines while preserving order.
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const s of matched) {
    const norm = s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    if (seen.has(norm)) continue;
    seen.add(norm);
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
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
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
  const combined = normalizeFdiSpoken(transcript.map((t) => `${t.sender}: ${t.text}`).join(' '));
  // What the patient said (used for complaint-style sections).
  const patientSpeech = normalizeFdiSpoken(
    transcript.filter((t) => !isClinician(t.sender)).map((t) => t.text).join(' ')
  );

  const canonical: Record<string, string> = {};
  const customSections: Record<string, string> = {};
  for (const section of template.sections) {
    const value = fillSection(section, combined, patientSpeech);
    if (isCanonicalField(section.key)) canonical[section.key] = value;
    else customSections[section.key] = value;
  }

  return {
    canonical,
    customSections,
    patientSummary: '',
    adaCodes: extractAdaCodesSpoken(transcript)
  };
}

function fillSection(section: TemplateSection, combined: string, patientSpeech: string): string {
  const keywords = SECTION_KEYWORDS[section.key] || [];

  // Complaint-style sections should lean on the patient's own words.
  const isComplaintStyle = section.key === 'chiefComplaint' || section.key === 'subjective';

  // Strip speaker prefixes ("Dentist:") and greeting openers ("Alright ...")
  // from every sentence before matching, so the draft never echoes small talk
  // into a clinical field and no field carries a "Dentist:" label.
  const combinedClean = splitSentences(combined).map(cleanSentenceForNote).filter(Boolean).join(' ');
  const patientClean = splitSentences(patientSpeech).map(cleanSentenceForNote).filter(Boolean).join(' ');

  const pool = isComplaintStyle ? `${patientClean} ${combinedClean}` : combinedClean;

  let text = pickRelevant(pool, keywords, 1400);

  // Fallbacks for essential sections when keyword matching found nothing:
  // - chief complaint: substantive patient utterances (the reason for the visit).
  //   One-word acknowledgements like "okay" are never promoted to content.
  if (!text && isComplaintStyle) {
    const patientSentences = splitSentences(patientClean).filter(
      (s) => !NON_CLINICAL_UTTERANCE_RE.test(s) && s.length >= 10
    );
    text = patientSentences.slice(0, 2).join(' ');
  }

  return cleanSectionText(text);
}


