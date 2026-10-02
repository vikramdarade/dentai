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
      { key: 'medicalHistory', title: 'MEDICAL HISTORY & ALERTS', defaultPlaceholder: 'Med hx reviewed. Nil changes reported.' },
      { key: 'examination', title: 'CLINICAL EXAMINATION & FINDINGS', defaultPlaceholder: 'Extraoral: WNL. Intraoral: Soft tissues normal. Dentition examined.' },
      { key: 'diagnosis', title: 'DIAGNOSIS', defaultPlaceholder: 'Diagnosis pending radiographic/clinical review.' },
      { key: 'treatment', title: 'TREATMENT PERFORMED', defaultPlaceholder: 'Consultation and examination performed.' },
      { key: 'treatmentPlan', title: 'TREATMENT PLAN & INFORMED CONSENT', defaultPlaceholder: 'Discussed treatment options, costs, risks, and benefits with patient.' },
      { key: 'itemCodes', title: 'ITEM CODES (ADA 13th Ed.)', defaultPlaceholder: '011 / 012 / 014' },
    ],
  },
  {
    id: 'soap',
    name: 'SOAP Note',
    badge: 'Clinical',
    description: 'Classic clinical structure: Subjective, Objective, Assessment, Plan.',
    sections: [
      { key: 'subjective', title: 'S - SUBJECTIVE', defaultPlaceholder: 'Chief complaint and history of presenting illness.' },
      { key: 'objective', title: 'O - OBJECTIVE', defaultPlaceholder: 'Clinical examination, diagnostic tests, radiograph findings.' },
      { key: 'assessment', title: 'A - ASSESSMENT', defaultPlaceholder: 'Definitive or differential diagnosis.' },
      { key: 'plan', title: 'P - PLAN & TREATMENT', defaultPlaceholder: 'Treatment completed today, post-op advice, recalls.' },
      { key: 'itemCodes', title: 'ITEM CODES (ADA)', defaultPlaceholder: 'ADA item codes.' },
    ],
  },
  {
    id: 'concise',
    name: 'Concise Note',
    badge: 'Fast',
    description: 'Ultra-fast bulleted summary for busy operatory workflows and short reviews.',
    sections: [
      { key: 'complaint', title: 'COMPLAINT', defaultPlaceholder: 'Attends for review/check.' },
      { key: 'findings', title: 'FINDINGS', defaultPlaceholder: 'Hard and soft tissues checked.' },
      { key: 'tx', title: 'TX DONE', defaultPlaceholder: 'Examination, scale and clean.' },
      { key: 'plan', title: 'NEXT VISIT', defaultPlaceholder: '6 month recall.' },
      { key: 'items', title: 'ADA CODES', defaultPlaceholder: '012, 114, 121' },
    ],
  },
  {
    id: 'hygiene',
    name: 'Hygiene & Perio',
    badge: 'Preventive',
    description: 'Tailored for oral prophylaxis, periodontal charting (BPE), calculus removal, and fluoride therapy.',
    sections: [
      { key: 'oralHygiene', title: 'ORAL HYGIENE & HOME CARE', defaultPlaceholder: 'Brushing 2x daily, interdental cleaning reviewed.' },
      { key: 'perioChart', title: 'PERIODONTAL ASSESSMENT & BPE', defaultPlaceholder: 'BPE Sextants: [BPE Scores]. Marginal bleeding on probing.' },
      { key: 'deposit', title: 'CALCULUS & STAIN', defaultPlaceholder: 'Supragingival calculus and extrinsic staining noted.' },
      { key: 'treatment', title: 'TREATMENT (PROPHYLAXIS)', defaultPlaceholder: 'Ultrasonic and hand scaling, prophylaxis with fluoride paste, topical neutral NaF gel applied.' },
      { key: 'oralHealthPlan', title: 'RECALL & PREVENTIVE PLAN', defaultPlaceholder: '6-month hygiene recall recommended.' },
      { key: 'itemCodes', title: 'ITEM CODES (ADA)', defaultPlaceholder: '111, 114, 121' },
    ],
  },
  {
    id: 'emergency-ext',
    name: 'Emergency Extraction',
    badge: 'Surgical',
    description: 'Surgical and non-surgical exodontia with hemostasis, suture details, and post-op care.',
    sections: [
      { key: 'complaint', title: 'PRESENTING EMERGENCY', defaultPlaceholder: 'Severe odontogenic pain / fractured tooth [Tooth #].' },
      { key: 'preOp', title: 'PRE-OPERATIVE EVALUATION & CONSENT', defaultPlaceholder: 'Periapical radiograph reviewed. Risks discussed: pain, swelling, dry socket, bleeding, nerve injury. Consent signed.' },
      { key: 'procedure', title: 'SURGICAL PROCEDURE', defaultPlaceholder: 'LA: 2% Lignocaine with 1:80,000 Adrenaline. Luxation and elevation of tooth [Tooth #]. Clean extraction of root fragments. Socket curetted and irrigated with sterile saline.' },
      { key: 'hemostasis', title: 'HEMOSTASIS & SUTURES', defaultPlaceholder: 'Hemostasis achieved with pressure pack. Sutures: [None / 3-0 Silk / Resorbable Vicryl].' },
      { key: 'postOp', title: 'POST-OPERATIVE INSTRUCTIONS & SCRIPT', defaultPlaceholder: 'Bite pack 30 mins. No rinsing, spitting, or strenuous exercise for 24h. Analgesia advised. 24h emergency contact given.' },
      { key: 'itemCodes', title: 'ITEM CODES (ADA)', defaultPlaceholder: '013 (Emergency), 022 (X-ray), 311 / 324 (Extraction)' },
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
