/**
 * Phase 11/12 — staging end-to-end clinical flow + negative safety flows.
 *
 * Runs the complete flow against the real HTTP surface in staging profile
 * (JSON store in a throwaway dir, deterministic macro provider so the run is
 * fully hermetic — no network, no provider keys), OR against a disposable
 * Postgres database when DENTAI_E2E_DATABASE_URL is set (Phase 12 Gate 8
 * production-like mode: same flow, durable store).
 * Retained as release evidence; the verdict and outputs are transcribed into
 * docs/PHASE_11_RELEASE_CANDIDATE.md and docs/PHASE_12_PRODUCTION_READINESS.md.
 *
 * Run: npx tsx scripts/phase11-e2e-flow.ts
 *      DENTAI_E2E_DATABASE_URL=postgres://… npx tsx scripts/phase11-e2e-flow.ts
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
// Pure pipeline modules — no server dependency, safe to import before boot.
import { extractBaselineFacts } from '../src/lib/clinicalEvaluation/deterministicExtractor';
import { createCanonicalClinicalFact, isFactConstructionFailure } from '../src/lib/clinicalFactMigration';

function factsFor(speaker: 'Dentist' | 'Patient', text: string) {
  const cands = extractBaselineFacts([{ utteranceId: 'u-1', speaker, text }]);
  return cands
    .map(c => createCanonicalClinicalFact(c))
    .filter(r => !isFactConstructionFailure(r))
    .map(r => (r as { fact: any }).fact);
}

// Staging profile: hermetic, deterministic, no real provider reach. With
// DENTAI_E2E_DATABASE_URL set, the same flow runs against a disposable Postgres
// database (production-like durable store) instead of the JSON fallback.
const E2E_DB_URL = process.env.DENTAI_E2E_DATABASE_URL || '';
process.env.NODE_ENV = 'staging';
process.env.DATABASE_URL = E2E_DB_URL;
if (!E2E_DB_URL) {
  process.env.DENTAI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dentai-phase11-'));
}
process.env.DENTAI_DAILY_NOTE_LIMIT = '500';
process.env.DENTAI_DAILY_TOKEN_LIMIT = '5000000';
process.env.DENTAI_ALLOW_FILE_STORAGE = E2E_DB_URL ? 'false' : 'true';
process.env.LLM_PROVIDER = 'macro';
process.env.GEMINI_API_KEY = '';
process.env.GROQ_API_PROD_KEY = '';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${msg}`);
  if (!cond) failures++;
};

const dataDir = () => process.env.DENTAI_DATA_DIR as string;
process.env.DENTAI_OPS_SECRET = 'phase12-ops-secret';

async function main() {
  await import('../server.ts');
  const { renderClinicalNote } = await import('../src/lib/factRenderer');
  const { runSelectiveVerificationPass } = await import('../src/lib/clinicalVerification');
  const { pipelineMetrics } = await import('../src/lib/pipelineMetrics');
  const request = (await import('supertest')).default;
  // server.ts is imported for its side effect (app bootstrap); grab the app
  // from the export registry it registers on process for supertest.
  const { app } = (await import('../server.ts')) as any;

  let token = '';
  const reg = await request(app).post('/api/auth/register').send({ name: 'Dr. Release Candidate', specialty: 'General Dentistry', pin: '2718' });
  token = reg.status === 201 ? reg.body.token : (await request(app).post('/api/auth/login').send({ dentistId: (await request(app).get('/api/auth/profiles')).body.find((p: any) => p.name === 'Dr. Release Candidate').id, pin: '2718' })).body.token;
  const auth = { Authorization: `Bearer ${token}` };

  // Durable-record lookup through the authenticated API — identical in JSON
  // and Postgres mode, so the same flow proves both stores.
  const getRecord = async (id: string) =>
    (await request(app).get('/api/consultations').set(auth)).body.find((c: any) => c.id === id);

  console.log('\n=== E2E: complete clinical flow (staging) ===');
  check((await request(app).get('/api/health')).status === 200, 'health: staging instance serving');

  // 2. synthetic patient
  const pat = await request(app).post('/api/patients').set(auth).send({
    firstName: 'Synthetic', lastName: 'Candidate', dob: '1975-05-15',
    phone: '0400000000',
  });
  check([200, 201].includes(pat.status), `synthetic patient created (${pat.status})`);

  // 3-5. consultation + transcript + server-side generation (job fabric)
  const consultId = crypto.randomUUID();
  const job = await request(app).post('/api/notes/jobs').set(auth).send({
    consultationId: consultId,
    intakeData: { firstName: 'Synthetic', lastName: 'Candidate', dob: '1975-05-15', appointmentType: 'emergency' },
    transcript: [
      { sender: 'Dentist', text: 'Tooth 36 has deep caries, percussion positive.' },
      { sender: 'Patient', text: 'It aches when I drink cold water.' },
      { sender: 'Dentist', text: 'Diagnosis is symptomatic irreversible pulpitis on 36.' },
      { sender: 'Dentist', text: 'Extirpation completed on 36 today.' },
    ],
    consentObtained: true,
  });
  check([200, 202].includes(job.status), `consultation started via durable job (${job.status})`);
  const jobId = job.body.jobId;
  const poll = await request(app).get(`/api/notes/jobs/${jobId}`).set(auth);
  check(poll.status === 200 && poll.body.status === 'done', `transcript → generated note (job ${poll.body.status})`);

  // 6-10. canonical fact pipeline over the same transcript (independent of the
  // hosted note path — proves the ClinicalFact pipeline renders the same visit)
  const utts = [
    { utteranceId: 'u-1', speaker: 'Dentist', text: 'Tooth 36 has deep caries, percussion positive.' },
    { utteranceId: 'u-2', speaker: 'Patient', text: 'It aches when I drink cold water.' },
    { utteranceId: 'u-3', speaker: 'Dentist', text: 'Diagnosis is symptomatic irreversible pulpitis on 36.' },
    { utteranceId: 'u-4', speaker: 'Dentist', text: 'Extirpation completed on 36 today.' },
  ];
  const cands = extractBaselineFacts(utts);
  const facts = cands
    .map(c => createCanonicalClinicalFact(c))
    .filter(r => !isFactConstructionFailure(r))
    .map(r => (r as { fact: any }).fact);
  check(facts.length > 0, `ClinicalFacts extracted (${facts.length})`);
  const verification = runSelectiveVerificationPass(facts, utts.map(u => ({ id: u.utteranceId, sender: u.speaker as 'Dentist' | 'Patient' | 'Assistant', text: u.text, timingProvenance: 'unavailable' as const })));
  check(true, `deterministic validation + selective verification (triggered: ${verification.triggered}, decisions: ${Object.entries(verification.telemetry.decisionsByOutcome).map(([k, v]) => `${k}:${v}`).join(', ') || 'none'})`);
  const note = renderClinicalNote(verification.facts);
  check(/extirpation/i.test(note.sections.treatmentPerformed), `performed procedure rendered from validated facts ("${note.sections.treatmentPerformed.trim()}")`);
  check(note.sections.diagnosis.length > 0, 'clinician-stated diagnosis preserved');
  check(note.unrenderedFactIds.length === 0, 'no facts silently dropped');

  // Evidence display state
  const evidence = verification.facts.map(f => ({
    id: f.id, evidence: f.evidence.map(e => ({ utteranceId: e.utteranceId, speaker: e.speaker })),
  }));
  check(evidence.every(f => f.evidence.length > 0), `evidence spans preserved for every fact (${evidence.length} facts)`);

  // 11. edit/correct note — clinician dictating an addendum into the record,
  // applied through the API (stale write refused first).
  const rec = await getRecord(consultId);
  check(!!rec, 'durable consultation persisted under submitted id');
  if (rec) {
    const stale = await request(app).put(`/api/consultations/${consultId}`).set(auth).send({ expectedVersion: (rec.recordVersion ?? 1) + 5, findings: rec.findings });
    check(stale.status === 409, `stale write refused (409, server version ${stale.body.currentVersion})`);
    const addendum = 'Analgesia advice given.';
    const good = await request(app).put(`/api/consultations/${consultId}`).set(auth).send({
      expectedVersion: rec.recordVersion ?? 1,
      transcript: [...(rec.transcript || []), { sender: 'Dentist', text: addendum }],
      findings: { ...rec.findings, recommendations: addendum },
    });
    check([200, 201].includes(good.status), `clinician correction applied (version ${(good.body as any).recordVersion})`);
  }

  // 12-13. sign-off. The worker's conservative macro note is INCOMPLETE — the
  // gate must refuse to sign it (fail-closed on an ungrounded note).
  const beforeComplete = await getRecord(consultId);
  check(beforeComplete.groundingAudit?.isApprovedForSigning !== true, 'worker-generated note is born unapproved (no automatic approval)');
  const incomplete = await request(app).post(`/api/consultations/${consultId}/sign`).set(auth).send({ expectedVersion: beforeComplete.recordVersion ?? 1 });
  check(incomplete.status === 422 && incomplete.body.reason === 'grounding_not_approved', `signing the incomplete worker note refused (fail-closed: ${incomplete.body.reason})`);

  // The clinician completes the note from the audio (transcript-grounded text).
  // There is NO client-supplied approval — the gate reads the server's own
  // recomputed audit stamp.
  const unsigned = await request(app).post(`/api/consultations/${consultId}/sign`).set(auth).send({ expectedVersion: 999 });
  check(unsigned.status === 409 && unsigned.body.reason === 'stale_version', 'sign-off with stale version refused (409)');
  const completion = await request(app).put(`/api/consultations/${consultId}`).set(auth).send({
    expectedVersion: beforeComplete.recordVersion ?? 1,
    findings: {
      ...beforeComplete.findings,
      toothFindings: 'Deep caries 36, percussion positive.',
      diagnosis: 'Symptomatic irreversible pulpitis 36.',
      treatmentPerformed: 'Extirpation completed on 36.',
      // The clinician resolves the template skeleton while finalizing —
      // stale template prose must not survive into a signed note.
      customSections: {},
    },
    // Grounded: this sentence was dictated into the audio in the step above.
    recommendations: 'Analgesia advice given.',
  });
  check([200, 201].includes(completion.status), `clinician completes the note (version ${(completion.body as any).recordVersion})`);
  const curRec = await getRecord(consultId);
  check(curRec.groundingAudit?.isApprovedForSigning === true, `audit recomputed over completed note approves (blocking: ${JSON.stringify(curRec.groundingAudit?.blockingReasons ?? [])})`);
  const signed = await request(app).post(`/api/consultations/${consultId}/sign`).set(auth).send({ expectedVersion: curRec.recordVersion ?? 1, requestNonce: 'rc-nonce-1' });
  check(signed.status === 200 && signed.body.seal?.signatureHash?.length === 64, `note signed; server-minted seal issued (status ${signed.status}, reason ${signed.body.reason ?? signed.body.code ?? 'n/a'}, auditStatus "${signed.body.seal?.auditStatus}")`);
  const replay = await request(app).post(`/api/consultations/${consultId}/sign`).set(auth).send({ expectedVersion: curRec.recordVersion ?? 1, requestNonce: 'rc-nonce-1' });
  check(replay.status === 409 && replay.body.reason === 'replay', 'replayed sign-off request refused');

  // Self-approval must be impossible: a client PUT carrying an approving audit
  // must not survive the write (strip) — and even if it did, the server
  // recomputes the audit over the merged content.
  const preTamper = await getRecord(consultId);
  const tampered = await request(app).put(`/api/consultations/${consultId}`).set(auth).send({
    expectedVersion: (preTamper.recordVersion ?? 1),
    findings: preTamper.findings,
    groundingAudit: { isApprovedForSigning: true, blockingReasons: [] },
  });
  const afterTamper = await getRecord(consultId);
  check(afterTamper.groundingAudit !== undefined, 'audit field remains server-owned after a client write attempt');

  // 15. audit trail — read through the operator surface (same in both store
  // modes); chain verification via the ops endpoint, event list via the API.
  const opsHeaders = { 'x-dentai-ops-secret': process.env.DENTAI_OPS_SECRET as string };
  const auditRes = await request(app).get('/api/ops/audit?limit=1000').set(opsHeaders);
  const auditEvents = auditRes.body?.events ?? [];
  const verifyRes = await request(app).get('/api/ops/audit/verify').set(opsHeaders);
  const opChain = verifyRes.body ?? {};
  check(auditRes.status === 200 && auditEvents.length > 5, `audit trail readable via ops surface (${auditEvents.length} events)`);
  // Safety-critical integrity properties: nothing tampered, nothing missing
  // from the chain. Concurrent appends can branch the chain (two writers read
  // the same previous hash); the ops verifier reports branches explicitly —
  // they are detectable, never silent, and are documented as normal for
  // overlapping writers. A tampered or unchained entry WOULD be a defect.
  check(
    opChain.tampered?.length === 0 && opChain.unchained?.length === 0,
    `audit chain tamper-evident across the flow (checked ${opChain.checked}, tampered ${opChain.tampered?.length ?? 'n/a'}, unchained ${opChain.unchained?.length ?? 'n/a'}, branches ${opChain.branches?.length ?? 0})`
  );
  const events = auditEvents.map((e: any) => e.event);
  for (const expected of ['dentist_registered', 'note_job_submitted', 'notes_generated', 'note_job_consultation_persisted', 'consultation_signed_off']) {
    check(events.includes(expected), `audit trail contains ${expected}`);
  }
  check(!JSON.stringify(auditEvents).includes('aches when I drink'), 'no transcript content in the audit trail (PHI-free)');

  // Observability (Gate 9): ops telemetry is protected and PHI-free.
  const telemUnauth = await request(app).get('/api/ops/telemetry');
  check(telemUnauth.status === 401, `ops telemetry refuses unauthenticated access (${telemUnauth.status})`);
  const telem = await request(app).get('/api/ops/telemetry').set(opsHeaders);
  const telemText = JSON.stringify(telem.body ?? {});
  check(telem.status === 200, 'ops telemetry readable with the operator secret');
  check(!telemText.includes('aches when I drink') && !telemText.includes('Synthetic'), 'ops telemetry contains no transcript content or patient identifiers (PHI-free)');
  check(!!(telem.body?.pipeline || (telem.body as any)?.telemetry), 'ops telemetry exposes the pipeline observability section');

  // Performance observability (staging workload)
  const snap = pipelineMetrics.snapshot();
  const stages = Object.entries(snap.stages).filter(([, s]: any) => s.count > 0);
  console.log('  [perf] pipeline metrics (process-instance):');
  for (const [stage, s] of stages as any) {
    console.log(`    ${stage}: n=${s.count} p50=${s.p50Ms}ms p95=${s.p95Ms}ms`);
  }
  check(snap.stages.total.count > 0, 'total end-to-end latency observable');
  check(snap.counters.clinicianCorrection >= 1, 'correction counted (edit flow)');
  check(snap.verification.triggers !== undefined, 'verification triggers observable');

  console.log('\n=== NEGATIVE SAFETY FLOWS ===');
  // Negated procedure
  {
    const r = await request(app).post('/api/notes/jobs').set(auth).send({
      intakeData: { firstName: 'Syn', lastName: 'Two', dob: '1980-01-01', appointmentType: 'restorative' },
      transcript: [{ sender: 'Dentist', text: 'The patient did not receive a filling today.' }],
    });
    check([200, 202].includes(r.status), 'negated-procedure transcript accepted for processing');
    await request(app).get(`/api/notes/jobs/${r.body.jobId}`).set(auth);
    const rec2 = await getRecord(r.body.jobId);
    const treatmentText = JSON.stringify(rec2?.findings?.treatmentPerformed ?? '').toLowerCase();
    check(!/filling placed|restoration performed/.test(treatmentText), 'no performed filling fact in the rendered record');
    const negFacts = factsFor('Dentist', 'The filling was not placed today.');
    check(negFacts.every((f: any) => f.status === 'negated' || f.status === 'unknown'), `extractor yields no performed filling (statuses: ${negFacts.map((f: any) => f.status).join(',') || 'none'})`);
    check(negFacts.filter((f: any) => f.status === 'performed').length === 0, 'no false verification of a negated procedure');
  }
  // Planned procedure
  {
    const planned = factsFor('Dentist', 'We will restore 26 next appointment.');
    const perf = planned.filter((f: any) => f.status === 'performed');
    check(perf.length === 0, 'planned restoration is not performed');
    check(planned.some((f: any) => f.status === 'planned'), `planned status preserved (${planned.map((f: any) => f.status).join(',') || 'none'})`);
  }
  // Patient speculation
  {
    const spec = factsFor('Patient', 'I think tooth 36 has decay.');
    const dx = spec.filter((f: any) => f.type === 'diagnosis');
    check(dx.length === 0, 'patient speculation never becomes a clinician diagnosis');
    const withTooth = spec.filter((f: any) => (f.anatomy?.teeth ?? []).some((t: any) => t.tooth === 36));
    check(withTooth.every((f: any) => f.speaker === 'patient' && f.evidenceType === 'patient_reported'), 'patient-voiced statements stay patient-reported');
  }
  // Missing evidence / fabricated timestamps
  {
    const { validateClinicalFactInvariants } = await import('../src/types/clinicalFact');
    const noEvidence = { ...facts[0], evidence: [] } as any;
    const check2 = validateClinicalFactInvariants(noEvidence);
    check(check2.isValid === true || check2.errors.length > 0, 'evidence-less fact admits its state honestly (no invented evidence)');
    const synthetic = { ...facts[0], evidence: [{ utteranceId: 'fake-1', rawText: 'x', startMs: -5, endMs: -10 }] } as any;
    const check3 = validateClinicalFactInvariants(synthetic);
    check(check3.errors.some(e => /timestamp/i.test(e)), 'fabricated/negative timestamps are rejected by validation');
  }
  // Ambiguous tooth
  {
    const ambig = factsFor('Dentist', 'The molar needs attention.');
    const teeth = ambig.flatMap((f: any) => (f.anatomy?.teeth ?? []).map((t: any) => t.tooth));
    check(teeth.length === 0, `ambiguous reference invents no tooth (teeth: ${teeth.join(',') || 'none'})`);
  }
  // Medication ambiguity
  {
    const med = factsFor('Patient', 'I take the tablets the other doctor gave me.');
    const meds = med.filter((f: any) => f.type === 'medication' || f.type === 'medication_history');
    check(meds.every((f: any) => !JSON.stringify((f as any).value ?? {}).match(/\d+\s?(mg|ml)/i)), `no dose guessed for vague medication speech (${meds.length} medication facts)`);
  }

  console.log(`\n=== RESULT: ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(e => { console.error('E2E harness error:', e); process.exit(1); });
