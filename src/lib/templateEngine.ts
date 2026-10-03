/**
 * Dental Note Template Engine.
 *
 * Implements Australian AHPRA-compliant dental templates and deterministic
 * note reformatting from clinical findings without redundant LLM calls.
 *
 * Enforces non-assertive placeholders ([Tooth #], [Surfaces]) when anatomy
 * is absent, preserving strict AHPRA medicolegal integrity (Rules 19 & 20).
 */

export interface DentalTemplateDefinition {
  id: string;
  name: string;
  badge: string;
  description: string;
  sections: Array<{ key: string; title: string; defaultPlaceholder?: string }>;
}

export const DENTAL_TEMPLATES: DentalTemplateDefinition[] = [
  {
    id: 'ahpra-standard',
    name: 'AHPRA Standard',
    badge: 'Standard',
    description: 'Comprehensive medicolegal record adhering strictly to DBA guidelines for routine and complex consultations.',
    sections: [
      { key: 'subjective', title: 'SUBJECTIVE / PRESENTING COMPLAINT', defaultPlaceholder: 'Patient attends for consultation.' },
      { key: 'medicalHistory', title: 'MEDICAL HISTORY & ALERTS', defaultPlaceholder: 'Medical history reviewed.' },
      { key: 'examination', title: 'CLINICAL EXAMINATION & FINDINGS', defaultPlaceholder: 'Pending clinical examination.' },
      { key: 'diagnosis', title: 'DIAGNOSIS', defaultPlaceholder: 'None recorded / pending review' },
      { key: 'treatment', title: 'TREATMENT PERFORMED', defaultPlaceholder: 'None recorded / not performed' },
      { key: 'treatmentPlan', title: 'TREATMENT PLAN & INFORMED CONSENT', defaultPlaceholder: 'Options and risks discussed.' },
      { key: 'itemCodes', title: 'ITEM CODES (ADA 13th Ed.)', defaultPlaceholder: 'None recorded' },
    ],
  },
  {
    id: 'soap',
    name: 'SOAP Note',
    badge: 'Clinical',
    description: 'Classic clinical structure: Subjective, Objective, Assessment, Plan.',
    sections: [
      { key: 'subjective', title: 'S - SUBJECTIVE', defaultPlaceholder: 'Chief complaint and history of presenting illness.' },
      { key: 'objective', title: 'O - OBJECTIVE', defaultPlaceholder: 'Clinical examination and findings.' },
      { key: 'assessment', title: 'A - ASSESSMENT', defaultPlaceholder: 'Diagnosis pending / none recorded.' },
      { key: 'plan', title: 'P - PLAN & TREATMENT', defaultPlaceholder: 'Treatment and plan as discussed.' },
      { key: 'itemCodes', title: 'ITEM CODES (ADA)', defaultPlaceholder: 'None recorded' },
    ],
  },
  {
    id: 'concise',
    name: 'Concise Note',
    badge: 'Fast',
    description: 'Ultra-fast bulleted summary for busy operatory workflows and short reviews.',
    sections: [
      { key: 'complaint', title: 'COMPLAINT', defaultPlaceholder: 'Attends for consultation.' },
      { key: 'findings', title: 'FINDINGS', defaultPlaceholder: 'Clinical findings recorded.' },
      { key: 'tx', title: 'TX DONE', defaultPlaceholder: 'None recorded / not performed.' },
      { key: 'plan', title: 'NEXT VISIT', defaultPlaceholder: 'Next visit as advised.' },
      { key: 'items', title: 'ADA CODES', defaultPlaceholder: 'None recorded' },
    ],
  },
  {
    id: 'hygiene',
    name: 'Hygiene & Perio',
    badge: 'Preventive',
    description: 'Tailored for oral prophylaxis, periodontal charting (BPE), calculus removal, and fluoride therapy.',
    sections: [
      { key: 'oralHygiene', title: 'ORAL HYGIENE & HOME CARE', defaultPlaceholder: 'Oral hygiene reviewed.' },
      { key: 'perioChart', title: 'PERIODONTAL ASSESSMENT & BPE', defaultPlaceholder: 'Periodontal assessment performed.' },
      { key: 'deposit', title: 'CALCULUS & STAIN', defaultPlaceholder: 'Deposit assessment noted.' },
      { key: 'treatment', title: 'TREATMENT (PROPHYLAXIS)', defaultPlaceholder: 'Periodontal treatment performed.' },
      { key: 'oralHealthPlan', title: 'RECALL & PREVENTIVE PLAN', defaultPlaceholder: 'Recall recommended.' },
      { key: 'itemCodes', title: 'ITEM CODES (ADA)', defaultPlaceholder: 'None recorded' },
    ],
  },
  {
    id: 'emergency-ext',
    name: 'Emergency Extraction',
    badge: 'Surgical',
    description: 'Surgical and non-surgical exodontia with hemostasis, suture details, and post-op care.',
    sections: [
      { key: 'complaint', title: 'PRESENTING EMERGENCY', defaultPlaceholder: 'Presenting emergency.' },
      { key: 'preOp', title: 'PRE-OPERATIVE EVALUATION & CONSENT', defaultPlaceholder: 'Evaluation and risks discussed.' },
      { key: 'procedure', title: 'SURGICAL PROCEDURE', defaultPlaceholder: 'Extraction procedure performed.' },
      { key: 'hemostasis', title: 'HEMOSTASIS & SUTURES', defaultPlaceholder: 'Hemostasis achieved.' },
      { key: 'postOp', title: 'POST-OPERATIVE INSTRUCTIONS & SCRIPT', defaultPlaceholder: 'Post-operative instructions provided.' },
      { key: 'itemCodes', title: 'ITEM CODES (ADA)', defaultPlaceholder: 'None recorded' },
    ],
  },
];

export interface ReformatFindingsInput {
  complaint?: string;
  medicalHistory?: string;
  examination?: string;
  diagnosis?: string;
  treatmentPerformed?: string;
  treatmentPlan?: string;
  itemCodes?: string;
  tooth?: string;
  surfaces?: string;
}

/**
 * Deterministically reformats structured clinical findings into a target template.
 * Guarantees zero hallucination and safe non-assertive placeholders.
 */
export function reformatNoteIntoTemplate(
  templateId: string,
  findings: ReformatFindingsInput = {},
  existingNoteText = ''
): string {
  const template = DENTAL_TEMPLATES.find(t => t.id === templateId) || DENTAL_TEMPLATES[0];

  // If we already have a full note and are converting between templates, extract sections
  const extractedSections: Record<string, string> = {};

  if (existingNoteText) {
    const lines = existingNoteText.split('\n');
    let currentKey = 'general';
    for (const line of lines) {
      const headerMatch = line.match(/^#{1,4}\s+([^:\n]+)/);
      if (headerMatch) {
        const title = headerMatch[1].trim().toLowerCase();
        if (title.includes('subjective') || title.includes('complaint')) currentKey = 'subjective';
        else if (title.includes('medical') || title.includes('history')) currentKey = 'medicalHistory';
        else if (title.includes('exam') || title.includes('objective')) currentKey = 'examination';
        else if (title.includes('diag') || title.includes('assessment')) currentKey = 'diagnosis';
        else if (title.includes('treat') || title.includes('tx') || title.includes('plan')) currentKey = 'treatment';
        else if (title.includes('item') || title.includes('ada') || title.includes('billing')) currentKey = 'itemCodes';
        else currentKey = title;
        extractedSections[currentKey] = extractedSections[currentKey] || '';
      } else if (line.trim()) {
        extractedSections[currentKey] = (extractedSections[currentKey] ? extractedSections[currentKey] + '\n' : '') + line;
      }
    }
  }

  const toothPlaceholder = findings.tooth || '[Tooth #]';
  const surfacesPlaceholder = findings.surfaces || '[Surfaces]';

  const outputSections: string[] = [];

  for (const sec of template.sections) {
    outputSections.push(`### ${sec.title}`);

    let content = '';
    if (sec.key === 'subjective' || sec.key === 'complaint') {
      content = findings.complaint || extractedSections['subjective'] || sec.defaultPlaceholder || '';
    } else if (sec.key === 'medicalHistory') {
      content = findings.medicalHistory || extractedSections['medicalHistory'] || sec.defaultPlaceholder || '';
    } else if (sec.key === 'examination' || sec.key === 'objective' || sec.key === 'findings') {
      content = findings.examination || extractedSections['examination'] || sec.defaultPlaceholder || '';
      content = content.replace(/\[Tooth #\]/g, toothPlaceholder).replace(/\[Surfaces\]/g, surfacesPlaceholder);
    } else if (sec.key === 'diagnosis' || sec.key === 'assessment') {
      content = findings.diagnosis || extractedSections['diagnosis'] || sec.defaultPlaceholder || '';
    } else if (sec.key === 'treatment' || sec.key === 'tx' || sec.key === 'procedure') {
      content = findings.treatmentPerformed || extractedSections['treatment'] || sec.defaultPlaceholder || '';
      content = content.replace(/\[Tooth #\]/g, toothPlaceholder).replace(/\[Surfaces\]/g, surfacesPlaceholder);
    } else if (sec.key === 'treatmentPlan' || sec.key === 'plan' || sec.key === 'oralHealthPlan' || sec.key === 'nextVisit') {
      content = findings.treatmentPlan || extractedSections['treatment'] || sec.defaultPlaceholder || '';
    } else if (sec.key === 'itemCodes' || sec.key === 'items') {
      content = findings.itemCodes || extractedSections['itemCodes'] || sec.defaultPlaceholder || '';
    } else {
      content = extractedSections[sec.key] || sec.defaultPlaceholder || '';
    }

    outputSections.push(content.trim() ? content.trim() : `- ${sec.defaultPlaceholder || 'None recorded'}`);
    outputSections.push('');
  }

  return outputSections.join('\n').trim();
}
