export interface TemplateSection {
  key: string;
  label: string;
  placeholder: string;
}

export interface NoteTemplate {
  id: string;
  name: string;
  tagline: string;
  description: string;
  sections: TemplateSection[];
  isDefault?: boolean;
  isCustom?: boolean;
}

export const PRESET_TEMPLATES: NoteTemplate[] = [
  {
    id: 'standard',
    name: 'AHPRA Standard (Default)',
    tagline: '8-Point Board Format',
    description: 'Comprehensive dental documentation standard covering chief complaint, exam, perio, radiography, diagnosis, and treatment.',
    isDefault: true,
    sections: [
      { key: 'chiefComplaint', label: 'Chief Complaint', placeholder: 'Patient reason for visit, symptoms, duration' },
      { key: 'history', label: 'Medical & Dental History', placeholder: 'Relevant medical history, allergies, oral hygiene habits' },
      { key: 'toothFindings', label: 'Hard Tissue & Tooth Findings', placeholder: 'FDI tooth findings, restorations, decay, mobility' },
      { key: 'findingsGingival', label: 'Periodontal & Soft Tissue', placeholder: 'Gingival health, pocket depths, plaque/calculus' },
      { key: 'diagnosis', label: 'Diagnosis & Clinical Assessment', placeholder: 'Primary and secondary dental diagnoses' },
      { key: 'treatmentPerformed', label: 'Treatment Performed Today', placeholder: 'Procedures, materials, anesthesia, isolation' },
      { key: 'recommendations', label: 'Preventative Advice & Home Care', placeholder: 'Oral hygiene instructions, dietary advice' },
      { key: 'recallRequirements', label: 'Recall & Next Appointment', placeholder: 'Recommended recall interval and planned treatments' }
    ]
  },
  {
    id: 'soap',
    name: 'SOAP Format',
    tagline: 'Medical Standard',
    description: 'Concise Subjective, Objective, Assessment, and Plan structure commonly used across hospital dentistry and multi-disciplinary clinics.',
    sections: [
      { key: 'subjective', label: 'Subjective (S)', placeholder: 'Patient report, pain scale, symptoms, medical updates' },
      { key: 'objective', label: 'Objective (O)', placeholder: 'Clinical examination, tooth findings, periodontal charting, radiographs' },
      { key: 'assessment', label: 'Assessment (A)', placeholder: 'Diagnosis, caries risk, periodontal classification' },
      { key: 'plan', label: 'Plan (P)', placeholder: 'Treatment performed, prescriptions, patient consent, recall plan' }
    ]
  },
  {
    id: 'restorative',
    name: 'Restorative & Endo Focus',
    tagline: 'Procedure-Heavy Sessions',
    description: 'Tailored for filling appointments, crown preps, root canals, and emergency tooth interventions.',
    sections: [
      { key: 'toothIsolation', label: 'Tooth & Isolation', placeholder: 'FDI tooth number, rubber dam / cotton roll isolation' },
      { key: 'cariesPulp', label: 'Caries & Pulp Status', placeholder: 'Excavation depth, pulpal exposure, liner placed' },
      { key: 'restorationDetails', label: 'Materials & Technique', placeholder: 'Etch, bond, composite shade, matrix band, curing' },
      { key: 'treatmentOutcome', label: 'Occlusion & Polish', placeholder: 'Articulation check, high spots adjusted, polished' },
      { key: 'postOpInstructions', label: 'Post-Op Instructions & Next Step', placeholder: 'Anesthetic warning, numbness advice, next visit' }
    ]
  }
];

const CUSTOM_TEMPLATES_KEY = 'dentai_custom_note_templates';
const ACTIVE_TEMPLATE_KEY = 'dentai_active_template_id';

export const getSavedTemplates = (): NoteTemplate[] => {
  try {
    const customStr = localStorage.getItem(CUSTOM_TEMPLATES_KEY);
    const customTemplates: NoteTemplate[] = customStr ? JSON.parse(customStr) : [];
    return [...PRESET_TEMPLATES, ...customTemplates];
  } catch {
    return PRESET_TEMPLATES;
  }
};

export const getActiveTemplateId = (): string => {
  try {
    return localStorage.getItem(ACTIVE_TEMPLATE_KEY) || 'standard';
  } catch {
    return 'standard';
  }
};

export const setActiveTemplateId = (id: string): void => {
  try {
    localStorage.setItem(ACTIVE_TEMPLATE_KEY, id);
  } catch {}
};

export const saveCustomTemplate = (template: NoteTemplate): NoteTemplate[] => {
  try {
    const customStr = localStorage.getItem(CUSTOM_TEMPLATES_KEY);
    let customTemplates: NoteTemplate[] = customStr ? JSON.parse(customStr) : [];
    customTemplates = customTemplates.filter(t => t.id !== template.id);
    customTemplates.push({ ...template, isCustom: true });
    localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(customTemplates));
    return [...PRESET_TEMPLATES, ...customTemplates];
  } catch {
    return PRESET_TEMPLATES;
  }
};
