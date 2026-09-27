/**
 * Phase 12 Gate 7 — automated browser smoke coverage (safety-critical UI).
 *
 * Boots the real server in a hermetic staging profile (deterministic macro
 * provider, throwaway JSON store, synthetic data only), seeds four
 * consultations through the real HTTP surface, then drives the real UI with
 * Playwright and asserts the actual rendered badge behaviour:
 *
 *   Case A — unverified note must NOT display "Verified from Audio"
 *   Case B — a server-approved note may display "Verified from Audio"
 *   Case C — deterministic macro path displays "Template Applied", never a
 *            verified claim
 *   Case D — after a clinician correction invalidates grounding, the stale
 *            verified badge must not persist
 *   Case E — an incomplete/unverified note presents no signed/verified state
 *
 * Run: npx tsx scripts/phase12-ui-smoke.ts
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Seed dates use the app's OWN clinic-day definition. A UTC-date seed broke
// every roster-dependent case when the run crossed local midnight in a
// clinic-timezone-ahead-of-UTC environment (e.g. Australian clinics): the
// workspace organizes the day by getClinicTodayIso(), not by UTC date.
import { getClinicTodayIso } from '../src/utils/date';

const PORT = 31000 + Math.floor(Math.random() * 20000); // unique per run — an orphaned prior server must never shadow this run
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dentai-p12-ui-'));

process.env.DENTAI_SMOKE = '1';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${msg}`);
  if (!cond) failures++;
};

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
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await r.json(); } catch { /* empty body */ }
  return { status: r.status, body: json };
}

async function seed(): Promise<{ token: string; user: any; records: any[]; ids: Record<string, string>; scheduleSeed: string }> {
  const reg = await api('POST', '/api/auth/register', undefined, { name: 'Dr UI Smoke', specialty: 'General Dentistry', pin: '2718' });
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

  // Chairside-style seeding: records are created the way the chairside client
  // creates them (POST with an ISO date + transcript), so the workspace day
  // schedule and the canvas badge logic see exactly what production sees. The
  // server recomputes the grounding audit on every POST/PUT.
  const create = async (lastName: string, body: Record<string, unknown>) => {
    const r = await api('POST', '/api/consultations', token, {
      firstName: 'Smoke', lastName, dob: '1980-04-04', date: isoToday, time: '09:15',
      appointmentType: 'emergency', templateId: 'standard', transcript,
      // Canonical consent (with a captured-at timestamp): the sign-off gate
      // refuses transcript-bearing records without a real consent instant —
      // the legacy bare boolean alone no longer satisfies that gate.
      consent: { obtainedAt: new Date().toISOString(), disclosureVersion: 'phase12-ui-smoke', recordedBy: 'ui-smoke' },
      consentObtained: true,
      findings: { chiefComplaint: '', history: '', toothFindings: '', findingsGingival: '', diagnosis: '', treatmentPerformed: '', recommendations: '', recallRequirements: '', adaCodes: [] },
      ...body,
    });
    if (![200, 201].includes(r.status)) throw new Error(`create failed: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return r.body as any;
  };
  const groundedFindings = {
    chiefComplaint: '', history: '',
    toothFindings: 'Deep caries 36, percussion positive.',
    findingsGingival: '',
    diagnosis: 'Symptomatic irreversible pulpitis 36.',
    treatmentPerformed: 'Extirpation completed on 36.',
    recommendations: 'Analgesia advice given.', recallRequirements: '', adaCodes: [],
  };

  // A — unverified: hosted note that never became grounded (findings empty).
  const A = (await create('Alpha', {
    status: 'In Review',
    noteOrigin: { engine: 'groq', needsReview: true, detail: 'Generated via cloud AI' },
  })).id;
  // B — verified: completed with transcript-grounded content → audit approves.
  const B = (await create('Bravo', {
    status: 'Completed', findings: groundedFindings,
    noteOrigin: { engine: 'groq', needsReview: false, detail: 'Generated via cloud AI' },
  })).id;
  // C — macro/deterministic: template-finalized skeleton the audio never spoke.
  const C = (await create('Charlie', {
    status: 'Completed',
    findings: { chiefComplaint: '', history: '', toothFindings: 'Site: #26.', findingsGingival: '', diagnosis: '', treatmentPerformed: 'Site: #26.', recommendations: '', recallRequirements: '', adaCodes: [] },
    noteOrigin: { engine: 'australian-clinical-macro', needsReview: true, detail: 'Generated via Australian clinical macro engine.' },
  })).id;
  // D — corrected: was approved, then a clinician edit adds ungrounded content
  // → the server recomputes the audit and approval must drop.
  const dRec = await create('Delta', {
    status: 'Completed', findings: groundedFindings,
    noteOrigin: { engine: 'groq', needsReview: false, detail: 'Generated via cloud AI' },
  });
  const corr = await api('PUT', `/api/consultations/${dRec.id}`, token, {
    expectedVersion: dRec.recordVersion ?? 1,
    // A correction that replaces the note content with clinical claims about
    // teeth/procedures that were NEVER spoken in this audio — the audited
    // approval must not survive it.
    findings: {
      chiefComplaint: '', history: '',
      toothFindings: 'Fractured incisal edge 21.',
      findingsGingival: '',
      diagnosis: 'Acute pericoronitis 38.',
      treatmentPerformed: 'Coronectomy completed on 38.',
      recommendations: 'Review in one week.', recallRequirements: '', adaCodes: [],
    },
  });
  if (![200, 201].includes(corr.status)) throw new Error(`correction failed: ${corr.status}`);
  const d2 = (await api('GET', '/api/consultations', token)).body.find((c: any) => c.id === dRec.id);
  if (d2?.groundingAudit?.isApprovedForSigning !== false) {
    throw new Error(`Case D seed failed: approval did not drop after correction (blocking: ${JSON.stringify(d2?.groundingAudit?.blockingReasons)})`);
  }

  const records = (await api('GET', '/api/consultations', token)).body;

  // Day-schedule roster seed for the literal badge strings in the schedule UI.
  const schedule = [
    { id: A, time: '09:00', patientName: 'Smoke Alpha', procedureText: 'Emergency Examination', appointmentType: 'emergency', templateId: 'standard', status: 'note_generated', isFullyGrounded: false, groundingScore: 40, clinicalNote: 'note A', transcript: [] },
    { id: B, time: '09:30', patientName: 'Smoke Bravo', procedureText: 'Emergency Examination', appointmentType: 'emergency', templateId: 'standard', status: 'note_generated', isFullyGrounded: true, groundingScore: 100, clinicalNote: 'note B', transcript: [] },
  ];
  const seedScript = `
    localStorage.setItem('dentai_pms_preview', 'true');
    localStorage.setItem('dentai_day_schedule_${isoToday}', ${JSON.stringify(JSON.stringify(schedule))});
  `;
  return { token, user, records, ids: { A, B, C, D: dRec.id }, scheduleSeed: seedScript };
}

async function main() {
  console.log('booting server for UI smoke…');
  const server = spawn('npx', ['tsx', 'server.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'staging',
      // Force the hermetic JSON store: an inherited DATABASE_URL (e.g. injected
      // from .env.local by tsx) would silently point the child at a shared
      // database instead of the throwaway data dir.
      DATABASE_URL: '',
      LLM_PROVIDER: 'macro',
      GEMINI_API_KEY: '',
      GROQ_API_PROD_KEY: '',
      DENTAI_DATA_DIR: DATA_DIR,
      DENTAI_ALLOW_FILE_STORAGE: 'true',
      DENTAI_OPS_SECRET: 'phase12-ui-smoke',
      PORT: String(PORT),
    },
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  try {
    await waitForHealth();
    const seeded = await seed();
    console.log('seeded; launching browser…\n');

    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    const authInit = async (ctx: any, withCache: boolean) => {
      await ctx.addInitScript(`(() => {
        localStorage.setItem('dentai_token', ${JSON.stringify(seeded.token)});
        localStorage.setItem('dentai_user', ${JSON.stringify(JSON.stringify(seeded.user))});
        ${withCache ? `localStorage.setItem('dentai_consultations_cache', ${JSON.stringify(JSON.stringify(seeded.records))});` : ''}
      })();`);
    };

    // ── Context 2: records list → chairside canvas badges (Cases A–D) ──
    const ctx2 = await browser.newContext({ baseURL: BASE });
    await authInit(ctx2, true);
    await ctx2.addInitScript("localStorage.setItem('dentai_pms_preview', 'false');");
    const page = await ctx2.newPage();

    const openRecord = async (lastName: string) => {
      await page.goto(`/?pmsPreview=false`, { waitUntil: 'domcontentloaded' });
      await page.getByText('Tools', { exact: true }).first().click();
      await page.getByText('Past Patient Records').first().click();
      await page.getByText(`Smoke ${lastName}`, { exact: true }).first().click();
      // The workspace sidebar may still be hydrating (3.5s sync poll) — wait
      // for the selected encounter card, then click it to focus the canvas.
      try {
        await page.getByText(`Smoke ${lastName}`, { exact: true }).first().waitFor({ timeout: 8000 });
        await page.getByText(`Smoke ${lastName}`, { exact: true }).first().click();
        await page.waitForTimeout(500);
        await page.getByText(`Smoke ${lastName}`, { exact: true }).first().click();
      } catch { /* fall through to assertions */ }
      await page.waitForTimeout(800);
      if (!process.env.DENTAI_SMOKE_QUIET) {
        const dump = await page.evaluate(() => document.body.innerText.slice(0, 900));
        console.log(`  [debug] canvas ${lastName}:`, JSON.stringify(dump));
      }
    };

    const canvasText = async () => (await page.locator('text=Clinical Note Canvas').first().isVisible()) || false;

    // Case B first (positive control): verified badge IS shown for an approved note.
    await openRecord('Bravo');
    check(await canvasText(), 'Case B: chairside canvas rendered for the approved note');
    if (!process.env.DENTAI_SMOKE_QUIET) {
      const dump = await page.evaluate(() => document.body.innerText.slice(0, 1500));
      console.log('  [debug] page text head:', JSON.stringify(dump));
      const recs = await page.evaluate(async () => {
        const t = localStorage.getItem('dentai_token');
        const r = await fetch('/api/consultations', { headers: { Authorization: `Bearer ${t}` } });
        return r.json();
      });
      console.log('  [debug] server records:', JSON.stringify((recs as any[]).slice(0, 6).map((c: any) => ({ n: `${c.firstName} ${c.lastName}`, date: c.date, id: c.id.slice(0, 8) }))));
    }
    check(await page.getByText('Verified from Audio', { exact: true }).first().isVisible().catch(() => false),
      'Case B: server-approved note displays "Verified from Audio"');

    // Case A: unverified note — the canvas renders the note with NO verified
    // badge anywhere (the absent badge IS the non-verified presentation for a
    // hosted note whose audit did not approve).
    await openRecord('Alpha');
    check(await canvasText(), 'Case A: canvas rendered for the unverified note');
    check(!(await page.getByText('Verified from Audio', { exact: true }).first().isVisible().catch(() => false)),
      'Case A: unverified note does NOT display "Verified from Audio" (non-verified state)');

    // Case C: deterministic macro path — Template Applied, never a verified claim.
    await openRecord('Charlie');
    check(await page.getByText('Template Applied', { exact: true }).first().isVisible().catch(() => false),
      'Case C: macro/deterministic path displays "Template Applied"');
    check(!(await page.getByText('Verified from Audio', { exact: true }).first().isVisible().catch(() => false)),
      'Case C: macro path does NOT claim "Verified from Audio"');

    // Case D: corrected note — the stale verified badge must not persist.
    await openRecord('Delta');
    check(!(await page.getByText('Verified from Audio', { exact: true }).first().isVisible().catch(() => false)),
      'Case D: after a correction invalidates grounding, no verified badge is displayed');

    // Case E: the incomplete note presents no signed/verified state.
    await openRecord('Alpha');
    const anyVerifiedClaim = await page.getByText(/Verified from Audio/i).first().isVisible().catch(() => false);
    check(!anyVerifiedClaim, 'Case E: incomplete note presents no signed/verified state in the UI');

    // Case F: sign-off REQUEST on an ungrounded note — the server refuses and
    // the UI displays that refusal verbatim. The client never decides signed
    // state; a refusal must be visible, not swallowed.
    await openRecord('Delta');
    await page.getByTestId('signoff-button').first().click();
    const refusalShown = await page.getByTestId('signoff-refusal').first()
      .waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
    check(refusalShown, 'Case F: sign-off refusal is displayed for an ungrounded note');
    const refusalCode = refusalShown
      ? await page.getByTestId('signoff-refusal').first().getAttribute('data-code')
      : null;
    check(refusalCode === 'GROUNDING_NOT_APPROVED',
      `Case F: refusal carries the server code GROUNDING_NOT_APPROVED (got: ${refusalCode})`);
    // The refused note must STILL NOT show any signed state.
    check(!(await page.getByTestId('signoff-seal').first().isVisible().catch(() => false)),
      'Case F: no signed state is presented after a refused sign-off');

    // Case G: sign-off on a server-approved note — ONLY the server response
    // (minted seal) establishes the signed state shown in the UI.
    await openRecord('Bravo');
    await page.getByTestId('signoff-button').first().click();
    const sealShown = await page.getByTestId('signoff-seal').first()
      .waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
    check(sealShown, 'Case G: the server-minted seal is displayed after successful sign-off');
    check(!(await page.getByTestId('signoff-refusal').first().isVisible().catch(() => false)),
      'Case G: no refusal is shown for the approved record');

    // ── Context 1: schedule roster literal strings (Case A/B literals) ──
    const ctx1 = await browser.newContext({ baseURL: BASE });
    await authInit(ctx1, false);
    await ctx1.addInitScript(seeded.scheduleSeed);
    const page1 = await ctx1.newPage();
    await page1.goto(`/?pmsPreview=true`, { waitUntil: 'domcontentloaded' });
    await page1.getByText('Tools', { exact: true }).first().click();
    await page1.getByText('Past Patient Records').first().click();
    await page1.getByText("Today's Schedule").first().click();
    await page1.waitForTimeout(800);
    check(await page1.getByText('Verified from Audio ✓').first().isVisible().catch(() => false),
      'Case B (schedule): fully grounded roster item shows "Verified from Audio ✓"');
    check(await page1.getByText('Review (40%)').first().isVisible().catch(() => false),
      'Case A (schedule): unverified roster item shows the review control, not a verified badge');
    await page1.getByText('Review (40%)').first().click();
    await page1.waitForTimeout(400);
    check(await page1.getByText('Clinician Verification Required', { exact: true }).first().isVisible().catch(() => false),
      'Case A (schedule): verification modal states "Clinician Verification Required"');

    await browser.close();

    console.log(`\n=== RESULT: ${failures === 0 ? 'ALL SMOKE CHECKS PASSED' : failures + ' SMOKE CHECK(S) FAILED'} ===`);
    process.exitCode = failures === 0 ? 0 : 1;
  } finally {
    server.kill();
    if (server.pid && process.platform === 'win32') {
      try { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore', shell: true }); } catch { /* best effort */ }
    }
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* tmp */ }
  }
}

main().catch(e => { console.error('UI smoke error:', e); process.exit(1); });
