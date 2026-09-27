/**
 * Phase 13 — production smoke against the DEPLOYED release (synthetic data only).
 *
 * Every record created here uses clearly synthetic patients ("Smoke Rc13-…")
 * and a synthetic clinician account, so no real patient information is touched.
 * The script only asserts server-derived clinical state; it never manufactures
 * approval, seals or facts client-side.
 *
 *   BASE_URL=https://<deployment> npx tsx scripts/phase13-production-smoke.ts
 *
 * Checks (each mapped to the Phase 13 plan §26):
 *   1  /api/health liveness + reported version/migrations
 *   2  application HTML loads
 *   3  synthetic clinician registration
 *   4  durable note job (POST /api/notes/jobs) end-to-end
 *   5  ClinicalFacts seam status on the produced record (reported, non-blocking —
 *      hosted providers do not yet emit facts; documented Phase 12 limitation)
 *   6  server-derived grounding audit present
 *   7  ungrounded record is refused at sign-off (422 GROUNDING_NOT_APPROVED)
 *   8  clinical correction invalidates a prior approval (server recompute)
 *   9  stale expectedVersion write → 409 STALE_WRITE with server copy
 *  10  approved synthetic record signs → server-minted seal
 *  11  replayed sign-off nonce → 409 (REPLAY / STALE_VERSION per implementation)
 *  12  ops audit guard active (401 without the operator secret)
 */
import crypto from 'node:crypto';

const BASE = (process.env.BASE_URL || process.argv[2] || 'https://dentai-one.vercel.app').replace(/\/$/, '');
const RUN = Date.now().toString(36);

let failures = 0;
const check = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${msg}`);
  if (!cond) failures++;
};

async function api(method: string, urlPath: string, token?: string, body?: unknown) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: json };
}

async function main() {
  console.log(`Phase 13 production smoke → ${BASE} (synthetic data only, run ${RUN})\n`);

  // 1 — health
  const health = await api('GET', '/api/health');
  check(health.status === 200, `GET /api/health → ${health.status}`);
  if (health.status === 200) {
    const h = health.body || {};
    console.log(`    health: status=${h.status} version=${h.version} storage=${h.storage} migrations=${h.migrations ?? JSON.stringify(h.migrations ?? null)} db=${h.database}`);
    check(h.version === '0.1.0-rc.1', `health reports release version 0.1.0-rc.1 (got ${h.version})`);
  }

  // 2 — application loads
  const html = await fetch(`${BASE}/`);
  const htmlText = await html.text();
  check(html.status === 200 && /DentAI|id="root"|<div id/i.test(htmlText), `application HTML loads (${html.status}, ${htmlText.length} bytes)`);

  // 3 — synthetic clinician
  const reg = await api('POST', '/api/auth/register', undefined, {
    name: `Dr P13 Smoke ${RUN}`,
    specialty: 'General Dentistry',
    pin: '7391',
  });
  check(reg.status === 201 && !!reg.body?.token, `synthetic clinician registered (${reg.status})`);
  const token = reg.body?.token as string;
  if (!token) throw new Error('cannot continue without a session token');

  // Synthetic consult transcript — 100% fabricated, no real patient content.
  const transcript = [
    { sender: 'Dentist', text: 'Tooth 36 has deep caries, percussion positive.' },
    { sender: 'Dentist', text: 'Extirpation completed on 36 today.' },
    { sender: 'Dentist', text: 'Diagnosis is symptomatic irreversible pulpitis on 36.' },
    { sender: 'Dentist', text: 'Analgesia advice given.' },
  ];
  const isoToday = new Date().toISOString().slice(0, 10);
  const consent = {
    obtainedAt: new Date().toISOString(),
    disclosureVersion: 'phase13-production-smoke',
    recordedBy: 'phase13-smoke',
  };
  const groundedFindings = {
    chiefComplaint: '', history: '',
    toothFindings: 'Deep caries 36, percussion positive.',
    findingsGingival: '',
    diagnosis: 'Symptomatic irreversible pulpitis 36.',
    treatmentPerformed: 'Extirpation completed on 36.',
    recommendations: 'Analgesia advice given.', recallRequirements: '', adaCodes: [],
  };
  const baseRecord = {
    firstName: 'Smoke', lastName: `Rc13-${RUN}`, dob: '1980-04-04',
    date: isoToday, time: '09:15', appointmentType: 'emergency', templateId: 'standard',
    transcript, consent, consentObtained: true,
  };

  // 4 — durable note job through the production queue
  const jobId = crypto.randomUUID();
  const jobRes = await api('POST', '/api/notes/jobs', token, {
    consultationId: jobId,
    intakeData: { firstName: 'Smoke', lastName: `Rc13-${RUN}`, dob: '1980-04-04', appointmentType: 'emergency', templateId: 'standard' },
    transcript,
    consentObtained: true,
    consentCapturedAt: consent.obtainedAt,
  });
  check([200, 202].includes(jobRes.status), `POST /api/notes/jobs → ${jobRes.status}`);
  let jobStatus = jobRes.body?.status;
  for (let i = 0; i < 30 && jobStatus !== 'done' && jobStatus !== 'failed'; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const poll = await api('GET', `/api/notes/jobs/${jobId}`, token);
    jobStatus = poll.body?.status;
  }
  check(jobStatus === 'done', `durable note job completes (status=${jobStatus})`);

  // 5/6 — the durable record: server-derived audit + facts seam status
  const list = await api('GET', '/api/consultations', token);
  const records: any[] = list.body?.consultations || list.body || [];
  const jobRecord = records.find((r) => r.id === jobId);
  check(!!jobRecord, 'durable job persisted a consultation record');
  const audit = jobRecord?.groundingAudit;
  check(!!audit && typeof audit === 'object', 'server-derived groundingAudit present on the record');
  const approvedFlag = audit?.isApprovedForSigning === true;
  console.log(`    groundingAudit.isApprovedForSigning=${audit?.isApprovedForSigning} alignmentStatusBadge=${JSON.stringify(audit?.alignment?.statusBadge ?? null)}`);
  const factsOnRecord = Array.isArray(jobRecord?.facts) ? jobRecord.facts.length : null;
  console.log(`    ClinicalFacts seam: server emitted ${factsOnRecord === null ? 'no facts array' : `${factsOnRecord} fact(s)`} on this record (hosted-provider seam, Phase 12 documented limitation)`);

  // 7 — ungrounded record: sign-off must refuse (fail-closed)
  const ungrounded = await api('POST', '/api/consultations', token, {
    ...baseRecord, lastName: `Rc13u-${RUN}`, status: 'In Review',
    findings: { chiefComplaint: '', history: '', toothFindings: '', findingsGingival: '', diagnosis: '', treatmentPerformed: '', recommendations: '', recallRequirements: '', adaCodes: [] },
    noteOrigin: { engine: 'groq', needsReview: true, detail: 'Generated via cloud AI' },
  });
  check([200, 201].includes(ungrounded.status), `ungrounded synthetic record created (${ungrounded.status})`);
  const uRec = ungrounded.body;
  check(uRec?.groundingAudit?.isApprovedForSigning !== true, 'ungrounded record is NOT approved for signing');
  const refuse = await api('POST', `/api/consultations/${uRec.id}/sign`, token, {
    expectedVersion: uRec.recordVersion ?? 1, requestNonce: crypto.randomUUID(),
  });
  check(refuse.status === 422, `sign-off on ungrounded record refused (${refuse.status})`);
  check(refuse.body?.code === 'GROUNDING_NOT_APPROVED', `refusal carries GROUNDING_NOT_APPROVED (got ${refuse.body?.code})`);

  // 8 — correction invalidates a prior approval
  const approved = await api('POST', '/api/consultations', token, {
    ...baseRecord, lastName: `Rc13c-${RUN}`, status: 'Completed', findings: groundedFindings,
    noteOrigin: { engine: 'groq', needsReview: false, detail: 'Generated via cloud AI' },
  });
  check([200, 201].includes(approved.status), `grounded synthetic record created (${approved.status})`);
  const aRec = approved.body;
  check(aRec?.groundingAudit?.isApprovedForSigning === true, 'grounded record IS approved for signing (server recompute)');

  const correction = await api('PUT', `/api/consultations/${aRec.id}`, token, {
    expectedVersion: aRec.recordVersion ?? 1,
    findings: {
      ...groundedFindings,
      toothFindings: 'Fractured incisal edge 21.',
      diagnosis: 'Fractured incisal edge 21.',
    },
  });
  check([200, 201].includes(correction.status), `clinician correction applied (version ${correction.body?.recordVersion})`);
  check(correction.body?.groundingAudit?.isApprovedForSigning !== true, 'stale approval did NOT survive the clinical correction (server recomputed)');
  const postCorrectionSign = await api('POST', `/api/consultations/${aRec.id}/sign`, token, {
    expectedVersion: correction.body?.recordVersion ?? 2, requestNonce: crypto.randomUUID(),
  });
  check(postCorrectionSign.status === 422 && postCorrectionSign.body?.code === 'GROUNDING_NOT_APPROVED',
    `sign-off after correction refused (${postCorrectionSign.status} ${postCorrectionSign.body?.code})`);

  // 9 — optimistic concurrency: stale write refused, server state returned
  const staleWrite = await api('PUT', `/api/consultations/${aRec.id}`, token, {
    expectedVersion: 1, findings: groundedFindings,
  });
  check(staleWrite.status === 409 && staleWrite.body?.code === 'STALE_WRITE',
    `stale write → 409 STALE_WRITE (${staleWrite.status} ${staleWrite.body?.code})`);
  check(typeof staleWrite.body?.serverConsultation?.recordVersion === 'number' || typeof staleWrite.body?.currentVersion === 'number' || !!staleWrite.body?.serverConsultation,
    '409 carries the server record/version for reconciliation');

  // 10 — approved record signs; server mints the seal
  const signRecord = await api('POST', '/api/consultations', token, {
    ...baseRecord, lastName: `Rc13s-${RUN}`, status: 'Completed', findings: groundedFindings,
    noteOrigin: { engine: 'groq', needsReview: false, detail: 'Generated via cloud AI' },
  });
  check(signRecord.body?.groundingAudit?.isApprovedForSigning === true, 'sign-target record approved for signing');
  const sRec = signRecord.body;
  const nonce = crypto.randomUUID();
  const sign = await api('POST', `/api/consultations/${sRec.id}/sign`, token, {
    expectedVersion: sRec.recordVersion ?? 1, requestNonce: nonce,
  });
  check(sign.status === 200, `approved sign-off accepted (${sign.status})`);
  const seal = sign.body?.seal;
  check(!!seal && typeof seal === 'object' && (seal.signature || seal.sig || seal.digest),
    'server-minted AttestationSeal returned (fields present)');
  if (seal) console.log(`    seal: alg=${seal.algorithm ?? seal.alg ?? 'n/a'} version=${seal.recordVersion ?? seal.v ?? 'n/a'} keys=${Object.keys(seal).join(',')}`);

  // 11 — replay protection
  const replay = await api('POST', `/api/consultations/${sRec.id}/sign`, token, {
    expectedVersion: sRec.recordVersion ?? 1, requestNonce: nonce,
  });
  check(replay.status === 409 && ['REPLAY', 'STALE_VERSION'].includes(replay.body?.code),
    `replayed sign-off refused (${replay.status} ${replay.body?.code})`);
  const staleSign = await api('POST', `/api/consultations/${sRec.id}/sign`, token, {
    expectedVersion: (sRec.recordVersion ?? 1) + 5, requestNonce: crypto.randomUUID(),
  });
  check(staleSign.status === 409, `wrong expectedVersion sign-off refused (${staleSign.status} ${staleSign.body?.code})`);

  // 12 — ops audit guard (no secret available to this run: guard must refuse)
  const auditProbe = await api('GET', '/api/ops/audit?limit=10');
  check(auditProbe.status === 401, `ops audit guard active without secret (${auditProbe.status})`);

  console.log(failures === 0 ? '\n=== PHASE 13 PRODUCTION SMOKE: ALL CHECKS PASSED ===' : `\n=== PHASE 13 PRODUCTION SMOKE: ${failures} CHECK(S) FAILED ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('SMOKE ERROR:', err?.message || err);
  process.exit(1);
});
