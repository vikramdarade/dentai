/**
 * Scene 5 recorder: outro — a calm closing shot of the sign-in screen with
 * the demo CTA in view, held for the outro narration.
 *
 * The outro has no dedicated app screen; the sign-in/profile screen IS the
 * call to action ("Try the live app now"), so this records it with a slow
 * hover over the demo entry point.
 *
 * Prerequisite: `bun run demo:auth` (or any run that produced scenes 1–4).
 */
import { chromium } from 'playwright';
import fs from 'fs';
import { LIVE_URL, OUT_DIR, SCENES } from './config';

const OUTRO = SCENES.find((s) => s.id === '05-outro');
if (!OUTRO) throw new Error('05-outro is missing from SCENES in config.ts');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 800 } }
  });
  const page = await ctx.newPage();
  try {
    await page.goto(LIVE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    // Hold on the demo CTA for the "try the live app" line, then relax onto
    // the profile cards so the outro ends on the product itself.
    const cta = page.getByText('Watch the narrated product demo').first();
    if (await cta.count()) {
      await cta.hover();
      await page.waitForTimeout(6000);
    }
    await page.mouse.move(640, 400, { steps: 8 });
    await page.waitForTimeout(5000);
  } finally {
    await page.waitForTimeout(400);
    const video = page.video();
    await ctx.close();
    if (video) fs.renameSync(await video.path(), `${OUT_DIR}/05-outro.webm`);
  }
  await browser.close();
  console.log(`✓ recorded ${OUT_DIR}/05-outro.webm — next: bun run demo:narrate`);
}

main().catch((err) => {
  console.error('Recorder failed:', err);
  process.exit(1);
});