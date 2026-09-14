import React, { useState, useEffect } from 'react';
import {
  Mic,
  Copy,
  Check,
  Sparkles,
  Clock,
  Maximize2,
  Minimize2,
  X,
  Volume2,
  ChevronRight,
  ChevronLeft,
  User,
  Zap,
  Activity,
  FileText,
  Plus,
  Gift
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DayScheduleItem, loadTodaySchedule, addWalkInPatient } from '../lib/dayScheduleStorage';
import { Consultation } from '../types';
import GiftChairModal from './GiftChairModal';

interface SidebarDockModeProps {
  activePatient?: DayScheduleItem | Consultation | null;
  dentistName: string;
  clinicName?: string;
  onExpandCockpit: () => void;
  onOpenSpeedReview?: () => void;
  onFinishNote?: () => void;
  onClose?: () => void;
  initialPillMode?: boolean;
}

export default function SidebarDockMode({
  activePatient,
  dentistName,
  clinicName = 'Bright Smile Dental',
  onExpandCockpit,
  onOpenSpeedReview,
  onFinishNote,
  onClose,
  initialPillMode = false
}: SidebarDockModeProps) {
  const [seconds, setSeconds] = useState(0);
  const [isRecording, setIsRecording] = useState(true);
  const [copied, setCopied] = useState(false);
  const [patientIndex, setPatientIndex] = useState(0);
  const [isPill, setIsPill] = useState(initialPillMode);
  const [showWalkInModal, setShowWalkInModal] = useState(false);
  const [showGiftModal, setShowGiftModal] = useState(false);
  const [walkInName, setWalkInName] = useState('');
  const [walkInEmergency, setWalkInEmergency] = useState(false);

  // Load real schedule from storage/database
  const [scheduleList, setScheduleList] = useState<DayScheduleItem[]>(() => {
    const list = loadTodaySchedule();
    return list.length > 0 ? list : [
      {
        id: 'sample-1',
        patientName: 'Sarah Jenkins',
        time: '09:00',
        procedureText: 'Restoration',
        appointmentType: 'examination',
        templateId: 'standard',
        status: 'scheduled',
        adaCodes: ['531', '583']
      } as DayScheduleItem
    ];
  });

  const currentPatient = activePatient
    ? {
        name: 'patientName' in activePatient ? activePatient.patientName : `${activePatient.firstName} ${activePatient.lastName}`,
        time: 'time' in activePatient && activePatient.time ? activePatient.time : '09:00 AM',
        procedure: 'appointmentType' in activePatient ? activePatient.appointmentType : 'Restorative',
        tooth: '#16 MOD',
        codes: '012, 531, 583'
      }
    : scheduleList[patientIndex % scheduleList.length]
    ? {
        name: scheduleList[patientIndex % scheduleList.length].patientName,
        time: scheduleList[patientIndex % scheduleList.length].time,
        procedure: scheduleList[patientIndex % scheduleList.length].procedureText || scheduleList[patientIndex % scheduleList.length].appointmentType,
        tooth: '#16 MOD',
        codes: scheduleList[patientIndex % scheduleList.length].adaCodes?.join(', ') || '531, 583'
      }
    : {
        name: 'Sarah Jenkins',
        time: '09:00 AM',
        procedure: 'Restoration',
        tooth: '#16 MOD',
        codes: '531, 583'
      };

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

  const formattedSoapNote = `PATIENT: ${currentPatient.name}
DATE: ${new Date().toLocaleDateString('en-AU')}
CLINICIAN: Dr. ${dentistName}
APPOINTMENT: ${currentPatient.procedure.toUpperCase()}
----------------------------------------
SOAP CLINICAL RECORD:
• Tooth: ${currentPatient.tooth}
• Diagnosis: Dental caries involving dentine. Cold test positive, non-lingering.
• Anesthetic: 2.2mL Scandonest 2% with 1:100,000 adrenaline.
• Procedure: Caries excavation under rubber dam. Indirect pulp cap with GC Fuji VII glass ionomer base. Etched, bonded with Scotchbond Universal, composite resin layered and light-cured.
• Material: Filtek Supreme A3.
• Occlusion & Post-Op: Occlusion checked with articulating paper, adjusted and polished. Warned of post-op numbness for 2-3 hours.
• Recall: 6 months routine recall.

ADA ITEM CODES: ${currentPatient.codes}
----------------------------------------
VERIFIED & SIGNED BY DR. ${dentistName.toUpperCase()}`;

  const handleQuickCopy = () => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(formattedSoapNote);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  const handleCreateWalkIn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!walkInName.trim()) return;
    const newItem = addWalkInPatient({
      patientName: walkInName.trim(),
      priority: walkInEmergency ? 'emergency' : 'normal',
      procedureText: walkInEmergency ? 'Emergency Exam / Pain Relief' : 'Ad-hoc Consultation'
    });
    const updated = loadTodaySchedule();
    setScheduleList(updated);
    setPatientIndex(0);
    setWalkInName('');
    setWalkInEmergency(false);
    setShowWalkInModal(false);
  };

  // Global Keyboard shortcuts: F12 or Alt+C or Spacebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.key === 'F12' || (e.altKey && e.code === 'KeyC') || e.code === 'Space') {
        e.preventDefault();
        handleQuickCopy();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [formattedSoapNote]);

  // Render 28px Ghost Title-Bar Micro-Pill Mode
  if (isPill) {
    return (
      <aside
        className="fixed top-2 right-4 z-50 h-8 rounded-full bg-slate-900/95 text-white border border-slate-700 shadow-2xl backdrop-blur-md px-3 py-1 flex items-center gap-3 font-sans select-none text-xs"
        aria-label="DentAI 28px Ghost Micro-Pill"
      >
        {/* Breathing Audio Dot */}
        <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => setIsRecording(!isRecording)}>
          <span className={`w-2 h-2 rounded-full ${isRecording ? 'bg-rose-500 animate-pulse' : 'bg-slate-500'}`} />
          <span className="font-mono text-[11px] font-bold text-slate-300">{formatTimer(seconds)}</span>
        </div>

        <div className="h-3 w-px bg-slate-700" />

        {/* Patient Name */}
        <div className="flex items-center gap-1.5 max-w-[140px] truncate">
          <span className="font-bold text-slate-100 truncate">{currentPatient.name}</span>
          <span className="text-[10px] text-teal-400 font-mono">({currentPatient.tooth})</span>
        </div>

        {/* 1-Click Copy Note (F12) */}
        <button
          onClick={handleQuickCopy}
          className={`px-2 py-0.5 rounded-full font-bold text-[10px] flex items-center gap-1 transition-all cursor-pointer ${
            copied
              ? 'bg-emerald-500 text-slate-950 font-black'
              : 'bg-sky-500/30 hover:bg-sky-500/50 text-sky-200 border border-sky-400/40'
          }`}
          title="Copy SOAP Note to Clipboard (Hotkey: F12)"
        >
          {copied ? <Check className="w-3 h-3 stroke-[3]" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'Copied!' : 'Copy (F12)'}</span>
        </button>

        <div className="h-3 w-px bg-slate-700" />

        {/* Expand to 340px Dock */}
        <button
          onClick={() => setIsPill(false)}
          className="p-1 rounded text-slate-400 hover:text-white transition-colors cursor-pointer"
          title="Expand to 340px Dock"
        >
          <Maximize2 className="w-3 h-3" />
        </button>
      </aside>
    );
  }
  return (
    <aside
      className="w-[340px] h-screen bg-white border-l border-slate-200 text-slate-900 flex flex-col justify-between shadow-2xl shadow-slate-900/10 select-none z-50 fixed top-0 right-0 font-sans"
      aria-label="DentAI Invisible Chairside Companion"
    >
      {/* 1. Crisp Medical Header */}
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-teal-600" />
          <span className="font-semibold text-xs tracking-wide text-slate-800 uppercase">
            DentAI Companion
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 font-mono font-medium">
            340px
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsPill(true)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200 transition-colors cursor-pointer"
            title="Collapse to 28px Ghost Micro-Pill"
            aria-label="Collapse to 28px Ghost Micro-Pill"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onExpandCockpit}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200 transition-colors cursor-pointer"
            title="Expand to Full Cockpit / History Dashboard"
            aria-label="Expand cockpit"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
              title="Close Companion"
              aria-label="Close companion"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Calm Audio DSP Status Pill (Zero peripheral distraction) */}
      <div className="px-4 py-2 bg-slate-100/80 border-b border-slate-200 flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
          <span className="font-medium text-slate-700">
            Room Mic Active <span className="text-slate-500 font-normal">(DSP Filtered)</span>
          </span>
        </div>
        {/* Subtle, calm volume indicator */}
        <div className="flex items-center gap-0.5 h-2.5">
          <span className="w-1 h-1.5 bg-emerald-500 rounded-full" />
          <span className="w-1 h-2 bg-emerald-500 rounded-full" />
          <span className="w-1 h-2.5 bg-emerald-500 rounded-full" />
          <span className="w-1 h-1 bg-slate-300 rounded-full" />
        </div>
      </div>

      {/* 3. Main Operatory Content Area */}
      <div className="p-4 flex-grow overflow-y-auto space-y-4">
        {/* Active Patient Card with Switcher */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-mono font-semibold text-slate-700">{currentPatient.time}</span>
            </div>
            {/* Prev / Next Patient Selector + Walk-In Button */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowWalkInModal(true)}
                className="px-1.5 py-0.5 rounded bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 text-[10px] font-bold flex items-center gap-0.5 cursor-pointer"
                title="Add Ad-hoc Walk-in Patient"
              >
                <Plus className="w-3 h-3" />
                <span>Walk-In</span>
              </button>
              <button
                onClick={() => setPatientIndex(i => Math.max(0, i - 1))}
                className="p-1 rounded hover:bg-slate-200 text-slate-500 disabled:opacity-30 cursor-pointer"
                disabled={patientIndex === 0}
                title="Previous Patient"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] font-mono text-slate-500 px-1">
                {patientIndex + 1}/{scheduleList.length}
              </span>
              <button
                onClick={() => setPatientIndex(i => (i + 1) % scheduleList.length)}
                className="p-1 rounded hover:bg-slate-200 text-slate-500 cursor-pointer"
                title="Next Patient"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold text-slate-900 leading-tight">
              {currentPatient.name}
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              {currentPatient.procedure}
            </p>
          </div>

          {/* Recording Status & Controls */}
          <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsRecording(!isRecording)}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  isRecording
                    ? 'bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100'
                    : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                }`}
                title={isRecording ? 'Pause Recording' : 'Resume Recording'}
              >
                <Mic className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono text-xs font-bold text-slate-800">
                {formatTimer(seconds)}
              </span>
            </div>
            <span className="text-[11px] text-slate-500 font-medium">
              {isRecording ? 'Capturing natural speech' : 'Paused'}
            </span>
          </div>
        </div>

        {/* Mini Anatomical Tooth Arch */}
        <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 shadow-2xs">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase text-slate-500 font-semibold">
            <span>Anatomical Tooth Arch</span>
            <span className="text-teal-700 font-bold">FDI Live</span>
          </div>
          <div className="flex items-center justify-between gap-1">
            {['18', '17', '16', '15', '14', '24', '25', '26'].map((t) => {
              const isTarget = t === '16';
              const isOther = t === '24';
              return (
                <div
                  key={t}
                  className={`flex-1 py-1.5 rounded text-center font-mono text-[10px] font-bold border transition-all ${
                    isTarget
                      ? 'bg-teal-50 border-teal-400 text-teal-800 ring-1 ring-teal-400'
                      : isOther
                      ? 'bg-amber-50 border-amber-400 text-amber-800'
                      : 'bg-white border-slate-200 text-slate-500'
                  }`}
                >
                  <div>{t}</div>
                  <div className="text-[8px] leading-none opacity-80">{isTarget ? 'MOD' : isOther ? 'O' : '—'}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Real-Time Clinical Anchors (FDI & ADA Chips) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
            <span>Detected Dental Anchors</span>
            <span className="text-teal-700 font-semibold">100% FDI Recall</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="px-2 py-0.5 rounded-md bg-teal-50 border border-teal-200 text-teal-800 font-mono text-xs font-bold">
              {currentPatient.tooth}
            </span>
            <span className="px-2 py-0.5 rounded-md bg-sky-50 border border-sky-200 text-sky-800 font-mono text-xs font-semibold">
              ADA {currentPatient.codes}
            </span>
            <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 text-xs">
              Filtek A3
            </span>
            <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 text-xs">
              Fuji VII Base
            </span>
          </div>
        </div>

        {/* Clean SOAP Clinical Note Preview */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
            <span>Clinical Shorthand (SOAP)</span>
            <span className="text-[10px] text-slate-400">D4W / EXACT Ready</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 font-mono leading-relaxed space-y-1 select-text max-h-56 overflow-y-auto custom-scrollbar">
            <p className="font-bold text-slate-900">• Tooth: {currentPatient.tooth}</p>
            <p className="text-slate-600">• Diagnosis: Caries into dentine</p>
            <p className="text-slate-600">• LA: 2.2mL Scandonest 2% 1:100k</p>
            <p className="text-slate-600">• Prep: Caries excavation, rubber dam</p>
            <p className="text-slate-600">• Lining: Fuji VII sub-base</p>
            <p className="text-slate-600">• Restoration: Scotchbond + Filtek A3</p>
            <p className="text-slate-600">• Occlusion: Checked with paper, good</p>
            <p className="text-teal-800 font-semibold">• Codes: {currentPatient.codes}</p>
          </div>
        </div>

        {/* Prominent Medical Blue Copy Button */}
        <button
          onClick={handleQuickCopy}
          className={`w-full py-3 px-4 rounded-xl font-bold text-xs tracking-wide flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm ${
            copied
              ? 'bg-emerald-600 text-white shadow-emerald-600/30'
              : 'bg-sky-600 hover:bg-sky-500 text-white shadow-sky-600/30 active:scale-98'
          }`}
        >
          {copied ? (
            <>
              <Check className="w-4 h-4 stroke-[2.5]" />
              <span>Copied to PMS Clipboard!</span>
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" />
              <span>Copy Note to PMS (Spacebar)</span>
            </>
          )}
        </button>
      </div>

      {/* 4. Prominent End-of-Day Review Action */}
      <div className="p-3.5 border-t border-slate-200 bg-slate-50">
        <button
          onClick={() => {
            if (onOpenSpeedReview) onOpenSpeedReview();
            else onExpandCockpit();
          }}
          className="w-full py-2.5 px-3 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
        >
          <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
          <span>⚡ 5:00 PM Speed Review (All Notes)</span>
        </button>

        <button
          onClick={() => setShowGiftModal(true)}
          className="w-full mt-2 py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 hover:from-emerald-100 hover:to-teal-100 border border-emerald-200 text-emerald-800 font-bold text-xs flex items-center justify-center gap-1.5 shadow-2xs transition-all cursor-pointer"
        >
          <Gift className="w-3.5 h-3.5 text-emerald-600" />
          <span>🎁 Gift Chair 2 (30-Day Free Pass)</span>
        </button>
      </div>

      {/* Gift Chair 2 Modal */}
      <GiftChairModal
        isOpen={showGiftModal}
        onClose={() => setShowGiftModal(false)}
        clinicName={clinicName}
        dentistName={dentistName}
      />

      {/* Ad-Hoc Walk-In Modal */}
      <AnimatePresence>
        {showWalkInModal && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 max-w-xs w-full text-slate-900"
            >
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                  <Plus className="w-4 h-4 text-teal-600" />
                  <span>Add Walk-In Patient</span>
                </h4>
                <button
                  type="button"
                  onClick={() => setShowWalkInModal(false)}
                  className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={handleCreateWalkIn} className="space-y-3 text-xs">
                <div>
                  <label className="block text-slate-600 font-semibold mb-1">Patient Name</label>
                  <input
                    type="text"
                    required
                    autoFocus
                    placeholder="e.g. John Miller"
                    value={walkInName}
                    onChange={(e) => setWalkInName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                  />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="emergency-check"
                    checked={walkInEmergency}
                    onChange={(e) => setWalkInEmergency(e.target.checked)}
                    className="w-4 h-4 rounded text-rose-600 border-slate-300 focus:ring-rose-500 cursor-pointer"
                  />
                  <label htmlFor="emergency-check" className="text-slate-700 font-medium cursor-pointer">
                    Urgent Emergency / Severe Pain
                  </label>
                </div>
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowWalkInModal(false)}
                    className="px-3 py-1.5 rounded-lg text-slate-600 hover:bg-slate-100 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-bold shadow-xs cursor-pointer"
                  >
                    Seat Patient
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </aside>
  );
}
