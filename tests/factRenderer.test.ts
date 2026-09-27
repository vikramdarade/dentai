import { describe, it, expect } from 'vitest';
import { createCanonicalClinicalFact, isFactConstructionFailure } from '../src/lib/clinicalFactMigration';
import { renderClinicalNote } from '../src/lib/factRenderer';
import type { ClinicalFact, CandidateClinicalFact } from '../src/types/clinicalFact';

function mk(candidate: CandidateClinicalFact): ClinicalFact {
  const result = createCanonicalClinicalFact(candidate);
  if (isFactConstructionFailure(result)) {
    throw new Error(`fact construction failed: ${result.errors.join('; ')}`);
  }
  return result.fact;
}

const span = (id: string, text: string) => ({ utteranceId: id, rawText: text, source: 'transcript' as const });

/**
 * Assert no fabricated default tokens appear anywhere in the note. Tokens the
 * transcript genuinely spoke (passed as `spoken`) are exempt — the invariant
 * is that UNSPOKEN defaults never appear.
 */
function expectNoDefaults(
  rendered: ReturnType<typeof renderClinicalNote>,
  spoken: ReadonlyArray<RegExp> = []
): void {
  const all = JSON.stringify(rendered.sections) + rendered.patientSummary;
  const defaults: ReadonlyArray<RegExp> = [
    /Articaine/i,
    /adrenaline/i,
    /2\.2\s?mL/i,
    /\bA3\b/,
    /profound/i,
    /Cotton roll/i,
    /Rubber dam/i,
    /verbal informed consent/i,
    /POIG/i,
    /TTP/,
    /6 months recall/i,
  ];
  for (const d of defaults) {
    // Skip defaults the transcript genuinely spoke (exempt list).
    if (spoken.some(s => s.source === d.source)) continue;
    expect(all).not.toMatch(d);
  }
}

/** Section VALUES only (keys like "consent" are structure, not content). */
function sectionValues(rendered: ReturnType<typeof renderClinicalNote>): string {
  return Object.values(rendered.sections).join('\n') + rendered.patientSummary;
}

describe('Phase 7 deterministic fact renderer — clinical cases', () => {
  it('routine examination', () => {
    const note = renderClinicalNote([
      mk({
        id: 'e1', type: 'examination', speaker: 'clinician', evidenceType: 'clinician_observed',
        value: { site: 'soft tissues', finding: 'healthy' }, status: 'observed', temporal: 'current',
        certainty: 'certain', extractionMethod: 'verbatim', evidence: [span('u1', 'Soft tissues healthy.')],
      }),
      mk({
        id: 'e2', type: 'recall_plan', speaker: 'clinician', evidenceType: 'instruction',
        value: { intervalMonths: 6, reason: 'routine' }, status: 'planned', temporal: 'future',
        certainty: 'certain', extractionMethod: 'verbatim', evidence: [span('u2', 'See you in six months.')],
      }),
    ]);
    expect(note.sections.toothFindings).toContain('soft tissues healthy');
    expect(note.sections.recallRequirements).toContain('6 months');
    expectNoDefaults(note);
  });

  it('emergency consultation', () => {
    const note = renderClinicalNote([
      mk({
        id: 'em1', type: 'chief_complaint', speaker: 'patient', evidenceType: 'patient_reported',
        value: { complaint: 'severe lower left toothache', duration: '3 days' }, status: 'reported', temporal: 'current',
        certainty: 'certain', extractionMethod: 'verbatim', evidence: [span('u1', 'Bad toothache lower left three days.')],
      }),
      mk({
        id: 'em2', type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed',
        value: { condition: 'pericoronitis' }, status: 'observed', temporal: 'current',
        certainty: 'certain', extractionMethod: 'verbatim', anatomy: { teeth: [38] },
        evidence: [span('u2', 'Pericoronitis around 38.')],
      }),
      mk({
        id: 'em3', type: 'diagnosis', speaker: 'clinician', evidenceType: 'clinician_interpretation',
        value: { condition: 'acute pericoronitis', provisional: false }, status: 'observed', temporal: 'current',
        certainty: 'certain', extractionMethod: 'verbatim', anatomy: { teeth: [38] },
        evidence: [span('u3', 'Diagnosis acute pericoronitis 38.')],
      }),
    ]);
    expect(note.sections.chiefComplaint).toContain('Patient reports');
    expect(note.sections.chiefComplaint).toContain('severe lower left toothache');
    expect(note.sections.chiefComplaint).toContain('3 days');
    expect(note.sections.toothFindings).toContain('#38');
    expect(note.sections.diagnosis).toContain('acute pericoronitis');
    expectNoDefaults(note);
  });

  it('restorative — renders only spoken anaesthetic/material, never a default shade', () => {
    const note = renderClinicalNote([
      mk({
        id: 'r1', type: 'procedure', speaker: 'clinician', evidenceType: 'clinician_observed',
        value: { name: 'composite restoration' }, status: 'performed', temporal: 'completed_today',
        certainty: 'certain', extractionMethod: 'verbatim', anatomy: { teeth: [26], surfaces: ['O'] },
        evidence: [span('u1', 'Composite restoration on 26.')],
      }),
      mk({
        id: 'r2', type: 'anaesthetic', speaker: 'clinician', evidenceType: 'clinician_observed',
        value: { agent: '4% Articaine', technique: 'infiltration' }, status: 'performed', temporal: 'completed_today',
        certainty: 'certain', extractionMethod: 'verbatim', evidence: [span('u2', 'Articaine infiltration.')],
      }),
      mk({
        id: 'r3', type: 'material', speaker: 'clinician', evidenceType: 'clinician_observed',
        value: { name: 'composite resin' }, status: 'performed', temporal: 'completed_today',
        certainty: 'certain', extractionMethod: 'verbatim', evidence: [span('u3', 'Composite resin placed.')],
      }),
    ]);
    expect(note.sections.treatmentPerformed).toContain('composite restoration');
    expect(note.sections.treatmentPerformed).toContain('#26 (O)');
    expect(note.sections.treatmentPerformed).toContain('Local anaesthetic: 4% Articaine');
    expect(note.sections.treatmentPerformed).toContain('composite resin');
    // Spoken agent renders; adrenaline/volume were never spoken ⇒ absent.
    expect(note.sections.treatmentPerformed).not.toMatch(/adrenaline/i);
    expect(note.sections.treatmentPerformed).not.toMatch(/mL/);
    expectNoDefaults(note, [/Articaine/i]);
  });

  it('endodontic — technique only when spoken; medication instructions render with dose', () => {
    const note = renderClinicalNote([
      mk({
        id: 'n1', type: 'procedure', speaker: 'clinician', evidenceType: 'clinician_observed',
        value: { name: 'extirpation', technique: 'under rubber dam' }, status: 'performed', temporal: 'completed_today',
        certainty: 'certain', extractionMethod: 'verbatim', anatomy: { teeth: [36] },
        evidence: [span('u1', 'Extirpation 36 under rubber dam.')],
      }),
      mk({
        id: 'n2', type: 'medication_instruction', speaker: 'clinician', evidenceType: 'instruction',
        value: { drug: 'ibuprofen', dose: '400 mg', frequency: 'three times daily', duration: '3 days' },
        status: 'planned', temporal: 'future', certainty: 'certain', extractionMethod: 'verbatim',
        evidence: [span('u2', 'Ibuprofen 400 three times a day for three days.')],
      }),
    ]);
    expect(note.sections.treatmentPerformed).toContain('extirpation');
    expect(note.sections.treatmentPerformed).toContain('under rubber dam');
    expect(note.sections.recommendations).toContain('Advise ibuprofen 400 mg three times daily for 3 days');
    expectNoDefaults(note, [/Rubber dam/i]);
  });

  it('periodontal — BPE and calculus from facts only', () => {
    const note = renderClinicalNote([
      mk({
        id: 'p1', type: 'periodontal_finding', speaker: 'clinician', evidenceType: 'clinician_observed',
        value: { bpeScores: '3,2,3,3,2,3', calculus: 'subgingival', bleedingOnProbing: true },
        status: 'observed', temporal: 'current', certainty: 'certain', extractionMethod: 'verbatim',
        evidence: [span('u1', 'BPE threes generalised, subgingival calculus, bleeding on probing.')],
      }),
      mk({
        id: 'p2', type: 'recall_plan', speaker: 'clinician', evidenceType: 'instruction',
        value: { intervalMonths: 3, reason: 'perio review' }, status: 'planned', temporal: 'future',
        certainty: 'certain', extractionMethod: 'verbatim', evidence: [span('u2', 'Review in three months.')],
      }),
    ]);
    expect(note.sections.findingsGingival).toContain('BPE 3,2,3,3,2,3');
    expect(note.sections.findingsGingival).toContain('subgingival calculus');
    expect(note.sections.findingsGingival).toContain('bleeding on probing');
    expect(note.sections.recallRequirements).toContain('3 months');
    expectNoDefaults(note);
  });

  it('prosthodontic — crown preparation with spoken material only', () => {
    const note = renderClinicalNote([
      mk({
        id: 'pr1', type: 'procedure', speaker: 'clinician', evidenceType: 'clinician_observed',
        value: { name: 'crown preparation' }, status: 'performed', temporal: 'completed_today',
        certainty: 'certain', extractionMethod: 'verbatim', anatomy: { teeth: [16] },
        evidence: [span('u1', 'Prepped 16 for crown.')],
      }),
      mk({
        id: 'pr2', type: 'material', speaker: 'clinician', evidenceType: 'clinician_observed',
        value: { name: 'temporary crown' }, status: 'performed', temporal: 'completed_today',
        certainty: 'certain', extractionMethod: 'verbatim', evidence: [span('u2', 'Temporary crown cemented.')],
      }),
    ]);
    expect(note.sections.treatmentPerformed).toContain('crown preparation');
    expect(note.sections.treatmentPerformed).toContain('#16');
    expect(note.sections.treatmentPerformed).toContain('temporary crown');
    expectNoDefaults(note);
  });

  it('oral surgery — extraction with spoken suture material', () => {
    const note = renderClinicalNote([
      mk({
        id: 's1', type: 'procedure', speaker: 'clinician', evidenceType: 'clinician_observed',
        value: { name: 'surgical extraction' }, status: 'performed', temporal: 'completed_today',
        certainty: 'certain', extractionMethod: 'verbatim', anatomy: { teeth: [48] },
        evidence: [span('u1', 'Surgical extraction 48.')],
      }),
      mk({
        id: 's2', type: 'material', speaker: 'clinician', evidenceType: 'clinician_observed',
        value: { name: '4-0 Vicryl suture' }, status: 'performed', temporal: 'completed_today',
        certainty: 'certain', extractionMethod: 'verbatim', evidence: [span('u2', 'Vicryl suture.')],
      }),
    ]);
    expect(note.sections.treatmentPerformed).toContain('surgical extraction');
    expect(note.sections.treatmentPerformed).toContain('#48');
    expect(note.sections.treatmentPerformed).toContain('4-0 Vicryl suture');
    expectNoDefaults(note);
  });

  it('implant — placement with follow-up', () => {
    const note = renderClinicalNote([
      mk({
        id: 'i1', type: 'procedure', speaker: 'clinician', evidenceType: 'clinician_observed',
        value: { name: 'implant fixture placement' }, status: 'performed', temporal: 'completed_today',
        certainty: 'certain', extractionMethod: 'verbatim', anatomy: { teeth: [46] },
        evidence: [span('u1', 'Implant placed at 46.')],
      }),
      mk({
        id: 'i2', type: 'follow_up', speaker: 'clinician', evidenceType: 'instruction',
        value: { timeframe: '2 weeks', action: 'review healing' }, status: 'planned', temporal: 'future',
        certainty: 'certain', extractionMethod: 'verbatim', evidence: [span('u2', 'See you in two weeks.')],
      }),
    ]);
    expect(note.sections.treatmentPerformed).toContain('implant fixture placement');
    expect(note.sections.recommendations).toContain('Follow up 2 weeks review healing');
    expectNoDefaults(note);
  });

  it('paediatric — deciduous tooth rendering (FDI 54)', () => {
    const note = renderClinicalNote([
      mk({
        id: 'pd1', type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed',
        value: { condition: 'caries' }, status: 'observed', temporal: 'current',
        certainty: 'certain', extractionMethod: 'verbatim', anatomy: { teeth: [54], surfaces: ['O'] },
        evidence: [span('u1', 'Caries in 54.')],
      }),
      mk({
        id: 'pd2', type: 'procedure', speaker: 'clinician', evidenceType: 'clinician_observed',
        value: { name: 'fissure sealant' }, status: 'performed', temporal: 'completed_today',
        certainty: 'certain', extractionMethod: 'verbatim', anatomy: { teeth: [54], surfaces: ['O'] },
        evidence: [span('u2', 'Sealed 54.')],
      }),
    ]);
    expect(note.sections.toothFindings).toContain('#54 (O)');
    expect(note.sections.treatmentPerformed).toContain('#54 (O)');
    expectNoDefaults(note);
  });

  it('hygiene — scale and clean with hygiene instruction', () => {
    const note = renderClinicalNote([
      mk({
        id: 'h1', type: 'procedure', speaker: 'clinician', evidenceType: 'clinician_observed',
        value: { name: 'scale and clean' }, status: 'performed', temporal: 'completed_today',
        certainty: 'certain', extractionMethod: 'verbatim', evidence: [span('u1', 'Scaled and cleaned.')],
      }),
      mk({
        id: 'h2', type: 'oral_hygiene_instruction', speaker: 'clinician', evidenceType: 'instruction',
        value: { instruction: 'daily interdental brushing' }, status: 'planned', temporal: 'future',
        certainty: 'certain', extractionMethod: 'verbatim', evidence: [span('u2', 'Brush between teeth daily.')],
      }),
    ]);
    expect(note.sections.treatmentPerformed).toContain('scale and clean');
    expect(note.sections.recommendations).toContain('Advise daily interdental brushing');
    expectNoDefaults(note);
  });

  it('preventive — risk factor counselling', () => {
    const note = renderClinicalNote([
      mk({
        id: 'v1', type: 'risk_factor', speaker: 'clinician', evidenceType: 'instruction',
        value: { factor: 'frequent sugary drinks', clinicalImplication: 'caries risk' },
        status: 'discussed', temporal: 'current', certainty: 'certain', extractionMethod: 'verbatim',
        evidence: [span('u1', 'Soft drinks between meals increase decay risk.')],
      }),
    ]);
    expect(note.sections.history).toContain('frequent sugary drinks');
    expect(note.sections.history).toContain('caries risk');
    expectNoDefaults(note);
  });

  it('referral', () => {
    const note = renderClinicalNote([
      mk({
        id: 'rf1', type: 'referral', speaker: 'clinician', evidenceType: 'instruction',
        value: { specialty: 'oral surgery', urgency: 'routine', reason: 'impacted 38' },
        status: 'planned', temporal: 'future', certainty: 'certain', extractionMethod: 'verbatim',
        evidence: [span('u1', 'Refer to oral surgeons for the wisdom tooth.')],
      }),
    ]);
    expect(note.sections.referral).toContain('Refer to oral surgery');
    expect(note.sections.referral).toContain('impacted 38');
    expect(note.sections.referral).toContain('[routine]');
    expectNoDefaults(note);
  });

  it('recall', () => {
    const note = renderClinicalNote([
      mk({
        id: 'rc1', type: 'recall_plan', speaker: 'clinician', evidenceType: 'instruction',
        value: { intervalMonths: 12 }, status: 'planned', temporal: 'future',
        certainty: 'certain', extractionMethod: 'verbatim', evidence: [span('u1', 'Back in a year.')],
      }),
    ]);
    expect(note.sections.recallRequirements).toBe('Recall in 12 months');
    expectNoDefaults(note);
  });

  it('medication — history renders drug, dose, frequency', () => {
    const note = renderClinicalNote([
      mk({
        id: 'm1', type: 'medication', speaker: 'patient', evidenceType: 'patient_reported',
        value: { drugName: 'Warfarin', dose: '5 mg', frequency: 'daily' }, status: 'reported', temporal: 'current',
        certainty: 'certain', extractionMethod: 'verbatim', evidence: [span('u1', 'Warfarin 5 mg daily.')],
      }),
    ]);
    expect(note.sections.history).toContain('Patient reports takes Warfarin 5 mg daily');
    expectNoDefaults(note);
  });

  it('allergy — allergen and reaction from facts only', () => {
    const note = renderClinicalNote([
      mk({
        id: 'a1', type: 'allergy', speaker: 'patient', evidenceType: 'patient_reported',
        value: { allergen: 'Penicillin', reaction: 'hives' }, status: 'reported', temporal: 'current',
        certainty: 'certain', extractionMethod: 'verbatim', evidence: [span('u1', 'Hives with penicillin.')],
      }),
    ]);
    expect(note.sections.history).toContain('allergy to Penicillin (hives)');
    expectNoDefaults(note);
  });

  it('negation — negated findings and procedures render as explicit negatives', () => {
    const note = renderClinicalNote([
      mk({
        id: 'ng1', type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed',
        value: { condition: 'caries' }, status: 'negated', temporal: 'current',
        certainty: 'certain', extractionMethod: 'verbatim', anatomy: { teeth: [36], surfaces: ['O'] },
        negationScope: 'no caries detected on 36',
        evidence: [span('u1', 'No caries detected on 36.')],
      }),
      mk({
        id: 'ng2', type: 'procedure', speaker: 'clinician', evidenceType: 'clinician_observed',
        value: { name: 'composite restoration' }, status: 'negated', temporal: 'current',
        certainty: 'certain', extractionMethod: 'verbatim', anatomy: { teeth: [36] },
        negationScope: 'no filling was placed today',
        evidence: [span('u2', 'No filling was placed today.')],
      }),
    ]);
    expect(note.sections.toothFindings).toMatch(/No caries/);
    expect(note.sections.treatmentPerformed).toMatch(/No composite restoration/);
    expectNoDefaults(note);
  });

  it('historical — past treatment lands in history, never in treatment performed', () => {
    const note = renderClinicalNote([
      mk({
        id: 'hi1', type: 'procedure', speaker: 'patient', evidenceType: 'patient_reported',
        value: { name: 'crown' }, status: 'historical', temporal: 'historical',
        certainty: 'certain', extractionMethod: 'verbatim', anatomy: { teeth: [36] },
        evidence: [span('u1', 'Had a crown on that tooth last year.')],
      }),
    ]);
    expect(note.sections.history).toContain('crown');
    expect(note.sections.history).toContain('Patient reports');
    expect(note.sections.treatmentPerformed).toBe('');
    expectNoDefaults(note);
  });

  it('planned — future treatment stays in plan section', () => {
    const note = renderClinicalNote([
      mk({
        id: 'pl1', type: 'procedure', speaker: 'clinician', evidenceType: 'discussion',
        value: { name: 'extraction' }, status: 'planned', temporal: 'next_appointment',
        certainty: 'certain', extractionMethod: 'verbatim', anatomy: { teeth: [38] },
        evidence: [span('u1', 'We will take 38 out next visit.')],
      }),
    ]);
    expect(note.sections.treatmentPlanned).toContain('extraction');
    expect(note.sections.treatmentPlanned).toContain('#38');
    expect(note.sections.treatmentPerformed).toBe('');
    expectNoDefaults(note);
  });

  it('declined — refusal renders in declined section', () => {
    const note = renderClinicalNote([
      mk({
        id: 'd1', type: 'declined_treatment', speaker: 'patient', evidenceType: 'patient_reported',
        value: { proposedTreatment: 'root canal treatment', reasonGiven: 'cost' },
        status: 'declined', temporal: 'current', certainty: 'certain', extractionMethod: 'verbatim',
        evidence: [span('u1', 'Not doing the root canal, too expensive.')],
      }),
    ]);
    expect(note.sections.treatmentDeclined).toContain('declined root canal treatment');
    expect(note.sections.treatmentDeclined).toContain('(cost)');
    expect(note.sections.treatmentPerformed).toBe('');
    expectNoDefaults(note);
  });
});

describe('Phase 7 renderer safety invariants', () => {
  it('empty fact set renders an empty note (missing facts stay missing)', () => {
    const note = renderClinicalNote([]);
    for (const value of Object.values(note.sections)) {
      expect(value).toBe('');
    }
    expect(note.patientSummary).toBe('');
  });

  it('MONOTONIC: procedure without anaesthetic/material facts renders none', () => {
    const note = renderClinicalNote([
      mk({
        id: 'mono1', type: 'procedure', speaker: 'clinician', evidenceType: 'clinician_observed',
        value: { name: 'composite restoration' }, status: 'performed', temporal: 'completed_today',
        certainty: 'certain', extractionMethod: 'verbatim', anatomy: { teeth: [26], surfaces: ['O'] },
        evidence: [span('u1', 'Composite restoration on 26.')],
      }),
    ]);
    const all = JSON.stringify(note.sections);
    expect(all).not.toMatch(/Articaine|adrenaline|mL|cartridge|shade|dam|isolation/i);
    expect(note.sections.treatmentPerformed).toContain('#26 (O)');
  });

  it('MONOTONIC: no consent facts ⇒ no consent language anywhere', () => {
    const note = renderClinicalNote([
      mk({
        id: 'mono2', type: 'procedure', speaker: 'clinician', evidenceType: 'clinician_observed',
        value: { name: 'extraction' }, status: 'performed', temporal: 'completed_today',
        certainty: 'certain', extractionMethod: 'verbatim', anatomy: { teeth: [48] },
        evidence: [span('u1', 'Tooth out.')],
      }),
    ]);
    const all = sectionValues(note);
    expect(all.toLowerCase()).not.toContain('consent');
    expect(note.sections.consent).toBe('');
  });

  it('MONOTONIC: no diagnosis fact ⇒ diagnosis section stays empty', () => {
    const note = renderClinicalNote([
      mk({
        id: 'mono3', type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed',
        value: { condition: 'caries' }, status: 'observed', temporal: 'current',
        certainty: 'certain', extractionMethod: 'verbatim', anatomy: { teeth: [36], surfaces: ['O'] },
        evidence: [span('u1', 'Caries 36.')],
      }),
    ]);
    expect(note.sections.diagnosis).toBe('');
  });

  it('rendering is deterministic (byte-identical across runs)', () => {
    const facts = [
      mk({
        id: 'det1', type: 'procedure', speaker: 'clinician', evidenceType: 'clinician_observed',
        value: { name: 'composite restoration' }, status: 'performed', temporal: 'completed_today',
        certainty: 'certain', extractionMethod: 'verbatim', anatomy: { teeth: [26], surfaces: ['O'] },
        evidence: [span('u1', 'Composite 26.')],
      }),
      mk({
        id: 'det2', type: 'allergy', speaker: 'patient', evidenceType: 'patient_reported',
        value: { allergen: 'Latex' }, status: 'reported', temporal: 'current',
        certainty: 'certain', extractionMethod: 'verbatim', evidence: [span('u2', 'Latex allergy.')],
      }),
    ];
    const a = JSON.stringify(renderClinicalNote(facts));
    const b = JSON.stringify(renderClinicalNote(facts));
    expect(a).toBe(b);
  });

  it('assistant attribution is preserved distinctly', () => {
    const note = renderClinicalNote([
      mk({
        id: 'asst1', type: 'examination', speaker: 'assistant', evidenceType: 'clinician_observed',
        value: { site: 'vitals', finding: 'BP recorded 120/80' }, status: 'observed', temporal: 'current',
        certainty: 'certain', extractionMethod: 'verbatim', evidence: [span('u1', 'BP 120 over 80.')],
      }),
    ]);
    expect(note.sections.toothFindings).toContain('Assistant noted');
  });

  it('consent fact renders only the recorded patient response', () => {
    // The Phase 3 trust boundary requires patientResponse on consent facts, so
    // the renderer can only ever express the response that was extracted.
    const note = renderClinicalNote([
      mk({
        id: 'con1', type: 'consent', speaker: 'clinician', evidenceType: 'discussion',
        value: { procedureDiscussed: 'extraction', materialRisksWarned: ['numbness'], alternativesDiscussed: ['monitor'], patientResponse: 'verbally_consented' },
        status: 'discussed', temporal: 'current', certainty: 'certain', extractionMethod: 'verbatim',
        evidence: [span('u1', 'Patient consented to the extraction.')],
      }),
    ]);
    expect(note.sections.consent).toContain('verbally_consented');
    expect(note.unrenderedFactIds).toHaveLength(0);
  });
});
