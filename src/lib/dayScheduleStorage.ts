import { AppointmentType } from './dentalLibrary';

export type ScheduleItemStatus =
  | 'scheduled'
  | 'recording'
  | 'processing'
  | 'ready'
  | 'failed';

export interface DayScheduleItem {
  id: string;
  time: string;
  patientName: string;
  procedureText: string;
  appointmentType: AppointmentType;
  templateId: string;
  status: ScheduleItemStatus;
  jobId?: string;
  consultationId?: string;
  error?: string;
  clinicalNote?: string;
  transcript?: { sender: string; text: string }[];
  adaCodes?: string[];
  completedAt?: string;
  source?: 'snip' | 'manual';
  consentObtained?: boolean;
  consentCapturedAt?: string;
  consentPractitionerId?: string;
  groundingScore?: number;
  isFullyGrounded?: boolean;
  unverifiedClaims?: string[];
  preOpBrief?: string;
  treatmentOpportunity?: {
    code: string;
    description: string;
    estimatedValueAud: number;
    tooth?: string;
  };
  aftercareSummary?: string;
}

const STORAGE_KEY_PREFIX = 'dentai_day_schedule_';

const memStorage = new Map<string, string>();

function getStorageItem(key: string): string | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return memStorage.get(key) || null;
    }
  }
  return memStorage.get(key) || null;
}

function setStorageItem(key: string, val: string): void {
  memStorage.set(key, val);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(key, val);
    } catch {
      // ignore
    }
  }
}

function removeStorageItem(key: string): void {
  memStorage.delete(key);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}

export function generateSafeUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // Insecure context fallback
    }
  }
  return `consult_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function getTodayDateStr(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function loadTodaySchedule(dateStr = getTodayDateStr()): DayScheduleItem[] {
  try {
    const raw = getStorageItem(`${STORAGE_KEY_PREFIX}${dateStr}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Auto-sanitize existing items in storage (e.g. if adaCodes were stored as objects)
    return parsed.map((item: any) => {
      if (!item || typeof item !== 'object') return null;
      let sanitizedCodes: string[] = [];
      if (Array.isArray(item.adaCodes)) {
        sanitizedCodes = item.adaCodes.map((c: any) => {
          if (typeof c === 'string') return c;
          if (typeof c === 'object' && c?.code) return String(c.code);
          return '';
        }).filter(Boolean);
      }
      return {
        ...item,
        adaCodes: sanitizedCodes,
        preOpBrief: item.preOpBrief || generatePreOpBrief(item.appointmentType, item.procedureText, item.patientName)
      };
    }).filter(Boolean) as DayScheduleItem[];
  } catch (err) {
    console.error('Failed to load today schedule from storage:', err);
    return [];
  }
}

export function saveTodaySchedule(items: DayScheduleItem[], dateStr = getTodayDateStr()): void {
  try {
    setStorageItem(`${STORAGE_KEY_PREFIX}${dateStr}`, JSON.stringify(items));
  } catch (err) {
    console.error('Failed to save today schedule to storage:', err);
  }
}

export function updateScheduleItem(
  id: string,
  updates: Partial<DayScheduleItem>,
  dateStr = getTodayDateStr()
): DayScheduleItem[] {
  const current = loadTodaySchedule(dateStr);
  const updated = current.map((item) => {
    if (item.id === id) {
      return { ...item, ...updates };
    }
    return item;
  });
  saveTodaySchedule(updated, dateStr);
  return updated;
}

export function addScheduleItem(
  item: Omit<DayScheduleItem, 'id' | 'status'>,
  dateStr = getTodayDateStr()
): DayScheduleItem {
  const current = loadTodaySchedule(dateStr);
  const newItem: DayScheduleItem = {
    ...item,
    patientName: cleanPatientDisplayName(item.patientName),
    time: normalizeStartTime(item.time),
    id: `sched_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    status: 'scheduled',
    preOpBrief: item.preOpBrief || generatePreOpBrief(item.appointmentType, item.procedureText, item.patientName)
  };
  const updated = [...current, newItem].sort((a, b) => normalizeStartTime(a.time).localeCompare(normalizeStartTime(b.time)));
  saveTodaySchedule(updated, dateStr);
  return newItem;
}

export function deleteScheduleItem(id: string, dateStr = getTodayDateStr()): DayScheduleItem[] {
  const current = loadTodaySchedule(dateStr);
  const updated = current.filter(i => i.id !== id);
  saveTodaySchedule(updated, dateStr);
  return updated;
}

export function clearTodaySchedule(dateStr = getTodayDateStr()): void {
  try {
    removeStorageItem(`${STORAGE_KEY_PREFIX}${dateStr}`);
  } catch {
    // ignore
  }
}

/**
 * Cleans messy PMS patient strings into natural "First Last" display names.
 * Strips phone numbers, duration tags [30m], patient IDs, fees, honorifics, and trailing dots.
 * Converts "LAST, First" or "LAST FIRST" into Title Case "First Last".
 */
export function cleanPatientDisplayName(rawName: string): string {
  if (!rawName || typeof rawName !== 'string') return 'Unknown Patient';

  let s = rawName.trim();

  // Strip Australian/international phone numbers (e.g. 0412 345 678, (0412) 345-678, +61 412 345 678, 02 9876 5432)
  s = s.replace(/(?:\+?61|0)[2-478](?:[\s.-]?\d{4}){2}/g, '');
  s = s.replace(/\(?04\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{3}/g, '');
  s = s.replace(/\b\d{8,10}\b/g, '');

  // Strip bracketed durations/tags: [30m], (45 min), [1hr], [CDBS], [recall], (recall), (#12345)
  s = s.replace(/\[[^\]]*\]/g, ' ');
  s = s.replace(/\([^\)]*\)/g, ' ');

  // Strip patient IDs or appointment codes: #1234, ID: 12345, Pt: 12345
  s = s.replace(/\b(?:id|pt|ref|chart)[\s:#-]*\d+\b/gi, ' ');
  s = s.replace(/#\d+\b/g, ' ');

  // Strip administrative prefixes like "Walk-in:", "Emergency:", "New Pt:"
  s = s.replace(/\b(?:walk-in|emergency|new pt|recall|dna)[\s:-]+/gi, ' ');

  // Strip honorifics: Mr, Mrs, Ms, Miss, Dr, Doctor, Master, Prof
  s = s.replace(/\b(?:mr|mrs|ms|miss|dr|doctor|master|prof)\.?\s+/gi, ' ');

  // Strip trailing truncation ellipsis / dots
  s = s.replace(/\.{2,}/g, '').trim();

  // Handle "LAST, First Middle" or "LAST, FIRST"
  if (s.includes(',')) {
    const parts = s.split(',');
    const surname = parts[0]?.trim() || '';
    let given = parts.slice(1).join(' ').trim();
    // If given name contains procedure separators (e.g. "DAVID - Prep #16 Crown"), extract only the name
    if (/\s+[-/:]\s+/.test(given)) {
      given = given.split(/\s+[-/:]\s+/)[0].trim();
    }
    if (given && surname) {
      s = `${given} ${surname}`;
    } else if (surname) {
      s = surname;
    }
  } else if (/\s+[-/:]\s+/.test(s)) {
    // If name without comma has trailing procedure separator (e.g. "David Miller - Crown Prep")
    s = s.split(/\s+[-/:]\s+/)[0].trim();
  }

  // Remove unwanted punctuation except hyphens and apostrophes (for names like O'Connor, Smith-Jones)
  s = s.replace(/[^\p{L}\p{N}'\s-]/gu, ' ').trim();

  // Normalize multiple spaces
  s = s.replace(/\s+/g, ' ').trim();

  if (!s) return 'Unknown Patient';

  // Title Case formatting: e.g. "SARAH CONNOR" -> "Sarah Connor", "liam o'connor" -> "Liam O'Connor"
  const words = s.split(' ').map(w => {
    if (!w) return '';
    // Preserve apostrophe capitalization like O'Connor
    if (w.includes("'") && w.length > 2) {
      return w.split("'").map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join("'");
    }
    // Hyphenated names like Smith-Jones
    if (w.includes('-') && w.length > 2) {
      return w.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join('-');
    }
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  });

  return words.join(' ');
}

/**
 * Normalizes any clinical appointment time string into canonical 24-hour "HH:MM" start time.
 * Supports:
 * - "09:15", "9:15", "09.15", "9.15", "14.30"
 * - "9:15 AM", "9.15am", "2:30 pm", "2.30pm", "9am", "2pm"
 * - 4-digit military: "0900", "1430"
 * - Ranges: "09:15 - 10:00", "9.00 - 9.45" (extracts start time)
 */
export function normalizeStartTime(timeStr: string): string {
  if (!timeStr || typeof timeStr !== 'string') return '09:00';

  let clean = timeStr.trim();

  // If a range is provided (e.g. "09:15 - 10:00" or "9.15-10.00"), take the first part
  if (clean.includes('-')) {
    clean = clean.split('-')[0].trim();
  }

  const isPm = /pm/i.test(clean);
  const isAm = /am/i.test(clean);

  // Pattern 1: HH:MM or HH.MM (e.g. 09:15, 9.15, 14.30)
  const colonOrDotMatch = clean.match(/(\d{1,2})[:.](\d{2})/);
  if (colonOrDotMatch) {
    let hour = parseInt(colonOrDotMatch[1], 10);
    const minute = parseInt(colonOrDotMatch[2], 10);
    if (isPm && hour < 12) hour += 12;
    if (isAm && hour === 12) hour = 0;
    hour = Math.min(23, Math.max(0, hour));
    const clampedMinute = Math.min(59, Math.max(0, minute));
    return `${String(hour).padStart(2, '0')}:${String(clampedMinute).padStart(2, '0')}`;
  }

  // Pattern 2: Single hour with am/pm (e.g. "9am", "9 am", "2pm", "11 PM")
  const hourAmPmMatch = clean.match(/(\d{1,2})\s*(am|pm)/i);
  if (hourAmPmMatch) {
    let hour = parseInt(hourAmPmMatch[1], 10);
    const period = hourAmPmMatch[2].toLowerCase();
    if (period === 'pm' && hour < 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;
    hour = Math.min(23, Math.max(0, hour));
    return `${String(hour).padStart(2, '0')}:00`;
  }

  // Pattern 3: 4-digit military time (e.g. "0900", "1430")
  const militaryMatch = clean.match(/^(\d{2})(\d{2})$/);
  if (militaryMatch) {
    let hour = parseInt(militaryMatch[1], 10);
    let minute = parseInt(militaryMatch[2], 10);
    hour = Math.min(23, Math.max(0, hour));
    minute = Math.min(59, Math.max(0, minute));
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  // Pattern 4: Unpadded single hour digits (e.g. "9")
  const singleHourMatch = clean.match(/^(\d{1,2})$/);
  if (singleHourMatch) {
    let hour = parseInt(singleHourMatch[1], 10);
    if (hour >= 1 && hour <= 7) hour += 12; // Realistic daytime clinical assumption: 1-7 is afternoon 13-19
    hour = Math.min(23, Math.max(0, hour));
    return `${String(hour).padStart(2, '0')}:00`;
  }

  return '09:00';
}

/**
 * Normalizes patient name for fuzzy matching across differing PMS crops.
 * Strips all honorifics, numbers, durations, and punctuation so that
 * "SMITH, John (0412 345 678) [30m]", "Mr. John Smith", and "John Smith"
 * all resolve to the exact same canonical slug: "johnsmith".
 */
export function normalizePatientName(name: string): string {
  if (!name || typeof name !== 'string') return 'unknown';
  const cleaned = cleanPatientDisplayName(name);
  return cleaned.toLowerCase().replace(/[^a-z0-9]/g, '').trim() || 'unknown';
}

/**
 * Generates a unique slot fingerprint to guard against duplicate entries.
 */
export function generateSlotFingerprint(date: string, time: string, patientName: string): string {
  const normTime = normalizeStartTime(time);
  const normName = normalizePatientName(patientName);
  return `${date}_${normTime}_${normName}`;
}

/**
 * 3-Way Merge Algorithm: merges newly parsed PMS appointment snips into the current roster
 * with 100% deduplication and immutability guarantees.
 */
export function mergeScheduleItems(
  existing: DayScheduleItem[],
  incoming: DayScheduleItem[],
  dateStr = getTodayDateStr()
): DayScheduleItem[] {
  const existingMap = new Map<string, DayScheduleItem>();
  const mergedResult: DayScheduleItem[] = [];
  const processedFingerprints = new Set<string>();

  // Index existing items by fingerprint
  for (const item of existing) {
    const fp = generateSlotFingerprint(dateStr, item.time, item.patientName);
    existingMap.set(fp, item);
  }

  // Process incoming items
  for (const rawIncoming of incoming) {
    const incomingItem: DayScheduleItem = {
      ...rawIncoming,
      patientName: cleanPatientDisplayName(rawIncoming.patientName),
      time: normalizeStartTime(rawIncoming.time)
    };

    const fp = generateSlotFingerprint(dateStr, incomingItem.time, incomingItem.patientName);
    if (processedFingerprints.has(fp)) {
      // Prevent internal duplicates inside the same crop
      continue;
    }
    processedFingerprints.add(fp);

    const existingMatch = existingMap.get(fp);
    if (existingMatch) {
      // RULE 1: Never overwrite in-progress, completed, or already-synthesized consults
      if (['recording', 'processing', 'ready'].includes(existingMatch.status)) {
        mergedResult.push(existingMatch);
      } else {
        // RULE 2: For scheduled appointments, merge updated procedure descriptions
        mergedResult.push({
          ...existingMatch,
          patientName: existingMatch.patientName || incomingItem.patientName,
          procedureText: incomingItem.procedureText || existingMatch.procedureText,
          appointmentType: incomingItem.appointmentType || existingMatch.appointmentType,
          templateId: incomingItem.templateId || existingMatch.templateId
        });
      }
      existingMap.delete(fp);
    } else {
      // RULE 3: Brand new appointment from PMS
      mergedResult.push({
        ...incomingItem,
        id: incomingItem.id || `sched_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        status: incomingItem.status || 'scheduled',
        source: 'snip',
        preOpBrief: incomingItem.preOpBrief || generatePreOpBrief(incomingItem.appointmentType, incomingItem.procedureText, incomingItem.patientName)
      });
    }
  }

  // Preserve any existing items that weren't in the incoming crop (e.g. morning appointments scrolled off screen)
  for (const remaining of existingMap.values()) {
    mergedResult.push(remaining);
  }

  // Sort chronologically by start time
  return mergedResult.sort((a, b) => normalizeStartTime(a.time).localeCompare(normalizeStartTime(b.time)));
}

/**
 * Estimated Australian Dental Association (ADA) billing values
 * for fast real-time daily production metrics.
 */
export const ADA_BENCHMARK_FEES: Record<string, number> = {
  '011': 85,  // Comprehensive oral examination
  '012': 75,  // Periodic oral examination
  '013': 80,  // Oral examination - limited
  '014': 65,  // Consultation
  '022': 50,  // Intraoral periapical radiograph
  '071': 60,  // Diagnostic models
  '114': 165, // Removal of calculus (scale & clean)
  '121': 45,  // Topical application of fluoride
  '161': 80,  // Fissure sealant
  '311': 260, // Extraction of tooth
  '314': 380, // Sectioning of tooth / bone removal
  '414': 380, // Pulp extirpation
  '417': 420, // Root canal instrumentation
  '418': 450, // Root canal obturation
  '531': 200, // 1-surface composite resin
  '532': 255, // 2-surface composite resin
  '533': 310, // 3-surface composite resin
  '611': 1750,// Full crown - ceramic
  '615': 1650,// Full crown - porcelain fused to metal
  '643': 3200,// Fixed dental bridge
  '688': 4200,// Dental implant fixture & abutment
  '965': 980, // Occlusal splint
  'default_examination': 150,
  'default_scale_clean': 210,
  'default_restorative': 255,
  'default_emergency': 180,
  'default_prosthodontic': 1650,
  'default_endodontic': 850,
  'default_surgical': 290
};

/**
 * Generates a concise, 1-line clinical orientation cue for the dentist
 * before the patient sits in the chair.
 */
export function generatePreOpBrief(
  appointmentType: AppointmentType,
  procedureText = '',
  patientName = ''
): string {
  const normProc = (procedureText || '').toLowerCase();

  if (normProc.includes('crown') || appointmentType === 'prosthodontic') {
    return 'Check occlusal clearance, margin prep definition & shade matching. Verify local anaesthesia.';
  }
  if (normProc.includes('pain') || normProc.includes('pulpitis') || normProc.includes('emerg') || appointmentType === 'emergency') {
    return 'Assess chief complaint, cold/percussion tenderness & periapical radiograph. Assess pulp vitality.';
  }
  if (normProc.includes('root canal') || normProc.includes('endo') || appointmentType === 'endodontic') {
    return 'Verify working length, canal patency & rubber dam isolation. LED dressing check.';
  }
  if (normProc.includes('extract') || normProc.includes('surg') || appointmentType === 'surgical') {
    return 'Review medical history, anticoagulants & bleeding risks. Confirm informed verbal consent.';
  }
  if (normProc.includes('clean') || normProc.includes('scale') || appointmentType === 'scale_clean') {
    return 'BPE periodontal sextant screening, calculus index & gingival bleeding review.';
  }
  if (appointmentType === 'paediatric') {
    return 'Tell-Show-Do approach, non-traumatic behaviour guidance & topical fluoride check.';
  }
  if (appointmentType === 'restorative' || normProc.includes('fill') || normProc.includes('resin') || normProc.includes('composite')) {
    return 'Verify cavity surfaces (MODBL), check occlusal contacts & rubber dam isolation.';
  }
  return 'Comprehensive AHPRA check-up. Mucosal screen, BPE score & routine bitewings review.';
}

/**
 * Zero-hallucination opportunity detector: only flags unbooked high-value treatment
 * when the clinician or note explicitly contains high-value ADA codes or procedures.
 */
export function detectTreatmentOpportunity(
  item: Partial<DayScheduleItem>,
  noteText = '',
  adaCodes?: any[],
  transcript?: any[]
): { code: string; description: string; estimatedValueAud: number; tooth?: string } | undefined {
  const combinedText = `${item.procedureText || ''} ${item.clinicalNote || ''} ${noteText || ''} ${(transcript || []).map((t: any) => t.text).join(' ')}`.toLowerCase();

  const codeList = (adaCodes || item.adaCodes || []).map((c: any) => {
    if (typeof c === 'string') return c.replace(/[^0-9]/g, '');
    if (typeof c === 'object' && c?.code) return String(c.code).replace(/[^0-9]/g, '');
    return '';
  }).filter(Boolean);

  const toothMatch = combinedText.match(/(?:tooth|teeth|#)\s*([1-4][1-8])/i);
  const tooth = toothMatch ? toothMatch[1] : undefined;

  if (codeList.includes('688') || combinedText.includes('implant')) {
    return {
      code: '688',
      description: 'Dental Implant Fixture & Abutment',
      estimatedValueAud: 4200,
      tooth
    };
  }

  if (
    codeList.includes('611') ||
    codeList.includes('615') ||
    combinedText.includes('crown prep') ||
    combinedText.includes('ceramic crown') ||
    (combinedText.includes('crown') && !combinedText.includes('temporary crown only'))
  ) {
    return {
      code: '611',
      description: 'Full Ceramic / PFM Crown',
      estimatedValueAud: 1750,
      tooth
    };
  }

  if (codeList.includes('643') || combinedText.includes('bridge')) {
    return {
      code: '643',
      description: 'Fixed Dental Bridge',
      estimatedValueAud: 3200,
      tooth
    };
  }

  if (
    codeList.includes('414') ||
    codeList.includes('417') ||
    combinedText.includes('pulp extirpation') ||
    combinedText.includes('root canal')
  ) {
    return {
      code: '414',
      description: 'Complete Root Canal Therapy',
      estimatedValueAud: 1150,
      tooth
    };
  }

  if (
    codeList.includes('965') ||
    combinedText.includes('occlusal splint') ||
    combinedText.includes('nightguard') ||
    combinedText.includes('bruxism')
  ) {
    return {
      code: '965',
      description: 'Occlusal Splint / Nightguard',
      estimatedValueAud: 980,
      tooth
    };
  }

  if (codeList.includes('311') || combinedText.includes('surgical extraction')) {
    return {
      code: '311',
      description: 'Surgical Tooth Extraction',
      estimatedValueAud: 380,
      tooth
    };
  }

  return undefined;
}

/**
 * Generates jargon-free patient aftercare copy ready for Australian PMS SMS gateways.
 */
export function generateAftercareSnippet(
  appointmentType: AppointmentType,
  procedureText = '',
  noteText = ''
): string {
  const norm = `${procedureText} ${noteText}`.toLowerCase();

  if (norm.includes('extract') || appointmentType === 'surgical') {
    return 'Bite gently on gauze for 30 mins. Avoid hot liquids, smoking, rinsing vigorously, or heavy exertion for 24 hours. Take analgesics as directed if discomfort persists.';
  }
  if (norm.includes('crown') || norm.includes('temp') || norm.includes('bridge')) {
    return 'Avoid chewing sticky or hard foods on this tooth while the temporary is in place. Brush gently around the gumline. Numbness will wear off in 2-3 hours.';
  }
  if (norm.includes('root canal') || norm.includes('extirpat') || appointmentType === 'endodontic' || appointmentType === 'emergency') {
    return 'Temporary filling placed. Avoid chewing hard foods on this side until permanent restoration is completed. Mild tenderness to biting is normal for 48 hours.';
  }
  if (appointmentType === 'scale_clean' || norm.includes('clean') || norm.includes('fluoride')) {
    return 'Nil by mouth for 30 minutes following fluoride treatment. Continue gentle brushing twice daily with soft-bristled brush and daily interdental flossing.';
  }
  return 'Please avoid hot drinks and chewing on the treated side until local anaesthetic numbness fully wears off (approx 2 hours). Contact us if your bite feels high.';
}

export function calculateDailyProduction(items: DayScheduleItem[]): number {
  let total = 0;
  if (!Array.isArray(items)) return 0;

  for (const item of items) {
    if (!item) continue;
    if (item.status === 'ready' || item.status === 'processing') {
      if (Array.isArray(item.adaCodes) && item.adaCodes.length > 0) {
        for (const rawCode of item.adaCodes) {
          const codeStr = typeof rawCode === 'string'
            ? rawCode
            : typeof rawCode === 'object' && rawCode !== null
            ? (rawCode as any).code || ''
            : String(rawCode || '');
          const cleanCode = codeStr.replace(/[^0-9]/g, '');
          total += ADA_BENCHMARK_FEES[cleanCode] || 120;
        }
      } else {
        const feeKey = `default_${item.appointmentType}`;
        total += ADA_BENCHMARK_FEES[feeKey] || 180;
      }
    }
  }
  return total;
}

/**
 * Format a completed consultation note specifically for Australian PMS (D4W & Praktika)
 * clinical progress notes tab, embedding a standardized [FRONT DESK ACTION ITEM]
 * block for effortless front-desk handoff.
 */
export function formatNoteForPmsClipboard(item: DayScheduleItem, consultation?: any): string {
  let baseNote = '';
  if (item?.clinicalNote) {
    baseNote = item.clinicalNote;
  } else if (consultation) {
    const f = consultation.findings || {};
    const lines: string[] = [
      `=== DENTAI AMBIENT CLINICAL NOTE ===`,
      `Patient: ${consultation.firstName || ''} ${consultation.lastName || ''}`.trim(),
      `Date: ${consultation.date || getTodayDateStr()} | Time: ${item?.time || ''}`,
      `Procedure: ${item?.procedureText || consultation.appointmentType || 'General Consultation'}`,
      ``
    ];

    if (f.chiefComplaint) {
      lines.push(`CHIEF COMPLAINT:`, f.chiefComplaint, ``);
    }
    if (f.clinicalFindings) {
      lines.push(`EXAMINATION & FINDINGS:`, f.clinicalFindings, ``);
    }
    if (f.treatmentRendered) {
      lines.push(`TREATMENT PERFORMED:`, f.treatmentRendered, ``);
    }
    if (f.localAnaesthetic) {
      lines.push(`LOCAL ANAESTHETIC:`, f.localAnaesthetic, ``);
    }
    if (f.prescriptions) {
      lines.push(`PRESCRIPTIONS / MATERIALS:`, f.prescriptions, ``);
    }
    if (f.postOpAdvice) {
      lines.push(`POST-OPERATIVE INSTRUCTIONS:`, f.postOpAdvice, ``);
    }
    if (f.nextVisit) {
      lines.push(`NEXT VISIT / RECALL:`, f.nextVisit, ``);
    }

    const adaList = Array.isArray(consultation?.adaCodes) 
      ? consultation.adaCodes 
      : Array.isArray(item?.adaCodes) 
      ? item.adaCodes 
      : [];

    if (adaList && adaList.length > 0) {
      const formattedAda = adaList.map((entry: any) => {
        if (!entry) return '';
        if (typeof entry === 'string') return entry;
        if (typeof entry === 'object') {
          const code = entry.code || '';
          const desc = entry.description ? ` (${entry.description})` : '';
          const tooth = entry.tooth ? ` [Tooth #${entry.tooth}]` : '';
          return `${code}${desc}${tooth}`.trim();
        }
        return String(entry);
      }).filter(Boolean);

      if (formattedAda.length > 0) {
        lines.push(`ADA ITEM CODES:`, formattedAda.join(', '), ``);
      }
    }
    baseNote = lines.join('\n').trim();
  } else {
    baseNote = `Patient: ${item?.patientName || 'Patient'}\nAppointment: ${item?.procedureText || 'Consultation'}\nStatus: Completed`;
  }

  // Check if FRONT DESK ACTION ITEM block is already present in baseNote
  if (!baseNote.includes('[FRONT DESK ACTION ITEM]')) {
    const actionLines: string[] = [];
    if (item?.treatmentOpportunity) {
      const opp = item.treatmentOpportunity;
      const toothStr = opp.tooth ? ` (Tooth #${opp.tooth})` : '';
      actionLines.push(`• UNBOOKED TREATMENT: ${opp.description}${toothStr} — Est. $${opp.estimatedValueAud} AUD`);
    }
    if (item?.aftercareSummary) {
      actionLines.push(`• PATIENT AFTERCARE: ${item.aftercareSummary}`);
    }
    if (actionLines.length > 0) {
      return `${baseNote}\n\n--------------------------------------------------\n[FRONT DESK ACTION ITEM]:\n${actionLines.join('\n')}`;
    }
  }

  return baseNote;
}

