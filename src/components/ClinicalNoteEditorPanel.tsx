import React, { useState } from 'react';
import {
  FileText,
  Sparkles,
  Copy,
  Check,
  CheckCircle2,
  Tag,
  Camera,
  Layers,
  RefreshCw,
  ArrowRight
} from 'lucide-react';
import { CHAIRSIDE_MACRO_OPTIONS } from '../lib/australianClinicalMacros';

export interface ClinicalNoteEditorPanelProps {
  activeEncounterId: string;
  noteText: string;
  onNoteChange: (text: string) => void;
  isGenerating: boolean;
  onGenerateNote: () => void;
  onApplyMacro: (macroId: string) => void;
  onCopyPMS: (format: 'd4w' | 'exact' | 'universal') => void;
  copiedFormat: string | null;
  onOpenDeliverables?: () => void;
  onOpenCamera?: () => void;
  onNextPatient?: () => void;
  hasActualGeneratedNote: boolean;
  captureConfidence?: number;
}

export const ClinicalNoteEditorPanel: React.FC<ClinicalNoteEditorPanelProps> = ({
  activeEncounterId,
  noteText,
  onNoteChange,
  isGenerating,
  onGenerateNote,
  onApplyMacro,
  onCopyPMS,
  copiedFormat,
  onOpenDeliverables,
  onOpenCamera,
  onNextPatient,
  hasActualGeneratedNote,
  captureConfidence = 100,
}) => {
  const [selectedFormat, setSelectedFormat] = useState<'d4w' | 'exact' | 'universal'>('d4w');

  return (
    <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
      {/* Panel Header & 1-Click PMS Export Controls */}
      <div className="px-4 py-2.5 border-b border-slate-200/90 flex flex-wrap items-center justify-between gap-2.5 bg-slate-50/70">
        {/* Title & Grounding Verification Status */}
        <div className="flex items-center space-x-2">
          <FileText className="w-4 h-4 text-sky-600" />
          <h3 className="text-xs font-bold text-slate-900 tracking-wide uppercase">
            Clinical Note Canvas
          </h3>
          {hasActualGeneratedNote && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center space-x-1 shadow-2xs">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              <span>Verified from Audio</span>
            </span>
          )}
        </div>

        {/* Unified Primary Action Suite: Regenerate + PMS Format Switcher + Copy / Next Patient */}
        <div className="flex items-center space-x-2 flex-wrap sm:flex-nowrap">
          {/* Prominent Regenerate Note Button */}
          <button
            onClick={onGenerateNote}
            disabled={isGenerating}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-800 disabled:opacity-50 text-xs font-bold transition shadow-2xs cursor-pointer"
            title="Generate or recreate clinical note from consultation speech (⌘+G)"
          >
            {isGenerating ? (
              <RefreshCw className="w-3.5 h-3.5 text-sky-600 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-sky-600" />
            )}
            <span>{isGenerating ? 'Generating...' : 'Regenerate Note'}</span>
          </button>

          {/* PMS Format Selector (D4W, EXACT, Universal) */}
          <div className="flex rounded-xl border border-slate-200 bg-white p-0.5 shadow-2xs">
            <button
              onClick={() => setSelectedFormat('d4w')}
              className={`px-2 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                selectedFormat === 'd4w'
                  ? 'bg-sky-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              D4W
            </button>
            <button
              onClick={() => setSelectedFormat('exact')}
              className={`px-2 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                selectedFormat === 'exact'
                  ? 'bg-sky-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              EXACT
            </button>
            <button
              onClick={() => setSelectedFormat('universal')}
              className={`px-2 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                selectedFormat === 'universal'
                  ? 'bg-sky-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Universal
            </button>
          </div>

          {/* High-Contrast Copy to PMS / Next Patient Action */}
          <button
            onClick={() => {
              if (copiedFormat === selectedFormat && onNextPatient) {
                onNextPatient();
              } else {
                onCopyPMS(selectedFormat);
              }
            }}
            disabled={!noteText.trim()}
            className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl font-bold text-xs shadow-xs transition cursor-pointer disabled:opacity-40 ${
              copiedFormat === selectedFormat
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white ring-2 ring-emerald-400/40'
                : 'bg-slate-900 hover:bg-slate-800 text-white'
            }`}
            title={copiedFormat === selectedFormat ? 'Advance to next patient' : 'Copy formatted note to clipboard (⌘+C)'}
          >
            {copiedFormat === selectedFormat ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-200" />
                <span>Copied! Next Patient</span>
                <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-sky-400" />
                <span>Copy to {selectedFormat.toUpperCase()}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Operatory Quick-Pick Macros Bar */}
      <div className="px-4 py-2 bg-slate-50/50 border-b border-slate-200/80 flex items-center justify-between gap-2 overflow-x-auto custom-scrollbar">
        <div className="flex items-center space-x-1.5 flex-nowrap">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1 mr-1">
            <Tag className="w-3 h-3 text-slate-400" />
            <span>Macros:</span>
          </span>
          {CHAIRSIDE_MACRO_OPTIONS.slice(0, 6).map(macro => (
            <button
              key={macro.id}
              onClick={() => onApplyMacro(macro.id)}
              className="px-2.5 py-1 rounded-lg bg-white hover:bg-sky-50 hover:border-sky-300 border border-slate-200 text-[11px] font-semibold text-slate-700 whitespace-nowrap shadow-2xs transition cursor-pointer"
            >
              {macro.label}
            </button>
          ))}
        </div>

        {/* Secondary Operatory Tools */}
        <div className="flex items-center space-x-1.5 flex-shrink-0">
          {onOpenCamera && (
            <button
              onClick={onOpenCamera}
              className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs transition cursor-pointer shadow-2xs"
              title="Intraoral Camera Capture"
            >
              <Camera className="w-3.5 h-3.5 text-sky-600" />
            </button>
          )}

          {onOpenDeliverables && (
            <button
              onClick={onOpenDeliverables}
              className="flex items-center space-x-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition cursor-pointer"
              title="Post-op instructions, referrals & prescriptions"
            >
              <Layers className="w-3.5 h-3.5 text-sky-600" />
              <span>Deliverables</span>
            </button>
          )}
        </div>
      </div>

      {/* Full Monospace Clinical Note Canvas (Maximized Space, No SOAP Box Clutter) */}
      <div className="flex-1 p-3.5 bg-white flex flex-col min-h-[320px]">
        <textarea
          value={noteText}
          onChange={e => onNoteChange(e.target.value)}
          placeholder="Clinical note will generate automatically as consultation progresses, or click [Regenerate Note] / select a macro above..."
          className="w-full flex-1 p-3.5 rounded-xl border border-slate-200 text-xs font-mono text-slate-800 leading-relaxed bg-[#FCFCFD] focus:outline-none focus:border-sky-500 focus:bg-white resize-none custom-scrollbar"
        />
      </div>
    </div>
  );
};
