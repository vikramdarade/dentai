import React from 'react';
import { Clipboard, FileText, Check, Copy, X } from 'lucide-react';
import type { Consultation } from '../types';
import type { PatientEncounter } from './ChairsideWorkspace';

export interface BatchTrayModalProps {
  isOpen: boolean;
  onClose: () => void;
  completedEncounters: PatientEncounter[];
  consultations: Consultation[];
  handleCopyAllBatchNotes: () => void;
  allBatchCopied: boolean;
  copiedBatchIndex: number | null;
  setCopiedBatchIndex: (idx: number | null) => void;
  getFormattedNoteText: (consult?: Consultation) => string;
}

export const BatchTrayModal: React.FC<BatchTrayModalProps> = ({
  isOpen,
  onClose,
  completedEncounters,
  consultations,
  handleCopyAllBatchNotes,
  allBatchCopied,
  copiedBatchIndex,
  setCopiedBatchIndex,
  getFormattedNoteText,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex justify-end z-50">
      <div className="bg-white w-full max-w-xl h-full shadow-2xl flex flex-col border-l border-slate-200">
        {/* Tray Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0 bg-white">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-200 text-teal-800 flex items-center justify-center">
              <Clipboard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 tracking-tight">End-of-Day Notes Review</h3>
              <p className="text-xs text-slate-500">
                {completedEncounters.length} completed patient notes ready to copy
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center cursor-pointer transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Master Action Banner */}
        <div className="p-4 bg-slate-50/80 border-b border-slate-200 flex-shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
              Copy All Notes
            </span>
            <span className="text-[10px] text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full font-bold border border-teal-200">
              Dentrix • Eaglesoft • Open Dental
            </span>
          </div>
          <button
            onClick={handleCopyAllBatchNotes}
            disabled={completedEncounters.length === 0}
            className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center space-x-2 transition shadow-xs cursor-pointer ${allBatchCopied
              ? 'bg-emerald-600 text-white'
              : 'bg-teal-800 hover:bg-teal-900 disabled:opacity-50 text-white'
              }`}
          >
            {allBatchCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>
              {allBatchCopied
                ? `Copied All ${completedEncounters.length} Notes to Clipboard!`
                : `Copy All Notes for PMS (${completedEncounters.length} Ready)`}
            </span>
          </button>
        </div>

        {/* Completed Notes Scroll Area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3.5 custom-scrollbar bg-[#F8FAFC]">
          {completedEncounters.length === 0 ? (
            <div className="text-center py-16 px-6 bg-white border border-dashed border-slate-200 rounded-2xl">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
                <FileText className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-slate-800 mb-1">No Finalized Notes Yet</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                Patient notes finalized during consultations or via "Next Patient" will queue here for rapid batch review during lunch or at 5:00 PM.
              </p>
            </div>
          ) : (
            completedEncounters.map((p, idx) => {
              const consult = consultations.find(c => c.id === p.id);
              const isCopied = copiedBatchIndex === idx;

              return (
                <div
                  key={p.id}
                  className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-2.5"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center space-x-2 mb-0.5">
                        <span className="text-xs font-bold text-slate-900 font-sans">{p.patientName}</span>
                        <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded font-medium">
                          {p.time} • {p.operatory}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 truncate max-w-xs">{p.procedureText}</p>
                    </div>
                    <button
                      onClick={() => {
                        const text = getFormattedNoteText(consult);
                        if (text && navigator.clipboard) {
                          navigator.clipboard.writeText(text);
                        }
                        setCopiedBatchIndex(idx);
                        setTimeout(() => setCopiedBatchIndex(null), 2000);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition cursor-pointer ${isCopied
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-300'
                        : 'bg-slate-100 hover:bg-teal-50 text-slate-700 hover:text-teal-800 border border-slate-200'
                        }`}
                      title="Copy this patient's clinical note"
                    >
                      {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{isCopied ? 'Copied!' : 'Copy Note'}</span>
                    </button>
                  </div>

                  {/* Excerpt */}
                  {p.soap && (
                    <div className="text-[11px] text-slate-600 bg-slate-50/70 p-2.5 rounded-lg border border-slate-100 leading-relaxed font-mono">
                      <span className="text-slate-800 font-bold block mb-0.5 font-sans">SOAP Summary:</span>
                      <span className="line-clamp-2">
                        {p.soap.treatmentPerformed || p.soap.assessment || p.soap.subjective}
                      </span>
                    </div>
                  )}

                  {/* CDT Codes */}
                  {p.cdtCodes && p.cdtCodes.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {p.cdtCodes.map((c, cIdx) => (
                        <span
                          key={cIdx}
                          className="text-[10px] font-mono bg-teal-50 text-teal-800 border border-teal-200 px-1.5 py-0.2 rounded"
                        >
                          {c.code}: {c.desc}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Tray Footer */}
        <div className="p-4 border-t border-slate-200 flex items-center justify-between bg-white flex-shrink-0">
          <span className="text-xs text-slate-500 font-medium">
            {completedEncounters.length} completed encounters queued
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
          >
            Close Tray
          </button>
        </div>
      </div>
    </div>
  );
};
