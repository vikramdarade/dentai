/**
 * PMS Adapter Dispatcher & Boundary Enforcement.
 *
 * Dispatches pure rendering to the appropriate PMS adapter.
 * Explicitly guards against unverified write actions by throwing when an action
 * is attempted against an unsupported channel.
 */

import type { PmsEncounter } from './canonical';
import { capabilityFor, isSupported, type PmsCapability } from './capabilities';
import { renderGeneric } from './adapters/generic';
import { renderD4W } from './adapters/d4w';
import { renderExact } from './adapters/exact';
import { renderCliniko } from './adapters/cliniko';
import { renderCorePractice } from './adapters/corepractice';

export interface RenderedNote {
  format: 'text' | 'csv';
  body: string;
  filename?: string;
}

export interface PmsAdapter {
  id: string;
  capability: PmsCapability;
  render(encounter: PmsEncounter): RenderedNote;
}

const ADAPTERS: Record<string, (encounter: PmsEncounter) => string> = {
  generic: renderGeneric,
  d4w: renderD4W,
  exact: renderExact,
  cliniko: renderCliniko,
  corepractice: renderCorePractice,
  opendental: renderGeneric,
  dentrix: renderGeneric
};

/**
 * Renders an encounter for a specific PMS.
 * Falls back safely to generic clipboard layout for unknown PMS IDs.
 */
export function renderForPms(id: string, encounter: PmsEncounter): RenderedNote {
  const normId = String(id || '').trim().toLowerCase();
  const renderer = ADAPTERS[normId] || renderGeneric;
  const body = renderer(encounter);
  return {
    format: 'text',
    body
  };
}

/**
 * Refuses unverified appointment write-backs with a loud, descriptive error.
 */
export function renderAppointment(pmsId: string, encounter: PmsEncounter): never {
  if (!isSupported(pmsId, 'appointmentWrite')) {
    const cap = capabilityFor(pmsId);
    throw new Error(
      `Direct appointment write-back is not supported for ${cap.name} (channel: appointmentWrite). ` +
      `PMS integrations default strictly to clipboard export until vendor capability is verified.`
    );
  }
  throw new Error(`Unimplemented write handler for ${pmsId}`);
}

/**
 * Refuses unverified direct note writes with a loud, descriptive error.
 */
export function writeToPmsNote(pmsId: string, encounter: PmsEncounter): never {
  if (!isSupported(pmsId, 'noteWrite')) {
    const cap = capabilityFor(pmsId);
    throw new Error(
      `Direct clinical note write-back is not supported for ${cap.name} (channel: noteWrite). ` +
      `PMS integrations default strictly to clipboard export until vendor capability is verified.`
    );
  }
  throw new Error(`Unimplemented write handler for ${pmsId}`);
}

/**
 * Refuses unverified direct invoice writes with a loud, descriptive error.
 */
export function writeToPmsInvoice(pmsId: string, encounter: PmsEncounter): never {
  if (!isSupported(pmsId, 'invoiceWrite')) {
    const cap = capabilityFor(pmsId);
    throw new Error(
      `Direct invoice write-back is not supported for ${cap.name} (channel: invoiceWrite). ` +
      `PMS integrations default strictly to clipboard export until vendor capability is verified.`
    );
  }
  throw new Error(`Unimplemented write handler for ${pmsId}`);
}
