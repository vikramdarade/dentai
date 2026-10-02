import React from 'react';

interface KeyboardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function KeyboardModal({ isOpen, onClose }: KeyboardModalProps) {
  if (!isOpen) return null;

  const shortcuts = [
    { key: 'Spacebar', desc: 'Start / Pause / Resume live transcription' },
    { key: '⌘ + Enter / Ctrl + Enter', desc: 'Generate clinical note from transcript' },
    { key: '⌘ + N / Ctrl + N', desc: 'Start new patient session (forces mic standby)' },
    { key: '⌘ + C / Ctrl + C', desc: 'Copy formatted clinical note to clipboard' },
    { key: 'Shift + ? / S', desc: 'Open / close this keyboard shortcuts cheat-sheet' },
    { key: 'Esc', desc: 'Close any open drawer or modal' },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Hands-Free Keyboard Shortcuts"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-[#FAF9F7]">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>⌨️</span> Hands-Free Keyboard Shortcuts
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Control the operatory without breaking sterile gloving protocol.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
            aria-label="Close shortcuts modal"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Shortcuts List */}
        <div className="p-6 divide-y divide-slate-100 space-y-3">
          {shortcuts.map((sc, idx) => (
            <div key={idx} className="flex items-center justify-between pt-3 first:pt-0">
              <span className="text-xs text-slate-700">{sc.desc}</span>
              <kbd className="px-2.5 py-1 text-[11px] font-mono font-semibold bg-slate-100 border border-slate-300 text-slate-800 rounded-md shadow-2xs">
                {sc.key}
              </kbd>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-[#FAF9F7] flex items-center justify-between text-xs text-slate-500">
          <span>Aseptic operatory design compliant (Rule 9)</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
