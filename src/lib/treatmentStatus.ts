/**
 * Deterministic Treatment Status Primitive (Phase 5 — fail-closed safety remediation)
 *
 * SCOPE GUARD (architecture constraint 2 & 4): this module is a *validation
 * primitive*, not a second clinical reasoning layer. It classifies a single
 * sentence's treatment status and detects obvious semantic negation so the
 * deterministic layer can (a) BLOCK unsafe verification/sign-off and (b) FLAG
 * contradictions. It never certifies a clinical fact: `performed` here means
 * "the sentence describes treatment as performed", NOT "verified". Fact
 * verification remains dependent on ClinicalFact verification state, evidence
 * provenance, speaker attribution and contradiction checks.
 *
 * Keyword/regex signals here are conservative validation signals only — their
 * presence is never treated as semantic proof of clinical truth (constraint 9).
 * Every classifier below is biased toward `unknown`/`negated`, never toward
 * `performed`.
 */

/** Treatment status semantics per clinical safety spec §9. */
export type TreatmentStatus =
  | 'performed'
  | 'planned'
  | 'discussed'
  | 'declined'
  | 'historical'
  | 'negated'
  | 'unknown';

/**
 * Semantic negation detection (spec §10). Curated patterns for the clinical
 * phrases DentAI must never promote to positive findings: no pain / swelling /
 * bleeding / caries / mobility, "no filling placed", "no treatment performed",
 * "patient denies sensitivity", "no allergy reported", "ruled out".
 */
const NEGATION_PATTERNS: RegExp[] = [
  /\bno\s+(pain|swelling|bleeding|discharge|caries|decay|mobility|sinus|trauma|fracture|sensitivity|allerg\w*|reaction|filling|restoration|crown|extraction|treatment|work|procedure|changes?)\b/i,
  /\bnot\s+(placed|done|performed|completed|restored|filled|extracted|undertaken|required|needed|indicated|today)\b/i,
  /\b(deny|denies|denied|denying)\b/i,
  /\bnothing\s+(done|placed|performed|required)\b/i,
  /\bruled\s+out\b/i,
];

const DECLINED_PATTERNS: RegExp[] = [
  /\b(declined|refused|does not want|doesn't want|did not want|didnt want|not willing|against (our |medical )?advice|deferred)\b/i,
  // "I do not want the extraction today" — explicit patient refusal of a
  // proposed treatment (Phase 8 gold-set coverage).
  /\bdo(es)? not want\b/i,
  // Booked/planned treatment that was called off is not performed treatment
  // (Phase 8 regression: cancelled appointments must not classify as performed).
  /\b(cancelled|canceled|called off|postponed|rescheduled)\b/i,
];

const HISTORICAL_PATTERNS: RegExp[] = [
  /\b(last year|years? ago|months? ago|weeks? ago|previous(ly)? (visit|appointment|dentist)|at the previous|last visit|last appointment|last time|previous dentist)\b/i,
  /\b(already had|previously (had|underwent|received)|existing (crown|filling|restoration|implant|bridge|root canal))\b/i,
];

const PLANNED_PATTERNS: RegExp[] = [
  /\bnext\s+(visit|appointment|week|month|stage)\b/i,
  /\bwill\s+(be\s+)?(restor\w*|restor|extract\w*|extract|remove|perform|place|prepare|prep|fill|crown|see|review|assess|arrange|refer|do)\b/i,
  /\bgoing\s+to\s+(be\s+)?(restor\w*|extract|remove|place|fill|prep\w*|crown|do|see)\b/i,
  /\b(plan|plans|planned|planning|recommended|recommends|recommend)\s+(to|for|on)?/i,
  // "I recommend a crown on 46" — a recommendation is proposed treatment,
  // never performed treatment (Phase 8 gold-set: recommendation → planned).
  /\b(?:i|we)\s+recommend\b/i,
  /\bto\s+be\s+(restored|extracted|removed|placed|done|arranged|reviewed|assessed)\b/i,
  /\b(scheduled|booked)\s+(for|to|in)\b/i,
  /\b(return|returning|come back|coming back)\s+(for|to|in)\b/i,
  /\breview\s+(in|at|next)\b/i,
  /\b(we|i)\s+will\b/i,
  /\bi'?ll\b/i,
];

const DISCUSSED_PATTERNS: RegExp[] = [
  /\b(discuss\w*|talked about|talk(?:ed)? (?:through|about)|option(?:s)? (?:for|of|include|are)|consider\w*|thinking (?:about|of)|may (?:need|require)|might (?:need|require)|could (?:need|require))\b/i,
];

/**
 * Completed/ongoing treatment verbs. Mirror of the executed-action verb list in
 * `draftEngine.isCompletedTreatmentSentence` plus progressive chairside
 * narration ("restoring tooth 26", "placing the rubber dam") — kept local so
 * this primitive stays dependency-free.
 */
const PERFORMED_PATTERNS: RegExp[] = [
  /\b(placed|restored|filled|extracted|removed|administered|infiltrated|injected|etched|bonded|cured|scaled|polished|applied|sutured|extirpated|obturated|cemented|excavated|debrided|completed|performed|sectioned|guttered|elevated|irrigated|seated|delivered|given|undertook|undertaken)\b/i,
  /\b(restoring|placing|extracting|removing|preparing|prepping|scaling|polishing|suturing|building up|accessing|instrumenting)\b/i,
  /\b(scale and clean|scale and polish|access opening|rubber dam)\b/i,
];

/** True when the sentence semantically negates a finding or treatment. */
export function hasSemanticNegation(text: string): boolean {
  if (!text) return false;
  return NEGATION_PATTERNS.some((re) => re.test(text));
}

/**
 * Classifies the treatment status expressed by a single sentence.
 * Precedence (safest first): negated → declined → historical → planned →
 * discussed → performed → unknown. Ambiguous text defaults to `unknown`,
 * never to `performed`.
 */
export function detectTreatmentStatus(text: string): TreatmentStatus {
  if (!text || !text.trim()) return 'unknown';

  if (NEGATION_PATTERNS.some((re) => re.test(text))) return 'negated';
  if (DECLINED_PATTERNS.some((re) => re.test(text))) return 'declined';
  if (HISTORICAL_PATTERNS.some((re) => re.test(text))) return 'historical';
  if (PLANNED_PATTERNS.some((re) => re.test(text))) return 'planned';
  if (DISCUSSED_PATTERNS.some((re) => re.test(text))) return 'discussed';
  if (PERFORMED_PATTERNS.some((re) => re.test(text))) return 'performed';
  return 'unknown';
}

/** Transcript-level status signals, used by the server seam to flag contradictions (flag-only, constraint 5). */
export interface TreatmentStatusSignals {
  performed: boolean;
  planned: boolean;
  discussed: boolean;
  declined: boolean;
  historical: boolean;
  negated: boolean;
}

/** Aggregates treatment-status signals across transcript sentences. */
export function collectStatusSignals(texts: ReadonlyArray<string | undefined | null>): TreatmentStatusSignals {
  const signals: TreatmentStatusSignals = {
    performed: false,
    planned: false,
    discussed: false,
    declined: false,
    historical: false,
    negated: false,
  };
  for (const text of texts) {
    if (!text) continue;
    const status = detectTreatmentStatus(text);
    if (status !== 'unknown') signals[status] = true;
  }
  return signals;
}
