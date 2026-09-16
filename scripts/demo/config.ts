/**
 * DentAI demo pipeline configuration.
 *
 * Recording creates real accounts and real consultations, so this pipeline must
 * never touch production by accident. It therefore defaults to a local server
 * and refuses a non-local target unless you opt in explicitly:
 *
 *   DEMO_URL=https://staging.example.com DEMO_ALLOW_REMOTE=true bun run demo
 *
 * If you do record against a hosted environment, run `bun run demo:cleanup`
 * afterwards so the demo profiles and their consultations are removed (the
 * append-only audit trail is preserved by design) — and never record against
 * the same database a clinic is using.
 */

const EXPLICIT_DEMO_URL = process.env.DEMO_URL || '';
const LOCAL_DEFAULT_URL = 'http://localhost:5173';

function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i.test(url);
}

if (EXPLICIT_DEMO_URL && !isLocalUrl(EXPLICIT_DEMO_URL) && process.env.DEMO_ALLOW_REMOTE !== 'true') {
  throw new Error(
    `Refusing to record against ${EXPLICIT_DEMO_URL}: a remote target is not local. ` +
      'Set DEMO_ALLOW_REMOTE=true if you are certain it is a staging environment, then run demo:cleanup afterwards.'
  );
}

export const LIVE_URL = EXPLICIT_DEMO_URL || LOCAL_DEFAULT_URL;

export const OUT_DIR = 'demo/out';
export const FINAL_VIDEO = 'demo/dentai-demo.mp4';

export const VIDEO = { width: 1920, height: 1080, fps: 30 } as const;

/** Demo identities — kept constant so `demo:cleanup` can find them. */
export const DEMO = {
  owner: { name: 'Dr. Aisha Verma', specialty: 'General Dentistry', pin: '2468' },
  member: { name: 'Dr. Rohan Mehta', specialty: 'Endodontics', pin: '1357' },
  patient: { firstName: 'Maya', lastName: 'Sharma', dobDigits: '15041985' }
};

export interface Scene {
  id: string;
  /** Floor duration (s) — scene never renders shorter, even with short narration. */
  minDuration: number;
  narration: string;
}

/**
 * Narration script (one segment per scene). Keep sentences conversational —
 * they are read aloud by the TTS voice.
 */
export const SCENES: Scene[] = [
  {
    id: '01-sign-in',
    minDuration: 14,
    narration:
      'Meet DentAI — the clinical scribe built for busy dental practices. Every dentist signs in with a secure profile and a four-digit PIN, so patient records stay protected on any workstation in the clinic.'
  },
  {
    id: '02-onboarding',
    minDuration: 14,
    narration:
      'Onboarding takes less than a minute. A dentist registers with a name and specialty, sets a PIN, and their personal clinic is provisioned instantly — no IT project required.'
  },
  {
    id: '03-dentist-flow',
    minDuration: 34,
    narration:
      "Here is the dentist flow. Start a new consultation, capture the patient's identity and verbal consent, then pick the treatment type — DentAI matches it to the right clinical template. During the appointment, the conversation is transcribed live. When you finish, DentAI drafts structured clinical notes, billing codes, and a patient-friendly care summary in seconds. The dentist reviews, adjusts, and saves — the note lands in the History Hub, and works offline when the clinic internet drops."
  },
  {
    id: '04-owner-flow',
    minDuration: 26,
    narration:
      'For practice owners, the clinic switcher manages the whole team. Share your invite code, and a colleague can request to join from their own login. Approve with one tap. Every note stays scoped to its clinic, with per-clinic AI metering, so records never leak between practices.'
  },
  {
    id: '05-outro',
    minDuration: 14,
    narration:
      'From consultation to compliant record in under two minutes. DentAI scales from a solo practice to a multi-clinic group — reliable, auditable, and built for muscle memory. Try the live app now at dentai dash one dot vercel dot app.'
  }
];
