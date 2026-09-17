/**
 * Animated scene recreations for the narrated DentAI demo.
 *
 * Each scene is a self-contained, styled recreation of a real DentAI screen
 * (same branding, layout language and flow), driven by a `progress` value
 * (0..1 within the scene) so the player feels like a video: cards stagger in,
 * text "types", transcripts stream line by line, and the key CTA pulses when
 * the narration calls it out.
 *
 * These are recreations on purpose — the demo must run with zero backend, so
 * it never calls /api or touches real patient storage.
 */
import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Menu,
  User,
  Plus,
  Search,
  Mic,
  Sparkles,
  MicOff,
  ShieldCheck,
  Building2,
  KeyRound,
  Copy,
  RefreshCw,
  Check,
  CheckCircle2,
  AlertCircle,
  FileText,
  ClipboardList,
  Save,
  XCircle,
  PlayCircle,
  WifiOff,
  Bot,
  Lock,
  UserPlus,
  ArrowRight,
  ChevronDown,
  Pencil,
  TrendingUp,
  Clock,
  Share2,
  DollarSign,
  Award,
  Zap,
  Users,
  Phone,
} from 'lucide-react';
import type { DemoScene } from './demoScript';

interface SceneProps {
  scene: DemoScene;
  progress: number; // 0..1 within this scene
}

// ---------------------------------------------------------------------------
// Shared primitives (mimic the real app's visual language)
// ---------------------------------------------------------------------------

function Avatar({ initials, className = '' }: { initials: string; className?: string }) {
  return (
    <div
      className={`w-8 h-8 rounded-full bg-secondary-container flex items-center justify-center text-primary font-bold text-xs shadow-sm ${className}`}
    >
      {initials}
    </div>
  );
}

function Chip({
  children,
  tone = 'slate',
}: {
  children: React.ReactNode;
  tone?: 'slate' | 'indigo' | 'emerald' | 'amber' | 'red';
}) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-600 border-slate-200',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    red: 'bg-red-50 text-red-700 border-red-200',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** The app's top app bar (white, border-b, wordmark + avatar). */
function AppBar({
  title,
  subtitle,
  right,
}: {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="shrink-0 h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 z-10">
      <div className="flex items-center gap-3 min-w-0">
        <Menu className="text-primary w-5 h-5 shrink-0" />
        {title ? (
          <div className="flex flex-col min-w-0">
            <h3 className="text-sm font-bold text-slate-800 leading-tight truncate">{title}</h3>
            {subtitle && (
              <span className="text-[9px] text-indigo-600 font-extrabold uppercase tracking-widest leading-none">
                {subtitle}
              </span>
            )}
          </div>
        ) : (
          <h1 className="text-lg font-bold text-primary">DentAI</h1>
        )}
      </div>
      <div className="flex items-center gap-3">{right}</div>
    </header>
  );
}

function PrimaryButton({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-xs font-bold shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

/** Pulsing attention ring used to highlight whatever the narration is describing. */
function Spotlight({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div className={`relative ${show ? 'rounded-xl ring-2 ring-primary/50 ring-offset-2 ring-offset-white transition-all duration-300' : ''}`}>
      {children}
    </div>
  );
}

function useStagger(progress: number, total: number): number {
  // Number of items revealed given progress — items appear at even intervals
  // across the scene (last one lands ~80% through so narration still runs).
  if (total <= 0) return 0;
  const revealed = Math.ceil(progress * (total + 1) - 0.5);
  return Math.max(0, Math.min(total, revealed));
}

// ---------------------------------------------------------------------------
// Scene data
// ---------------------------------------------------------------------------

const TODAY_CONSULTATIONS = [
  { initials: 'PS', name: 'Priya Sharma', proc: 'Comprehensive Examination', time: '09:45 AM', status: 'Completed' as const, tone: 'bg-primary-fixed text-on-primary-fixed' },
  { initials: 'DN', name: 'David Nguyen', proc: 'Scale & Clean (Hygiene)', time: '08:30 AM', status: 'In Review' as const, tone: 'bg-secondary-container text-on-secondary-container' },
  { initials: 'JM', name: 'John Mitchell', proc: 'Emergency / Pain Relief', time: '08:05 AM', status: 'In Review' as const, tone: 'bg-surface-container-highest text-on-secondary-fixed' },
];

const OWNER_CONSULTATIONS = [
  { initials: 'CB', name: 'Chloe Brown', proc: 'Restorative (Filling)', time: '10:20 AM', status: 'Completed' as const, tone: 'bg-secondary-container text-on-secondary-container', by: 'Dr. Emily Carter' },
  { initials: 'SW', name: 'Sam Whitfield', proc: 'Endodontic (Root Canal)', time: '09:10 AM', status: 'Completed' as const, tone: 'bg-surface-container-highest text-on-secondary-fixed', by: 'Dr. Alex Patel' },
  { initials: 'AF', name: 'Alan Foster', proc: 'Surgical (Extraction)', time: '08:40 AM', status: 'In Review' as const, tone: 'bg-error-container text-on-error-container', by: 'Dr. Emily Carter' },
];

const RECORD_TRANSCRIPT = [
  { sender: 'Dentist', text: "Good morning Priya, I'm Dr Kumar. What brings you in today?" },
  { sender: 'Patient', text: "I've noticed a little bleeding when I brush my lower front teeth." },
  { sender: 'Dentist', text: 'Any pain or sensitivity anywhere?' },
  { sender: 'Patient', text: 'No pain at all — just the bleeding, and my gums look a bit red.' },
  { sender: 'Clinical Comment', text: 'BPE 2 in lower anterior sextant, 1s elsewhere. Early enamel caries on tooth 46.' },
  { sender: 'Dentist', text: "The main thing is gum inflammation — a clean and better flossing will sort that out. Item 011 today." },
];

const SUMMARY_SECTIONS = [
  { label: 'Chief Complaint', value: 'Bleeding on brushing lower anteriors for several months; no pain.' },
  { label: 'Medical & Dental History', value: 'Generally well. No medications, no allergies. Brushes 2x daily, flosses rarely.' },
  { label: 'Hard Tissue & Tooth Findings', value: 'BPE 2 lower anteriors, 1s elsewhere. Early enamel caries tooth 46 — no filling indicated today.' },
  { label: 'Diagnosis & Clinical Assessment', value: 'Generalised plaque-induced gingivitis. Incipient caries tooth 46.' },
  { label: 'Treatment Performed Today', value: 'Comprehensive examination (item 011), 2 bitewings (item 026). OHI provided.' },
  { label: 'Recall & Next Appointment', value: 'Six months — hygiene recall and review of tooth 46.' },
];

// ---------------------------------------------------------------------------
// Scene renderers
// ---------------------------------------------------------------------------

function TitleScene({ scene, progress }: SceneProps) {
  const owner = scene.props?.owner === true;
  return (
    <div className="h-full w-full flex items-center justify-center bg-[#F8F7F5] relative overflow-hidden">
      <div className="absolute -top-24 -left-16 w-96 h-96 rounded-full bg-indigo-50/60 blur-[100px]" />
      <div className="absolute -bottom-24 -right-16 w-96 h-96 rounded-full bg-emerald-50/40 blur-[110px]" />
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
        className="relative flex flex-col items-center text-center px-8 max-w-2xl"
      >
        <div className="rounded-full px-4 py-1.5 bg-indigo-50 border border-indigo-100 flex items-center gap-1.5 mb-6">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span className="text-[10px] text-primary font-extrabold tracking-[0.18em] uppercase">
            {owner ? 'Clinic Owner Walkthrough' : 'Product Demo · Narrated'}
          </span>
        </div>
        <div className="flex items-center gap-3 mb-5">
          {owner && (
            <div className="w-11 h-11 rounded-2xl bg-primary text-white flex items-center justify-center shadow-lg shadow-primary/25">
              <Building2 className="w-5 h-5" />
            </div>
          )}
          <h2 className="text-4xl md:text-5xl font-extrabold text-slate-800 tracking-tight">
            DentAI
          </h2>
        </div>
        <p className="text-slate-500 text-base md:text-lg leading-relaxed max-w-lg">
          {owner
            ? 'Practice-wide visibility, member management and AI metering — built for the people running the clinic.'
            : 'The ambient clinical scribe that turns conversations into compliance-aligned notes.'}
        </p>
        <div className="flex items-center gap-2 mt-8 text-slate-400 text-xs font-bold uppercase tracking-widest">
          <span className={`w-2 h-2 rounded-full ${owner ? 'bg-primary' : 'bg-emerald-600'} animate-pulse`} />
          <span>{owner ? '2 minutes' : '3 minutes'} · narration on</span>
        </div>
      </motion.div>
    </div>
  );
}

function LoginScene({ progress }: SceneProps) {
  const doctorName = 'Dr. Emily Carter';
  // Typing simulation: 0.05 -> 0.38
  const nameChars = Math.max(0, Math.min(doctorName.length, Math.floor(((progress - 0.05) / 0.33) * doctorName.length)));
  const displayedName = progress < 0.05 ? '' : doctorName.slice(0, nameChars);
  const nameCompleted = progress >= 0.38;

  // PIN simulation: 0.42 -> 0.78
  const pinFilled = Math.floor(((progress - 0.42) / 0.36) * 4.6);
  const typedDots = Math.max(0, Math.min(4, pinFilled));
  const pinCompleted = typedDots === 4;

  // Submitting / Authenticated state: 0.82 -> 1.0
  const isSubmitting = progress >= 0.82;

  return (
    <div className="h-full w-full bg-[#F8F7F5] flex items-center justify-center relative overflow-hidden px-6">
      <div className="absolute top-[-20%] left-[-10%] w-80 h-80 rounded-full bg-indigo-50/50 blur-[90px]" />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md bg-white rounded-3xl p-6 shadow-xl border border-slate-200/70 relative z-10 flex flex-col items-center"
      >
        <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-primary mb-3">
          <ShieldCheck className="w-6 h-6" />
        </div>

        <div className="rounded-full px-3 py-0.5 bg-indigo-50/80 border border-indigo-100/80 flex items-center gap-1.5 mb-2">
          <Sparkles className="w-3 h-3 text-primary" />
          <span className="text-[9px] text-primary font-extrabold tracking-[0.14em] uppercase">
            Private Clinician Access
          </span>
        </div>

        <h3 className="text-xl font-extrabold text-slate-800 tracking-tight">Clinician Sign In</h3>
        <p className="text-slate-500 text-xs mt-1 text-center max-w-xs">
          Enter your registered practitioner name or ID and secure 4-digit PIN.
        </p>

        <div className="w-full mt-5 space-y-4">
          {/* Practitioner Name Input */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">
              Practitioner Name or ID
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <User className="w-4 h-4" />
              </div>
              <div className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 flex items-center h-10">
                {displayedName}
                {progress < 0.38 && (
                  <span className="w-1.5 h-4 bg-primary ml-0.5 animate-pulse" />
                )}
              </div>
              {nameCompleted && (
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center text-emerald-600">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              )}
            </div>
          </div>

          {/* PIN Input & Dots */}
          <div className="flex flex-col items-center pt-1">
            <label className="text-[11px] font-bold text-slate-600 mb-2">
              4-Digit Security PIN
            </label>
            <div className="flex gap-3 mb-4">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`w-3.5 h-3.5 rounded-full border-2 transition-all duration-200 ${
                    typedDots > i
                      ? 'bg-primary border-primary shadow-[0_0_8px_rgba(15,82,186,0.4)] scale-110'
                      : 'border-slate-300'
                  }`}
                />
              ))}
            </div>

            {/* Micro Keypad */}
            <div className="grid grid-cols-3 gap-x-4 gap-y-2 w-full max-w-[200px]">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0'].map((k, i) => (
                <div
                  key={i}
                  className={`w-9 h-9 mx-auto rounded-xl flex items-center justify-center text-xs font-bold border transition-all ${
                    typedDots >= Math.min(4, i + 1) && typedDots > 0
                      ? 'bg-primary text-white border-primary shadow-sm'
                      : 'bg-[#faf9f7] text-slate-700 border-slate-200'
                  }`}
                >
                  {k}
                </div>
              ))}
              <div className="w-9 h-9 mx-auto flex items-center justify-center text-slate-300">
                <Lock className="w-3.5 h-3.5" />
              </div>
            </div>
          </div>

          {/* Action button / Status indicator */}
          <div className="pt-2">
            <div
              className={`w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                isSubmitting
                  ? 'bg-emerald-600 text-white shadow-md'
                  : pinCompleted
                  ? 'bg-primary text-white shadow-md'
                  : 'bg-slate-100 text-slate-400 border border-slate-200'
              }`}
            >
              {isSubmitting ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Authenticated · Opening Hub...</span>
                </>
              ) : pinCompleted ? (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  <span>Verifying Credentials...</span>
                </>
              ) : (
                <span>Enter Credentials to Sign In</span>
              )}
            </div>
          </div>
        </div>

        {/* Privacy Note */}
        <div className="mt-4 pt-3 border-t border-slate-100 w-full flex items-center justify-between text-[10px] text-slate-400">
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-emerald-600" />
            Confidential Clinician Mode
          </span>
          <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">
            MFA Supported
          </span>
        </div>
      </motion.div>
    </div>
  );
}

function HistoryScene({ scene, progress }: SceneProps) {
  const isOwner = scene.kind === 'owner-history';
  const list = isOwner ? OWNER_CONSULTATIONS : TODAY_CONSULTATIONS;
  const revealed = useStagger(progress, list.length);
  const typing = progress > 0.45 && progress < 0.8;

  return (
    <div className="h-full w-full bg-[#F8F7F5] flex flex-col">
      <AppBar
        right={
          <>
            <PrimaryButton className="hidden md:flex">
              <Plus className="w-4 h-4" /> New Consultation
            </PrimaryButton>
            <div className="flex flex-col items-end">
              <span className="text-[11px] font-bold text-slate-800">
                {isOwner ? 'Dr. Sarah Chen' : 'Dr. Emily Carter'}
              </span>
              <span className="text-[8px] text-red-600 font-extrabold uppercase tracking-wider">Logout</span>
            </div>
            <Avatar initials={isOwner ? 'SC' : 'EC'} />
          </>
        }
      />
      <div className="flex-1 overflow-hidden px-5 pt-4 pb-2">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-bold text-slate-800">History Hub</h2>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Manage & review records</span>
          </div>
          {isOwner && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: progress > 0.12 ? 1 : 0 }}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary-light/70 border border-indigo-100 text-primary text-[11px] font-semibold mt-2.5"
            >
              <Building2 className="w-3.5 h-3.5 shrink-0" />
              <span>
                Owner view — showing notes recorded by every dentist in <b>Bright Smile Dental</b>.
              </span>
            </motion.div>
          )}
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <div className="h-10 pl-9 pr-3 flex items-center bg-white border border-slate-200 rounded-xl text-xs text-slate-400 shadow-sm">
              {typing ? 'Search patient name, procedure, or complaints...' : 'Search patient name, procedure, or complaints...'}
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-center gap-2 px-1 mb-2">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Today</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>
            <div className="space-y-2">
              {list.slice(0, revealed).map((c) => (
                <motion.div
                  key={c.initials}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white border border-slate-100 rounded-2xl p-3 flex items-center justify-between shadow-sm"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shadow-sm ${c.tone}`}>
                      {c.initials}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-bold text-slate-800 text-sm">{c.name}</span>
                      <span className="text-slate-500 text-[11px]">{c.proc}</span>
                      {'by' in c && (
                        <span className="text-[9px] font-semibold text-slate-400">Recorded by {c.by}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Chip tone={c.status === 'Completed' ? 'emerald' : 'indigo'}>
                      <span className={`w-1.5 h-1.5 rounded-full ${c.status === 'Completed' ? 'bg-emerald-600' : 'bg-indigo-600'}`} />
                      {c.status}
                    </Chip>
                    <span className="font-mono text-slate-400 text-[10px]">{c.time}</span>
                  </div>
                </motion.div>
              ))}
              {revealed >= list.length && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center gap-2 px-1 pt-1"
                >
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Yesterday</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </motion.div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function IntakeScene({ scene, progress }: SceneProps) {
  const step = Number(scene.props?.step ?? 1);
  const revealed = Math.max(0, Math.min(3, Math.floor((progress * 1000) / 300)));
  const canContinue = progress > 0.5;

  return (
    <div className="h-full w-full bg-white flex flex-col">
      <AppBar
        title={step === 1 ? 'Patient Identity' : step === 2 ? 'Session Context' : 'Clinical Consent'}
        subtitle="Step X of 3"
        right={
          <>
            <div className="flex flex-col items-end mr-1">
              <span className="text-[9px] text-slate-400 uppercase tracking-widest font-bold">Step</span>
              <span className="text-primary font-bold text-xs">{step} of 3</span>
            </div>
            <User className="text-primary w-5 h-5" />
          </>
        }
      />
      <div className="flex-1 overflow-hidden px-5 pt-3">
        <div className="max-w-md mx-auto">
          {/* Progress header */}
          <div className="flex items-center gap-1.5 mb-2">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-1.5">
                <div
                  className={`w-5 h-5 rounded-lg flex items-center justify-center font-bold text-[10px] border transition-all ${
                    step === s
                      ? 'bg-primary border-primary text-white shadow-sm'
                      : step > s
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                      : 'bg-slate-50 border-slate-200 text-slate-400'
                  }`}
                >
                  {step > s ? '✓' : s}
                </div>
                <span className={`text-[9px] font-extrabold uppercase tracking-wider hidden sm:inline ${step === s ? 'text-primary' : 'text-slate-400'}`}>
                  {s === 1 ? 'Identity' : s === 2 ? 'Context' : 'Consent'}
                </span>
                {s < 3 && <div className="w-6 h-px bg-slate-200 ml-1" />}
              </div>
            ))}
          </div>
          <div className="w-full h-1 bg-[#efecff] rounded-full overflow-hidden mb-4">
            <div className="h-full bg-primary transition-all duration-500" style={{ width: `${(step / 3) * 100}%` }} />
          </div>

          <div className="flex flex-col gap-3.5">
            {step === 1 && (
              <>
                {[
                  { label: 'First Name', value: 'Priya' },
                  { label: 'Last Name', value: 'Sharma' },
                  { label: 'Date of Birth', value: '14/03/1989' },
                ].map((f, i) => (
                  <motion.div key={f.label} initial={{ opacity: 0, x: 12 }} animate={{ opacity: revealed > i ? 1 : 0, x: revealed > i ? 0 : 12 }} className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{f.label}</label>
                    <div className="h-10 px-3 flex items-center bg-[#fcf8ff] border border-slate-200 rounded-lg text-sm text-slate-700">
                      {revealed > i ? f.value : <span className="text-slate-300">…</span>}
                    </div>
                  </motion.div>
                ))}
              </>
            )}
            {step === 2 && (
              <>
                <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: revealed > 0 ? 1 : 0, x: revealed > 0 ? 0 : 12 }} className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Treatment / Appointment Type</label>
                  <div className="h-10 px-3 flex items-center justify-between bg-[#fcf8ff] border border-slate-200 rounded-lg text-sm font-medium text-slate-700">
                    <span>{revealed > 0 ? 'Comprehensive Examination' : '…'}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  </div>
                  {revealed > 0 && (
                    <span className="text-[10px] text-slate-400">Full-mouth assessment, charting, diagnosis and treatment planning.</span>
                  )}
                </motion.div>
                <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: revealed > 1 ? 1 : 0, x: revealed > 1 ? 0 : 12 }} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Note Template</label>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Recommended</span>
                  </div>
                  <div className="h-10 px-3 flex items-center justify-between bg-[#fcf8ff] border border-slate-200 rounded-lg text-xs font-medium text-slate-700">
                    <span>{revealed > 1 ? 'AHPRA Standard (8-Point) — Board Record Format' : '…'}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  </div>
                  {revealed > 1 && (
                    <span className="text-[10px] text-indigo-500 font-semibold">
                      DentAI will extract this template's sections (AHPRA Standard) from the transcript.
                    </span>
                  )}
                </motion.div>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: revealed > 2 ? 1 : 0 }}
                  className="p-3 bg-indigo-50/70 rounded-xl border border-indigo-100 flex items-start gap-2.5"
                >
                  <Sparkles className="text-primary w-4 h-4 shrink-0 mt-0.5" />
                  <p className="text-slate-600 text-[11px] leading-relaxed">
                    DentAI preconfigures a note template for each of the 8 treatment types — the template decides which
                    sections the AI fills from the transcript and how they are formatted for your PMS.
                  </p>
                </motion.div>
              </>
            )}
            {step === 3 && (
              <>
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: revealed > 0 ? 1 : 0, y: revealed > 0 ? 0 : 10 }} className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="flex items-center gap-2 text-red-600 mb-1.5">
                    <ShieldCheck className="w-4 h-4" />
                    <span className="font-bold text-[10px] uppercase tracking-wider">Legal Disclosure</span>
                  </div>
                  <p className="text-slate-600 text-[11px] leading-relaxed">
                    By initiating this recording you confirm the patient has been informed that DentAI uses AI to assist
                    charting. All data is processed securely in line with Australian privacy law (Privacy Act 1988). The
                    practitioner remains solely responsible for findings.
                  </p>
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: revealed > 1 ? 1 : 0, y: revealed > 1 ? 0 : 10 }}
                  className={`flex items-start gap-3 p-3.5 rounded-xl border transition-all ${
                    canContinue ? 'bg-emerald-50/60 border-emerald-300' : 'bg-white border-slate-200'
                  }`}
                >
                  <div className={`h-5 w-5 rounded border flex items-center justify-center mt-0.5 shrink-0 ${canContinue ? 'bg-emerald-600 border-transparent text-white' : 'border-slate-300 bg-white'}`}>
                    {canContinue && <Check className="w-3 h-3 stroke-[3]" />}
                  </div>
                  <div className="flex flex-col">
                    <span className="font-semibold text-slate-800 text-sm">Verbal Consent Obtained</span>
                    <span className="text-slate-500 text-[11px] mt-0.5 leading-relaxed">
                      I have verbally informed the patient and received explicit consent to record this session.
                    </span>
                  </div>
                </motion.div>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="shrink-0 bg-white border-t border-slate-200 px-5 py-3 flex items-center justify-between">
        <span className="text-slate-400 text-xs font-semibold flex items-center gap-1.5">
          <ArrowRight className="w-3.5 h-3.5 opacity-0" /> Back
        </span>
        <Spotlight show={canContinue}>
          <div
            className={`px-6 h-10 rounded-full flex items-center gap-2 text-xs font-bold shadow-md transition-all ${
              canContinue
                ? step === 3
                  ? 'bg-emerald-600 text-white'
                  : 'bg-primary text-white'
                : 'bg-slate-100 text-slate-400'
            }`}
          >
            {step === 3 ? 'Start Session' : 'Continue'}
            {step === 3 ? <Mic className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
          </div>
        </Spotlight>
      </div>
    </div>
  );
}

function RecordScene({ scene, progress }: SceneProps) {
  const focusOptions = scene.props?.focus === 'options';
  const shownItems = Math.floor(progress * RECORD_TRANSCRIPT.length);
  const pulsePhase = (progress % 0.5) < 0.25;
  const sessionSecs = Math.floor(progress * 300);
  const clockMins = 9 + Math.floor(sessionSecs / 60);
  const clockSecs = (sessionSecs % 60).toString().padStart(2, '0');

  return (
    <div className="h-full w-full bg-[#F8F7F5] flex flex-col overflow-hidden">
      <AppBar
        title="Priya Sharma"
        subtitle="Comprehensive Examination"
        right={
          <>
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-slate-200 bg-white">
              <Sparkles className={`w-3 h-3 ${pulsePhase ? 'text-primary' : 'text-slate-300'}`} />
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">2/20 AI notes today</span>
            </div>
            <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-200 bg-white text-primary">
              <Sparkles className="w-3 h-3 animate-pulse" />
              <span className="text-[9px] font-bold uppercase tracking-wider">Go Ambient</span>
            </div>
            <Avatar initials="PS" />
          </>
        }
      />
      <div className="flex-1 overflow-hidden px-5 pt-3 pb-2 relative">
        <div className="max-w-xl mx-auto h-full flex flex-col">
          <div className="flex justify-center mb-2">
            <span className="text-[10px] font-semibold text-slate-500 bg-white/80 border border-slate-200 px-3 py-1 rounded-full shadow-sm">
              {clockMins}:{clockSecs} — Clinical Session Started
            </span>
          </div>
          <div className="flex-1 overflow-hidden space-y-2">
            {RECORD_TRANSCRIPT.slice(0, shownItems).map((item, i) => {
              const isComment = item.sender === 'Clinical Comment';
              const badge = isComment
                ? 'bg-blue-50 text-blue-700 border-blue-150'
                : item.sender === 'Patient'
                ? 'bg-amber-50 text-amber-700 border-amber-150'
                : 'bg-indigo-50 text-indigo-700 border-indigo-150';
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white border border-slate-200/80 rounded-xl p-3 shadow-sm"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-wider ${badge}`}>
                      {item.sender}
                    </span>
                    <span className="text-slate-400 font-mono text-[9px]">0{Math.floor((i * 48) / 60)}:{(i * 48) % 60}</span>
                  </div>
                  <p className="text-slate-800 text-xs leading-relaxed">{item.text}</p>
                </motion.div>
              );
            })}
            {shownItems >= RECORD_TRANSCRIPT.length && (
              <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-700 bg-emerald-50 border-l-4 border-emerald-600 p-2.5 rounded-r-lg">
                <Sparkles className="w-3.5 h-3.5" />
                Clinical Terms Detected — confirm the generated note against the conversation before saving.
              </div>
            )}
          </div>

          {/* Capture board */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="shrink-0 bg-white border border-slate-200 rounded-2xl p-3.5 shadow-lg mt-2"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="flex items-center gap-1.5 text-primary text-[10px] font-bold uppercase tracking-wider">
                <Mic className="w-3.5 h-3.5" /> Active Session Capture
              </span>
              <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-250 font-semibold text-[9px]">
                Secure &amp; Confidential
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mt-3">
              <div className="flex flex-col gap-2">
                <span className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wide">Live Microphone</span>
                <div className="flex items-center gap-2.5">
                  <div className={`relative w-10 h-10 rounded-xl flex items-center justify-center border transition-all ${
                    pulsePhase ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200 text-slate-500'
                  }`}>
                    {pulsePhase ? (
                      <>
                        <Mic className="w-4.5 h-4.5 text-red-600 animate-pulse" />
                        <span className="absolute -top-1 -right-1 flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                        </span>
                      </>
                    ) : (
                      <MicOff className="w-4.5 h-4.5" />
                    )}
                  </div>
                  <div className="flex-1 flex flex-col gap-0.5">
                    <span className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wide">Status</span>
                    <span className={`text-[10px] font-semibold flex items-center gap-1.5 ${pulsePhase ? 'text-red-700' : 'text-slate-500'}`}>
                      {pulsePhase ? (
                        <>
                          <span className="w-1.5 h-1.5 bg-red-600 rounded-full animate-ping" /> Capturing live conversation...
                        </>
                      ) : (
                        <>
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" /> Microphone on standby
                        </>
                      )}
                    </span>
                  </div>
                </div>
                {/* Waveform */}
                <div className="bg-slate-100 rounded-lg overflow-hidden border border-slate-200 h-8 relative flex items-center justify-center">
                  <div className="flex items-center gap-[3px] w-full px-3">
                    {Array.from({ length: 28 }).map((_, i) => {
                      const active = pulsePhase;
                      const h = active ? 6 + Math.abs(Math.sin(progress * 40 + i * 1.7)) * 20 : 2;
                      return (
                        <div
                          key={i}
                          className={`w-[3px] rounded-full transition-all duration-150 ${active ? 'bg-blue-600' : 'bg-slate-300'}`}
                          style={{ height: h }}
                        />
                      );
                    })}
                  </div>
                  <span className="absolute left-1.5 top-1 px-1 py-0.5 rounded text-[7px] font-extrabold tracking-wider uppercase bg-blue-600 text-white">
                    Filtered Audio Preview
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2 border-t md:border-t-0 md:border-l border-slate-150 pt-2.5 md:pt-0 md:pl-3.5">
                <span className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wide">Simulation Presets</span>
                <Spotlight show={focusOptions && pulsePhase}>
                  <div className="w-full px-2.5 py-2 bg-indigo-50 border border-indigo-100 rounded-lg flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Sparkles className="w-3 h-3 text-primary shrink-0" />
                      <span className="text-[10px] font-bold text-primary truncate">
                        Say: "Patient: Wait, tooth 16 feels tender..."
                      </span>
                    </div>
                    <span className="bg-white border border-indigo-200 px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase text-indigo-700 shrink-0">
                      Add Preset
                    </span>
                  </div>
                </Spotlight>
                <div className="flex flex-col gap-1.5 pt-1.5 border-t border-slate-150">
                  <span className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wide">
                    Or Load a Sample Audio Transcript
                  </span>
                  <div className="flex gap-1.5">
                    <div className="flex-1 h-7 px-2 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-[10px] font-semibold text-slate-600">
                      <span>Comprehensive Exam — Priya Sharma</span>
                      <ChevronDown className="w-3 h-3 text-slate-400" />
                    </div>
                    <div className="shrink-0 px-2.5 h-7 bg-indigo-50 border border-indigo-150 text-primary font-bold text-[9px] uppercase tracking-wide rounded-lg flex items-center">
                      Load Sample
                    </div>
                  </div>
                  <p className="text-[8px] text-slate-400 leading-snug">
                    Fills the session with a realistic consultation for that treatment type — the note is drafted against
                    the template chosen at intake.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function ProcessingScene({ progress }: SceneProps) {
  const stages = [
    'Transcribed live voice feed...',
    'Running AI clinical extractor model (secure)...',
    'Synthesizing clinical findings & tooth map...',
    'Extracting ADA billing item codes...',
    'Drafting a friendly patient-narrative care letter...',
    'Notes complete! Opening the review screen...',
  ];
  const active = Math.min(stages.length - 1, Math.floor(progress * stages.length));
  const done = active;

  return (
    <div className="h-full w-full bg-[#F8F7F5] flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 bg-white/40 backdrop-blur-[2px]" />
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative bg-white rounded-3xl shadow-2xl border border-slate-200/60 p-7 w-full max-w-md mx-5"
      >
        <div className="flex flex-col items-center">
          <div className="relative w-16 h-16 mb-4">
            <div className="absolute inset-0 rounded-full border-4 border-indigo-100" />
            <div className="absolute inset-0 rounded-full border-4 border-t-primary animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-primary" />
            </div>
          </div>
          <h3 className="text-lg font-extrabold text-slate-800">Generating Clinical Note</h3>
          <p className="text-slate-400 text-xs mt-0.5">Priya Sharma · Comprehensive Examination</p>
          <div className="w-full mt-5 space-y-2.5">
            {stages.map((s, i) => (
              <div key={s} className={`flex items-center gap-2.5 text-xs transition-colors ${i <= done ? 'text-slate-700' : 'text-slate-300'}`}>
                {i < done ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : i === done ? (
                  <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border-2 border-slate-200 shrink-0" />
                )}
                <span className={i === done ? 'font-semibold' : ''}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function SummaryScene({ progress }: SceneProps) {
  const shown = useStagger(progress, SUMMARY_SECTIONS.length);
  const showLetter = progress > 0.45;
  const showAda = progress > 0.62;

  return (
    <div className="h-full w-full bg-[#F8F7F5] flex flex-col overflow-hidden">
      <AppBar
        right={
          <>
            <div className="hidden md:flex flex-col items-end">
              <span className="text-xs font-semibold text-slate-800">Dr. Emily Carter</span>
              <span className="text-[8px] text-slate-400 font-bold uppercase tracking-widest">Comprehensive Examination</span>
            </div>
            <User className="w-5 h-5 text-slate-400" />
          </>
        }
      />
      <div className="flex-1 overflow-hidden px-5 pt-3 pb-2">
        <div className="max-w-3xl mx-auto h-full grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="md:col-span-3 flex flex-col overflow-hidden">
            {/* Patient banner */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex items-center justify-between mb-2.5"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-primary-fixed text-on-primary-fixed flex items-center justify-center font-bold text-sm">PS</div>
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-slate-800">Priya Sharma</span>
                  <span className="text-[10px] text-slate-400">DOB 14/03/1989 · Comprehensive Examination</span>
                </div>
              </div>
              <Chip tone="indigo">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" /> In Review
              </Chip>
            </motion.div>

            <div className="flex-1 overflow-hidden space-y-2 pr-1">
              {SUMMARY_SECTIONS.slice(0, shown).map((s, i) => (
                <motion.div
                  key={s.label}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white border border-slate-100 rounded-xl p-2.5 shadow-sm"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`w-4 h-4 rounded-md font-mono font-bold text-[8px] flex items-center justify-center ${
                      i % 2 ? 'bg-indigo-100 text-indigo-800' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {i + 1}
                    </span>
                    <span className="font-bold text-[9px] uppercase tracking-wider text-slate-500">{s.label}</span>
                  </div>
                  <p className="text-slate-700 text-[11px] leading-relaxed">{s.value}</p>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="md:col-span-2 flex flex-col gap-2.5 overflow-hidden">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: showLetter ? 1 : 0, y: showLetter ? 0 : 8 }}
              className="bg-white border border-slate-100 rounded-xl p-3 shadow-sm"
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <FileText className="w-3.5 h-3.5 text-primary" />
                <span className="font-bold text-[9px] uppercase tracking-wider text-slate-500">Patient Care Letter</span>
                <span className="ml-auto px-1.5 py-0.5 bg-slate-100 rounded text-[8px] font-bold text-slate-500">Copy</span>
              </div>
              <p className="text-slate-600 text-[10px] leading-relaxed line-clamp-4">
                Hi Priya, thanks for visiting us today. Your check-up looked great overall — we found some gum
                inflammation that a professional clean will sort out, and one very early cavity we will simply keep an
                eye on. See you in six months!
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: showAda ? 1 : 0, y: showAda ? 0 : 8 }}
              className="bg-white border border-slate-100 rounded-xl p-3 shadow-sm"
            >
              <div className="flex items-center gap-1.5 mb-2">
                <ClipboardList className="w-3.5 h-3.5 text-primary" />
                <span className="font-bold text-[9px] uppercase tracking-wider text-slate-500">ADA Billing Item Codes</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { code: '011', desc: 'Comprehensive examination' },
                  { code: '026', desc: 'Two bitewing radiographs' },
                  { code: '114', desc: 'Prophylaxis — full mouth' },
                ].map((a) => (
                  <div key={a.code} className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1">
                    <span className="font-mono font-extrabold text-[10px] text-primary">[{a.code}]</span>
                    <span className="text-[9px] text-slate-600">{a.desc}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: progress > 0.72 ? 1 : 0 }}
              className="mt-auto flex gap-2"
            >
              <div className="flex-1 h-9 rounded-lg border border-slate-200 bg-white text-slate-600 text-[10px] font-bold flex items-center justify-center gap-1.5">
                <Save className="w-3 h-3" /> Save to record
              </div>
              <div className="flex-1 h-9 rounded-lg border border-slate-200 bg-white text-slate-600 text-[10px] font-bold flex items-center justify-center gap-1.5">
                <ClipboardList className="w-3 h-3" /> Copy to PMS
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FallbackScene({ progress }: SceneProps) {
  const showBanner = true;
  const draftShown = progress > 0.55;

  return (
    <div className="h-full w-full bg-[#F8F7F5] flex flex-col overflow-hidden">
      <AppBar
        title="Priya Sharma"
        subtitle="Comprehensive Examination"
        right={<Avatar initials="PS" />}
      />
      <div className="flex-1 overflow-hidden px-5 pt-4">
        <div className="max-w-lg mx-auto flex flex-col gap-3">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-50 border border-red-200 rounded-xl p-3.5 shadow-sm"
          >
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-[10px] uppercase tracking-wider text-red-700">
                  AI quota reached — hosted AI unavailable
                </span>
                <p className="text-red-700 text-[11px] mt-1 leading-relaxed">
                  No clinical record was created and your transcript is preserved. Choose how to continue below.
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 mt-3">
              <div className="flex-1 h-8 rounded-lg bg-white border border-red-200 text-red-700 font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5">
                <RefreshCw className="w-3 h-3" /> Retry hosted AI
              </div>
              <Spotlight show={draftShown}>
                <div className="flex-1 h-8 rounded-lg bg-red-700 text-white font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5">
                  <WifiOff className="w-3 h-3" /> Draft offline now
                </div>
              </Spotlight>
              <div className="flex-1 h-8 rounded-lg bg-white border border-red-200 text-slate-700 font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5">
                <Bot className="w-3 h-3" /> On-device model
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: draftShown ? 1 : 0, y: draftShown ? 0 : 12 }}
            className="bg-white border border-slate-200 rounded-2xl p-4 shadow-md"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span className="text-sm font-bold text-slate-800">Offline draft complete</span>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[9px] font-extrabold uppercase tracking-wider border border-amber-200">
                Review required
              </span>
            </div>
            <p className="text-slate-500 text-[11px] leading-relaxed">
              Built securely on this device from the transcript only — nothing was invented, and every section was
              filled strictly from what was said. Sections without supporting speech stay empty for you to complete.
            </p>
            <div className="flex items-center gap-2 mt-3 text-[10px] text-slate-400 font-semibold">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Offline draft · on-device · flagged for clinician review before saving
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function SwitcherScene({ progress }: SceneProps) {
  const open = progress > 0.25;

  return (
    <div className="h-full w-full bg-[#F8F7F5] flex flex-col">
      <AppBar
        right={
          <div className="flex flex-col items-end">
            <span className="text-[11px] font-bold text-slate-800">Dr. Sarah Chen</span>
            <span className="text-[8px] text-red-600 font-extrabold uppercase tracking-wider">Logout</span>
          </div>
        }
      />
      <div className="flex-1 overflow-hidden px-5 pt-4">
        <div className="max-w-2xl mx-auto relative">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-bold text-slate-800">History Hub</h2>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Owner</span>
          </div>

          {/* Clinic switcher trigger */}
          <div className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-slate-100 border border-slate-200 mt-3">
            <Building2 className="w-3.5 h-3.5 text-primary" />
            <span className="text-[11px] font-bold text-slate-700">Bright Smile Dental</span>
            <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          </div>

          {open && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute left-0 top-full mt-2 z-20 w-80 bg-white rounded-2xl border border-slate-200 shadow-xl p-2"
            >
              <div className="px-3 pt-2 pb-1 text-[9px] font-extrabold uppercase tracking-[0.15em] text-slate-400">
                Your clinics
              </div>
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-indigo-50 text-primary">
                <div className="w-7 h-7 rounded-lg bg-primary text-white flex items-center justify-center shrink-0">
                  <Building2 className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-bold">Bright Smile Dental</span>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Owner</span>
                </div>
                <Check className="w-4 h-4 shrink-0" />
              </div>
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-slate-700">
                <div className="w-7 h-7 rounded-lg bg-indigo-50 text-primary flex items-center justify-center shrink-0">
                  <Building2 className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-bold truncate">Dr. Emily Carter — Solo Practice</span>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Dentist</span>
                </div>
              </div>
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl opacity-70">
                <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                  <Building2 className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-bold text-slate-600 truncate">Harbourview Dental</span>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600">
                    Awaiting owner approval
                  </span>
                </div>
              </div>
              <div className="border-t border-slate-100 my-1.5" />
              <Spotlight show={progress > 0.6}>
                <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-slate-600">
                  <KeyRound className="w-4 h-4 text-slate-400" />
                  <span className="text-xs font-bold">Join a clinic with a code</span>
                </div>
              </Spotlight>
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-slate-600">
                <UserPlus className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-bold">Manage clinic · invite code</span>
              </div>
            </motion.div>
          )}

          <div className="mt-5 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-primary-light/70 border border-indigo-100 text-primary text-[11px] font-semibold">
            <Building2 className="w-3.5 h-3.5 shrink-0" />
            <span>
              Owner view — showing notes recorded by every dentist in <b>Bright Smile Dental</b>.
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {OWNER_CONSULTATIONS.slice(0, 2).map((c) => (
              <div key={c.initials} className="bg-white border border-slate-100 rounded-2xl p-3 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shadow-sm ${c.tone}`}>
                    {c.initials}
                  </div>
                  <div className="flex flex-col">
                    <span className="font-bold text-slate-800 text-sm">{c.name}</span>
                    <span className="text-slate-500 text-[11px]">{c.proc}</span>
                    <span className="text-[9px] font-semibold text-slate-400">Recorded by {c.by}</span>
                  </div>
                </div>
                <Chip tone={c.status === 'Completed' ? 'emerald' : 'indigo'}>
                  <span className={`w-1.5 h-1.5 rounded-full ${c.status === 'Completed' ? 'bg-emerald-600' : 'bg-indigo-600'}`} />
                  {c.status}
                </Chip>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ClinicManageScene({ scene, progress }: SceneProps) {
  const focusApprovals = scene.props?.focus === 'approvals';
  const members = [
    { initials: 'SC', name: 'Dr. Sarah Chen', role: 'Owner', status: 'active', tone: 'bg-primary text-white' },
    { initials: 'EC', name: 'Dr. Emily Carter', role: 'Dentist', status: 'active', tone: 'bg-indigo-50 text-primary' },
    { initials: 'AP', name: 'Dr. Alex Patel', role: 'Dentist', status: 'active', tone: 'bg-indigo-50 text-primary' },
    { initials: 'LR', name: 'Dr. Liam Rodriguez', role: 'Dentist', status: 'pending', tone: 'bg-amber-100 text-amber-700' },
  ];
  const approved = focusApprovals && progress > 0.65;
  const highlighted = members.map((m) =>
    m.status === 'pending'
      ? approved
        ? { ...m, status: 'active' as const }
        : m
      : m
  );
  const pending = highlighted.filter((m) => m.status === 'pending');
  const active = highlighted.filter((m) => m.status === 'active');

  return (
    <div className="h-full w-full bg-slate-900/60 backdrop-blur-sm flex items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-2xl w-full max-w-md max-h-full overflow-y-auto shadow-2xl border border-slate-100 p-4"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-primary flex items-center justify-center border border-indigo-100">
              <Building2 className="w-4.5 h-4.5" />
            </div>
            <div className="flex flex-col">
              <h3 className="text-sm font-extrabold text-slate-800 leading-tight">Bright Smile Dental</h3>
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                Clinic management · Owner
              </span>
            </div>
          </div>
        </div>

        <div className="py-3.5 flex flex-col gap-4">
          {/* Invite code card */}
          <Spotlight show={!focusApprovals || progress < 0.3}>
            <section className="rounded-xl border border-slate-200 bg-[#faf9f7] p-3.5">
              <span className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-slate-400">
                Invite colleagues with this code
              </span>
              <div className="flex items-center justify-between gap-3 mt-1.5">
                <span className="font-mono font-extrabold text-xl tracking-[0.2em] text-primary">K7T2XM</span>
                <div className="flex gap-1.5">
                  <div className="h-8 px-2.5 rounded-lg bg-primary text-white text-[10px] font-bold flex items-center gap-1">
                    <Copy className="w-3 h-3" /> Copy
                  </div>
                  <div className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-[10px] font-bold flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" /> New code
                  </div>
                </div>
              </div>
              <p className="text-[9px] text-slate-400 mt-2 leading-relaxed">
                Share with associates, locums, or colleagues. New members land as <b>pending</b> and see nothing until
                you approve them.
              </p>
            </section>
          </Spotlight>

          {/* Rename */}
          <section className="flex items-center justify-between">
            <span className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-slate-400">Clinic name</span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-700">Bright Smile Dental</span>
              <Pencil className="w-3 h-3 text-slate-400" />
            </div>
          </section>

          {/* Members */}
          <section className="flex flex-col gap-2.5">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-primary" />
              <span className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-slate-400">
                Members ({highlighted.length})
              </span>
            </div>

            {pending.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600">
                  Pending approval ({pending.length})
                </span>
                {pending.map((m) => (
                  <motion.div
                    key={m.initials}
                    layout
                    className="flex items-center gap-2.5 p-2.5 rounded-xl border border-amber-200 bg-amber-50/60"
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-[11px] shrink-0 ${m.tone}`}>
                      {m.initials}
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-[11px] font-bold text-slate-800 truncate">{m.name}</span>
                      <span className="text-[9px] text-slate-500">Requested to join — approves to a dentist member</span>
                    </div>
                    <Spotlight show={focusApprovals && progress > 0.35 && progress < 0.65}>
                      <div className="flex gap-1.5 shrink-0">
                        <div className="h-7 px-2 rounded-lg bg-emerald-600 text-white text-[9px] font-bold flex items-center gap-1">
                          <Check className="w-3 h-3" /> Approve
                        </div>
                        <div className="h-7 px-2 rounded-lg border border-red-200 bg-white text-red-600 text-[9px] font-bold flex items-center gap-1">
                          <XCircle className="w-3 h-3" /> Decline
                        </div>
                      </div>
                    </Spotlight>
                  </motion.div>
                ))}
                {approved && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-2"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Approved — Dr. Rodriguez now sees the clinic's notes.
                  </motion.div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Active ({active.length})</span>
              {active.map((m) => (
                <div key={m.initials} className="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-100 bg-white">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-[11px] shrink-0 ${m.tone}`}>
                    {m.initials}
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[11px] font-bold text-slate-800 truncate">{m.name}</span>
                    <span className="text-[9px] text-slate-500">{m.role === 'owner' ? 'Clinic owner' : 'Dentist member'}</span>
                  </div>
                  {m.role === 'owner' && (
                    <span className="px-1.5 py-0.5 rounded-full bg-primary-light text-primary text-[8px] font-extrabold uppercase tracking-wider">
                      Owner
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </motion.div>
    </div>
  );
}

function UsageScene({ progress }: SceneProps) {
  const pct = Math.min(1, 0.35 + progress * 0.3);

  return (
    <div className="h-full w-full bg-[#F8F7F5] flex flex-col">
      <AppBar
        right={
          <>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-200 bg-white shadow-sm">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">7/20 AI notes today</span>
            </div>
            <Avatar initials="SC" />
          </>
        }
      />
      <div className="flex-1 overflow-hidden px-5 pt-4">
        <div className="max-w-xl mx-auto flex flex-col gap-3">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white border border-slate-200 rounded-2xl p-4 shadow-md"
          >
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="text-sm font-bold text-slate-800">Hosted AI usage — today</span>
              </div>
              <Chip tone="indigo">7 of 20</Chip>
            </div>
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-primary rounded-full"
                initial={{ width: '0%' }}
                animate={{ width: `${pct * 100}%` }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
              />
            </div>
            <div className="flex justify-between text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-1.5">
              <span>Resets daily</span>
              <span>Per clinic</span>
            </div>
            <p className="text-slate-500 text-[11px] mt-2.5 leading-relaxed">
              The dentist sees the same meter live on the recording screen — so there are no surprise quota
              dead-ends mid-consultation. When the allowance is used, offline drafting stays available.
            </p>
          </motion.div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: <WifiOff className="w-4 h-4" />, title: 'Offline draft', desc: 'Rule-based note from the transcript — no network, no GPU.' },
              { icon: <Bot className="w-4 h-4" />, title: 'On-device model', desc: 'Beta WebLLM on WebGPU browsers — notes never leave the device.' },
              { icon: <ShieldCheck className="w-4 h-4" />, title: 'Review flags', desc: 'Fallback notes are always marked for clinician review.' },
              { icon: <RefreshCw className="w-4 h-4" />, title: 'Auto-retry', desc: 'Durable jobs retry with backoff — a rate-limit never loses work.' },
            ].map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: progress > 0.3 + i * 0.12 ? 1 : 0, y: progress > 0.3 + i * 0.12 ? 0 : 10 }}
                className="bg-white border border-slate-100 rounded-xl p-3 shadow-sm"
              >
                <div className="w-8 h-8 rounded-lg bg-primary-light text-primary flex items-center justify-center mb-2">
                  {f.icon}
                </div>
                <span className="text-xs font-bold text-slate-800">{f.title}</span>
                <p className="text-slate-400 text-[10px] mt-0.5 leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RecapScene({ progress }: SceneProps) {
  const items = [
    { icon: <Mic className="w-4 h-4" />, text: 'Ambient charting — no dictation, no forms' },
    { icon: <FileText className="w-4 h-4" />, text: '8 treatment templates with AI extraction' },
    { icon: <ShieldCheck className="w-4 h-4" />, text: 'Resilient fallbacks — never lose a note' },
    { icon: <Building2 className="w-4 h-4" />, text: 'Owner tools: clinics, members, AI metering' },
  ];
  const shown = useStagger(progress, items.length);

  return (
    <div className="h-full w-full bg-[#F8F7F5] flex items-center justify-center relative overflow-hidden px-6">
      <div className="absolute -bottom-24 -right-16 w-96 h-96 rounded-full bg-emerald-50/40 blur-[110px]" />
      <div className="absolute -top-24 -left-16 w-96 h-96 rounded-full bg-indigo-50/60 blur-[100px]" />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-lg bg-white rounded-3xl p-6 shadow-2xl border border-slate-200/60"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-2xl bg-primary text-white flex items-center justify-center shadow-lg shadow-primary/25">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xl font-extrabold text-slate-800">DentAI, in summary</h3>
            <p className="text-slate-400 text-[11px]">Ambient scribe · practice-wide control · privacy by design</p>
          </div>
        </div>
        <div className="space-y-2.5">
          {items.map((item, i) => (
            <motion.div
              key={item.text}
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: shown > i ? 1 : 0, x: shown > i ? 0 : 14 }}
              className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100"
            >
              <div className="w-8 h-8 rounded-lg bg-primary-light text-primary flex items-center justify-center shrink-0">
                {item.icon}
              </div>
              <span className="text-slate-700 text-xs font-semibold">{item.text}</span>
            </motion.div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="flex items-center gap-2 justify-center">
            <PlayCircle className="w-4 h-4 text-primary" />
            <span className="text-slate-500 text-xs font-semibold">
              Ready to see it live? Register your first profile and start a consultation.
            </span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chairside ROI & Economic Impact Scene
// ---------------------------------------------------------------------------

function RoiScene({ progress }: SceneProps) {
  const showMetrics = progress > 0.15;
  const showComparison = progress > 0.45;

  return (
    <div className="h-full flex flex-col bg-slate-50">
      <AppBar
        title="Practice ROI & Economics"
        subtitle="Chairside Time Recovery · Clinic Capacity"
        right={<Chip tone="emerald"><TrendingUp className="w-3 h-3 text-emerald-600" /> High ROI</Chip>}
      />

      <div className="flex-1 p-4 md:p-6 flex flex-col gap-4 max-w-4xl mx-auto w-full overflow-hidden justify-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-1"
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">
            Measurable Clinical ROI
          </span>
          <h2 className="text-xl md:text-2xl font-bold text-slate-800">
            Eliminate 100% of After-Hours Charting
          </h2>
          <p className="text-xs text-slate-500 max-w-lg mx-auto">
            Real chairside time saved per dentist transforms practice capacity and work-life balance.
          </p>
        </motion.div>

        {/* 3 Metric Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: showMetrics ? 1 : 0, y: showMetrics ? 0 : 14 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm flex flex-col justify-between"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Clock className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">Per Visit</span>
            </div>
            <div>
              <div className="text-2xl font-black text-slate-800 tracking-tight">15–20 min</div>
              <div className="text-xs font-semibold text-slate-600 mt-0.5">Saved per complex procedure</div>
              <div className="text-[11px] text-slate-400 mt-1">Instant notes for crowns, endo & implants</div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: showMetrics ? 1 : 0, y: showMetrics ? 0 : 14 }}
            transition={{ delay: 0.2 }}
            className="bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-2xl p-4 shadow-md flex flex-col justify-between"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="w-9 h-9 rounded-xl bg-white/10 text-white flex items-center justify-center">
                <Zap className="w-5 h-5 text-amber-300" />
              </div>
              <span className="text-[10px] font-bold text-indigo-100 bg-white/15 px-2 py-0.5 rounded-full">Daily Impact</span>
            </div>
            <div>
              <div className="text-2xl font-black text-white tracking-tight">1.5–2 Hours</div>
              <div className="text-xs font-medium text-indigo-100 mt-0.5">Recovered every single day</div>
              <div className="text-[11px] text-indigo-200 mt-1">Leave clinic at 5:00 PM with zero backlog</div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: showMetrics ? 1 : 0, y: showMetrics ? 0 : 14 }}
            transition={{ delay: 0.3 }}
            className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm flex flex-col justify-between"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <DollarSign className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">Practice Revenue</span>
            </div>
            <div>
              <div className="text-2xl font-black text-slate-800 tracking-tight">+$15k–$30k</div>
              <div className="text-xs font-semibold text-slate-600 mt-0.5">Monthly chair capacity</div>
              <div className="text-[11px] text-slate-400 mt-1">Room to treat +1 patient/day per chair</div>
            </div>
          </motion.div>
        </div>

        {/* Side-by-Side Comparison */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: showComparison ? 1 : 0, y: showComparison ? 0 : 12 }}
          className="grid grid-cols-1 md:grid-cols-2 gap-3"
        >
          <div className="bg-rose-50/60 border border-rose-100 rounded-xl p-3.5 flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-rose-700 text-xs font-bold uppercase tracking-wider">
              <XCircle className="w-4 h-4" /> Traditional Manual Charting
            </div>
            <ul className="text-[11px] text-slate-600 space-y-1">
              <li className="flex items-start gap-1.5">
                <span className="text-rose-500 font-bold">•</span>
                <span>Dentist types while patient waits or stays 1 hr late</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-rose-500 font-bold">•</span>
                <span>Missed ADA billing codes cost practices thousands</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-rose-500 font-bold">•</span>
                <span>Inconsistent formatting between associates and locums</span>
              </li>
            </ul>
          </div>

          <div className="bg-emerald-50/60 border border-emerald-100 rounded-xl p-3.5 flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-emerald-700 text-xs font-bold uppercase tracking-wider">
              <CheckCircle2 className="w-4 h-4" /> With DentAI Ambient Scribing
            </div>
            <ul className="text-[11px] text-slate-700 space-y-1">
              <li className="flex items-start gap-1.5">
                <span className="text-emerald-600 font-bold">✓</span>
                <span>Natural dentist-patient talk converts to complete notes instantly</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-emerald-600 font-bold">✓</span>
                <span>100% compliant ADA item codes auto-extracted</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-emerald-600 font-bold">✓</span>
                <span>1-click smart copy directly into Dental4Windows, Best Practice & EXACT</span>
              </li>
            </ul>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1-Click Template & Colleague Sharing Scene (Growth Loop)
// ---------------------------------------------------------------------------

function ShareTemplateScene({ progress }: SceneProps) {
  const isCopied = progress > 0.4;
  const showPeer = progress > 0.65;

  return (
    <div className="h-full flex flex-col bg-slate-50">
      <AppBar
        title="Templates & Peer Network"
        subtitle="1-Click Share · Organic Growth Loop"
        right={<Chip tone="indigo"><Share2 className="w-3 h-3 text-indigo-600" /> Shareable</Chip>}
      />

      <div className="flex-1 p-4 md:p-6 flex flex-col gap-4 max-w-2xl mx-auto w-full overflow-hidden justify-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-1"
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">
            Organic Dentist-to-Dentist Referral
          </span>
          <h2 className="text-xl md:text-2xl font-bold text-slate-800">
            Share Your Note Standards with Colleagues
          </h2>
          <p className="text-xs text-slate-500">
            Pass clinical templates and clinic codes to locums and peer study clubs in one tap.
          </p>
        </motion.div>

        {/* Share Template Card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs">
                CP
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-800">Crown Prep & Margin Record</h4>
                <p className="text-[10px] text-slate-400">Dr. Sharma's High-Precision Template · 6 clinical sections</p>
              </div>
            </div>
            <Chip tone="indigo">Custom Standard</Chip>
          </div>

          <div className="flex items-center justify-between gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200/80">
            <div className="font-mono text-xs text-slate-600 truncate">
              dentai.app/t/crown-preparations-v2
            </div>
            <motion.button
              whileTap={{ scale: 0.95 }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors shrink-0 ${
                isCopied
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm'
              }`}
            >
              {isCopied ? (
                <>
                  <Check className="w-3.5 h-3.5" /> Copied Link!
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" /> Copy Share Link
                </>
              )}
            </motion.button>
          </div>
        </motion.div>

        {/* Peer Accepted Notification Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: showPeer ? 1 : 0, scale: showPeer ? 1 : 0.95 }}
          className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200/70 rounded-xl p-3.5 flex items-center gap-3 shadow-sm"
        >
          <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-emerald-900">Dr. David Nguyen (Associate / Locum)</span>
              <span className="text-[9px] font-bold bg-emerald-200/80 text-emerald-800 px-2 py-0.5 rounded-full">Imported</span>
            </div>
            <p className="text-[11px] text-emerald-700 mt-0.5">
              Accepted template and joined clinic with code <span className="font-mono font-bold">SMILE42</span>. Chairside ready.
            </p>
          </div>
        </motion.div>

        {/* Built-in Virality Callout */}
        <div className="text-center">
          <span className="text-[11px] text-slate-500 bg-white border border-slate-200 px-3 py-1 rounded-full shadow-2xs">
            ✨ Colleagues start free &rarr; Practices upgrade together for multi-chair management
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pricing & Plan Monetization Scene
// ---------------------------------------------------------------------------

function PricingScene({ progress }: SceneProps) {
  const pulsePaid = progress > 0.35;

  return (
    <div className="h-full flex flex-col bg-slate-50">
      <AppBar
        title="Practice Plans & Monetization"
        subtitle="Solo Free · Practice Owner Subscription"
        right={<Chip tone="indigo"><Award className="w-3 h-3 text-indigo-600" /> Transparent</Chip>}
      />

      <div className="flex-1 p-4 md:p-6 flex flex-col gap-4 max-w-3xl mx-auto w-full overflow-hidden justify-center">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-1"
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">
            Simple, Honest Pricing
          </span>
          <h2 className="text-xl md:text-2xl font-bold text-slate-800">
            Free for Clinicians · High-Leverage for Practice Owners
          </h2>
          <p className="text-xs text-slate-500">
            Individual dentists adopt freely; owners unlock centralized governance, multi-chair compliance and audit trails.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Solo Tier */}
          <motion.div
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Solo Dentist</span>
                <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full">For Clinicians</span>
              </div>
              <div className="text-2xl font-black text-slate-800">$0 <span className="text-xs font-normal text-slate-400">/ forever</span></div>
              <p className="text-xs text-slate-500 mt-1">Full ambient scribing for solo dentists, associates, and locums.</p>

              <div className="mt-4 pt-3 border-t border-slate-100 space-y-2 text-xs text-slate-600">
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Ambient audio recording & live transcription</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>All 8 ADA procedure templates included</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Resilient offline draft engine (zero dead-ends)</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Personal consultation history hub</span>
                </div>
              </div>
            </div>

            <div className="mt-5">
              <button className="w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors">
                Start Free Today
              </button>
            </div>
          </motion.div>

          {/* Practice Tier */}
          <motion.div
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            className={`bg-white rounded-2xl p-5 border-2 shadow-md flex flex-col justify-between relative transition-all ${
              pulsePaid ? 'border-indigo-600 ring-2 ring-indigo-600/20' : 'border-indigo-400'
            }`}
          >
            <div className="absolute -top-3 right-4 bg-indigo-600 text-white text-[10px] font-bold px-3 py-0.5 rounded-full shadow-sm uppercase tracking-wider">
              Practice Standard
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">Practice Owner</span>
                <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full">Multi-Chair</span>
              </div>
              <div className="text-2xl font-black text-slate-800">$99–$149 <span className="text-xs font-normal text-slate-400">/ month per clinic</span></div>
              <p className="text-[10px] text-indigo-600 font-semibold mt-0.5">$99/mo annual · $149 month-to-month</p>
              <p className="text-xs text-slate-500 mt-1">Practice-wide audit oversight, template lock, and multi-chair sync.</p>

              <div className="mt-4 pt-3 border-t border-slate-100 space-y-2 text-xs text-slate-700">
                <div className="flex items-center gap-2 font-medium">
                  <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <span>All Solo Clinician capabilities</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <span>Practice-wide notes view across all dentists</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <span>Clinic-wide standardized template management</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <span>Multi-clinic switcher & sayable invite codes</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <span>Immutable audit logging (APRA / Privacy Act)</span>
                </div>
              </div>
            </div>

            <div className="mt-5">
              <button className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm transition-colors">
                Upgrade Practice
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function PipelineScene({ progress }: SceneProps) {
  const showModal = progress > 0.45;
  const isBooked = progress > 0.65;
  const card1Val = Math.min(34800, Math.floor(progress * 4 * 34800));
  const card2Val = progress > 0.25 ? 18400 : 0;
  const roiVal = progress > 0.25 ? '123.5x' : '0x';

  return (
    <div className="h-full w-full bg-[#F8F7F5] flex flex-col relative overflow-hidden">
      <AppBar
        right={
          <div className="flex flex-col items-end">
            <span className="text-[11px] font-bold text-slate-800">Dr. Sarah Chen</span>
            <span className="text-[8px] text-emerald-600 font-extrabold uppercase tracking-wider">Owner Active</span>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto px-5 pt-3 pb-8">
        <div className="max-w-2xl mx-auto space-y-4">
          {/* Header & Tabs */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-black text-slate-800">History Hub</span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[9px] font-bold border border-emerald-200">
                Bright Smile Dental
              </span>
            </div>
            {/* Tab switchers mimicking real app */}
            <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl">
              <span className="px-3 py-1 rounded-lg text-[10px] font-bold text-slate-500">
                Clinical Records
              </span>
              <span className="px-3 py-1 rounded-lg text-[10px] font-bold bg-white text-primary shadow-sm flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-500" />
                <span>Revenue Engine & PMS Sync</span>
              </span>
            </div>
          </div>

          {/* Subheader with universal PMS bridge indicator */}
          <div className="flex items-center justify-between text-xs pt-0.5 px-0.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-700">Closed-Loop Recovery Pipeline</span>
              <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[8px] font-bold border border-indigo-200">
                Universal PMS Bridge
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[8px] font-semibold text-slate-500 bg-white px-2 py-1 rounded-lg border border-slate-200">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              <span>D4W · EXACT · Cliniko Verified</span>
            </div>
          </div>

          {/* 4 Executive Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white rounded-2xl p-3 border border-slate-200/80 shadow-sm"
            >
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-[10px] font-bold">Unscheduled</span>
                <Clock className="w-3.5 h-3.5 text-amber-500" />
              </div>
              <div className="text-lg font-black text-slate-800 mt-1">
                ${card1Val.toLocaleString()}
              </div>
              <span className="text-[8px] text-slate-400 font-medium">14 pending items</span>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-white rounded-2xl p-3 border border-slate-200/80 shadow-sm"
            >
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-[10px] font-bold">Booked Prod.</span>
                <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
              </div>
              <div className="text-lg font-black text-emerald-600 mt-1">
                ${card2Val.toLocaleString()}
              </div>
              <span className="text-[8px] text-emerald-600 font-semibold">9 verified in PMS</span>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-gradient-to-br from-indigo-950 to-slate-900 text-white rounded-2xl p-3 shadow-md relative overflow-hidden"
            >
              <div className="flex items-center justify-between text-indigo-300">
                <span className="text-[10px] font-bold">Practice ROI</span>
                <DollarSign className="w-3.5 h-3.5" />
              </div>
              <div className="text-lg font-black text-white mt-1">
                {roiVal}
              </div>
              <span className="text-[8px] text-indigo-200/80 font-medium">vs. $149/mo sub</span>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="bg-white rounded-2xl p-3 border border-slate-200/80 shadow-sm"
            >
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-[10px] font-bold">Total Lifetime</span>
                <ShieldCheck className="w-3.5 h-3.5 text-primary" />
              </div>
              <div className="text-lg font-black text-slate-800 mt-1">
                $51,600
              </div>
              <span className="text-[8px] text-slate-400 font-medium">Captured from notes</span>
            </motion.div>
          </div>

          {/* Featured Treatment Card: Priya Sharma */}
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.35 }}
            className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-sm space-y-2.5"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-primary/10 text-primary font-black text-xs flex items-center justify-center">
                  PS
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-800">Priya Sharma</span>
                    <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[9px] font-bold">
                      FDI Tooth 16
                    </span>
                    {isBooked ? (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[9px] font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />
                        <span>✓ D4W #8491 Verified</span>
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[9px] font-bold">
                        Unscheduled
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400 font-medium">
                    Dr. Sarah Chen · Comprehensive Exam (Aug 20)
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-black text-slate-800">$1,650</div>
                <div className="text-[9px] font-bold text-primary">ADA 611 Ceramic Crown</div>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-150 text-[10px] text-slate-600 leading-snug">
              <b>Clinical Reason:</b> Micro-crack across mesio-palatal cusp requiring cuspal protection. Risk of complete fracture into pulp if left unrestored.
            </div>

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-1 text-[9px] text-slate-500 font-medium">
                <Clock className="w-3 h-3 text-amber-500" />
                <span>Proposed 4 days ago · Follow-up Ready</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-xl bg-primary text-white text-[9px] font-bold flex items-center gap-1 shadow-sm">
                  <Sparkles className="w-3 h-3" />
                  <span>1-Click Estimate & Rebate</span>
                </span>
                <span
                  className={`px-2.5 py-1 rounded-xl text-[9px] font-bold ${
                    isBooked
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {isBooked ? 'Booked in D4W' : 'Mark as Booked'}
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Outreach Drawer Preview */}
      {showModal && (
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute inset-x-4 bottom-4 z-30 max-w-lg mx-auto bg-white rounded-3xl p-4 shadow-2xl border border-slate-300"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div className="flex items-center gap-1.5 text-primary text-[10px] font-black uppercase tracking-wider">
              <Sparkles className="w-3 h-3 text-amber-500" /> Patient Treatment Estimate & Rebate Info
            </div>
            <span className="text-[9px] text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
              Bupa · Medibank · HCF Quote Ready
            </span>
          </div>
          <div className="mt-2 p-2.5 rounded-xl bg-[#F8F7F5] border border-slate-200 text-[10px] text-slate-700 leading-relaxed font-sans">
            "Hi Priya, following up on your consultation with Dr. Sarah Chen. Dr. Chen recommended a protective porcelain ceramic crown (Item ADA 611) for tooth 16 to prevent structural cracking. Estimated investment is $1,650. Quote item 611 to your health fund for your rebate. Would next Tuesday morning suit you?"
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex-1 py-1.5 rounded-xl bg-primary text-white text-center text-[10px] font-bold shadow-sm flex items-center justify-center gap-1">
              <Copy className="w-3 h-3" />
              <span>Copy SMS / WhatsApp</span>
            </div>
            <div className="py-1.5 px-3 rounded-xl bg-slate-800 text-white text-[10px] font-bold shadow-sm flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-400" />
              <span>Sync to D4W</span>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export default function SceneStage({ scene, progress }: SceneProps) {
  const render = (() => {
    switch (scene.kind) {
      case 'title':
        return <TitleScene scene={scene} progress={progress} />;
      case 'login':
        return <LoginScene scene={scene} progress={progress} />;
      case 'history':
      case 'owner-history':
        return <HistoryScene scene={scene} progress={progress} />;
      case 'pipeline':
        return <PipelineScene scene={scene} progress={progress} />;
      case 'intake':
        return <IntakeScene scene={scene} progress={progress} />;
      case 'record':
        return <RecordScene scene={scene} progress={progress} />;
      case 'processing':
        return <ProcessingScene scene={scene} progress={progress} />;
      case 'summary':
        return <SummaryScene scene={scene} progress={progress} />;
      case 'roi':
        return <RoiScene scene={scene} progress={progress} />;
      case 'share-template':
        return <ShareTemplateScene scene={scene} progress={progress} />;
      case 'fallback':
        return <FallbackScene scene={scene} progress={progress} />;
      case 'switcher':
        return <SwitcherScene scene={scene} progress={progress} />;
      case 'clinic-manage':
        return <ClinicManageScene scene={scene} progress={progress} />;
      case 'usage':
        return <UsageScene scene={scene} progress={progress} />;
      case 'pricing':
        return <PricingScene scene={scene} progress={progress} />;
      case 'recap':
        return <RecapScene scene={scene} progress={progress} />;
      default:
        return null;
    }
  })();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={scene.id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="h-full w-full"
      >
        {render}
      </motion.div>
    </AnimatePresence>
  );
}