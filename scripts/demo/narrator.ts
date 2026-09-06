/**
 * Narrator: turn each scene's narration into per-scene WAV files.
 *
 * Uses the Gemini TTS model (`gemini-2.5-flash-preview-tts`) through the same
 * `@google/genai` SDK the app already depends on — no new service or key. The
 * key is read from the environment exactly like server.ts does
 * (GEMINI_API_KEY, falling back to GEMINI_FALLBACK_API_KEY).
 *
 * Graceful degradation: if no key is present or TTS fails, a silent WAV of the
 * scene's floor duration is emitted so assembly still succeeds — the video is
 * produced regardless, and narration can be re-generated later by re-running
 * `bun run demo:narrate`.
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { SCENES, OUT_DIR } from './config';

// Same env loading the app server uses (delete-profile.ts does this too), so
// the narrator picks up GEMINI_API_KEY from .env.local without exposing it.
dotenv.config({ path: '.env.local' });
dotenv.config();

const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const VOICE = 'Kore';

/** Raw 24 kHz, 16-bit, mono PCM → WAV container. */
function pcmToWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function silenceWav(seconds: number): Buffer {
  return pcmToWav(Buffer.alloc(Math.round(seconds * 24000) * 2));
}

function pickKey(): string | null {
  const k = process.env.GEMINI_API_KEY;
  if (k && k !== 'MY_GEMINI_API_KEY') return k;
  const f = process.env.GEMINI_FALLBACK_API_KEY;
  return f && f !== 'MY_GEMINI_API_KEY' ? f : null;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const key = pickKey();
  const ai = key ? new GoogleGenAI({ apiKey: key }) : null;
  if (!ai) {
    console.warn('⚠ No GEMINI_API_KEY found — emitting silent narration tracks (video still assembles).');
  }

  for (const scene of SCENES) {
    const wavPath = path.join(OUT_DIR, `${scene.id}.wav`);
    let done = false;
    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: TTS_MODEL,
          contents: [{ parts: [{ text: scene.narration }] }],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } }
          }
        } as any);
        const parts: any[] = response.candidates?.[0]?.content?.parts || [];
        const b64 = parts.find((p) => p.inlineData?.data)?.inlineData?.data;
        if (b64) {
          fs.writeFileSync(wavPath, pcmToWav(Buffer.from(b64, 'base64')));
          done = true;
        }
      } catch (err: any) {
        console.warn(`⚠ TTS failed for ${scene.id}: ${err.message || err}`);
      }
    }
    if (!done) {
      const fallback = SCENES.find((s) => s.id === scene.id)!.minDuration;
      fs.writeFileSync(wavPath, silenceWav(fallback));
      console.warn(`⚠ silent track for ${scene.id} (${fallback}s)`);
    } else {
      console.log(`✓ narrated ${wavPath}`);
    }
  }
  console.log('Narration ready — next: bun run demo:assemble');
}

main().catch((err) => {
  console.error('Narrator failed:', err);
  process.exit(1);
});
