# DentAI — Narrated Product Demo

A 3-minute, narrated walkthrough of DentAI covering **what's available** and
**how to use it** for the two audiences that matter: **dentists** (ambient
charting end-to-end) and **clinic owners** (practice-wide management, member
approvals, AI metering).

## The demo theater (`#/demo`)

The demo ships as an in-app player — open the app and click **"Watch the
narrated product demo"** on the sign-in screen, or navigate directly to:

```
https://<your-app>/#/demo
```

The player is a time-based video timeline (scenes, captions, narration) that
recreates the real DentAI screens with the same branding and flow. It needs no
backend and no login, so it always works — in previews, demos, and sales calls.

Player controls:

| Control | What it does |
| --- | --- |
| ▶ / ⏸ | Play / pause (start paused so narration is allowed by the browser) |
| ⟲ / ⏮ / ⏭ | Restart · previous scene · next scene |
| Timeline slider | Seek anywhere; scenes and narration re-sync |
| Narration toggle | Speak / mute the voiceover (captions stay on) |
| Speed (0.75×–1.5×) | Playback + narration speed |
| **Record** (top right) | **Present / record mode** — hides every control and the player chrome so screen recordings look like a finished video |
| Fullscreen | Enlarge the stage |

## Producing the final MP4 (3 options)

The demo theater is designed to be screen-recorded into a real video file.

### Option A — Screen-record the player (recommended, ~10 min)

1. Open `#/demo` and click **Play narrated demo** once to unlock narration.
2. Click **Record** (top right) to hide the controls, or press F11 / use the
   fullscreen button for a clean stage.
3. Record your screen:
   - **macOS:** QuickTime Player → File → New Screen Recording.
   - **Windows / Linux:** OBS Studio (Window Capture of the browser tab) or the
     built-in Xbox Game Bar (`Win`+`G`).
   - **Anywhere:** Loom or a Chrome tab-recorder extension.
4. Click **Replay demo** so the recording starts at scene 1, press record, let
   it run (~3:17), stop.
5. Trim the start/end in QuickTime, Clipchamp, CapCut, or DaVinci Resolve, and
   export as MP4 (1080p, H.264).

> The browser's built-in voice is captured with the video. For a more
> professional result, mute the narration (narration toggle) and record your own
> voiceover using the script below (Option B), or record the visuals silently
> and add a TTS/studio track in post.

### Option B — Real voiceover using the script below

1. Record the video with narration **muted**.
2. Record your voice reading the script (each scene is timed in the table).
3. In any editor, lay the audio over the video and align each paragraph to its
   scene using the timestamps.

### Option C — In-app, captions only

Turn narration off and record — the captions carry the message. Great for
silent social clips; add background music in post.

## Voiceover script (with scene timings)

Read naturally, ~150 words/minute. Scenes advance on a fixed clock, so each
paragraph below matches one scene. Times are cumulative from the start.

| # | Time | Scene | Script |
| --- | --- | --- | --- |
| 1 | 0:00 | Intro | "Welcome to DentAI, the ambient clinical scribe that turns dentist-patient conversations into complete, compliance-aligned clinical notes. In about three minutes we will show you everything a dentist can do — then the management tools built in for clinic owners." |
| 2 | 0:11 | Secure sign-in | "Every workstation starts at the secure profile screen. Dentists select their profile and enter a four-digit PIN — no shared passwords, no typing notes mid-treatment. Profiles sync across every workstation in the practice." |
| 3 | 0:23 | The History Hub | "The History Hub is the dentist's home base. Every finished consultation lands here instantly — today's visits grouped at the top, with patient, procedure, and status at a glance. Search by patient name, procedure, or complaint to pull up any past record in seconds." |
| 4 | 0:35 | New consultation · Identity | "Starting a new consultation takes three quick steps. First, patient identity — first name, last name, and date of birth. Exactly what a compliant record needs." |
| 5 | 0:46 | New consultation · Context | "Second, session context. Choose from eight treatment types — examination, scale and clean, emergency, endo, surgical, and more. DentAI automatically selects the matching note template, and that template decides which clinical sections the AI will extract from the conversation." |
| 6 | 1:00 | New consultation · Consent | "Third, clinical consent. DentAI records that the patient has been told artificial intelligence is assisting with charting, under Australian privacy law — and that the practitioner remains responsible for all findings." |
| 7 | 1:11 | Ambient recording | "Recording is fully ambient. DentAI simply listens to the natural dentist-patient conversation — no dictation, no forms to fill. Each exchange streams in live as a transcript, with a real-time visualizer and secure, filtered audio capture." |
| 8 | 1:24 | Every capture option | "Every option lives on this one capture board: a live microphone with one tap, simulated phrases for training, a full library of realistic sample transcripts for each treatment type, and manual clinical comments for anything you want typed in yourself." |
| 9 | 1:37 | AI note generation | "When the consultation ends, DentAI runs the clinical extractor — synthesizing findings, building the tooth map, extracting ADA billing item codes, and drafting a patient-friendly care letter. The dentist keeps full control of everything saved." |
| 10 | 1:50 | Review, edit, save | "The summary presents every section of the chosen template — chief complaint, history, findings, diagnosis, treatment, advice, and recall — ready to review and refine. Copy the formatted note straight into your practice management system, or save it as a completed record." |
| 11 | 2:04 | Never stuck | "DentAI never leaves you stuck. If hosted AI is unavailable, the same screen offers a secure offline draft built only from what was said — or an on-device model. Anything auto-generated is clearly flagged for your review before it can be saved." |
| 12 | 2:16 | For clinic owners | "Now, the clinic owner's view — the tools that keep an entire practice consistent." |
| 13 | 2:24 | Owner view | "As an owner, the History Hub shows every note recorded by every dentist in your clinic, each one attributed to the clinician who saw the patient. No chasing notes, no scattered spreadsheets." |
| 14 | 2:36 | Clinics & invite codes | "Every dentist automatically gets a personal solo-practice clinic, and the switcher moves between clinics in one tap. Colleagues join with a simple invite code — landing as pending members until you approve them." |
| 15 | 2:49 | Manage members & codes | "Clinic management puts everything in the owner's hands: copy the invite code to share with associates and locums, generate a brand-new code if one has been shared too widely, or rename the clinic — all from one screen." |
| 16 | 3:02 | Approve your team | "Join requests appear here, clearly marked pending. Approve to grant access, or decline — and pending members see nothing until you approve them, so the code stays an application credential, not a security risk." |
| 17 | 3:13 | AI usage, metered | "Owners also see AI usage at a glance — a live meter showing how many hosted AI notes the clinic has used today. And if the daily allowance is reached, the dentist still drafts offline with zero loss, so patient care never stops." |
| 18 | 3:25 | Recap | "That's DentAI — ambient charting for the dentist, practice-wide control for the owner, with eight treatment templates, resilient fallbacks, and privacy by design. Ready to see it live? Register your first profile and start your first consultation." |

## How it's built

- `src/demo/demoScript.ts` — scene data: kind, title, narration, duration
  (the source of truth for the table above).
- `src/demo/Scenes.tsx` — animated recreations of each real screen, driven by
  a per-scene `progress` value.
- `src/demo/DemoMovie.tsx` — the player: timeline, speech-synthesis narration,
  captions, seek/scrub, speed, and record/present mode.
- `src/App.tsx` — mounts the player for the public `#/demo` hash route
  (no auth). `src/components/Login.tsx` links to it.

To tweak the demo: edit narration/durations in `demoScript.ts` (the player and
this document stay in sync automatically for timings), or adjust scene visuals
in `Scenes.tsx`. Nothing in the demo touches `/api`, real patient data, or
localStorage, so it is safe to run anywhere.