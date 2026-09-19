/**
 * Scenes 1–2 recorder: sign-in screen + new-dentist onboarding.
 * Records the LIVE app via headless Chromium.
 *
 * Matches the real Login.tsx UI: profile list, "Add Dentist Profile"
 * registration form, 4-digit PIN entry, History Hub landing.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import { LIVE_URL, OUT_DIR, DEMO } from './config';

const OWNER = DEMO.owner;

async function recordScene(
  browser: any,
  file: string,
  action: (page: any) => Promise<void>
): Promise<void> {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 800 } }
  });
  const page = await ctx.newPage();
  try {
    await action(page);
  } finally {
    await page.waitForTimeout(400);
    const video = page.video();
    await ctx.close();
    if (video) fs.renameSync(await video.path(), file);
  }
  console.log(`✓ recorded ${file}`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();

  // ---- Scene 1: pristine sign-in screen (empty profiles state) + Clinician Guide ----
  await recordScene(browser, `${OUT_DIR}/01-sign-in.webm`, async (page) => {
    await page.goto(LIVE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Open Clinician Guide & Support modal to showcase PIN reset & GitHub issue dispatcher
    const guideBtn = page.getByRole('button', { name: /Clinician Guide & Support/i }).first();
    if (await guideBtn.count()) {
      await guideBtn.click();
      await page.waitForTimeout(2500);
      // Click PIN Reset tab
      const pinResetTab = page.getByRole('button', { name: /PIN Reset/i }).first();
      if (await pinResetTab.count()) {
        await pinResetTab.click();
        await page.waitForTimeout(2000);
      }
      // Click GitHub Support tab
      const ghTab = page.getByRole('button', { name: /Direct GitHub Request/i }).first();
      if (await ghTab.count()) {
        await ghTab.click();
        await page.waitForTimeout(2500);
      }
      // Close modal
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1200);
    }

    // Gentle highlight of the onboarding entry point.
    const register = page.getByText(/Register First Dentist|Add Dentist Profile/i).first();
    if (await register.count()) {
      await register.hover();
      await page.waitForTimeout(2000);
    }
    await page.waitForTimeout(3000);
  });

  // ---- Scene 2: onboarding a new dentist (owner account is born here) ----
  await recordScene(browser, `${OUT_DIR}/02-onboarding.webm`, async (page) => {
    await page.goto(LIVE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page
      .getByText(/Register Profile|Register First Dentist|Add Dentist Profile|Add Profile/i)
      .first()
      .click();
    await page.waitForTimeout(800);

    // Registration form: Full Name, Specialty, (invite code), PIN, Confirm PIN.
    const textInputs = page.locator('form input[type="text"]');
    await textInputs.nth(0).fill(OWNER.name);
    await page.waitForTimeout(600);
    await textInputs.nth(1).fill(OWNER.specialty);
    await page.waitForTimeout(600);

    const pins = page.locator('form input[type="password"]');
    await pins.nth(0).fill(OWNER.pin);
    await page.waitForTimeout(500);
    await pins.nth(1).fill(OWNER.pin);
    await page.waitForTimeout(800);

    await page.locator('form button[type="submit"]').click();
    await page.waitForTimeout(1000);

    // If an error message appears, print it
    const errEl = page.locator('.text-red-700, .text-red-600').first();
    if (await errEl.count() && await errEl.isVisible()) {
      console.log('Registration error visible:', await errEl.textContent());
    }

    // Land in the Operatory Workspace.
    await page.waitForSelector('text=Attending Clinician', { timeout: 30000 });
    await page.waitForTimeout(4000);
  });

  await browser.close();
  console.log('Scenes 1–2 recorded. Next: bun run demo:dentist');
}

main().catch((err) => {
  console.error('Recorder failed:', err);
  process.exit(1);
});
