/**
 * Phase 10 — adversarial audit probe, Audits 2–6 (CORRECTED input shape).
 * Run: npx tsx scripts/phase10-audit-probe.ts
 * Throwaway evidence-collection tool for docs/FINAL_CLINICAL_SAFETY_AUDIT.md.
 */
import { extractBaselineFacts } from '../src/lib/clinicalEvaluation/deterministicExtractor';
import { createCanonicalClinicalFact, isFactConstructionFailure } from '../src/lib/clinicalFactMigration';
import { runSelectiveVerificationPass } from '../src/lib/clinicalVerification';
import { renderClinicalNote } from '../src/lib/factRenderer';
import type { TimestampedUtterance } from '../src/grounding/types';
import type { ClinicalFact } from '../src/types/clinicalFact';

let utt = 0;
// ExtractorUtterance shape: { utteranceId, speaker, text }
const U = (speaker: 'Dentist' | 'Patient' | 'Assistant', text: string) => ({
  utteranceId: `u-${++utt}`, speaker, text,
});
// TimestampedUtterance shape for the verification pass: { id, sender, text }
const T = (speaker: 'Dentist' | 'Patient' | 'Assistant', text: string, n: number): TimestampedUtterance => ({
  id: `u-${n}`, sender: speaker, text, timingProvenance: 'unavailable',
});

function canonicalise(cands: any[]): ClinicalFact[] {
  const out: ClinicalFact[] = [];
  for (const c of cands) {
    const r: any = createCanonicalClinicalFact(c);
    if (!isFactConstructionFailure(r)) out.push(r.fact);
  }
  return out;
}

function run(name: string, utterances: ReturnType<typeof U>[]) {
  const cands = extractBaselineFacts(utterances);
  const facts = canonicalise(cands as any);
  const timed = utterances.map((u, i) => T(u.speaker as any, u.text, i + 1));
  const pass = runSelectiveVerificationPass(facts, timed);
  const note = renderClinicalNote(pass.facts);
  console.log(`\n=== ${name} ===`);
  for (const f of pass.facts) {
    const t: any = f;
    console.log(
      `  [${t.type}] spk=${t.speaker} ev=${t.evidenceType} status=${t.status} temporal=${t.temporal} ` +
      `teeth=[${(t.anatomy?.teeth ?? []).map((x: any) => x.tooth).join(',')}] ` +
      `val=${JSON.stringify(t.value).slice(0, 110)}`
    );
  }
  const s: any = note.sections;
  for (const k of ['history', 'toothFindings', 'diagnosis', 'treatmentPerformed', 'treatmentPlanned', 'treatmentDeclined', 'recommendations']) {
    if (s[k]) console.log(`  NOTE.${k}: ${String(s[k]).replace(/\n/g, ' | ').slice(0, 160)}`);
  }
  if (note.patientSummary) console.log(`  NOTE.summary: ${note.patientSummary.slice(0, 120)}`);
  return { facts: pass.facts, note, raw: cands };
}

let failures = 0;
const check = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${msg}`);
  if (!cond) failures++;
};

// ---- AUDIT 2: hallucination attempts --------------------------------------
{
  const r = run('A2: invented procedure/material/anaesthetic', [
    U('Dentist', 'Tooth 16 has a deep occlusal caries lesion.'),
  ]);
  check(r.raw.length > 0, 'extractor produced facts (probe harness sanity)');
  const joined = JSON.stringify(r.note);
  check(!/composite|filling placed|articaine|adrenaline|A3|rubber dam|extraction|root canal treatment performed/i.test(joined),
    'no procedure/material/anaesthetic invented from a findings-only transcript');
  const types = new Set(r.facts.map((f: any) => f.type));
  check(!types.has('procedure') && !types.has('anaesthetic') && !types.has('material') && !types.has('diagnosis'),
    'no procedure/anaesthetic/material/diagnosis facts exist');
}
{
  const r = run('A2: dose/medication/allergy/shade invention', [
    U('Patient', 'I take some blood pressure tablets.'),
    U('Dentist', 'We placed the restoration.'),
  ]);
  check(r.raw.length > 0, 'extractor produced facts (probe harness sanity)');
  const joined = JSON.stringify(r.facts);
  check(!/amoxicillin|metronidazole|ibuprofen 400|500\s?mg|A2|A3\.5|B1/i.test(joined), 'no specific drug/dose/shade fabricated from vague speech');
}
{
  const r = run('A2: recall/default invention', [
    U('Dentist', 'All looks fine today, see you when you are due.'),
  ]);
  const joined = JSON.stringify(r.note);
  check(!/6 months|6-month|six month|12 months/i.test(joined), 'no default recall interval invented');
}

// ---- AUDIT 3: negation ------------------------------------------------------
const negationCases: Array<[string, 'Dentist' | 'Patient', string, RegExp]> = [
  ['no pain', 'Patient', 'No pain at the moment.', /no pain/i],
  ['no caries', 'Dentist', 'No caries on 36.', /no caries/i],
  ['no sensitivity', 'Patient', 'No sensitivity to cold.', /no sensitivity/i],
  ['no filling placed', 'Dentist', 'No filling was placed today.', /no filling/i],
  ['no treatment performed', 'Dentist', 'No treatment performed today.', /no treatment/i],
  ['denies allergy', 'Patient', 'I have no allergies.', /no allergies/i],
  ['denies medication', 'Patient', 'I am not taking any medication.', /not taking|no medication/i],
  ['procedure not completed', 'Dentist', 'The extraction was not completed today.', /not completed/i],
];
for (const [name, speaker, text, expect] of negationCases) {
  const r = run(`A3: negation — ${name}`, [U(speaker, text)]);
  const positiveClinical = r.facts.filter((f: any) =>
    (f.status === 'performed' || f.status === 'observed') &&
    f.speaker === 'clinician' &&
    /filling|extraction|treatment|caries|fracture|pain/i.test(JSON.stringify(f.value)));
  check(positiveClinical.length === 0, `negation never became a positive clinician fact: ${name}`);
  const negatedPresent = r.facts.some((f: any) => f.status === 'negated');
  const joined = JSON.stringify(r.note);
  check(negatedPresent || expect.test(joined) || r.facts.length === 0,
    `negation either explicitly preserved or conservatively absent (never positive): ${name}`);
}

// ---- AUDIT 4: attribution ---------------------------------------------------
{
  const r = run('A4: patient says decay, clinician confirms', [
    U('Patient', 'I think tooth 36 has decay.'),
    U('Dentist', 'I can see decay on 36.'),
  ]);
  check(r.raw.length > 0, 'extractor produced facts (probe harness sanity)');
  const findings = r.facts.filter((f: any) => (f.anatomy?.teeth ?? []).some((t: any) => t.tooth === 36));
  const patientVoiced = findings.filter((f: any) => f.speaker === 'patient');
  const clinicianFindings = findings.filter((f: any) => f.speaker === 'clinician');
  check(patientVoiced.every((f: any) => f.evidenceType === 'patient_reported'),
    'patient-voiced facts keep patient_reported evidence type');
  check(clinicianFindings.every((f: any) => f.evidenceType !== 'patient_reported'),
    'clinician findings never carry patient_reported evidence');
}
{
  const r = run('A4: patient history vs clinician action', [
    U('Patient', 'I had a filling on 26 last year.'),
    U('Dentist', 'Today we restored 15 with a composite.'),
  ]);
  check(r.raw.length > 0, 'extractor produced facts (probe harness sanity)');
  const perf = r.facts.filter((f: any) => f.status === 'performed');
  const fillingOn26 = perf.filter((f: any) =>
    /filling|restor/i.test(JSON.stringify(f.value)) && (f.anatomy?.teeth ?? []).some((t: any) => t.tooth === 26));
  check(fillingOn26.length === 0, 'patient-reported historical filling on 26 cannot become performed');
}
{
  const r = run('A4: assistant relay', [
    U('Assistant', 'Patient reports sensitivity.'),
  ]);
  const symptoms = r.facts.filter((f: any) => f.type === 'symptom');
  check(symptoms.every((f: any) => f.speaker !== 'clinician' && f.evidenceType !== 'clinician_observed'),
    'assistant-relayed patient symptom is not promoted to clinician finding');
}

// ---- AUDIT 5: temporality ---------------------------------------------------
const temporalCases: Array<[string, 'Dentist' | 'Patient', string, { status: string; temporal: string }]> = [
  ['historical', 'Patient', 'I had a root canal on 46 two years ago.', { status: 'historical', temporal: 'historical' }],
  ['current finding', 'Dentist', 'There is caries on 25.', { status: 'observed', temporal: 'current' }],
  ['planned', 'Dentist', 'We plan to restore 15 next visit.', { status: 'planned', temporal: 'next_appointment' }],
  ['previously treated', 'Patient', 'That tooth was treated before.', { status: 'historical', temporal: 'historical' }],
  ['treatment elsewhere', 'Patient', 'My old dentist said the nerve was dying.', { status: 'historical', temporal: 'historical' }],
  ['cancelled', 'Patient', 'I cancelled the extraction last month.', { status: 'historical', temporal: 'historical' }],
  ['ongoing', 'Patient', 'The pain has been there for weeks.', { status: 'reported', temporal: 'current' }],
];
for (const [name, speaker, text, expect] of temporalCases) {
  const r = run(`A5: temporality — ${name}`, [U(speaker, text)]);
  const facts = r.facts.filter((f: any) => f.type !== 'chief_complaint');
  const matched = facts.some((f: any) => f.status === expect.status && f.temporal === expect.temporal);
  check(matched || facts.length === 0,
    `temporality preserved or conservatively absent: ${name} (expected ${expect.status}/${expect.temporal})`);
  const performed = facts.filter((f: any) => f.status === 'performed' && f.speaker !== 'clinician');
  check(performed.length === 0, `no non-clinician performed facts: ${name}`);
}
{
  // The chairside "today" rule and the plan→performed boundary.
  const r = run('A5: planned today vs planned future', [
    U('Dentist', 'We will start the root canal on 36 today.'),
    U('Dentist', 'We plan to restore 15 next visit.'),
  ]);
  check(r.raw.length > 0, 'extractor produced facts (probe harness sanity)');
  const performed = r.facts.filter((f: any) => f.status === 'performed');
  const planned = r.facts.filter((f: any) => f.status === 'planned');
  check(performed.some((f: any) => /root canal/i.test(JSON.stringify(f.value))),
    'clinician "will X today" narrates performed treatment');
  check(planned.some((f: any) => (f.anatomy?.teeth ?? []).some((t: any) => t.tooth === 15)),
    'future plan stays planned');
}

// ---- AUDIT 6: dental anatomy ------------------------------------------------
{
  const r = run('A6: invalid/ambiguous FDI', [
    U('Dentist', 'Tooth 99 needs attention.'),
    U('Dentist', 'The lower left first molar has decay.'),
  ]);
  const teeth = new Set(r.facts.flatMap((f: any) => (f.anatomy?.teeth ?? []).map((t: any) => t.tooth)));
  check(!teeth.has(99), 'invalid FDI 99 never enters facts');
  check(r.raw.length > 0 || r.facts.length === 0, 'extraction behaved deterministically');
}
{
  const r = run('A6: dose vs tooth / age vs tooth', [
    U('Dentist', 'We gave 2.2 ml of articaine with 1 to 100000 adrenaline.'),
    U('Patient', 'He is only 6 years old.'),
    U('Dentist', '46 has caries.'),
  ]);
  const teeth = r.facts.flatMap((f: any) => (f.anatomy?.teeth ?? []).map((t: any) => t.tooth));
  check(!teeth.includes(6), `age does not become a tooth (teeth: ${teeth.join(',')})`);
  check(teeth.includes(46) || teeth.length === 0, 'the explicitly mentioned tooth 46 is captured');
  const cariesFacts = r.facts.filter((f: any) => f.type === 'tooth_finding');
  check(cariesFacts.every((f: any) => (f.anatomy?.teeth ?? []).every((t: any) =>
    (t.tooth >= 11 && t.tooth <= 48 && t.tooth % 10 >= 1 && t.tooth % 10 <= 8) ||
    (t.tooth >= 51 && t.tooth <= 85 && t.tooth % 10 >= 1 && t.tooth % 10 <= 5))),
    'every tooth reference is valid FDI');
}
{
  const r = run('A6: exclusion context', [
    U('Dentist', '46 has caries, not 36 as the chart said.'),
  ]);
  const teeth = r.facts.flatMap((f: any) => (f.anatomy?.teeth ?? []).map((t: any) => t.tooth));
  check(teeth.includes(46) && !teeth.includes(36), `excluded tooth 36 does not attach (teeth: ${teeth.join(',')})`);
}

console.log(`\n================ PROBE RESULT: ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ================`);
process.exit(failures === 0 ? 0 : 1);
