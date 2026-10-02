import React, { useCallback, useEffect, useRef, useState } from 'react';
import { listAudioInputDevices, type AudioInputDevice } from '../../lib/audioRecorder';
import { SILENCE_SLEEP_SECONDS, SILENCE_WARN_SECONDS } from '../../lib/silencePolicy';

export type CaptureMode = 'transcribe' | 'dictate';

interface AudioBarProps {
  /** Recorder is live (but may be paused). */
  isRecording?: boolean;
  /** Recorder is paused — the timer must stay frozen on its last value. */
  isPaused?: boolean;
  /** Whole seconds of captured audio; parent ticks this from AudioRecorder. */
  elapsedSeconds?: number;
  /** Real-time RMS level 0–100 driving the 4-bar visualiser. */
  level?: number;
  /** Continuous silence so far, in seconds (drives the countdown chip). */
  silenceSeconds?: number;
  mode?: CaptureMode;
  onModeChange?: (mode: CaptureMode) => void;
  /** Called with the chosen device id (null = system default) and capture mode. */
  onStart?: (deviceId: string | null, mode: CaptureMode) => void;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  onDeviceChange?: (deviceId: string | null) => void;
  disabled?: boolean;
}

export function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

const MODE_LABEL: Record<CaptureMode, string> = {
  transcribe: 'Transcribe',
  dictate: 'Dictate',
};

/** Bar height multipliers so the four bars move as an ensemble, not in lockstep. */
const BAR_WEIGHTS = [0.55, 0.9, 1, 0.7];

export default function AudioBar({
  isRecording = false,
  isPaused = false,
  elapsedSeconds = 0,
  level = 0,
  silenceSeconds,
  mode = 'transcribe',
  onModeChange,
  onStart,
  onPause,
  onResume,
  onStop,
  onDeviceChange,
  disabled = false,
}: AudioBarProps) {
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const refreshDevices = useCallback(async () => {
    const next = await listAudioInputDevices();
    setDevices(next);
    setSelectedDeviceId((current) => {
      if (current && !next.some((device) => device.deviceId === current)) return null;
      return current;
    });
  }, []);

  useEffect(() => {
    void refreshDevices();
    const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!mediaDevices?.addEventListener) return;
    const onChange = () => void refreshDevices();
    mediaDevices.addEventListener('devicechange', onChange);
    return () => mediaDevices.removeEventListener('devicechange', onChange);
  }, [refreshDevices]);

  // Refresh again once recording begins: that is when browsers reveal labels.
  useEffect(() => {
    if (isRecording) void refreshDevices();
  }, [isRecording, refreshDevices]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsModeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDeviceSelect = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value || null;
    setSelectedDeviceId(value);
    onDeviceChange?.(value);
  };

  const handlePrimaryAction = () => {
    setIsModeMenuOpen(false);
    onStart?.(selectedDeviceId, mode);
  };

  const handleModeSelect = (nextMode: CaptureMode) => {
    setIsModeMenuOpen(false);
    onModeChange?.(nextMode);
  };

  const isLive = isRecording && !isPaused;
  const silenceValue = typeof silenceSeconds === 'number' ? Math.max(0, silenceSeconds) : null;
  const silenceRatio = silenceValue != null ? Math.min(1, silenceValue / SILENCE_SLEEP_SECONDS) : 0;
  const silenceWarning = silenceValue != null && silenceValue >= SILENCE_WARN_SECONDS;
  const barHeight = (weight: number) => {
    const scaled = (Math.min(100, Math.max(0, level)) / 100) * 24 * weight;
    return Math.max(4, Math.round(scaled));
  };

  return (
    <div className="flex flex-wrap items-center gap-4 px-6 py-3 bg-white border-b border-slate-200/80 select-none">
      {/* Mic selector — locked while live so a device swap cannot orphan the stream. */}
      <div className="flex items-center gap-2 min-w-[220px]">
        <span className="text-xs font-semibold text-slate-500" aria-hidden>
          🎤
        </span>
        <select
          value={selectedDeviceId ?? ''}
          onChange={handleDeviceSelect}
          disabled={isRecording || disabled}
          title={isRecording ? 'Stop the recording to change microphone' : 'Select input microphone'}
          className="w-full max-w-[260px] text-xs text-slate-800 bg-[#FAF9F7] border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <option value="">System default microphone</option>
          {devices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))}
        </select>
      </div>

      {/* Elapsed timer — frozen on pause, reset to 00:00 by a new session. */}
      <div className="flex items-center gap-2">
        <span
          className={`font-mono text-sm font-semibold tabular-nums ${
            isLive ? 'text-slate-900' : isPaused ? 'text-amber-600' : 'text-slate-400'
          }`}
        >
          {formatElapsed(elapsedSeconds)}
        </span>
        {isLive && (
          <span className="flex items-center gap-1 text-[10px] font-bold tracking-wide text-red-600">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            REC
          </span>
        )}
        {isRecording && isPaused && (
          <span className="text-[10px] font-bold tracking-wide text-amber-600">PAUSED</span>
        )}
      </div>

      {/* 4-bar RMS visualiser */}
      <div
        className="flex items-end gap-1 h-7"
        role="meter"
        aria-label="Microphone level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level)}
      >
        {BAR_WEIGHTS.map((weight, index) => (
          <span
            key={index}
            className={`w-1.5 rounded-full transition-[height] duration-75 ${
              isLive ? 'bg-indigo-500' : isPaused ? 'bg-amber-300' : 'bg-slate-200'
            }`}
            style={{ height: `${isLive ? barHeight(weight) : 4}px` }}
          />
        ))}
      </div>

      {/* Silence guardrail: warn chip + progress toward the 3-minute auto-pause */}
      {isRecording && silenceValue != null && (
        <div className="flex items-center gap-2 min-w-[150px]" title="Silence before auto-pause">
          <span
            className={`text-[11px] font-semibold ${
              silenceWarning ? 'text-amber-700' : 'text-slate-500'
            }`}
          >
            {silenceWarning ? '⚠️' : '🤫'} Silence {formatElapsed(silenceValue)} /{' '}
            {formatElapsed(SILENCE_SLEEP_SECONDS)}
          </span>
          <span className="w-16 h-1 rounded-full bg-slate-200 overflow-hidden">
            <span
              className={`block h-full transition-all duration-300 ${
                silenceWarning ? 'bg-amber-500' : 'bg-slate-400'
              }`}
              style={{ width: `${silenceRatio * 100}%` }}
            />
          </span>
        </div>
      )}

      <div className="flex-1" />

      {/* Capture controls */}
      <div className="flex items-center gap-2">
        {!isRecording && (
          <div className="relative flex items-stretch" ref={menuRef}>
            <button
              type="button"
              onClick={handlePrimaryAction}
              disabled={disabled}
              className="flex items-center gap-1.5 pl-3.5 pr-3 py-2 text-xs font-semibold rounded-l-xl bg-[#2A1D24] text-white hover:bg-[#3D2C35] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <span aria-hidden>🎙️</span>
              <span>{MODE_LABEL[mode]}</span>
            </button>
            <button
              type="button"
              onClick={() => setIsModeMenuOpen((open) => !open)}
              disabled={disabled}
              aria-haspopup="menu"
              aria-expanded={isModeMenuOpen}
              aria-label="Capture mode options"
              className="px-1.5 rounded-r-xl bg-[#2A1D24] text-white/80 hover:text-white hover:bg-[#3D2C35] border-l border-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              ▾
            </button>

            {isModeMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1.5 z-30 w-52 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={handlePrimaryAction}
                  className="w-full text-left px-3.5 py-2.5 text-xs text-slate-800 hover:bg-slate-50 cursor-pointer"
                >
                  <span className="font-semibold block">
                    {MODE_LABEL[mode]} consultation
                  </span>
                  <span className="text-slate-500">Start live capture now</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleModeSelect('transcribe')}
                  className={`w-full text-left px-3.5 py-2.5 text-xs hover:bg-slate-50 cursor-pointer border-t border-slate-100 ${
                    mode === 'transcribe' ? 'text-indigo-700 font-semibold' : 'text-slate-800'
                  }`}
                >
                  🗣️ Transcribe — diarised conversation
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleModeSelect('dictate')}
                  className={`w-full text-left px-3.5 py-2.5 text-xs hover:bg-slate-50 cursor-pointer border-t border-slate-100 ${
                    mode === 'dictate' ? 'text-indigo-700 font-semibold' : 'text-slate-800'
                  }`}
                >
                  ✍️ Dictate — clinician only
                </button>
              </div>
            )}
          </div>
        )}

        {isRecording && !isPaused && (
          <button
            type="button"
            onClick={onPause}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors cursor-pointer"
          >
            <span aria-hidden>⏸</span>
            <span>Pause</span>
          </button>
        )}

        {isRecording && isPaused && (
          <button
            type="button"
            onClick={onResume}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors cursor-pointer"
          >
            <span aria-hidden>▶</span>
            <span>Resume</span>
          </button>
        )}

        {isRecording && (
          <button
            type="button"
            onClick={onStop}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors cursor-pointer"
          >
            <span aria-hidden>🔴</span>
            <span>Stop</span>
          </button>
        )}
      </div>
    </div>
  );
}
