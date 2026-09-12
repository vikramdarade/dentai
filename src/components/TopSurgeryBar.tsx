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
  onClickPatient?: () => void;
}

export default function TopSurgeryBar({
  activeItem,
  mediaStream,
  onFinish,
  onCancel,
  liveTranscript = '',
  onClickPatient
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
      try {
        if (source) source.disconnect();
      } catch (err) {
        console.warn('[TopSurgeryBar] Audio source disconnect ignored:', err);
      }
      try {
        if (audioCtx && audioCtx.state !== 'closed') {
          audioCtx.close().catch(() => {});
        }
      } catch (err) {
        console.warn('[TopSurgeryBar] AudioContext close ignored:', err);
      }
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
      className="fixed top-3 sm:top-4 left-1/2 -translate-x-1/2 z-[100] pointer-events-none w-auto max-w-[96vw]"
    >
      {/* Outer Machined Bezel */}
      <div className="pointer-events-auto p-0.5 rounded-2xl bg-gradient-to-r from-cyan-500/50 via-teal-500/40 to-emerald-500/50 border border-cyan-400/50 shadow-2xl shadow-cyan-950/40">
        {/* Inner Tactical Island */}
        <div className="flex items-center gap-2.5 sm:gap-3 px-3.5 sm:px-5 py-2 sm:py-2.5 bg-[#0C131D]/95 dark:bg-[#0C131D]/95 rounded-[calc(1rem-2px)] text-white font-sans shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
          {/* Play/Stop Circular Indicator */}
          <button
            onClick={onFinish}
            className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-400 to-teal-300 hover:from-cyan-300 hover:to-teal-200 flex items-center justify-center text-slate-950 shadow-md shadow-cyan-950/60 transition-transform active:scale-90 cursor-pointer shrink-0 relative z-50"
            title="Finish Consult & Generate Note"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </button>

          {/* Island Label & Patient Name */}
          <div
            onClick={onClickPatient}
            className={`flex flex-col min-w-0 pr-1 relative z-50 ${onClickPatient ? 'cursor-pointer hover:opacity-85' : ''}`}
            title={onClickPatient ? 'Click to view appointment in schedule' : undefined}
          >
            <span className="text-[10px] font-black uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping shrink-0" />
              Active Surgery Island
            </span>
            <span className="text-xs font-black text-white truncate max-w-[130px] sm:max-w-[190px]">
              {activeItem.patientName}
            </span>
          </div>

          {/* Center: Live Cyan Waveform Equalizer (z-10) */}
          <div className="flex items-center gap-0.5 h-7 px-3 bg-[#070B11] rounded-xl border border-[#182638] shrink-0 relative z-10">
            {frequencyData.slice(0, 16).map((h, i) => (
              <span
                key={i}
                className="w-1 bg-gradient-to-t from-cyan-400 via-teal-300 to-emerald-300 rounded-full transition-all duration-75"
                style={{ height: `${Math.max(4, h * 0.7)}px` }}
              />
            ))}
          </div>

          {/* Elapsed Timer */}
          <div className="flex items-center gap-1.5 font-mono text-xs font-extrabold text-slate-100 bg-[#070B11] px-2.5 py-1.5 rounded-xl border border-[#182638] shrink-0 relative z-50 shadow-xs">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span>{formatTimer(seconds)} min</span>
          </div>

          {/* Live Detected Chips */}
          {detectedChips.length > 0 && (
            <div className="hidden xl:flex items-center gap-1.5 relative z-50">
              {detectedChips.slice(-2).map((chip, idx) => (
                <span
                  key={idx}
                  className="px-2.5 py-0.5 text-[10px] font-mono font-black rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                >
                  {chip}
                </span>
              ))}
            </div>
          )}

          {/* Finish Button Pill */}
          <button
            onClick={onFinish}
            className="hidden sm:flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-emerald-400 to-teal-400 hover:from-emerald-300 hover:to-teal-300 text-slate-950 rounded-xl text-xs font-black transition-all active:scale-95 shadow-md shadow-emerald-950/50 cursor-pointer shrink-0 relative z-50"
            title="Conclude consultation & generate note in background"
          >
            <Square className="w-3 h-3 fill-current" />
            <span>Finish</span>
          </button>

          {/* Cancel Safeguard */}
          <button
            onClick={() => {
              if (confirm('Discard current recording for this appointment?')) {
                onCancel();
              }
            }}
            className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-[#162436] transition-colors cursor-pointer shrink-0 relative z-50"
            title="Cancel recording"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

