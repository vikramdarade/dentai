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
  Tag,
  Stethoscope,
  Sparkles,
  Send,
  AlertCircle,
  DollarSign,
  ChevronRight,
  Printer,
  ShieldCheck,
  Plus,
  Trash2,
  Info,
  Sun,
  Moon
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import {
  Consultation,
  AdaCodeItem,
  ClinicalFindings,
  SpecialistReferral,
  PatientConsentAndCare,
  TreatmentQuoteData,
  TreatmentQuoteItem
} from '../types';
import { motion, AnimatePresence } from 'motion/react';
import {
  NoteTemplate,
  TemplateSection,
  getTemplateById,
  getAppointmentTypeLabel,
  isCanonicalField
} from '../lib/dentalLibrary';
import { getSavedTemplates, getTemplate } from '../utils/templates';
import { buildTreatmentQuoteData } from '../lib/adaFees';
import {
  getVisualCasePresentation,
  detectVisualCaseCategory,
  VisualCaseCategory
} from '../lib/visualCaseLibrary';

interface ClinicalSummaryProps {
  consultation: Consultation;
  onSave: (updatedConsultation: Consultation) => void;
  onBack: () => void;
  dentistName?: string;
}

const ACCENTS = [
  { card: 'bg-[#0E1724] hover:bg-[#121E2E] border-[#1E3048]', label: 'text-cyan-400', chip: 'bg-cyan-950/80 border border-cyan-800 text-cyan-300' },
  { card: 'bg-[#0E1724] hover:bg-[#121E2E] border-[#1E3048]', label: 'text-emerald-400', chip: 'bg-emerald-950/80 border border-emerald-800 text-emerald-300' },
  { card: 'bg-[#0E1724] hover:bg-[#121E2E] border-[#1E3048]', label: 'text-blue-400', chip: 'bg-blue-950/80 border border-blue-800 text-blue-300' },
  { card: 'bg-[#0E1724] hover:bg-[#121E2E] border-[#1E3048]', label: 'text-indigo-400', chip: 'bg-indigo-950/80 border border-indigo-800 text-indigo-300' },
  { card: 'bg-[#0E1724] hover:bg-[#121E2E] border-[#1E3048]', label: 'text-teal-400', chip: 'bg-teal-950/80 border border-teal-800 text-teal-300' },
  { card: 'bg-[#0E1724] hover:bg-[#121E2E] border-[#1E3048]', label: 'text-amber-400', chip: 'bg-amber-950/80 border border-amber-800 text-amber-300' },
  { card: 'bg-[#0E1724] hover:bg-[#121E2E] border-[#1E3048]', label: 'text-violet-400', chip: 'bg-violet-950/80 border border-violet-800 text-violet-300' },
  { card: 'bg-[#0E1724] hover:bg-[#121E2E] border-[#1E3048]', label: 'text-sky-400', chip: 'bg-sky-950/80 border border-sky-800 text-sky-300' }
];

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
  const { theme, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<'clinical' | 'deliverables'>('clinical');
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

  // Deliverables Hub Tab State
  const [activeHubTab, setActiveHubTab] = useState<'patient-care' | 'specialist-referral' | 'treatment-quote'>('patient-care');

  // Document States
  const [patientLetter, setPatientLetter] = useState(consultation.patientSummary || '');
  const [adaCodes, setAdaCodes] = useState<AdaCodeItem[]>(consultation.findings.adaCodes || []);

  // Specialist Referral State
  const [specialistReferral, setSpecialistReferral] = useState<SpecialistReferral>(() => {
    if (consultation.specialistReferral) return consultation.specialistReferral;
    const isEndo = consultation.appointmentType === 'endodontic' || Boolean(consultation.findings?.diagnosis?.toLowerCase().includes('pulpitis'));
    const isSurg = consultation.appointmentType === 'surgical' || Boolean(consultation.findings?.diagnosis?.toLowerCase().includes('impacted'));
    const isPerio = Boolean(consultation.findings?.findingsGingival?.toLowerCase().includes('pocket') || consultation.findings?.diagnosis?.toLowerCase().includes('periodont'));

    const required = isEndo || isSurg || isPerio;
    const specialty = isEndo ? 'Endodontics' : isSurg ? 'Oral & Maxillofacial Surgery' : isPerio ? 'Periodontics' : 'General Referral';

    return {
      required,
      specialty: specialty as any,
      specialistName: '',
      recipientClinic: '',
      teethInvolved: consultation.findings.toothFindings?.match(/\b[1-4][1-8]\b/g) || [],
      urgency: isEndo ? 'Urgent' : 'Routine',
      clinicalQuestion: `Specialist assessment and management for ${consultation.firstName} ${consultation.lastName}`,
      backgroundAndFindings: consultation.findings.diagnosis || consultation.findings.toothFindings || '',
      provisionalDiagnosis: consultation.findings.diagnosis || '',
      interimTreatmentProvided: consultation.findings.treatmentPerformed || '',
      medicalAlerts: consultation.findings.history || 'No significant medical alerts reported',
      letterText: `Dr. Colleague,\n\nRe: ${consultation.firstName} ${consultation.lastName} (DOB: ${consultation.dob})\n\nThank you for seeing this patient regarding specialist assessment. ${consultation.findings.diagnosis ? `Clinical diagnosis: ${consultation.findings.diagnosis}.` : ''} ${consultation.findings.treatmentPerformed ? `Interim therapy provided: ${consultation.findings.treatmentPerformed}.` : ''}\n\nKind regards,\n${dentistName || 'Dentist'} (AHPRA Reg)`
    };
  });

  // Patient Consent & Care State
  const [patientConsent, setPatientConsent] = useState<PatientConsentAndCare>(() => {
    if (consultation.patientConsent) return consultation.patientConsent;
    return {
      plainSummary: consultation.patientSummary || '',
      optionsDiscussed: [],
      risksOfNoTreatment: 'Untreated tooth pathology can spread bacteria into the nerve or jawbone, causing severe pain, infection, or tooth loss requiring extraction.',
      postOpCareInstructions: 'Maintain gentle oral hygiene with a soft brush. Avoid chewing hard or hot foods on the treated side until numbness has completely resolved.',
      redFlagsWarning: 'Contact the clinic immediately if you experience worsening swelling, persistent bleeding, high fever, or severe throbbing pain not relieved by analgesia.',
      consentStatus: 'discussed_pending_signature'
    };
  });

  // Treatment Quote & Visual Pack State
  const [treatmentQuote, setTreatmentQuote] = useState<TreatmentQuoteData>(() => {
    if (consultation.treatmentQuote) return consultation.treatmentQuote;
    const clinicalText = Object.values(consultation.findings || {}).filter((v) => typeof v === 'string').join(' ');
    return buildTreatmentQuoteData(consultation.findings.adaCodes || [], consultation.proposedTreatments || [], clinicalText);
  });

  const [selectedVisualCategory, setSelectedVisualCategory] = useState<VisualCaseCategory>(() => {
    return treatmentQuote.visualCaseCategory || detectVisualCaseCategory(consultation.findings.adaCodes || []);
  });

  // Copy & Action Feedback States
  const [copied, setCopied] = useState(false);
  const [referralCopied, setReferralCopied] = useState(false);
  const [quoteCopied, setQuoteCopied] = useState(false);
  const [pmsCopied, setPmsCopied] = useState(false);
  const [adaCopied, setAdaCopied] = useState(false);
  const [showSavedOverlay, setShowSavedOverlay] = useState(false);

  const [rebateMode, setRebateMode] = useState<'practice_fees_only' | 'show_rebate_estimate'>(() => {
    return treatmentQuote.rebateMode || 'practice_fees_only';
  });

  const formatItemTitle = (item: { description: string; tooth?: string }) =>
    `${item.description}${item.tooth ? ` (Tooth ${item.tooth})` : ''}`;

  const sumFees = (items: TreatmentQuoteItem[]) =>
    items.reduce((sum, it) => sum + (Number(it.fee) || 0), 0);

  const recalculateQuote = (
    items: TreatmentQuoteItem[],
    mode: 'practice_fees_only' | 'show_rebate_estimate' = rebateMode
  ) => {
    const totalFee = sumFees(items);
    const estimatedRebate = mode === 'practice_fees_only'
      ? 0
      : items.reduce((sum, it) => sum + (Number(it.healthFundEstimatedRebate) || 0), 0);
    const netGap = Math.max(0, totalFee - estimatedRebate);

    const urgent = items.filter((i) => i.category === 'Endodontics' || i.category === 'Surgery');
    const restorative = items.filter(
      (i) => i.category === 'Crown & Bridge' || i.category === 'Restorative' || i.category === 'Periodontics'
    );
    const preventive = items.filter(
      (i) => i.category === 'Diagnostic' || i.category === 'Preventive' || i.category === 'Orthodontics'
    );

    const phasedMilestones: NonNullable<TreatmentQuoteData['phasedMilestones']> = [];
    let phaseNum = 1;

    const addMilestone = (title: string, phaseItems: TreatmentQuoteItem[]) => {
      phasedMilestones.push({
        phaseNumber: phaseNum++,
        phaseTitle: title,
        items: phaseItems.map(formatItemTitle),
        totalPhaseFee: sumFees(phaseItems)
      });
    };

    if (urgent.length > 0) {
      addMilestone('Phase 1: Urgent Relief & Stabilisation', urgent);
    }

    if (restorative.length > 0) {
      addMilestone(`Phase ${phaseNum}: Restorative Reconstruction & Longevity`, restorative);
    }

    if (preventive.length > 0 || phasedMilestones.length === 0) {
      addMilestone(`Phase ${phaseNum}: Prevention & Maintenance`, preventive.length > 0 ? preventive : items);
    }

    const updated: TreatmentQuoteData = {
      ...treatmentQuote,
      items,
      totalFee,
      estimatedRebate,
      netGap,
      rebateMode: mode,
      phasedMilestones
    };
    setTreatmentQuote(updated);
    return updated;
  };

  const handleUpdateQuoteItem = (index: number, patch: Partial<TreatmentQuoteItem>) => {
    const nextItems = treatmentQuote.items.map((item, idx) => {
      if (idx !== index) return item;
      const updated = { ...item, ...patch };
      const fee = Number(updated.fee) || 0;
      const rebate = Number(updated.healthFundEstimatedRebate) || 0;
      updated.gapEstimate = Math.max(0, fee - rebate);
      return updated;
    });
    recalculateQuote(nextItems);
  };

  const handleAddQuoteItem = () => {
    const newItem: TreatmentQuoteItem = {
      adaCode: '022',
      description: 'Intraoral periapical radiograph',
      tooth: '',
      fee: 45,
      healthFundEstimatedRebate: 35,
      gapEstimate: 10,
      category: 'Diagnostic'
    };
    recalculateQuote([...treatmentQuote.items, newItem]);
  };

  const handleDeleteQuoteItem = (index: number) => {
    if (treatmentQuote.items.length <= 1) {
      alert('A quote must contain at least one procedure item.');
      return;
    }
    const nextItems = treatmentQuote.items.filter((_, idx) => idx !== index);
    recalculateQuote(nextItems);
  };

  const needsReview = !!consultation.noteOrigin?.needsReview;
  const originEngine = consultation.noteOrigin?.engine || 'gemini';

  const switchTemplate = (templateId: string) => {
    const next = templates.find((t) => t.id === templateId) || getTemplateById(templateId);
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
    const textToCopy = patientConsent.plainSummary || patientLetter;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyReferral = () => {
    navigator.clipboard.writeText(specialistReferral.letterText);
    setReferralCopied(true);
    setTimeout(() => setReferralCopied(false), 2000);
  };

  const handleCopyAdaCodesOnly = () => {
    const lines = adaCodes.map(
      (code) => `[${code.code}] ${code.description}${code.tooth ? ` (Tooth FDI ${code.tooth})` : ''}`
    );
    navigator.clipboard.writeText(lines.join('\n'));
    setAdaCopied(true);
    setTimeout(() => setAdaCopied(false), 2000);
  };

  const handleCopyQuote = () => {
    const isFeesOnly = rebateMode === 'practice_fees_only';
    const lines = [
      `=== TREATMENT ESTIMATE & ITEMISED QUOTE ===`,
      `PATIENT: ${consultation.firstName} ${consultation.lastName}`,
      `DATE: ${consultation.date}`,
      ``,
      ...treatmentQuote.items.map((it) => {
        const itemHeader = `ADA [${it.adaCode}] ${formatItemTitle(it)}`;
        return isFeesOnly
          ? `${itemHeader} - Practice Fee: $${it.fee} | Rebate: Check with health fund`
          : `${itemHeader} - Fee: $${it.fee} | Est. Rebate: $${it.healthFundEstimatedRebate} | Net Gap: $${it.gapEstimate}`;
      }),
      ``,
      `Total Practice Fee: $${treatmentQuote.totalFee}`,
      isFeesOnly
        ? `Health Fund Coverage: Private health insurance rebates depend on your individual fund table, waiting periods, and annual limits already used this year. Quote item numbers above to your insurer for your exact benefit.`
        : `Estimated Health Fund Coverage: $${treatmentQuote.estimatedRebate}\nNet Out-of-Pocket Gap: $${treatmentQuote.netGap}\n*Note: Rebate amounts are estimates only and depend on your health fund table, waiting periods, and remaining annual limits.`
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    setQuoteCopied(true);
    setTimeout(() => setQuoteCopied(false), 2000);
  };

  // One-click copy for PMS: Progress notes ONLY (ADA codes excluded per Australian practice workflow)
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
      patientSummary: patientLetter,
      specialistReferral,
      patientConsent,
      treatmentQuote: {
        ...treatmentQuote,
        visualCaseCategory: selectedVisualCategory,
        rebateMode
      }
    };

    onSave(updatedConsultation);
    setShowSavedOverlay(true);
  };

  const activeVisualPresentation = getVisualCasePresentation(selectedVisualCategory);

  const sectionRows = activeTemplate.sections.map((section, idx) => {
    const accent = ACCENTS[idx % ACCENTS.length];
    const isRecall = section.key === 'recallRequirements';
    const current = getSectionValue(section.key);
    const rowCount = section.key === 'chiefComplaint' || section.key === 'subjective' ? 3 : 4;

    return (
      <div
        key={section.key}
        className={`p-1 rounded-2xl transition-all duration-300 shadow-sm border focus-within:ring-1 focus-within:ring-cyan-400/40 ${accent.card}`}
      >
        <div className="bg-[#0A1018] border border-[#1E3048]/60 rounded-[calc(1rem-0.25rem)] p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`w-5 h-5 rounded-md font-mono font-bold text-[10px] flex items-center justify-center ${accent.chip}`}>
              {idx + 1}
            </span>
            <label className={`font-mono font-bold text-[11px] uppercase tracking-wider ${accent.label}`}>
              {section.label}
            </label>
          </div>
          {isRecall ? (
            <div className="flex flex-col md:flex-row md:items-center gap-3 pt-1">
              <select
                value={current}
                onChange={(e) => updateEdit(section.key, e.target.value)}
                className="bg-[#0E1724] border border-[#1E3048] text-xs font-mono font-bold rounded-xl px-3 py-2 outline-none focus:border-cyan-400 text-slate-200 cursor-pointer"
              >
                <option value="" className="bg-[#0A1018] text-slate-500">Select recall interval…</option>
                {RECALL_OPTIONS.map((option) => (
                  <option key={option} value={option} className="bg-[#0A1018] text-slate-200">{option}</option>
                ))}
              </select>
              <span className="font-mono text-xs text-slate-500">
                Recommended recall / next appointment based on today's visit.
              </span>
            </div>
          ) : (
            <textarea
              rows={rowCount}
              value={current}
              onChange={(e) => updateEdit(section.key, e.target.value)}
              placeholder={section.placeholder}
              className="w-full border-none p-0 focus:ring-0 text-slate-200 placeholder:text-slate-600 text-sm resize-none bg-transparent outline-none leading-relaxed font-sans"
            />
          )}
        </div>
      </div>
    );
  });

  return (
    <>
      <div id="clinical-summary-container" className="min-h-screen bg-[#070B11] pb-24 text-slate-100 no-print">
        {/* Top App Bar */}
        <header className="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-4 md:px-8 h-16 bg-[#0A1018]/90 backdrop-blur-md border-b border-[#1E3048]">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-2 -ml-2 rounded-xl hover:bg-[#152338] text-slate-400 hover:text-white transition-colors cursor-pointer">
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-1.5">
                Dent<span className="text-cyan-400">AI</span>
              </h1>
              <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/60 text-cyan-300">
                Clinical &amp; Growth OS
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:flex flex-col items-end">
              <span className="font-semibold text-sm text-slate-200">{dentistName || 'Dentist'}</span>
              <span className="font-mono text-[10px] text-cyan-400 font-bold uppercase tracking-widest leading-none mt-0.5">
                {getAppointmentTypeLabel(consultation.appointmentType)}
              </span>
            </div>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-xl text-slate-400 hover:text-amber-300 bg-[#0E1724] border border-[#1E3048] transition-colors cursor-pointer flex items-center justify-center"
              title={theme === 'dark' ? 'Switch to Clinical Light Mode' : 'Switch to Dark Cockpit Mode'}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-cyan-600" />
              )}
            </button>
            <button className="p-1 rounded-xl text-slate-400 hover:text-white transition-all">
              <User className="w-5 h-5 text-cyan-400" />
            </button>
          </div>
        </header>

        <main className="pt-20 px-4 max-w-[1520px] mx-auto">
          {/* Patient banner */}
          <div className="bg-[#0A1018] border border-[#1E3048] rounded-2xl p-5 mb-6 shadow-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-cyan-950/80 text-cyan-300 flex items-center justify-center font-mono font-bold text-lg border border-cyan-800 shadow-inner">
                {consultation.firstName[0] || ''}{consultation.lastName[0] || ''}
              </div>
              <div className="flex flex-col">
                <div className="flex items-center flex-wrap gap-2">
                  <h2 className="text-lg font-bold text-white leading-tight">
                    {consultation.firstName} {consultation.lastName}
                  </h2>
                  <span className="px-2.5 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider bg-[#0E1724] text-cyan-400 border border-[#1E3048]">
                    {getAppointmentTypeLabel(consultation.appointmentType)}
                  </span>
                  {needsReview ? (
                    <span className="px-2.5 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider bg-amber-950/60 text-amber-300 border border-amber-800/60 flex items-center gap-1">
                      <ShieldAlert className="w-3 h-3 text-amber-400" /> Draft — verify
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3 text-emerald-400" /> AHPRA Verified
                    </span>
                  )}
                  {specialistReferral.required && (
                     <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider bg-purple-950/60 text-purple-300 border border-purple-800/60 flex items-center gap-1">
                       <Send className="w-2.5 h-2.5 text-purple-400" /> Referral Indicated
                     </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 font-medium mt-1">
                  DOB: <span className="font-mono font-semibold text-slate-200">{consultation.dob}</span> &bull; Status:{' '}
                  <span className={`font-semibold ${consultation.status === 'Completed' ? 'text-emerald-400' : 'text-cyan-400'}`}>{consultation.status}</span>
                  {originEngine !== 'gemini' && (
                    <> &bull; <span className="text-amber-400 font-mono font-semibold">Generated via {originEngine === 'on-device' ? 'on-device model' : 'offline draft'}</span></>
                  )}
                </p>
              </div>
            </div>
            <div className="flex sm:flex-col items-start sm:items-end text-xs font-mono text-slate-500 gap-x-4 gap-y-0.5 flex-wrap border-t sm:border-t-0 pt-3 sm:pt-0 border-[#1E3048]">
              <div>Consultation: <span className="font-semibold text-slate-300">{consultation.date} · {consultation.time}</span></div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            {/* BLOCK A: Clinical Findings & Notes (Left Column - 5 Cols) */}
            <section className="xl:col-span-5 flex flex-col gap-4">
              <div className="flex items-center justify-between py-2 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-white tracking-tight">Clinical Record</h2>
                  <span className="px-2.5 py-0.5 rounded-md bg-cyan-950/60 text-cyan-300 border border-cyan-800/60 font-mono font-semibold text-[11px]">
                    {activeTemplate.name}
                  </span>
                </div>
                <button
                  onClick={handleCopyPmsNote}
                  title="Copy the note formatted for Dental4Windows, Core Practice, or Exact"
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-mono font-bold text-xs transition-all active:scale-95 shadow-sm cursor-pointer ${
                    pmsCopied
                      ? 'bg-emerald-500 text-slate-950 shadow-[0_0_12px_rgba(52,211,153,0.3)]'
                      : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 shadow-[0_0_15px_rgba(34,211,238,0.25)]'
                  }`}
                >
                  {pmsCopied ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{pmsCopied ? 'Copied for PMS!' : '1-Click Copy for PMS'}</span>
                </button>
              </div>

              {/* ADA billing codes */}
              {adaCodes.length > 0 && (
                <div className="p-4 bg-[#0A1018] text-white rounded-2xl shadow-xl border border-[#1E3048] flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Tag className="w-4 h-4 text-cyan-400" />
                      <span className="font-mono text-xs font-bold uppercase tracking-wider text-slate-200">ADA Billing Codes</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCopyAdaCodesOnly}
                        title="Copy item numbers for PMS ledger / invoice entry"
                        className="flex items-center gap-1 text-[10px] text-cyan-300 hover:text-white font-mono font-bold bg-[#0E1724] hover:bg-[#152338] px-2.5 py-1 rounded-lg border border-[#1E3048] transition-all cursor-pointer"
                      >
                        {adaCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-cyan-400" />}
                        <span>{adaCopied ? 'Codes Copied!' : 'Copy Billing Codes'}</span>
                      </button>
                      <span className="text-[10px] bg-[#0E1724] text-slate-400 px-2 py-0.5 rounded-full font-mono font-semibold border border-[#1E3048]">
                        {adaCodes.length} {adaCodes.length === 1 ? 'Item' : 'Items'}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {adaCodes.map((item, idx) => (
                      <div key={idx} className="bg-[#0E1724] border border-[#1E3048] text-white px-3 py-1 rounded-xl flex items-center gap-2 text-xs">
                        <span className="font-mono font-extrabold text-cyan-400 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-800/60">
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
              <div className="flex items-center gap-1.5 p-1 bg-[#0A1018] rounded-xl w-fit border border-[#1E3048] overflow-x-auto max-w-full">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => switchTemplate(t.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer whitespace-nowrap ${
                      activeTemplateId === t.id
                        ? 'bg-cyan-500/20 border border-cyan-400/60 text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t.name.replace(/\s*\(.*\)$/, '')}
                  </button>
                ))}
              </div>

              {/* Data-driven editable sections */}
              <div className="space-y-4 pb-8">{sectionRows}</div>
            </section>

            {/* BLOCK B: Clinical & Patient Deliverables Suite (Right Column - 7 Cols) */}
            <section className="xl:col-span-7 flex flex-col gap-4">
              {/* Deliverables Suite Header & Tab Navigator */}
              <div className="bg-[#0A1018] border border-[#1E3048] rounded-2xl p-3 shadow-md flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-cyan-950/80 border border-cyan-800/60 text-cyan-400">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-white tracking-tight">Chairside Deliverables Suite</h2>
                    <p className="text-[11px] font-mono text-slate-400">Zero-edit clinical outputs generated from audio</p>
                  </div>
                </div>

                {/* 3 Core Output Tabs */}
                <div className="flex items-center p-1 bg-[#0E1724] rounded-xl border border-[#1E3048] overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => setActiveHubTab('patient-care')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer whitespace-nowrap ${
                      activeHubTab === 'patient-care'
                        ? 'bg-[#121E2E] border border-cyan-500/40 text-cyan-300 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <ClipboardList className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Patient Care &amp; Consent</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveHubTab('specialist-referral')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer whitespace-nowrap ${
                      activeHubTab === 'specialist-referral'
                        ? 'bg-[#121E2E] border border-purple-500/40 text-purple-300 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Stethoscope className="w-3.5 h-3.5 text-purple-400" />
                    <span>Specialist Referral</span>
                    {specialistReferral.required && (
                      <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse"></span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveHubTab('treatment-quote')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer whitespace-nowrap ${
                      activeHubTab === 'treatment-quote'
                        ? 'bg-[#121E2E] border border-emerald-500/40 text-emerald-300 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Case Pack &amp; Quote</span>
                  </button>
                </div>
              </div>

              {/* TAB 1: Patient Care Summary & Informed Consent */}
              {activeHubTab === 'patient-care' && (
                <div className="bg-[#0E1724] border border-[#1E3048] rounded-2xl p-6 flex flex-col gap-5 shadow-2xl">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <h3 className="font-bold text-white text-base flex items-center gap-2 font-mono">
                        <span>Patient Care Summary &amp; Informed Consent</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 px-2 py-0.5 rounded-full font-mono">
                          en-AU
                        </span>
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5 font-mono">
                        Plain-English visit review with AHPRA Section 133 informed consent breakdown.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleCopySummary}
                        className={`flex items-center gap-2 border px-4 h-9 rounded-full font-bold text-xs transition-all active:scale-95 cursor-pointer font-mono ${
                          copied
                            ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                            : 'bg-[#0A1018] border-[#1E3048] hover:border-cyan-500/50 text-slate-200'
                        }`}
                      >
                        {copied ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copied ? 'Copied!' : 'Copy Letter'}</span>
                      </button>
                      <button
                        onClick={() => window.print()}
                        className="flex items-center gap-2 border border-[#1E3048] bg-[#0A1018] hover:border-cyan-500/50 text-slate-200 px-4 h-9 rounded-full font-bold text-xs transition-all active:scale-95 cursor-pointer font-mono"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Export PDF</span>
                      </button>
                    </div>
                  </div>

                  {/* Visit Summary Box */}
                  <div className="bg-[#0A1018] rounded-xl p-4 border border-[#1E3048]">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1 font-mono">
                      Clinical Visit Explanation
                    </label>
                    <textarea
                      rows={4}
                      value={patientLetter}
                      onChange={(e) => {
                        setPatientLetter(e.target.value);
                        setPatientConsent((prev) => ({ ...prev, plainSummary: e.target.value }));
                      }}
                      className="w-full border-none p-0 focus:ring-0 text-slate-200 text-sm leading-relaxed resize-none bg-transparent outline-none"
                      placeholder="Plain-English explanation of today's visit and recommendations..."
                    />
                  </div>

                  {/* Informed Consent Guardrails */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                        <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300 font-mono">Risks of No Treatment</span>
                      </div>
                      <textarea
                        rows={3}
                        value={patientConsent.risksOfNoTreatment}
                        onChange={(e) => setPatientConsent((prev) => ({ ...prev, risksOfNoTreatment: e.target.value }))}
                        className="w-full text-xs text-amber-200 bg-transparent border-none p-0 outline-none resize-none leading-relaxed"
                      />
                    </div>

                    <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-300 font-mono">Post-Op Care Instructions</span>
                      </div>
                      <textarea
                        rows={3}
                        value={patientConsent.postOpCareInstructions}
                        onChange={(e) => setPatientConsent((prev) => ({ ...prev, postOpCareInstructions: e.target.value }))}
                        className="w-full text-xs text-emerald-200 bg-transparent border-none p-0 outline-none resize-none leading-relaxed"
                      />
                    </div>
                  </div>

                  {/* Red-Flag Warning Box */}
                  <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-grow">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-rose-300 block mb-0.5 font-mono">
                        Red-Flag Warning Signs (Call Practice Immediately)
                      </span>
                      <textarea
                        rows={2}
                        value={patientConsent.redFlagsWarning}
                        onChange={(e) => setPatientConsent((prev) => ({ ...prev, redFlagsWarning: e.target.value }))}
                        className="w-full text-xs text-rose-200 bg-transparent border-none p-0 outline-none resize-none leading-relaxed"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: Specialist Referral Letter */}
              {activeHubTab === 'specialist-referral' && (
                <div className="bg-[#0E1724] border border-[#1E3048] rounded-2xl p-6 flex flex-col gap-5 shadow-2xl">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-white text-base font-mono">Specialist Referral Letter</h3>
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-purple-500/10 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded-full font-mono">
                          {specialistReferral.specialty}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 font-mono">
                        Formal peer-to-peer referral letter ready for specialist dispatch.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleCopyReferral}
                        className={`flex items-center gap-2 border px-4 h-9 rounded-full font-bold text-xs transition-all active:scale-95 cursor-pointer font-mono ${
                          referralCopied
                            ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                            : 'bg-[#0A1018] border-[#1E3048] hover:border-cyan-500/50 text-slate-200'
                        }`}
                      >
                        {referralCopied ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{referralCopied ? 'Copied!' : 'Copy Referral'}</span>
                      </button>
                      <button
                        onClick={() => window.print()}
                        className="flex items-center gap-2 border border-[#1E3048] bg-[#0A1018] hover:border-cyan-500/50 text-slate-200 px-4 h-9 rounded-full font-bold text-xs transition-all active:scale-95 cursor-pointer font-mono"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Print Referral</span>
                      </button>
                    </div>
                  </div>

                  {/* Referral Metadata Controls */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-[#0A1018] p-3.5 rounded-xl border border-[#1E3048]">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1 font-mono">
                        Specialty
                      </label>
                      <select
                        value={specialistReferral.specialty}
                        onChange={(e) => setSpecialistReferral((prev) => ({ ...prev, specialty: e.target.value as any }))}
                        className="w-full bg-[#070B11] border border-[#1E3048] text-xs font-semibold rounded-lg px-2.5 py-1.5 text-slate-200 focus:border-cyan-500/60 outline-none"
                      >
                        <option value="Endodontics">Endodontics</option>
                        <option value="Periodontics">Periodontics</option>
                        <option value="Oral &amp; Maxillofacial Surgery">Oral &amp; Maxillofacial Surgery</option>
                        <option value="Orthodontics">Orthodontics</option>
                        <option value="Prosthodontics">Prosthodontics</option>
                        <option value="Paediatric Dentistry">Paediatric Dentistry</option>
                        <option value="General Referral">General Referral</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1 font-mono">
                        Urgency Level
                      </label>
                      <select
                        value={specialistReferral.urgency}
                        onChange={(e) => setSpecialistReferral((prev) => ({ ...prev, urgency: e.target.value as any }))}
                        className="w-full bg-[#070B11] border border-[#1E3048] text-xs font-semibold rounded-lg px-2.5 py-1.5 text-slate-200 focus:border-cyan-500/60 outline-none"
                      >
                        <option value="Routine">Routine (Within 4-6 weeks)</option>
                        <option value="Urgent">Urgent (Within 1-2 weeks)</option>
                        <option value="Immediate (Emergency)">Immediate (Emergency / 24-48h)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1 font-mono">
                        Teeth (FDI)
                      </label>
                      <input
                        type="text"
                        value={specialistReferral.teethInvolved?.join(', ') || ''}
                        onChange={(e) =>
                          setSpecialistReferral((prev) => ({
                            ...prev,
                            teethInvolved: e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                          }))
                        }
                        placeholder="e.g. 16, 46"
                        className="w-full bg-[#070B11] border border-[#1E3048] text-xs font-semibold rounded-lg px-2.5 py-1.5 text-slate-200 focus:border-cyan-500/60 outline-none font-mono"
                      />
                    </div>
                  </div>

                  {/* Formal Letterhead Preview */}
                  <div className="p-5 rounded-xl border border-purple-500/30 bg-[#070B11] font-mono text-xs text-slate-200 leading-relaxed shadow-inner">
                    <textarea
                      rows={12}
                      value={specialistReferral.letterText}
                      onChange={(e) => setSpecialistReferral((prev) => ({ ...prev, letterText: e.target.value }))}
                      className="w-full bg-transparent border-none p-0 outline-none resize-none font-mono text-xs text-slate-200 leading-relaxed"
                    />
                  </div>
                </div>
              )}

              {/* TAB 3: Visual Case Pack & Treatment Quote ("CoTreat Pack" Equivalent) */}
              {activeHubTab === 'treatment-quote' && (
                <div className="bg-[#0E1724] border border-[#1E3048] rounded-2xl p-6 flex flex-col gap-6 shadow-2xl">
                  {/* Header & Visual Category Selector */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-white text-base font-mono">Visual Case Pack &amp; Quote</h3>
                        <span className="text-[10px] font-extrabold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-mono">
                          Patient Acceptance Deck
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 font-mono">
                        High-impact anatomical visualizer and itemized health fund gap breakdown.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleCopyQuote}
                        className={`flex items-center gap-2 border px-4 h-9 rounded-full font-bold text-xs transition-all active:scale-95 cursor-pointer font-mono ${
                          quoteCopied
                            ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                            : 'bg-[#0A1018] border-[#1E3048] hover:border-cyan-500/50 text-slate-200'
                        }`}
                      >
                        {quoteCopied ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{quoteCopied ? 'Copied!' : 'Copy Quote'}</span>
                      </button>
                      <button
                        onClick={() => window.print()}
                        className="flex items-center gap-2 border border-[#1E3048] bg-[#0A1018] hover:border-cyan-500/50 text-slate-200 px-4 h-9 rounded-full font-bold text-xs transition-all active:scale-95 cursor-pointer font-mono"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Print Case Pack</span>
                      </button>
                    </div>
                  </div>

                  {/* Procedure Visual Mode Selector */}
                  <div className="flex items-center gap-1.5 p-1 bg-[#0A1018] rounded-xl w-full overflow-x-auto border border-[#1E3048] shadow-inner">
                    {[
                      { id: 'crown', label: 'Ceramic Crown' },
                      { id: 'implant', label: 'Dental Implant' },
                      { id: 'endo', label: 'Root Canal' },
                      { id: 'veneer', label: 'Porcelain Veneers' },
                      { id: 'aligner', label: 'Clear Aligners' },
                      { id: 'perio', label: 'Deep Gum Therapy' },
                      { id: 'general', label: 'General / Preventive' }
                    ].map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setSelectedVisualCategory(cat.id as VisualCaseCategory)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap active:scale-[0.98] font-mono ${
                          selectedVisualCategory === cat.id
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-[#1E3048]/50'
                        }`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>

                  {/* Visual 3-Stage Case Cards (The Visualizer that wows patients) */}
                  <div className="bg-gradient-to-b from-[#0A1018] via-[#0E1724] to-[#0A1018] border border-[#1E3048] rounded-2xl p-5 flex flex-col gap-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-bold text-sm text-white font-mono">{activeVisualPresentation.treatmentName}</h4>
                        <p className="text-xs text-slate-400 font-mono">{activeVisualPresentation.tagline}</p>
                      </div>
                      <span className="text-[10px] font-mono font-bold bg-[#070B11] text-cyan-400 border border-cyan-500/30 px-2.5 py-1 rounded-full">
                        ADA {activeVisualPresentation.typicalAdaCodes.join(', ')}
                      </span>
                    </div>

                    {/* 3-Stage Visual Progression Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                      {activeVisualPresentation.stages.map((stage) => {
                        const stageBadgeStyle =
                          stage.step === 1
                            ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
                            : stage.step === 2
                            ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30'
                            : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';

                        return (
                          <div
                            key={stage.step}
                            className="group relative bg-[#070B11] rounded-2xl border border-[#1E3048] p-4 flex flex-col hover:border-cyan-500/40 transition-all duration-200 shadow-inner"
                          >
                            <div className="flex items-center justify-between mb-2.5">
                              <span className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full border font-mono ${stageBadgeStyle}`}>
                                Stage {stage.step}: {stage.badge}
                              </span>
                            </div>
                            {/* SVG Visual Graphic */}
                            <div
                              className="w-full h-32 mb-3 rounded-xl overflow-hidden flex items-center justify-center bg-[#0A1018] border border-[#1E3048] group-hover:scale-[1.02] transition-transform duration-300"
                              dangerouslySetInnerHTML={{ __html: stage.illustrationSvg }}
                            />
                            <h5 className="font-bold text-xs text-white font-mono">{stage.title}</h5>
                            <p className="text-[11px] text-slate-400 leading-relaxed mt-1 flex-grow font-mono">
                              {stage.description}
                            </p>
                          </div>
                        );
                      })}
                    </div>

                    {/* Value Proposition & Anatomy Highlights */}
                    <div className="p-3.5 bg-[#070B11] rounded-xl border border-[#1E3048] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                      <div className="text-slate-300 font-mono">
                        <strong className="text-white font-mono">Patient Outcome:</strong> {activeVisualPresentation.patientValueProposition}
                      </div>
                    </div>
                  </div>

                  {/* Health Fund Presentation Mode & Risk Disclaimer */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-[#0A1018] border border-[#1E3048] rounded-xl">
                    <div className="flex items-center gap-2.5">
                      <ShieldCheck className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                      <div>
                        <span className="text-xs font-bold text-white font-mono">Health Fund Rebate Mode</span>
                        <p className="text-[11px] text-slate-400 font-mono">
                          {rebateMode === 'practice_fees_only'
                            ? 'Displaying practice fees only. Advises patient to verify rebates with their insurer.'
                            : 'Displaying estimated rebates. Subject to patient annual policy limits.'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 p-1 bg-[#070B11] rounded-xl border border-[#1E3048] shadow-inner self-start sm:self-auto">
                      <button
                        type="button"
                        onClick={() => {
                          setRebateMode('practice_fees_only');
                          recalculateQuote(treatmentQuote.items, 'practice_fees_only');
                        }}
                        className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer active:scale-[0.98] font-mono ${
                          rebateMode === 'practice_fees_only'
                            ? 'bg-[#1E3048] text-white border border-slate-600'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Practice Fees Only (Safe)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRebateMode('show_rebate_estimate');
                          recalculateQuote(treatmentQuote.items, 'show_rebate_estimate');
                        }}
                        className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer active:scale-[0.98] font-mono ${
                          rebateMode === 'show_rebate_estimate'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Show Est. Rebate
                      </button>
                    </div>
                  </div>

                  {/* Patient Advisory Notice for Insurance Limits */}
                  <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-amber-950/20 border border-amber-500/30 text-amber-300 text-xs shadow-sm font-mono">
                    <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="leading-relaxed">
                      <strong className="font-semibold text-amber-200">Private Health Insurance Notice:</strong> Rebate amounts depend on your private health fund table of cover, waiting periods, and any annual limits you have already used this year (especially on Major Dental). Please quote the ADA item numbers below directly to your health fund to verify your exact rebate and out-of-pocket gap prior to treatment.
                    </div>
                  </div>

                  {/* Financial Overview Metrics Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                    <div className="bg-[#0A1018] p-4 rounded-2xl border border-[#1E3048] shadow-sm text-center">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block font-mono">Total Treatment Fee</span>
                      <span className="font-mono text-2xl font-black text-white mt-1 block">${treatmentQuote.totalFee}</span>
                    </div>
                    <div className="bg-emerald-950/20 p-4 rounded-2xl border border-emerald-500/30 shadow-sm text-center">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 block font-mono">
                        {rebateMode === 'practice_fees_only' ? 'Health Fund Rebate' : 'Est. Health Fund Rebate'}
                      </span>
                      <span className="font-mono text-base font-extrabold text-emerald-300 mt-1.5 block">
                        {rebateMode === 'practice_fees_only'
                          ? 'Claim Directly with Fund'
                          : `-$${treatmentQuote.estimatedRebate}`}
                      </span>
                    </div>
                    <div className="bg-cyan-950/20 p-4 rounded-2xl border border-cyan-500/30 shadow-sm text-center">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400 block font-mono">
                        {rebateMode === 'practice_fees_only' ? 'Out-of-Pocket Gap' : 'Est. Patient Gap'}
                      </span>
                      <span className="font-mono text-2xl font-black text-cyan-300 mt-1 block">
                        {rebateMode === 'practice_fees_only'
                          ? `$${treatmentQuote.totalFee} (Less Rebate)`
                          : `$${treatmentQuote.netGap}`}
                      </span>
                    </div>
                  </div>

                  {/* Editable Itemized ADA Fee Schedule Table */}
                  <div className="border border-[#1E3048] rounded-xl overflow-hidden shadow-sm bg-[#0A1018]">
                    <div className="p-3 bg-[#070B11] border-b border-[#1E3048] flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 font-mono">
                        Itemized Procedure Quote (Clinician Editable)
                      </span>
                      <button
                        type="button"
                        onClick={handleAddQuoteItem}
                        className="flex items-center gap-1 text-[11px] font-bold text-cyan-400 hover:text-cyan-300 bg-[#0E1724] hover:bg-[#1E3048] border border-[#1E3048] px-2.5 py-1 rounded-lg transition-all cursor-pointer shadow-sm font-mono"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Procedure Item</span>
                      </button>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse font-mono">
                        <thead>
                          <tr className="bg-[#070B11] text-slate-400 font-bold border-b border-[#1E3048] text-[10px] uppercase tracking-wider">
                            <th className="p-2.5 w-24">ADA Code</th>
                            <th className="p-2.5">Procedure Description</th>
                            <th className="p-2.5 w-20 text-center">Tooth</th>
                            <th className="p-2.5 w-28 text-right">Fee ($)</th>
                            <th className="p-2.5 w-36 text-right">
                              {rebateMode === 'practice_fees_only' ? 'Rebate Status' : 'Est. Rebate ($)'}
                            </th>
                            <th className="p-2.5 w-28 text-right">Net Gap</th>
                            <th className="p-2.5 w-12 text-center"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#1E3048]">
                          {treatmentQuote.items.map((item, idx) => (
                            <tr key={idx} className="hover:bg-[#0E1724]/60 transition-colors">
                              <td className="p-2.5 font-mono">
                                <input
                                  type="text"
                                  value={item.adaCode}
                                  onChange={(e) => handleUpdateQuoteItem(idx, { adaCode: e.target.value })}
                                  placeholder="ADA"
                                  className="w-20 px-2 py-1 bg-[#070B11] border border-[#1E3048] rounded font-mono font-bold text-xs text-cyan-300 focus:border-cyan-500/60 outline-none"
                                />
                              </td>
                              <td className="p-2.5">
                                <input
                                  type="text"
                                  value={item.description}
                                  onChange={(e) => handleUpdateQuoteItem(idx, { description: e.target.value })}
                                  placeholder="Procedure description..."
                                  className="w-full px-2 py-1 bg-[#070B11] border border-[#1E3048] rounded text-xs text-slate-200 font-medium focus:border-cyan-500/60 outline-none"
                                />
                              </td>
                              <td className="p-2.5 text-center">
                                <input
                                  type="text"
                                  value={item.tooth || ''}
                                  onChange={(e) => handleUpdateQuoteItem(idx, { tooth: e.target.value })}
                                  placeholder="—"
                                  className="w-14 px-1.5 py-1 bg-[#070B11] border border-[#1E3048] rounded text-xs text-center font-bold text-amber-400 focus:border-cyan-500/60 outline-none font-mono"
                                />
                              </td>
                              <td className="p-2.5 text-right">
                                <input
                                  type="number"
                                  min="0"
                                  step="5"
                                  value={item.fee}
                                  onChange={(e) => handleUpdateQuoteItem(idx, { fee: Math.max(0, Number(e.target.value) || 0) })}
                                  className="w-24 px-2 py-1 bg-[#070B11] border border-[#1E3048] rounded text-xs font-semibold text-slate-200 text-right focus:border-cyan-500/60 outline-none font-mono"
                                />
                              </td>
                              <td className="p-2.5 text-right">
                                {rebateMode === 'practice_fees_only' ? (
                                  <span className="text-[11px] text-slate-400 font-medium italic font-mono">
                                    Check with fund
                                  </span>
                                ) : (
                                  <input
                                    type="number"
                                    min="0"
                                    step="5"
                                    value={item.healthFundEstimatedRebate}
                                    onChange={(e) => handleUpdateQuoteItem(idx, { healthFundEstimatedRebate: Math.max(0, Number(e.target.value) || 0) })}
                                    className="w-24 px-2 py-1 bg-[#070B11] border border-[#1E3048] rounded text-xs font-semibold text-emerald-400 text-right focus:border-cyan-500/60 outline-none font-mono"
                                  />
                                )}
                              </td>
                              <td className="p-2.5 text-right font-bold text-cyan-300 font-mono">
                                {rebateMode === 'practice_fees_only'
                                  ? `$${item.fee}`
                                  : `$${item.gapEstimate}`}
                              </td>
                              <td className="p-2.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteQuoteItem(idx)}
                                  title="Remove procedure line"
                                  className="p-1 text-slate-400 hover:text-rose-400 rounded transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Phased Care Roadmap Timeline */}
                  {treatmentQuote.phasedMilestones && treatmentQuote.phasedMilestones.length > 0 && (
                    <div className="p-5 bg-[#0A1018] rounded-2xl border border-[#1E3048] flex flex-col gap-3.5 shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 font-mono">
                          Phased Care Roadmap (Bite-Sized Chapters)
                        </span>
                        <span className="text-[11px] font-semibold text-cyan-400 font-mono">
                          {treatmentQuote.phasedMilestones.length} Strategic Care Phases
                        </span>
                      </div>
                      <div className="space-y-3">
                        {treatmentQuote.phasedMilestones.map((milestone) => (
                          <div
                            key={milestone.phaseNumber}
                            className="flex items-start gap-3.5 bg-[#070B11] p-4 rounded-xl border border-[#1E3048] shadow-sm hover:border-cyan-500/30 transition-all"
                          >
                            <div className="w-7 h-7 rounded-full bg-cyan-500/10 text-cyan-300 font-mono font-bold text-xs flex items-center justify-center flex-shrink-0 mt-0.5 ring-1 ring-cyan-500/30">
                              {milestone.phaseNumber}
                            </div>
                            <div className="flex-grow">
                              <div className="flex items-center justify-between">
                                <span className="font-extrabold text-xs text-white font-mono">{milestone.phaseTitle}</span>
                                <span className="font-mono font-bold text-xs text-emerald-300 bg-[#0E1724] px-2 py-0.5 rounded-md border border-[#1E3048]">
                                  ${milestone.totalPhaseFee}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed font-mono">
                                {milestone.items.join(' • ')}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Master Save to Practice Record Button */}
              <div className="mt-2">
                <button
                  onClick={handleSaveToRecord}
                  type="button"
                  className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 h-14 rounded-xl font-black flex items-center justify-center gap-2 shadow-[0_0_25px_rgba(52,211,153,0.35)] active:scale-95 transition-all cursor-pointer text-sm font-mono uppercase tracking-wider"
                >
                  <Save className="w-5 h-5 fill-slate-950" />
                  <span>Save All Clinical &amp; Patient Records</span>
                </button>
              </div>
            </section>
          </div>
        </main>

        {/* Mobile nav */}
        <nav className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-4 h-20 pb-safe bg-[#070B11]/90 backdrop-blur-md border-t border-[#1E3048] md:hidden shadow-lg">
          <button onClick={onBack} className="flex flex-col items-center justify-center text-slate-400 hover:text-cyan-400 transition-all p-2 rounded-xl">
            <Menu className="w-6 h-6" />
            <span className="font-label-sm text-[11px] mt-1 font-semibold font-mono">History</span>
          </button>
          <button onClick={handleSaveToRecord} className="flex flex-col items-center justify-center text-emerald-400 font-bold transition-all p-2 rounded-xl">
            <Save className="w-6 h-6" />
            <span className="font-label-sm text-[11px] mt-1 font-mono">{needsReview ? 'Save review' : 'Save'}</span>
          </button>
        </nav>

        {/* Save overlay */}
        <AnimatePresence>
          {showSavedOverlay && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm px-4"
            >
              <motion.div
                initial={{ scale: 0.9, y: 15 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 15 }}
                className="bg-[#0A1018] rounded-2xl p-8 flex flex-col items-center text-center max-w-sm w-full mx-auto shadow-2xl border border-[#1E3048]"
              >
                <div className="w-16 h-16 bg-emerald-500/20 border border-emerald-500/30 rounded-full flex items-center justify-center mb-5 animate-bounce">
                  <Check className="text-emerald-400 w-8 h-8 stroke-[3]" />
                </div>
                <h3 className="font-mono text-xl font-bold text-white mb-1.5 leading-tight">Saved Successfully</h3>
                <p className="text-slate-400 text-sm mb-6 leading-relaxed font-mono">
                  Clinical record, patient consent document, specialist referral, and treatment quote saved to patient record.
                </p>
                <button
                  type="button"
                  onClick={onBack}
                  className="w-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold h-12 rounded-xl transition-all shadow-[0_0_20px_rgba(34,211,238,0.3)] cursor-pointer font-mono"
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
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mt-0.5">Clinical & Practice Growth OS</p>
          </div>
          <div className="text-right">
            <h2 className="text-sm font-bold text-slate-800">Complete Consultation Dossier</h2>
            <p className="text-[10px] text-slate-400">Record ID: DENTAI-CONS-{consultation.id}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Provider: {dentistName || 'Dentist'} (AHPRA Reg)</p>
          </div>
        </div>

        {/* Patient header */}
        <div className="mb-6">
          <h3 className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider mb-2 border-b border-slate-100 pb-1">Patient Record</h3>
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

        {/* Clinical Notes Section */}
        <div className="mb-6">
          <h3 className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider mb-3 border-b border-slate-100 pb-1">
            Clinical Record — {activeTemplate.name}
          </h3>
          <div className="space-y-3">
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

        {/* Patient Care & Consent Document */}
        <div className="mb-6" style={{ pageBreakBefore: 'always' }}>
          <h3 className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider mb-2 border-b border-slate-100 pb-1">
            Patient Care Summary & Informed Consent (en-AU)
          </h3>
          <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 space-y-3">
            <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">{patientLetter || 'No letter prepared for this record.'}</p>
            <div className="border-t border-slate-200 pt-3 grid grid-cols-2 gap-3 text-[11px]">
              <div>
                <strong className="text-slate-700 block">Risks of No Treatment:</strong>
                <span className="text-slate-600">{patientConsent.risksOfNoTreatment}</span>
              </div>
              <div>
                <strong className="text-slate-700 block">Post-Operative Instructions:</strong>
                <span className="text-slate-600">{patientConsent.postOpCareInstructions}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Specialist Referral Letter (if present) */}
        {specialistReferral.letterText && (
          <div className="mb-6" style={{ pageBreakBefore: 'always' }}>
            <h3 className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider mb-2 border-b border-slate-100 pb-1">
              Specialist Referral Letter — {specialistReferral.specialty}
            </h3>
            <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 font-mono text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
              {specialistReferral.letterText}
            </div>
          </div>
        )}

        {/* Treatment Estimate & Quote */}
        {treatmentQuote.items.length > 0 && (
          <div className="mb-8 font-sans" style={{ pageBreakBefore: 'always' }}>
            <h3 className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider mb-2 border-b border-slate-100 pb-1">
              Treatment Estimate & Itemized Practice Fee Schedule
            </h3>

            {/* Health Fund Notice for Printed Report */}
            <div className="mb-3 p-3 bg-slate-50 border border-slate-200 rounded-lg text-[10px] text-slate-600 leading-relaxed">
              <strong className="text-slate-800">Notice Regarding Private Health Insurance Rebates:</strong> Private health fund rebates depend on your individual fund table of cover, waiting periods, and remaining annual limits (which may have been drawn upon earlier this year). Please quote the ADA item numbers below directly to your private health insurer to verify your exact rebate and out-of-pocket gap prior to booking chair time.
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden mb-4">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200 text-[10px] uppercase">
                    <th className="p-2.5">Item</th>
                    <th className="p-2.5">Description</th>
                    <th className="p-2.5 text-right">Practice Fee</th>
                    <th className="p-2.5 text-right">
                      {rebateMode === 'practice_fees_only' ? 'Health Fund Rebate' : 'Est. Rebate'}
                    </th>
                    <th className="p-2.5 text-right">Net Gap</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {treatmentQuote.items.map((it, idx) => (
                    <tr key={idx}>
                      <td className="p-2.5 font-mono">{it.adaCode}</td>
                      <td className="p-2.5">{formatItemTitle(it)}</td>
                      <td className="p-2.5 text-right font-semibold">${it.fee}</td>
                      <td className="p-2.5 text-right text-emerald-700">
                        {rebateMode === 'practice_fees_only'
                          ? 'Check with fund'
                          : `$${it.healthFundEstimatedRebate}`}
                      </td>
                      <td className="p-2.5 text-right font-bold text-[#004ac6]">
                        {rebateMode === 'practice_fees_only'
                          ? `$${it.fee}`
                          : `$${it.gapEstimate}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-6 text-xs font-bold bg-slate-50 p-3 rounded-xl border border-slate-200">
              <span>Total Practice Fee: ${treatmentQuote.totalFee}</span>
              {rebateMode === 'show_rebate_estimate' ? (
                <>
                  <span className="text-emerald-700">Total Est. Rebate: ${treatmentQuote.estimatedRebate}</span>
                  <span className="text-[#004ac6]">Estimated Patient Gap: ${treatmentQuote.netGap}</span>
                </>
              ) : (
                <span className="text-slate-500 font-medium italic">
                  Health fund rebate claimable directly with insurer
                </span>
              )}
            </div>
          </div>
        )}

        <div className="mt-12 flex justify-between items-center border-t border-slate-200 pt-6">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${needsReview ? 'bg-amber-500' : 'bg-emerald-600'}`}></span>
            <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">
              {needsReview ? 'Clinician-reviewed draft' : 'AHPRA Section 133 Compliant Dossier'}
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
