import React, { useState, useEffect } from 'react';
import {
  Mic,
  Square,
  Copy,
  Check,
  Sparkles,
  Clock,
  Maximize2,
  X,
  Volume2,
  ShieldCheck,
  ChevronRight,
  User,
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DayScheduleItem } from '../lib/dayScheduleStorage';
import { Consultation } from '../types';

interface SidebarDockModeProps {
  activePatient?: DayScheduleItem | Consultation | null;
  dentistName: string;
  clinicName?: string;
  onExpandCockpit: () => void;
  onFinishNote?: () => void;
  onClose?: () => void;
}

export default function SidebarDockMode({
  activePatient,
  dentistName,
  clinicName = 'Bright Smile Dental',
  onExpandCockpit,
  onFinishNote,
  onClose
}: SidebarDockModeProps) {
  const [seconds, setSeconds] = useState(0);
  const [isRecording, setIsRecording] = useState(true);
  const [copied, setCopied] = useState(false);
  const [liveChips, setLiveChips] = useState<string[]>([
    '#16 MOD',
    'ADA 531',
    'Caries Mesial',
    'Deep Excavation',
    'Fuji VII Base'
  ]);

  useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(interval);
  }, [isRecording]);

  const formatTimer = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return `${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const patientName = activePatient
    ? ('patientName' in activePatient ? activePatient.patientName : `${activePatient.firstName} ${activePatient.lastName}`)
    : 'Sarah Jenkins';

  const appointmentType = activePatient
    ? ('appointmentType' in activePatient ? activePatient.appointmentType : 'Restorative')
    : 'Restorative';

  const handleQuickCopy = () => {
    const sampleText = `PATIENT: ${patientName}\nDATE: ${new Date().toLocaleDateString('en-AU')}\nCLINICIAN: Dr. ${dentistName}\nAPPOINTMENT: ${appointmentType.toUpperCase()}\n----------------------------------------\nFINDINGS:\nTooth 16: Deep mesio-occlusal carious lesion. Cold test positive, non-lingering.\n\nTREATMENT PERFORMED:\nLocal anaesthetic: 2.2mL Scandonest 2% with 1:100k adrenaline.\nTooth 16: Excavation of caries under rubber dam. Indirect pulp protection with GC Fuji VII glass ionomer.\nEtch, Prime, Bond (3M Scotchbond Universal). Composite resin restoration (Filtek Supreme A3 MOD).\nFinishing and polishing burs, occlusion checked with articulating paper.\n\nADA CODES: 012, 531, 583\n----------------------------------------\nVERIFIED & SIGNED BY DR. ${dentistName.toUpperCase()}`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(sampleText);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <aside
      className="w-[340px] h-screen bg-[#070B11] border-l border-[#182638] text-white flex flex-col justify-between shadow-2xl shadow-black select-none z-50 fixed top-0 right-0"
      aria-label="DentAI Invisible Chairside Dock"
    >
      {/* Top Header */}
      <div className="p-3.5 border-b border-[#182638] bg-[#0A1018] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
          <span className="font-mono text-[11px] font-black tracking-widest text-cyan-400 uppercase">
            DentAI Dock (340px)
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={onExpandCockpit}
            className="p-1.5 rounded-lg bg-[#121E2E] hover:bg-[#18283D] border border-[#1E3048] text-slate-300 hover:text-white transition-colors cursor-pointer"
            title="Switch to Dual-Monitor Cockpit (Prototype B)"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
              title="Close Dock"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Operatory Room-Mic DSP Status Banner */}
      <div className="px-3.5 py-2 bg-[#09111C] border-b border-[#182638] flex items-center justify-between text-[10px] font-mono">
        <span className="text-emerald-400 flex items-center gap-1.5 font-bold">
          <Volume2 className="w-3 h-3 text-emerald-400" />
          <span>DSP Room Mic • 1.8m AGC</span>
        </span>
        <span className="text-slate-400">Drill Whistle Cut</span>
      </div>

      {/* Active Chairside Card */}
      <div className="p-3.5 flex-grow overflow-y-auto custom-scrollbar space-y-3.5">
        {/* Patient Capsule */}
        <div className="p-3 rounded-xl bg-[#0B1320] border border-[#182638] space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-black text-white truncate">{patientName}</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-950/60 text-cyan-300 border border-cyan-800/60 uppercase">
              {appointmentType}
            </span>
          </div>

          {/* Recording Timer & Mic Button */}
          <div className="flex items-center justify-between pt-1 border-t border-[#182638]">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsRecording(!isRecording)}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  isRecording
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 animate-pulse'
                    : 'bg-slate-800 text-slate-400'
                }`}
                title={isRecording ? 'Pause Mic Capture' : 'Resume Mic Capture'}
              >
                <Mic className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono text-sm font-black text-cyan-300">
                {formatTimer(seconds)}
              </span>
            </div>

            <span className="text-[10px] font-mono text-slate-400">
              {isRecording ? 'Listening Operatory' : 'Paused'}
            </span>
          </div>
        </div>

        {/* Live Detected FDI Teeth & Clinical Anchors */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
            <span className="flex items-center gap-1 text-cyan-400">
              <Sparkles className="w-3 h-3" />
              <span>Parsed Dental Anchors</span>
            </span>
            <span>Live Stream</span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {liveChips.map((chip, idx) => (
              <span
                key={idx}
                className="px-2.5 py-1 rounded-lg bg-[#0E1A2B] border border-cyan-500/30 text-cyan-300 font-mono text-[11px] font-bold shadow-xs flex items-center gap-1"
              >
                <span className="w-1 h-1 rounded-full bg-cyan-400" />
                {chip}
              </span>
            ))}
          </div>
        </div>

        {/* Shorthand Note Preview */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
            PMS Note Shorthand
          </span>
          <div className="p-2.5 rounded-xl bg-[#090E17] border border-[#152232] font-mono text-[11px] text-slate-300 leading-relaxed space-y-1 select-text">
            <p className="text-white font-bold">16 MOD Composite Restoration</p>
            <p className="text-slate-400">• LA: 2.2mL Scandonest 2% with 1:100k adr</p>
            <p className="text-slate-400">• Prep: Deep MO caries excavation under rubber dam</p>
            <p className="text-slate-400">• Lining: GC Fuji VII GIC sub-base</p>
            <p className="text-slate-400">• Restorative: Scotchbond + Filtek A3 MOD</p>
            <p className="text-teal-400 font-bold">• Codes: 012, 531, 583</p>
          </div>
        </div>

        {/* Rapid 1-Click Clipboard Action */}
        <button
          onClick={handleQuickCopy}
          className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-cyan-950/60 transition-all active:scale-98 cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4 stroke-[3]" />
              <span>Copied to PMS Clipboard!</span>
            </>
          ) : (
            <>
              <Copy className="w-4 h-4 fill-current" />
              <span>Copy Note for PMS (Spacebar)</span>
            </>
          )}
        </button>
      </div>

      {/* Bottom Footer: Next Patient Queue preview */}
      <div className="p-3 border-t border-[#182638] bg-[#0A1018] space-y-2 text-xs">
        <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 uppercase font-bold">
          <span>Up Next in Operatory</span>
          <span className="text-cyan-400">10:15 AM</span>
        </div>
        <div className="flex items-center justify-between p-2 rounded-lg bg-[#0C1420] border border-[#182638]">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-teal-950 border border-teal-800 text-teal-300 font-mono text-[10px] font-bold flex items-center justify-center">
              MT
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-white leading-tight">Mark Taylor</span>
              <span className="text-[10px] text-slate-400">Limited Emergency</span>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-500" />
        </div>
      </div>
    </aside>
  );
}
