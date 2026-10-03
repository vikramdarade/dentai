import React, { useEffect, useState, useRef } from 'react';
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
  /** Add a single new utterance (spoken or clinical comment). */
  onAddUtterance?: (text: string, sender: Speaker) => void;
  /** Opens the split-session modal (owned by the parent). */
  onSeparateMergedSession?: () => void;
  /** Show the live-listening affordance while the recorder is running. */
  isLive?: boolean;
  /** Real-time interim unconfirmed speech being spoken right now. */
  interimText?: string;
  emptyHint?: string;
  onStartListening?: () => void;
  hasRecordedAudio?: boolean;
  isTranscribingAudio?: boolean;
  onTranscribeRecordedAudio?: () => void;
}

export default function TranscriptTab({
  transcript = [],
  onUpdateTranscript,
  onAddUtterance,
  onSeparateMergedSession,
  isLive = false,
  interimText = '',
  emptyHint = 'No audio lines recorded yet. Start the microphone above to capture the consultation.',
  onStartListening,
  hasRecordedAudio = false,
  isTranscribingAudio = false,
  onTranscribeRecordedAudio,
}: TranscriptTabProps) {
  const [items, setItems] = useState<TranscriptItem[]>(transcript);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftText, setDraftText] = useState('');
  const [newUtteranceText, setNewUtteranceText] = useState('');
  const [inputSpeaker, setInputSpeaker] = useState<Speaker>('Dialogue');
  const inputRef = useRef<HTMLInputElement>(null);

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

  const handleAddUtterance = () => {
    const text = newUtteranceText.trim();
    if (!text) return;
    if (onAddUtterance) {
      onAddUtterance(text, inputSpeaker);
    } else {
      const next = [...items, { sender: inputSpeaker, text }];
      commit(next);
    }
    setNewUtteranceText('');
  };

  const handleInsertSampleTranscript = () => {
    const sampleDialogue: TranscriptItem[] = [
      { sender: 'Dentist', text: "Good morning. We'll be conducting a comprehensive dental examination today." },
      { sender: 'Patient', text: "Thank you doctor. I have had slight cold sensitivity on the upper right side when drinking water." },
      { sender: 'Dentist', text: "Understood. Examining upper right quadrant. Tooth 16 has an existing amalgam restoration with recurrent distal caries and marginal breakdown. Cold test positive with quick resolution." },
      { sender: 'Dentist', text: "Tooth 17 sound. Tooth 26 sound with intact fissure sealant. Healthy attached gingivae with nil bleeding on probing." },
      { sender: 'Dentist', text: "Treatment plan: Tooth 16 disto-occlusal composite resin restoration under local anaesthetic next visit. Bitewing radiographs taken." }
    ];
    commit(sampleDialogue);
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
          <span className="text-[11px] text-slate-400 font-medium">
            {items.length} utterance{items.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {hasRecordedAudio && onTranscribeRecordedAudio && (
            <button
              type="button"
              onClick={onTranscribeRecordedAudio}
              disabled={isTranscribingAudio}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-800 text-xs font-semibold hover:bg-emerald-100 disabled:opacity-50 transition-colors cursor-pointer"
              title="Transcribe captured audio with AI server diarisation"
            >
              <span>{isTranscribingAudio ? '⏳ Diarising Audio...' : '🎙️ Transcribe Recording'}</span>
            </button>
          )}

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
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {items.length === 0 ? (
          <div className="max-w-xl mx-auto flex flex-col items-center justify-center gap-3 p-8 text-slate-400 text-xs border border-dashed border-slate-300 rounded-2xl bg-white/70 shadow-xs">
            <span className="text-3xl" aria-hidden>
              🎙️
            </span>
            <div className="text-center">
              <p className="font-semibold text-slate-800 text-sm mb-1">0 Utterances Recorded</p>
              <p className="leading-relaxed max-w-md text-slate-500">{emptyHint}</p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
              {!isLive && onStartListening && (
                <button
                  type="button"
                  onClick={onStartListening}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                >
                  <span>🎙️ Start Microphone</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleInsertSampleTranscript}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold border border-slate-200 transition-colors cursor-pointer"
                title="Insert standard examination dialogue to test note generation"
              >
                <span>✨ Load Sample Consultation Dialogue</span>
              </button>

              <button
                type="button"
                onClick={() => inputRef.current?.focus()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold border border-slate-200 transition-colors cursor-pointer"
              >
                <span>✍️ Type Utterance</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto flex flex-col gap-3">
            {items.map((item, index) => {
              const style = SPEAKER_STYLES[item.sender] || SPEAKER_STYLES.Dialogue;
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

            {/* Live interim spoken bubble */}
            {isLive && Boolean(interimText?.trim()) && (
              <div className="flex justify-center">
                <div className="max-w-[85%] border px-4 py-2.5 rounded-2xl bg-indigo-50/90 border-indigo-200 text-slate-700 italic shadow-2xs">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
                    <span className="text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full uppercase bg-indigo-600 text-white">
                      Hearing Live Speech
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed whitespace-pre-wrap">{interimText}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick Spoken / Clinical Comment Entry Dock */}
      <div className="px-6 py-2.5 bg-white border-t border-slate-200/80 flex items-center gap-2 shadow-2xs">
        <select
          value={inputSpeaker}
          onChange={(e) => setInputSpeaker(e.target.value as Speaker)}
          className="text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer shrink-0"
        >
          <option value="Dialogue">Dialogue (Spoken)</option>
          <option value="Dentist">Dentist</option>
          <option value="Patient">Patient</option>
          <option value="Clinical Comment">Clinical Comment (Written)</option>
        </select>
        <input
          ref={inputRef}
          type="text"
          value={newUtteranceText}
          onChange={(e) => setNewUtteranceText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAddUtterance();
            }
          }}
          placeholder={
            inputSpeaker === 'Clinical Comment'
              ? 'Add clinician observation (e.g. Patient appeared anxious during exam)...'
              : 'Type or dictate utterance (e.g. Tooth 16 has DO caries, tooth 26 sound)...'
          }
          className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-slate-800 placeholder-slate-400 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 transition-all"
        />
        <button
          type="button"
          onClick={handleAddUtterance}
          disabled={!newUtteranceText.trim()}
          className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg shadow-2xs transition-all cursor-pointer shrink-0"
        >
          Add Utterance
        </button>
      </div>

      {/* Correction affordance */}
      <div className="px-6 py-2 border-t border-slate-100 bg-[#FAF9F7] text-[11px] text-slate-500 flex items-center justify-between">
        <span>
          Diarisation got it wrong? <strong className="font-semibold text-slate-700">Click a speaker badge</strong> to
          reassign, or <strong className="font-semibold text-slate-700">click any line</strong> to edit.
        </span>
        <kbd className="font-mono text-[10px] text-slate-400 bg-white border border-slate-200 px-1 py-0.5 rounded">Enter to add</kbd>
      </div>
    </div>
  );
}
