import React, { useState } from 'react';
import {
  Menu,
  User,
  CheckCircle,
  ShieldAlert,
  Copy,
  Check,
  Save,
  ClipboardList,
  FileText,
  Tag
} from 'lucide-react';
import { Consultation, AdaCodeItem, ClinicalFindings } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import {
  NoteTemplate,
  TemplateSection,
  getTemplateById,
  getAppointmentTypeLabel,
  isCanonicalField
} from '../lib/dentalLibrary';
import { getSavedTemplates, getTemplate } from '../utils/templates';

interface ClinicalSummaryProps {
  consultation: Consultation;
  onSave: (updatedConsultation: Consultation) => void;
  onBack: () => void;
  dentistName?: string;
}

const ACCENTS = [
  { card: 'bg-amber-500/5 hover:bg-amber-500/10 border-amber-200/40', label: 'text-amber-600', chip: 'bg-amber-100 text-amber-800' },
  { card: 'bg-indigo-500/5 hover:bg-indigo-500/10 border-indigo-200/40', label: 'text-indigo-600', chip: 'bg-indigo-100 text-indigo-800' },
  { card: 'bg-slate-500/5 hover:bg-slate-500/10 border-slate-200/40', label: 'text-slate-500', chip: 'bg-slate-100 text-slate-700' },
  { card: 'bg-emerald-500/5 hover:bg-emerald-500/10 border-emerald-200/40', label: 'text-emerald-600', chip: 'bg-emerald-100 text-emerald-800' },
  { card: 'bg-sky-500/5 hover:bg-sky-500/10 border-sky-200/40', label: 'text-sky-600', chip: 'bg-sky-100 text-sky-800' },
  { card: 'bg-violet-500/5 hover:bg-violet-500/10 border-violet-200/40', label: 'text-violet-600', chip: 'bg-violet-100 text-violet-800' },
  { card: 'bg-pink-500/5 hover:bg-pink-500/10 border-pink-200/40', label: 'text-pink-600', chip: 'bg-pink-100 text-pink-800' },
  { card: 'bg-teal-500/5 hover:bg-teal-500/10 border-teal-200/40', label: 'text-teal-600', chip: 'bg-teal-100 text-teal-800' }
];

/** Legacy data rescue: older records stored SOAP/Restorative text inside the 8
 *  canonical AHPRA fields. Map those back onto the new template's sections so
 *  history records still render. */
const LEGACY_FIELD_COMPOSE: Record<string, Record<string, string[]>> = {
  soap: {
    subjective: ['chiefComplaint', 'history'],
    objective: ['toothFindings', 'findingsGingival'],
    assessment: ['diagnosis'],
    plan: ['treatmentPerformed', 'recommendations']
  },
  restorative: {
    toothFindings: ['toothFindings'],
    history: ['history'],
    diagnosis: ['diagnosis'],
    treatmentPerformed: ['treatmentPerformed'],
    toothIsolation: ['recommendations'],
    postOpInstructions: ['recommendations'],
    recallRequirements: ['recallRequirements']
  }
};

const readStoredValue = (consultation: Consultation, templateId: string, section: TemplateSection): string => {
  const primary = isCanonicalField(section.key)
    ? (consultation.findings[section.key] ?? '')
    : (consultation.findings.customSections?.[section.key] ?? '');
  if (primary) return primary;

  const composeSources = LEGACY_FIELD_COMPOSE[templateId]?.[section.key];
  if (composeSources) {
    return composeSources
      .map((k) => consultation.findings[k as keyof ClinicalFindings])
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .join('\n')
      .trim();
  }
  return '';
};

const initEdits = (consultation: Consultation, template: NoteTemplate): Record<string, string> => {
  const edits: Record<string, string> = {};
  for (const section of template.sections) {
    edits[section.key] = readStoredValue(consultation, consultation.templateId || 'standard', section);
  }
  return edits;
};

const RECALL_OPTIONS = ['6 Months (Standard)', '3 Months (Periodontal)', 'Next Available (Urgent)'];

export default function ClinicalSummary({
  consultation,
  onSave,
  onBack,
  dentistName
}: ClinicalSummaryProps) {
  const templates = getSavedTemplates();
  const initialTemplate = getTemplate(consultation.templateId);
  const [activeTemplateId, setActiveTemplateId] = useState<string>(
    templates.some((t) => t.id === consultation.templateId) ? consultation.templateId || 'standard' : 'standard'
  );
  const [activeTemplate, setActiveTemplate] = useState<NoteTemplate>(() => {
    const t = templates.find((x) => x.id === initialTemplate.id) || initialTemplate;
    return t;
  });
  const [edits, setEdits] = useState<Record<string, string>>(() =>
    initEdits(consultation, templates.find((x) => x.id === consultation.templateId) || initialTemplate)
  );

  const [patientLetter, setPatientLetter] = useState(consultation.patientSummary || '');
  const [adaCodes, setAdaCodes] = useState<AdaCodeItem[]>(consultation.findings.adaCodes || []);
  const [copied, setCopied] = useState(false);
  const [pmsCopied, setPmsCopied] = useState(false);
  const [showSavedOverlay, setShowSavedOverlay] = useState(false);

  const needsReview = !!consultation.noteOrigin?.needsReview;
  const originEngine = consultation.noteOrigin?.engine || 'gemini';

  const switchTemplate = (templateId: string) => {
    const next = templates.find((t) => t.id === templateId) || getTemplateById(templateId);
    // Carry over any keys that already exist in the current edits; fields not
    // present are re-seeded from the stored record (keeps edits safe).
    const currentKeys = new Set(Object.keys(edits));
    setEdits((prev) => {
      const nextEdits: Record<string, string> = {};
      for (const section of next.sections) {
        nextEdits[section.key] = currentKeys.has(section.key)
          ? prev[section.key] ?? ''
          : readStoredValue(consultation, consultation.templateId || 'standard', section);
      }
      return nextEdits;
    });
    setActiveTemplateId(next.id);
    setActiveTemplate(next);
  };

  const updateEdit = (key: string, value: string) => {
    setEdits((prev) => ({ ...prev, [key]: value }));
  };

  const getSectionValue = (key: string): string => edits[key] ?? '';

  const handleCopySummary = () => {
    navigator.clipboard.writeText(patientLetter);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyPmsNote = () => {
    const lines: string[] = [
      `=== CLINICAL NOTE (${activeTemplate.name.toUpperCase()}) ===`,
      `PATIENT: ${consultation.firstName} ${consultation.lastName} (DOB: ${consultation.dob})`,
      `APPOINTMENT: ${getAppointmentTypeLabel(consultation.appointmentType)}`,
      `DATE: ${consultation.date} ${consultation.time}`,
      ``
    ];
    for (const section of activeTemplate.sections) {
      lines.push(`${section.label.toUpperCase()}:`);
      lines.push(getSectionValue(section.key) || '(not recorded)');
      lines.push(``);
    }
    if (adaCodes.length > 0) {
      lines.push(`--- ADA BILLING ITEM CODES ---`);
      adaCodes.forEach((code) => {
        lines.push(`[${code.code}] ${code.description}${code.tooth ? ` (Tooth FDI ${code.tooth})` : ''}`);
      });
      lines.push(``);
    }
    lines.push(`Clinician: ${dentistName || 'Dentist'} (AHPRA Reg)`);
    navigator.clipboard.writeText(lines.join('\n'));
    setPmsCopied(true);
    setTimeout(() => setPmsCopied(false), 2500);
  };

  const handleSaveToRecord = () => {
    const canonicalValues: Record<string, string> = {};
    const customSections: Record<string, string> = {};

    for (const section of activeTemplate.sections) {
      const value = getSectionValue(section.key);
      if (isCanonicalField(section.key)) {
        canonicalValues[section.key] = value;
      } else if (value.trim()) {
        customSections[section.key] = value;
      }
    }

    const findings: ClinicalFindings = {
      chiefComplaint: canonicalValues.chiefComplaint || '',
      history: canonicalValues.history || '',
      toothFindings: canonicalValues.toothFindings || '',
      findingsGingival: canonicalValues.findingsGingival || '',
      diagnosis: canonicalValues.diagnosis || '',
      treatmentPerformed: canonicalValues.treatmentPerformed || '',
      recommendations: canonicalValues.recommendations || '',
      recallRequirements: canonicalValues.recallRequirements || '',
      customSections: { ...(consultation.findings.customSections || {}), ...customSections },
      adaCodes
    };

    const updatedConsultation: Consultation = {
      ...consultation,
      status: 'Completed',
      templateId: activeTemplate.id,
      findings,
      patientSummary: patientLetter
    };

    onSave(updatedConsultation);
    setShowSavedOverlay(true);
  };

  const patientSummaryEmpty = !patientLetter.trim();
  const sectionRows = activeTemplate.sections.map((section, idx) => {
    const accent = ACCENTS[idx % ACCENTS.length];
    const isRecall = section.key === 'recallRequirements';
    const current = getSectionValue(section.key);
    const rowCount = section.key === 'chiefComplaint' || section.key === 'subjective' ? 3 : 4;

    return (
      <div
        key={section.key}
        className={`p-1 rounded-2xl transition-all duration-300 shadow-sm border focus-within:ring-1 ${accent.card}`}
      >
        <div className="bg-white border rounded-[calc(1rem-0.25rem)] p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-5 h-5 rounded-md font-mono font-bold text-[10px] flex items-center justify-center ${accent.chip}`}>
              {idx + 1}
            </span>
            <label className={`font-bold text-[10px] uppercase tracking-wider ${accent.label}`}>
              {section.label}
            </label>
          </div>
          {isRecall ? (
            <div className="flex flex-col md:flex-row md:items-center gap-3 pt-1">
              <select
                value={current}
                onChange={(e) => updateEdit(section.key, e.target.value)}
                className={`bg-slate-50/50 border text-xs font-bold rounded-lg px-3 py-2 outline-none focus:ring-1 text-slate-700 ${accent.card.split(' ')[2] || 'border-slate-200'}`}
              >
                <option value="">Select recall interval…</option>
                {RECALL_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <span className="text-secondary text-xs text-slate-400">
                Recommended recall / next appointment based on today's visit.
              </span>
            </div>
          ) : (
            <textarea
              rows={rowCount}
              value={current}
              onChange={(e) => updateEdit(section.key, e.target.value)}
              placeholder={section.placeholder}
              className="w-full border-none p-0 focus:ring-0 text-slate-700 text-sm resize-none bg-transparent outline-none"
            />
          )}
        </div>
      </div>
    );
  });

  return (
    <>
      <div id="clinical-summary-container" className="min-h-screen bg-[#F8F7F5] pb-24 text-on-surface no-print">
        {/* Top App Bar */}
        <header className="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-4 h-16 bg-white border-b border-outline-variant shadow-sm">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-2 -ml-2 rounded-full hover:bg-slate-50 transition-colors cursor-pointer">
              <Menu className="text-primary h-6 w-6" />
            </button>
            <h1 className="font-headline-md text-headline-md font-bold text-primary">DentAI</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:flex flex-col items-end">
              <span className="font-semibold text-sm text-slate-800">{dentistName || 'Dentist'}</span>
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest leading-none mt-0.5">
                {getAppointmentTypeLabel(consultation.appointmentType)}
              </span>
            </div>
            <button className="p-1 rounded-full text-slate-400 hover:text-primary transition-all">
              <User className="w-6 h-6" />
            </button>
          </div>
        </header>

        <main className="pt-20 px-4 max-w-[1440px] mx-auto">
          {/* Patient banner */}
          <div className="bg-white border border-outline-variant rounded-2xl p-5 mb-6 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-blue-50 text-[#004ac6] flex items-center justify-center font-bold text-lg border border-blue-100 shadow-inner">
                {consultation.firstName[0] || ''}{consultation.lastName[0] || ''}
              </div>
              <div className="flex flex-col">
                <div className="flex items-center flex-wrap gap-2">
                  <h2 className="text-lg font-bold text-slate-800 leading-tight">
                    {consultation.firstName} {consultation.lastName}
                  </h2>
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200`}>
                    {getAppointmentTypeLabel(consultation.appointmentType)}
                  </span>
                  {needsReview ? (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                      <ShieldAlert className="w-3 h-3" /> Draft — verify
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> AI Verified
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  DOB: <span className="font-semibold text-slate-700">{consultation.dob}</span> &bull; Status:{' '}
                  <span className={`font-semibold ${consultation.status === 'Completed' ? 'text-emerald-700' : 'text-indigo-700'}`}>{consultation.status}</span>
                  {originEngine !== 'gemini' && (
                    <> &bull; <span className="text-amber-600 font-semibold">Generated via {originEngine === 'on-device' ? 'on-device model' : 'offline draft'}</span></>
                  )}
                </p>
              </div>
            </div>
            <div className="flex sm:flex-col items-start sm:items-end text-xs text-slate-400 gap-x-4 gap-y-0.5 flex-wrap border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-100">
              <div>Consultation: <span className="font-semibold text-slate-600">{consultation.date} · {consultation.time}</span></div>
            </div>
          </div>

          {consultation.noteOrigin?.detail && (
            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl text-xs leading-relaxed flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600" />
              <div>
                <span className="font-bold uppercase tracking-wider text-[10px] block mb-1">Review required before this becomes a clinical record</span>
                {consultation.noteOrigin.detail}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* BLOCK A: Clinical findings */}
            <section className="flex flex-col gap-4">
              <div className="flex items-center justify-between py-2 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="font-headline-sm text-lg font-bold text-slate-800">Clinical Findings</h2>
                  <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 font-semibold text-[11px]">
                    {activeTemplate.name}
                  </span>
                </div>
                <button
                  onClick={handleCopyPmsNote}
                  title="Copy the note formatted for your PMS"
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-bold text-xs transition-all active:scale-95 shadow-sm cursor-pointer ${
                    pmsCopied ? 'bg-emerald-600 text-white' : 'bg-[#004ac6] text-white hover:bg-blue-700'
                  }`}
                >
                  {pmsCopied ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{pmsCopied ? 'Copied for PMS!' : '1-Click Copy for PMS'}</span>
                </button>
              </div>

              {/* ADA billing codes */}
              {adaCodes.length > 0 && (
                <div className="p-4 bg-slate-900 text-white rounded-2xl shadow-md border border-slate-800 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Tag className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-200">ADA Billing Codes</span>
                    </div>
                    <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-mono font-semibold">
                      {adaCodes.length} {adaCodes.length === 1 ? 'Item' : 'Items'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {adaCodes.map((item, idx) => (
                      <div key={idx} className="bg-slate-800/90 border border-slate-700 text-white px-3 py-1 rounded-xl flex items-center gap-2 text-xs">
                        <span className="font-mono font-extrabold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/60">
                          {item.code}
                        </span>
                        <span className="text-slate-200">{item.description}</span>
                        {item.tooth && (
                          <span className="text-[10px] text-amber-300 font-mono bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-800/40">
                            FDI {item.tooth}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Template switcher */}
              <div className="flex items-center gap-1.5 p-1 bg-slate-100/80 rounded-xl w-fit border border-slate-200/60 overflow-x-auto max-w-full">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => switchTemplate(t.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                      activeTemplateId === t.id ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {t.name.replace(/\s*\(.*\)$/, '')}
                  </button>
                ))}
              </div>

              {/* Data-driven editable sections */}
              <div className="space-y-4 pb-8">{sectionRows}</div>
            </section>

            {/* BLOCK B: Communication hub */}
            <section className="flex flex-col h-full lg:sticky lg:top-20">
              <div className="flex items-center justify-between py-2">
                <h2 className="font-headline-sm text-lg font-bold text-slate-800">Communication Hub</h2>
              </div>
              <div className="flex-grow bg-indigo-500/5 border border-indigo-100/50 rounded-2xl p-6 flex flex-col relative overflow-hidden shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="bg-[#2563eb] p-2 rounded-xl text-white shadow-sm">
                      <ClipboardList className="w-5 h-5" />
                    </div>
                    <h3 className="font-bold text-slate-800 text-base">Patient Care Summary</h3>
                    {patientSummaryEmpty && !needsReview && (
                      <span className="text-[10px] text-amber-600 font-bold uppercase tracking-wider bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                        Add letter or regenerate
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCopySummary}
                      className={`flex items-center gap-2 border px-4 h-9 rounded-full font-bold text-xs transition-all active:scale-95 cursor-pointer ${
                        copied ? 'bg-emerald-600 border-transparent text-white' : 'bg-white border-outline-variant hover:shadow-md text-primary'
                      }`}
                    >
                      {copied ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? 'Copied!' : 'Copy Letter'}</span>
                    </button>
                    <button
                      onClick={() => window.print()}
                      className="flex items-center gap-2 border border-outline-variant bg-white hover:shadow-md text-primary px-4 h-9 rounded-full font-bold text-xs transition-all active:scale-95 cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Export PDF</span>
                    </button>
                  </div>
                </div>

                <div className="bg-white rounded-xl p-5 border border-outline-variant/60 shadow-inner flex flex-col flex-grow min-h-[250px] lg:min-h-[350px]">
                  <textarea
                    value={patientLetter}
                    onChange={(e) => setPatientLetter(e.target.value)}
                    className="w-full h-full border-none p-0 focus:ring-0 text-slate-700 text-sm leading-relaxed resize-none bg-transparent outline-none focus:outline-none"
                    placeholder={needsReview
                      ? 'Write the patient letter here (the offline draft could not safely auto-write one).'
                      : 'Drafting care instructions letter...'}
                  />
                </div>

                {needsReview && (
                  <p className="text-[10px] text-amber-700 font-semibold mt-3 leading-relaxed">
                    This note was produced by a fallback path. No ADA codes were auto-inferred and no letter was auto-written — verify every field and add missing content before saving.
                  </p>
                )}

                <div className="mt-5">
                  <button
                    onClick={handleSaveToRecord}
                    type="button"
                    className="w-full bg-[#004ac6] hover:bg-opacity-95 text-white h-14 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all cursor-pointer text-sm"
                  >
                    <Save className="w-5 h-5 fill-white" />
                    <span>{needsReview ? 'Review Complete — Save to Record' : 'Save to Practice Record'}</span>
                  </button>
                </div>
              </div>
            </section>
          </div>
        </main>

        {/* Mobile nav */}
        <nav className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-4 h-20 pb-safe bg-white border-t border-outline-variant md:hidden shadow-lg">
          <button onClick={onBack} className="flex flex-col items-center justify-center text-slate-400 hover:text-primary transition-all p-2 rounded-xl">
            <Menu className="w-6 h-6" />
            <span className="font-label-sm text-[11px] mt-1 font-semibold">History</span>
          </button>
          <button onClick={handleSaveToRecord} className="flex flex-col items-center justify-center text-primary font-bold transition-all p-2 rounded-xl">
            <Save className="w-6 h-6" />
            <span className="font-label-sm text-[11px] mt-1">{needsReview ? 'Save after review' : 'Save'}</span>
          </button>
        </nav>

        {/* Save overlay */}
        <AnimatePresence>
          {showSavedOverlay && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center bg-indigo-950/40 backdrop-blur-sm px-4"
            >
              <motion.div
                initial={{ scale: 0.9, y: 15 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 15 }}
                className="bg-white rounded-2xl p-8 flex flex-col items-center text-center max-w-sm w-full mx-auto shadow-2xl border border-indigo-50"
              >
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-5 animate-bounce">
                  <Check className="text-emerald-600 w-8 h-8 stroke-[3]" />
                </div>
                <h3 className="font-headline-lg text-xl font-bold text-slate-800 mb-1.5 leading-tight">Saved Successfully</h3>
                <p className="text-slate-500 text-sm mb-6 leading-relaxed">
                  Clinical findings and correspondence letter saved to the patient record.
                </p>
                <button
                  type="button"
                  onClick={onBack}
                  className="w-full bg-[#2563eb] hover:bg-opacity-95 text-white font-bold h-12 rounded-xl transition-all shadow-md cursor-pointer"
                >
                  Return to History Hub
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Print-only report */}
      <div className="print-only w-full max-w-4xl mx-auto p-10 font-sans bg-white text-slate-900 border border-slate-200 rounded shadow-sm">
        <div className="flex justify-between items-start border-b-2 border-[#004ac6] pb-4 mb-6">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-[#004ac6]">DentAI</h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mt-0.5">Clinical & Patient Care Copilot</p>
          </div>
          <div className="text-right">
            <h2 className="text-sm font-bold text-slate-800">Dental Practice Record</h2>
            <p className="text-[10px] text-slate-400">Record ID: DENTAI-CONS-{consultation.id}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Provider: {dentistName || 'Dentist'}</p>
          </div>
        </div>

        <div className="mb-6">
          <h3 className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider mb-2 border-b border-slate-100 pb-1">Patient Details</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">Full Name</span>
              <span className="text-xs font-bold text-slate-800">{consultation.firstName} {consultation.lastName}</span>
            </div>
            <div>
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">DOB</span>
              <span className="text-xs font-semibold text-slate-800">{consultation.dob}</span>
            </div>
            <div>
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">Appointment</span>
              <span className="text-xs font-extrabold uppercase tracking-wide text-[#004ac6]">{getAppointmentTypeLabel(consultation.appointmentType)}</span>
            </div>
            <div>
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">Date & Time</span>
              <span className="text-xs font-semibold text-slate-800">{consultation.date} at {consultation.time}</span>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <h3 className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider mb-3 border-b border-slate-100 pb-1">
            Clinical Record — {activeTemplate.name}
          </h3>
          <div className="space-y-4">
            {activeTemplate.sections.map((section) => (
              <div key={section.key} className="border-l-4 border-[#004ac6] pl-3 py-0.5">
                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">{section.label}</span>
                <p className="text-xs text-slate-800 leading-relaxed mt-0.5 whitespace-pre-wrap">{getSectionValue(section.key) || '—'}</p>
              </div>
            ))}
            {adaCodes.length > 0 && (
              <div className="border-l-4 border-slate-300 pl-3 py-0.5">
                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">ADA Billing Item Codes</span>
                <p className="text-xs text-slate-800 mt-0.5 whitespace-pre-wrap">
                  {adaCodes.map((c) => `[${c.code}] ${c.description}${c.tooth ? ` (FDI ${c.tooth})` : ''}`).join('\n')}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="mb-8 font-sans" style={{ pageBreakBefore: 'always' }}>
          <h3 className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider mb-2 border-b border-slate-100 pb-1">Patient Care Summary Letter (en-AU)</h3>
          <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
            <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">{patientLetter || 'No letter prepared for this record.'}</p>
          </div>
        </div>

        <div className="mt-12 flex justify-between items-center border-t border-slate-200 pt-6">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${needsReview ? 'bg-amber-500' : 'bg-emerald-600'}`}></span>
            <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">
              {needsReview ? 'Clinician-reviewed draft' : 'AI Verified Compliance Record'}
            </span>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold text-slate-700">{dentistName || 'Dentist'}</p>
            <p className="text-[9px] text-slate-400 uppercase tracking-widest font-semibold">Registered Dentist</p>
            <div className="w-48 border-b border-slate-300 mt-6 inline-block"></div>
            <p className="text-[8px] text-slate-400 mt-1 uppercase tracking-wide">Signature / Authorization</p>
          </div>
        </div>
      </div>
    </>
  );
}
