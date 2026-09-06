/**
 * Assembler: transcode each recorded scene, scale to 1920×1080, mux in its
 * narration WAV, normalise all audio to the same format, concat, and write
 * the final MP4.
 *
 * Uses a locally-installed static ffmpeg binary (ffmpeg-static npm package),
 * so no system ffmpeg is required.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import { SCENES, OUT_DIR, FINAL_VIDEO, VIDEO } from './config';

function run(args: string[]): void {
  execFileSync(ffmpegPath as string, args, { stdio: ['ignore', 'ignore', 'pipe'] });
}

function safeDuration(wav: string): number {
  // Read the WAV data-chunk size to compute duration in seconds.
  const buf = fs.readFileSync(wav);
  return (buf.length - 44) / (24000 * 2);
}

async function main() {
  const parts: string[] = [];

  for (const scene of SCENES) {
    const webm = path.join(OUT_DIR, `${scene.id}.webm`);
    const wav = path.join(OUT_DIR, `${scene.id}.wav`);
    const mp4 = path.join(OUT_DIR, `${scene.id}.mp4`);
    if (!fs.existsSync(webm)) throw new Error(`Missing scene recording: ${webm} — run the recorders first.`);
    if (!fs.existsSync(wav)) throw new Error(`Missing narration: ${wav} — run bun run demo:narrate first.`);

    const narrationSecs = safeDuration(wav);
    // Ensure the scene is never shorter than the narration or its floor duration.
    const minSecs = Math.max(scene.minDuration, narrationSecs + 0.8);

    // Two-pass: normalise video+audio to a uniform format and pad the tail so
    // every part is concat-compatible (same codecs, resolution, sample rate).
    run([
      '-y',
      '-i', webm,
      '-i', wav,
      '-f', 'lavfi',
      '-i', `anullsrc=channel_layout=mono:sample_rate=44100`,
      '-filter_complex',
      [
        `[0:v]scale=${VIDEO.width}:${VIDEO.height}:force_original_aspect_ratio=decrease,` +
          `pad=${VIDEO.width}:${VIDEO.height}:(ow-iw)/2:(oh-ih)/2,` +
          `fps=${VIDEO.fps},setsar=1[v]`,
        `[2:a]atrim=0:${minSecs}[pad]`,
        `[1:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono[narr]`,
        `[narr][pad]amix=inputs=2:duration=longest:dropout_transition=0[a]`
      ].join(';'),
      '-map', '[v]',
      '-map', '[a]',
      '-t', String(minSecs),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '21',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-ac', '1',
      mp4
    ]);
    parts.push(mp4);
    console.log(`✓ transcoded ${scene.id} (${minSecs.toFixed(1)}s)`);
  }

  // Concat demuxer over re-encoded, uniform parts.
  const listFile = path.join(OUT_DIR, 'parts.txt');
  fs.writeFileSync(listFile, parts.map((p) => `file '${path.resolve(p)}'`).join('\n'));
  run(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', FINAL_VIDEO]);
  fs.rmSync(listFile);

  const mb = (fs.statSync(FINAL_VIDEO).size / 1024 / 1024).toFixed(1);
  console.log(`✓ final video: ${FINAL_VIDEO} (${mb} MB)`);
}

main().catch((err) => {
  console.error('Assembly failed:', err);
  process.exit(1);
});
