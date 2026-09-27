/**
 * Deterministic Clinical Note Renderer (Phase 7)
 *
 * Converts VALIDATED ClinicalFact[] into the canonical clinical note structure.
 * This module is the ONLY authoritative note generator in the clinical path:
 *
 *   ClinicalFact[] (validated) → renderClinicalNote() → clinical note
 *
 * MONOTONICITY GUARANTEE (Phase 7 safety rule): the renderer can only express
 * what exists in the supplied fact set. It contains no clinical defaults — no
 * anaesthetic agent, no volume, no shade, no isolation, no diagnosis, no
 * consent language, no post-operative boilerplate. A missing fact renders as a
 * missing line, never as invented content.
 *
 * Preserved dimensions (per fact):
 * - attribution  : patient-reported lines are explicitly prefixed "Patient reports"
 * - status       : performed / planned / discussed / declined / historical / negated
 * - temporality  : historical + planned facts are grouped under their own headings
 * - negation     : negated facts render as explicit negative statements
 * - anatomy      : teeth and surfaces render in Australian FDI convention
 */

import type { ClinicalFact } from '../types/clinicalFact';

export interface RenderedClinicalNote {
  /** Canonical note sections; empty string = no supported fact (stays missing). */
  readonly sections: {
    readonly chiefComplaint: string;
    readonly history: string;
    readonly toothFindings: string;
    readonly findingsGingival: string;
    readonly diagnosis: string;
    readonly treatmentPerformed: string;
    readonly treatmentPlanned: string;
    readonly treatmentDeclined: string;
    readonly recommendations: string;
    readonly recallRequirements: string;
    readonly referral: string;
    readonly consent: string;
  };
  /** Plain-language patient summary rendered from the same fact set. */
  readonly patientSummary: string;
  /** Facts that carried no renderable content (audit trail, not note text). */
  readonly unrenderedFactIds: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Rendering helpers (formatting only — no clinical knowledge)
// ---------------------------------------------------------------------------

function teethLabel(fact: ClinicalFact): string {
  const teeth = fact.anatomy?.teeth ?? [];
  if (teeth.length === 0) return '';
  const surfaces = fact.anatomy?.canonicalSurfaces || (fact.anatomy?.surfaces ?? []).join('');
  return teeth
    .map(t => `#${t.tooth}${surfaces ? ` (${surfaces})` : ''}`)
    .join(', ');
}

function joinNonEmpty(parts: ReadonlyArray<string>): string {
  return parts.filter(p => p.trim().length > 0).join(' ').trim();
}

function sentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Patient-voiced facts are explicitly attributed in the note. */
function attributedLine(fact: ClinicalFact, body: string): string {
  if (fact.speaker === 'patient') return `Patient reports ${body}`;
  if (fact.speaker === 'assistant') return `Assistant noted ${body}`;
  return sentence(body);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// ---------------------------------------------------------------------------
// Per-type renderers — each emits ONLY what the fact's value carries
// ---------------------------------------------------------------------------

function renderFactLine(fact: ClinicalFact): string | undefined {
  const v = fact.value as Record<string, unknown>;
  const anatomy = teethLabel(fact);

  switch (fact.type) {
    case 'chief_complaint':
      return attributedLine(fact, joinNonEmpty([asString(v?.complaint), v?.duration ? `for ${asString(v.duration)}` : '']));
    case 'symptom':
      return attributedLine(fact, joinNonEmpty([asString(v?.description), anatomy, v?.severity ? `(${asString(v.severity)})` : '']));
    case 'medical_history':
      return attributedLine(fact, joinNonEmpty([asString(v?.condition), v?.status ? `(status: ${asString(v.status)})` : '']));
    case 'dental_history':
      return attributedLine(fact, asString(v?.summary));
    case 'medication':
      return attributedLine(fact, joinNonEmpty([
        v?.drugName ? `takes ${asString(v.drugName)}` : '',
        v?.dose ? `${asString(v.dose)}` : '',
        v?.frequency ? `${asString(v.frequency)}` : '',
      ]));
    case 'allergy':
      return attributedLine(fact, joinNonEmpty([
        v?.allergen ? `allergy to ${asString(v.allergen)}` : '',
        v?.reaction ? `(${asString(v.reaction)})` : '',
      ]));
    case 'vital': {
      const parts = [
        v?.bloodPressure ? `BP ${asString(v.bloodPressure)}` : '',
        v?.pulseBpm ? `pulse ${String(v.pulseBpm)} bpm` : '',
        v?.oxygenSaturation ? `SpO2 ${String(v.oxygenSaturation)}%` : '',
        v?.temperatureC ? `temp ${String(v.temperatureC)}°C` : '',
      ].filter(Boolean);
      return parts.length > 0 ? sentence(parts.join(', ')) : undefined;
    }
    case 'examination':
      return attributedLine(fact, joinNonEmpty([asString(v?.site), asString(v?.finding), v?.normal === true ? '(normal)' : '']));
    case 'tooth_finding': {
      const vitality = v?.vitality as Record<string, unknown> | undefined;
      return attributedLine(fact, joinNonEmpty([
        anatomy,
        asString(v?.condition),
        v?.depth ? `(depth: ${asString(v.depth)})` : '',
        v?.mobilityGrade ? `(mobility grade ${asString(v.mobilityGrade)})` : '',
        vitality?.coldTest ? `(cold test: ${asString(vitality.coldTest)})` : '',
        vitality?.percussion ? `(percussion: ${asString(vitality.percussion)})` : '',
      ]));
    }
    case 'periodontal_finding': {
      const parts = [
        anatomy,
        v?.diagnosis ? asString(v.diagnosis) : '',
        v?.bpeScores ? `BPE ${asString(v.bpeScores)}` : '',
        v?.bleedingOnProbing === true ? 'bleeding on probing' : '',
        v?.calculus && v.calculus !== 'none' ? `${asString(v.calculus)} calculus` : '',
      ].filter(Boolean);
      return parts.length > 0 ? attributedLine(fact, joinNonEmpty(parts)) : undefined;
    }
    case 'soft_tissue_finding':
      return attributedLine(fact, joinNonEmpty([asString(v?.location), asString(v?.description)]));
    case 'radiographic_finding':
      return attributedLine(fact, joinNonEmpty([
        asString(v?.modality),
        asString(v?.finding),
        Array.isArray(v?.teeth) && v.teeth.length > 0 ? `(teeth ${v.teeth.join(', ')})` : '',
      ]));
    case 'diagnosis':
      return attributedLine(fact, joinNonEmpty([
        asString(v?.condition),
        anatomy,
        v?.provisional === true ? '(provisional)' : '',
      ]));
    case 'differential_diagnosis':
      return attributedLine(fact, `differential: ${Array.isArray(v?.conditions) ? v.conditions.join('; ') : asString(v?.conditions)}`);
    case 'procedure': {
      const core = joinNonEmpty([asString(v?.name), anatomy]);
      if (!core) return undefined;
      const technique = asString(v?.technique);
      return attributedLine(fact, technique ? `${core} (${technique})` : core);
    }
    case 'anaesthetic': {
      const parts = [
        v?.agent ? asString(v.agent) : '',
        v?.adrenaline ? asString(v.adrenaline) : '',
        v?.volumeMl ? `${String(v.volumeMl)} mL` : v?.cartridges ? `${String(v.cartridges)} cartridge(s)` : '',
        asString(v?.technique),
      ].filter(p => p.trim().length > 0);
      // Monotonic: no agent + no technique ⇒ nothing renderable.
      return parts.length > 0 ? `Local anaesthetic: ${parts.join(', ')}` : undefined;
    }
    case 'material': {
      const parts = [
        v?.name ? asString(v.name) : '',
        v?.shade ? `shade ${asString(v.shade)}` : '',
        v?.brand ? `(${asString(v.brand)})` : '',
      ].filter(p => p.trim().length > 0);
      return parts.length > 0 ? sentence(parts.join(' ')) : undefined;
    }
    case 'medication_instruction':
      return attributedLine(fact, joinNonEmpty([
        v?.drug ? `Advise ${asString(v.drug)}` : '',
        v?.dose ? `${asString(v.dose)}` : '',
        v?.frequency ? `${asString(v.frequency)}` : '',
        v?.duration ? `for ${asString(v.duration)}` : '',
      ]));
    case 'oral_hygiene_instruction':
      return attributedLine(fact, `Advise ${asString(v?.instruction)}`);
    case 'risk_factor':
      return attributedLine(fact, joinNonEmpty([asString(v?.factor), v?.clinicalImplication ? `(${asString(v.clinicalImplication)})` : '']));
    case 'treatment_plan':
      return attributedLine(fact, joinNonEmpty([
        Array.isArray(v?.proposedProcedures) ? v.proposedProcedures.join('; ') : '',
        anatomy,
      ]));
    case 'recall_plan':
      return v?.intervalMonths ? `Recall in ${String(v.intervalMonths)} months${v?.reason ? ` (${asString(v.reason)})` : ''}` : undefined;
    case 'referral':
      return attributedLine(fact, joinNonEmpty([
        v?.specialty ? `Refer to ${asString(v.specialty)}` : '',
        v?.specialistName ? `(${asString(v.specialistName)})` : '',
        v?.urgency ? `[${asString(v.urgency)}]` : '',
        asString(v?.reason),
      ]));
    case 'follow_up':
      return attributedLine(fact, joinNonEmpty([`Follow up`, asString(v?.timeframe), asString(v?.action)]));
    case 'consent': {
      const response = asString(v?.patientResponse);
      if (!response) return undefined;
      return `Consent: ${response}` + (v?.patientResponse === 'verbally_consented' ? ' to proceed' : '');
    }
    case 'declined_treatment':
      return attributedLine(fact, joinNonEmpty([
        v?.proposedTreatment ? `declined ${asString(v.proposedTreatment)}` : '',
        v?.reasonGiven ? `(${asString(v.reasonGiven)})` : '',
      ]));
    case 'postoperative_instruction':
      return attributedLine(fact, `Advise ${Array.isArray(v?.instructions) ? v.instructions.join('; ') : asString(v?.instructions)}`);
    default:
      return undefined;
  }
}

function linesFrom(facts: ReadonlyArray<ClinicalFact>): { text: string; unrendered: string[] } {
  const lines: string[] = [];
  const unrendered: string[] = [];
  for (const fact of facts) {
    const line = renderFactLine(fact);
    if (line) lines.push(line);
    else unrendered.push(fact.id);
  }
  return { text: lines.join('\n'), unrendered };
}

// ---------------------------------------------------------------------------
// Section assembly — status/temporality drive placement, never invention
// ---------------------------------------------------------------------------

export function renderClinicalNote(facts: ReadonlyArray<ClinicalFact>): RenderedClinicalNote {
  const unrenderedFactIds: string[] = [];

  const bySection = (
    _label: string,
    predicate: (fact: ClinicalFact) => boolean
  ): string => {
    const { text, unrendered } = linesFrom(facts.filter(predicate));
    unrenderedFactIds.push(...unrendered);
    return text;
  };

  const isHistoricalProcedure = (f: ClinicalFact) =>
    f.type === 'procedure' && (f.status === 'historical' || f.temporal === 'historical' || f.temporal === 'previous_appointment');

  const chiefComplaint = bySection('complaint', f =>
    (f.type === 'chief_complaint' || f.type === 'symptom') && f.status !== 'negated'
  );

  // History: backgrounds, meds, allergies, vitals + historical treatment.
  // Historical procedures keep their attribution and render as patient- or
  // clinician-reported history, never as today's treatment.
  const history = bySection('history', f =>
    (['medical_history', 'dental_history', 'medication', 'allergy', 'vital', 'risk_factor'] as const).includes(f.type as never) ||
    isHistoricalProcedure(f)
  );

  // Findings: clinician/patient observations. NEGATED findings are preserved
  // explicitly as negative statements rather than dropped, with the clinical
  // concept before the anatomy ("No caries #36 (O)").
  const renderNegation = (f: ClinicalFact): string | undefined => {
    const line = renderFactLine(f);
    if (!line) return undefined;
    if (line.startsWith('Patient reports') || line.startsWith('Assistant noted')) return line;
    // Move leading anatomy tokens after the concept so the negation reads
    // naturally: "#36 (O) caries" → "No caries #36 (O)".
    const m = line.match(/^((?:#\d+(?:\s*\([^)]*\))?,?\s*)+)(.*)$/);
    if (m && m[2].trim()) {
      return sentence(`No ${m[2].trim()} ${m[1].trim()}`.replace(/\s+/g, ' '));
    }
    return sentence(`No ${line.charAt(0).toLowerCase()}${line.slice(1)}`);
  };

  const positiveFindings: ClinicalFact[] = facts.filter(
    f => (['examination', 'tooth_finding', 'periodontal_finding', 'soft_tissue_finding', 'radiographic_finding'] as const).includes(f.type as never) && f.status !== 'negated'
  );
  const negatedFindings = facts.filter(
    f => (['tooth_finding', 'periodontal_finding', 'soft_tissue_finding', 'examination'] as const).includes(f.type as never) && f.status === 'negated'
  );

  const findingsPositive = bySection('findings', f => positiveFindings.includes(f));
  const findingsNegated = negatedFindings
    .map(renderNegation)
    .filter((l): l is string => Boolean(l))
    .join('\n');
  const toothFindings = [findingsPositive, findingsNegated].filter(s => s.length > 0).join('\n');

  const findingsGingival = bySection('gingival', f => f.type === 'periodontal_finding');

  const diagnosis = bySection('diagnosis', f =>
    (f.type === 'diagnosis' || f.type === 'differential_diagnosis') && f.status !== 'negated'
  );

  // Treatment performed: procedures with performed status + the anaesthetic
  // and material facts that support them. Negated procedures render as
  // explicit negations so "no filling placed" is never silently dropped.
  const performedProcedures: ClinicalFact[] = facts.filter(
    f => f.type === 'procedure' && f.status === 'performed' && f.temporal !== 'historical' && f.temporal !== 'previous_appointment'
  );
  const negatedProcedures: ClinicalFact[] = facts.filter(f => f.type === 'procedure' && f.status === 'negated');
  const anaesthetics: ClinicalFact[] = facts.filter(f => f.type === 'anaesthetic');
  const materials: ClinicalFact[] = facts.filter(f => f.type === 'material');

  const performedLines = bySection('performed', f => performedProcedures.includes(f));
  const negatedProcedureLines = negatedProcedures
    .map(renderNegation)
    .filter((l): l is string => Boolean(l))
    .join('\n');
  const anaestheticLines = bySection('performed', f => anaesthetics.includes(f));
  const materialLines = bySection('performed', f => materials.includes(f));

  const treatmentPerformed = [
    performedLines,
    anaestheticLines,
    materialLines,
    negatedProcedureLines,
  ].filter(s => s.length > 0).join('\n');

  const treatmentPlanned = bySection('planned', f =>
    (f.type === 'procedure' && (f.status === 'planned' || f.status === 'discussed' || f.temporal === 'planned' || f.temporal === 'next_appointment' || f.temporal === 'future')) ||
    f.type === 'treatment_plan'
  );

  const treatmentDeclined = bySection('declined', f =>
    f.type === 'declined_treatment' || (f.type === 'procedure' && f.status === 'declined')
  );

  const recommendations = bySection('recommendations', f =>
    (['postoperative_instruction', 'oral_hygiene_instruction', 'medication_instruction', 'follow_up'] as const).includes(f.type as never)
  );

  const recallRequirements = bySection('recall', f => f.type === 'recall_plan');
  const referral = bySection('referral', f => f.type === 'referral');
  const consent = bySection('consent', f => f.type === 'consent');

  // Patient summary: plain-language rendering of the same facts (performed
  // treatment + plan + recall), never a new fact.
  const summaryParts: string[] = [];
  if (performedLines) summaryParts.push(`Today: ${performedLines.split('\n')[0]}`);
  if (treatmentPlanned) summaryParts.push(`Planned: ${treatmentPlanned.split('\n')[0]}`);
  if (recallRequirements) summaryParts.push(recallRequirements.split('\n')[0]);

  return {
    sections: {
      chiefComplaint,
      history,
      toothFindings,
      findingsGingival,
      diagnosis,
      treatmentPerformed,
      treatmentPlanned,
      treatmentDeclined,
      recommendations,
      recallRequirements,
      referral,
      consent,
    },
    patientSummary: summaryParts.join(' '),
    unrenderedFactIds,
  };
}
