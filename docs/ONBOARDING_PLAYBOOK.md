# 🏥 DentAI Clinic Onboarding & Operatory Playbook

> **Target Practice Onboarding Duration**: < 5 minutes total per clinic  
> **Software Installation Required**: 0 (Runs natively in Chrome, Edge, or Safari)  
> **Supported PMS Integrations**: Dental4Windows (D4W), Software of Excellence (EXACT), Core Practice, Dentally

---

## 👩‍💼 Playbook 1: Receptionist 3-Minute Quick Start
### *The D4W & EXACT "Trojan Horse" Check-Out Flow*
**Target Role**: Practice Manager & Front-Desk Receptionist  
**Estimated Read Time**: 3 minutes  

```
[ Patient Enters Clinic ] ────> 1. Snip / Upload Morning Book (Ctrl+V)
                                       │
[ Patient in Chair ]      ────> 2. Dentist records ambient voice note
                                       │
[ Patient at Check-Out ]  ────> 3. Click "Express Copy Note"
                                       │
                                       ├── Top Section: Pastes into D4W Progress Notes
                                       └── [FRONT DESK ACTION ITEM]: Read quote & collect booking deposit!
```

### Step-by-Step Instructions:

1. **Morning Setup (30 Seconds)**:
   - Open DentAI in a browser tab alongside Dental4Windows or EXACT.
   - Take a quick snip of your morning appointment book using Windows Snipping Tool (`Win + Shift + S`) or press `Ctrl + V` inside DentAI.
   - DentAI automatically parses patient names, procedure types, and appointment times with 0 manual typing.

2. **Midday Patient Walk-Ins (10 Seconds)**:
   - If an emergency patient walks in, click **"Add Walk-in"** in the top bar.
   - Enter their name and presenting complaint (e.g. *"Toothache #16"*).

3. **Check-Out & Billing (1 Minute)**:
   - When the patient arrives at reception to pay, locate their card in DentAI.
   - Click the blue/green **"Express Copy"** button.
   - Paste directly into your PMS:
     - **Dental4Windows**: Paste into the **Notes / Clinical Records** tab.
     - **EXACT**: Paste into the **Patient Chart Progress Notes** tab.

4. **Capturing Unbooked Treatment Revenue**:
   - Scroll to the bottom of the pasted clipboard text to locate the **`[FRONT DESK ACTION ITEM]`** block:
   ```text
   [FRONT DESK ACTION ITEM]
   Patient agreed to proceed with: Ceramic Crown (Tooth #16).
   Estimated Fee: $1,850 AUD (ADA 611).
   Action: Collect $200 booking deposit and schedule 90-minute prep appointment.
   ```
   - Before the patient leaves, read the estimated fee and collect the booking deposit on the spot.

---

## 👨‍⚕️ Playbook 2: Dentist 90-Second Chairside Flow
### *Zero-Typing Ambient Operatory Scribe*
**Target Role**: Associate Dentist, Principal Clinician, Oral Health Therapist  
**Estimated Read Time**: 90 seconds  

```
[ Pre-Op Glance ]  ────> Check amber "Pre-Op Brief" cue (surfaces tooth surfaces & cavity isolation)
                               │
[ Patient Sits ]   ────> Click iconic iPhone Record Button
                               │
[ Clinical Exam ]  ────> Speak naturally (e.g., "Deep mesial caries on sixteen, cold test positive...")
                               │
[ Consultation End]────> Click "Finish Note" ──> 100% Grounded SOAP note ready in 2 seconds
                               │
[ Patient SMS ]    ────> Click "Aftercare SMS" ──> Plain-English instructions texted to patient
```

### Step-by-Step Instructions:

1. **Pre-Op Orientation (5 Seconds)**:
   - Look at the patient's card on your chairside monitor or tablet.
   - Read the amber **Pre-Op Brief** badge (e.g. *"Pre-Op: Verify cavity surfaces (MODBL), check occlusal contacts & rubber dam isolation"*).
   - Hover over the tag if you want to inspect full instructions without obstructing patient details.

2. **Ambient Voice Recording (1 Click)**:
   - As the patient sits in the chair, click the **iPhone-style Record Button** on their appointment card.
   - The button transitions into an active recording state with a red core and the top surgery island activates.
   - Speak naturally to the patient and dental assistant during your examination and treatment.

3. **Autonomous Note Synthesis (Instant)**:
   - When the consult finishes, click **"Finish Note"**.
   - DentAI instantly processes the dialogue into a structured **S-O-A-P** note:
     - **S (Subjective)**: Presenting complaint, pain history, medical review.
     - **O (Objective)**: Examination findings, periodontal probing, restorative status.
     - **A (Assessment)**: Differential & definitive diagnosis.
     - **P (Plan)**: Treatment performed, anesthesia administered (e.g. *1 cartridge 2% Lignocaine 1:80k epi*), materials used, and post-op care.

4. **Verbal Recording Consent Check**:
   - If consent prompt appears, confirm: *"I will be using ambient voice transcription to prepare my clinical notes for your record today."*
   - DentAI audits the consent flag internally while keeping it out of the patient's clinical note clipboard payload.

5. **Instant Patient Aftercare (5 Seconds)**:
   - Click **"Aftercare SMS"** to copy plain-English recovery advice (e.g. *"Avoid hot drinks until numbness wears off; take paracetamol as needed"*).
   - Paste into your practice SMS gateway or PMS communication log.

---

## 🔧 Playbook 3: Support Diagnostics & Common Scenarios

| Scenario | Root Cause | Instant Resolution (Under 30s) |
| :--- | :--- | :--- |
| **Pasted into wrong PMS field** | Front desk pasted clinical notes into billing notes | Click the separate **Copy Action Item** button or highlight the `[FRONT DESK ACTION ITEM]` block at the bottom of the note. |
| **Microphone sleep when tab minimized** | Browser background tab throttle | DentAI keeps the `Screen WakeLock API` and background heartbeat active. Ensure the tab is pinned in Chrome/Edge. |
| **Duplicate patient names** | Multiple walk-ins or schedule re-uploads | DentAI's 3-way hash auto-merges midday walk-ins with PMS rosters. No duplicate patient records are created. |
| **Network disconnection during surgery** | Operatory Wi-Fi drop | The **Deterministic Offline Draft Engine** runs directly in browser memory. Notes synthesize locally in 0ms with zero cloud dependency. |

---

*Authored by Grokbot Customer Support & Clinic Onboarding Agent for DentAI practices.*
