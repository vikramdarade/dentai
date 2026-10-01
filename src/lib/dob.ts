/**
 * Date-of-birth normalisation.
 *
 * A date of birth reaches DentAI written three different ways, because it comes
 * from three different places:
 *
 *   - the API contract (`YYYY-MM-DD`), which the patient routes document and an
 *     integrator sends;
 *   - a pasted day sheet, which carries whatever the practice's own software
 *     printed — in Australia `DOB: 11/10/1976`, or `11 Oct 1976`;
 *   - the chairside schedule parser, which stores that string verbatim and
 *     renders it verbatim in the operatory banner.
 *
 * `/api/generate-notes` used to require the ISO form and refuse everything else
 * with a 400. A patient whose date of birth came off a pasted day sheet
 * therefore failed the *synchronous* note path on every attempt and silently
 * fell through to the durable job queue, which never validated the field at all
 * — an invisible downgrade (slower note, and one more thing polling) rather
 * than an error the clinician could see or fix. The value is one the product's
 * own intake produced, so the server is where it has to be understood.
 *
 * Two policies, because the two uses fail differently:
 *
 *   - `clinic` (note generation, prompt context): the date describes the
 *     encounter and is echoed into the note. Anything readable is accepted. A
 *     numeric date whose day and month are both <= 12 is read day-first — the
 *     Australian convention this product is built for, and the same reading the
 *     chairside banner already shows — and is flagged `ambiguous`.
 *   - `strict` (patient identity): the date is used to decide *which person*
 *     this is, so a two-way date must not be guessed at. `ambiguous` is an
 *     error; a date only one way can be read (`14/05/1988`) is accepted.
 *
 * Everything returned is canonical `YYYY-MM-DD`, so callers store one shape.
 * An empty or absent value stays absent — a date of birth is never invented
 * (Rule 12).
 */

export type DobPolicy = 'clinic' | 'strict';

export interface DobParseResult {
  /** Canonical `YYYY-MM-DD`, or `null` when no usable date was supplied. */
  value: string | null;
  /** True when a numeric date could be read either day-first or month-first. */
  ambiguous: boolean;
  /** Set when a date was supplied but is unusable under the chosen policy. */
  error?: string;
}

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december'
];

/** Below this, a DOB is almost certainly a typo rather than a living patient. */
const EARLIEST_YEAR = 1900;

function monthFromName(raw: string): number | null {
  const name = raw.toLowerCase();
  const index = MONTH_NAMES.findIndex((month) => month.slice(0, 3) === name.slice(0, 3));
  // Only accept a full month name or its three-letter abbreviation, so "ju"
  // or "junk" never silently becomes a month.
  if (index === -1) return null;
  const month = MONTH_NAMES[index];
  if (name.length > 3 && !month.startsWith(name) && !name.startsWith(month)) return null;
  return index + 1;
}

/**
 * A two-digit year is a date of birth, not a payment card: `76` is 1976 and
 * `05` is 2005, pivoting on the current century rather than on a fixed window.
 */
function expandYear(raw: string, now: Date): number | null {
  if (raw.length === 4) return Number(raw);
  if (raw.length !== 2) return null;
  const short = Number(raw);
  if (!Number.isFinite(short)) return null;
  const currentShort = now.getUTCFullYear() % 100;
  return short <= currentShort ? 2000 + short : 1900 + short;
}

/** Rejects impossible calendar dates (31 Feb, month 13) and future births. */
function buildIso(year: number, month: number, day: number, now: Date): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < EARLIEST_YEAR || year > now.getUTCFullYear()) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function normalizeDob(raw: unknown, options: { policy?: DobPolicy; now?: Date } = {}): DobParseResult {
  const policy: DobPolicy = options.policy === 'strict' ? 'strict' : 'clinic';
  const now = options.now ?? new Date();

  if (raw === undefined || raw === null) return { value: null, ambiguous: false };
  const text = String(raw).trim();
  if (!text) return { value: null, ambiguous: false };

  const unusable = (): DobParseResult => ({
    value: null,
    ambiguous: false,
    error:
      policy === 'strict'
        ? 'Date of birth must be a real calendar date. Send it as YYYY-MM-DD, or in a clinic format that can only be read one way (e.g. 14/05/1988).'
        : 'Date of birth must be a real calendar date, for example 1976-10-11, 11/10/1976 or 11 Oct 1976.'
  });

  // 1. ISO, the canonical form (tolerating `1976/10/11`).
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) {
    const value = buildIso(Number(iso[1]), Number(iso[2]), Number(iso[3]), now);
    return value ? { value, ambiguous: false } : unusable();
  }

  // 2. A named month — `14 May 1988`, `14-May-88`, `May 14 1988`.
  const named =
    text.match(/^(\d{1,2})[\s/-]+([A-Za-z]{3,9})[\s,/-]+(\d{2}|\d{4})$/) ??
    text.match(/^([A-Za-z]{3,9})[\s/-]+(\d{1,2})[\s,/-]+(\d{2}|\d{4})$/);
  if (named) {
    const dayFirst = /^\d/.test(named[1]);
    const day = Number(dayFirst ? named[1] : named[2]);
    const month = monthFromName(dayFirst ? named[2] : named[1]);
    const year = expandYear(named[3], now);
    const value = month && year !== null ? buildIso(year, month, day, now) : null;
    return value ? { value, ambiguous: false } : unusable();
  }

  // 3. A numeric date — `11/10/1976`, `11-10-76`, `11.10.1976`.
  const numeric = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const year = expandYear(numeric[3], now);
    if (year === null) return unusable();

    // A component above 12 settles which side is the day: 14/05 can only be
    // day-first, 05/14 can only be month-first.
    let day: number;
    let month: number;
    let ambiguous = false;
    if (first > 12 && second <= 12) {
      day = first;
      month = second;
    } else if (second > 12 && first <= 12) {
      month = first;
      day = second;
    } else {
      day = first;
      month = second;
      ambiguous = true;
    }

    const value = buildIso(year, month, day, now);
    if (!value) return unusable();
    if (ambiguous && policy === 'strict') {
      return {
        value: null,
        ambiguous: true,
        error: `Date of birth "${text}" is ambiguous (both parts could be the day), so it is not safe to use for patient identity. Send it as YYYY-MM-DD.`
      };
    }
    return { value, ambiguous };
  }

  return unusable();
}
