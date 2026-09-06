/**
 * Scene 3 recorder: the full dentist flow — intake → live recording with a
 * sample consultation transcript → AI note generation → clinical summary.
 * Records the LIVE app via headless Chromium.
 *
 * Prerequisite: `bun run demo:auth` (demo owner exists + is logged in here).
 */
import { chromium } from 'playwright';
import fs from 'fs';
import { LIVE_URL, OUT_DIR, DEMO } from './config';

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 800 } }
  });
  const page = await ctx.newPage();

  await page.goto(LIVE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Select the demo owner profile, then tap the 4-digit PIN on the keypad
  // (the login PIN pad is rendered as buttons, not inputs).
  await page.getByText(DEMO.owner.name, { exact: true }).first().click();
  await page.waitForTimeout(700);
  for (const digit of DEMO.owner.pin) {
    await page.getByRole('button', { name: digit, exact: true }).click();
    await page.waitForTimeout(160);
  }
  await page.waitForSelector('text=New Consultation', { timeout: 30000 });
  await page.waitForTimeout(3000);

  // ---- Intake: step 1 identity ----
  await page.getByText('New Consultation').first().click();
  await page.waitForTimeout(1200);

  const texts = page.locator('input[type="text"]');
  await texts.nth(0).pressSequentially(DEMO.patient.firstName, { delay: 60 });
  await texts.nth(1).pressSequentially(DEMO.patient.lastName, { delay: 60 });
  await texts.nth(2).pressSequentially(DEMO.patient.dobDigits, { delay: 80 });
  await page.waitForTimeout(1500);

  // ---- Intake: step 2 treatment type ----
  await page.locator('form button[type="submit"]').click();
  await page.waitForTimeout(1200);
  await page.locator('select').first().selectOption({ index: 1 });
  await page.waitForTimeout(1500);

  // ---- Intake: step 3 consent ----
  await page.locator('form button[type="submit"]').click();
  await page.waitForTimeout(1200);
  await page.getByText('Verbal Consent Obtained').click();
  await page.waitForTimeout(800);
  await page.locator('form button[type="submit"]').click();
  await page.waitForSelector('text=Ready to Capture Session', { timeout: 20000 });
  await page.waitForTimeout(2500);

  // ---- Recording screen: inject the sample consultation transcript ----
  await page.locator('select').first().selectOption({ index: 0 });
  // Register the dialog handler BEFORE the click (Playwright auto-dismisses
  // dialogs otherwise, which would cancel the transcript replacement).
  page.once('dialog', (d: any) => d.accept());
  await page.getByText('Load Sample Audio Transcript').click();
  await page.waitForTimeout(6000); // transcript items land with per-line timing

  // ---- Finish note: async AI job with graceful offline fallback ----
  await page.getByRole('button', { name: 'Finish Note' }).click();
  // Either the processing overlay resolves or the offline fallback completes;
  // both end on the Clinical Summary screen.
  await page.waitForSelector('text=Clinical Findings', { timeout: 120000 });
  await page.waitForTimeout(2000);

  // Showcase the generated clinical record.
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(3000);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(5000);

  const video = page.video();
  await ctx.close();
  if (video) fs.renameSync(await video.path(), `${OUT_DIR}/03-dentist-flow.webm`);
  await browser.close();
  console.log(`✓ recorded ${OUT_DIR}/03-dentist-flow.webm — next: bun run demo:owner`);
}

main().catch((err) => {
  console.error('Recorder failed:', err);
  process.exit(1);
});
