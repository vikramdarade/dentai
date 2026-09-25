import React from 'react';
import { Mic, Pause, AlertCircle, ArrowRight, ArrowLeft, Copy } from 'lucide-react';

export interface AsepticShortcutFootbarProps {
  isRecording: boolean;
  isPaused: boolean;
  isMicStandby: boolean;
  isSilenceWarning: boolean;
  silenceSecondsRemaining: number;
  activePatientName?: string;
  onToggleAudio: () => void;
  onNextPatient: () => void;
  onPrevPatient: () => void;
  onCopyPMS: () => void;
}

export const AsepticShortcutFootbar: React.FC<AsepticShortcutFootbarProps> = ({
  isRecording,
  isPaused,
  isMicStandby,
  isSilenceWarning,
  silenceSecondsRemaining,
  activePatientName,
  onToggleAudio,
  onNextPatient,
  onPrevPatient,
  onCopyPMS,
}) => {
  // Determine primary audio state indicator
  let stateLabel = 'STANDBY';
  let badgeColor = 'bg-slate-100 text-slate-700 border-slate-300';
  let dotColor = 'bg-slate-400';

  if (isSilenceWarning) {
    stateLabel = `SILENCE WARNING (${silenceSecondsRemaining}s)`;
    badgeColor = 'bg-amber-100 text-amber-900 border-amber-300 animate-pulse';
    dotColor = 'bg-amber-500 animate-ping';
  } else if (!isMicStandby && !isPaused) {
    stateLabel = 'LIVE RECORDING';
    badgeColor = 'bg-emerald-50 text-emerald-800 border-emerald-300 shadow-xs';
    dotColor = 'bg-emerald-500 animate-pulse';
  } else if (isPaused) {
    stateLabel = 'PAUSED';
    badgeColor = 'bg-amber-50 text-amber-800 border-amber-200';
    dotColor = 'bg-amber-500';
  }

  return (
    <footer className="h-11 bg-white border-t border-slate-200/80 px-4 flex items-center justify-between z-30 select-none shadow-[0_-1px_3px_0_rgba(15,23,42,0.02)]">
      {/* Operatory Mic Status Pill */}
      <div className="flex items-center space-x-3">
        <div className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${badgeColor}`}>
          <span className={`w-2 h-2 rounded-full ${dotColor}`} />
          <span className="tracking-wide uppercase font-mono">{stateLabel}</span>
        </div>

        {activePatientName && (
          <span className="hidden sm:inline text-xs text-slate-500 font-medium truncate max-w-[200px]">
            In Chair: <strong className="text-slate-800 font-semibold">{activePatientName}</strong>
          </span>
        )}
      </div>

      {/* Hands-Free Tactile Shortcut Pills */}
      <div className="flex items-center space-x-2">
        <button
          onClick={onToggleAudio}
          className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-50/80 hover:bg-slate-100 text-slate-700 hover:text-slate-900 border border-slate-200/90 text-xs font-medium shadow-2xs cursor-pointer"
          title="Toggle microphone (Spacebar)"
        >
          {isMicStandby || isPaused ? (
            <Mic className="w-3.5 h-3.5 text-emerald-600" />
          ) : (
            <Pause className="w-3.5 h-3.5 text-amber-600" />
          )}
          <span>{isMicStandby || isPaused ? 'Listen' : 'Pause'}</span>
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-white border border-slate-200/90 rounded text-slate-500 shadow-2xs">
            Space
          </kbd>
        </button>

        <button
          onClick={onCopyPMS}
          className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-50/80 hover:bg-slate-100 text-slate-700 hover:text-slate-900 border border-slate-200/90 text-xs font-medium shadow-2xs cursor-pointer"
          title="Copy note to PMS (⌘+Shift+C)"
        >
          <Copy className="w-3.5 h-3.5 text-sky-600" />
          <span>Copy PMS</span>
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-white border border-slate-200/90 rounded text-slate-500 shadow-2xs">
            ⌘⇧C
          </kbd>
        </button>

        <div className="h-4 w-px bg-slate-200/80 mx-1 hidden md:block" />

        <div className="hidden md:flex items-center space-x-1">
          <button
            onClick={onPrevPatient}
            className="flex items-center space-x-1 px-2 py-1 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 text-xs cursor-pointer"
            title="Previous patient (⌘+Left)"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <kbd className="px-1 py-0.5 text-[9px] font-mono bg-white border border-slate-200/90 rounded text-slate-500 shadow-2xs">
              ⌘←
            </kbd>
          </button>

          <button
            onClick={onNextPatient}
            className="flex items-center space-x-1 px-2 py-1 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 text-xs cursor-pointer"
            title="Next patient (⌘+Right)"
          >
            <kbd className="px-1 py-0.5 text-[9px] font-mono bg-white border border-slate-200/90 rounded text-slate-500 shadow-2xs">
              ⌘→
            </kbd>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </footer>
  );
};
