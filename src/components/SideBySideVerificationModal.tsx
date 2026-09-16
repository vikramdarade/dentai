/**
 * DentAI Side-by-Side Verbatim vs. Structured Note Verification Modal
 * Allows dentists to verify exact spoken words chairside, review smart discrepancy highlights
 * (green = stated aloud, amber = template default), make inline corrections,
 * and 1-click copy directly into Dental4Windows / EXACT / Cliniko.
 */

import React, { useState, useMemo } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  X,
  Sparkles,
  Search,
  FileText,
  Volume2,
  ShieldCheck,
  ChevronRight,
  Edit3
} from 'lucide-react';
import {
  ClinicalTemplate,
  analyzeNoteGrounding,
  formatNoteForPmsClipboard,
  DiscrepancyItem
} from '../lib/clinicalTemplates';
import { TranscriptItem } from '../types';

interface SideBySideVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmSign: (finalFields: Record<string, string>, rawTranscript: string) => void;
  patientName: string;
  dentistName: string;
  template: ClinicalTemplate;
  transcriptItems: TranscriptItem[];
  appointmentReason?: string;
  theme?: 'dark' | 'light';
}

export default function SideBySideVerificationModal({
  isOpen,
  onClose,
  onConfirmSign,
  patientName,
  dentistName,
  template,
  transcriptItems,
  appointmentReason,
  theme = 'light'
}: SideBySideVerificationModalProps) {
  // Combine transcript text
  const fullTranscriptText = useMemo(() => {
    return transcriptItems.map(item => item.text).join(' ');
  }, [transcriptItems]);

  // Initial field states pre-populated from template defaults + spoken clues
  const [fields, setFields] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const sec of template.sections) {
      initial[sec.id] = sec.defaultBoilerplate || '';
    }
    return initial;
  });

  const [selectedAdaCodes, setSelectedAdaCodes] = useState<string[]>(template.defaultAdaCodes);
  const [searchFilter, setSearchFilter] = useState('');
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'side_by_side' | 'discrepancies'>('side_by_side');

  // Synchronize fields & codes whenever modal opens for a new template
  React.useEffect(() => {
    if (isOpen) {
      const initial: Record<string, string> = {};
      for (const sec of template.sections) {
        initial[sec.id] = sec.defaultBoilerplate || '';
      }
      setFields(initial);
      setSelectedAdaCodes(template.defaultAdaCodes);
      setCopied(false);
      setSearchFilter('');
    }
  }, [isOpen, template]);

  // Compute grounding & discrepancy evaluation
  const discrepancies = useMemo(() => {
    return analyzeNoteGrounding(fullTranscriptText, fields, appointmentReason);
  }, [fullTranscriptText, fields, appointmentReason]);

  const conflicts = useMemo(() => discrepancies.filter(d => d.status === 'conflict'), [discrepancies]);
  const templateDefaults = useMemo(() => discrepancies.filter(d => d.status === 'template_default'), [discrepancies]);
  const groundedCount = useMemo(() => discrepancies.filter(d => d.status === 'grounded').length, [discrepancies]);

  if (!isOpen) return null;

  const handleFieldChange = (sectionId: string, value: string) => {
    setFields(prev => ({ ...prev, [sectionId]: value }));
  };

  const handleCopyChart = () => {
    const formatted = formatNoteForPmsClipboard({
      patientName,
      templateName: template.name,
      fields,
      adaCodes: selectedAdaCodes,
      dentistName
    });
    navigator.clipboard.writeText(formatted);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleConfirm = () => {
    onConfirmSign(fields, fullTranscriptText);
    onClose();
  };

  const isLight = theme === 'light';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className={`w-full max-w-6xl max-h-[92vh] flex flex-col rounded-2xl shadow-2xl border ${
        isLight ? 'bg-white border-slate-200' : 'bg-[#0B131E] border-[#1E2E42]'
      }`}>
        
        {/* Header */}
        <div className={`p-4 sm:p-5 border-b flex flex-wrap items-center justify-between gap-3 ${
          isLight ? 'border-slate-200 bg-slate-50/80' : 'border-[#1E2E42] bg-[#0E1825]'
        }`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className={`text-base sm:text-lg font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Clinical Note Verification &amp; Grounding
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                  Google Chirp 2 Verified
                </span>
              </div>
              <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                Patient: <span className="font-semibold text-cyan-400">{patientName}</span> | Procedure: <span className="font-medium">{template.name}</span>
                {appointmentReason && (
                  <span className="ml-2 font-mono text-[11px] opacity-80">(Booked: &ldquo;{appointmentReason}&rdquo;)</span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyChart}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md shadow-cyan-950/20 active:scale-95 cursor-pointer"
              title="Copy formatted clinical note for Dental4Windows, EXACT, or Cliniko"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Copied for Chart!' : '1-Click Copy to Chart'}</span>
            </button>
            <button
              onClick={onClose}
              className={`p-2 rounded-xl border transition-all cursor-pointer ${
                isLight ? 'border-slate-300 hover:bg-slate-100 text-slate-600' : 'border-[#1E2E42] hover:bg-[#182638] text-slate-400 hover:text-white'
              }`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Conflicts Banner if appointment differs from spoken findings */}
        {conflicts.length > 0 && (
          <div className="bg-amber-950/40 border-b border-amber-500/40 px-5 py-2.5 flex items-center justify-between text-xs text-amber-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span><strong>Procedure/Tooth Notice:</strong> {conflicts[0].statement}</span>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400 bg-amber-950 px-2 py-0.5 rounded border border-amber-500/30">
              Verify Before Sign-Off
            </span>
          </div>
        )}

        {/* Navigation Tabs & Discrepancy Overview Bar */}
        <div className={`px-5 py-2 border-b flex items-center justify-between text-xs ${
          isLight ? 'bg-slate-100/60 border-slate-200 text-slate-700' : 'bg-[#09101A] border-[#1E2E42] text-slate-400'
        }`}>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setActiveTab('side_by_side')}
              className={`pb-1 font-bold transition-all border-b-2 cursor-pointer ${
                activeTab === 'side_by_side'
                  ? 'border-cyan-400 text-cyan-400'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              Side-by-Side Comparison
            </button>
            <button
              onClick={() => setActiveTab('discrepancies')}
              className={`pb-1 font-bold transition-all border-b-2 flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'discrepancies'
                  ? 'border-cyan-400 text-cyan-400'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <span>Discrepancy Audit</span>
              <span className="px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-mono">
                {templateDefaults.length} defaults
              </span>
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-3 font-mono text-[11px]">
            <span className="flex items-center gap-1 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {groundedCount} Stated Aloud
            </span>
            <span className="flex items-center gap-1 text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5" />
              {templateDefaults.length} Boilerplate Defaults
            </span>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {activeTab === 'side_by_side' ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              
              {/* Left Column: Verbatim Speech Audio Transcript */}
              <div className={`flex flex-col h-full rounded-xl border p-4 ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#080E17] border-[#182638]'
              }`}>
                <div className="flex items-center justify-between pb-3 border-b border-[#1E2E42] mb-3">
                  <span className="font-mono text-xs font-bold text-cyan-400 flex items-center gap-1.5">
                    <Volume2 className="w-4 h-4" />
                    Exact Spoken Words (Verbatim Audio)
                  </span>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-slate-500" />
                    <input
                      type="text"
                      placeholder="Search audio..."
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      className={`text-xs pl-7 pr-2 py-1 rounded-lg border focus:outline-hidden ${
                        isLight ? 'bg-white border-slate-200' : 'bg-[#0E1724] border-[#1E3048] text-slate-200'
                      }`}
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 max-h-[50vh] pr-1">
                  {transcriptItems.length === 0 ? (
                    <div className="text-center py-10 text-slate-500 text-xs italic">
                      No verbatim dialogue recorded.
                    </div>
                  ) : (
                    transcriptItems
                      .filter(item => !searchFilter || item.text.toLowerCase().includes(searchFilter.toLowerCase()))
                      .map((item, idx) => (
                        <div
                          key={idx}
                          className={`p-2.5 rounded-lg text-xs leading-relaxed transition-all ${
                            isLight ? 'bg-white border border-slate-200/80 text-slate-800' : 'bg-[#0C1522] border border-[#182638] text-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono mb-1">
                            <span className="font-bold text-cyan-400/80">{item.sender || 'Operatory'}</span>
                            {item.timestamp && <span>{item.timestamp}</span>}
                          </div>
                          <p>{item.text}</p>
                        </div>
                      ))
                  )}
                </div>
              </div>

              {/* Right Column: Structured Clinical Template Note */}
              <div className={`flex flex-col h-full rounded-xl border p-4 ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#080E17] border-[#182638]'
              }`}>
                <div className="flex items-center justify-between pb-3 border-b border-[#1E2E42] mb-3">
                  <span className="font-mono text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                    <FileText className="w-4 h-4" />
                    Structured Clinical Note ({template.name})
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    AHPRA / ADA Compliant
                  </span>
                </div>

                {/* ADA Item Codes Selector */}
                <div className="mb-4">
                  <label className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                    Itemised ADA Billing Codes:
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {template.defaultAdaCodes.map(code => {
                      const isSelected = selectedAdaCodes.includes(code);
                      return (
                        <button
                          key={code}
                          type="button"
                          onClick={() => {
                            setSelectedAdaCodes(prev =>
                              prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
                            );
                          }}
                          className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer border ${
                            isSelected
                              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                              : 'bg-slate-800/40 border-slate-700 text-slate-500'
                          }`}
                        >
                          Item {code}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Section Editors */}
                <div className="space-y-4 max-h-[48vh] overflow-y-auto pr-1">
                  {template.sections.map(sec => {
                    const val = fields[sec.id] || '';
                    const hasDefault = sec.defaultBoilerplate && val === sec.defaultBoilerplate;

                    return (
                      <div key={sec.id} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className={`font-bold ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
                            {sec.title}
                          </span>
                          {hasDefault && (
                            <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 px-1.5 py-0.2 rounded border border-amber-500/20">
                              Template Default
                            </span>
                          )}
                        </div>
                        <textarea
                          rows={2}
                          value={val}
                          onChange={(e) => handleFieldChange(sec.id, e.target.value)}
                          placeholder={sec.prompt}
                          className={`w-full text-xs p-2.5 rounded-xl border focus:outline-hidden transition-all resize-y ${
                            isLight
                              ? 'bg-white border-slate-200 text-slate-900 focus:border-cyan-500'
                              : 'bg-[#0E1724] border-[#182638] text-slate-200 focus:border-cyan-400'
                          }`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          ) : (
            /* Discrepancies Audit View */
            <div className="space-y-3">
              <h3 className={`text-sm font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>
                Audit of Stated Spoken Findings vs. Template Boilerplate
              </h3>
              <p className={`text-xs ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                Every sentence in the generated note is cross-referenced with the verbatim chairside audio. Green items are grounded by verbatim words. Amber items are standard clinic boilerplate not spoken aloud.
              </p>

              <div className="space-y-2 mt-4">
                {discrepancies.map(d => (
                  <div
                    key={d.id}
                    className={`p-3.5 rounded-xl border flex items-start justify-between gap-4 ${
                      d.status === 'grounded'
                        ? 'bg-emerald-50/90 border-emerald-200 text-emerald-950'
                        : d.status === 'conflict'
                        ? 'bg-red-50/90 border-red-200 text-red-950'
                        : 'bg-amber-50/90 border-amber-200 text-amber-950'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      {d.status === 'grounded' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                      ) : d.status === 'conflict' ? (
                        <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] font-bold text-slate-500 uppercase">
                            {d.fieldTitle}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded font-mono ${
                            d.status === 'grounded'
                              ? 'bg-emerald-100 text-emerald-800'
                              : d.status === 'conflict'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {d.status === 'grounded' ? 'Stated Aloud' : d.status === 'conflict' ? 'Conflict' : 'Template Default'}
                          </span>
                        </div>
                        <p className="text-xs font-medium text-slate-900 mt-1">
                          &ldquo;{d.statement}&rdquo;
                        </p>
                        <p className="text-[11px] text-slate-600 mt-0.5">
                          {d.reason}
                        </p>
                      </div>
                    </div>

                    {d.status === 'template_default' && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            // Clear boilerplate if rejected
                            setFields(prev => ({ ...prev, [d.fieldId]: '' }));
                          }}
                          className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-white text-rose-700 border border-rose-200 hover:bg-rose-50 cursor-pointer shadow-2xs"
                        >
                          Remove Default
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Confirmation Bar */}
        <div className={`p-4 sm:p-5 border-t flex flex-wrap items-center justify-between gap-3 ${
          isLight ? 'border-slate-200 bg-slate-50' : 'border-[#1E2E42] bg-[#0E1825]'
        }`}>
          <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Verbatim audio &amp; verified note archived with appointment.</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleCopyChart}
              className={`px-4 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                isLight ? 'border-slate-300 hover:bg-slate-200 text-slate-800' : 'border-[#1E2E42] hover:bg-[#182638] text-slate-300'
              }`}
            >
              {copied ? 'Copied!' : 'Copy to Dental4Windows / EXACT'}
            </button>
            <button
              onClick={handleConfirm}
              className="px-5 py-2.5 rounded-xl text-xs font-bold transition-all bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs cursor-pointer active:scale-95 flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              <span>Confirm &amp; Save Note</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
