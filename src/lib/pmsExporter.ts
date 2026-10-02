/**
 * PMS Exporter for DentAI.
 *
 * Provides specialized formatting utilities for exporting clinical notes
 * into Practice Management Systems (PMS) such as Dental4Windows (D4W),
 * EXACT (Software of Excellence), and Best Practice Dental.
 */

export interface PmsExportOptions {
  patientName?: string;
  dentistName?: string;
  dateStr?: string;
  includeHeader?: boolean;
}

/**
 * Strips Markdown formatting (# headings, **bold**, *italic*, bullets)
 * to produce clean plain text for PMS text fields that reject markdown.
 */
export function formatCleanNote(noteText: string): string {
  if (!noteText) return '';

  return noteText
    // Remove markdown headers: #, ##, ###
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold and italics: **text**, *text*, __text__, _text_
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Convert markdown bullets (- , * ) to clean bullet dots or indent
    .replace(/^[-*]\s+/gm, '• ')
    // Remove inline links: [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove horizontal rules
    .replace(/^---+$/gm, '')
    // Normalize excessive newlines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Parses out ADA item codes and tooth details, generating a tab-delimited
 * ledger layout followed by the clean clinical progress note.
 * Tab-delimited item lines paste directly into grid columns in D4W and EXACT.
 */
export function formatForPms(noteText: string, options: PmsExportOptions = {}): string {
  if (!noteText) return '';

  const {
    patientName = '',
    dentistName = '',
    dateStr = new Date().toLocaleDateString('en-AU'),
    includeHeader = true,
  } = options;

  const cleanNote = formatCleanNote(noteText);

  // Extract ADA item lines (e.g. "014: Consultation", "414 - Extirpation tooth 46")
  const adaItemRegex = /(?:ADA\s*)?(\b\d{3}\b)\s*[-:]?\s*([^(\n\r]+)(?:\(([^)]+)\))?/gi;
  const items: Array<{ code: string; desc: string; detail: string }> = [];

  // Look especially inside the ITEM CODES section or full text
  const lines = noteText.split('\n');
  let inItemSection = false;

  for (const line of lines) {
    if (/item\s*codes|billing|ada/i.test(line)) {
      inItemSection = true;
      continue;
    }
    if (inItemSection && /^#{1,4}\s+/.test(line)) {
      inItemSection = false;
    }

    let match;
    while ((match = adaItemRegex.exec(line)) !== null) {
      const code = match[1];
      // Avoid false positive years or quantities (e.g. 2026, 100)
      if (['011', '012', '013', '014', '015', '022', '026', '037', '111', '114', '115', '118', '119', '121', '161', '222', '311', '322', '324', '386', '414', '415', '416', '417', '511', '521', '531', '532', '533', '572', '582', '583', '613', '615', '627', '651', '661', '672', '684', '711', '712', '721', '731', '825', '927', '943', '949'].includes(code) || inItemSection) {
        items.push({
          code,
          desc: match[2]?.trim() || '',
          detail: match[3]?.trim() || '',
        });
      }
    }
  }

  let output = '';

  if (includeHeader) {
    output += `DATE:\t${dateStr}\n`;
    if (patientName) output += `PATIENT:\t${patientName}\n`;
    if (dentistName) output += `PROVIDER:\t${dentistName}\n`;
    output += `------------------------------------------------------------\n`;
  }

  if (items.length > 0) {
    output += `PMS ITEM LEDGER (TAB-DELIMITED):\n`;
    output += `ITEM\tDESCRIPTION\tTOOTH/DETAIL\n`;
    for (const item of items) {
      output += `${item.code}\t${item.desc}\t${item.detail}\n`;
    }
    output += `------------------------------------------------------------\n`;
  }

  output += `CLINICAL PROGRESS NOTE:\n\n${cleanNote}`;

  return output;
}
