import React, { useEffect, useMemo, useState } from 'react';
import type { Consultation } from '../../types';
import { splitConsultationTranscript, type TranscriptSplit } from '../../lib/sessionSeparator';

interface SplitSessionModalProps {
  session: Consultation;
  onClose: () => void;
  onSplit: (split: TranscriptSplit) => void;
}

const SPEAKER_CHIP: Record<string, string> = {
  Dentist: 'bg-blue-50 text-blue-700',
  Patient: 'bg-amber-50 text-amber-700',
  Dialogue: 'bg-slate-100 text-slate-600',
  'Clinical Comment': 'bg-emerald-50 text-emerald-700',
};

export default function SplitSessionModal({ session, onClose, onSplit }: SplitSessionModalProps) {
  const transcript = session.transcript ?? [];
  const length = transcript.length;
  const canSplit = length >= 2;
  const [splitIndex, setSplitIndex] = useState(() => (canSplit ? Math.ceil(length / 2) : 0));
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // Escape closes; preventDefault so the key cannot leak into the workspace
  // behind the dialog (or trigger a browser default) as it unmounts.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const index = canSplit ? Math.min(Math.max(splitIndex, 1), length - 1) : 0;
  const sessionACount = canSplit ? index : length;
  const sessionBCount = canSplit ? length - index : 0;

  const patientLabel = useMemo(
    () => `${session.firstName ?? ''} ${session.lastName ?? ''}`.trim() || 'Unnamed patient',
    [session.firstName, session.lastName],
  );

  const handleConfirm = () => {
    try {
      const split = splitConsultationTranscript(session, index);
      onSplit(split);
      onClose();
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : 'Unable to separate this session.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="split-session-title"
        className="bg-white rounded-2xl max-w-2xl w-full max-h-[86vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-100">
          <div>
            <h3 id="split-session-title" className="text-sm font-bold text-slate-900">
              ✂️ Separate Merged Session
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {patientLabel} · {length} utterances. Choose the first line that belongs to the second patient.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {!canSplit ? (
          <div className="px-6 py-10 text-center text-xs text-slate-500">
            This session needs at least two utterances before it can be separated.
          </div>
        ) : (
          <>
            {/* Slider */}
            <div className="px-6 pt-4 pb-3 border-b border-slate-100 bg-[#FAF9F7]">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 mb-2">
                <span className="text-indigo-700">Session A · {sessionACount} utterances</span>
                <span className="text-amber-700">Session B · {sessionBCount} utterances</span>
              </div>
              <input
                type="range"
                min={1}
                max={length - 1}
                step={1}
                value={index}
                onChange={(event) => {
                  setConfirmError(null);
                  setSplitIndex(Number(event.target.value));
                }}
                aria-label="First utterance of the second session"
                className="w-full accent-indigo-600 cursor-pointer"
              />
              <div className="mt-1 text-center text-[11px] text-slate-500">
                Split point: line <span className="font-semibold text-slate-700">{index + 1}</span> of {length}
              </div>
            </div>

            {/* Transcript preview with the divider at the split point */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="flex flex-col gap-1.5">
                {transcript.map((item, itemIndex) => (
                  <React.Fragment key={itemIndex}>
                    {itemIndex === index && (
                      <div className="flex items-center gap-3 py-1.5" aria-label="Session split point">
                        <span className="flex-1 h-px bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
                        <span className="text-[10px] font-bold tracking-widest uppercase text-amber-700">
                          Session B starts here
                        </span>
                        <span className="flex-1 h-px bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
                      </div>
                    )}
                    <div
                      className={`flex items-start gap-2.5 rounded-xl border px-3 py-2 text-xs ${
                        itemIndex < index
                          ? 'border-indigo-100 bg-indigo-50/40'
                          : 'border-amber-100 bg-amber-50/40'
                      }`}
                    >
                      <span className="w-5 text-right text-[10px] text-slate-400 pt-0.5 flex-shrink-0">
                        {itemIndex + 1}
                      </span>
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md flex-shrink-0 ${
                          SPEAKER_CHIP[item.sender] ?? 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {item.sender}
                      </span>
                      <span className="text-slate-700 leading-relaxed">{item.text}</span>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-white">
          {confirmError && <p className="text-[11px] text-red-600 mb-2">{confirmError}</p>}
          <div className="flex items-center justify-between gap-4">
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Session A keeps <span className="font-mono text-slate-700">{session.id}</span>. Session B becomes{' '}
              <span className="font-mono text-slate-700">sess-&lt;timestamp&gt;</span>, filed{' '}
              <span className="font-semibold text-slate-700">In Review</span> until its patient is confirmed.
            </p>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!canSplit}
                className="px-3.5 py-2 rounded-xl bg-[#2A1D24] text-white text-xs font-semibold hover:bg-[#3D2C35] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                Separate into 2 sessions
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
