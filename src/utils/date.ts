/**
 * Date formatting and validation helper utilities
 */

/**
 * Automatically masks a numeric input to DD/MM/YYYY format.
 * Automatically inserts slashes and handles deletion smoothly.
 */
export function maskDobInput(value: string): string {
  // Remove all non-digit characters
  const clean = value.replace(/\D/g, '').slice(0, 8);
  let formatted = '';
  
  if (clean.length > 0) {
    formatted += clean.slice(0, 2);
  }
  if (clean.length > 2) {
    formatted += '/' + clean.slice(2, 4);
  }
  if (clean.length > 4) {
    formatted += '/' + clean.slice(4, 8);
  }
  
  return formatted;
}

/**
 * Converts a DD/MM/YYYY date string into a YYYY-MM-DD ISO string for the backend.
 */
export function parseDobToIso(dobStr: string): string {
  const parts = dobStr.split('/');
  if (parts.length !== 3) return '';
  const [day, month, year] = parts;
  return `${year}-${month}-${day}`;
}

/**
 * Validates that a date of birth string:
 * 1. Matches DD/MM/YYYY format.
 * 2. Represents a valid past calendar date.
 * 3. Year is between 1900 and current year.
 * 4. Correctly validates month days (including leap years).
 */
export function isValidDob(dobStr: string): boolean {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dobStr)) return false;
  
  const [dayStr, monthStr, yearStr] = dobStr.split('/');
  const day = parseInt(dayStr, 10);
  const month = parseInt(monthStr, 10);
  const year = parseInt(yearStr, 10);
  
  const currentYear = new Date().getFullYear();
  if (year < 1900 || year > currentYear) return false;
  if (month < 1 || month > 12) return false;
  
  // Get days in month (0th day of next month is the last day of this month)
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) return false;
  
  // Verify it is a valid date in the past
  const parsedDate = new Date(year, month - 1, day);
  if (isNaN(parsedDate.getTime()) || parsedDate > new Date()) return false;
  
  return true;
}

/**
 * Detects the clinic/user local timezone.
 * Defaults to the operating system / browser's configured timezone.
 */
export function getClinicTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Formats a date into a localized, human-friendly clinic date string.
 * Example: 'Sep 19, 2026' or 'Saturday, Sep 19, 2026'
 */
export function formatClinicDate(
  dateInput: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
  timeZone?: string
): string {
  if (!dateInput) return '';

  // If a simple calendar date YYYY-MM-DD string is provided, format that calendar date directly
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
    const [year, month, day] = dateInput.trim().split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const defaultOptions: Intl.DateTimeFormatOptions = {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    };
    return new Intl.DateTimeFormat('en-US', { ...defaultOptions, ...options }).format(date);
  }

  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return String(dateInput);

  const tz = timeZone || getClinicTimeZone();
  const defaultOptions: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  };

  return new Intl.DateTimeFormat('en-US', { ...defaultOptions, ...options }).format(date);
}

/**
 * Formats a time into a 12-hour clinic clock string.
 * Example: '10:15 AM'
 */
export function formatClinicTime(
  dateInput: Date | string | number = new Date(),
  options?: Intl.DateTimeFormatOptions,
  timeZone?: string
): string {
  const date = typeof dateInput === 'string' && !dateInput.includes('T') && dateInput.includes(':')
    // If it's already a time string like "10:15" or "10:15 AM", ensure clean AM/PM
    ? (() => {
        const today = new Date();
        const [timePart, meridiem] = dateInput.trim().split(/\s+/);
        const [hours, minutes] = timePart.split(':');
        let h = parseInt(hours, 10);
        if (meridiem && meridiem.toUpperCase().startsWith('P') && h < 12) h += 12;
        if (meridiem && meridiem.toUpperCase().startsWith('A') && h === 12) h = 0;
        today.setHours(h, parseInt(minutes, 10) || 0, 0, 0);
        return today;
      })()
    : new Date(dateInput);

  if (isNaN(date.getTime())) return String(dateInput);

  const tz = timeZone || getClinicTimeZone();
  const defaultOptions: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  };

  return new Intl.DateTimeFormat('en-US', { ...defaultOptions, ...options }).format(date);
}

/**
 * Formats current date as YYYY-MM-DD in the clinic's local timezone.
 */
export function getClinicTodayIso(timeZone?: string): string {
  const tz = timeZone || getClinicTimeZone();
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(now);
}

/**
 * Reads an environment variable only when a server-side `process` exists.
 *
 * This module is imported by browser components as well as the server, so a bare
 * `process.env` read would throw in the bundle. The guard mirrors
 * `src/utils/previewMode.ts`.
 */
function readEnv(key: string): string {
  try {
    return typeof process !== 'undefined' && process.env ? String(process.env[key] ?? '') : '';
  } catch {
    return '';
  }
}

/**
 * The IANA timezone the clinic operates in.
 *
 * Server-side date stamping and the daily AI allowance bucket must follow the
 * clinic's calendar day, not the host's. A serverless runtime runs in UTC, so
 * using the process timezone put a 9am Sydney appointment on the previous day,
 * and reset a clinic's daily note allowance at 10-11am local — mid-shift.
 *
 * Configurable with `DENTAI_CLINIC_TIMEZONE`. An unparseable value is ignored
 * rather than allowed to throw while a clinician is saving a note.
 */
export function getConfiguredClinicTimeZone(): string {
  const configured = readEnv('DENTAI_CLINIC_TIMEZONE').trim();
  if (configured) {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: configured });
      return configured;
    } catch {
      // Fall through to the default below.
    }
  }
  return 'Australia/Sydney';
}

/**
 * Clinic-local calendar day key (YYYY-MM-DD).
 *
 * This is the bucket key for per-clinic daily metering and the authoritative
 * "what day is it at this practice" value on the server.
 */
export function getClinicDayKey(when: Date = new Date(), timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || getConfiguredClinicTimeZone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(when);
}

/** Clinic-local short date label in the note-header format, e.g. "Sep 19". */
export function getClinicDayLabel(when: Date = new Date(), timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || getConfiguredClinicTimeZone(),
    month: 'short',
    day: 'numeric'
  }).formatToParts(when);
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${month} ${day}`.trim();
}

/** Clinic-local 12-hour clock label, e.g. "09:15 AM". */
export function getClinicTimeLabel(when: Date = new Date(), timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || getConfiguredClinicTimeZone(),
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(when);
}
