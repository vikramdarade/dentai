# Refined Audio Architecture: Pure Ambient Desktop & Smart Bluetooth Headset

## Problem Statement
How might we capture studio-clarity dental clinical audio with zero infection-control violations, zero morning device-pairing friction, and zero reliance on the dentist's personal smartphone?

---

## Recommended Direction: The 2-Tier Sterile Audio Pipeline

We pivot decisively away from personal smartphone pairing (`PhoneBeaconMode`). Instead, DentAI operates on a clean 2-tier clinical audio strategy:

### Tier 1 (Default / Day-1): Pure Ambient Desktop Audio
* **Hardware:** The operatory PC's existing built-in microphone array, webcam microphone, or a permanently mounted $29 USB boundary mic placed under the articulating monitor bezel.
* **Clinician Experience:** 
  * The dentist opens `app.dentai.com` in their browser.
  * WebAudio immediately grabs the active Windows/Mac default input device.
  * Dentist presses `Spacebar` or `Alt+C` and speaks naturally with the patient.
  * **Zero setup:** No QR code scanning, no smartphone on the bracket table, zero cross-contamination risk, and zero personal battery drain.

### Tier 2 (Pro / High-Noise Environments): Smart Bluetooth Headset Integration
* **Hardware:** Bluetooth 5.2+ wireless earpieces or bone-conduction headsets (e.g., Shokz OpenComm, Sony LinkBuds, Jabra Talk, or loupe-mounted clip mics) paired directly to the operatory workstation.
* **Clinician Experience:**
  * Ideal for noisy surgical procedures involving high-speed handpieces (whining drill harmonics) and high-volume evacuation (HVE) suction.
  * Microphone sits 1 inch from the clinician's mouth, providing a >20dB Signal-to-Noise Ratio (SNR) boost.
  * Browser WebAudio detects Bluetooth input device switching automatically via `navigator.mediaDevices.ondevicechange`.
  * Bone conduction keeps the ear canal open, allowing normal patient conversation and acoustic feedback while filtering background drill noise.

---

## Key Assumptions to Validate

- [ ] **Assumption 1 (Desktop Mic Sensitivity):** A standard operatory monitor webcam mic or $29 USB boundary mic placed 1.2 meters away can reliably distinguish dental tooth numbers (e.g. "16" vs "26") above standard suction noise using our WebAudio bandpass filter.
  - *Validation:* Run acoustic benchmark tests comparing built-in laptop/AIO mic vs. boundary mic in active surgery.
- [ ] **Assumption 2 (Bluetooth Pairing Simplicity):** Associating a Bluetooth headset to a Windows 10/11 operatory PC does not require Windows Administrator credentials and stays paired across daily reboots.
  - *Validation:* Verify standard Windows Bluetooth pairing permissions in standard user (non-admin) profiles.
- [ ] **Assumption 3 (Infection Control Compliance):** Clinical directors and dental boards (AHPRA/ADA) view a permanently mounted boundary mic and loupe-mounted headset as compliant with AS/NZS 4815 infection control standards (wipeable with hospital-grade disinfectant wipes).
  - *Validation:* Review surface disinfection protocols with practicing clinic principals.

---

## MVP Scope (What's In vs. Out)

### In Scope
1. **Zero-Click Browser Mic Capture:** Default to system audio input with automatic echo cancellation (`echoCancellation: true`), noise suppression (`noiseSuppression: true`), and auto-gain (`autoGainControl: true`).
2. **Audio Input Selector in Cockpit:** Simple dropdown in `DiagnosticAssistant` allowing the user to select between "Operatory Room Mic" and "Bluetooth Headset" in 1 click.
3. **Audio Health Indicator:** Visceral visual feedback showing audio input level (RMS metering) so the dentist knows audio is live before saying patient names.
4. **Permanent Disinfection Compatibility:** Documented hardware recommendations for boundary mics that can be wiped with isopropyl/alcohol hospital wipes.

### Out of Scope / Not Doing (and Why)
- **No Mandatory Phone QR Pairing (`PhoneBeaconMode` demoted):** Banned from the primary flow. Personal phones on bracket tables are a severe infection control hazard, drain battery, and hit clinic Wi-Fi isolation barriers. PhoneBeacon is relegated to an unprompted "Emergency Fallback" utility only.
- **No Proprietary Audio Dongles:** Banned. We will not sell or mandate custom proprietary transmitters that require USB drivers or shipping logistics. Standard Bluetooth and USB audio class 1.0 drivers only.
- **No Native Windows Audio Interception Services:** Banned. All DSP processing remains strictly inside standard browser WebAudio APIs.

---

## Open Questions & Next Steps
1. What is the optimal WebAudio bandpass filter cutoff frequency to eliminate the 4kHz - 8kHz high-speed turbine handpiece whistle without degrading human consonant clarity?
2. Should DentAI offer a free recommended hardware cheat-sheet (listing the top 3 vetted $25 boundary mics and Bluetooth earpieces on Amazon) directly inside the `DiagnosticAssistant`?
