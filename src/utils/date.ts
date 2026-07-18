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
