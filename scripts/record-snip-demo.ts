import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

async function main() {
  const assetsDir = path.resolve(process.cwd(), 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const sampleImagePath = path.resolve(process.cwd(), 'public/samples/praktika-schedule-sample.jpg');
  if (!fs.existsSync(sampleImagePath)) {
    throw new Error(`Sample image not found at: ${sampleImagePath}`);
  }

  // 1. Get or create auth token via direct API call to local server
  console.log('Registering/authenticating demo dentist profile...');
  let authToken = '';
  let dentistId = '';
  try {
    const regRes = await fetch('http://localhost:3000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Dr. Vikram Darade', specialty: 'General & Implant Dentistry', pin: '1234' })
    });
    if (regRes.ok) {
      const data = await regRes.json();
      authToken = data.token;
      dentistId = data.dentist?.id || '';
    } else {
      const profilesRes = await fetch('http://localhost:3000/api/auth/profiles');
      const profiles = await profilesRes.json();
      const match = profiles.find((p: any) => p.name === 'Dr. Vikram Darade') || profiles[0];
      if (match) {
        dentistId = match.id;
        const loginRes = await fetch('http://localhost:3000/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dentistId: match.id, pin: '1234' })
        });
        if (loginRes.ok) {
          const data = await loginRes.json();
          authToken = data.token;
        }
      }
    }
  } catch (err) {
    console.warn('Direct auth API call warning:', err);
  }

  console.log('Launching browser to record snip & paste demo clip...');
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: assetsDir,
      size: { width: 1280, height: 720 }
    }
  });

  const page = await context.newPage();

  // Inject session authentication so the app opens directly into the Operatory Cockpit
  if (authToken) {
    await page.addInitScript(({ token, dId }) => {
      const user = { id: dId, name: 'Dr. Vikram Darade', specialty: 'General & Implant Dentistry' };
      localStorage.setItem('dentai_token', token);
      localStorage.setItem('dentai_user', JSON.stringify(user));
      sessionStorage.setItem('dentai_token', token);
      sessionStorage.setItem('dentai_user', JSON.stringify(user));
      // Clear today's schedule so demo starts with clean pristine dropzone
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      localStorage.removeItem(`dentai_day_schedule_${todayStr}`);
    }, { token: authToken, dId: dentistId });
  }

  console.log('Navigating to DentAI Operatory Cockpit...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // If still on login screen, select profile
  const profileButton = page.getByText('Dr. Vikram Darade', { exact: false }).first();
  if (await profileButton.isVisible().catch(() => false)) {
    await profileButton.click();
    await page.waitForTimeout(500);
    for (const d of '1234') {
      const digitBtn = page.getByRole('button', { name: d, exact: true });
      if (await digitBtn.isVisible().catch(() => false)) await digitBtn.click();
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(1500);
  }

  // Ensure schedule is clean
  const clearBtn = page.locator('button[title="Clear roster"]');
  if (await clearBtn.isVisible().catch(() => false)) {
    await clearBtn.click();
    await page.waitForTimeout(500);
    const confirmBtn = page.getByRole('button', { name: /Clear Roster/i });
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click();
      await page.waitForTimeout(1000);
    }
  }

  console.log('Scene 1: Showing empty morning dropzone...');
  await page.waitForTimeout(2500);

  // Smooth mouse movement to the dropzone
  const dropzone = page.locator('div:has-text("Press Ctrl + V to paste snip")').last();
  if (await dropzone.isVisible().catch(() => false)) {
    const box = await dropzone.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
      await page.waitForTimeout(1000);
    }
  }

  console.log('Scene 2: Uploading Praktika daily schedule screenshot snip...');
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(sampleImagePath);

  // Watch the instant thumbnail preview and analyzing spinner
  console.log('Scene 3: AI vision parsing and thumbnail preview active...');
  await page.waitForTimeout(4000);

  console.log('Scene 4: Appointments loaded! Inspecting populated roster...');
  await page.waitForTimeout(3000);

  // Scroll through the roster cards
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(1500);
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(1000);

  // Hover over an appointment card
  const secondCard = page.locator('div:has-text("David Miller")').last();
  if (await secondCard.isVisible().catch(() => false)) {
    const cardBox = await secondCard.boundingBox();
    if (cardBox) {
      await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2, { steps: 15 });
      await page.waitForTimeout(1200);
    }
  }

  console.log('Scene 5: Demonstrating 1-click Express Copy...');
  const copyBtn = page.getByRole('button', { name: /Express Copy/i });
  if (await copyBtn.isVisible().catch(() => false)) {
    await copyBtn.click();
    await page.waitForTimeout(2000);
  }

  console.log('Finalizing recording...');
  await page.waitForTimeout(2500);

  await context.close();
  await browser.close();

  // Find the newly created video file
  const files = fs.readdirSync(assetsDir);
  const webmFile = files
    .filter(f => f.endsWith('.webm'))
    .map(f => ({ name: f, time: fs.statSync(path.join(assetsDir, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time)[0];

  if (!webmFile) {
    throw new Error('No recorded webm video found in assets directory');
  }

  const inputWebm = path.join(assetsDir, webmFile.name);
  const outputMp4 = path.join(assetsDir, 'dentai-snip-paste-demo.mp4');
  const outputGif = path.join(assetsDir, 'dentai-snip-paste-demo.gif');

  console.log(`Transcoding ${webmFile.name} to MP4 and GIF using ffmpeg...`);
  const ffmpegPath = path.resolve(process.cwd(), 'node_modules/ffmpeg-static/ffmpeg.exe');

  // MP4 transcode: high quality H.264, web-optimized for LinkedIn video upload
  execSync(
    `"${ffmpegPath}" -y -i "${inputWebm}" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p -movflags +faststart "${outputMp4}"`,
    { stdio: 'inherit' }
  );
  console.log(`Saved MP4: ${outputMp4}`);

  // GIF transcode: crisp 800px width with palettegen for rich colors
  const palette = path.join(assetsDir, 'palette-snip.png');
  execSync(
    `"${ffmpegPath}" -y -i "${inputWebm}" -vf "fps=14,scale=800:-1:flags=lanczos,palettegen" "${palette}"`,
    { stdio: 'inherit' }
  );
  execSync(
    `"${ffmpegPath}" -y -i "${inputWebm}" -i "${palette}" -filter_complex "fps=14,scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse" "${outputGif}"`,
    { stdio: 'inherit' }
  );
  if (fs.existsSync(palette)) fs.unlinkSync(palette);
  console.log(`Saved GIF: ${outputGif}`);

  console.log('\n SUCCESS: Snip and Paste Demo clip generated successfully!');
  console.log(`- MP4 Video (upload to LinkedIn): ${outputMp4}`);
  console.log(`- Animated GIF: ${outputGif}`);
}

main().catch(err => {
  console.error('Error generating snip demo:', err);
  process.exit(1);
});
