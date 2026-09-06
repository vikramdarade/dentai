/**
 * Narrated product demo — scene data.
 *
 * The demo is a self-contained, backend-free theater at #/demo that recreates
 * the real DentAI screens as animated scenes and narrates them with the
 * browser's speech synthesis. The narration below doubles as the voiceover
 * script for a screen-recorded MP4 (see docs/demo/README.md).
 *
 * Conventions:
 *  - `narration` is the caption text AND the spoken text. `tts` is an optional
 *    speech-only override for words the synthesiser mangles ("DentAI" →
 *    "Dent-A-I", "ADA" → "A D A").
 *  - `duration` is the scene length in milliseconds; the player is time-based
 *    (like a video timeline), so scenes advance on a fixed clock regardless of
 *    how fast the TTS finishes.
 */

export type SceneKind =
  | 'title' // branded intro / section card
  | 'login' // profile select + PIN pad
  | 'history' // dentist History Hub
  | 'intake' // 3-step new-consultation intake
  | 'record' // live recording + capture options
  | 'processing' // AI note generation overlay
  | 'summary' // clinical note review
  | 'roi' // chairside time and economic ROI
  | 'share-template' // peer template sharing and growth loop
  | 'fallback' // offline draft / review flag
  | 'owner-history' // owner-wide History Hub view
  | 'switcher' // clinic switcher + join code
  | 'clinic-manage' // invite code, members, approvals
  | 'usage' // clinic AI usage meter
  | 'pricing' // Solo free vs. Practice tier comparison
  | 'recap'; // closing takeaways

export type DemoAct = 'intro' | 'dentist' | 'owner';

export interface DemoScene {
  id: string;
  act: DemoAct;
  kind: SceneKind;
  /** Chapter label shown in the player UI. */
  title: string;
  /** Caption + narration text. */
  narration: string;
  /** Optional speech-only override (pronunciation fixes). */
  tts?: string;
  /** Scene length in milliseconds. */
  duration: number;
  /** Scene-specific render options. */
  props?: Record<string, unknown>;
}

export const DEMO_SCENES: DemoScene[] = [
  // ------------------------------------------------------------------ Intro
  {
    id: 'intro-title',
    act: 'intro',
    kind: 'title',
    title: 'Welcome',
    narration:
      'Welcome to DentAI, the ambient clinical scribe that turns dentist-patient conversations into complete, compliance-aligned clinical notes. In about three minutes we will show you everything a dentist can do — then the management tools built in for clinic owners.',
    tts: "Welcome to Dent-A-I, the ambient clinical scribe that turns dentist patient conversations into complete, compliance-aligned clinical notes. In about three minutes we'll show you everything a dentist can do — then the management tools built in for clinic owners.",
    duration: 11000,
  },

  // ---------------------------------------------------------------- Dentist
  {
    id: 'login',
    act: 'dentist',
    kind: 'login',
    title: 'Secure sign-in',
    narration:
      'Every workstation starts at the secure profile screen. Dentists select their profile and enter a four-digit PIN — no shared passwords, no typing notes mid-treatment. Profiles sync across every workstation in the practice.',
    duration: 12000,
  },
  {
    id: 'history',
    act: 'dentist',
    kind: 'history',
    title: 'The History Hub',
    narration:
      'The History Hub is the dentist\u2019s home base. Every finished consultation lands here instantly — today\u2019s visits grouped at the top, with patient, procedure, and status at a glance. Search by patient name, procedure, or complaint to pull up any past record in seconds.',
    duration: 12000,
  },
  {
    id: 'intake-1',
    act: 'dentist',
    kind: 'intake',
    title: 'New consultation · Identity',
    narration:
      'Starting a new consultation takes three quick steps. First, patient identity — first name, last name, and date of birth. Exactly what a compliant record needs.',
    duration: 11000,
    props: { step: 1 },
  },
  {
    id: 'intake-2',
    act: 'dentist',
    kind: 'intake',
    title: 'New consultation · Context',
    narration:
      'Second, session context. Choose from eight treatment types — examination, scale and clean, emergency, endo, surgical, and more. DentAI automatically selects the matching note template, and that template decides which clinical sections the AI will extract from the conversation.',
    tts: 'Second, session context. Choose from eight treatment types — examination, scale and clean, emergency, endo, surgical, and more. Dent-A-I automatically selects the matching note template, and that template decides which clinical sections the AI will extract from the conversation.',
    duration: 14000,
    props: { step: 2 },
  },
  {
    id: 'intake-3',
    act: 'dentist',
    kind: 'intake',
    title: 'New consultation · Consent',
    narration:
      'Third, clinical consent. DentAI records that the patient has been told artificial intelligence is assisting with charting, under Australian privacy law — and that the practitioner remains responsible for all findings.',
    tts: 'Third, clinical consent. Dent-A-I records that the patient has been told artificial intelligence is assisting with charting, under Australian privacy law — and that the practitioner remains responsible for all findings.',
    duration: 11000,
    props: { step: 3 },
  },
  {
    id: 'record',
    act: 'dentist',
    kind: 'record',
    title: 'Ambient recording',
    narration:
      'Recording is fully ambient. DentAI simply listens to the natural dentist-patient conversation — no dictation, no forms to fill. Each exchange streams in live as a transcript, with a real-time visualizer and secure, filtered audio capture.',
    tts: 'Recording is fully ambient. Dent-A-I simply listens to the natural dentist patient conversation — no dictation, no forms to fill. Each exchange streams in live as a transcript, with a real-time visualizer and secure, filtered audio capture.',
    duration: 13000,
    props: { focus: 'transcript' },
  },
  {
    id: 'record-options',
    act: 'dentist',
    kind: 'record',
    title: 'Every capture option',
    narration:
      'Every option lives on this one capture board: a live microphone with one tap, simulated phrases for training, a full library of realistic sample transcripts for each treatment type, and manual clinical comments for anything you want typed in yourself.',
    duration: 13000,
    props: { focus: 'options' },
  },
  {
    id: 'processing',
    act: 'dentist',
    kind: 'processing',
    title: 'AI note generation',
    narration:
      'When the consultation ends, DentAI runs the clinical extractor — synthesizing findings, building the tooth map, extracting ADA billing item codes, and drafting a patient-friendly care letter. The dentist keeps full control of everything saved.',
    tts: 'When the consultation ends, Dent-A-I runs the clinical extractor — synthesizing findings, building the tooth map, extracting A D A billing item codes, and drafting a patient friendly care letter. The dentist keeps full control of everything saved.',
    duration: 13000,
  },
  {
    id: 'summary',
    act: 'dentist',
    kind: 'summary',
    title: 'Review, edit, save',
    narration:
      'The summary presents every section of the chosen template — chief complaint, history, findings, diagnosis, treatment, advice, and recall — ready to review and refine. Copy the formatted note straight into your practice management system, or save it as a completed record.',
    duration: 14000,
  },
  {
    id: 'roi',
    act: 'dentist',
    kind: 'roi',
    title: 'Chairside ROI & time saved',
    narration:
      'DentAI transforms clinic economics. By eliminating manual charting, dentists save 15 to 20 minutes per complex procedure — recovering up to two hours every single day. That means finishing on time with zero night-time charting, or seeing one extra patient each day.',
    tts: 'Dent-A-I transforms clinic economics. By eliminating manual charting, dentists save fifteen to twenty minutes per complex procedure — recovering up to two hours every single day. That means finishing on time with zero night-time charting, or seeing one extra patient each day.',
    duration: 13000,
  },
  {
    id: 'share-template',
    act: 'dentist',
    kind: 'share-template',
    title: '1-click templates & peer sharing',
    narration:
      'Sharing note standards is frictionless. Dentists can export custom treatment templates or clinic invite codes to locums and colleagues with a single tap. When a peer imports your template, they get instant chairside charting — sparking natural word of mouth across practices.',
    duration: 13000,
  },
  {
    id: 'fallback',
    act: 'dentist',
    kind: 'fallback',
    title: 'Never stuck',
    narration:
      'DentAI never leaves you stuck. If hosted AI is unavailable, the same screen offers a secure offline draft built only from what was said — or an on-device model. Anything auto-generated is clearly flagged for your review before it can be saved.',
    tts: 'Dent-A-I never leaves you stuck. If hosted AI is unavailable, the same screen offers a secure offline draft built only from what was said — or an on-device model. Anything auto-generated is clearly flagged for your review before it can be saved.',
    duration: 12000,
  },

  // ------------------------------------------------------------------ Owner
  {
    id: 'owner-title',
    act: 'owner',
    kind: 'title',
    title: 'For clinic owners',
    narration:
      'Now, the clinic owner\u2019s view — the tools that keep an entire practice consistent.',
    duration: 8000,
    props: { owner: true },
  },
  {
    id: 'owner-history',
    act: 'owner',
    kind: 'owner-history',
    title: 'Owner view of the practice',
    narration:
      'As an owner, the History Hub shows every note recorded by every dentist in your clinic, each one attributed to the clinician who saw the patient. No chasing notes, no scattered spreadsheets.',
    duration: 12000,
  },
  {
    id: 'switcher',
    act: 'owner',
    kind: 'switcher',
    title: 'Clinics & invite codes',
    narration:
      'Every dentist automatically gets a personal solo-practice clinic, and the switcher moves between clinics in one tap. Colleagues join with a simple invite code — landing as pending members until you approve them.',
    duration: 13000,
  },
  {
    id: 'clinic-manage',
    act: 'owner',
    kind: 'clinic-manage',
    title: 'Manage members & codes',
    narration:
      'Clinic management puts everything in the owner\u2019s hands: copy the invite code to share with associates and locums, generate a brand-new code if one has been shared too widely, or rename the clinic — all from one screen.',
    duration: 13000,
    props: { focus: 'code' },
  },
  {
    id: 'approvals',
    act: 'owner',
    kind: 'clinic-manage',
    title: 'Approve your team',
    narration:
      'Join requests appear here, clearly marked pending. Approve to grant access, or decline — and pending members see nothing until you approve them, so the code stays an application credential, not a security risk.',
    duration: 11000,
    props: { focus: 'approvals' },
  },
  {
    id: 'usage',
    act: 'owner',
    kind: 'usage',
    title: 'AI usage, metered per clinic',
    narration:
      'Owners also see AI usage at a glance — a live meter showing how many hosted AI notes the clinic has used today. And if the daily allowance is reached, the dentist still drafts offline with zero loss, so patient care never stops.',
    duration: 12000,
  },
  {
    id: 'pricing',
    act: 'owner',
    kind: 'pricing',
    title: 'Solo free vs. Practice tier',
    narration:
      'DentAI is free forever for solo clinicians with full ambient charting. Clinic owners upgrade to the Practice Tier for ninety-nine to one hundred forty-nine dollars a month to unlock centralized multi-chair compliance, team template standards, and full practice audit trails.',
    tts: 'Dent-A-I is free forever for solo clinicians with full ambient charting. Clinic owners upgrade to the Practice Tier for ninety nine to one hundred forty nine dollars a month to unlock centralized multi chair compliance, team template standards, and full practice audit trails.',
    duration: 14000,
  },
  {
    id: 'recap',
    act: 'owner',
    kind: 'recap',
    title: 'Recap & next steps',
    narration:
      'That\u2019s DentAI — ambient charting for the dentist, practice-wide control for the owner, with eight treatment templates, resilient fallbacks, and privacy by design. Ready to see it live? Register your first profile and start your first consultation.',
    tts: 'That\u2019s Dent-A-I — ambient charting for the dentist, practice-wide control for the owner, with eight treatment templates, resilient fallbacks, and privacy by design. Ready to see it live? Register your first profile and start your first consultation.',
    duration: 13000,
  },
];

/** Cumulative end time (ms) of each scene — used by the player timeline. */
export const SCENE_ENDS: number[] = (() => {
  const ends: number[] = [];
  let acc = 0;
  for (const scene of DEMO_SCENES) {
    acc += scene.duration;
    ends.push(acc);
  }
  return ends;
})();

export const DEMO_TOTAL_MS = SCENE_ENDS[SCENE_ENDS.length - 1];

/** Which scene is on screen at a given elapsed time (ms). */
export function sceneIndexAt(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  for (let i = 0; i < SCENE_ENDS.length; i++) {
    if (elapsedMs < SCENE_ENDS[i]) return i;
  }
  return DEMO_SCENES.length - 1;
}

/** Progress (0..1) of the scene currently on screen at a given elapsed time. */
export function sceneProgressAt(elapsedMs: number): number {
  const idx = sceneIndexAt(elapsedMs);
  const start = idx === 0 ? 0 : SCENE_ENDS[idx - 1];
  const dur = DEMO_SCENES[idx].duration;
  return Math.min(1, Math.max(0, (elapsedMs - start) / dur));
}

export function formatClock(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}