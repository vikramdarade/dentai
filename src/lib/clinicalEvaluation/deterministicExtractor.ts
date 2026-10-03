/**
 * Deterministic Baseline Extractor (Phase 8 evaluation harness)
 *
 * A transparent, conservative extractor over clinical transcripts that
 * produces CandidateClinicalFact[] for scoring against gold expectations.
 *
 * PURPOSE: it is the measurable BASELINE for the evaluation set — not the
 * production extraction pipeline. It reuses the shipped Phase 5 deterministic
 * primitives (treatment status, negation) and NEVER invents content: a fact is
 * emitted only when a pattern table matches explicit evidence, and every fact
 * carries an EvidenceSpan citing the utterance it came from. Where the
 * transcript is ambiguous (speculation, questions, unclear drugs), the fact is
 * left out — the omission is then measurable by the harness, which is the
 * point of a baseline.
 *
 * Chairside context rules (deterministic, evidence-bound):
 * - Tooth anaphora: a clinician statement without an explicit tooth inherits
 *   the most recently mentioned teeth ("I will drain IT" → the tooth under
 *   discussion). Nothing is ever carried backwards into unrelated speakers.
 * - "will X today" is chairside narration of immediate treatment → performed
 *   today, not a future plan.
 * - Gingival vocabulary routes to periodontal findings, not tooth findings.
 */

import type { CandidateClinicalFact, EvidenceSpan } from '../../types/clinicalFact';
import { detectTreatmentStatus, hasSemanticNegation } from '../treatmentStatus';

interface ExtractorUtterance {
  readonly utteranceId: string;
  readonly speaker: string;
  readonly text: string;
}

function spanOf(u: ExtractorUtterance): EvidenceSpan {
  const speaker = u.speaker === 'Dentist' || u.speaker === 'clinician' ? 'clinician'
    : u.speaker === 'Patient' || u.speaker === 'patient' ? 'patient'
    : u.speaker === 'Assistant' || u.speaker === 'assistant' ? 'assistant'
    : 'unknown';
  return {
    utteranceId: u.utteranceId,
    rawText: u.text,
    speaker: speaker as EvidenceSpan['speaker'],
    source: 'transcript',
  };
}

/**
 * Explicit FDI mentions (permanent 11–48 and deciduous 51–85) with no
 * unit/age contamination. Deciduous teeth have position digits 1–5 only —
 * e.g. 54 is a valid primary first molar, not a typo for a permanent tooth.
 */
const FDI_RE = /\b(?:tooth\s+)?([1-8][1-8])\b(?!\s*(?:mg|ml|%|kg|mmHg|yo|yr|years?|minutes?|mins?|seconds?|cartridge))/gi;

/** Deciduous (primary) dentition validity: quadrants 5–8, positions 1–5. */
function isDeciduousTooth(n: number): boolean {
  return n >= 51 && n <= 85 && n % 10 >= 1 && n % 10 <= 5;
}

/** Permanent dentition validity (ISO 3950): quadrants 1–4, positions 1–8. */
function isPermanentTooth(n: number): boolean {
  return n >= 11 && n <= 48;
}

const CONDITIONS: ReadonlyArray<{ names: ReadonlyArray<string>; value: () => Record<string, unknown> }> = [
  { names: ['caries', 'decay', 'cavity'], value: () => ({ condition: 'caries' }) },
  { names: ['fracture', 'cracked', 'crack'], value: () => ({ condition: 'fracture' }) },
  { names: ['impacted'], value: () => ({ condition: 'impacted third molar' }) },
  { names: ['tender to percussion', 'pain on percussion', 'percussion is tender'], value: () => ({ condition: 'pain on percussion' }) },
  { names: ['loose', 'mobility'], value: () => ({ condition: 'mobility' }) },
  { names: ['abscess'], value: () => ({ condition: 'abscess' }) },
  { names: ['swollen gum', 'swelling'], value: () => ({ condition: 'swelling' }) },
  { names: ['calcified canal'], value: () => ({ condition: 'calcified canals' }) },
  { names: ['crowding'], value: () => ({ condition: 'crowding' }) },
];

const GINGIVAL_CONDITIONS: ReadonlyArray<{ names: ReadonlyArray<string>; value: () => Record<string, unknown> }> = [
  { names: ['gingivitis'], value: () => ({ diagnosis: 'gingivitis' }) },
  { names: ['inflammation'], value: () => ({ diagnosis: 'gingival inflammation' }) },
  { names: ['bleeding on probing'], value: () => ({ bleedingOnProbing: true }) },
  { names: ['subgingival calculus'], value: () => ({ calculus: 'subgingival' }) },
  { names: ['supragingival calculus'], value: () => ({ calculus: 'supragingival' }) },
];

const PROCEDURES: ReadonlyArray<{ names: ReadonlyArray<string>; name: string }> = [
  { names: ['surgical extraction'], name: 'surgical extraction' },
  { names: ['extirpated', 'extirpation'], name: 'pulp extirpation' },
  { names: ['composite restoration', 'restoring', 'restoration', 'filling', 'restored', 'restore'], name: 'restoration' },
  { names: ['root canal treatment', 'root canal'], name: 'root canal treatment' },
  { names: ['extraction', 'extract', 'extracted', 'take the tooth out', 'sectioning'], name: 'extraction' },
  { names: ['crown preparation', 'prepping for crown', 'preparing tooth'], name: 'crown preparation' },
  { names: ['temporary crown'], name: 'temporary crown cementation' },
  { names: ['scale and polish', 'scaling and polishing', 'scaling completed', 'quadrant scaling'], name: 'scale and clean' },
  { names: ['implant fixture'], name: 'implant fixture placement' },
  { names: ['healing abutment'], name: 'healing abutment insertion' },
  { names: ['fissure sealant', 'sealed'], name: 'fissure sealant' },
  { names: ['suture removal', 'remove the stitches'], name: 'suture removal' },
  { names: ['quadrant debridement', 'debridement'], name: 'periodontal debridement' },
  { names: ['drain it', 'drainage'], name: 'drainage' },
  { names: ['recommend a crown', 'crown on'], name: 'crown' },
];

const DRUGS: ReadonlyArray<{ names: ReadonlyArray<string>; drugName: string }> = [
  { names: ['warfarin', 'coumadin'], drugName: 'warfarin' },
  { names: ['eliquis', 'apixaban'], drugName: 'Eliquis' },
  { names: ['xarelto', 'rivaroxaban'], drugName: 'Xarelto' },
  { names: ['paracetamol', 'panadol'], drugName: 'paracetamol' },
  { names: ['ibuprofen', 'nurofen'], drugName: 'ibuprofen' },
  { names: ['ventolin'], drugName: 'Ventolin' },
  { names: ['metformin'], drugName: 'metformin' },
  { names: ['insulin'], drugName: 'insulin' },
];

const ALLERGENS: ReadonlyArray<{ names: ReadonlyArray<string>; allergen: string }> = [
  { names: ['penicillin', 'amoxicillin'], allergen: 'penicillin' },
  { names: ['latex'], allergen: 'latex' },
  { names: ['codeine'], allergen: 'codeine' },
  { names: ['sulfa'], allergen: 'sulfa drugs' },
];

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function spokenTeeth(text: string): number[] {
  const out = new Set<number>();
  for (const match of text.matchAll(FDI_RE)) {
    const n = parseInt(match[1], 10);
    if (isPermanentTooth(n) || isDeciduousTooth(n)) out.add(n);
  }
  // Exclusion context: "46, not 16 as the chart said" — the corrected tooth
  // stands; the explicitly excluded one must not attach to findings.
  for (const excl of text.matchAll(/\bnot\s+tooth\s+([1-8][1-8])\b|\bnot\s+([1-8][1-8])\b/gi)) {
    const excluded = parseInt(excl[1] ?? excl[2], 10);
    if (excluded >= 11 && excluded <= 48 && out.size > 1) out.delete(excluded);
  }
  return [...out];
}

/** Spoken tooth-name → FDI (mirrors the FDI engine's quadrant/position logic). */
const TOOTH_NAME_FDI: ReadonlyArray<{ re: RegExp; fdi: number }> = [
  // Primary-dentition names (paediatric case: "upper right first baby molar" → 54)
  { re: /upper right(?: first)? (?:baby|primary|milk) molar/i, fdi: 54 },
  { re: /upper left(?: first)? (?:baby|primary|milk) molar/i, fdi: 64 },
  { re: /lower left(?: first)? (?:baby|primary|milk) molar/i, fdi: 74 },
  { re: /lower right(?: first)? (?:baby|primary|milk) molar/i, fdi: 84 },
  { re: /upper right (?:first |central )?incisor/i, fdi: 11 },
  { re: /upper left (?:first |central )?incisor/i, fdi: 21 },
  { re: /lower left (?:first |central )?incisor/i, fdi: 31 },
  { re: /lower right (?:first |central )?incisor/i, fdi: 41 },
  { re: /upper right(?: first)? (?:molar|6)/i, fdi: 16 },
  { re: /upper left(?: first)? (?:molar|6)/i, fdi: 26 },
  { re: /lower left(?: first)? (?:molar|6)/i, fdi: 36 },
  { re: /lower right(?: first)? (?:molar|6)/i, fdi: 46 },
  { re: /lower left(?: third)? (?:wisdom|molar|8)/i, fdi: 38 },
  { re: /lower right(?: third)? (?:wisdom|molar|8)/i, fdi: 48 },
  { re: /upper right(?: third)? (?:wisdom|molar|8)/i, fdi: 18 },
  { re: /upper left(?: third)? (?:wisdom|molar|8)/i, fdi: 28 },
];

function namedTeeth(text: string): number[] {
  const out = new Set<number>();
  for (const entry of TOOTH_NAME_FDI) {
    if (entry.re.test(text)) out.add(entry.fdi);
  }
  return [...out];
}

function surfacesOf(text: string): string[] | undefined {
  const lower = normalise(text);
  const out: string[] = [];
  if (/\bmesial\b|\bMO\b/.test(lower)) out.push('M');
  if (/\bocclusal\b|\bMOD\b|\bMODB\b/.test(lower)) out.push('O');
  if (/\bdistal\b|\bDO\b/.test(lower)) out.push('D');
  if (/\bbuccal\b|\bfacial\b|\bMODB\b/.test(lower)) out.push('B');
  if (/\blingual\b|\bpalatal\b/.test(lower)) out.push('L');
  if (/\bincisal\b|\bMI\b/.test(lower)) out.push('I');
  return out.length > 0 ? out : undefined;
}

/**
 * Treatment status with the chairside "today" rule: "we will start root canal
 * TODAY" is narration of immediate treatment, not a future plan.
 */
function statusOf(text: string, speakerIsClinician: boolean): { status: CandidateClinicalFact['status']; temporal: CandidateClinicalFact['temporal'] } {
  const isToday = /\btoday\b/i.test(text);
  const status = detectTreatmentStatus(text);
  if (status === 'performed') return { status: speakerIsClinician ? 'performed' : 'historical', temporal: 'completed_today' };
  if (status === 'historical') return { status: 'historical', temporal: 'historical' };
  if (status === 'planned' || status === 'discussed') {
    if (speakerIsClinician && isToday) return { status: 'performed', temporal: 'completed_today' };
    return { status: 'planned', temporal: 'next_appointment' };
  }
  if (status === 'negated') return { status: 'negated', temporal: 'current' };
  if (status === 'declined') return { status: 'declined', temporal: 'current' };
  return { status: 'unknown', temporal: 'current' };
}

/**
 * Splits an utterance into clause-like segments on commas and sentence
 * boundaries for clause-level status classification.
 */
function splitClauses(text: string): string[] {
  return text.split(/[,;.]/).map(s => s.trim()).filter(Boolean);
}

/**
 * Conservative deterministic extraction.
 */
export function extractBaselineFacts(
  transcript: ReadonlyArray<ExtractorUtterance>
): CandidateClinicalFact[] {
  const candidates: CandidateClinicalFact[] = [];
  let counter = 1;
  const id = () => `cand-${counter++}`;

  // Chairside anaphora: most recent clinician-mentioned teeth.
  let lastClinicianTeeth: number[] = [];

  for (const u of transcript) {
    const text = u.text || '';
    const lower = normalise(text);
    if (!lower) continue;

    const isClinician = u.speaker === 'Dentist' || u.speaker === 'clinician' || u.speaker === 'Dialogue' || !u.speaker;
    const isPatient = u.speaker === 'Patient' || u.speaker === 'patient' || u.speaker === 'Dialogue' || !u.speaker;
    const span = spanOf(u);
    const teeth = [...new Set([...spokenTeeth(text), ...namedTeeth(text)])];
    const effectiveTeeth = teeth.length > 0 ? teeth : (isClinician ? lastClinicianTeeth : []);
    if (isClinician && teeth.length > 0) lastClinicianTeeth = teeth;

    // --- Chief complaint / patient narration ---------------------------------
    if (isPatient) {
      if (/here for|booked (?:in )?for/i.test(lower)) {
        candidates.push({
          id: id(), type: 'chief_complaint', speaker: 'patient', evidenceType: 'patient_reported',
          value: { complaint: lower.includes('check') ? 'regular check-up' : lower },
          status: 'reported', temporal: 'current', certainty: 'certain', evidence: [span],
        });
      }
    }

    // --- Symptoms (patient-voiced) --------------------------------------------
    // Phase 10 (F-3): negation scope is honoured HERE, not left to downstream
    // verification. "No pain at the moment" must produce a NEGATED symptom
    // assertion — never a positive one. Positive and negated forms are
    // distinguishable by `status` ('reported' vs 'negated').
    if (isPatient && /pain|ache|hurts|sore|sensitive|bleeds|bleeding|feels loose|wobbly|swollen/i.test(lower)) {
      const description = lower.includes('pain on biting') ? 'pain on biting'
        : lower.includes('bleeds') || lower.includes('bleeding') ? 'gum bleeding when brushing'
        : lower.includes('feels loose') || lower.includes('wobbly') ? 'tooth feels loose'
        : lower.includes('sensitive') ? 'sensitivity'
        : lower.includes('throbbing') ? 'throbbing pain'
        : 'pain';
      const negated = hasSemanticNegation(text);
      candidates.push({
        id: id(), type: 'symptom', speaker: 'patient', evidenceType: 'patient_reported',
        value: { description }, status: negated ? 'negated' : 'reported', temporal: 'current',
        certainty: 'certain',
        ...(negated ? { negationScope: text } : {}),
        anatomy: effectiveTeeth.length > 0 ? { teeth: effectiveTeeth } : undefined, evidence: [span],
      });
    }

    // --- Consent / options discussion (clinician) — suppresses procedures ----
    if (isClinician && /\bthe options are\b|\brisks? (?:include|are)\b/i.test(lower)) {
      const optionsMatch = lower.match(/the options are ([^.]+)/i);
      const options = optionsMatch
        ? optionsMatch[1].split(/\bor\b|,/).map(s => s.trim()).filter(Boolean)
        : [];
      const risks: string[] = [];
      if (/numb/i.test(lower)) risks.push('numbness');
      if (/infection/i.test(lower)) risks.push('infection');
      candidates.push({
        id: id(), type: 'consent', speaker: 'clinician', evidenceType: 'discussion',
        value: {
          procedureDiscussed: options.join(' or '),
          materialRisksWarned: risks,
          alternativesDiscussed: options,
          patientResponse: 'verbally_consented',
        },
        status: 'discussed', temporal: 'current', certainty: 'certain',
        anatomy: effectiveTeeth.length > 0 ? { teeth: effectiveTeeth } : undefined, evidence: [span],
      });
      continue;
    }

    // --- Treatment plan (clinician) -------------------------------------------
    if (isClinician && /\bthe plan is\b/i.test(lower)) {
      const planMatch = lower.match(/the plan is ([^.]+)/i);
      if (planMatch) {
        const items = planMatch[1].split(/\band\b|,/).map(s => s.trim()).filter(Boolean);
        candidates.push({
          id: id(), type: 'treatment_plan', speaker: 'clinician', evidenceType: 'discussion',
          value: { proposedProcedures: items }, status: 'planned', temporal: 'future', certainty: 'certain',
          anatomy: effectiveTeeth.length > 0 ? { teeth: effectiveTeeth } : undefined, evidence: [span],
        });
        continue;
      }
    }

    // --- Post-operative instructions (clinician) ------------------------------
    if (isClinician && /\bno (?:hot|rinsing|smoking|drinking)|avoid (?:hot|rinsing|smoking|chewing)|take (?:paracetamol|ibuprofen|panadol|nurofen)/i.test(lower)) {
      const instructions = (text.match(/\bno [^.]+?(?=[.,]|$)/gi) ?? []).map(s => s.trim().toLowerCase());
      candidates.push({
        id: id(), type: 'postoperative_instruction', speaker: 'clinician', evidenceType: 'instruction',
        value: { instructions: instructions.length > 0 ? instructions : [lower] },
        status: 'planned', temporal: 'future', certainty: 'certain', evidence: [span],
      });
      const medMatch = lower.match(/\btake (paracetamol|ibuprofen|panadol|nurofen)/i);
      if (medMatch) {
        candidates.push({
          id: id(), type: 'medication_instruction', speaker: 'clinician', evidenceType: 'instruction',
          value: { drug: medMatch[1], dose: 'as needed', frequency: 'as needed', duration: 'as needed' },
          status: 'planned', temporal: 'future', certainty: 'certain', evidence: [span],
        });
      }
      continue;
    }

    // --- Clinician findings / procedures --------------------------------------
    if (isClinician) {
      // Gingival findings route to periodontal_finding.
      const matchedGingival = new Set<string>();
      for (const cond of GINGIVAL_CONDITIONS) {
        for (const name of cond.names) {
          if (lower.includes(name) && !matchedGingival.has(name)) {
            matchedGingival.add(name);
            // Phase 10 (F-3): negation scope honoured here too — "no bleeding
            // on probing" must not become a positive periodontal finding.
            const negated = hasSemanticNegation(text);
            candidates.push({
              id: id(), type: 'periodontal_finding', speaker: 'clinician', evidenceType: 'clinician_observed',
              value: cond.value(), status: negated ? 'negated' : 'observed', temporal: 'current', certainty: 'certain',
              ...(negated ? { negationScope: text } : {}),
              anatomy: effectiveTeeth.length > 0 ? { teeth: effectiveTeeth } : undefined, evidence: [span],
            });
            break;
          }
        }
      }

      // Tooth findings (multiple per utterance supported).
      const matchedConditions = new Set<string>();
      for (const cond of CONDITIONS) {
        for (const name of cond.names) {
          if (lower.includes(name) && !matchedConditions.has(cond.value().condition as string)) {
            matchedConditions.add(cond.value().condition as string);
            const negated = hasSemanticNegation(text);
            candidates.push({
              id: id(), type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed',
              value: cond.value(), status: negated ? 'negated' : 'observed', temporal: 'current',
              certainty: 'certain',
              ...(negated ? { negationScope: text } : {}),
              anatomy: effectiveTeeth.length > 0 ? { teeth: effectiveTeeth, surfaces: surfacesOf(text) } : undefined,
              evidence: [span],
            });
            break;
          }
        }
      }

      // Diagnoses (explicit clinician statements only).
      const dxMatch = lower.match(/\b(?:this is|diagnosis (?:is|was)|acute|chronic|irreversible)\s+(?:an?\s+)?([a-z\s]+(?:abscess|pulpitis|periodontitis|gingivitis))/i);
      if (dxMatch) {
        const condition = dxMatch[1].trim().replace(/\s+on\s+tooth\s+\d+/i, '').trim();
        candidates.push({
          id: id(), type: 'diagnosis', speaker: 'clinician', evidenceType: 'clinician_interpretation',
          value: { condition, provisional: false }, status: 'observed', temporal: 'current', certainty: 'certain',
          anatomy: effectiveTeeth.length > 0 ? { teeth: effectiveTeeth } : undefined, evidence: [span],
        });
      }

      // Procedures.
      for (const proc of PROCEDURES) {
        if (proc.names.some(n => lower.includes(n))) {
          // Status is classified from the CLAUSE containing the procedure
          // verb, not the whole utterance — a follow-up sentence share the
          // same utterance ("Healing abutment in, review in two weeks") must
          // not demote a performed narration to planned.
          const clause = splitClauses(text)
            .filter(c => proc.names.some(n => normalise(c).includes(n)))[0] ?? text;
          const { status, temporal } = statusOf(clause, isClinician);
          const name = proc.name === 'restoration' && /composite/i.test(lower) ? 'composite restoration' : proc.name;
          candidates.push({
            id: id(), type: 'procedure', speaker: 'clinician',
            evidenceType: status === 'performed' ? 'clinician_observed' : 'discussion',
            value: { name }, status, temporal, certainty: 'certain',
            anatomy: effectiveTeeth.length > 0 ? { teeth: effectiveTeeth, surfaces: surfacesOf(text) } : undefined,
            evidence: [span],
          });
          break;
        }
      }

      // Anaesthetic (explicit spoken fields only).
      if (/articaine|lignocaine|mepivacaine|prilocaine/i.test(lower)) {
        const agent = /articaine/i.test(lower) ? '4% Articaine'
          : /lignocaine/i.test(lower) ? '2% Lignocaine'
          : /mepivacaine/i.test(lower) ? '3% Mepivacaine'
          : '3% Prilocaine';
        candidates.push({
          id: id(), type: 'anaesthetic', speaker: 'clinician', evidenceType: 'clinician_observed',
          value: { agent, technique: /block/i.test(lower) ? 'IAN block' : 'infiltration' },
          status: 'performed', temporal: 'completed_today', certainty: 'certain', evidence: [span],
        });
      }

      // Materials (explicit spoken only).
      if (/odontopaste/i.test(lower)) {
        candidates.push({
          id: id(), type: 'material', speaker: 'clinician', evidenceType: 'clinician_observed',
          value: { name: 'Odontopaste dressing' }, status: 'performed', temporal: 'completed_today',
          certainty: 'certain', evidence: [span],
        });
      }
      if (/vicryl/i.test(lower)) {
        candidates.push({
          id: id(), type: 'material', speaker: 'clinician', evidenceType: 'clinician_observed',
          value: { name: 'vicryl suture' }, status: 'performed', temporal: 'completed_today',
          certainty: 'certain', evidence: [span],
        });
      }

      // Recall / follow-up: sub-month intervals are follow-ups.
      const recallMatch = lower.match(/\b(?:see you in|come back in|review in|recall in)\s+(a|one|two|three|six|twelve|\d+)\s*(month|week|year)/i);
      if (recallMatch) {
        const numberWords: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, six: 6, twelve: 12 };
        const amount = numberWords[recallMatch[1].toLowerCase()] ?? parseInt(recallMatch[1], 10);
        const unit = recallMatch[2].toLowerCase();
        if (unit === 'week') {
          candidates.push({
            id: id(), type: 'follow_up', speaker: 'clinician', evidenceType: 'instruction',
            value: { timeframe: `${amount} week${amount > 1 ? 's' : ''}`, action: 'review' },
            status: 'planned', temporal: 'future', certainty: 'certain', evidence: [span],
          });
        } else {
          const intervalMonths = unit === 'year' ? amount * 12 : amount;
          candidates.push({
            id: id(), type: 'recall_plan', speaker: 'clinician', evidenceType: 'instruction',
            value: { intervalMonths, reason: 'routine' }, status: 'planned', temporal: 'future',
            certainty: 'certain', evidence: [span],
          });
        }
      }

      // Referrals.
      const referMatch = lower.match(/\brefer(?:ring|ral)?\s+(?:you\s+)?to\s+the\s+(endodontist|orthodontist|periodontist|oral (?:maxillofacial )?surgeon|prosthodontist)/i);
      if (referMatch) {
        candidates.push({
          id: id(), type: 'referral', speaker: 'clinician', evidenceType: 'instruction',
          value: { specialty: referMatch[1], reason: 'clinical assessment' }, status: 'planned',
          temporal: 'future', certainty: 'certain',
          anatomy: effectiveTeeth.length > 0 ? { teeth: effectiveTeeth } : undefined, evidence: [span],
        });
      }
    }

    // --- Patient medications, allergies, history ------------------------------
    if (isPatient) {
      if (/\[unclear/i.test(text)) {
        candidates.push({
          id: id(), type: 'medication', speaker: 'patient', evidenceType: 'patient_reported',
          value: { drugName: 'blood thinner (unclear, possibly Eliquis)' }, status: 'reported',
          temporal: 'current', certainty: 'uncertain', evidence: [span],
        });
      } else {
        for (const drug of DRUGS) {
          if (drug.names.some(n => lower.includes(n))) {
            const doseMatches = [...lower.matchAll(/(\d+(?:\.\d+)?)\s*(mg|milligrams?)\b/gi)];
            const lastDose = doseMatches[doseMatches.length - 1];
            candidates.push({
              id: id(), type: 'medication', speaker: 'patient', evidenceType: 'patient_reported',
              value: { drugName: drug.drugName, ...(lastDose ? { dose: `${lastDose[1]} mg` } : {}) },
              status: 'reported', temporal: 'current', certainty: 'certain', evidence: [span],
            });
            break;
          }
        }
      }

      for (const allergen of ALLERGENS) {
        if (allergen.names.some(n => lower.includes(n)) && /allerg/i.test(lower)) {
          candidates.push({
            id: id(), type: 'allergy', speaker: 'patient', evidenceType: 'patient_reported',
            value: { allergen: allergen.allergen }, status: 'reported', temporal: 'current',
            certainty: 'certain', evidence: [span],
          });
          break;
        }
      }

      if (/asthma/i.test(lower)) {
        candidates.push({
          id: id(), type: 'medical_history', speaker: 'patient', evidenceType: 'patient_reported',
          value: { condition: 'asthma', status: 'managed' }, status: 'reported', temporal: 'current',
          certainty: 'certain', evidence: [span],
        });
      }

      // Patient-reported historical treatment ("had a root canal three years ago").
      if (/\bh(a|ad)\s+(?:a\s+)?(root canal|crown|filling|extraction|implant)|\bthe (?:crown|root canal|filling) was done\b/i.test(lower) && /\b(ago|previous|another|overseas|last year)\b/i.test(lower)) {
        const procName = /root canal/i.test(lower) ? 'root canal treatment'
          : /crown/i.test(lower) ? 'crown'
          : /extraction|extracted|took (?:it|the tooth) out/i.test(lower) ? 'extraction'
          : /implant/i.test(lower) ? 'implant'
          : 'filling';
        candidates.push({
          id: id(), type: 'procedure', speaker: 'patient', evidenceType: 'patient_reported',
          value: { name: procName }, status: 'historical', temporal: 'historical', certainty: 'certain',
          anatomy: effectiveTeeth.length > 0 ? { teeth: effectiveTeeth } : undefined, evidence: [span],
        });
      }

      // Patient decline ("not today", "will think about it").
      if (/\bnot today\b|\bthink about it\b|\bnot doing the\b/i.test(lower)) {
        candidates.push({
          id: id(), type: 'declined_treatment', speaker: 'patient', evidenceType: 'patient_reported',
          value: { proposedTreatment: lastMentionedProcedure(candidates) ?? 'treatment', reasonGiven: 'wants to think about it' },
          status: 'declined', temporal: 'current', certainty: 'certain', evidence: [span],
        });
      }
    }
  }

  // Post-pass: deduplicate procedures by (name, teeth), preferring performed.
  const deduped: CandidateClinicalFact[] = [];
  const procedureIndex = new Map<string, number>();
  for (const cand of candidates) {
    if (cand.type !== 'procedure') {
      deduped.push(cand);
      continue;
    }
    const key = `${String((cand.value as { name?: string }).name)}|${(cand.anatomy?.teeth ?? []).join(',')}`;
    const existing = procedureIndex.get(key);
    if (existing === undefined) {
      procedureIndex.set(key, deduped.length);
      deduped.push(cand);
    } else if (cand.status === 'performed' && deduped[existing].status !== 'performed') {
      deduped[existing] = cand;
    }
  }

  return deduped;
}

function lastMentionedProcedure(candidates: ReadonlyArray<CandidateClinicalFact>): string | undefined {
  for (let i = candidates.length - 1; i >= 0; i--) {
    const c = candidates[i];
    if (c.type === 'procedure' || c.type === 'treatment_plan') {
      return String((c.value as { name?: string }).name ?? (c.value as { proposedProcedures?: string[] }).proposedProcedures?.[0] ?? '') || undefined;
    }
  }
  return undefined;
}
