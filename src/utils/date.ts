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
