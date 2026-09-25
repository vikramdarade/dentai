import React, { useState, useRef, useEffect } from 'react';
import { Mic, Pause, Play, Volume2, Shield, Activity, Send, CheckCircle2, AlertTriangle, Sparkles } from 'lucide-react';

export interface DialogueUtterance {
  speaker?: string;
  role?: 'patient' | 'assistant' | 'dentist' | 'dialogue';
  time?: string;
  text: string;
}

export interface LiveConversationPanelProps {
  transcript: DialogueUtterance[];
  interimTranscript?: string;
  isMicStandby: boolean;
  isPaused: boolean;
  recordingSeconds: number;
  isSilenceWarning: boolean;
  silenceSecondsRemaining: number;
  dspNoiseGateActive: boolean;
  onToggleNoiseGate: () => void;
  onStartAudio: () => void;
  onTogglePause: () => void;
  onKeepListening: () => void;
  onManualDialogueSubmit?: (text: string) => void;
  audioVisualizerRef?: React.RefObject<HTMLCanvasElement | null>;
  waveformRefs?: React.MutableRefObject<(HTMLDivElement | null)[]>;
  micListening?: boolean;
  micError?: string | null;
}

export const LiveConversationPanel: React.FC<LiveConversationPanelProps> = ({
  transcript,
  interimTranscript,
  isMicStandby,
  isPaused,
  recordingSeconds,
  isSilenceWarning,
  silenceSecondsRemaining,
  dspNoiseGateActive,
  onToggleNoiseGate,
  onStartAudio,
  onTogglePause,
  onKeepListening,
  onManualDialogueSubmit,
  audioVisualizerRef,
  waveformRefs,
  micListening = false,
  micError = null,
}) => {
  const [manualText, setManualText] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll when new utterances arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript.length, interimTranscript]);

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualText.trim()) return;
    onManualDialogueSubmit?.(manualText.trim());
    setManualText('');
  };

  return (
    <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
      {/* Panel Header */}
      <div className="px-4 py-3 border-b border-slate-200/90 flex items-center justify-between bg-slate-50/50">
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1.5">
            <span className={`w-2 h-2 rounded-full ${micListening && !isPaused && !isMicStandby ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
            <h3 className="text-xs font-bold text-slate-900 tracking-wide uppercase">
              Live Conversation
            </h3>
          </div>
          <span className="text-[11px] font-medium text-slate-500 bg-white px-2 py-0.5 rounded-full border border-slate-200">
            {transcript.length} lines recorded
          </span>
        </div>

        {/* Anti-Jargon Noise Filter Toggle (Rule 9) */}
        <button
          onClick={onToggleNoiseGate}
          className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition cursor-pointer ${
            dspNoiseGateActive
              ? 'bg-sky-50 text-sky-800 border-sky-200 shadow-2xs'
              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
          }`}
          title="Toggle operatory noise filter"
        >
          <Shield className="w-3.5 h-3.5 text-sky-600" />
          <span>Noise Filter: {dspNoiseGateActive ? 'On' : 'Off'}</span>
        </button>
      </div>

      {/* Operatory Microphone HUD Bar */}
      <div className="px-4 py-3 bg-slate-50/90 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap">
        {/* Timer & Mic Controls */}
        <div className="flex items-center space-x-2.5">
          {isMicStandby ? (
            <button
              onClick={onStartAudio}
              className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition cursor-pointer"
            >
              <Mic className="w-4 h-4" />
              <span>Start Audio (Space)</span>
            </button>
          ) : (
            <button
              onClick={onTogglePause}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold transition shadow-xs cursor-pointer ${
                isPaused
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'bg-amber-500 hover:bg-amber-600 text-white'
              }`}
            >
              {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              <span>{isPaused ? 'Resume Audio' : 'Pause (Space)'}</span>
            </button>
          )}

          {/* Running Clock */}
          <div className="flex items-center space-x-1 font-mono text-sm font-bold text-slate-700 bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs">
            <span className="text-slate-400 text-xs">REC:</span>
            <span>{formatTimer(recordingSeconds)}</span>
          </div>

          {/* Active Listening Indicator */}
          {micListening && !isPaused && !isMicStandby ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Listening</span>
            </span>
          ) : isPaused ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 shadow-2xs">
              <span>Paused</span>
            </span>
          ) : isMicStandby ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200 shadow-2xs">
              <span>Standby</span>
            </span>
          ) : null}
        </div>

        {/* Real-time 60fps WebAudio Waveform */}
        <div className="flex items-center space-x-2 flex-1 max-w-[200px] justify-end">
          {audioVisualizerRef ? (
            <canvas
              ref={audioVisualizerRef}
              width={180}
              height={28}
              className="w-full h-7 rounded-lg bg-white border border-slate-200 shadow-inner"
            />
          ) : (
            <div
              className="flex items-end justify-end gap-[3px] h-7 px-2.5 py-1 bg-white rounded-lg border border-slate-200 shadow-2xs w-full"
              title="Real-time operatory acoustic activity"
            >
              {Array.from({ length: 13 }).map((_, i) => (
                <div
                  key={i}
                  ref={el => {
                    if (waveformRefs) waveformRefs.current[i] = el;
                  }}
                  className={`w-1 rounded-full transition-all duration-75 ${
                    micListening && !isPaused && !isMicStandby
                      ? 'bg-emerald-500'
                      : isPaused
                      ? 'bg-amber-400'
                      : 'bg-slate-300'
                  }`}
                  style={{ height: '20%', minHeight: '4px' }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Microphone Error Notice Banner */}
      {micError && (
        <div className="bg-rose-50 border-b border-rose-200 px-4 py-2 flex items-center justify-between text-xs text-rose-900">
          <div className="flex items-center space-x-2 font-medium">
            <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <span>{micError}</span>
          </div>
          <span className="text-[10px] text-rose-700 font-medium bg-white/90 px-2 py-0.5 rounded border border-rose-200">
            Check mic permissions
          </span>
        </div>
      )}

      {/* 30-Second Silence Sleep Early Warning Banner (Rule 8) */}
      {isSilenceWarning && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center justify-between text-xs text-amber-900 animate-pulse">
          <div className="flex items-center space-x-2 font-medium">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <span>
              No speech detected for 2m 30s. Pausing in <strong>{silenceSecondsRemaining}s</strong> to preserve battery.
            </span>
          </div>
          <button
            onClick={onKeepListening}
            className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg shadow-2xs transition cursor-pointer text-xs flex items-center space-x-1"
          >
            <span>Keep Listening</span>
            <kbd className="px-1 text-[10px] bg-amber-800 rounded font-mono text-amber-100">Space</kbd>
          </button>
        </div>
      )}

      {/* Transcript Utterances Feed */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#FBFBFC] custom-scrollbar min-h-[220px]"
      >
        {transcript.length === 0 && !interimTranscript ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-2 shadow-2xs border ${
              micListening && !isPaused && !isMicStandby
                ? 'bg-emerald-50 border-emerald-200 text-emerald-600 animate-pulse'
                : 'bg-slate-50 border-slate-200 text-slate-400'
            }`}>
              <Mic className="w-6 h-6" />
            </div>
            <p className="text-xs font-semibold text-slate-700">
              {micListening && !isPaused && !isMicStandby
                ? 'Microphone is active & listening'
                : isPaused
                ? 'Recording paused'
                : 'Waiting for operatory conversation'}
            </p>
            <p className="text-[11px] text-slate-400 max-w-[280px] mt-1">
              {micListening && !isPaused && !isMicStandby
                ? 'Speak naturally at the chair, or click a quick sample phrase below to test note generation:'
                : 'Speak naturally at the chair. Utterances are captured and organized by speaker.'}
            </p>

            {/* Quick 1-click test utterance chips */}
            {onManualDialogueSubmit && (
              <div className="mt-4 flex flex-col items-center gap-2 max-w-sm">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Quick operatory dictation:
                </span>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {[
                    'Tooth 16 MO composite restoration under infiltration',
                    'Recurrent decay on 46, periapical radiograph taken',
                    'Full mouth scale and clean with prophylaxis paste'
                  ].map((sample, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => onManualDialogueSubmit(sample)}
                      className="text-[11px] bg-white hover:bg-sky-50 text-slate-700 hover:text-sky-700 px-2.5 py-1 rounded-lg border border-slate-200 hover:border-sky-300 transition shadow-2xs cursor-pointer text-left font-medium"
                    >
                      + "{sample.slice(0, 30)}..."
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {transcript.map((item, index) => {
              const role = item.role || 'dialogue';
              const isPatient = role === 'patient';
              const isAssistant = role === 'assistant';
              const isDentist = role === 'dentist';

              let tagColor = 'bg-slate-100 text-slate-700 border-slate-200';
              if (isPatient) tagColor = 'bg-sky-50 text-sky-800 border-sky-200';
              if (isAssistant) tagColor = 'bg-purple-50 text-purple-800 border-purple-200';
              if (isDentist) tagColor = 'bg-emerald-50 text-emerald-800 border-emerald-200';

              return (
                <div key={index} className="flex flex-col space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${tagColor}`}>
                      {item.speaker || (isPatient ? 'Patient' : isDentist ? 'Dentist' : 'Dialogue')}
                    </span>
                    {item.time && (
                      <span className="text-[10px] font-mono text-slate-400 font-tabular">
                        {item.time}
                      </span>
                    )}
                  </div>
                  <div className="bg-white rounded-xl p-3 border border-slate-200/80 shadow-2xs text-xs text-slate-800 leading-relaxed font-sans">
                    {item.text}
                  </div>
                </div>
              );
            })}

            {/* Live Interim Speech Bubble */}
            {interimTranscript && (
              <div className="flex flex-col space-y-1 opacity-80 animate-pulse">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-100 text-slate-600 border-slate-200 w-fit">
                  Speaking...
                </span>
                <div className="bg-sky-50/60 rounded-xl p-3 border border-sky-200/70 text-xs text-sky-950 italic">
                  {interimTranscript}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Manual Observation / Dialogue Input Footer */}
      {onManualDialogueSubmit && (
        <form onSubmit={handleManualSubmit} className="p-2.5 bg-white border-t border-slate-200/90 flex gap-2">
          <input
            type="text"
            value={manualText}
            onChange={e => setManualText(e.target.value)}
            placeholder="Type quick clinical observation (e.g. Tooth 16 caries)..."
            className="flex-1 px-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:outline-none focus:border-sky-500 focus:bg-white text-slate-800"
          />
          <button
            type="submit"
            disabled={!manualText.trim()}
            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-semibold flex items-center space-x-1 transition cursor-pointer"
          >
            <Send className="w-3 h-3" />
            <span>Add</span>
          </button>
        </form>
      )}
    </div>
  );
};
