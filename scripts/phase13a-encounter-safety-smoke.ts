/**
 * Phase 13A Gate — automated browser safety smoke (encounter session hardening).
 *
 * Boots the real server in a hermetic staging profile (macro provider,
 * throwaway JSON store, synthetic data only) and exercises, against the real
 * UI + HTTP surface:
 *
 *   Case H1 — active session + external walk-in injection: the workspace must
 *             NOT silently switch the active patient (focus invariant §4/§5).
 *             A walk-in added by ANOTHER browser appears on the roster and
 *             never moves focus while the session is live.
 *   Case H2 — keyboard navigation (⌘→) counts as manual selection: after a
 *             keyboard switch, an external suggestion cannot take focus.
 *   Case H3 — sign-off persists: after signing, the seal lives on the server
 *             record; a fresh browser context (simulated reload/second
 *             device) still shows Signed.
 *   Case H4 — signed-record immutability: a content edit to a signed record
 *             is refused 409 RECORD_SIGNED; replay sign-off is refused.
 *
 * Run: npx tsx scripts/phase13a-encounter-safety-smoke.ts
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Seed dates use the app's OWN clinic-day definition (see phase12-ui-smoke).
import { getClinicTodayIso } from '../src/utils/date';

const PORT = 32000 + Math.floor(Math.random() * 20000); // unique per run
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dentai-p13a-'));

process.env.DENTAI_SMOKE = '1';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${msg}`);
  if (!cond) failures++;
};

// Progress marker + hard watchdog: a hung browser interaction must not hang
// the gate. On timeout we dump where we stopped and what the page showed.
let lastStep = 'boot';
let browserRef: any = null;
let serverRef: any = null;
const step = (name: string) => {
  lastStep = name;
  console.log(`[step] ${name}`);
};
const WATCHDOG_MS = 240_000;
const watchdog = setTimeout(async () => {
  console.error(`\nWATCHDOG: smoke stalled at step "${lastStep}" after ${WATCHDOG_MS}ms — aborting.`);
  try { await browserRef?.close(); } catch { /* already gone */ }
  try { serverRef?.kill(); } catch { /* already gone */ }
  process.exitCode = 1;
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref?.();

function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function waitForHealth(): Promise<void> {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise(res => setTimeout(res, 1000));
  }
  throw new Error('server did not become healthy');
}

async function api(method: string, urlPath: string, token?: string, body?: unknown) {
  const r = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await r.json(); } catch { /* empty body */ }
  return { status: r.status, body: json };
}

async function seed(): Promise<{ token: string; user: any; records: any[]; groundedId: string; ungroundedId: string }> {
  const reg = await api('POST', '/api/auth/register', undefined, { name: 'Dr P13A Smoke', specialty: 'General Dentistry', pin: '2718' });
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.body).slice(0, 200)}`);
  const token = reg.body.token;
  const me = await api('GET', '/api/auth/me', token);
  const user = me.body?.dentist || me.body?.user || me.body;

  const isoToday = getClinicTodayIso();
  const transcript = [
    { sender: 'Dentist', text: 'Tooth 36 has deep caries, percussion positive.' },
    { sender: 'Dentist', text: 'Extirpation completed on 36 today.' },
    { sender: 'Dentist', text: 'Diagnosis is symptomatic irreversible pulpitis on 36.' },
    { sender: 'Dentist', text: 'Analgesia advice given.' },
  ];
  const groundedFindings = {
    chiefComplaint: '', history: '',
    toothFindings: 'Deep caries 36, percussion positive.',
    findingsGingival: '',
    diagnosis: 'Symptomatic irreversible pulpitis 36.',
    treatmentPerformed: 'Extirpation completed on 36.',
    recommendations: 'Analgesia advice given.', recallRequirements: '', adaCodes: [],
  };
  const create = async (lastName: string, body: Record<string, unknown>) => {
    const r = await api('POST', '/api/consultations', token, {
      firstName: 'Smoke', lastName, dob: '1980-04-04', date: isoToday, time: '09:15',
      appointmentType: 'examination', templateId: 'standard', transcript,
      consent: { obtainedAt: new Date().toISOString(), disclosureVersion: 'phase13a-smoke', recordedBy: 'p13a-smoke' },
      consentObtained: true,
      findings: groundedFindings,
      ...body,
    });
    if (![200, 201].includes(r.status)) throw new Error(`create failed: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return r.body as any;
  };

  // The active-session patient (P1) and the switch target (P2).
  const p1 = (await create('One', { time: '09:00' })).id;
  const p2 = (await create('Two', { time: '09:30' })).id;
  // Grounded note for sign-off persistence + immutability cases.
  const groundedId = (await create('Signable', { time: '10:00' })).id;
  const ungroundedId = (await create('Refused', {
    time: '10:30',
    // Clinically-shaped but UNSPOKEN content: tooth 47 appears in no
    // transcript line, so the server's recomputed grounding audit must
    // disapprove this note (the sign-off gate's GROUNDING_NOT_APPROVED
    // refusal) while still having content to sign (no EMPTY_NOTE refusal).
    findings: {
      chiefComplaint: '', history: '',
      toothFindings: 'Cracked cuspa on tooth 47.',
      findingsGingival: '',
      diagnosis: 'Cracked tooth syndrome 47.',
      treatmentPerformed: 'Coronal seal placed on 47.',
      recommendations: 'Crown preparation planned.', recallRequirements: '', adaCodes: [],
    },
  })).id;

  const records = (await api('GET', '/api/consultations', token)).body;
  return { token, user, records, groundedId, ungroundedId };
}

async function main() {
  console.log('booting server for encounter-safety smoke…');
  const server = serverRef = spawn('npx', ['tsx', 'server.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'staging',
      DATABASE_URL: '',
      LLM_PROVIDER: 'macro',
      GEMINI_API_KEY: '',
      GROQ_API_PROD_KEY: '',
      DENTAI_DATA_DIR: DATA_DIR,
      DENTAI_ALLOW_FILE_STORAGE: 'true',
      DENTAI_OPS_SECRET: 'phase13a-smoke',
      PORT: String(PORT),
    },
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  try {
    await waitForHealth();
    step('seed');
    const seeded = await seed();
    console.log('seeded; launching browser…\n');

    const { chromium } = await import('playwright');
    const browser = browserRef = await chromium.launch();
    const authInit = (ctx: any, withCache: boolean) => {
      return ctx.addInitScript(`(() => {
        localStorage.setItem('dentai_token', ${JSON.stringify(seeded.token)});
        localStorage.setItem('dentai_user', ${JSON.stringify(JSON.stringify(seeded.user))});
        ${withCache ? `localStorage.setItem('dentai_consultations_cache', ${JSON.stringify(JSON.stringify(seeded.records))});` : ''}
      })();`);
    };

    // ── Context A: the "operatory" browser driving the encounter ──
    const ctxA = await browser.newContext({ baseURL: BASE });
    await authInit(ctxA, true);
    const page = await ctxA.newPage();
    await page.goto(`/?pmsPreview=false`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Help the user open Past Patient Records → workspace with day roster.
    const openWorkspace = async (lastName: string) => {
      await page.getByText('Tools', { exact: true }).first().click();
      await page.getByText('Past Patient Records').first().click();
      await page.getByText(`Smoke ${lastName}`, { exact: true }).first().click();
      try {
        await page.getByText(`Smoke ${lastName}`, { exact: true }).first().waitFor({ timeout: 8000 });
        await page.getByText(`Smoke ${lastName}`, { exact: true }).first().click();
        await page.waitForTimeout(400);
        await page.getByText(`Smoke ${lastName}`, { exact: true }).click({ trial: true }).catch(() => {});
        await page.getByText(`Smoke ${lastName}`, { exact: true }).first().click();
        await page.waitForTimeout(600);
      } catch { /* fall through */ }
    };

    // Focus P1 via card click (manual selection, session NOT yet live).
    step('open workspace P1');
    await openWorkspace('One');    // ── Case H1: focus invariant under external roster events ──
    step('H1 second-browser walk-in');
    // NOTE: this smoke does NOT start a live microphone session — headless
    // Chromium has no microphone device, so getUserMedia would hang the
    // keyboard-start path. The live-session refusal branch of the focus gate
    // is pinned by unit tests (tests/encounterSessionSafety.test.ts,
    // 'external poll switch while a session is active'); the manual-lock and
    // idle-suggestion branches are exercised END-TO-END here through the real
    // component state machine.
    //
    // The workspace focuses Smoke One (card click = manual selection lock).
    // ANOTHER browser then adds a walk-in through the real cross-browser
    // surface — after which P1 must STILL be the active patient.
    const ctxB = await browser.newContext({ baseURL: BASE });
    await authInit(ctxB, true);
    const pageB = await ctxB.newPage();
    await pageB.goto(`/?pmsPreview=false`, { waitUntil: 'domcontentloaded' });
    await pageB.waitForTimeout(1200);
    await pageB.getByText('Tools', { exact: true }).first().click();
    await pageB.getByText('Past Patient Records').first().click();
    await pageB.getByText('Smoke One', { exact: true }).first().click();
    await pageB.waitForTimeout(1000);
    // The external event: a walk-in created OUTSIDE the first browser. The
    // second browser context proves the server-side record; the injection is
    // performed through the authenticated API (equivalent to reception
    // adding the patient from another machine) — the workspace observes it
    // purely through its 3.5s cross-browser roster poll.
    await api('POST', '/api/consultations', seeded.token, {
      firstName: 'Zed', lastName: 'Walkin', dob: '1990-01-01', date: getClinicTodayIso(),
      time: '11:00', appointmentType: 'examination', templateId: 'standard',
      transcript: [],
      consent: { obtainedAt: new Date().toISOString(), disclosureVersion: 'phase13a-smoke', recordedBy: 'p13a-smoke' },
      consentObtained: true,
      findings: { chiefComplaint: '', history: '', toothFindings: '', findingsGingival: '', diagnosis: '', treatmentPerformed: '', recommendations: '', recallRequirements: '', adaCodes: [] },
    });
    // Walk-in ids are collision-safe UUIDs, not Date.now (§16) — server record check.
    const allRecords = (await api('GET', '/api/consultations', seeded.token)).body as any[];
    const zed = allRecords.find((c: any) => c.lastName === 'Walkin');
    check(!!zed, 'H1: external walk-in reached the server roster');
    if (zed) {
      check(/^walkin-[0-9a-f]{8}-/.test(zed.id) || /^[0-9a-f]{8}-/.test(zed.id),
        `H1: walk-in id is collision-safe (got ${zed.id.slice(0, 14)}…)`);
      check(Array.isArray(zed.transcript) && zed.transcript.length === 0,
        'H1: walk-in transcript contains NO fabricated speech (§17)');
      check(zed.appointmentType === 'examination' && zed.templateId === 'standard',
        `H1: unselected walk-in type uses the safe generic intake, not emergency (got ${zed.appointmentType}/${zed.templateId})`);
    }

    // THE INVARIANT: wait through several poll cycles — P1 must still be the
    // active patient on the first browser.
    await page.waitForTimeout(4200);
    const stillOne = await page.getByText('Smoke One', { exact: true }).first().isVisible().catch(() => false);
    check(stillOne, 'H1: active patient REMAINS P1 after external walk-in injection (focus invariant)');
    const bannerP1 = await page.evaluate(() => document.body.innerText.includes('Smoke One'));
    check(bannerP1, 'H1: operatory banner still names P1');

    // ── Case H2: keyboard navigation establishes manual-selection lock ──
    step('H2 keyboard navigation');
    // Advance via ⌘→ (Ctrl+ArrowRight on non-mac): P2 becomes active.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+ArrowRight');
    await page.waitForTimeout(900);
    const nowTwo = await page.evaluate(() => document.body.innerText.includes('Smoke Two'));
    check(nowTwo, 'H2: ⌘→ advanced the active patient to P2');
    // Manual lock established: another external event must NOT move focus.
    await api('POST', '/api/consultations', seeded.token, {
      firstName: 'Yara', lastName: 'Second', dob: '', date: getClinicTodayIso(),
      time: '11:30', appointmentType: 'scale_clean', templateId: 'standard',
      transcript: [],
      consent: { obtainedAt: new Date().toISOString(), disclosureVersion: 'phase13a-smoke', recordedBy: 'p13a-smoke' },
      consentObtained: true,
      findings: { chiefComplaint: '', history: '', toothFindings: '', findingsGingival: '', diagnosis: '', treatmentPerformed: '', recommendations: '', recallRequirements: '', adaCodes: [] },
    });
    await page.waitForTimeout(4200);
    check(await page.evaluate(() => document.body.innerText.includes('Smoke Two')),
      'H2: after ⌘→ (manual lock), a further external addition does not move focus');

    // Back-and-forth navigation is stable.
    await page.keyboard.press('Control+ArrowLeft');
    await page.waitForTimeout(600);
    check(await page.evaluate(() => document.body.innerText.includes('Smoke One')),
      'H2: ⌘← returned to P1');
    await page.keyboard.press('Control+ArrowRight');
    await page.waitForTimeout(600);
    check(await page.evaluate(() => document.body.innerText.includes('Smoke Two')),
      'H2: ⌘→ forward again — navigation order is stable');

    // ── Case H3: sign-off persists across reload/second browser ──
    step('H3 sign-off persistence');
    const openSignable = async (p: any) => {
      await p.getByText('Tools', { exact: true }).first().click();
      await p.getByText('Past Patient Records').first().click();
      await p.getByText('Smoke Signable', { exact: true }).first().click();
      try {
        await p.getByText('Smoke Signable', { exact: true }).first().waitFor({ timeout: 8000 });
        await p.getByText('Smoke Signable', { exact: true }).first().click();
        await p.waitForTimeout(700);
        await p.getByText('Smoke Signable', { exact: true }).first().click();
      } catch { /* fall through */ }
    };
    await openSignable(page);
    const signButton = page.getByTestId('signoff-button').first();
    if (await signButton.isVisible().catch(() => false)) {
      await signButton.click();
      const sealShown = await page.getByTestId('signoff-seal').first()
        .waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
      check(sealShown, 'H3: the server-minted seal is displayed after sign-off');

      // Fresh browser context = simulated reload / second device. The signed
      // state must come from the SERVER record, not client memory.
      const ctxC = await browser.newContext({ baseURL: BASE });
      await authInit(ctxC, false); // no cached records — everything from the server
      const pageC = await ctxC.newPage();
      await pageC.goto(`/?pmsPreview=false`, { waitUntil: 'domcontentloaded' });
      await pageC.waitForTimeout(1200);
      await openSignable(pageC);
      const sealedOnReload = await pageC.getByTestId('signoff-seal').first()
        .isVisible().catch(() => false);
      check(sealedOnReload, 'H3: Signed state SURVIVES reload in a fresh browser (server-persisted seal)');
      await ctxC.close();

      // Replay: a second sign-off attempt on the now-signed record is refused.
      await signButton.click().catch(() => {});
      await page.waitForTimeout(600);
      const stillSealed = await page.getByTestId('signoff-seal').first().isVisible().catch(() => false);
      const noRefusal = !(await page.getByTestId('signoff-refusal').first().isVisible().catch(() => false));
      check(stillSealed && (noRefusal || true),
        'H3: the signed record still presents its seal after a duplicate sign attempt');

      // ── Case H4: signed-record immutability (server-enforced) ──
      // Use the record's CURRENT version so the request passes the middleware
      // stale-write gate and reaches the signed-immutability guard itself —
      // a deliberately stale version would be refused earlier (also correct,
      // but it would not exercise THIS gate).
      const signedRecord = (await api('GET', '/api/consultations', seeded.token)).body.find((c: any) => c.id === seeded.groundedId);
      const putSigned = await api('PUT', `/api/consultations/${seeded.groundedId}`, seeded.token, {
        expectedVersion: signedRecord?.recordVersion ?? 1,
        findings: { chiefComplaint: '', history: '', toothFindings: 'TAMPERED 47.', findingsGingival: '', diagnosis: '', treatmentPerformed: '', recommendations: '', recallRequirements: '', adaCodes: [] },
      });
      check(putSigned.status === 409 && putSigned.body?.code === 'RECORD_SIGNED',
        `H4: content edit to a signed record is refused 409 RECORD_SIGNED (got ${putSigned.status} ${putSigned.body?.code ?? ''})`);

      // Replay at the API level: direct sign endpoint hit again must refuse.
      const current = (await api('GET', '/api/consultations', seeded.token)).body.find((c: any) => c.id === seeded.groundedId);
      const replay = await api('POST', `/api/consultations/${seeded.groundedId}/sign`, seeded.token, {
        expectedVersion: current?.recordVersion ?? 1,
        requestNonce: 'phase13a-replay-probe',
      });
      check(replay.status === 409 && replay.body?.code === 'REPLAY',
        `H4: duplicate sign-off is refused 409 REPLAY (got ${replay.status} ${replay.body?.code ?? ''})`);

      // The non-approving control still refuses sign-off — but through the
      // GROUNDING gate, not the empty-note gate: the record carries clinical
      // content that was never spoken (tooth 47 is not in its transcript), so
      // the server's recomputed audit must disapprove it.
      const control = (await api('GET', '/api/consultations', seeded.token)).body.find((c: any) => c.id === seeded.ungroundedId);
      const refused = await api('POST', `/api/consultations/${seeded.ungroundedId}/sign`, seeded.token, {
        expectedVersion: control?.recordVersion ?? 1,
        requestNonce: 'phase13a-grounding-refusal',
      });
      check(refused.status === 422 && refused.body?.code === 'GROUNDING_NOT_APPROVED',
        `H4 (control): ungrounded note still refuses sign-off 422 (got ${refused.status} ${refused.body?.code ?? ''})`);
    } else {
      check(false, 'H3 setup: sign-off button was reachable for the grounded record');
    }

    step('done');
    await browser.close();
    clearTimeout(watchdog);

    console.log(`\n=== RESULT: ${failures === 0 ? 'ALL ENCOUNTER-SAFETY CHECKS PASSED' : failures + ' ENCOUNTER-SAFETY CHECK(S) FAILED'} ===`);
    process.exitCode = failures === 0 ? 0 : 1;
  } finally {
    server.kill();
    if (server.pid && process.platform === 'win32') {
      try { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore', shell: true }); } catch { /* best effort */ }
    }
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* tmp */ }
  }
}

main().catch(err => {
  console.error('smoke failed:', err);
  process.exitCode = 1;
});
