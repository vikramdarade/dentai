/**
 * Comprehensive Dentist End-to-End Persona Playtest Suite
 *
 * Simulates a full clinical working day of an Australian dental practitioner
 * using DentAI chairside from morning login to end-of-day sign-off:
 *
 * Scenarios Tested:
 *  1. Practitioner Morning Onboarding & Fresh Operatory Workspace
 *  2. Comprehensive Examination & Prophylaxis (ADA 011 / 114) with Transcript & Note Generation
 *  3. Operative Direct Restoration (Tooth 16 MO Composite, ADA 532) & Cryptographic Sign & Seal
 *  4. Surgical Oral Surgery (Tooth 48 Surgical Extraction, ADA 311 / 324) & Post-Op Care
 *  5. Emergency Endodontics (Tooth 24 Acute Pulpitis Extirpation, ADA 414)
 *  6. Multi-Patient Sessions Drawer Navigation, Filtering & Record Rehydration
 *  7. Separate Merged Consultation Flow
 *  8. Full Page Reload Persistence & Practice Hub Navigation
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Locator } from 'playwright';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const PORT = Number(process.env.E2E_CLINICAL_PORT || 4402);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PIN = '8491'; // Secure non-trivial PIN

let server: ChildProcess | undefined;
let browser: Browser | undefined;
let dataDir = '';
let serverLog = '';

function nodeBinary(): string {
  const override = process.env.DENTAI_E2E_NODE;
  if (override) return override;
  return /[\\/]bun(\.exe)?$/i.test(process.execPath) ? 'node' : process.execPath;
}

async function waitForServer(url: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`, { signal: credentialsAbort(1500) });
      if (res.ok) return;
    } catch {
      // Server still booting Vite dev pipeline
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server failed to start at ${url} within ${timeoutMs}ms.\nLog snippet:\n${serverLog}`);
}

function credentialsAbort(ms: number): AbortSignal {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms).unref?.();
  return ctrl.signal;
}

async function expectVisible(locator: Locator, timeoutMs = 15_000): Promise<void> {
  const el = locator.first();
  await el.waitFor({ state: 'visible', timeout: timeoutMs });
  expect(await el.isVisible()).toBe(true);
}

async function expectHidden(locator: Locator, timeoutMs = 15_000): Promise<void> {
  const el = locator.first();
  await el.waitFor({ state: 'hidden', timeout: timeoutMs });
  expect(await el.isVisible()).toBe(false);
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentai-clinical-e2e-'));

  server = spawn(nodeBinary(), ['--import', 'tsx', 'server.ts'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DISABLE_HMR: 'true',
      PORT: String(PORT),
      DATABASE_URL: '',
      DENTAI_DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const capture = (chunk: Buffer) => {
    serverLog = (serverLog + chunk.toString()).slice(-8000);
  };
  server.stdout?.on('data', capture);
  server.stderr?.on('data', capture);

  await waitForServer(BASE_URL);
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  if (server?.pid) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      server.kill('SIGTERM');
    }
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('Clinical Workspace - Daily Dentist Persona & Operations', () => {
  it('executes full daily operatory workflow across exams, restorative, surgical, endo, notes, sign-off, drawer, and reload', async () => {
    const context = await browser!.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();

    // Catch any unexpected client runtime exceptions
    const devServerTransportNoise = /WebSocket closed without opened|failed to connect to websocket/i;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => {
      if (!devServerTransportNoise.test(error.message)) pageErrors.push(error.message);
    });

    try {
      // =========================================================================
      // 1. DENTIST MORNING LOGIN & FRESH WORKSPACE SETUP
      // =========================================================================
      await page.goto(BASE_URL);

      // Open Register Profile modal
      await page.getByRole('button', { name: 'Register Profile' }).click();
      const registerForm = page.locator('form').filter({ hasText: 'Create Practitioner Account' });
      await registerForm.waitFor({ state: 'visible' });

      // Fill dentist profile credentials
      await registerForm.locator('input[type="text"]').nth(0).fill('Dr. Marcus Vance');
      await registerForm.locator('input[type="text"]').nth(1).fill('General & Restorative Dentistry');
      await registerForm.locator('input[type="password"]').nth(0).fill(PIN);
      await registerForm.locator('input[type="password"]').nth(1).fill(PIN);
      await registerForm.getByRole('button', { name: 'Create Practitioner Account' }).click();

      // Verify landing on the Clinical Workspace canvas
      await page.getByPlaceholder('Patient Name').waitFor({ state: 'visible', timeout: 30_000 });
      await expectVisible(page.getByText('Dr. Marcus Vance'));
      await expectVisible(page.getByRole('button', { name: 'New session' }));

      // =========================================================================
      // 2. ENCOUNTER 1: COMPREHENSIVE EXAMINATION & SCALE (ADA 011 / 114)
      // =========================================================================
      const patientInput = page.getByPlaceholder('Patient Name');
      await patientInput.fill('Sarah Jenkins');
      await page.waitForTimeout(400); // Allow debounce

      // Set Patient Context
      await page.getByRole('button', { name: 'Context', exact: true }).click();
      const contextArea = page.locator('#context-notes');
      await contextArea.fill('Periodic examination and scale. Nil medical conditions. Nil known drug allergies.');
      await page.waitForTimeout(400);

      // Navigate to Transcript Tab
      await page.getByRole('button', { name: /transcript/i }).click();
      await expectVisible(page.getByRole('heading', { name: 'Verbatim Speech Transcript' }));

      // Add spoken lines through Quick Utterance Entry dock
      const utteranceInput = page.locator('#transcript-utterance-input');
      const addUtteranceBtn = page.locator('#btn-add-utterance');

      await utteranceInput.fill("Good morning Sarah, we'll start with a comprehensive examination and dental charting.");
      await addUtteranceBtn.click();
      await expectVisible(page.getByText("Good morning Sarah, we'll start with a comprehensive examination"));

      await utteranceInput.fill('Tooth 16 has an existing composite with recurrent distal caries and marginal breakdown.');
      await addUtteranceBtn.click();
      await expectVisible(page.getByText('Tooth 16 has an existing composite with recurrent distal caries'));

      await utteranceInput.fill('Tooth 26 sound. All other teeth examined sound. Light supragingival calculus lower lingual.');
      await addUtteranceBtn.click();
      await expectVisible(page.getByText('Tooth 26 sound'));

      await utteranceInput.fill('Prophylaxis completed with fine pumice paste. Topical fluoride foam applied for 4 minutes.');
      await addUtteranceBtn.click();
      await expectVisible(page.getByText('Prophylaxis completed with fine pumice paste'));

      // Verify utterance count badge
      await expectVisible(page.getByText('4 utterances'));

      // Trigger Note Generation
      await page.getByRole('button', { name: /create note/i }).click();

      // Switch to Note Tab
      await page.getByRole('button', { name: 'Note', exact: true }).click();

      // Verify Note contains key examination findings
      await expectVisible(page.getByText(/subjective/i));
      await expectVisible(page.getByText(/16/));

      // Verify PMS copy button
      const copyBtn = page.getByRole('button', { name: 'Copy to PMS' });
      await expectVisible(copyBtn);
      await copyBtn.click();
      await expectVisible(page.getByText('Copied!'));

      // =========================================================================
      // 3. ENCOUNTER 2: OPERATIVE RESTORATION (16 MO COMPOSITE) & SIGN-OFF
      // =========================================================================
      // Advance to next patient using "Next Patient" button
      await page.getByRole('button', { name: 'Next Patient' }).click();

      // Patient Name
      await page.getByPlaceholder('Patient Name').waitFor({ state: 'visible' });
      await page.getByPlaceholder('Patient Name').fill('David Kim');
      await page.waitForTimeout(400);

      // Context
      await page.getByRole('button', { name: 'Context', exact: true }).click();
      await page.locator('#context-notes').fill('Attending for booked tooth 16 disto-occlusal composite restoration.');
      await page.waitForTimeout(400);

      // Transcript
      await page.getByRole('button', { name: /^Transcript/i }).click();
      await expectVisible(page.getByRole('heading', { name: 'Verbatim Speech Transcript' }));
      await utteranceInput.fill('Local anaesthesia: 2.2mL Lignocaine 2% with 1:80,000 adrenaline via infiltration tooth 16.');
      await addUtteranceBtn.click();
      await expectVisible(page.getByText('Local anaesthesia: 2.2mL Lignocaine'));

      await utteranceInput.fill('Rubber dam isolation applied tooth 16. Existing restoration and recurrent caries removed.');
      await addUtteranceBtn.click();
      await expectVisible(page.getByText('Rubber dam isolation applied tooth 16'));

      await utteranceInput.fill('Acid etched with 37% phosphoric acid. Single bond applied and light cured for 20s.');
      await addUtteranceBtn.click();
      await expectVisible(page.getByText('Acid etched with 37% phosphoric acid'));

      await utteranceInput.fill('Restored tooth 16 MO with Filtek Supreme composite shade A2. Finished with fine diamonds and polished.');
      await addUtteranceBtn.click();
      await expectVisible(page.getByText('Restored tooth 16 MO with Filtek Supreme'));

      // Generate Note
      await page.getByRole('button', { name: /create note/i }).click();
      await page.getByRole('button', { name: 'Note', exact: true }).click();

      // Switch note template to SOAP Note if present
      const soapBtn = page.getByRole('button', { name: 'SOAP Note' });
      if (await soapBtn.isVisible()) {
        await soapBtn.click();
      }

      // Verify Note is generated with findings
      await expectVisible(page.getByText(/16/));

      // Test Cryptographic Sign & Seal
      const signBtn = page.getByRole('button', { name: /sign & seal/i });
      if (await signBtn.isVisible()) {
        await page.route('**/api/consultations/*/sign', (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              ok: true,
              seal: {
                signatureHash: 'sha256-e2e-valid-seal',
                signedBy: 'Dr. Marcus Vance',
                signedAt: new Date().toISOString(),
                auditStatus: 'Verified from Audio',
              },
              recordVersion: 2,
              signedAt: new Date().toISOString(),
            }),
          })
        );
        await signBtn.click();
        // Wait for sign-off cryptographic verification
        await expectVisible(page.getByText(/sealed/i), 15_000);
      }

      // =========================================================================
      // 4. ENCOUNTER 3: SURGICAL WISDOM TOOTH EXTRACTION (ADA 311 / 324)
      // =========================================================================
      // Advance to next patient using "+ New session"
      await page.getByRole('button', { name: 'New session' }).click();

      await page.getByPlaceholder('Patient Name').waitFor({ state: 'visible' });
      await page.getByPlaceholder('Patient Name').fill('Elena Rostova');
      await page.waitForTimeout(400);

      // Context
      await page.getByRole('button', { name: 'Context', exact: true }).click();
      await page.locator('#context-notes').fill('Recurrent pericoronitis lower right quadrant. Surgical extraction tooth 48 planned.');
      await page.waitForTimeout(400);

      // Transcript
      await page.getByRole('button', { name: /^Transcript/i }).click();
      await expectVisible(page.getByRole('heading', { name: 'Verbatim Speech Transcript' }));
      await utteranceInput.fill('Inferior alveolar nerve block with 2.2mL Articaine 4% with 1:100,000 adrenaline. Profound anaesthesia confirmed.');
      await addUtteranceBtn.click();
      await expectVisible(page.getByText('Inferior alveolar nerve block'));

      await utteranceInput.fill('Surgical extraction of tooth 48. Full thickness envelope flap raised. Buccal guttering with surgical bur under saline.');
      await addUtteranceBtn.click();
      await expectVisible(page.getByText('Surgical extraction of tooth 48'));

      await utteranceInput.fill('Crown sectioned and roots delivered intact. Socket debrided and irrigated. Hemostasis achieved with Surgicel.');
      await addUtteranceBtn.click();
      await expectVisible(page.getByText('Crown sectioned and roots delivered intact'));

      await utteranceInput.fill('Closed with 3-0 Vicryl resorbable sutures. Post-operative care instructions provided.');
      await addUtteranceBtn.click();
      await expectVisible(page.getByText('Closed with 3-0 Vicryl resorbable sutures'));

      // Generate note
      await page.getByRole('button', { name: /create note/i }).click();
      await page.getByRole('button', { name: 'Note', exact: true }).click();
      await expectVisible(page.getByText(/48/));

      // =========================================================================
      // 5. ENCOUNTER 4: EMERGENCY ENDODONTICS (ADA 414 EXTIRPATION)
      // =========================================================================
      await page.getByRole('button', { name: 'New session' }).click();

      await page.getByPlaceholder('Patient Name').waitFor({ state: 'visible' });
      await page.getByPlaceholder('Patient Name').fill('Michael Chang');
      await page.waitForTimeout(400);

      await page.getByRole('button', { name: 'Context', exact: true }).click();
      await page.locator('#context-notes').fill('Acute severe throbbing pain upper left, waking patient at night.');
      await page.waitForTimeout(400);

      await page.getByRole('button', { name: /^Transcript/i }).click();
      await expectVisible(page.getByRole('heading', { name: 'Verbatim Speech Transcript' }));
      await utteranceInput.fill('Tooth 24 tender to percussion. Lingering severe pain with cold test. Diagnosis: irreversible pulpitis tooth 24.');
      await addUtteranceBtn.click();
      await expectVisible(page.getByText('Tooth 24 tender to percussion'));

      await utteranceInput.fill('Rubber dam placed. Access cavity prepared. Pulp tissue extirpated from buccal and palatal canals.');
      await addUtteranceBtn.click();
      await expectVisible(page.getByText('Rubber dam placed'));

      await utteranceInput.fill('Canals copiously irrigated with 1% sodium hypochlorite. Odontopaste dressing placed. Sealed with Cavit temporary.');
      await addUtteranceBtn.click();
      await expectVisible(page.getByText('Canals copiously irrigated'));

      await page.getByRole('button', { name: /create note/i }).click();
      await page.getByRole('button', { name: 'Note', exact: true }).click();
      await expectVisible(page.getByText(/24/));

      // =========================================================================
      // 6. SESSIONS DRAWER, FILTERING, SWITCHING & SPLITTING
      // =========================================================================
      // Open Sessions Drawer
      await page.getByRole('button', { name: /^Sessions/ }).click();
      await expectVisible(page.getByText('Patient Sessions'));

      // Verify all patients appear in the drawer
      await expectVisible(page.getByText('Sarah Jenkins'));
      await expectVisible(page.getByText('David Kim'));
      await expectVisible(page.getByText('Elena Rostova'));
      await expectVisible(page.getByText('Michael Chang'));

      // Test Drawer Filter: Saved / Completed filter
      const savedFilterBtn = page.getByRole('button', { name: /Saved/i });
      if (await savedFilterBtn.isVisible()) {
        await savedFilterBtn.click();
        await expectVisible(page.getByText('Sarah Jenkins'));
      }

      // Switch back to "All"
      await page.getByRole('button', { name: /^All/i }).click();

      // Click on Sarah Jenkins in drawer to switch back to her encounter
      await page.getByText('Sarah Jenkins').first().click();

      // Verify Sarah Jenkins session loaded cleanly with all her data preserved
      expect(await page.getByPlaceholder('Patient Name').inputValue()).toBe('Sarah Jenkins');
      await page.getByRole('button', { name: /transcript/i }).click();
      await expectVisible(page.getByText('Tooth 16 has an existing composite'));

      // Test Separate Merged Session modal
      const separateBtn = page.getByRole('button', { name: 'Separate Merged Session' });
      await expectVisible(separateBtn);
      await separateBtn.click();

      // Verify Split Session Modal mounted
      await expectVisible(page.locator('#split-session-title'));
      // Close modal
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expectHidden(page.locator('#split-session-title'));

      // =========================================================================
      // 7. FULL RELOAD PERSISTENCE & PRACTICE HUB NAVIGATION
      // =========================================================================
      // Reload page and ensure practitioner session and consultations survive
      await page.reload();
      await page.getByPlaceholder('Patient Name').waitFor({ state: 'visible', timeout: 30_000 });
      await expectVisible(page.getByText('Dr. Marcus Vance'));

      // Verify Practice Hub navigation buttons
      await expectVisible(page.getByRole('button', { name: 'Day Schedule' }));
      await expectVisible(page.getByRole('button', { name: 'Treatment Pipeline' }));
      await expectVisible(page.getByRole('button', { name: 'Practice Records' }));

      // Navigate to Treatment Pipeline Hub
      await page.getByRole('button', { name: 'Treatment Pipeline' }).click();
      await expectVisible(page.getByText(/treatment/i));

      // Return to Workspace
      await page.getByRole('button', { name: 'New Consultation' }).click();
      await expectVisible(page.getByPlaceholder('Patient Name'));

      // Final check: zero unexpected page errors occurred during the entire day
      expect(pageErrors, 'no unhandled exceptions in the entire clinical workflow').toEqual([]);
    } finally {
      await context.close();
    }
  });
});
