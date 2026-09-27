/**
 * Selective Verification Trigger Matrix (Phase 6)
 *
 * DETERMINISTIC PRE-GATE — not a reasoning layer. Every trigger is an explicit,
 * independently testable predicate over the canonical fact set plus the
 * deterministic validation findings (Phase 5 treatment-status + contradiction
 * flags). Verifiers must NEVER be invoked merely because a fact exists; a
 * clean, well-evidenced fact set triggers nothing.
 *
 * Every trigger carries a severity and a reason. Output is auditable.
 */

import type {
  ClinicalFact,
  ClinicalFactType,
  FactSpeaker,
} from '../../types/clinicalFact';
import type { TreatmentStatusSignals } from '../treatmentStatus';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VerificationTriggerType =
  | 'ambiguous_tooth_number'
  | 'conflicting_tooth_references'
  | 'uncertain_speaker_attribution'
  | 'low_asr_confidence'
  | 'negation_ambiguity'
  | 'planned_performed_ambiguity'
  | 'historical_current_ambiguity'
  | 'medication_conflict'
  | 'dose_conflict'
  | 'allergy_conflict'
  | 'procedure_status_conflict'
  | 'contradictory_facts'
  | 'diagnosis_inferred_not_supported'
  | 'missing_evidence_high_risk'
  | 'entity_mismatch'
  | 'unclear_material_or_anaesthetic'
  | 'patient_statement_promoted_to_clinician_finding'
  | 'uncertain_surface';

export type VerificationTriggerSeverity = 'critical' | 'high' | 'moderate' | 'low';

export interface VerificationTrigger {
  readonly trigger: VerificationTriggerType;
  readonly severity: VerificationTriggerSeverity;
  /** Fact ids the trigger applies to. Empty for set-level triggers. */
  readonly factIds: ReadonlyArray<string>;
  /** Human-auditable explanation of what condition fired. */
  readonly reason: string;
}

/** Facts where missing evidence is never acceptable (fail closed). */
const HIGH_RISK_TYPES: ReadonlySet<ClinicalFactType> = new Set([
  'medication',
  'allergy',
  'diagnosis',
  'procedure',
] as const);

/** Fact types where low ASR confidence on evidence is a critical concern. */
const CRITICAL_EVIDENCE_TYPES: ReadonlySet<ClinicalFactType> = new Set([
  ...HIGH_RISK_TYPES,
  'anaesthetic',
] as const);

/** Finding types where absent surface detail is clinically material. */
const SURFACE_RELEVANT_TYPES: ReadonlySet<ClinicalFactType> = new Set([
  'tooth_finding',
] as const);

/** Medication classes where a transcript-level conflict is a safety event. */
const ANTICOAGULANT_RE = /\b(warfarin|coumadin|marevan|eliquis|apixaban|xarelto|rivaroxaban|pradaxa|dabigatran|plavix|clopidogrel|brilinta|ticagrelor|aspirin)\b/i;
const ALLERGEN_RE = /\b(penicillin|amoxicillin|augmentin|cephalosporin|keflex|latex|chlorhexidine|codeine|aspirin|nsaid|sulfa|bactrim|iodine|adrenaline|lignocaine|lidocaine|articaine)\b/i;

/** Dose-like fragment: number + unit, used to compare transcript vs fact. */
const DOSE_RE = /(\d+(?:\.\d+)?)\s*(mg|ml|micrograms?|mcg|units?|%|cartridges?)\b/i;

interface TriggerContext {
  /** Speaker labels present in the source transcript, if diarized. */
  readonly hasDiarization: boolean;
  /** Per-utterance transcript text (id → text) for entity cross-checks. */
  readonly utteranceTexts: ReadonlyMap<string, string>;
  /** Aggregated deterministic status signals from the transcript. */
  readonly transcriptSignals: TreatmentStatusSignals;
  /** ASR confidence for an utterance id, when the ASR supplies it. */
  readonly asrConfidence?: ReadonlyMap<string, number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function evidenceUtterances(fact: ClinicalFact): string[] {
  return fact.evidence
    .map(span => span.utteranceId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

function toothNumbers(fact: ClinicalFact): number[] {
  return (fact.anatomy?.teeth ?? []).map(t => t.tooth);
}

/**
 * True when the fact's evidence mentions a tooth number that the fact's
 * anatomy does not contain — i.e. the extractor may have bound the wrong tooth.
 */
function factIgnoresToothInEvidence(fact: ClinicalFact): number | undefined {
  const factTeeth = new Set(toothNumbers(fact));
  for (const span of fact.evidence) {
    const text = span.rawText || '';
    // Conservative: only trust bare two-digit FDI ranges in evidence text.
    const matches = text.match(/\b([1-8][1-8])\b/g) || [];
    for (const m of matches) {
      const n = parseInt(m, 10);
      if (n >= 11 && n <= 48 && !factTeeth.has(n)) {
        return n;
      }
    }
  }
  return undefined;
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Trigger evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluates all explicit triggers. A well-formed fact set with evidence and
 * consistent attribution fires none of these.
 */
export function evaluateVerificationTriggers(
  facts: ReadonlyArray<ClinicalFact>,
  ctx: TriggerContext
): VerificationTrigger[] {
  const triggers: VerificationTrigger[] = [];

  for (const fact of facts) {
    // 1. Missing evidence on high-risk facts — fail closed.
    if (HIGH_RISK_TYPES.has(fact.type) && fact.evidence.length === 0) {
      triggers.push({
        trigger: 'missing_evidence_high_risk',
        severity: 'critical',
        factIds: [fact.id],
        reason: `High-risk fact of type '${fact.type}' has no source evidence.`,
      });
    }

    // 2. Uncertain speaker attribution: un-diarized source or unknown speaker.
    if (!ctx.hasDiarization || fact.speaker === 'unknown') {
      triggers.push({
        trigger: 'uncertain_speaker_attribution',
        severity: 'high',
        factIds: [fact.id],
        reason: !ctx.hasDiarization
          ? 'Transcript is not diarized; speaker attribution is undetermined.'
          : `Fact speaker is 'unknown'.`,
      });
    }

    // 3. Low ASR confidence on the fact's evidence.
    if (ctx.asrConfidence && fact.evidence.length > 0) {
      const confidences = fact.evidence
        .map(span => ctx.asrConfidence!.get(span.utteranceId))
        .filter((c): c is number => typeof c === 'number');
      if (confidences.length > 0) {
        const min = Math.min(...confidences);
        if (min < 0.60) {
          triggers.push({
            trigger: 'low_asr_confidence',
            severity: CRITICAL_EVIDENCE_TYPES.has(fact.type) ? 'critical' : 'moderate',
            factIds: [fact.id],
            reason: `Evidence utterance confidence ${min.toFixed(2)} is below the 0.60 threshold.`,
          });
        }
      }
    }

    // 4. Ambiguous tooth number: the fact's own evidence names a different
    //    tooth than the fact's anatomy claims.
    const mismatchedTooth = factIgnoresToothInEvidence(fact);
    if (mismatchedTooth !== undefined) {
      triggers.push({
        trigger: 'ambiguous_tooth_number',
        severity: 'critical',
        factIds: [fact.id],
        reason: `Fact anatomy cites tooth ${toothNumbers(fact).join(', ') || 'none'} but its evidence mentions tooth ${mismatchedTooth}.`,
      });
    }

    // 5. Uncertain surface: surface-relevant fact carries no surface detail.
    if (SURFACE_RELEVANT_TYPES.has(fact.type) && toothNumbers(fact).length > 0 && !(fact.anatomy?.surfaces?.length)) {
      triggers.push({
        trigger: 'uncertain_surface',
        severity: 'low',
        factIds: [fact.id],
        reason: `Surface-relevant fact on tooth ${toothNumbers(fact).join(', ')} has no surface detail.`,
      });
    }

    // 6. Unclear material / anaesthetic detail.
    if (fact.type === 'anaesthetic') {
      const value = fact.value as { agent?: string; technique?: string };
      if (!value?.agent?.trim() || !value?.technique?.trim()) {
        triggers.push({
          trigger: 'unclear_material_or_anaesthetic',
          severity: 'moderate',
          factIds: [fact.id],
          reason: `Anaesthetic fact is missing agent or technique.`,
        });
      }
    }
    if (fact.type === 'material' && !String((fact.value as { name?: string })?.name ?? '').trim()) {
      triggers.push({
        trigger: 'unclear_material_or_anaesthetic',
        severity: 'moderate',
        factIds: [fact.id],
        reason: `Material fact has no name.`,
      });
    }

    // 7. Diagnosis inferred rather than explicitly supported.
    if (fact.type === 'diagnosis' && fact.extractionMethod === 'inferred') {
      triggers.push({
        trigger: 'diagnosis_inferred_not_supported',
        severity: 'critical',
        factIds: [fact.id],
        reason: `Diagnosis was inferred by the extraction layer rather than explicitly spoken.`,
      });
    }

    // 8. Negation ambiguity: a fact whose evidence contains a semantic
    //    negation while the fact is not itself negated.
    if (fact.status !== 'negated') {
      for (const span of fact.evidence) {
        if (/\b(no|not|denies|denied|without)\b/i.test(span.rawText || '')) {
          triggers.push({
            trigger: 'negation_ambiguity',
            severity: 'high',
            factIds: [fact.id],
            reason: `Evidence span contains a negation cue while the fact status is '${fact.status}'.`,
          });
          break;
        }
      }
    }

    // 9. Patient statement promoted to clinician finding.
    if (
      fact.speaker === 'patient' &&
      (fact.evidenceType === 'clinician_observed' || fact.evidenceType === 'clinician_interpretation')
    ) {
      triggers.push({
        trigger: 'patient_statement_promoted_to_clinician_finding',
        severity: 'critical',
        factIds: [fact.id],
        reason: `Patient-voiced fact is recorded with evidenceType '${fact.evidenceType}'.`,
      });
    }

    // 10. Procedure-status ambiguity against deterministic transcript signals.
    if (fact.type === 'procedure') {
      if (fact.status === 'performed' && !ctx.transcriptSignals.performed) {
        triggers.push({
          trigger: 'procedure_status_conflict',
          severity: 'critical',
          factIds: [fact.id],
          reason: `Procedure is recorded 'performed' but no performed treatment appears in the transcript signals.`,
        });
      }
      if (fact.status === 'performed' && (ctx.transcriptSignals.negated || ctx.transcriptSignals.declined)) {
        triggers.push({
          trigger: 'procedure_status_conflict',
          severity: 'critical',
          factIds: [fact.id],
          reason: `Procedure is recorded 'performed' while the transcript negates or declines treatment.`,
        });
      }
      if (fact.status === 'planned' && ctx.transcriptSignals.performed) {
        triggers.push({
          trigger: 'planned_performed_ambiguity',
          severity: 'high',
          factIds: [fact.id],
          reason: `Procedure is recorded 'planned' while the transcript contains performed treatment.`,
        });
      }
      if (fact.status === 'historical' && ctx.transcriptSignals.performed) {
        triggers.push({
          trigger: 'historical_current_ambiguity',
          severity: 'high',
          factIds: [fact.id],
          reason: `Procedure is recorded 'historical' while the transcript contains performed treatment.`,
        });
      }
    }

    // 11. Medication / allergy / dose conflicts against the transcript.
    if (fact.type === 'medication') {
      const value = fact.value as { drugName?: string; dose?: string };
      const drug = (value?.drugName ?? '').toLowerCase();
      const transcriptText = [...ctx.utteranceTexts.values()].map(normalise).join(' ');

      if (ANTICOAGULANT_RE.test(drug) && transcriptText && !transcriptText.includes(drug)) {
        triggers.push({
          trigger: 'medication_conflict',
          severity: 'critical',
          factIds: [fact.id],
          reason: `High-risk medication '${value?.drugName}' does not appear in the transcript.`,
        });
      }

      const factDose = (value?.dose ?? '').match(DOSE_RE);
      if (factDose) {
        const drugMentionRegex = new RegExp(`${drug.split(' ')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^.]*`, 'i');
        const relevant = drug ? (transcriptText.match(drugMentionRegex) ?? []) : [];
        const spokenDose = relevant.join(' ').match(DOSE_RE);
        if (spokenDose && spokenDose[1] !== factDose[1]) {
          triggers.push({
            trigger: 'dose_conflict',
            severity: 'critical',
            factIds: [fact.id],
            reason: `Fact dose '${value?.dose}' differs from spoken dose '${spokenDose[0]}'.`,
          });
        }
      }
    }

    if (fact.type === 'allergy') {
      const value = fact.value as { allergen?: string };
      const allergen = (value?.allergen ?? '').toLowerCase();
      const transcriptText = [...ctx.utteranceTexts.values()].map(normalise).join(' ');
      if (ALLERGEN_RE.test(allergen) && transcriptText && !transcriptText.includes(allergen.split(' ')[0])) {
        triggers.push({
          trigger: 'allergy_conflict',
          severity: 'critical',
          factIds: [fact.id],
          reason: `Allergen '${value?.allergen}' does not appear in the transcript.`,
        });
      }
    }
  }

  // 12. Conflicting tooth references: two facts claim the same finding on
  //     different teeth.
  const seenFindingTooth = new Map<string, Set<number>>();
  for (const fact of facts) {
    if (fact.type === 'tooth_finding') {
      const condition = normalise(String((fact.value as { condition?: string })?.condition ?? ''));
      if (!condition) continue;
      const key = condition;
      const set = seenFindingTooth.get(key) ?? new Set<number>();
      for (const t of toothNumbers(fact)) set.add(t);
      seenFindingTooth.set(key, set);
    }
  }
  for (const [condition, teeth] of seenFindingTooth) {
    if (teeth.size > 1) {
      triggers.push({
        trigger: 'conflicting_tooth_references',
        severity: 'critical',
        factIds: [],
        reason: `Finding '${condition}' is attributed to multiple teeth: ${[...teeth].sort((a, b) => a - b).join(', ')}.`,
      });
    }
  }

  // 13. Contradictory facts: a negated and a non-negated fact of the same
  //     type describing the same value domain.
  const byType = new Map<ClinicalFactType, ClinicalFact[]>();
  for (const fact of facts) {
    const list = byType.get(fact.type) ?? [];
    list.push(fact);
    byType.set(fact.type, list);
  }
  for (const [, list] of byType) {
    const negated = list.filter(f => f.status === 'negated');
    const asserted = list.filter(f => f.status !== 'negated');
    if (negated.length > 0 && asserted.length > 0) {
      triggers.push({
        trigger: 'contradictory_facts',
        severity: 'critical',
        factIds: [...negated, ...asserted].map(f => f.id),
        reason: `Type '${list[0].type}' contains both negated and asserted facts.`,
      });
    }
  }

  // 14. Entity mismatch: fact evidence references utterances absent from the
  //     transcript map (ungroundable provenance).
  for (const fact of facts) {
    for (const span of fact.evidence) {
      if (ctx.utteranceTexts.size > 0 && !ctx.utteranceTexts.has(span.utteranceId)) {
        triggers.push({
          trigger: 'entity_mismatch',
          severity: 'high',
          factIds: [fact.id],
          reason: `Evidence span references utterance '${span.utteranceId}' which is not present in the transcript.`,
        });
        break;
      }
    }
  }

  return triggers;
}
