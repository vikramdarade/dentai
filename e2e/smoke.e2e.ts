/**
 * End-to-end smoke test — the smallest real-user flow that would have caught the
 * blank-screen-on-save defect found in the 2026-10-02 playtest.
 *
 * What it drives, through the real UI in a real browser:
 *   register a clinician → (stored session fixture) → generate a note →
 *   separate a merged session → reload
 *
 * What it asserts:
 *   * each save reaches the server (an accepted POST/PUT on /api/consultations)
 *   * the note and BOTH split records are still there after a reload
 *   * no uncaught exception ever reaches the page
 *
 * The three assertions fail loudly on the defect class this exists for:
 * the save handler used to stop at local state (records vanished on reload) and
 * a later refactor fed the list store's result wrapper back into React state,
 * which threw on the next render and blanked the whole app.
 *
 * Deliberate boundaries — do not read this as coverage of the recording path:
 *   * the LLM is stubbed. `/api/copilot/ask` is an external service with quota;
 *     the note *transport and persistence* is what is under test here.
 *   * the stored consultation is seeded through the app's own authenticated API.
 *     There is currently NO way to create a stored record from the UI without
 *     live audio (a fresh `sess-*` session is never persisted, and the split
 *     modal only mounts for a stored record), so seeding is the only way to
 *     reach the split flow at all. When that gap is closed, replace the fixture
 *     with the UI path.
 *   * the server runs in dev mode against a throwaway DENTAI_DATA_DIR, so it
 *     writes no clinical data and never touches a real database.
 *
 * Run with:  npm run test:e2e
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const PORT = Number(process.env.E2E_PORT || 4399);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PIN = '7392'; // must satisfy the weak-PIN guard (no runs, repeats or common values)
const STUB_NOTE = '### SUBJECTIVE\n- E2E stub note that must survive a reload.';
const FIXTURE_PATIENT = { firstName: 'E2E', lastName: 'Fixture' };
const NOTE_EDITOR = 'textarea[placeholder^="Clinical note will appear"]';

let server: ChildProcess | undefined;
let browser: Browser | undefined;
let dataDir = '';
let serverLog = '';

/** The dev server takes a few seconds to boot Vite; poll rather than sleep. */
async function waitForServer(url: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `DentAI server did not answer on ${url} within ${timeoutMs}ms.\n--- server log ---\n${serverLog}`
  );
}

async function sessionCount(page: Page): Promise<number> {
  const label = await page.getByRole('button', { name: /^Sessions/ }).innerText();
  const digits = label.replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

async function noteValue(page: Page): Promise<string> {
  return page.locator(NOTE_EDITOR).inputValue();
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentai-e2e-'));
  server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      // Vitest sets NODE_ENV=test, and in that mode the server neither listens
      // nor serves the app — the smoke test needs the real dev surface.
      NODE_ENV: 'development',
      PORT: String(PORT),
      // Pin the JSON file store so the run can never write to a real database.
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
    // Kill the whole tree: on Windows a detached runner can leave the port bound
    // and the next run would fail against a stale build.
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      server.kill('SIGTERM');
    }
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('clinical documentation smoke test', () => {
  it('registers a clinician, saves a note, splits a session, and both survive a reload', async () => {
    const context = await browser!.newContext();
    const page = await context.newPage();

    // Anything uncaught here means the app blanked out mid-flow.
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const acceptedWrites: number[] = [];
    page.on('response', (res) => {
      if (res.request().method() !== 'GET' && /\/api\/consultations/.test(res.url())) {
        acceptedWrites.push(res.status());
      }
    });

    try {
      // ---- 1. Register a clinician on the real sign-in screen ---------------
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: 'Register Profile' }).click();

      // Scope every fill to the register form. The sign-in card is still mounted
      // during its exit animation and its identifier field carries the SAME
      // placeholder as the register name field, so a page-wide placeholder
      // lookup fills the wrong (dying) input and the form submits empty.
      const registerForm = page.locator('form').filter({ hasText: 'Create Practitioner Account' });
      await registerForm.waitFor({ state: 'visible' });
      await registerForm.locator('input[type="text"]').nth(0).fill('Dr. E2E Smoke');
      await registerForm.locator('input[type="text"]').nth(1).fill('General Dentistry');
      await registerForm.locator('input[type="password"]').nth(0).fill(PIN);
      await registerForm.locator('input[type="password"]').nth(1).fill(PIN);

      // Guard the fills themselves: an empty required field makes the browser
      // block submission with no visible error and no request.
      expect(await registerForm.locator('input[type="text"]').nth(0).inputValue()).toBe('Dr. E2E Smoke');
      expect(await registerForm.locator('input[type="password"]').nth(0).inputValue()).toBe(PIN);

      await registerForm.getByRole('button', { name: 'Create Practitioner Account' }).click();

      await page.getByPlaceholder('Patient Name').waitFor({ state: 'visible', timeout: 30_000 });
      expect(await sessionCount(page), 'a new clinician starts with no sessions').toBe(0);

      const token = await page.evaluate(() => localStorage.getItem('dentai_token'));
      expect(token, 'registration must persist a session token').toBeTruthy();

      // ---- 2. Seed one stored, recorded session (see file header) -----------
      const seeded = await page.request.post(`${BASE_URL}/api/consultations`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          id: 'e2e-fixture-session',
          ...FIXTURE_PATIENT,
          dob: '1985-05-15',
          appointmentType: 'examination',
          date: 'E2E',
          time: '09:00 AM',
          status: 'In Review',
          transcript: [
            { sender: 'Dentist', text: 'Tell me about the sensitivity.' },
            { sender: 'Patient', text: 'Cold drinks set off the lower left molar.' },
            { sender: 'Dentist', text: 'Tooth 36 shows a worn distal margin.' },
          ],
          findings: { chiefComplaint: '', history: '', toothFindings: '', findingsGingival: '', diagnosis: '', treatmentPerformed: '', recommendations: '', recallRequirements: '', customSections: {} },
          patientSummary: '',
          templateId: 'standard',
        },
      });
      expect(seeded.status(), 'the seeded session must be accepted').toBe(201);

      await page.reload();
      await page.getByPlaceholder('Patient Name').waitFor({ state: 'visible', timeout: 30_000 });
      expect(await sessionCount(page)).toBe(1);
      expect(await page.getByPlaceholder('Patient Name').inputValue()).toBe('E2E Fixture');

      // ---- 3. Generate a note (LLM boundary stubbed) ------------------------
      await page.route('**/api/copilot/ask', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ result: STUB_NOTE, actionType: 'note' }),
        })
      );
      await page.getByRole('button', { name: /Create note/ }).click();
      await expect.poll(() => noteValue(page), { timeout: 20_000 }).toContain('E2E stub note');

      // The save must have reached the server, not just React state.
      await expect
        .poll(() => acceptedWrites.some((status) => status === 200 || status === 201), { timeout: 20_000 })
        .toBe(true);

      // ---- 4. Reload: the generated note must still be there ----------------
      await page.reload();
      await page.locator(NOTE_EDITOR).waitFor({ state: 'visible', timeout: 30_000 });
      expect(await noteValue(page), 'a generated note must survive a reload').toContain('E2E stub note');

      // ---- 5. Separate the merged session ----------------------------------
      await page.getByRole('button', { name: /^Transcript/ }).click();
      await page.getByRole('button', { name: 'Separate Merged Session' }).click();
      await page.getByRole('button', { name: 'Separate into 2 sessions' }).click();

      // This used to throw (strict-mode error in the list store) and blank the app.
      await page.getByPlaceholder('Patient Name').waitFor({ state: 'visible', timeout: 20_000 });
      await expect.poll(() => sessionCount(page), { timeout: 20_000 }).toBe(2);

      // ---- 6. Reload: both records must survive ----------------------------
      await page.reload();
      await expect.poll(() => sessionCount(page), { timeout: 30_000 }).toBe(2);
      expect(
        acceptedWrites.filter((status) => status === 200 || status === 201).length,
        'the split must have been written to the server'
      ).toBeGreaterThanOrEqual(2);

      expect(pageErrors, 'no uncaught exception may reach the page').toEqual([]);
    } finally {
      await context.close();
    }
  });
});
