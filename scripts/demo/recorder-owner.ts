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

  // Owner signs in.
  await owner.goto(LIVE_URL, { waitUntil: 'networkidle' });
  await owner.waitForTimeout(2000);
  await owner.locator('input[inputmode="numeric"]').first().pressSequentially(DEMO.owner.pin, { delay: 150 });
  await owner.waitForSelector('text=New Consultation', { timeout: 30000 });
  await owner.waitForTimeout(2500);

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
  await owner.keyboard.press('Escape');
  await owner.waitForTimeout(600);
  await openSwitcher(owner);
  await owner.waitForTimeout(2000);

  // ---- Colleague requests to join (unrecorded context) ----
  await member.goto(LIVE_URL, { waitUntil: 'networkidle' });
  await member.waitForTimeout(2000);
  await member.getByText(/Register First Dentist|Add Dentist Profile|Add Profile/i).first().click();
  await member.waitForTimeout(800);
  const texts = member.locator('form input[type="text"]');
  await texts.nth(0).pressSequentially(MEMBER.name, { delay: 60 });
  await texts.nth(1).pressSequentially(MEMBER.specialty, { delay: 60 });
  const pins = member.locator('form input[inputmode="numeric"]');
  await pins.nth(0).pressSequentially(MEMBER.pin, { delay: 100 });
  await pins.nth(1).pressSequentially(MEMBER.pin, { delay: 100 });
  await pins.nth(1).press('Enter');
  await member.waitForSelector('text=New Consultation', { timeout: 30000 });
  await member.locator('button[title="Switch clinic"]').click();
  await member.waitForTimeout(700);
  await member.getByText(/Join|Have an invite/i).first().click();
  await member.waitForTimeout(600);
  await member.locator('form input').first().pressSequentially(inviteCode, { delay: 60 });
  await member.locator('form button[type="submit"]').click();
  await member.waitForTimeout(2500);

  // ---- Owner sees the pending request and approves it (recorded) ----
  await openSwitcher(owner);
  await owner.getByText('Manage clinic · invite code').click();
  await owner.waitForTimeout(1500);
  await owner.getByText('Approve', { exact: false }).first().click();
  await owner.waitForTimeout(2500);
  await owner.keyboard.press('Escape');
  await owner.waitForTimeout(1200);

  const video = owner.video();
  await ownerCtx.close();
  if (video) fs.renameSync(await video.path(), `${OUT_DIR}/04-owner-flow.webm`);
  await memberCtx.close();
  await browser.close();
  console.log(`✓ recorded ${OUT_DIR}/04-owner-flow.webm — next: bun run demo:assemble`);
}

main().catch((err) => {
  console.error('Recorder failed:', err);
  process.exit(1);
});
