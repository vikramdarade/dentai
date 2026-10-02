import React, { useEffect, useState } from 'react';
import type { TranscriptItem } from '../../types';

type Speaker = TranscriptItem['sender'];

const SPEAKER_CYCLE: Speaker[] = ['Dentist', 'Patient', 'Dialogue', 'Clinical Comment'];

interface SpeakerStyle {
  bubble: string;
  badge: string;
  row: string;
}

const SPEAKER_STYLES: Record<Speaker, SpeakerStyle> = {
  Dentist: {
    row: 'justify-end',
    bubble: 'bg-blue-50 border-blue-100 text-slate-800 rounded-2xl rounded-br-md',
    badge: 'bg-blue-600 text-white',
  },
  Patient: {
    row: 'justify-start',
    bubble: 'bg-white border-slate-200 text-slate-800 rounded-2xl rounded-bl-md',
    badge: 'bg-amber-500 text-white',
  },
  Dialogue: {
    row: 'justify-center',
    bubble: 'bg-slate-50 border-slate-200 text-slate-700 italic rounded-2xl',
    badge: 'bg-slate-500 text-white',
  },
  'Clinical Comment': {
    row: 'justify-center',
    bubble: 'bg-emerald-50/70 border-emerald-200 border-dashed text-emerald-900 rounded-2xl',
    badge: 'bg-emerald-600 text-white',
  },
};

interface TranscriptTabProps {
  transcript?: TranscriptItem[];
  /** Full replacement array — every edit and badge change flows through this. */
  onUpdateTranscript?: (next: TranscriptItem[]) => void;
  /** Opens the split-session modal (owned by the parent). */
  onSeparateMergedSession?: () => void;
  /** Show the live-listening affordance while the recorder is running. */
  isLive?: boolean;
  emptyHint?: string;
}

export default function TranscriptTab({
  transcript = [],
  onUpdateTranscript,
  onSeparateMergedSession,
  isLive = false,
  emptyHint = 'No audio lines recorded yet. Start the microphone above to capture the consultation.',
}: TranscriptTabProps) {
  const [items, setItems] = useState<TranscriptItem[]>(transcript);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftText, setDraftText] = useState('');

  // Adopt parent-side changes, but keep an in-progress edit from being wiped by
  // an unrelated re-render.
  useEffect(() => {
    setItems(transcript);
    setEditingIndex(null);
  }, [transcript]);

  const commit = (next: TranscriptItem[]) => {
    setItems(next);
    onUpdateTranscript?.(next);
  };

  const cycleSpeaker = (index: number) => {
    const current = items[index];
    if (!current) return;
    const nextSpeaker = SPEAKER_CYCLE[(SPEAKER_CYCLE.indexOf(current.sender) + 1) % SPEAKER_CYCLE.length];
    const next = items.map((item, i) => (i === index ? { ...item, sender: nextSpeaker } : item));
    commit(next);
  };

  const startEditing = (index: number) => {
    setEditingIndex(index);
    setDraftText(items[index]?.text ?? '');
  };

  const commitEdit = () => {
    if (editingIndex == null) return;
    const trimmed = draftText.trim();
    const current = items[editingIndex];
    const next =
      current && trimmed.length > 0 && trimmed !== current.text
        ? items.map((item, i) => (i === editingIndex ? { ...item, text: trimmed } : item))
        : items;
    setEditingIndex(null);
    setDraftText('');
    if (next !== items) commit(next);
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setDraftText('');
  };

  const canSeparate = items.length >= 2;

  return (
    <div className="flex flex-col h-full bg-[#FAF9F7]">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 px-6 py-3 bg-white border-b border-slate-200/80">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-slate-900">Verbatim Speech Transcript</h3>
          {isLive && (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-red-600">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              Listening…
            </span>
          )}
          <span className="text-[11px] text-slate-400">
            {items.length} utterance{items.length === 1 ? '' : 's'}
          </span>
        </div>

        <button
          type="button"
          onClick={onSeparateMergedSession}
          disabled={!canSeparate || !onSeparateMergedSession}
          title={
            canSeparate
              ? 'Separate merged visits if two patients were recorded consecutively'
              : 'At least two utterances are needed before a session can be separated'
          }
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          <span aria-hidden>✂️</span>
          <span>Separate Merged Session</span>
        </button>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {items.length === 0 ? (
          <div className="max-w-xl mx-auto flex flex-col items-center justify-center gap-2 p-12 text-slate-400 text-xs border border-dashed border-slate-300 rounded-2xl bg-white/50">
            <span className="text-2xl" aria-hidden>
              🎙️
            </span>
            <span className="text-center leading-relaxed">{emptyHint}</span>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto flex flex-col gap-3">
            {items.map((item, index) => {
              const style = SPEAKER_STYLES[item.sender];
              const isEditing = editingIndex === index;
              return (
                <div key={index} className={`flex ${style.row}`}>
                  <div className={`max-w-[85%] border px-4 py-2.5 shadow-xs ${style.bubble}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <button
                        type="button"
                        onClick={() => cycleSpeaker(index)}
                        title="Click to correct the speaker attribution"
                        aria-label={`Speaker: ${item.sender}. Click to reassign.`}
                        className={`text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full uppercase cursor-pointer hover:opacity-80 transition-opacity ${style.badge}`}
                      >
                        {item.sender}
                      </button>
                      {item.sender === 'Clinical Comment' && (
                        <span className="text-[10px] text-emerald-700/80 font-medium">
                          clinician-authored · not spoken
                        </span>
                      )}
                    </div>

                    {isEditing ? (
                      <textarea
                        autoFocus
                        value={draftText}
                        rows={Math.min(6, Math.max(2, Math.ceil(draftText.length / 64)))}
                        onChange={(event) => setDraftText(event.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            commitEdit();
                          } else if (event.key === 'Escape') {
                            event.preventDefault();
                            cancelEdit();
                          }
                        }}
                        className="w-full min-w-[260px] text-xs leading-relaxed text-slate-800 bg-white border border-indigo-400 rounded-lg p-2 outline-none focus:ring-2 focus:ring-indigo-100 resize-y"
                      />
                    ) : (
                      <p
                        onClick={() => startEditing(index)}
                        title="Click to correct the transcription"
                        className="text-xs leading-relaxed whitespace-pre-wrap cursor-text"
                      >
                        {item.text}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Correction affordance */}
      <div className="px-6 py-2.5 border-t border-slate-200/80 bg-white text-[11px] text-slate-500">
        Diarisation got it wrong? <strong className="font-semibold text-slate-700">Click a speaker badge</strong> to
        reassign, or <strong className="font-semibold text-slate-700">click any line</strong> to correct the wording
        before it feeds the clinical note.
      </div>
    </div>
  );
}
