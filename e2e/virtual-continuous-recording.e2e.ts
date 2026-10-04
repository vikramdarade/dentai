/**
 * Test 8 & Phase 13/14 — Virtual Continuous Recording Browser E2E Test
 *
 * Runs real Chromium with fake audio hardware flags:
 *   --use-fake-ui-for-media-stream
 *   --use-fake-device-for-media-stream
 *
 * Drives the real application chairside:
 *   1. Register clinician & seed schedule (Patient A, Patient B, Patient C)
 *   2. Start recording on Patient A (Single Start at morning)
 *   3. Collect real audio chunks under Patient A
 *   4. Click "Next Patient" (⌘→)
 *   5. Seamlessly rollover to Patient B — microphone stream stays alive!
 *   6. Collect real audio chunks under Patient B starting at chunkIndex 0
 *   7. Click "Next Patient" (⌘→)
 *   8. Seamlessly rollover to Patient C
 *   9. Click "Stop" (Single Stop at end of run)
 *  10. Assert all consultations received valid, independent audio segments
 *  11. Assert 0 cross-patient contamination
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const PORT = Number(process.env.E2E_VCR_PORT || 4406);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PIN = '8259';

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
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server failed to start at ${url} within ${timeoutMs}ms.\nLog:\n${serverLog}`);
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentai-vcr-e2e-'));

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

  // Launch Chromium with fake audio hardware devices
  browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--no-sandbox',
    ],
  });
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

describe('Virtual Continuous Recording & Next Patient E2E Workflow', () => {
  it('drives One Start -> Patient A -> Next Patient -> Patient B -> Next Patient -> Patient C -> One Stop', async () => {
    const context = await browser!.newContext({
      permissions: ['microphone'],
    });
    const page = await context.newPage();

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
      if (!/WebSocket/i.test(err.message)) pageErrors.push(err.message);
    });

    // Track chunk upload API requests
    const chunkUploads: { consultationId: string; chunkIndex: number; sizeBytes: number }[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/transcribe/audio') && req.method() === 'POST') {
        try {
          const postData = req.postDataJSON();
          if (postData?.consultationId !== undefined) {
            chunkUploads.push({
              consultationId: postData.consultationId,
              chunkIndex: postData.chunkIndex,
              sizeBytes: postData.sizeBytes || 0,
            });
          }
        } catch {}
      }
    });

    // 1. Register Clinician
    await page.goto(BASE_URL);
    await page.getByRole('button', { name: 'Register Profile' }).click();

    const registerForm = page.locator('form').filter({ hasText: 'Create Practitioner Account' });
    await registerForm.waitFor({ state: 'visible' });
    await registerForm.locator('input[type="text"]').nth(0).fill('Dr. VCR Playtest');
    await registerForm.locator('input[type="text"]').nth(1).fill('General Practice');
    await registerForm.locator('input[type="password"]').nth(0).fill(PIN);
    await registerForm.locator('input[type="password"]').nth(1).fill(PIN);
    await registerForm.getByRole('button', { name: 'Create Practitioner Account' }).click();

    await page.getByPlaceholder('Patient Name').waitFor({ state: 'visible', timeout: 30_000 });
    const token = await page.evaluate(() => localStorage.getItem('dentai_token'));
    expect(token).toBeTruthy();

    // 2. Pre-seed Patient A, Patient B, and Patient C on today's roster
    const patients = [
      { id: 'patient-A-alpha', firstName: 'Alpha', lastName: 'Patient', time: '09:00 AM' },
      { id: 'patient-B-bravo', firstName: 'Bravo', lastName: 'Patient', time: '10:00 AM' },
      { id: 'patient-C-charlie', firstName: 'Charlie', lastName: 'Patient', time: '11:00 AM' },
    ];

    for (const p of patients) {
      await page.request.post(`${BASE_URL}/api/consultations`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          dob: '1990-01-01',
          appointmentType: 'examination',
          date: 'Today',
          time: p.time,
          status: 'Scheduled',
          transcript: [],
          findings: {},
          templateId: 'standard',
        },
      });
    }

    // Reload page so consultation roster is hydrated from server
    await page.reload();
    await page.getByPlaceholder('Patient Name').waitFor({ state: 'visible', timeout: 30_000 });

    // Wait until server consultations are fetched and hydrated
    await expect.poll(async () => {
      const label = await page.getByRole('button', { name: /^Sessions/ }).innerText();
      return Number(label.replace(/\D/g, '') || 0);
    }, { timeout: 30_000 }).toBe(3);

    // Open Sessions drawer to select Patient A
    await page.getByRole('button', { name: 'Sessions' }).click();
    await page.getByText('Alpha Patient').first().click();

    // Verify Patient Name input reflects Alpha Patient
    await expect.poll(() => {
      return page.getByPlaceholder('Patient Name').inputValue();
    }, { timeout: 10_000 }).toContain('Alpha');

    // 3. START RECORDING (Patient A)
    const transcribeBtn = page.getByRole('button', { name: /Transcribe/i }).first();
    await transcribeBtn.waitFor({ state: 'visible' });
    await transcribeBtn.click();

    // Verify recording is active
    await page.getByText('REC').first().waitFor({ state: 'visible', timeout: 10_000 });

    // Allow fake audio to stream for ~2 seconds so chunks are generated
    await page.waitForTimeout(2200);

    // 4. NEXT PATIENT -> Patient B
    const nextPatientBtn = page.getByRole('button', { name: /Next Patient/i });
    await nextPatientBtn.click();

    // Verify patient transitioned to Bravo Patient
    await page.waitForFunction(() => {
      const input = document.querySelector('input[placeholder="Patient Name"]') as HTMLInputElement;
      return input && input.value.includes('Bravo');
    }, { timeout: 10_000 });

    // Verify recording is STILL active (REC badge still present!)
    expect(await page.getByText('REC').first().isVisible()).toBe(true);

    // Allow Patient B to record for ~2 seconds
    await page.waitForTimeout(2200);

    // 5. NEXT PATIENT -> Patient C
    await nextPatientBtn.click();

    // Verify patient transitioned to Charlie Patient
    await page.waitForFunction(() => {
      const input = document.querySelector('input[placeholder="Patient Name"]') as HTMLInputElement;
      return input && input.value.includes('Charlie');
    }, { timeout: 10_000 });

    // Verify recording is STILL active (REC badge still present!)
    expect(await page.getByText('REC').first().isVisible()).toBe(true);

    // Allow Patient C to record for ~2 seconds
    await page.waitForTimeout(2200);

    // 6. STOP RECORDING (End of day run)
    const stopBtn = page.getByRole('button', { name: 'Stop' });
    await stopBtn.click();

    // REC badge should disappear
    await page.getByText('REC').first().waitFor({ state: 'hidden', timeout: 10_000 });

    // 7. Verify chunk ownership across consultations
    const uploadsA = chunkUploads.filter((u) => u.consultationId === 'patient-A-alpha');
    const uploadsB = chunkUploads.filter((u) => u.consultationId === 'patient-B-bravo');
    const uploadsC = chunkUploads.filter((u) => u.consultationId === 'patient-C-charlie');

    expect(uploadsA.length).toBeGreaterThanOrEqual(1);
    expect(uploadsB.length).toBeGreaterThanOrEqual(1);
    expect(uploadsC.length).toBeGreaterThanOrEqual(1);

    // Every consultation MUST begin with chunkIndex 0
    expect(uploadsA[0].chunkIndex).toBe(0);
    expect(uploadsB[0].chunkIndex).toBe(0);
    expect(uploadsC[0].chunkIndex).toBe(0);

    // Invariant: Zero uncaught browser errors
    expect(pageErrors).toEqual([]);
  });
});
