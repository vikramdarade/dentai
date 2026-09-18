# Invisible Chairside Scribe (High-Volume Operatory Engine)

## Problem Statement
How might we enable a busy dentist to run DentAI invisibly in a background browser tab while working in their PMS, effortlessly ignoring ceiling music and 35-minute handpiece/suction marathons, and transitioning to the next patient with zero friction while previous notes compile quietly in the background?

---

## Recommended Direction: "The Ghost Operatory Scribe"
DentAI operates as an invisible, self-sufficient operatory background worker designed specifically for the chaotic reality of high-volume back-to-back dental practices.

1. **True Tab-Throttling Immunity (Silent Background Worker):**
   - No popups, no floating overlays, no mini-PIP windows covering PMS charts, X-rays, or CBCT viewers.
   - An active Web Audio graph with a persistent input node keeps the Chromium tab classified as an **Active Audio Tab**, completely bypassing Chrome's background throttling.
   - Elapsed encounter time is locked to wall-clock epoch deltas (`Date.now() - startTime`), guaranteeing zero clock drift when backgrounded for 45 minutes in Dentrix.

2. **Dual-Stage Acoustic DSP Squelch (Pure Surgical Silence):**
   - **4.2 kHz Handpiece Turbine Notch Filter:** Sharp mechanical bandstop removes high-speed dental drill scream.
   - **Vocal Bandpass (120 Hz – 3,400 Hz) + Harmonic Squelch:** Flattens background radio/Spotify music and continuously squelches steady-state pink noise from HVE suction at -60dB.
   - **Zero Junk in Transcript:** 35 minutes of drill/suction and radio music produces 0 words, 0 hallucinations, and 0 token bloat. Only actual clinician/patient treatment speech is captured.

3. **Asynchronous Non-Blocking Patient Handoff:**
   - Clinicians do not stop to copy notes into PMS between back-to-back patients.
   - Hitting **"Next Patient"** (or pressing `Spacebar` / `⌘→`) immediately transitions the chairside workspace to the next patient and arms the mic.
   - The previous patient's note finalizes and synthesizes silently in the background, updating its status to `Completed` without throwing modals, requiring clipboard pastes, or disturbing the clinician's flow.
   - All completed notes accumulate in the Daysheet and Batch Sign Tray, ready for one-click review during lunch or at the end of the day (5:00 PM).

---

## Key Assumptions to Validate
- [ ] **Assumption 1 (Chrome Background Audio Keep-Alive):** Verify that keeping `AudioContext` active prevents Chromium on Windows from muting or sleeping `SpeechRecognition` when the dentist switches to Dentrix for >30 minutes.
- [ ] **Assumption 2 (Drill & Suction Squelch):** Verify that continuous suction noise does not trigger false positive voice activity when the handpiece is running.
- [ ] **Assumption 3 (Background Synthesis Queuing):** Verify that initiating Note B while Note A is still synthesizing does not cause race conditions or memory leaks in the local store.

---

## MVP Scope

### In Scope
- **Active Audio Keep-Alive & Epoch Clock:** Background tab audio resilience with wall-clock time calculation.
- **DSP Noise Gate & Handpiece Notch Filter:** Notch filter at 4.2 kHz + bandpass 120–3400 Hz for handpiece/suction/music suppression.
- **Asynchronous Handoff Pipeline:** 1-tap/1-hotkey `Next Patient` that dispatches previous note synthesis silently in background without prompting or blocking.
- **Pure Surgical Feed:** Mechanical noise and music discarded; only clinical dialogue surfaces.
- **End-of-Day Batch Review Tray:** Clean list of all completed, auto-synthesized notes for rapid batch sign-off and PMS export at end of day.

### Not Doing (and Why)
- **Floating Picture-in-Picture / Overlays:** *Excluded based on clinician feedback.* Floating overlays distract and cover critical PMS tooth charting buttons and radiographs.
- **Mandatory Clipboard Paste on Finish:** *Excluded based on clinician feedback.* Back-to-back dentists do not paste notes between chairs; forcing this disrupts operatory turnaround cadence.
- **Direct PMS Windows Hook / DLL Injection:** *Excluded.* Injecting into Dentrix/Eaglesoft Windows C++ binaries creates security, anti-virus, and PMS vendor lock-out risks.

---

## Open Questions
1. When dentists perform end-of-day batch export, do they prefer a single `[ Copy All Notes as Batch ]` button or sequential 1-click copies per patient row?
2. If an emergency walk-in is inserted, does the assistant prefer to type the name, or can they pick from the PMS unassigned patient list?
