import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity,
  Mic,
  Volume2,
  Copy,
  Check,
  Zap,
  Maximize2,
  Minimize2,
  ShieldCheck,
  ChevronRight,
  ChevronLeft,
  Eye,
  Layers,
  Sparkles,
  Clock,
  User,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DayScheduleItem } from '../lib/dayScheduleStorage';
import { Consultation } from '../types';

export type ChairsideVizMode = 'odontogram' | 'island' | 'hud' | 'panoramic';

interface ChairsideVisualizerSuiteProps {
  activePatient?: DayScheduleItem | Consultation | null;
  dentistName: string;
  clinicName?: string;
  onClose?: () => void;
  onOpenSpeedReview?: () => void;
}

// Universal FDI 2-digit Australian / ISO dental tooth quadrant definitions
const MAXILLARY_RIGHT = ['18', '17', '16', '15', '14', '13', '12', '11'];
const MAXILLARY_LEFT = ['21', '22', '23', '24', '25', '26', '27', '28'];
const MANDIBULAR_LEFT = ['31', '32', '33', '34', '35', '36', '37', '38'];
const MANDIBULAR_RIGHT = ['48', '47', '46', '45', '44', '43', '42', '41'];

interface ToothState {
  tooth: string;
  surfaces: string[];
  condition: 'caries' | 'restoration' | 'crown' | 'endo' | 'healthy';
  label: string;
}

export default function ChairsideVisualizerSuite({
  activePatient,
  dentistName,
  clinicName = 'Bright Smile Dental',
  onClose,
  onOpenSpeedReview
}: ChairsideVisualizerSuiteProps) {
  const [vizMode, setVizMode] = useState<ChairsideVizMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dentai_chairside_viz');
      if (saved === 'odontogram' || saved === 'island' || saved === 'hud' || saved === 'panoramic') {
        return saved;
      }
    }
    return 'odontogram'; // Odontogram radar is the anatomy-first default
  });

  const [selectedTooth, setSelectedTooth] = useState<string>('16');
  const [copied, setCopied] = useState(false);
  const [isRecording, setIsRecording] = useState(true);
  const [seconds, setSeconds] = useState(42);
  const [speechPulse, setSpeechPulse] = useState(true);

  // Switch viz and persist
  const handleSelectMode = (mode: ChairsideVizMode) => {
    setVizMode(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('dentai_chairside_viz', mode);
    }
  };

  // Mock active teeth state representing live spoken dialogue
  const teethData = useMemo<Record<string, ToothState>>(() => ({
    '16': { tooth: '16', surfaces: ['M', 'O', 'D'], condition: 'restoration', label: 'MOD Composite (Filtek A3)' },
    '24': { tooth: '24', surfaces: ['O'], condition: 'caries', label: 'Occlusal Enamel Caries' },
    '36': { tooth: '36', surfaces: ['M', 'O'], condition: 'crown', label: 'Zirconia Crown Prep' },
    '46': { tooth: '46', surfaces: ['O'], condition: 'endo', label: 'Completed Endodontics' }
  }), []);

  // Timer
  useEffect(() => {
    if (!isRecording) return;
    const t = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [isRecording]);

  // Subtle simulated speech pulse
  useEffect(() => {
    const pulseTimer = setInterval(() => {
      setSpeechPulse(p => !p);
    }, 2800);
    return () => clearInterval(pulseTimer);
  }, []);

  const formatTimer = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return `${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const patientDisplayName = activePatient
    ? ('patientName' in activePatient ? activePatient.patientName : `${activePatient.firstName} ${activePatient.lastName}`)
    : 'Sarah Jenkins';

  const appointmentType = activePatient
    ? ('appointmentType' in activePatient ? activePatient.appointmentType : 'Restorative')
    : 'Restorative';

  const activeToothRecord = teethData[selectedTooth] || {
    tooth: selectedTooth,
    surfaces: [],
    condition: 'healthy',
    label: 'Intact Tooth Structure'
  };

  const formattedSoapNote = `PATIENT: ${patientDisplayName}
DATE: ${new Date().toLocaleDateString('en-AU')}
CLINICIAN: Dr. ${dentistName}
APPOINTMENT: ${appointmentType.toUpperCase()}
----------------------------------------
SOAP CLINICAL RECORD:
• Tooth: #${selectedTooth} ${activeToothRecord.surfaces.join('')}
• Clinical Status: ${activeToothRecord.label}
• Anesthetic: 2.2mL Scandonest 2% with 1:100k adrenaline infiltration.
• Procedure: Caries excavation under rubber dam. Indirect pulp protection with GC Fuji VII base. Etch, bond, composite resin layered.
• Material: 3M Filtek Supreme A3.
• Occlusion & Post-Op: Occlusion verified with articulating paper. Warned of post-op numbness 2-3 hours.
• Recall: 6 months routine recall.

ADA ITEM CODES: 012, 531, 583
----------------------------------------
VERIFIED & SIGNED BY DR. ${dentistName.toUpperCase()}`;

  const handleCopyNote = () => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(formattedSoapNote);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  // Keyboard shortcut listener: Spacebar copies note, keys 1-4 switch paradigms
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        handleCopyNote();
      } else if (e.key === '1') {
        handleSelectMode('odontogram');
      } else if (e.key === '2') {
        handleSelectMode('island');
      } else if (e.key === '3') {
        handleSelectMode('hud');
      } else if (e.key === '4') {
        handleSelectMode('panoramic');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [formattedSoapNote]);

  // Color helper for tooth conditions
  const getToothColor = (state?: ToothState) => {
    if (!state) return 'bg-white border-slate-300 text-slate-700 hover:border-sky-400';
    switch (state.condition) {
      case 'restoration':
        return 'bg-teal-50 border-teal-500 text-teal-900 font-extrabold shadow-sm';
      case 'caries':
        return 'bg-amber-50 border-amber-500 text-amber-900 font-extrabold shadow-sm';
      case 'crown':
        return 'bg-violet-50 border-violet-500 text-violet-900 font-extrabold shadow-sm';
      case 'endo':
        return 'bg-rose-50 border-rose-500 text-rose-900 font-extrabold shadow-sm';
      default:
        return 'bg-white border-slate-300 text-slate-700 hover:border-sky-400';
    }
  };

  return (
    <div className="w-full flex flex-col font-sans select-none text-slate-900">
      {/* ──────────────────────────────────────────────────────────── */}
      {/* TOP CONTROL: VISUALIZATION PARADIGM SWITCHER (LABORATORY)   */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-white border-b border-slate-200">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-sky-600 animate-pulse" />
          <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
            Chairside Visualization Studio
          </span>
        </div>

        {/* 4 Interactive Paradigm Tabs */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs">
          <button
            onClick={() => handleSelectMode('odontogram')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              vizMode === 'odontogram'
                ? 'bg-white text-sky-700 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>1. Odontogram Radar</span>
          </button>

          <button
            onClick={() => handleSelectMode('island')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              vizMode === 'island'
                ? 'bg-white text-sky-700 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>2. Dynamic Island</span>
          </button>

          <button
            onClick={() => handleSelectMode('hud')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              vizMode === 'hud'
                ? 'bg-white text-sky-700 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>3. Loupe Telemetry HUD</span>
          </button>

          <button
            onClick={() => handleSelectMode('panoramic')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              vizMode === 'panoramic'
                ? 'bg-white text-sky-700 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>4. Panoramic Display</span>
          </button>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
            title="Close Visualizer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* PARADIGM 1: THE ANATOMICAL ODONTOGRAM RADAR                  */}
      {/* ──────────────────────────────────────────────────────────── */}
      {vizMode === 'odontogram' && (
        <div className="p-6 bg-slate-50 border-b border-slate-200 flex flex-col items-center space-y-6">
          {/* Header context */}
          <div className="w-full max-w-4xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-teal-100 border border-teal-200 flex items-center justify-center text-teal-800 font-bold">
                FDI
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Universal Anatomical Odontogram (32 Teeth)
                </h3>
                <p className="text-xs text-slate-500">
                  Teeth illuminate dynamically in real time as spoken during surgery dialogue
                </p>
              </div>
            </div>

            {/* Active Speech Detection Capsule */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
              <span className={`w-2 h-2 rounded-full bg-emerald-500 ${speechPulse ? 'scale-125' : 'scale-100'} transition-transform`} />
              <span>Room Mic Capturing: Tooth #{selectedTooth} MOD</span>
            </div>
          </div>

          {/* 32-Tooth Dual-Arch Matrix */}
          <div className="w-full max-w-4xl p-5 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-5">
            {/* Upper Jaw (Maxillary) */}
            <div className="space-y-1.5 text-center">
              <div className="flex items-center justify-between px-2 text-[10px] font-mono uppercase tracking-widest text-slate-400">
                <span>Quadrant 1 (Upper Right)</span>
                <span className="font-bold text-slate-600">Maxillary Upper Arch</span>
                <span>Quadrant 2 (Upper Left)</span>
              </div>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                {/* Q1: 18 to 11 */}
                <div className="flex items-center gap-1 p-1 bg-slate-50 rounded-xl border border-slate-200">
                  {MAXILLARY_RIGHT.map(t => {
                    const st = teethData[t];
                    const isSelected = selectedTooth === t;
                    return (
                      <button
                        key={t}
                        onClick={() => setSelectedTooth(t)}
                        className={`w-9 h-11 rounded-lg flex flex-col items-center justify-center font-mono text-xs transition-all cursor-pointer border ${getToothColor(st)} ${
                          isSelected ? 'ring-2 ring-sky-500 scale-105' : ''
                        }`}
                        title={`Tooth #${t}: ${st ? st.label : 'Healthy'}`}
                      >
                        <span className="font-bold">{t}</span>
                        {st && (
                          <span className="text-[9px] font-mono font-bold text-teal-800 leading-none">
                            {st.surfaces.join('')}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="w-px h-8 bg-slate-300 hidden sm:block" />

                {/* Q2: 21 to 28 */}
                <div className="flex items-center gap-1 p-1 bg-slate-50 rounded-xl border border-slate-200">
                  {MAXILLARY_LEFT.map(t => {
                    const st = teethData[t];
                    const isSelected = selectedTooth === t;
                    return (
                      <button
                        key={t}
                        onClick={() => setSelectedTooth(t)}
                        className={`w-9 h-11 rounded-lg flex flex-col items-center justify-center font-mono text-xs transition-all cursor-pointer border ${getToothColor(st)} ${
                          isSelected ? 'ring-2 ring-sky-500 scale-105' : ''
                        }`}
                        title={`Tooth #${t}: ${st ? st.label : 'Healthy'}`}
                      >
                        <span className="font-bold">{t}</span>
                        {st && (
                          <span className="text-[9px] font-mono font-bold text-teal-800 leading-none">
                            {st.surfaces.join('')}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Lower Jaw (Mandibular) */}
            <div className="space-y-1.5 text-center pt-3 border-t border-slate-200">
              <div className="flex items-center justify-center gap-2 flex-wrap">
                {/* Q4: 48 to 41 */}
                <div className="flex items-center gap-1 p-1 bg-slate-50 rounded-xl border border-slate-200">
                  {MANDIBULAR_RIGHT.map(t => {
                    const st = teethData[t];
                    const isSelected = selectedTooth === t;
                    return (
                      <button
                        key={t}
                        onClick={() => setSelectedTooth(t)}
                        className={`w-9 h-11 rounded-lg flex flex-col items-center justify-center font-mono text-xs transition-all cursor-pointer border ${getToothColor(st)} ${
                          isSelected ? 'ring-2 ring-sky-500 scale-105' : ''
                        }`}
                        title={`Tooth #${t}: ${st ? st.label : 'Healthy'}`}
                      >
                        <span className="font-bold">{t}</span>
                        {st && (
                          <span className="text-[9px] font-mono font-bold text-teal-800 leading-none">
                            {st.surfaces.join('')}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="w-px h-8 bg-slate-300 hidden sm:block" />

                {/* Q3: 31 to 38 */}
                <div className="flex items-center gap-1 p-1 bg-slate-50 rounded-xl border border-slate-200">
                  {MANDIBULAR_LEFT.map(t => {
                    const st = teethData[t];
                    const isSelected = selectedTooth === t;
                    return (
                      <button
                        key={t}
                        onClick={() => setSelectedTooth(t)}
                        className={`w-9 h-11 rounded-lg flex flex-col items-center justify-center font-mono text-xs transition-all cursor-pointer border ${getToothColor(st)} ${
                          isSelected ? 'ring-2 ring-sky-500 scale-105' : ''
                        }`}
                        title={`Tooth #${t}: ${st ? st.label : 'Healthy'}`}
                      >
                        <span className="font-bold">{t}</span>
                        {st && (
                          <span className="text-[9px] font-mono font-bold text-teal-800 leading-none">
                            {st.surfaces.join('')}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center justify-between px-2 text-[10px] font-mono uppercase tracking-widest text-slate-400">
                <span>Quadrant 4 (Lower Right)</span>
                <span className="font-bold text-slate-600">Mandibular Lower Arch</span>
                <span>Quadrant 3 (Lower Left)</span>
              </div>
            </div>
          </div>

          {/* Detailed Selected Tooth Radar Panel */}
          <div className="w-full max-w-4xl p-4 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-sky-50 border border-sky-200 text-sky-800 font-mono font-black text-base flex items-center justify-center">
                #{selectedTooth}
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">
                  {activeToothRecord.label}
                </h4>
                <p className="text-xs text-slate-500">
                  Surfaces: {activeToothRecord.surfaces.length > 0 ? activeToothRecord.surfaces.join(', ') : 'Intact'} • ADA Item Codes: 012, 531, 583
                </p>
              </div>
            </div>

            <button
              onClick={handleCopyNote}
              className="py-2.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center gap-2 shadow-xs cursor-pointer"
            >
              {copied ? <Check className="w-4 h-4 stroke-[2.5]" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Copied Note!' : 'Copy to PMS (Spacebar)'}</span>
            </button>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────── */}
      {/* PARADIGM 2: THE DYNAMIC SURGERY ISLAND (APPLE-TIER PILL)     */}
      {/* ──────────────────────────────────────────────────────────── */}
      {vizMode === 'island' && (
        <div className="p-12 bg-slate-100/70 border-b border-slate-200 flex flex-col items-center justify-center min-h-[360px]">
          <div className="text-center space-y-1 mb-8">
            <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-slate-500">
              Zero-Footprint Ambient Floating Capsule
            </span>
            <p className="text-xs text-slate-600">
              Floats detached above Dental4Windows or EXACT; expands smoothly on speech, taking 0px from charting
            </p>
          </div>

          {/* The Dynamic Island Capsule */}
          <motion.div
            layout
            initial={{ scale: 0.95 }}
            animate={{ scale: 1 }}
            className="p-3 px-6 rounded-full bg-slate-900 text-white shadow-2xl flex items-center gap-4 border border-slate-700"
          >
            {/* Live Audio Pulse */}
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-mono font-bold text-emerald-300">
                DSP Active
              </span>
            </div>

            <div className="w-px h-4 bg-slate-700" />

            {/* Active Patient & Extracted Chip */}
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-100">
                {patientDisplayName}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-teal-500/20 border border-teal-400/40 text-teal-300 font-mono text-xs font-bold">
                Tooth #16 MOD
              </span>
              <span className="px-2 py-0.5 rounded-full bg-sky-500/20 border border-sky-400/40 text-sky-300 font-mono text-xs">
                ADA 531
              </span>
            </div>

            <div className="w-px h-4 bg-slate-700" />

            {/* 1-Tap Copy Macro inside Island */}
            <button
              onClick={handleCopyNote}
              className="py-1.5 px-3 rounded-full bg-sky-500 hover:bg-sky-400 text-slate-950 font-black text-[11px] flex items-center gap-1.5 transition-all cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy PMS'}</span>
            </button>
          </motion.div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────── */}
      {/* PARADIGM 3: SURGICAL LOUPE TELEMETRY HUD (2-METER READABILITY)*/}
      {/* ──────────────────────────────────────────────────────────── */}
      {vizMode === 'hud' && (
        <div className="p-8 bg-white border-b border-slate-200 flex flex-col items-center justify-center space-y-6">
          <div className="text-center space-y-1">
            <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-slate-500">
              Surgical Loupe Telemetry HUD
            </span>
            <p className="text-xs text-slate-600">
              Extra-large, high-contrast typography engineered for effortless readability through 3.5x loupes from 2 meters
            </p>
          </div>

          {/* Giant Loupe Readability Card */}
          <div className="w-full max-w-2xl p-6 rounded-3xl bg-slate-50 border-2 border-slate-200 shadow-md flex flex-col gap-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500">
                  Active Patient in Surgery
                </span>
                <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                  {patientDisplayName}
                </h2>
              </div>
              <div className="text-right">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500">
                  Room Mic DSP
                </span>
                <div className="text-base font-mono font-bold text-emerald-700 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>{formatTimer(seconds)}</span>
                </div>
              </div>
            </div>

            {/* Giant Spoken Tooth Anchor */}
            <div className="flex items-center justify-between p-5 rounded-2xl bg-white border border-slate-200 shadow-sm">
              <div>
                <span className="text-xs font-mono font-bold text-slate-500 uppercase">
                  Detected Tooth & Surfaces
                </span>
                <div className="text-4xl font-black font-mono text-sky-700 mt-1 tracking-tight">
                  #16 MOD
                </div>
                <div className="text-sm font-semibold text-slate-700 mt-1">
                  Filtek Supreme A3 Composite Restoration
                </div>
              </div>

              <div className="flex flex-col items-end gap-2">
                <span className="text-xs font-mono font-bold text-slate-500 uppercase">
                  ADA Codes
                </span>
                <span className="px-3 py-1 rounded-xl bg-sky-100 text-sky-800 font-mono text-base font-black">
                  012 • 531 • 583
                </span>
              </div>
            </div>

            {/* Giant Glove-Friendly Copy Touch Target */}
            <button
              onClick={handleCopyNote}
              className={`w-full py-5 rounded-2xl font-black text-sm uppercase tracking-wider flex items-center justify-center gap-3 transition-all cursor-pointer shadow-md ${
                copied
                  ? 'bg-emerald-600 text-white'
                  : 'bg-sky-600 hover:bg-sky-500 text-white active:scale-98'
              }`}
            >
              {copied ? <Check className="w-5 h-5 stroke-[3]" /> : <Copy className="w-5 h-5" />}
              <span>{copied ? 'Copied to Windows Clipboard!' : 'Copy Note to PMS (Spacebar)'}</span>
            </button>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────── */}
      {/* PARADIGM 4: PANORAMIC OPERATORY HUD (DUAL-SCREEN FACING)     */}
      {/* ──────────────────────────────────────────────────────────── */}
      {vizMode === 'panoramic' && (
        <div className="p-6 bg-slate-50 border-b border-slate-200">
          <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left Column: Clinician Technical Console */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <span className="font-bold text-xs text-slate-800 uppercase tracking-wide">
                  Clinician Cockpit Stream
                </span>
                <span className="text-xs font-mono text-emerald-700 font-bold">
                  ● Natural Speech Stream
                </span>
              </div>

              <div className="space-y-2">
                <span className="text-xs font-mono font-bold text-slate-500 uppercase">
                  SOAP Clinical Shorthand
                </span>
                <pre className="text-xs font-mono text-slate-800 bg-slate-50 p-4 rounded-xl border border-slate-200 leading-relaxed select-text">
                  {formattedSoapNote}
                </pre>
              </div>

              <button
                onClick={handleCopyNote}
                className="w-full py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-xs"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? 'Copied!' : 'Copy to Dental4Windows / EXACT'}</span>
              </button>
            </div>

            {/* Right Column: Patient Education & Informed Consent View */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <span className="font-bold text-xs text-slate-800 uppercase tracking-wide">
                  Patient Visual Education View
                </span>
                <span className="text-xs text-teal-800 font-bold bg-teal-50 px-2 py-0.5 rounded">
                  Ceiling Display Mode
                </span>
              </div>

              {/* Tooth 16 Visual Highlight */}
              <div className="p-5 rounded-xl bg-teal-50/50 border border-teal-200 text-center space-y-2">
                <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-teal-800">
                  Tooth 16 (Upper Right Molar)
                </span>
                <div className="text-xl font-bold text-slate-900">
                  Mesio-Occlusal Composite Restoration
                </div>
                <p className="text-xs text-slate-600 max-w-sm mx-auto">
                  A tooth-colored resin restoration placed to restore natural tooth anatomy and seal deep fissures from decay.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs text-slate-700">
                <span className="font-bold text-slate-800">Informed Consent Status:</span>
                <p>• Risks and restorative options discussed with patient.</p>
                <p>• Patient consented to composite restoration under local anesthesia.</p>
                <div className="pt-2 flex items-center gap-2 text-emerald-800 font-semibold text-[11px]">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>AHPRA Compliant Clinical Record</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
