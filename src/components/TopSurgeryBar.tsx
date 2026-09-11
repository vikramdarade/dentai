import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  Square,
  Sparkles,
  Clock,
  Volume2,
  AlertCircle,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DayScheduleItem } from '../lib/dayScheduleStorage';
import { getAppointmentTypeLabel } from '../lib/dentalLibrary';

interface TopSurgeryBarProps {
  activeItem: DayScheduleItem;
  mediaStream: MediaStream | null;
  onFinish: () => void;
  onCancel: () => void;
  liveTranscript?: string;
}

export default function TopSurgeryBar({
  activeItem,
  mediaStream,
  onFinish,
  onCancel,
  liveTranscript = ''
}: TopSurgeryBarProps) {
  const [seconds, setSeconds] = useState(0);
  const [frequencyData, setFrequencyData] = useState<number[]>(new Array(24).fill(12));
  const [detectedChips, setDetectedChips] = useState<string[]>([]);
  const animationFrameRef = useRef<number | null>(null);

  // Timer increment
  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds(s => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Real-time Web Audio API frequency visualizer
  useEffect(() => {
    if (!mediaStream) return;

    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
        if (audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.75;
        source = audioCtx.createMediaStreamSource(mediaStream);
        source.connect(analyser);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const updateVisualizer = () => {
          if (!analyser) return;
          analyser.getByteFrequencyData(dataArray);

          // Sample 24 bars from the frequency buffer
          const bars: number[] = [];
          const step = Math.max(1, Math.floor(bufferLength / 24));
          for (let i = 0; i < 24; i++) {
            const val = dataArray[i * step] || 0;
            // Scale between 6px and 28px height
            const height = Math.max(6, Math.min(28, (val / 255) * 28));
            bars.push(height);
          }
          setFrequencyData(bars);
          animationFrameRef.current = requestAnimationFrame(updateVisualizer);
        };

        animationFrameRef.current = requestAnimationFrame(updateVisualizer);
      }
    } catch (err) {
      console.warn('[TopSurgeryBar] Web Audio visualizer fallback:', err);
    }

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (source) source.disconnect();
      if (audioCtx && audioCtx.state !== 'closed') audioCtx.close().catch(() => {});
    };
  }, [mediaStream]);

  // Live dental semantic chip detector (progressive enhancement)
  useEffect(() => {
    if (!liveTranscript) return;

    const lower = liveTranscript.toLowerCase();
    const found = new Set<string>();

    // Detect teeth numbers (FDI format e.g. tooth 16, #16, 24, 36, 47)
    const toothMatches = lower.match(/(?:tooth\s+|#)?\b([1-4][1-8])\b/g);
    if (toothMatches) {
      toothMatches.slice(-3).forEach(m => {
        const num = m.replace(/[^0-9]/g, '');
        if (num.length === 2) found.add(`#${num}`);
      });
    }

    // Detect ADA codes (e.g. 011, 022, 114, 532, 611)
    const adaMatches = lower.match(/\b(011|012|014|022|114|121|311|414|531|532|533|611)\b/g);
    if (adaMatches) {
      adaMatches.slice(-2).forEach(c => found.add(`ADA ${c}`));
    }

    // Detect clinical keywords
    if (lower.includes('composite') || lower.includes('filling')) found.add('Composite');
    if (lower.includes('crown') || lower.includes('ceramic')) found.add('Crown');
    if (lower.includes('caries') || lower.includes('decay')) found.add('Caries');
    if (lower.includes('scale') || lower.includes('calculus')) found.add('Scale & Clean');
    if (lower.includes('pulpitis') || lower.includes('root canal')) found.add('Endodontic');
    if (lower.includes('extraction')) found.add('Extraction');

    if (found.size > 0) {
      setDetectedChips(Array.from(found).slice(-4));
    }
  }, [liveTranscript]);

  return (
    <motion.div
      initial={{ y: -60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -60, opacity: 0 }}
      transition={{ type: 'spring', damping: 24, stiffness: 220 }}
      className="fixed top-3 left-0 right-0 z-50 max-w-5xl mx-auto px-3 pointer-events-none"
    >
      <div className="pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 bg-slate-950/95 backdrop-blur-md rounded-2xl border border-teal-500/40 shadow-2xl shadow-teal-950/40 text-white font-sans">
        {/* Left: Active Live Badge & Patient Details */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
            </span>
            <span className="text-[11px] font-black uppercase tracking-wider text-red-400 hidden sm:inline">
              Live in Surgery
            </span>
          </div>

          <div className="h-4 w-px bg-slate-800 shrink-0 hidden sm:block" />

          <div className="min-w-0">
            <div className="flex items-center gap-2 truncate">
              <span className="text-sm font-extrabold text-white truncate tracking-tight">
                {activeItem.patientName}
              </span>
              <span className="text-xs text-teal-300 font-mono hidden md:inline">
                ({activeItem.time})
              </span>
            </div>
            <p className="text-[11px] text-slate-400 truncate hidden sm:block">
              {activeItem.procedureText}
            </p>
          </div>
        </div>

        {/* Center: Live Audio Waveform & Timer */}
        <div className="flex items-center gap-3 shrink-0">
          {/* 24-Bar Audio Equalizer */}
          <div className="flex items-center gap-0.5 h-7 px-2.5 bg-slate-900/90 rounded-xl border border-slate-800/80">
            {frequencyData.map((h, i) => (
              <span
                key={i}
                className="w-1 bg-gradient-to-t from-teal-500 to-emerald-400 rounded-full transition-all duration-75"
                style={{ height: `${h}px` }}
              />
            ))}
          </div>

          {/* Clock Timer */}
          <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-slate-200 bg-slate-900/90 px-2.5 py-1.5 rounded-xl border border-slate-800/80">
            <Clock className="w-3.5 h-3.5 text-teal-400" />
            <span>{formatTimer(seconds)}</span>
          </div>
        </div>

        {/* Right: Live Detected Chips & Finish Button */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Live Detected Dental Chips Stream */}
          {detectedChips.length > 0 && (
            <div className="hidden lg:flex items-center gap-1.5">
              {detectedChips.map((chip, idx) => (
                <motion.span
                  key={idx}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-teal-950/80 text-teal-300 border border-teal-500/40 shadow-xs"
                >
                  {chip}
                </motion.span>
              ))}
            </div>
          )}

          {/* Large High-Visibility Finish Button */}
          <button
            onClick={onFinish}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-black transition-all transform active:scale-95 shadow-md shadow-emerald-950/30 cursor-pointer"
            title="Conclude consultation & generate note in background"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Finish Consult</span>
          </button>

          {/* Cancel Safeguard */}
          <button
            onClick={() => {
              if (confirm('Discard current recording for this appointment?')) {
                onCancel();
              }
            }}
            className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-slate-900 transition-colors cursor-pointer"
            title="Cancel recording"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
