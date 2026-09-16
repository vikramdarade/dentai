# DentAI Demo Pipeline

A narrated product demo generated **directly from the live app** — fully
reproducible in code. Every time the product changes, re-run one command and the
demo is rebuilt from the real UI.

## What it produces

`demo/dentai-demo.mp4` — a ~2-minute narrated walkthrough in five scenes:

| Scene | What it shows |
|---|---|
| 1. Sign-in | Secure profile + PIN login screen |
| 2. Onboarding | Registering a new dentist (instant clinic provisioning) |
| 3. Dentist flow | Intake → live transcript → AI note → clinical summary |
| 4. Owner flow | Clinic switcher, invite code, join request, approval |
| 5. Outro | Value recap + CTA |

Narration is generated with **Gemini TTS** using the same `@google/genai` SDK
and key already configured for the app (`GEMINI_API_KEY`), so no additional
service is needed. If no key is present, silent tracks are used and the video
still assembles — you can narrate later by re-running `demo:narrate`.

## Quick start

```bash
bun install                          # installs playwright + ffmpeg-static
npx playwright install chromium      # one-time browser download
bun run demo                         # record → narrate → assemble
```

Output: `demo/dentai-demo.mp4`.

## Step by step

```bash
bun run demo:auth       # scenes 1–2: sign-in + onboarding (creates the demo owner)
bun run demo:dentist    # scene 3: full dentist flow
bun run demo:owner      # scene 4: team/owner flow (registers the demo member)
bun run demo:outro      # scene 5: closing sign-in shot with the demo CTA
bun run demo:narrate    # Gemini TTS narration per scene (silent fallback if no key)
bun run demo:assemble   # transcode, mux narration, concat → MP4
```

## Live-data hygiene

Recording **creates real accounts, real consultations and real patient rows**, so
the pipeline defaults to `http://localhost:5173` and refuses any non-local target
unless you opt in:

```bash
# Local recording (default)
bun run demo

# Staging recording — explicit opt-in, then clean up
DEMO_URL=https://staging.example.com DEMO_ALLOW_REMOTE=true bun run demo
bun run demo:cleanup
```

Two clearly-named demo identities are used (see `DEMO` in
`scripts/demo/config.ts`). `demo:cleanup` removes the demo dentist profiles, their
consultations, and their owned clinics; the append-only audit trail is preserved
by design — it records that the deletion happened.

**Never record against an environment a clinic is using.** Point it at a Neon
branch or a staging database instead.

## Configuration

- `LIVE_URL` — defaults to the local dev server. Set `DEMO_URL` (plus
  `DEMO_ALLOW_REMOTE=true` for anything non-local) to record against staging.
- Scene pacing, narration copy, and demo identities: `scripts/demo/config.ts`.
- Voice: `VOICE` in `scripts/demo/narrator.ts` (Gemini prebuilt voices).

## Sharing

The finished MP4 is a plain file — upload it directly to WhatsApp, LinkedIn, or
email. For a hosted player with analytics, upload the same file to any video
host and embed it on the landing page.
