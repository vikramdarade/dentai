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
  AlertCircle
} from 'lucide-react';
import { CHAIRSIDE_MACRO_OPTIONS } from '../lib/australianClinicalMacros';

export interface VerifiedSections {
  subjective?: boolean;
  objective?: boolean;
  assessment?: boolean;
  plan?: boolean;
}

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
  verifiedSections?: VerifiedSections;
  onToggleVerifySection?: (section: 'subjective' | 'objective' | 'assessment' | 'plan') => void;
  onVerifyAll?: () => void;
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
  verifiedSections = {} as VerifiedSections,
  onToggleVerifySection,
  onVerifyAll,
  hasActualGeneratedNote,
  captureConfidence = 100,
}) => {
  const [selectedFormat, setSelectedFormat] = useState<'d4w' | 'exact' | 'universal'>('d4w');

  const allVerified = Boolean(
    verifiedSections.subjective &&
    verifiedSections.objective &&
    verifiedSections.assessment &&
    verifiedSections.plan
  );

  return (
    <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
      {/* Panel Header & 1-Click PMS Export Controls */}
      <div className="px-4 py-3 border-b border-slate-200/90 flex flex-wrap items-center justify-between gap-2 bg-slate-50/50">
        <div className="flex items-center space-x-2">
          <FileText className="w-4 h-4 text-sky-600" />
          <h3 className="text-xs font-bold text-slate-900 tracking-wide uppercase">
            Clinical Note Canvas
          </h3>
          {hasActualGeneratedNote && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center space-x-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              <span>Verified from Audio</span>
            </span>
          )}
        </div>

        {/* PMS Format Selector & Copy Action */}
        <div className="flex items-center space-x-1.5">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              onClick={() => setSelectedFormat('d4w')}
              className={`px-2 py-1 text-[11px] font-bold rounded-md transition cursor-pointer ${
                selectedFormat === 'd4w'
                  ? 'bg-sky-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              D4W
            </button>
            <button
              onClick={() => setSelectedFormat('exact')}
              className={`px-2 py-1 text-[11px] font-bold rounded-md transition cursor-pointer ${
                selectedFormat === 'exact'
                  ? 'bg-sky-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              EXACT
            </button>
            <button
              onClick={() => setSelectedFormat('universal')}
              className={`px-2 py-1 text-[11px] font-bold rounded-md transition cursor-pointer ${
                selectedFormat === 'universal'
                  ? 'bg-sky-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Universal
            </button>
          </div>

          <button
            onClick={() => onCopyPMS(selectedFormat)}
            disabled={!noteText.trim()}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl font-bold text-xs shadow-xs transition cursor-pointer disabled:opacity-40 ${
              copiedFormat === selectedFormat
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-900 hover:bg-slate-800 text-white'
            }`}
            title="Copy formatted note to clipboard (⌘+Shift+C)"
          >
            {copiedFormat === selectedFormat ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Copied!</span>
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
      <div className="px-4 py-2 bg-slate-50/80 border-b border-slate-200/80 flex items-center justify-between gap-2 overflow-x-auto custom-scrollbar">
        <div className="flex items-center space-x-1.5 flex-nowrap">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1 mr-1">
            <Tag className="w-3 h-3 text-slate-400" />
            <span>Macros:</span>
          </span>
          {CHAIRSIDE_MACRO_OPTIONS.slice(0, 6).map(macro => (
            <button
              key={macro.id}
              onClick={() => onApplyMacro(macro.id)}
              className="px-2 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[11px] font-semibold text-slate-700 whitespace-nowrap shadow-2xs transition cursor-pointer"
            >
              {macro.label}
            </button>
          ))}
        </div>

        {/* Secondary Operatory Actions */}
        <div className="flex items-center space-x-1 flex-shrink-0">
          {onOpenCamera && (
            <button
              onClick={onOpenCamera}
              className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs transition cursor-pointer"
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

          <button
            onClick={onGenerateNote}
            disabled={isGenerating}
            className="flex items-center space-x-1.5 px-3 py-1 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-bold transition shadow-xs cursor-pointer ml-1"
          >
            {isGenerating ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span>{isGenerating ? 'Generating...' : 'Regenerate Note'}</span>
          </button>
        </div>
      </div>

      {/* AHPRA Section Verification Strip */}
      <div className="px-4 py-2 bg-white border-b border-slate-200/80 flex items-center justify-between text-xs">
        <div className="flex items-center space-x-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            AHPRA Verification:
          </span>
          {(['subjective', 'objective', 'assessment', 'plan'] as const).map(sec => (
            <label
              key={sec}
              onClick={() => onToggleVerifySection?.(sec)}
              className="flex items-center space-x-1.5 cursor-pointer select-none text-[11px] font-semibold text-slate-700"
            >
              <input
                type="checkbox"
                checked={Boolean(verifiedSections[sec])}
                readOnly
                className="w-3.5 h-3.5 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
              />
              <span className="capitalize">{sec}</span>
            </label>
          ))}
        </div>

        {onVerifyAll && (
          <button
            onClick={onVerifyAll}
            className={`text-[11px] font-bold transition cursor-pointer ${
              allVerified ? 'text-emerald-700' : 'text-sky-700 hover:text-sky-800'
            }`}
          >
            {allVerified ? '✓ All Verified' : 'Verify All'}
          </button>
        )}
      </div>

      {/* Editable Clinical Note Canvas */}
      <div className="flex-1 p-4 bg-white flex flex-col min-h-[300px]">
        <textarea
          value={noteText}
          onChange={e => onNoteChange(e.target.value)}
          placeholder="Clinical note will generate automatically as consultation progresses, or select a macro above..."
          className="w-full flex-1 p-3 rounded-xl border border-slate-200 text-xs text-slate-800 leading-relaxed font-mono bg-slate-50/40 focus:outline-none focus:border-sky-500 focus:bg-white resize-none custom-scrollbar"
        />
      </div>
    </div>
  );
};
