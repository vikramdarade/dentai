# ADR-001: Web-Only Zero-Admin Trojan Horse Architecture

## Status
Accepted

## Date
2026-09-14

## Context
In private dental clinics and Corporate Dental Support Organizations (DSOs), operatory workstations run heavily locked-down versions of Windows 10/11. Associate dentists and oral hygienists do not possess local Windows Administrator credentials. Installing native applications (`.exe`, `.msi`) requires submitting corporate IT support tickets, security reviews, and antivirus exceptions—processes that routinely take 4 to 12 weeks and kill bottom-up product adoption.

Furthermore, corporate group policies (GPOs) frequently restrict the installation of third-party Chrome extensions, or strip unvetted extension permissions to access active browser tabs and system clipboards.

To achieve rapid, Day-1 bottom-up viral adoption where an individual associate can start using DentAI in under 60 seconds during active surgery, we must design an architecture that requires **zero administrative permissions** and **zero native binary installations**.

## Decision
We choose a **100% Web-Standard, Browser-Only Architecture** combined with the native **HTML5 Clipboard API** and mobile QR microphone pairing (`PhoneBeaconMode`):

1. **Standard Browser Delivery:** The application runs exclusively at `app.dentai.com` over HTTPS. Any operatory computer with Chrome, Edge, Firefox, or Safari can access the system immediately.
2. **OS Clipboard Bridge (`F12` / `Ctrl+V`):** Instead of requiring complex desktop accessibility hooks, DLL injections, or PMS vendor API partnerships to insert notes into legacy PMS software (Dental4Windows, EXACT, Dentrix, Eaglesoft), DentAI copies structured notes into the OS clipboard via `navigator.clipboard.writeText()`. Clinicians simply press `F12` (or click `Copy`) in DentAI and paste directly into their PMS text field.
3. **Mobile Phone-as-a-Mic Relay (`PhoneBeaconMode`):** If the operatory PC lacks a quality microphone or has strict audio input restrictions, the clinician scans a dynamic QR code with their mobile device camera. The mobile device connects via WebSockets/WebRTC to stream studio-grade beamforming audio without installing any native mobile apps.
4. **28px Ghost Micro-Pill:** When placed in sidebar/dock mode, the UI collapses into a lightweight, non-intrusive 28px title bar pill with `z-50` isolation, staying out of the dentist's field of view and avoiding taskbar collisions.

## Alternatives Considered

### 1. Electron or Tauri Desktop Native Daemon (.exe / .msi)
- **Pros:** Full access to Windows global hotkeys, background audio listening even when minimized, direct system tray controls.
- **Cons:** Triggers Windows Defender / SmartScreen warnings; requires administrator elevation to install; subject to corporate DSO IT bans.
- **Rejected:** Eliminates the frictionless "Trojan Horse" viral adoption path. An associate dentist cannot test it on a whim.

### 2. Chrome Web Store Extension
- **Pros:** Can inject scripts directly into web-based PMS systems (e.g., Praktika, Dentrix Ascend).
- **Cons:** 80% of Australian and US private practices still run on-premise desktop PMS applications (D4W, EXACT, Eaglesoft) that run outside the browser; extensions are frequently blocked by IT policies.
- **Rejected:** Narrow utility that fails on desktop-bound legacy clinical software.

### 3. Hardware USB Foot Pedal / Dongle
- **Pros:** Physical hands-free actuation without sterile field contamination.
- **Cons:** High upfront capital cost; physical shipping logistics; incompatible with a zero-CAC solo-founder software business model.
- **Rejected:** Can be supported as an optional accessory later, but unacceptable as a core prerequisite.

## Consequences
- **Instant Time-to-Value:** Clinicians can open `app.dentai.com` and generate their first live note within 90 seconds of hearing about the product.
- **Universal PMS Compatibility:** Works with any PMS that accepts keyboard or clipboard input (100% of market software).
- **Zero IT Friction:** Zero IT tickets, zero security audits, and zero deployment resistance.
- **Browser Focus Requirement:** The browser tab must maintain permission to access the microphone and clipboard. This is mitigated by our in-app `DiagnosticAssistant` which verifies clipboard and WebAudio permissions on launch.
