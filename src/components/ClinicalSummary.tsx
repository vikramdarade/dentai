import React, { useState } from 'react';
import { Menu, User, CheckCircle, Copy, Check, Save, ClipboardList, FileText, Tag, Layers, SlidersHorizontal } from 'lucide-react';
import { Consultation, AdaCodeItem } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { PRESET_TEMPLATES, NoteTemplate } from '../utils/templates';

interface ClinicalSummaryProps {
  consultation: Consultation;
  onSave: (updatedConsultation: Consultation) => void;
  onBack: () => void;
  dentistName?: string;
}

export default function ClinicalSummary({
  consultation,
  onSave,
  onBack,
  dentistName
}: ClinicalSummaryProps) {
  const [activeTemplateId, setActiveTemplateId] = useState<string>(consultation.templateId || 'standard');

  // Standard findings state
  const [chiefComplaint, setChiefComplaint] = useState(consultation.findings.chiefComplaint);
  const [history, setHistory] = useState(consultation.findings.history);
  const [toothFindings, setToothFindings] = useState(consultation.findings.toothFindings);
  const [findingsGingival, setFindingsGingival] = useState(consultation.findings.findingsGingival);
  const [diagnosis, setDiagnosis] = useState(consultation.findings.diagnosis);
  const [treatmentPerformed, setTreatmentPerformed] = useState(consultation.findings.treatmentPerformed);
  const [recommendations, setRecommendations] = useState(consultation.findings.recommendations);
  const [recall, setRecall] = useState(consultation.findings.recallRequirements);
  const [adaCodes, setAdaCodes] = useState<AdaCodeItem[]>(consultation.findings.adaCodes || []);

  // SOAP specific state
  const [soapSubjective, setSoapSubjective] = useState(
    `${consultation.findings.chiefComplaint} ${consultation.findings.history}`.trim()
  );
  const [soapObjective, setSoapObjective] = useState(
    `Tooth Findings:\n${consultation.findings.toothFindings}\n\nPeriodontal & Gingival:\n${consultation.findings.findingsGingival}`.trim()
  );
  const [soapAssessment, setSoapAssessment] = useState(consultation.findings.diagnosis);
  const [soapPlan, setSoapPlan] = useState(
    `Treatment Performed:\n${consultation.findings.treatmentPerformed}\n\nRecommendations:\n${consultation.findings.recommendations}\n\nRecall: ${consultation.findings.recallRequirements}`.trim()
  );

  // Restorative / Endo specific state
  const [restToothIsolation, setRestToothIsolation] = useState(consultation.findings.toothFindings);
  const [restCariesPulp, setRestCariesPulp] = useState(consultation.findings.diagnosis);
  const [restMaterials, setRestMaterials] = useState(consultation.findings.treatmentPerformed);
  const [restOcclusion, setRestOcclusion] = useState("Checked in centric occlusion and lateral excursions. High spots adjusted and polished smooth.");
  const [restPostOp, setRestPostOp] = useState(
    `${consultation.findings.recommendations}\nRecall: ${consultation.findings.recallRequirements}`.trim()
  );

  // Patient advice letter state
  const [patientLetter, setPatientLetter] = useState(consultation.patientSummary);

  const [copied, setCopied] = useState(false);
  const [pmsCopied, setPmsCopied] = useState(false);
  const [showSavedOverlay, setShowSavedOverlay] = useState(false);

  const handleCopySummary = () => {
    navigator.clipboard.writeText(patientLetter);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  const handleCopyPmsNote = () => {
    let lines: string[] = [];

    if (activeTemplateId === 'soap') {
      lines = [
        `=== CLINICAL NOTE (SOAP FORMAT) ===`,
        `PATIENT: ${consultation.firstName} ${consultation.lastName} (DOB: ${consultation.dob})`,
        `DATE: ${consultation.date} ${consultation.time}`,
        ``,
        `[S] SUBJECTIVE:`,
        soapSubjective,
        ``,
        `[O] OBJECTIVE:`,
        soapObjective,
        ``,
        `[A] ASSESSMENT:`,
        soapAssessment,
        ``,
        `[P] PLAN:`,
        soapPlan,
        ``
      ];
    } else if (activeTemplateId === 'restorative') {
      lines = [
        `=== CLINICAL NOTE (RESTORATIVE & ENDODONTIC FOCUS) ===`,
        `PATIENT: ${consultation.firstName} ${consultation.lastName} (DOB: ${consultation.dob})`,
        `DATE: ${consultation.date} ${consultation.time}`,
        ``,
        `TOOTH & ISOLATION:`,
        restToothIsolation,
        ``,
        `CARIES & PULP STATUS:`,
        restCariesPulp,
        ``,
        `MATERIALS & TECHNIQUE:`,
        restMaterials,
        ``,
        `OCCLUSION & POLISH:`,
        restOcclusion,
        ``,
        `POST-OP INSTRUCTIONS & NEXT STEP:`,
        restPostOp,
        ``
      ];
    } else {
      lines = [
        `=== CLINICAL EXAMINATION NOTE (AHPRA STANDARD) ===`,
        `PATIENT: ${consultation.firstName} ${consultation.lastName} (DOB: ${consultation.dob})`,
        `DATE: ${consultation.date} ${consultation.time}`,
        ``,
        `CHIEF COMPLAINT:`,
        chiefComplaint,
        ``,
        `HISTORY:`,
        history,
        ``,
        `EXAMINATION & TOOTH FINDINGS:`,
        toothFindings,
        ``,
        `PERIODONTAL & GINGIVAL:`,
        findingsGingival,
        ``,
        `DIAGNOSIS:`,
        diagnosis,
        ``,
        `TREATMENT PERFORMED:`,
        treatmentPerformed,
        ``,
        `RECOMMENDATIONS:`,
        recommendations,
        ``,
        `RECALL:`,
        recall,
        ``
      ];
    }

    if (adaCodes.length > 0) {
      lines.push(`--- ADA BILLING ITEM CODES ---`);
      adaCodes.forEach(code => {
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
    const updatedConsultation: Consultation = {
      ...consultation,
      status: 'Completed',
      templateId: activeTemplateId,
      findings: {
        chiefComplaint,
        history,
        toothFindings,
        findingsGingival,
        diagnosis,
        treatmentPerformed,
        recommendations,
        recallRequirements: recall,
        adaCodes
      },
      patientSummary: patientLetter
    };

    onSave(updatedConsultation);
    setShowSavedOverlay(true);
  };

  return (
    <>
      <div id="clinical-summary-container" className="min-h-screen bg-[#F8F7F5] pb-24 text-on-surface no-print">
      {/* Top App Bar App Header */}
      <header className="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-4 h-16 bg-white border-b border-outline-variant shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 -ml-2 rounded-full hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <Menu className="text-primary h-6 w-6" />
          </button>
          <h1 className="font-headline-md text-headline-md font-bold text-primary">DentAI</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden md:flex flex-col items-end">
            <span className="font-semibold text-sm text-slate-800">{dentistName || 'Dr. Sarah Jenkins'}</span>
            <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest leading-none mt-0.5">
              General Dentistry
            </span>
          </div>
          <button className="p-1 rounded-full text-slate-400 hover:text-primary transition-all">
            <User className="w-6 h-6" />
          </button>
        </div>
      </header>

      {/* Main Container Layout */}
      <main className="pt-20 px-4 max-w-[1440px] mx-auto">
        {/* Patient Profile Banner Card */}
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
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  consultation.appointmentType === 'emergency'
                    ? 'bg-red-50 text-red-700 border border-red-250'
                    : consultation.appointmentType === 'scale_clean'
                    ? 'bg-blue-50 text-blue-700 border border-blue-250'
                    : 'bg-indigo-50 text-[#004ac6] border border-indigo-250'
                }`}>
                  {consultation.appointmentType.replace('_', ' ')}
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Date of Birth: <span className="font-semibold text-slate-700">{consultation.dob}</span> &bull; Status: <span className={`font-semibold ${consultation.status === 'Completed' ? 'text-emerald-700' : 'text-indigo-700'}`}>{consultation.status}</span>
              </p>
            </div>
          </div>
          <div className="flex sm:flex-col items-start sm:items-end text-xs text-slate-400 gap-x-4 gap-y-0.5 flex-wrap border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-100">
            <div>Consultation Date: <span className="font-semibold text-slate-600">{consultation.date}</span></div>
            <div>Time: <span className="font-semibold text-slate-600">{consultation.time}</span></div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          
          {/* BLOCK A: Clinical Findings list of Cards */}
          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between py-2 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <h2 className="font-headline-sm text-lg font-bold text-slate-800">
                  Clinical Findings
                </h2>
                <span className="bg-emerald-50 text-emerald-700 border border-emerald-250 font-semibold px-2.5 py-0.5 rounded-full text-xs flex items-center gap-1 shadow-sm">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>AI Verified</span>
                </span>
              </div>

              {/* 1-Click PMS Smart Copy Button */}
              <button
                onClick={handleCopyPmsNote}
                title="Copy entire note formatted for Dental4Windows, Dentrix, EXACT, or Cliniko"
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-bold text-xs transition-all active:scale-95 shadow-sm cursor-pointer ${
                  pmsCopied
                    ? 'bg-emerald-600 text-white'
                    : 'bg-[#004ac6] text-white hover:bg-blue-700 shadow-blue-600/20'
                }`}
              >
                {pmsCopied ? (
                  <>
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                    <span>Copied for PMS!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>1-Click Copy for PMS</span>
                  </>
                )}
              </button>
            </div>

            {/* ADA Billing Item Codes Pill Badges Card */}
            {adaCodes.length > 0 && (
              <div className="p-4 bg-slate-900 text-white rounded-2xl shadow-md border border-slate-800 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Tag className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                      Extracted ADA Billing Codes
                    </span>
                  </div>
                  <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-mono font-semibold">
                    {adaCodes.length} {adaCodes.length === 1 ? 'Item' : 'Items'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {adaCodes.map((item, idx) => (
                    <div
                      key={idx}
                      className="bg-slate-800/90 border border-slate-700 text-white px-3 py-1 rounded-xl flex items-center gap-2 text-xs hover:border-emerald-500/50 transition-colors"
                    >
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

            {/* Template Selector Pill Tabs */}
            <div className="flex items-center gap-1.5 p-1 bg-slate-100/80 rounded-xl w-fit border border-slate-200/60 overflow-x-auto max-w-full">
              <button
                type="button"
                onClick={() => setActiveTemplateId('standard')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                  activeTemplateId === 'standard'
                    ? 'bg-white text-primary shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                AHPRA Standard (8-Point)
              </button>
              <button
                type="button"
                onClick={() => setActiveTemplateId('soap')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                  activeTemplateId === 'soap'
                    ? 'bg-white text-indigo-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                SOAP Format
              </button>
              <button
                type="button"
                onClick={() => setActiveTemplateId('restorative')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                  activeTemplateId === 'restorative'
                    ? 'bg-white text-emerald-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Restorative & Endo Focus
              </button>
            </div>

            {/* Editable findings form list stack based on activeTemplateId */}
            <div className="space-y-4 pb-8">
              {activeTemplateId === 'soap' ? (
                <>
                  {/* [S] Subjective */}
                  <div className="p-1 bg-amber-500/5 hover:bg-amber-500/10 rounded-2xl transition-all duration-300 shadow-sm border border-amber-200/30 focus-within:ring-1 focus-within:ring-amber-500/20">
                    <div className="bg-white border border-amber-100/50 rounded-[calc(1rem-0.25rem)] p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-5 h-5 rounded-md bg-amber-100 text-amber-800 font-mono font-bold text-xs flex items-center justify-center">S</span>
                        <label className="font-bold text-[10px] uppercase tracking-wider text-amber-600">
                          Subjective
                        </label>
                      </div>
                      <textarea
                        rows={3}
                        value={soapSubjective}
                        onChange={(e) => setSoapSubjective(e.target.value)}
                        className="w-full border-none p-0 focus:ring-0 text-slate-700 text-sm resize-none bg-transparent outline-none"
                      />
                    </div>
                  </div>

                  {/* [O] Objective */}
                  <div className="p-1 bg-indigo-500/5 hover:bg-indigo-500/10 rounded-2xl transition-all duration-300 shadow-sm border border-indigo-200/30 focus-within:ring-1 focus-within:ring-indigo-500/20">
                    <div className="bg-white border border-indigo-100/50 rounded-[calc(1rem-0.25rem)] p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-5 h-5 rounded-md bg-indigo-100 text-indigo-800 font-mono font-bold text-xs flex items-center justify-center">O</span>
                        <label className="font-bold text-[10px] uppercase tracking-wider text-indigo-600">
                          Objective (Exam, FDI Teeth, Perio, Rads)
                        </label>
                      </div>
                      <textarea
                        rows={4}
                        value={soapObjective}
                        onChange={(e) => setSoapObjective(e.target.value)}
                        className="w-full border-none p-0 focus:ring-0 text-slate-700 text-sm resize-none bg-transparent outline-none"
                      />
                    </div>
                  </div>

                  {/* [A] Assessment */}
                  <div className="p-1 bg-emerald-500/5 hover:bg-emerald-500/10 rounded-2xl transition-all duration-300 shadow-sm border border-emerald-200/30 focus-within:ring-1 focus-within:ring-emerald-500/20">
                    <div className="bg-white border border-emerald-100/50 rounded-[calc(1rem-0.25rem)] p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-5 h-5 rounded-md bg-emerald-100 text-emerald-800 font-mono font-bold text-xs flex items-center justify-center">A</span>
                        <label className="font-bold text-[10px] uppercase tracking-wider text-emerald-600">
                          Assessment & Diagnosis
                        </label>
                      </div>
                      <textarea
                        rows={2}
                        value={soapAssessment}
                        onChange={(e) => setSoapAssessment(e.target.value)}
                        className="w-full border-none p-0 focus:ring-0 text-slate-700 text-sm resize-none bg-transparent outline-none"
                      />
                    </div>
                  </div>

                  {/* [P] Plan */}
                  <div className="p-1 bg-sky-500/5 hover:bg-sky-500/10 rounded-2xl transition-all duration-300 shadow-sm border border-sky-200/30 focus-within:ring-1 focus-within:ring-sky-500/20">
                    <div className="bg-white border border-sky-100/50 rounded-[calc(1rem-0.25rem)] p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-5 h-5 rounded-md bg-sky-100 text-sky-800 font-mono font-bold text-xs flex items-center justify-center">P</span>
                        <label className="font-bold text-[10px] uppercase tracking-wider text-sky-600">
                          Plan (Treatment Done, Instructions, Recall)
                        </label>
                      </div>
                      <textarea
                        rows={4}
                        value={soapPlan}
                        onChange={(e) => setSoapPlan(e.target.value)}
                        className="w-full border-none p-0 focus:ring-0 text-slate-700 text-sm resize-none bg-transparent outline-none"
                      />
                    </div>
                  </div>
                </>
              ) : activeTemplateId === 'restorative' ? (
                <>
                  {/* Tooth & Isolation */}
                  <div className="p-1 bg-blue-500/5 hover:bg-blue-500/10 rounded-2xl transition-all duration-300 shadow-sm border border-blue-200/30 focus-within:ring-1 focus-within:ring-blue-500/20">
                    <div className="bg-white border border-blue-100/50 rounded-[calc(1rem-0.25rem)] p-4">
                      <label className="font-bold text-[10px] uppercase tracking-wider text-blue-600 block mb-1">
                        Tooth & Isolation
                      </label>
                      <textarea
                        rows={2}
                        value={restToothIsolation}
                        onChange={(e) => setRestToothIsolation(e.target.value)}
                        className="w-full border-none p-0 focus:ring-0 text-slate-700 text-sm resize-none bg-transparent outline-none"
                      />
                    </div>
                  </div>

                  {/* Caries & Pulp Status */}
                  <div className="p-1 bg-amber-500/5 hover:bg-amber-500/10 rounded-2xl transition-all duration-300 shadow-sm border border-amber-200/30 focus-within:ring-1 focus-within:ring-amber-500/20">
                    <div className="bg-white border border-amber-100/50 rounded-[calc(1rem-0.25rem)] p-4">
                      <label className="font-bold text-[10px] uppercase tracking-wider text-amber-600 block mb-1">
                        Caries & Pulp Status
                      </label>
                      <textarea
                        rows={2}
                        value={restCariesPulp}
                        onChange={(e) => setRestCariesPulp(e.target.value)}
                        className="w-full border-none p-0 focus:ring-0 text-slate-700 text-sm resize-none bg-transparent outline-none"
                      />
                    </div>
                  </div>

                  {/* Materials & Technique */}
                  <div className="p-1 bg-emerald-500/5 hover:bg-emerald-500/10 rounded-2xl transition-all duration-300 shadow-sm border border-emerald-200/30 focus-within:ring-1 focus-within:ring-emerald-500/20">
                    <div className="bg-white border border-emerald-100/50 rounded-[calc(1rem-0.25rem)] p-4">
                      <label className="font-bold text-[10px] uppercase tracking-wider text-emerald-600 block mb-1">
                        Materials, Shade & Technique
                      </label>
                      <textarea
                        rows={3}
                        value={restMaterials}
                        onChange={(e) => setRestMaterials(e.target.value)}
                        className="w-full border-none p-0 focus:ring-0 text-slate-700 text-sm resize-none bg-transparent outline-none"
                      />
                    </div>
                  </div>

                  {/* Occlusion & Polish */}
                  <div className="p-1 bg-indigo-500/5 hover:bg-indigo-500/10 rounded-2xl transition-all duration-300 shadow-sm border border-indigo-200/30 focus-within:ring-1 focus-within:ring-indigo-500/20">
                    <div className="bg-white border border-indigo-100/50 rounded-[calc(1rem-0.25rem)] p-4">
                      <label className="font-bold text-[10px] uppercase tracking-wider text-indigo-600 block mb-1">
                        Occlusion & Polish
                      </label>
                      <textarea
                        rows={2}
                        value={restOcclusion}
                        onChange={(e) => setRestOcclusion(e.target.value)}
                        className="w-full border-none p-0 focus:ring-0 text-slate-700 text-sm resize-none bg-transparent outline-none"
                      />
                    </div>
                  </div>

                  {/* Post-Op Instructions & Next Step */}
                  <div className="p-1 bg-violet-500/5 hover:bg-violet-500/10 rounded-2xl transition-all duration-300 shadow-sm border border-violet-200/30 focus-within:ring-1 focus-within:ring-violet-500/20">
                    <div className="bg-white border border-violet-100/50 rounded-[calc(1rem-0.25rem)] p-4">
                      <label className="font-bold text-[10px] uppercase tracking-wider text-violet-600 block mb-1">
                        Post-Op Instructions & Next Step
                      </label>
                      <textarea
                        rows={3}
                        value={restPostOp}
                        onChange={(e) => setRestPostOp(e.target.value)}
                        className="w-full border-none p-0 focus:ring-0 text-slate-700 text-sm resize-none bg-transparent outline-none"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* Chief Complaint */}
                  <div className="p-1 bg-amber-500/5 hover:bg-amber-500/10 rounded-2xl transition-all duration-300 shadow-sm border border-amber-200/30 focus-within:ring-1 focus-within:ring-amber-500/20">
                    <div className="bg-white border border-amber-100/50 rounded-[calc(1rem-0.25rem)] p-4">
                      <label className="font-bold text-[10px] uppercase tracking-wider text-amber-600 block mb-1">
                        Chief Complaint
                      </label>
                      <textarea
                        rows={2}
                        value={chiefComplaint}
                        onChange={(e) => setChiefComplaint(e.target.value)}
                        className="w-full border-none p-0 focus:ring-0 text-slate-700 text-sm resize-none bg-transparent outline-none"
                      />
                    </div>
                  </div>

                  {/* History */}
                  <div className="p-1 bg-indigo-500/5 hover:bg-indigo-500/10 rounded-2xl transition-all duration-300 shadow-sm border border-indigo-200/30 focus-within:ring-1 focus-within:ring-indigo-500/20">
                    <div className="bg-white border border-indigo-100/50 rounded-[calc(1rem-0.25rem)] p-4">
                      <label className="font-bold text-[10px] uppercase tracking-wider text-indigo-600 block mb-1">
                        History
                      </label>
                      <textarea
                        rows={2}
                        value={history}
                        onChange={(e) => setHistory(e.target.value)}
                        className="w-full border-none p-0 focus:ring-0 text-slate-700 text-sm resize-none bg-transparent outline-none"
                      />
                    </div>
                  </div>

                  {/* Findings Split */}
                  <div className="p-1 bg-slate-500/5 hover:bg-slate-500/10 rounded-2xl transition-all duration-300 shadow-sm border border-slate-200/30 focus-within:ring-1 focus-within:ring-primary/20">
                    <div className="bg-white border border-slate-100 rounded-[calc(1rem-0.25rem)] p-4">
                      <label className="font-bold text-[10px] uppercase tracking-wider text-slate-500 block mb-2">
                        Clinical Examination Findings
                      </label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-100 pt-3">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wide mb-1">
                            Tooth Findings (FDI)
                          </span>
                          <textarea
                            rows={3}
                            value={toothFindings}
                            onChange={(e) => setToothFindings(e.target.value)}
                            className="w-full border-none p-0 focus:ring-0 text-slate-700 text-xs resize-none bg-transparent outline-none"
                          />
                        </div>
                        <div className="flex flex-col border-t md:border-t-0 md:border-l border-slate-100 pt-3 md:pt-0 md:pl-4">
                          <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wide mb-1">
                            Gingival State
                          </span>
                          <textarea
                            rows={3}
                            value={findingsGingival}
                            onChange={(e) => setFindingsGingival(e.target.value)}
                            className="w-full border-none p-0 focus:ring-0 text-slate-700 text-xs resize-none bg-transparent outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Diagnosis */}
                  <div className="p-1 bg-emerald-500/5 hover:bg-emerald-500/10 rounded-2xl transition-all duration-300 shadow-sm border border-emerald-200/30 focus-within:ring-1 focus-within:ring-emerald-500/20">
                    <div className="bg-white border border-emerald-100/50 rounded-[calc(1rem-0.25rem)] p-4">
                      <label className="font-bold text-[10px] uppercase tracking-wider text-emerald-600 block mb-1">
                        Diagnosis
                      </label>
                      <textarea
                        rows={2}
                        value={diagnosis}
                        onChange={(e) => setDiagnosis(e.target.value)}
                        className="w-full border-none p-0 focus:ring-0 text-slate-700 text-sm resize-none bg-transparent outline-none"
                      />
                    </div>
                  </div>

                  {/* Treatment Performed */}
                  <div className="p-1 bg-sky-500/5 hover:bg-sky-500/10 rounded-2xl transition-all duration-300 shadow-sm border border-sky-200/30 focus-within:ring-1 focus-within:ring-sky-500/20">
                    <div className="bg-white border border-sky-100/50 rounded-[calc(1rem-0.25rem)] p-4">
                      <label className="font-bold text-[10px] uppercase tracking-wider text-sky-600 block mb-1">
                        Treatment Performed
                      </label>
                      <textarea
                        rows={2}
                        value={treatmentPerformed}
                        onChange={(e) => setTreatmentPerformed(e.target.value)}
                        className="w-full border-none p-0 focus:ring-0 text-slate-700 text-sm resize-none bg-transparent outline-none"
                      />
                    </div>
                  </div>

                  {/* Recommendations */}
                  <div className="p-1 bg-violet-500/5 hover:bg-violet-500/10 rounded-2xl transition-all duration-300 shadow-sm border border-violet-200/30 focus-within:ring-1 focus-within:ring-violet-500/20">
                    <div className="bg-white border border-violet-100/50 rounded-[calc(1rem-0.25rem)] p-4">
                      <label className="font-bold text-[10px] uppercase tracking-wider text-violet-600 block mb-1">
                        Patient Home Care Recommendations
                      </label>
                      <textarea
                        rows={2}
                        value={recommendations}
                        onChange={(e) => setRecommendations(e.target.value)}
                        className="w-full border-none p-0 focus:ring-0 text-slate-700 text-sm resize-none bg-transparent outline-none"
                      />
                    </div>
                  </div>

                  {/* Recall Requirements */}
                  <div className="p-1 bg-pink-500/5 hover:bg-pink-500/10 rounded-2xl transition-all duration-300 shadow-sm border border-pink-200/30 focus-within:ring-1 focus-within:ring-pink-500/20">
                    <div className="bg-white border border-pink-100/50 rounded-[calc(1rem-0.25rem)] p-4">
                      <label className="font-bold text-[10px] uppercase tracking-wider text-pink-650 block mb-2">
                        Recall / Follow-up Requirements
                      </label>
                      <div className="flex flex-col md:flex-row md:items-center gap-3">
                        <select
                          value={recall}
                          onChange={(e) => setRecall(e.target.value)}
                          className="bg-pink-50/50 border border-pink-100 text-pink-700 text-xs font-bold rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-pink-500"
                        >
                          <option value="6 Months (Standard)">6 Months (Standard)</option>
                          <option value="3 Months (Periodontal)">3 Months (Periodontal)</option>
                          <option value="Next Available (Urgent)">Next Available (Urgent)</option>
                        </select>
                        <span className="text-secondary text-xs text-slate-400">
                          Follow-up and schedule standard monitoring treatment check-in as defined above.
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* BLOCK B: Communication Hub + Patient Care Summary Letter */}
          <section className="flex flex-col h-full lg:sticky lg:top-20">
            <div className="flex items-center justify-between py-2">
              <h2 className="font-headline-sm text-lg font-bold text-slate-800">
                Communication Hub
              </h2>
            </div>

            <div className="flex-grow bg-indigo-500/5 border border-indigo-100/50 rounded-2xl p-6 flex flex-col relative overflow-hidden shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="bg-[#2563eb] p-2 rounded-xl text-white shadow-sm">
                    <ClipboardList className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-slate-850 text-base">Patient Care Summary</h3>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopySummary}
                    className={`flex items-center gap-2 border px-4 h-9 rounded-full font-bold text-xs transition-all active:scale-95 cursor-pointer ${
                      copied
                        ? 'bg-emerald-600 border-transparent text-white'
                        : 'bg-white border-outline-variant hover:shadow-md text-primary'
                    }`}
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Letter</span>
                      </>
                    )}
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

              {/* Dynamic Editable Correspondence text frame */}
              <div className="bg-white rounded-xl p-5 border border-outline-variant/60 shadow-inner flex flex-col flex-grow min-h-[250px] lg:min-h-[350px]">
                <textarea
                  value={patientLetter}
                  onChange={(e) => setPatientLetter(e.target.value)}
                  className="w-full h-full border-none p-0 focus:ring-0 text-slate-700 text-sm leading-relaxed resize-none bg-transparent outline-none focus:outline-none"
                  placeholder="Drafting care instructions letter..."
                />
              </div>

              {/* Core save actions */}
              <div className="mt-5">
                <button
                  onClick={handleSaveToRecord}
                  type="button"
                  className="w-full bg-[#004ac6] hover:bg-opacity-95 text-white h-14 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all cursor-pointer text-sm"
                >
                  <Save className="w-5 h-5 fill-white" />
                  <span>Save to Practice Record</span>
                </button>
              </div>
            </div>
          </section>

        </div>
      </main>

      {/* Persistent Mobile Navigation mimic bar */}
      <nav className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-4 h-20 pb-safe bg-white border-t border-outline-variant md:hidden shadow-lg">
        <button
          onClick={onBack}
          className="flex flex-col items-center justify-center text-slate-400 hover:text-primary transition-all p-2 rounded-xl"
        >
          <Menu className="w-6 h-6" />
          <span className="font-label-sm text-[11px] mt-1 font-semibold">History</span>
        </button>
        <button
          onClick={handleSaveToRecord}
          className="flex flex-col items-center justify-center text-primary font-bold transition-all p-2 rounded-xl"
        >
          <Save className="w-6 h-6" />
          <span className="font-label-sm text-[11px] mt-1">Save</span>
        </button>
      </nav>

      {/* Immersive HIPAA Successful Save Overlay dialog Box */}
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
              <h3 className="font-headline-lg text-xl font-bold text-slate-800 mb-1.5 leading-tight">
                Saved Successfully
              </h3>
              <p className="text-slate-500 text-sm mb-6 leading-relaxed">
                Dental clinical findings and correspondence letter have been fully synchronized to EHR.
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

      {/* Print-Only Professional Medical Report Template */}
      <div className="print-only w-full max-w-4xl mx-auto p-10 font-sans bg-white text-slate-900 border border-slate-200 rounded shadow-sm">
        {/* Letterhead Header */}
        <div className="flex justify-between items-start border-b-2 border-[#004ac6] pb-4 mb-6">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-[#004ac6]">DentAI</h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mt-0.5">Clinical & Patient Care Copilot</p>
          </div>
          <div className="text-right">
            <h2 className="text-sm font-bold text-slate-800">ANZ Dental Care Pilot</h2>
            <p className="text-[10px] text-slate-400">Recordkeeping ID: DENTAI-CONS-{consultation.id}</p>
            <p className="text-[10px] text-slate-550 mt-0.5">Provider: {dentistName || 'Dr. Sarah Jenkins'}</p>
          </div>
        </div>

        {/* Patient Demographics Table */}
        <div className="mb-6">
          <h3 className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider mb-2 border-b border-slate-100 pb-1">Patient Details</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">Full Name</span>
              <span className="text-xs font-bold text-slate-800">{consultation.firstName} {consultation.lastName}</span>
            </div>
            <div>
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">Date of Birth</span>
              <span className="text-xs font-semibold text-slate-800">{consultation.dob}</span>
            </div>
            <div>
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">Appointment Type</span>
              <span className="text-xs font-extrabold uppercase tracking-wide text-[#004ac6]">{consultation.appointmentType.replace('_', ' ')}</span>
            </div>
            <div>
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">Date & Time</span>
              <span className="text-xs font-semibold text-slate-800">{consultation.date} at {consultation.time}</span>
            </div>
          </div>
        </div>

        {/* Structured SOAP Findings */}
        <div className="mb-6">
          <h3 className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider mb-3 border-b border-slate-100 pb-1">Clinical SOAP Record</h3>
          <div className="space-y-4">
            <div className="border-l-4 border-[#004ac6] pl-3 py-0.5">
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">Chief Complaint</span>
              <p className="text-xs text-slate-800 leading-relaxed mt-0.5">{chiefComplaint}</p>
            </div>
            <div className="border-l-4 border-slate-300 pl-3 py-0.5">
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">History</span>
              <p className="text-xs text-slate-800 leading-relaxed mt-0.5">{history}</p>
            </div>
            <div className="border-l-4 border-slate-300 pl-3 py-0.5">
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">Examination Findings</span>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-1 bg-slate-50 p-3 rounded-lg border border-slate-150">
                <div>
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">Tooth Findings (FDI Notation)</span>
                  <p className="text-[11px] text-slate-850 mt-0.5 whitespace-pre-wrap">{toothFindings}</p>
                </div>
                <div>
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">Gingival State</span>
                  <p className="text-[11px] text-slate-850 mt-0.5 whitespace-pre-wrap">{findingsGingival}</p>
                </div>
              </div>
            </div>
            <div className="border-l-4 border-[#004ac6] pl-3 py-0.5">
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">Clinical Diagnosis</span>
              <p className="text-xs text-slate-800 font-semibold leading-relaxed mt-0.5">{diagnosis}</p>
            </div>
            <div className="border-l-4 border-slate-300 pl-3 py-0.5">
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">Treatment Performed</span>
              <p className="text-xs text-slate-800 leading-relaxed mt-0.5">{treatmentPerformed}</p>
            </div>
            <div className="border-l-4 border-slate-300 pl-3 py-0.5">
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">Patient Home Care Recommendations</span>
              <p className="text-xs text-slate-800 leading-relaxed mt-0.5">{recommendations}</p>
            </div>
            <div className="border-l-4 border-[#004ac6] pl-3 py-0.5">
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">Recall Interval</span>
              <p className="text-xs text-[#004ac6] font-bold mt-0.5">{recall}</p>
            </div>
          </div>
        </div>

        {/* Correspondence Summary */}
        <div className="mb-8 font-sans" style={{ pageBreakBefore: 'always' }}>
          <h3 className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider mb-2 border-b border-slate-100 pb-1">Patient Care Summary Letter (en-AU)</h3>
          <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
            <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">{patientLetter}</p>
          </div>
        </div>

        {/* Signatures */}
        <div className="mt-12 flex justify-between items-center border-t border-slate-200 pt-6">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-emerald-600 rounded-full"></span>
            <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">AI Verified Compliance Record</span>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold text-slate-700">{dentistName || 'Dr. Sarah Jenkins'}</p>
            <p className="text-[9px] text-slate-400 uppercase tracking-widest font-semibold">Registered Dentist</p>
            <div className="w-48 border-b border-slate-300 mt-6 inline-block"></div>
            <p className="text-[8px] text-slate-400 mt-1 uppercase tracking-wide">Signature / Authorization</p>
          </div>
        </div>
      </div>
    </>
  );
}
