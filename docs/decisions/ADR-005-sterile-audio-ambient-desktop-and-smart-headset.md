# ADR-005: Sterile Audio Pipeline - Ambient Desktop Audio & Smart Bluetooth Headset

## Status
Accepted

## Date
2026-09-14

## Context
In early iterations, `PhoneBeaconMode` was explored to turn the clinician's personal smartphone into a remote microphone via QR code pairing. While technically novel, feedback and clinical reality surfaced critical adoption barriers:
1. **Infection Control & Cross-Contamination:** Surgical gloves worn by dentists and nurses are biologically contaminated with saliva and aerosolized blood. Bringing a personal smartphone into the sterile operatory zone, unlocking it, and resting it on bracket tables violates AHPRA, ADA, and CDC infection control protocols.
2. **Clinic Wi-Fi Firewalls:** Clinical workstation LANs and guest Wi-Fi networks in dental practices are frequently segregated with client-isolation firewalls, blocking WebRTC or WebSocket peer-to-peer pairing.
3. **Clinician Friction:** Associate dentists resent draining their personal phone battery and data plan for clinic operations.
4. **Existing Hardware Availability:** 90% of operatory workstations possess all-in-one PCs with integrated microphone arrays, webcam microphones, or standard USB ports capable of hosting a permanently mounted boundary microphone.

## Decision
We replace `PhoneBeaconMode` as the primary capture mechanism with a **Two-Tier Sterile Audio Pipeline**:

### Tier 1: Zero-Friction Ambient Desktop Microphone (Default)
- Audio capture operates 100% within the browser via standard `navigator.mediaDevices.getUserMedia()`.
- Uses the PC's built-in mic array, webcam, or a permanent $29 USB boundary mic mounted beneath the monitor bezel.
- The microphone is stationary, sterile-wiped with hospital disinfectant wipes alongside clinical surfaces, and requires zero daily pairing.

### Tier 2: Smart Bluetooth Headset / Loupe Clip Integration (High Noise)
- For high-volume surgical operatories with excessive drill/suction noise, clinicians can pair standard Bluetooth 5.2+ headsets (e.g., Shokz OpenComm bone-conduction or single-ear noise-cancelling earpieces) directly to the operatory PC.
- Placing the microphone 1 inch from the clinician's lips delivers >20dB Signal-to-Noise Ratio (SNR) enhancement, bypassing suction noise completely.
- WebAudio automatically detects audio input transitions via `navigator.mediaDevices.ondevicechange`.

### Disposition of PhoneBeaconMode
- `PhoneBeaconMode` is removed from the primary user onboarding and surgery cockpit views.
- It is retained strictly as an unprompted "Emergency Rescue" utility under advanced diagnostic settings if an operatory PC has broken sound drivers.

## Alternatives Considered

### 1. Mandatory Smartphone Beacon Pairing (`PhoneBeaconMode`)
- **Pros:** Every dentist owns a modern smartphone with beamforming microphones.
- **Cons:** Violates infection control guidelines; causes battery drain; blocked by clinic network isolation.
- **Rejected:** Unacceptable clinical friction.

### 2. Custom Proprietary USB Foot-Pedal / Microphone Hardware
- **Pros:** Full hardware control and custom branding.
- **Cons:** High capital outlay, shipping logistics, customs delays, inventory risk; violates the zero-overhead solo-founder business model.
- **Rejected:** Off-the-shelf USB boundary mics and standard Bluetooth headsets provide superior audio quality at zero inventory cost.

## Consequences
- **Absolute Infection Control Compliance:** Zero mobile phones in the operatory field. All hardware can be disinfected according to clinic wipe-down protocols.
- **Instant Morning Start:** The dentist or assistant sits down, launches the browser, and starts charting immediately without scanning QR codes.
- **Superior Audio in Surgery:** Clinicians performing loud surgical extractions or crown preps have a seamless upgrade path to Bluetooth headsets with pristine transcript fidelity.
