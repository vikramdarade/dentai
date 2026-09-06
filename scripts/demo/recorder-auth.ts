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

  // ---- Scene 1: pristine sign-in screen (empty profiles state) ----
  await recordScene(browser, `${OUT_DIR}/01-sign-in.webm`, async (page) => {
    await page.goto(LIVE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    // Gentle highlight of the onboarding entry point.
    const register = page.getByText(/Register First Dentist|Add Dentist Profile/i).first();
    if (await register.count()) {
      await register.hover();
      await page.waitForTimeout(2500);
    }
    // Let the ambient background orbs breathe for the narration.
    await page.waitForTimeout(7000);
  });

  // ---- Scene 2: onboarding a new dentist (owner account is born here) ----
  await recordScene(browser, `${OUT_DIR}/02-onboarding.webm`, async (page) => {
    await page.goto(LIVE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page
      .getByText(/Register First Dentist|Add Dentist Profile|Add Profile/i)
      .first()
      .click();
    await page.waitForTimeout(800);

    // Registration form: Full Name, Specialty, (invite code), PIN, Confirm PIN.
    const textInputs = page.locator('form input[type="text"]');
    await textInputs.nth(0).pressSequentially(OWNER.name, { delay: 70 });
    await page.waitForTimeout(600);
    await textInputs.nth(1).pressSequentially(OWNER.specialty, { delay: 70 });
    await page.waitForTimeout(600);

    const pins = page.locator('form input[inputmode="numeric"]');
    await pins.nth(0).pressSequentially(OWNER.pin, { delay: 120 });
    await page.waitForTimeout(500);
    await pins.nth(1).pressSequentially(OWNER.pin, { delay: 120 });
    await page.waitForTimeout(800);

    await pins.nth(1).press('Enter');

    // Land in the History Hub.
    await page.waitForSelector('text=New Consultation', { timeout: 30000 });
    await page.waitForTimeout(4000);
  });

  await browser.close();
  console.log('Scenes 1–2 recorded. Next: bun run demo:dentist');
}

main().catch((err) => {
  console.error('Recorder failed:', err);
  process.exit(1);
});
