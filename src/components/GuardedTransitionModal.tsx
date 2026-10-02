import React, { useEffect } from 'react';
import { AlertTriangle, ArrowRight, Disc, RefreshCw, Trash2, X } from 'lucide-react';

export interface GuardedTransitionModalProps {
  isOpen: boolean;
  currentPatientName: string;
  targetPatientName: string;
  onSaveAndSwitch: () => void;
  onMoveAudioAndContinue: () => void;
  onDiscardAndSwitch: () => void;
  onCancel: () => void;
}

export const GuardedTransitionModal: React.FC<GuardedTransitionModalProps> = ({
  isOpen,
  currentPatientName,
  targetPatientName,
  onSaveAndSwitch,
  onMoveAudioAndContinue,
  onDiscardAndSwitch,
  onCancel,
}) => {
  // Prevent spacebar or keyboard shortcuts from accidentally triggering actions
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
      // Trap spacebar and enter from accidental triggering
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-amber-500/10 border-b border-amber-200/60 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shadow-2xs">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Active Recording in Progress</h3>
              <p className="text-xs text-amber-900 font-medium">Please confirm patient audio allocation</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white/60 transition cursor-pointer"
            title="Cancel and stay on current patient"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Context Summary */}
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <p className="text-xs text-slate-600 leading-relaxed">
            You are currently recording audio for <strong className="text-slate-900 font-semibold">{currentPatientName}</strong>, but selected <strong className="text-sky-700 font-semibold">{targetPatientName}</strong>. How would you like to handle this recording?
          </p>
        </div>

        {/* Three Distinct Action Choices */}
        <div className="p-6 space-y-3">
          {/* Option 2 (Primary Recommendation): Move audio & keep recording */}
          <button
            type="button"
            onClick={onMoveAudioAndContinue}
            className="w-full text-left p-3.5 rounded-xl border-2 border-sky-600 bg-sky-50/60 hover:bg-sky-100/70 transition cursor-pointer group flex items-start space-x-3 shadow-2xs"
          >
            <div className="w-7 h-7 rounded-lg bg-sky-600 text-white flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
              <RefreshCw className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-sky-950">Audio belongs to {targetPatientName}</span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-sky-700 bg-sky-200/80 px-2 py-0.5 rounded-md">Recommended</span>
              </div>
              <p className="text-[11px] text-sky-800/90 mt-0.5 leading-snug">
                Move recorded audio to <strong>{targetPatientName}</strong> and keep listening without interruption.
              </p>
            </div>
          </button>

          {/* Option 1: Save to Current & Switch */}
          <button
            type="button"
            onClick={onSaveAndSwitch}
            className="w-full text-left p-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 transition cursor-pointer group flex items-start space-x-3 shadow-2xs"
          >
            <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
              <Disc className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <span className="text-xs font-bold text-slate-800">Save audio for {currentPatientName} &amp; Switch</span>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                Finalize note for {currentPatientName}, pause recording, and open {targetPatientName} in ready standby.
              </p>
            </div>
          </button>

          {/* Option 3: Discard Audio & Switch */}
          <button
            type="button"
            onClick={onDiscardAndSwitch}
            className="w-full text-left p-3 rounded-xl border border-rose-200/80 bg-rose-50/40 hover:bg-rose-50/90 hover:border-rose-300 transition cursor-pointer group flex items-start space-x-3"
          >
            <div className="w-6 h-6 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 mt-0.5">
              <Trash2 className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1">
              <span className="text-xs font-semibold text-rose-800">Discard audio &amp; Switch</span>
              <p className="text-[11px] text-rose-600/90 mt-0.5">
                Discard this session's audio and open {targetPatientName}.
              </p>
            </div>
          </button>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">Strict confirmation required to protect patient records</span>
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold transition cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
