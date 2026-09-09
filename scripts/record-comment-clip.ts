import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

async function main() {
  const assetsDir = path.resolve(process.cwd(), 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  console.log('Launching browser to record comment clip...');
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: assetsDir,
      size: { width: 1280, height: 720 }
    }
  });

  const page = await context.newPage();
  console.log('Navigating to http://localhost:3000/#/demo ...');
  await page.goto('http://localhost:3000/#/demo', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // The demo player starts automatically or has a play toggle
  // Let's ensure it's playing or click play if needed
  const playButton = page.locator('button:has-text("Play"), button[aria-label*="play" i], button:has(svg.lucide-play)').first();
  if (await playButton.isVisible().catch(() => false)) {
    console.log('Clicking play button...');
    await playButton.click();
  }

  // Let it record for 24 seconds through the live intake and consultation sequence
  console.log('Recording 24-second clip of chairside flow...');
  await page.waitForTimeout(24000);

  console.log('Closing browser to finalize recording...');
  await context.close();
  await browser.close();

  // Find the newly created video in assets
  const files = fs.readdirSync(assetsDir);
  const webmFile = files
    .filter(f => f.endsWith('.webm'))
    .map(f => ({ name: f, time: fs.statSync(path.join(assetsDir, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time)[0];

  if (!webmFile) {
    throw new Error('No recorded webm video file found in assets directory');
  }

  const inputWebm = path.join(assetsDir, webmFile.name);
  const outputMp4 = path.join(assetsDir, 'dentai-comment-demo.mp4');
  const outputGif = path.join(assetsDir, 'dentai-comment-demo.gif');

  console.log(`Converting ${webmFile.name} to MP4 and GIF using ffmpeg...`);
  const ffmpegPath = path.resolve(process.cwd(), 'node_modules/ffmpeg-static/ffmpeg.exe');

  // Transcode to MP4 (H.264 / AAC, web-optimized)
  execSync(
    `"${ffmpegPath}" -y -i "${inputWebm}" -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p "${outputMp4}"`,
    { stdio: 'inherit' }
  );
  console.log(`Saved MP4: ${outputMp4}`);

  // Create lightweight optimized GIF for LinkedIn comment (width 640px, 12fps, palettegen)
  const palette = path.join(assetsDir, 'palette.png');
  execSync(
    `"${ffmpegPath}" -y -i "${inputWebm}" -vf "fps=12,scale=640:-1:flags=lanczos,palettegen" "${palette}"`,
    { stdio: 'inherit' }
  );
  execSync(
    `"${ffmpegPath}" -y -i "${inputWebm}" -i "${palette}" -filter_complex "fps=12,scale=640:-1:flags=lanczos[x];[x][1:v]paletteuse" "${outputGif}"`,
    { stdio: 'inherit' }
  );
  if (fs.existsSync(palette)) fs.unlinkSync(palette);
  console.log(`Saved GIF: ${outputGif}`);

  console.log('Demo clip successfully generated!');
}

main().catch(err => {
  console.error('Error generating clip:', err);
  process.exit(1);
});
