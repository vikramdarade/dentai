/**
 * PMS Capabilities Registry.
 *
 * CRITICAL ARCHITECTURAL DIRECTIVE:
 * These flags default strictly to clipboard and file export only (`unconfirmed`).
 * No Practice Management System (PMS) vendor in this codebase has a verified,
 * unattended live write integration. The repository contains explicit evidence
 * that the on-premise PMS route is NOT a file drop (docs/reviews/d4w-integration-evidence-hotdoc.md)
 * and that third-party integrations (like HotDoc/PatientDesk) write appointments,
 * NOT clinical notes (docs/reviews/d4w-integration-route-patientdesk.md).
 *
 * Never flip appointmentWrite, noteWrite, or invoiceWrite to true without
 * a written vendor agreement or verified documentation recorded in the repository.
 */

export type PmsChannel = 'clipboard' | 'file' | 'appointmentWrite' | 'noteWrite' | 'invoiceWrite';

export type PmsCapabilitySource = 'unconfirmed' | 'vendor-confirmed' | 'public-api-docs';

export interface PmsCapability {
  id: string;
  name: string;
  region: 'AU' | 'US' | 'UK' | 'GLOBAL';
  channels: Record<PmsChannel, boolean>;
  source: PmsCapabilitySource;
  notes?: string;
}

export const PMS_REGISTRY: Record<string, PmsCapability> = {
  d4w: {
    id: 'd4w',
    name: 'Dental4Windows (Centaur)',
    region: 'AU',
    channels: {
      clipboard: true,
      file: true,
      appointmentWrite: false,
      noteWrite: false,
      invoiceWrite: false
    },
    source: 'unconfirmed',
    notes: 'Clipboard paste into progress notes tab. No verified direct file-drop or API write route.'
  },
  exact: {
    id: 'exact',
    name: 'EXACT (Software of Excellence)',
    region: 'AU',
    channels: {
      clipboard: true,
      file: true,
      appointmentWrite: false,
      noteWrite: false,
      invoiceWrite: false
    },
    source: 'unconfirmed',
    notes: 'Clipboard paste into clinical notes tab.'
  },
  cliniko: {
    id: 'cliniko',
    name: 'Cliniko',
    region: 'GLOBAL',
    channels: {
      clipboard: true,
      file: true,
      appointmentWrite: false,
      noteWrite: false,
      invoiceWrite: false
    },
    source: 'unconfirmed',
    notes: 'Clipboard paste into treatment notes.'
  },
  corepractice: {
    id: 'corepractice',
    name: 'Core Practice',
    region: 'AU',
    channels: {
      clipboard: true,
      file: true,
      appointmentWrite: false,
      noteWrite: false,
      invoiceWrite: false
    },
    source: 'unconfirmed',
    notes: 'Clipboard paste into patient treatment notes.'
  },
  opendental: {
    id: 'opendental',
    name: 'Open Dental',
    region: 'GLOBAL',
    channels: {
      clipboard: true,
      file: true,
      appointmentWrite: false,
      noteWrite: false,
      invoiceWrite: false
    },
    source: 'unconfirmed',
    notes: 'Clipboard paste into chart notes.'
  },
  dentrix: {
    id: 'dentrix',
    name: 'Dentrix (Henry Schein)',
    region: 'US',
    channels: {
      clipboard: true,
      file: true,
      appointmentWrite: false,
      noteWrite: false,
      invoiceWrite: false
    },
    source: 'unconfirmed',
    notes: 'Clipboard paste into clinical progress notes.'
  }
};

const GENERIC_FALLBACK_CAPABILITY: PmsCapability = {
  id: 'generic',
  name: 'Generic PMS (Clipboard)',
  region: 'GLOBAL',
  channels: {
    clipboard: true,
    file: true,
    appointmentWrite: false,
    noteWrite: false,
    invoiceWrite: false
  },
  source: 'unconfirmed',
  notes: 'Universal clipboard and plain-text export.'
};

/**
 * Returns the capability record for a given PMS ID.
 * Unknown IDs safely fall back to clipboard-only generic capability.
 */
export function capabilityFor(id: string): PmsCapability {
  const norm = String(id || '').trim().toLowerCase();
  return PMS_REGISTRY[norm] || GENERIC_FALLBACK_CAPABILITY;
}

/**
 * Checks if a specific channel is supported for the given PMS.
 */
export function isSupported(id: string, channel: PmsChannel): boolean {
  const cap = capabilityFor(id);
  return Boolean(cap.channels[channel]);
}
