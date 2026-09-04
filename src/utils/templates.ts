/**
 * Template utilities for the browser.
 *
 * The built-in template library itself now lives in src/lib/dentalLibrary.ts
 * (shared with the server so the AI schema matches the note template). This
 * file keeps the previous client API — PRESET_TEMPLATES, getSavedTemplates,
 * getActiveTemplateId, saveCustomTemplate — and merges dentist-defined custom
 * templates from localStorage on top of the built-ins.
 */
import {
  NoteTemplate,
  TemplateSection,
  BUILT_IN_TEMPLATES,
  getTemplateById,
  TEMPLATE_BY_ID,
} from '../lib/dentalLibrary';

export type { NoteTemplate, TemplateSection };

/** Built-in templates (formats first, then one per treatment type). */
export const PRESET_TEMPLATES: NoteTemplate[] = BUILT_IN_TEMPLATES;

export const getTemplate = (id?: string | null): NoteTemplate => getTemplateById(id);

export const isBuiltInTemplateId = (id?: string | null): boolean =>
  !!id && !!TEMPLATE_BY_ID[id];

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
