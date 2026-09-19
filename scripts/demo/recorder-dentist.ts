/**
 * Scene 3 recorder: the full dentist flow — chairside operatory, ambient HUD,
 * contextual day guide & hotkeys, live audio squelch capture, 1-click PMS paste,
 * batch tray, and history hub.
 * Records the LIVE app via headless Chromium.
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

  // 1. Sign in with Dr. Aisha Verma + PIN
  const nameInput = page.locator('input[placeholder*="Dr. Sarah Jenkins"]');
  if (await nameInput.count()) {
    await nameInput.fill(DEMO.owner.name);
    await page.waitForTimeout(600);
  } else {
    const profile = page.getByText(DEMO.owner.name, { exact: true }).first();
    if (await profile.count()) {
      await profile.click();
      await page.waitForTimeout(600);
    }
  }

  for (const digit of DEMO.owner.pin) {
    await page.getByRole('button', { name: digit, exact: true }).click();
    await page.waitForTimeout(160);
  }

  const submitBtn = page.getByRole('button', { name: /Sign In to Practice/i });
  if (await submitBtn.count() && await submitBtn.isEnabled()) {
    await submitBtn.click();
  }

  // 2. Land in Chairside Operatory Workspace
  await page.waitForSelector('text=Attending Clinician', { timeout: 30000 });
  await page.waitForTimeout(2500);

  // 3. Showcase Contextual Operatory Day Guide & Support (?)
  const guideBtn = page.getByRole('button', { name: /Guide & Support/i }).first();
  if (await guideBtn.count()) {
    await guideBtn.click();
    await page.waitForTimeout(3000); // 4-Phase Day Flow

    // Hotkeys tab
    const hotkeysTab = page.getByRole('button', { name: /Operatory Hotkeys/i }).first();
    if (await hotkeysTab.count()) {
      await hotkeysTab.click();
      await page.waitForTimeout(3000);
    }

    // Direct GitHub Issue Dispatcher tab
    const ghTab = page.getByRole('button', { name: /Request Feature \(GitHub\)/i }).first();
    if (await ghTab.count()) {
      await ghTab.click();
      await page.waitForTimeout(3000);
    }

    // Close guide
    const closeBtn = page.locator('div.fixed button:has(svg.lucide-x)').first();
    if (await closeBtn.count()) {
      await closeBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(1500);
  }

  // 4. Select active patient encounter (Maya Sharma) on left roster
  const patientRow = page.getByText(/Maya Sharma|Sharma, Maya|Patient Encounter/i).first();
  if (await patientRow.count()) {
    await patientRow.click();
    await page.waitForTimeout(1500);
  }

  // 5. Demonstrate Ambient Operatory HUD & Live Recording Island
  const audioToggle = page.locator('button[title*="Start Recording"], button[title*="Toggle Recording"]').first();
  if (await audioToggle.count()) {
    await audioToggle.click();
    await page.waitForTimeout(4000); // Intra-Op Active HUD & waveform pulse

    // Stop audio
    await audioToggle.click();
    await page.waitForTimeout(2000);
  } else {
    // Alternatively spacebar audio trigger
    await page.keyboard.press('Space');
    await page.waitForTimeout(3000);
    await page.keyboard.press('Space');
    await page.waitForTimeout(1500);
  }

  // 6. Demonstrate 1-Click Formatted Note Copy for PMS (⌘C)
  const copyBtn = page.getByRole('button', { name: /Copy Note/i }).first();
  if (await copyBtn.count()) {
    await copyBtn.click();
    await page.waitForTimeout(2500);
  }

  // 7. Demonstrate Batch Tray (⌘B) for 20-patient operatory day reconciliation
  const batchBtn = page.getByRole('button', { name: /Batch Tray/i }).first();
  if (await batchBtn.count()) {
    await batchBtn.click();
    await page.waitForTimeout(3500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
  }

  // 8. Open History Hub via left navigation rail
  const historyNav = page.locator('button[title="Today\'s Notes"]').first();
  if (await historyNav.count()) {
    await historyNav.click();
    await page.waitForTimeout(4000);
    // Showcase history hub
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(3000);
  }

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
