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
const LOCAL_DEFAULT_URL = 'http://localhost:3000';

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
  owner: { name: 'Dr. Aisha Verma', specialty: 'General Dentistry', pin: '3829' },
  member: { name: 'Dr. Rohan Mehta', specialty: 'Endodontics', pin: '7415' },
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
    minDuration: 20,
    narration:
      'Meet DentAI — the clinical scribe engineered for modern dental practices. Every clinician signs in with practice identity isolation and a four-digit PIN. The new Clinician Guide provides immediate help for PIN resets via secure recovery tokens, lockout protection, and direct in-app GitHub issue submission for instant feedback.'
  },
  {
    id: '02-onboarding',
    minDuration: 18,
    narration:
      'Onboarding takes less than a minute. Register a doctor name and dental specialty, set an operatory PIN, and a personal clinic workspace is provisioned instantly — complete with practice invite codes to join an existing group.'
  },
  {
    id: '03-dentist-flow',
    minDuration: 75,
    narration:
      'Here is the dentist chairside experience. Start a consultation, capture patient identity and verbal consent, and select your clinical template. Inside the operatory, the ambient HUD provides real-time state cues and phonetic dictation tips. Press the question mark key anytime to open the Clinician Day Guide — outlining the four-phase operatory flow from morning Daysheet setup to evening batch close, along with hands-free glove-safe hotkeys and direct GitHub feedback. During treatment, the audio graph squelches ambient clinic noise while transcribing clinical dialogue live. With one tap, DentAI drafts comprehensive clinical notes, billing codes, and a patient-friendly summary, ready for one-click PMS clipboard transfer.'
  },
  {
    id: '04-owner-flow',
    minDuration: 35,
    narration:
      'For practice owners and principal dentists, the clinic switcher manages the entire dental team. Share your clinic invite code so associate dentists can request to join directly from their session. Practice owners approve with one tap. Every consultation remains strictly scoped to its clinic, with per-practice quota metering and complete audit trails.'
  },
  {
    id: '05-outro',
    minDuration: 22,
    narration:
      'From chairside consultation to compliant clinical record in under two minutes. DentAI brings Apple Medical Grade elegance, hands-free aseptic controls, and contextual operatory guidance to every operatory. Explore DentAI live today.'
  }
];
