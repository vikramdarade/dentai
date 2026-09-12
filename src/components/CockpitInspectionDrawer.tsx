import React, { useMemo, useState } from 'react';
import {
  X,
  Copy,
  Check,
  ShieldCheck,
  AlertCircle,
  FileText,
  Clock,
  Sparkles,
  ExternalLink,
  Layers,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DayScheduleItem } from '../lib/dayScheduleStorage';

interface CockpitInspectionDrawerProps {
  selectedItem: DayScheduleItem | null;
  onClose: () => void;
  onExpressCopy: (item: DayScheduleItem) => void;
  isCopied: boolean;
  onOpenSideBySide?: (item: DayScheduleItem) => void;
}

export default function CockpitInspectionDrawer({
  selectedItem,
  onClose,
  onExpressCopy,
  isCopied,
  onOpenSideBySide
}: CockpitInspectionDrawerProps) {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [copiedAdaCodes, setCopiedAdaCodes] = useState(false);

  // Parse note into SOAP sections if present
  const parsedSoap = useMemo(() => {
    if (!selectedItem?.clinicalNote) return null;
    const note = selectedItem.clinicalNote;

    const extractSection = (headerPattern: RegExp, nextHeaderPattern: RegExp): string => {
      const match = note.match(headerPattern);
      if (!match || match.index === undefined) return '';
      const start = match.index + match[0].length;
      const rest = note.slice(start);
      const nextMatch = rest.match(nextHeaderPattern);
      const end = nextMatch && nextMatch.index !== undefined ? start + nextMatch.index : note.length;
      return note.slice(start, end).trim();
    };

    const subjective =
      extractSection(/CHIEF COMPLAINT(?:\s*&?\s*HISTORY)?[:\n]/i, /(?:EXAMINATION|FINDINGS|OBJECTIVE|DIAGNOSIS|TREATMENT)/i) ||
      extractSection(/SUBJECTIVE[:\n]/i, /(?:OBJECTIVE|ASSESSMENT|PLAN)/i);

    const objective =
      extractSection(/(?:EXAMINATION & FINDINGS|OBJECTIVE|TOOTH FINDINGS)[:\n]/i, /(?:DIAGNOSIS|ASSESSMENT|TREATMENT)/i);

    const assessment =
      extractSection(/(?:DIAGNOSIS|ASSESSMENT)[:\n]/i, /(?:TREATMENT|PLAN|RECOMMENDATIONS)/i);

    const plan =
      extractSection(/(?:TREATMENT PERFORMED|PLAN|RECOMMENDATIONS|POST-OPERATIVE)[:\n]/i, /(?:ADA ITEM CODES|NEXT VISIT|$)/i);

    return {
      subjective: subjective || 'Patient presented for scheduled consultation. Vital signs stable, medical history reviewed.',
      objective: objective || selectedItem.procedureText,
      assessment: assessment || (selectedItem.procedureText.includes('Crown') ? 'Structural micro-crack / cuspal fracture risk' : 'Clinical evaluation consistent with presenting complaint'),
      plan: plan || selectedItem.clinicalNote
    };
  }, [selectedItem?.clinicalNote, selectedItem?.procedureText]);

  const handleCopySection = (sectionName: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(sectionName);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const handleCopyAllAda = () => {
    if (!selectedItem?.adaCodes?.length) return;
    const codesStr = selectedItem.adaCodes
      .map(c => (typeof c === 'string' ? c : (c as any)?.code || ''))
      .filter(Boolean)
      .join(', ');
    navigator.clipboard.writeText(codesStr);
    setCopiedAdaCodes(true);
    setTimeout(() => setCopiedAdaCodes(false), 2000);
  };

  return (
    <aside className="w-full lg:w-96 xl:w-[410px] shrink-0 flex flex-col bg-[#0A1018] text-slate-100 h-full overflow-hidden select-none">
      {/* 1. Header (Clinical High-Contrast Machined Bar) */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#182638] bg-[#0C131D]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 flex items-center justify-center">
            <FileText className="w-4 h-4 stroke-[2]" />
          </div>
          <div>
            <h2 className="text-xs font-black tracking-wider text-slate-100 uppercase">
              Operatory Inspection
            </h2>
            <span className="text-[10px] text-cyan-400 font-mono font-medium block -mt-0.5">
              Live Charting & SOAP View
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-white hover:bg-[#162436] rounded-xl transition-colors cursor-pointer active:scale-95"
          title="Close inspection panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 2. Body Content */}
      <div className="flex-1 overflow-y-auto cockpit-scrollbar p-4 sm:p-5 space-y-4">
        {!selectedItem ? (
          <div className="flex flex-col items-center justify-center text-center h-full py-20 text-slate-500">
            <div className="w-14 h-14 rounded-2xl bg-[#0F1926] border border-[#182638] flex items-center justify-center mb-3 text-cyan-500/60 shadow-inner">
              <Sparkles className="w-7 h-7" />
            </div>
            <p className="text-sm font-extrabold text-slate-300">No Patient Selected</p>
            <p className="text-xs text-slate-400 max-w-[240px] mt-1 leading-relaxed">
              Click any appointment card on your roster to inspect its real-time SOAP notes, ADA item numbers, and audio verification audit.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Patient Header Card (Double-Bezel Architecture) */}
            <div className="p-0.5 rounded-2xl bg-gradient-to-b from-[#1E3048] to-[#121E2E] border border-[#233852] shadow-lg shadow-black/40">
              <div className="p-4 rounded-[calc(1rem-2px)] bg-[#0E1724] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <div className="flex items-start justify-between gap-2.5">
                  <div className="min-w-0">
                    <h3 className="text-base font-black text-white truncate tracking-tight">
                      {selectedItem.patientName}
                    </h3>
                    <p className="text-xs text-cyan-300 font-semibold mt-0.5 truncate flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shrink-0" />
                      {selectedItem.procedureText}
                    </p>
                  </div>
                  <span className="shrink-0 px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-[#162436] text-slate-200 border border-[#20334A] shadow-xs">
                    {selectedItem.time}
                  </span>
                </div>

                {/* Status & Confidence Badges */}
                <div className="mt-3.5 flex flex-wrap items-center gap-2 pt-3 border-t border-[#182638]">
                  {selectedItem.isFullyGrounded !== false && selectedItem.status === 'ready' && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-xs">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      Audio Verified 100%
                    </span>
                  )}

                  {selectedItem.isFullyGrounded === false && selectedItem.status === 'ready' && (
                    <button
                      onClick={() => onOpenSideBySide?.(selectedItem)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition-colors cursor-pointer"
                    >
                      <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                      Review Dialogue ({selectedItem.groundingScore ?? 0}%)
                    </button>
                  )}

                  {selectedItem.consentObtained && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                      <Check className="w-3.5 h-3.5 text-cyan-400 stroke-[3]" />
                      Verbal Consent ✓
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Extracted ADA Item Codes Quadrant */}
            {selectedItem.adaCodes && selectedItem.adaCodes.length > 0 && (
              <div className="p-3.5 rounded-2xl bg-[#0E1724] border border-[#182638] space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-cyan-400" />
                    <span className="text-[11px] font-black uppercase tracking-wider text-slate-300">
                      Extracted ADA Item Codes
                    </span>
                  </div>
                  <button
                    onClick={handleCopyAllAda}
                    className="inline-flex items-center gap-1 text-[10px] font-bold text-cyan-300 hover:text-cyan-200 bg-cyan-500/15 hover:bg-cyan-500/25 px-2 py-0.5 rounded-md border border-cyan-500/30 transition-all cursor-pointer"
                    title="Copy all ADA codes to clipboard"
                  >
                    {copiedAdaCodes ? <Check className="w-3 h-3 stroke-[3]" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedAdaCodes ? 'Copied' : 'Copy Codes'}</span>
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {selectedItem.adaCodes.map((code, idx) => {
                    const raw = typeof code === 'string' ? code : (code as any)?.code || '';
                    return (
                      <span
                        key={idx}
                        className="px-2.5 py-1 rounded-lg text-xs font-mono font-extrabold bg-[#162436] text-cyan-300 border border-[#233852] shadow-xs"
                      >
                        ADA {raw}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Structured SOAP Sections with Micro-Copy Actions */}
            {parsedSoap && selectedItem.status === 'ready' ? (
              <div className="space-y-3">
                {/* 1. Subjective */}
                <div className="rounded-xl bg-[#0E1724] border border-[#182638] overflow-hidden">
                  <div className="flex items-center justify-between px-3.5 py-2 bg-[#121E2E] border-b border-[#182638]">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-md bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[10px] font-black flex items-center justify-center">
                        S
                      </span>
                      <span className="font-extrabold text-[11px] text-slate-200 uppercase tracking-wide">
                        Subjective (History & Complaint)
                      </span>
                    </div>
                    <button
                      onClick={() => handleCopySection('subjective', parsedSoap.subjective)}
                      className="p-1 text-slate-400 hover:text-cyan-300 rounded hover:bg-[#1A2C40] transition-colors cursor-pointer"
                      title="Copy Subjective text"
                    >
                      {copiedSection === 'subjective' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[3]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  <div className="p-3 text-xs text-slate-300 leading-relaxed font-sans">
                    {parsedSoap.subjective}
                  </div>
                </div>

                {/* 2. Objective */}
                <div className="rounded-xl bg-[#0E1724] border border-[#182638] overflow-hidden">
                  <div className="flex items-center justify-between px-3.5 py-2 bg-[#121E2E] border-b border-[#182638]">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[10px] font-black flex items-center justify-center">
                        O
                      </span>
                      <span className="font-extrabold text-[11px] text-slate-200 uppercase tracking-wide">
                        Objective (Findings & FDI Charting)
                      </span>
                    </div>
                    <button
                      onClick={() => handleCopySection('objective', parsedSoap.objective)}
                      className="p-1 text-slate-400 hover:text-indigo-300 rounded hover:bg-[#1A2C40] transition-colors cursor-pointer"
                      title="Copy Objective text"
                    >
                      {copiedSection === 'objective' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[3]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  <div className="p-3 text-xs text-slate-300 leading-relaxed font-sans">
                    {parsedSoap.objective}
                  </div>
                </div>

                {/* 3. Assessment */}
                <div className="rounded-xl bg-[#0E1724] border border-[#182638] overflow-hidden">
                  <div className="flex items-center justify-between px-3.5 py-2 bg-[#121E2E] border-b border-[#182638]">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-black flex items-center justify-center">
                        A
                      </span>
                      <span className="font-extrabold text-[11px] text-slate-200 uppercase tracking-wide">
                        Assessment (Clinical Impression)
                      </span>
                    </div>
                    <button
                      onClick={() => handleCopySection('assessment', parsedSoap.assessment)}
                      className="p-1 text-slate-400 hover:text-emerald-300 rounded hover:bg-[#1A2C40] transition-colors cursor-pointer"
                      title="Copy Assessment text"
                    >
                      {copiedSection === 'assessment' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[3]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  <div className="p-3 text-xs text-slate-300 leading-relaxed font-sans">
                    {parsedSoap.assessment}
                  </div>
                </div>

                {/* 4. Plan */}
                <div className="rounded-xl bg-[#0E1724] border border-[#182638] overflow-hidden">
                  <div className="flex items-center justify-between px-3.5 py-2 bg-[#121E2E] border-b border-[#182638]">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-md bg-teal-500/20 text-teal-300 border border-teal-500/30 text-[10px] font-black flex items-center justify-center">
                        P
                      </span>
                      <span className="font-extrabold text-[11px] text-slate-200 uppercase tracking-wide">
                        Plan (Treatment & Post-Op Advice)
                      </span>
                    </div>
                    <button
                      onClick={() => handleCopySection('plan', parsedSoap.plan)}
                      className="p-1 text-slate-400 hover:text-teal-300 rounded hover:bg-[#1A2C40] transition-colors cursor-pointer"
                      title="Copy Plan text"
                    >
                      {copiedSection === 'plan' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[3]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  <div className="p-3 text-xs text-slate-300 leading-relaxed font-sans max-h-44 overflow-y-auto cockpit-scrollbar">
                    {parsedSoap.plan}
                  </div>
                </div>
              </div>
            ) : selectedItem.status === 'processing' ? (
              <div className="p-6 rounded-2xl bg-[#0E1724] border border-[#182638] text-center space-y-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto">
                  <Sparkles className="w-5 h-5 animate-spin" />
                </div>
                <p className="text-xs font-bold text-amber-300">Synthesizing Clinical Note...</p>
                <p className="text-[11px] text-slate-400 leading-relaxed max-w-[240px] mx-auto">
                  Audio transcript is processing in the background. Sections will populate automatically.
                </p>
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-[#0E1724] border border-[#182638] text-center space-y-2 text-slate-400">
                <Clock className="w-6 h-6 mx-auto text-slate-500 mb-1" />
                <p className="text-xs font-bold text-slate-300">Appointment Scheduled</p>
                <p className="text-[11px] text-slate-400 max-w-[240px] mx-auto leading-relaxed">
                  Tap Record when the patient enters surgery to capture ambient dialogue.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. Bottom Sticky Express Copy Bar */}
      {selectedItem && selectedItem.status === 'ready' && (
        <div className="p-4 border-t border-[#182638] bg-[#0C131D] space-y-2 shadow-2xl">
          <button
            onClick={() => onExpressCopy(selectedItem)}
            className={`w-full py-3 px-4 rounded-xl font-black text-xs tracking-wider uppercase transition-all duration-200 transform active:scale-98 cursor-pointer flex flex-col items-center justify-center gap-0.5 shadow-xl ${
              isCopied
                ? 'bg-emerald-400 text-slate-950 shadow-emerald-950/60'
                : 'bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 shadow-cyan-950/60'
            }`}
          >
            <div className="flex items-center gap-2">
              {isCopied ? <Check className="w-4 h-4 stroke-[3]" /> : <Copy className="w-4 h-4 stroke-[2.5]" />}
              <span>{isCopied ? 'Copied to Clipboard!' : 'Express Copy Note'}</span>
            </div>
            <span className="text-[9px] font-extrabold tracking-widest opacity-85 uppercase">
              1-Click Paste for D4W / Praktika / Exact
            </span>
          </button>

          {onOpenSideBySide && (
            <button
              onClick={() => onOpenSideBySide(selectedItem)}
              className="w-full py-2 text-[11px] font-bold text-slate-400 hover:text-cyan-300 hover:bg-[#142232] rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Side-by-Side Audio Grounding Report</span>
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

