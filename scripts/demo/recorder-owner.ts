/**
 * Scene 4 recorder: owner/team flow — clinic switcher, invite code, a
 * colleague requesting to join from their own session, owner approval.
 * Records the LIVE app via headless Chromium (two browser contexts).
 *
 * Prerequisite: `bun run demo:auth` (owner exists; the member is registered
 * here through its own browser context).
 */
import { chromium } from 'playwright';
import fs from 'fs';
import { LIVE_URL, OUT_DIR, DEMO } from './config';

const MEMBER = DEMO.member;

/** Open the clinic switcher dropdown and return the invite code row text. */
async function openSwitcher(page: any): Promise<void> {
  const manageItem = page.getByText('Manage clinic · invite code');
  if (await manageItem.count() && await manageItem.first().isVisible()) {
    return;
  }
  await page.locator('button[title="Switch clinic"]').click();
  await page.waitForTimeout(900);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();

  // ---- Owner context (recorded) ----
  const ownerCtx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 800 } }
  });
  const owner = await ownerCtx.newPage();

  // ---- Member context (not recorded; used to fire the join request) ----
  const memberCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const member = await memberCtx.newPage();

  // 1. Owner signs in.
  await owner.goto(LIVE_URL, { waitUntil: 'networkidle' });
  await owner.waitForTimeout(2000);

  const nameInput = owner.locator('input[placeholder*="Dr. Sarah Jenkins"]');
  if (await nameInput.count()) {
    await nameInput.fill(DEMO.owner.name);
    await owner.waitForTimeout(600);
  }

  for (const digit of DEMO.owner.pin) {
    await owner.getByRole('button', { name: digit, exact: true }).click();
    await owner.waitForTimeout(160);
  }

  const submitBtn = owner.getByRole('button', { name: /Sign In to Practice/i });
  if (await submitBtn.count() && await submitBtn.isEnabled()) {
    await submitBtn.click();
  }

  // Lands in Chairside Operatory
  await owner.waitForSelector('text=Attending Clinician', { timeout: 30000 });
  await owner.waitForTimeout(2500);

  // Switch to HistoryHub to access clinic management & switcher
  await owner.locator('button[title="Today\'s Notes"]').click();
  await owner.waitForSelector('button[title="Switch clinic"]', { timeout: 30000 });
  await owner.waitForTimeout(1500);

  // Open the switcher, capture the invite code.
  await openSwitcher(owner);
  await owner.getByText('Manage clinic · invite code').click();
  await owner.waitForTimeout(1200);

  // The invite code is the mono, extrabold 6-char code inside the
  // "Invite colleagues with this code" card (safe alphabet, no dashes).
  const codeText = await owner
    .locator('section', { hasText: 'Invite colleagues with this code' })
    .locator('span.font-mono')
    .first()
    .textContent()
    .catch(() => null);
  const inviteCode = (codeText || '').trim();
  if (!inviteCode) throw new Error('Could not read the invite code from the Manage modal.');

  // Close the manage modal to frame the switcher again.
  const closeBtn = owner.locator('div.fixed button:has(svg.lucide-x)').first();
  if (await closeBtn.count()) {
    await closeBtn.click();
  } else {
    await owner.keyboard.press('Escape');
  }
  await owner.waitForTimeout(1000);
  await openSwitcher(owner);
  await owner.waitForTimeout(2000);

  // ---- Colleague registers with the invite code directly (unrecorded context) ----
  await member.goto(LIVE_URL, { waitUntil: 'networkidle' });
  await member.waitForTimeout(2000);
  await member.getByText(/Register Profile|Register First Dentist|Add Dentist Profile|Add Profile/i).first().click();
  await member.waitForTimeout(800);

  const texts = member.locator('form input[type="text"]');
  await texts.nth(0).fill(MEMBER.name);
  await texts.nth(1).fill(MEMBER.specialty);
  await texts.nth(2).fill(inviteCode);

  const pins = member.locator('form input[type="password"]');
  await pins.nth(0).fill(MEMBER.pin);
  await pins.nth(1).fill(MEMBER.pin);

  await member.locator('form button[type="submit"]').click();
  await member.waitForTimeout(2500);

  // ---- Owner sees the pending request and approves it (recorded) ----
  await openSwitcher(owner);
  await owner.getByText('Manage clinic · invite code').click();
  await owner.waitForTimeout(2000);
  const approveBtn = owner.getByText('Approve', { exact: false }).first();
  if (await approveBtn.count()) {
    await approveBtn.click();
    await owner.waitForTimeout(2500);
  }
  const closeBtn2 = owner.locator('div.fixed button:has(svg.lucide-x)').first();
  if (await closeBtn2.count()) {
    await closeBtn2.click();
  } else {
    await owner.keyboard.press('Escape');
  }
  await owner.waitForTimeout(1200);

  const video = owner.video();
  await ownerCtx.close();
  if (video) fs.renameSync(await video.path(), `${OUT_DIR}/04-owner-flow.webm`);
  await memberCtx.close();
  await browser.close();
  console.log(`✓ recorded ${OUT_DIR}/04-owner-flow.webm — next: bun run demo:outro`);
}

main().catch((err) => {
  console.error('Recorder failed:', err);
  process.exit(1);
});
