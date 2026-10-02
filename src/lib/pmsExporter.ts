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
 * Converts Markdown tables (| col1 | col2 |) into clean line-by-line clinical bullet items
 * suitable for dental practice management systems that do not render markdown tables.
 */
export function convertMarkdownTablesToCleanText(text: string): string {
  if (!text || !text.includes('|')) return text;

  // Regex to match markdown table blocks
  const tableBlockRegex = /((?:^[ \t]*\|[^\n]+\|[ \t]*\r?\n)+)/gm;

  return text.replace(tableBlockRegex, (tableBlock) => {
    const rawRows = tableBlock
      .trim()
      .split(/\r?\n/)
      .map(r => r.trim())
      .filter(Boolean);

    if (rawRows.length < 2) return tableBlock;

    // Detect separator row (e.g. |---|---| or |:---|:---|)
    const isSeparatorRow = (r: string) => /^[|:\-\s]+$/.test(r);
    const dataRows = rawRows.filter(r => !isSeparatorRow(r));
    if (dataRows.length === 0) return '';

    const parseCells = (row: string) =>
      row
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(c =>
          c
            .trim()
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/\*([^*]+)\*/g, '$1')
        );

    const headers = parseCells(dataRows[0]);
    const bodyRows = dataRows.slice(1);

    if (bodyRows.length === 0) return '';

    const stepIdx = headers.findIndex(h => /step|#|no/i.test(h));
    const descIdx = headers.findIndex(h => /desc|treatment|procedure|action/i.test(h));
    const codeIdx = headers.findIndex(h => /code|ada|item/i.test(h));
    const notesIdx = headers.findIndex(h => /note|comment|status|detail/i.test(h));

    const convertedLines = bodyRows.map((row) => {
      const cells = parseCells(row);
      if (descIdx !== -1) {
        const step = stepIdx !== -1 && cells[stepIdx] ? `Step ${cells[stepIdx]}: ` : '';
        const desc = cells[descIdx] || '';
        const codeVal = codeIdx !== -1 && cells[codeIdx] ? cells[codeIdx].trim() : '';
        const hasCode = codeVal && codeVal !== '—' && codeVal !== '-' && codeVal !== 'N/A';
        const code = hasCode ? ` [ADA ${codeVal}]` : '';
        const noteVal = notesIdx !== -1 && cells[notesIdx] ? cells[notesIdx].trim() : '';
        const hasNote = noteVal && noteVal !== '—' && noteVal !== '-';
        const notes = hasNote ? ` — ${noteVal}` : '';
        return `• ${step}${desc}${code}${notes}`;
      } else {
        // Fallback for general tables
        const validCells = cells.filter(c => c && c !== '—' && c !== '-');
        return `• ` + validCells.join(' — ');
      }
    });

    return convertedLines.join('\n') + '\n';
  });
}

/**
 * Strips Markdown formatting (# headings, **bold**, *italic*, bullets, tables)
 * and dummy boilerplate (signature placeholders) to produce clean, professional
 * plain text for PMS text fields that reject markdown.
 */
export function formatCleanNote(noteText: string): string {
  if (!noteText) return '';

  // 1. Convert markdown tables to clean structured text first
  let cleaned = convertMarkdownTablesToCleanText(noteText);

  // 2. Strip unnecessary boilerplate signatures & compliance disclaimers
  cleaned = cleaned
    .replace(/^#{1,4}\s*Clinician[’']s\s*Signature[\s\S]*$/gmi, '')
    .replace(/\*+All documentation complies with AHPRA[\s\S]*$/gmi, '')
    .replace(/\*+Dentist\s*–\s*Australian Dental Association[\s\S]*$/gmi, '');

  return cleaned
    // Remove markdown headers: #, ##, ###
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold and italics: **text**, *text*, __text__, _text_
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Convert markdown bullets (- , * ) to clean bullet dots
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

  // Extract ADA item lines (e.g. "014: Consultation", "414 - Extirpation tooth 46", "[ADA 121]")
  const adaItemRegex = /(?:ADA\s*|\[ADA\s*)?(\b\d{3}\b)(?:\])?\s*[-:]?\s*([^(\n\r\[\]]+)?(?:\(([^)]+)\))?/gi;
  const items: Array<{ code: string; desc: string; detail: string }> = [];

  // Look across both cleanNote and original text
  const lines = (cleanNote + '\n' + noteText).split('\n');
  const seenCodes = new Set<string>();

  for (const line of lines) {
    let match;
    while ((match = adaItemRegex.exec(line)) !== null) {
      const code = match[1];
      const validAdaCodes = [
        '011', '012', '013', '014', '015', '022', '026', '037',
        '111', '114', '115', '118', '119', '121', '161', '222',
        '311', '322', '324', '386', '414', '415', '416', '417',
        '511', '521', '522', '523', '531', '532', '533', '572',
        '582', '583', '613', '615', '627', '651', '661', '672',
        '684', '711', '712', '721', '731', '825', '927', '943', '949'
      ];

      if (validAdaCodes.includes(code)) {
        const itemKey = `${code}-${match[2]?.trim() || ''}`;
        if (!seenCodes.has(itemKey)) {
          seenCodes.add(itemKey);
          items.push({
            code,
            desc: match[2]?.trim() || 'Dental Service',
            detail: match[3]?.trim() || '',
          });
        }
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
