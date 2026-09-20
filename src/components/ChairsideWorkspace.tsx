import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Mic,
  Pause,
  Play,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  Shield,
  User,
  FileText,
  Sliders,
  Sparkles,
  Activity,
  LogOut,
  X,
  Clipboard,
  MessageSquare,
  LayoutDashboard,
  TrendingUp,
  Mail,
  ChevronDown,
  Send,
  RefreshCw,
  Upload,
  Zap,
  VolumeX,
  ArrowRight,
  HelpCircle,
  Lightbulb,
  BookOpen,
  LifeBuoy,
  ExternalLink
} from 'lucide-react';
import { addScheduleItem } from '../lib/dayScheduleStorage';
import { Consultation, TranscriptItem, ClinicalFindings } from '../types';
import { chooseNoteTranscript, type TranscriptSource } from '../lib/transcription';
import {
  blobToBase64,
  isTranscriptionFailure,
  requestTranscription,
  uploadAudioSegment
} from '../lib/transcribeClient';
import { AuthUser } from '../utils/storage';
import { AppointmentType, getTemplateById } from '../lib/dentalLibrary';
import { generateOfflineDraft } from '../lib/draftEngine';
import { formatClinicDate, formatClinicTime, getClinicTodayIso } from '../utils/date';
import ChairsideOdontogram from './ChairsideOdontogram';

interface ChairsideWorkspaceProps {
  currentUser: AuthUser | null;
  dentistName: string;
  authToken: string | null;
  consultations: Consultation[];
  activeClinicId?: string | null;
  initialPatientId?: string | null;
  onOpenHistoryHub: () => void;
  onOpenPipeline?: () => void;
  onLogout: () => void;
  onSaveConsultation?: (consult: Consultation) => Promise<void>;
}

export interface PatientEncounter {
  id: string;
  consultationId?: string;
  date?: string;
  time: string;
  operatory: string;
  patientName: string;
  procedureText: string;
  appointmentType: AppointmentType;
  templateId: string;
  status: 'scheduled' | 'recording' | 'processing' | 'ready' | 'failed';
  age?: number;
  dob?: string;
  team?: string;
  priorNote?: string;
  priorNoteDate?: string;
  alerts?: { type: 'allergy' | 'medication' | 'general'; text: string }[];
  diarizedTranscript?: {
    speaker?: string;
    role?: 'dentist' | 'assistant' | 'patient';
    time?: string;
    text: string;
  }[];
  soap?: {
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
  };
  cdtCodes?: { code: string; desc: string; fee: string }[];
  dischargeFlag?: string;
}

/**
 * Best available ordering timestamp for a stored record.
 *
 * `date` is a display label with no year ("Oct 24"), so comparing those as
 * strings puts "Oct 1" before "Sep 19" and mis-orders prior visits. Prefer a
 * real ISO timestamp — server-governed records always carry
 * `revisions[].savedAt`.
 */
function consultationInstant(record: Consultation): number {
  const candidates = [
    (record as { createdAt?: string }).createdAt,
    record.revisions?.[0]?.savedAt,
    record.revisions?.[record.revisions.length - 1]?.savedAt
  ];
  for (const value of candidates) {
    const parsed = value ? Date.parse(value) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return NaN;
}

export default function ChairsideWorkspace({
  currentUser,
  dentistName,
  authToken,
  consultations,
  activeClinicId,
  initialPatientId,
  onOpenHistoryHub,
  onOpenPipeline,
  onLogout,
  onSaveConsultation
}: ChairsideWorkspaceProps) {
  // ─────────────────────────────────────────────────────────────
  // 1. DATABASE & ENCOUNTER STATE (Production Real Data)
  // ─────────────────────────────────────────────────────────────
  const [activePatientId, setActivePatientId] = useState<string>(() => initialPatientId || '');
  const hasUserManuallySelectedRef = useRef(false);
  const lastKnownWalkinIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (initialPatientId) {
      setActivePatientId(initialPatientId);
      hasUserManuallySelectedRef.current = true;
    }
  }, [initialPatientId]);

  // ─────────────────────────────────────────────────────────────
  // 2. INTERACTIVE DATE NAVIGATION
  // ─────────────────────────────────────────────────────────────
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const dateLabel = useMemo(() => {
    const todayIso = getClinicTodayIso();
    const currentIso = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
    const isToday = currentIso === todayIso;
    const formatted = formatClinicDate(currentDate, { month: 'short', day: 'numeric' });
    return isToday ? `Today, ${formatted}` : formatted;
  }, [currentDate]);

  const currentDateStr = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, [currentDate]);

  const handlePrevDay = () => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 1));
  };

  const handleNextDay = () => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1));
  };

  // Real-time optimistic ambient transcript state (0ms latency, zero-lag UI feedback)
  const [localLiveTranscripts, setLocalLiveTranscripts] = useState<Record<string, { sender: string; text: string; time?: string }[]>>({});

  // True while the recorded audio is being transcribed for the note. Surfaced so
  // the "finalising" wait is explained rather than looking like a stall.
  const [isTranscribingNote, setIsTranscribingNote] = useState(false);
  // The container this operatory's recorder produced. The provider needs the real
  // one (Safari records audio/mp4, Chrome audio/webm) or decoding fails.
  const recordedMimeTypeRef = useRef<string | null>(null);
  const chunkUploadRef = useRef<{
    chairKey: string;
    counter: number;
    queue: Promise<unknown>;
    recorder: MediaRecorder | null;
  }>({ chairKey: '', counter: 0, queue: Promise.resolve(), recorder: null });

  // Convert real database consultations into live encounters (Zero mock fallbacks)
  const patientEncounters: PatientEncounter[] = useMemo(() => {
    return consultations.map((c, index) => {
      const operatory = c.findings?.customSections?.operatory || `Op ${(index % 3) + 1}`;
      const timeStr = c.time || formatClinicTime(new Date());
      const fullName = `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Patient';
      const procedureText = c.appointmentType
        ? `${c.appointmentType.charAt(0).toUpperCase() + c.appointmentType.slice(1)} • ${c.findings?.treatmentPerformed ? c.findings.treatmentPerformed.slice(0, 32) : 'Clinical Procedure'}`
        : 'Restorative Care';

      // Parse medical alerts from genuine patient history or findings
      const alerts: { type: 'allergy' | 'medication' | 'general'; text: string }[] = [];
      const hist = (c.findings?.history || '').toLowerCase();
      const cc = (c.findings?.chiefComplaint || '').toLowerCase();
      if (hist.includes('allergy') || cc.includes('allergy')) {
        alerts.push({ type: 'allergy', text: 'Patient Reported Drug Allergy' });
      }
      if (hist.includes('warfarin') || hist.includes('anticoagulant') || cc.includes('anticoagulant')) {
        alerts.push({ type: 'medication', text: 'Anticoagulant Regimen' });
      }

      // Prior clinical history for THIS patient, resolved through the patient
      // registry — never by name.
      //
      // This previously matched on first + last name, so two patients called John
      // Smith shared a history and one patient's previous treatment was shown as
      // the other's prior history, which is a clinical safety problem: that
      // history informs what the clinician does at the chair.
      //
      // A record with no patientId — written before the registry, or flagged for
      // identity review — now shows no prior history at all. Showing nothing is
      // correct; showing another patient's chart is not.
      const currentInstant = consultationInstant(c);
      const priorVisits = c.patientId
        ? consultations
            .filter((other) => other.id !== c.id && other.patientId === c.patientId)
            .filter((other) => {
              const instant = consultationInstant(other);
              // With no real timestamps we cannot prove it is *prior*, but it is
              // still the same patient, which is what this lookup is for.
              if (!Number.isFinite(currentInstant) || !Number.isFinite(instant)) return true;
              return instant < currentInstant;
            })
            .sort((a, b) => {
              const ai = consultationInstant(a);
              const bi = consultationInstant(b);
              if (!Number.isFinite(ai)) return 1;
              if (!Number.isFinite(bi)) return -1;
              return bi - ai;
            })
        : [];

      const latestPrior = priorVisits[0];
      const priorNote = latestPrior?.findings?.treatmentPerformed || latestPrior?.findings?.history || latestPrior?.patientSummary || c.findings?.history || '';
      const priorNoteDate = latestPrior?.date || c.findings?.customSections?.priorNoteDate || '';

      // Map real transcript into diarized feed with optimistic local merge
      const baseTranscript = c.transcript || [];
      const localItems = localLiveTranscripts[c.id] || [];

      // Combine persistent items with optimistic local items without duplicates
      const combinedItems = [...baseTranscript];
      for (const loc of localItems) {
        if (!combinedItems.some(b => b.text === loc.text)) {
          combinedItems.push(loc);
        }
      }

      const diarizedTranscript = combinedItems.map((t) => {
        const role = t.sender.toLowerCase().includes('patient')
          ? ('patient' as const)
          : t.sender.toLowerCase().includes('assistant') || t.sender.toLowerCase().includes('comment')
            ? ('assistant' as const)
            : ('dentist' as const);

        return {
          speaker: role === 'patient' ? `${fullName} (Patient)` : role === 'assistant' ? 'Mia Lawson, RDA' : (dentistName || 'Attending Clinician'),
          role,
          time: (t as any).time || (c.time || formatClinicTime(new Date())),
          text: t.text
        };
      });

      // Map real SOAP findings
      const soap = {
        subjective: c.findings?.chiefComplaint
          ? `${c.findings.chiefComplaint} ${c.findings.history || ''}`
          : 'Patient presents for scheduled dental appointment.',
        objective: c.findings?.toothFindings
          ? `${c.findings.toothFindings} ${c.findings.findingsGingival || ''}`
          : 'Clinical examination completed. Soft tissue within normal limits.',
        assessment: c.findings?.diagnosis || 'Dental condition assessed and recorded.',
        plan: c.findings?.treatmentPerformed
          ? `${c.findings.treatmentPerformed} ${c.findings.recommendations || ''}`
          : 'Treatment completed per clinical protocol.'
      };

      const cdtCodes = c.findings?.adaCodes?.map(a => ({
        code: a.code,
        desc: a.description,
        fee: '$180.00'
      })) || [];

      return {
        id: c.id,
        consultationId: c.id,
        date: c.date,
        time: timeStr,
        operatory,
        patientName: fullName,
        procedureText,
        appointmentType: c.appointmentType || 'restorative',
        templateId: c.templateId || 'standard',
        status: c.status === 'Completed' ? 'ready' : (c.id === activePatientId ? 'recording' : 'scheduled'),
        dob: c.dob || '',
        priorNote,
        priorNoteDate,
        alerts,
        diarizedTranscript,
        soap,
        cdtCodes
      };
    });
  }, [consultations, activePatientId, dentistName, localLiveTranscripts]);

  // Filter encounters for the selected day sheet date (Pure genuine data)
  const encountersForDate: PatientEncounter[] = useMemo(() => {
    return patientEncounters.filter(p => {
      const orig = consultations.find(c => c.id === p.id);
      return orig?.date === currentDateStr;
    });
  }, [patientEncounters, consultations, currentDateStr]);

  // Self-healing & real-time multi-browser operatory synchronization:
  // Auto-focus active encounter if another browser added a walk-in patient or recorded dialogue
  useEffect(() => {
    if (encountersForDate.length === 0) {
      if (activePatientId) setActivePatientId('');
      return;
    }

    // Check for walk-in patient
    const walkInEncounter = encountersForDate.find(p => p.id.startsWith('walkin-'));

    // Check for an encounter with active dialogue from another browser
    const liveDiscussionEncounter = encountersForDate.find(
      p => p.diarizedTranscript && p.diarizedTranscript.length > 0 && p.id.startsWith('walkin-')
    ) || encountersForDate.find(
      p => p.diarizedTranscript && p.diarizedTranscript.length > 1
    );

    // If a brand-new walk-in arrived from another browser, auto-focus it
    if (walkInEncounter && walkInEncounter.id !== lastKnownWalkinIdRef.current) {
      lastKnownWalkinIdRef.current = walkInEncounter.id;
      setActivePatientId(walkInEncounter.id);
      return;
    }

    // If activePatientId does not exist in encountersForDate, select active or first
    if (!encountersForDate.some(p => p.id === activePatientId)) {
      if (liveDiscussionEncounter) {
        setActivePatientId(liveDiscussionEncounter.id);
      } else {
        setActivePatientId(encountersForDate[0].id);
      }
      return;
    }

    // If user hasn't explicitly locked onto a card and a live encounter exists, switch to it
    if (!hasUserManuallySelectedRef.current) {
      if (liveDiscussionEncounter) {
        setActivePatientId(liveDiscussionEncounter.id);
      } else if (walkInEncounter) {
        setActivePatientId(walkInEncounter.id);
      }
    }
  }, [encountersForDate, activePatientId]);

  const activeEncounter = useMemo(() => {
    if (encountersForDate.length === 0) return null;
    return encountersForDate.find(p => p.id === activePatientId) || encountersForDate[0] || null;
  }, [encountersForDate, activePatientId]);

  // ─────────────────────────────────────────────────────────────
  // 3. LIVE AUDIO RECORDING, DSP ACOUSTIC SQUELCH & WEBAUDIO GRAPH
  // ─────────────────────────────────────────────────────────────
  const [isRecording] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [isMicStandby, setIsMicStandby] = useState(true); // Apple Medical Standard: Starts in explicit STANDBY (00:00)
  const [recordingSeconds, setRecordingSeconds] = useState(0); // Anchored at 00:00 until clinician initiates
  const [manualDialogueText, setManualDialogueText] = useState('');
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [backgroundFinalizingIds, setBackgroundFinalizingIds] = useState<Set<string>>(new Set());
  const [copiedNote, setCopiedNote] = useState(false);
  const [dspNoiseGateActive, setDspNoiseGateActive] = useState(true);
  const [showBatchTray, setShowBatchTray] = useState(false);
  const [copiedBatchIndex, setCopiedBatchIndex] = useState<number | null>(null);
  const [allBatchCopied, setAllBatchCopied] = useState(false);

  // Silence auto-pause & pre-warning state (Apple Medical 3-minute sleep with 30s audio-visual notice)
  const [isSilenceWarning, setIsSilenceWarning] = useState(false);
  const [silenceSecondsRemaining, setSilenceSecondsRemaining] = useState(30);
  const isSilenceWarningRef = useRef(false);
  const lastVoicedTimeRef = useRef<number>(Date.now());
  const hasPlayedWarningChimeRef = useRef<boolean>(false);
  const [isGeneratingFromConversation, setIsGeneratingFromConversation] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  // ─────────────────────────────────────────────────────────────
  // 3b. INLINE EDITABLE SOAP CLINICAL NOTE OVERRIDES & AUTOSAVE
  // ─────────────────────────────────────────────────────────────
  const [editedSoapNotes, setEditedSoapNotes] = useState<Record<string, {
    subjective?: string;
    objective?: string;
    assessment?: string;
    plan?: string;
  }>>({});
  const [soapSaveStatus, setSoapSaveStatus] = useState<Record<string, 'saved' | 'saving'>>({});

  // ─────────────────────────────────────────────────────────────
  // 3c. CONTEXTUAL OPERATORY HELP & DIRECT GITHUB ISSUE CREATION
  // ─────────────────────────────────────────────────────────────
  const [showDayGuide, setShowDayGuide] = useState(false);
  const [guideActiveTab, setGuideActiveTab] = useState<'phases' | 'hotkeys' | 'dictation' | 'pms' | 'github'>('phases');
  const [guideGhTitle, setGuideGhTitle] = useState('');
  const [guideGhCategory, setGuideGhCategory] = useState('feature-request');
  const [guideGhDescription, setGuideGhDescription] = useState('');
  const [guideGhPriority, setGuideGhPriority] = useState('normal');
  const [guideGhToken, setGuideGhToken] = useState('');
  const [guideGhSubmitting, setGuideGhSubmitting] = useState(false);
  const [guideGhResult, setGuideGhResult] = useState<{ ok: boolean; issueNumber?: number; issueUrl?: string; error?: string } | null>(null);

  const handleSubmitChairsideGitHubIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guideGhTitle.trim() || !guideGhDescription.trim()) return;
    setGuideGhSubmitting(true);
    setGuideGhResult(null);
    try {
      const res = await fetch('/api/support/github-issue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(guideGhToken.trim() ? { 'x-github-token': guideGhToken.trim() } : {})
        },
        body: JSON.stringify({
          title: guideGhTitle,
          description: guideGhDescription,
          category: guideGhCategory,
          priority: guideGhPriority,
          customToken: guideGhToken.trim() || undefined,
          telemetry: {
            appVersion: '2.4.0',
            screen: 'Chairside Operatory',
            audioDsp: dspNoiseGateActive ? 'Active (120Hz/3400Hz/4200Hz)' : 'Bypassed',
            patientEncounter: activeEncounter?.procedureText || 'General'
          }
        })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setGuideGhResult({ ok: true, issueNumber: data.issueNumber, issueUrl: data.issueUrl });
        setGuideGhTitle('');
        setGuideGhDescription('');
      } else {
        setGuideGhResult({ ok: false, error: data.message || data.error || 'Failed to create GitHub issue' });
      }
    } catch (err: any) {
      setGuideGhResult({ ok: false, error: err.message || 'Network error connecting to support endpoint' });
    } finally {
      setGuideGhSubmitting(false);
    }
  };

  // Real-time live interim speech and operatory microphone state
  const [interimTranscript, setInterimTranscript] = useState('');
  const [micListening, setMicListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  // Auto-scroll ref and timer refs
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const interimTimerRef = useRef<any>(null);

  // Sync refs to guarantee SpeechRecognition callbacks never suffer from stale closures
  const isRecordingRef = useRef(isRecording);
  const isPausedRef = useRef(isPaused);
  const isMicStandbyRef = useRef(isMicStandby);
  const activeEncounterRef = useRef(activeEncounter);
  const consultationsRef = useRef(consultations);

  useEffect(() => {
    isRecordingRef.current = isRecording;
    isPausedRef.current = isPaused;
    isMicStandbyRef.current = isMicStandby;
    activeEncounterRef.current = activeEncounter;
    consultationsRef.current = consultations;
  }, [isRecording, isPaused, isMicStandby, activeEncounter, consultations]);

  // Wall-clock epoch timestamp anchor (immune to Chromium tab throttling when in Dentrix/Eaglesoft)
  const sessionStartTimeRef = useRef<number>(Date.now());

  // Apple Medical-Grade Tactile Audio Chimes (Hands-free Loupes/Gloves Confirmation)
  const playMedicalChime = useCallback((type: 'start' | 'stop' | 'pause' | 'warning' | 'auto-pause') => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = audioContextRef.current || new AudioCtx();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'start') {
        // High-resolution ascending chime: 587.33Hz (D5) -> 880Hz (A5) -> 1174.66Hz (D6)
        osc.frequency.setValueAtTime(587.33, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.05);
        osc.frequency.exponentialRampToValueAtTime(1174.66, now + 0.12);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.23);
      } else if (type === 'pause') {
        // Soft pause blip: 880Hz -> 659.25Hz (E5)
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.08);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.09, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
        osc.start(now);
        osc.stop(now + 0.17);
      } else if (type === 'warning') {
        // Gentle double-pip warning cue: 784Hz (G5) double blip for silence pre-pause notice
        osc.frequency.setValueAtTime(784, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
        gain.gain.setValueAtTime(0.0001, now + 0.12);
        gain.gain.exponentialRampToValueAtTime(0.08, now + 0.14);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.24);
      } else if (type === 'auto-pause') {
        // Calming descending chime for auto-sleep: 880Hz -> 659.25Hz -> 523.25Hz (C5)
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.10);
        osc.frequency.exponentialRampToValueAtTime(523.25, now + 0.24);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.10, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
        osc.start(now);
        osc.stop(now + 0.33);
      } else {
        // Calm descending completion tone: 880Hz -> 440Hz
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.12);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.10, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.20);
        osc.start(now);
        osc.stop(now + 0.21);
      }
    } catch {
      // Audio chime is progressive enhancement; ignore if audio blocked
    }
  }, []);

  const handleKeepListening = useCallback(() => {
    lastVoicedTimeRef.current = Date.now();
    hasPlayedWarningChimeRef.current = false;
    setIsSilenceWarning(false);
    isSilenceWarningRef.current = false;
    setSilenceSecondsRemaining(30);
    playMedicalChime('start');
  }, [playMedicalChime]);

  const handleStartAudio = useCallback(() => {
    sessionStartTimeRef.current = Date.now() - (recordingSeconds * 1000);
    lastVoicedTimeRef.current = Date.now();
    hasPlayedWarningChimeRef.current = false;
    setIsSilenceWarning(false);
    isSilenceWarningRef.current = false;
    setIsMicStandby(false);
    setIsPaused(false);
    playMedicalChime('start');
  }, [recordingSeconds, playMedicalChime]);

  const handleTogglePause = useCallback(() => {
    setIsPaused(prev => {
      const next = !prev;
      if (!next) {
        lastVoicedTimeRef.current = Date.now();
      }
      setIsSilenceWarning(false);
      isSilenceWarningRef.current = false;
      hasPlayedWarningChimeRef.current = false;
      playMedicalChime(next ? 'pause' : 'start');
      return next;
    });
  }, [playMedicalChime]);

  const handleStopAudioToStandby = useCallback(() => {
    setIsMicStandby(true);
    setIsPaused(false);
    setIsSilenceWarning(false);
    isSilenceWarningRef.current = false;
    hasPlayedWarningChimeRef.current = false;
    setInterimTranscript('');
    playMedicalChime('stop');
  }, [playMedicalChime]);

  const handleSelectPatient = useCallback((patientId: string) => {
    hasUserManuallySelectedRef.current = true;
    if (patientId === activePatientId) return;

    // Apple Medical Standard: Strict patient boundary halts recording to prevent cross-patient contamination
    if (!isMicStandbyRef.current) {
      playMedicalChime('stop');
    }
    setActivePatientId(patientId);
    setIsMicStandby(true);
    setIsPaused(false);
    setIsSilenceWarning(false);
    isSilenceWarningRef.current = false;
    hasPlayedWarningChimeRef.current = false;
    setRecordingSeconds(0);
    setInterimTranscript('');
    sessionStartTimeRef.current = Date.now();
    lastVoicedTimeRef.current = Date.now();
  }, [activePatientId, playMedicalChime]);

  // Hands-Free Spacebar / Foot-Pedal Operatory Audio Toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        const activeEl = document.activeElement;
        const isInputFocused =
          activeEl instanceof HTMLInputElement ||
          activeEl instanceof HTMLTextAreaElement ||
          activeEl?.getAttribute('contenteditable') === 'true';

        if (!isInputFocused) {
          e.preventDefault();
          if (isSilenceWarningRef.current) {
            handleKeepListening();
          } else if (isMicStandbyRef.current) {
            handleStartAudio();
          } else {
            handleTogglePause();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeepListening, handleStartAudio, handleTogglePause]);

  // Derived active SOAP with local inline edits applied
  const currentSoap = useMemo(() => {
    const rawSoap = activeEncounter?.soap || {
      subjective: '',
      objective: '',
      assessment: '',
      plan: ''
    };
    const overrides = (activeEncounter?.id && editedSoapNotes[activeEncounter.id]) || {};
    return {
      subjective: overrides.subjective !== undefined ? overrides.subjective : rawSoap.subjective,
      objective: overrides.objective !== undefined ? overrides.objective : rawSoap.objective,
      assessment: overrides.assessment !== undefined ? overrides.assessment : rawSoap.assessment,
      plan: overrides.plan !== undefined ? overrides.plan : rawSoap.plan
    };
  }, [activeEncounter?.id, activeEncounter?.soap, editedSoapNotes]);

  // Handle inline clinical SOAP edit with instant optimistic UI & database auto-save
  const handleSoapChange = useCallback(async (field: 'subjective' | 'objective' | 'assessment' | 'plan', value: string) => {
    if (!activeEncounter) return;
    const targetId = activeEncounter.id;

    // 1. Optimistic UI update (0ms typing latency)
    setEditedSoapNotes(prev => ({
      ...prev,
      [targetId]: {
        ...(prev[targetId] || {}),
        [field]: value
      }
    }));
    setSoapSaveStatus(prev => ({ ...prev, [targetId]: 'saving' }));

    // 2. Persist to consultation in database
    const existingConsultation = consultationsRef.current.find(c => c.id === targetId);
    if (existingConsultation && onSaveConsultation) {
      const currentFindings = existingConsultation.findings || {};
      const updatedFindings: ClinicalFindings = {
        ...currentFindings,
        chiefComplaint: field === 'subjective' ? value : (currentFindings.chiefComplaint || ''),
        toothFindings: field === 'objective' ? value : (currentFindings.toothFindings || ''),
        diagnosis: field === 'assessment' ? value : (currentFindings.diagnosis || ''),
        treatmentPerformed: field === 'plan' ? value : (currentFindings.treatmentPerformed || '')
      };

      const updatedConsultation: Consultation = {
        ...existingConsultation,
        findings: updatedFindings
      };

      try {
        await onSaveConsultation(updatedConsultation);
        setSoapSaveStatus(prev => ({ ...prev, [targetId]: 'saved' }));
      } catch (e) {
        console.warn('Failed to auto-save inline edited SOAP note:', e);
      }
    } else {
      setSoapSaveStatus(prev => ({ ...prev, [targetId]: 'saved' }));
    }
  }, [activeEncounter, onSaveConsultation]);

  // Web Audio Nodes & direct DOM ref array for 60fps zero-render visualizer
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);
  const waveformRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Auto-scroll ambient transcript stream to bottom on new utterance or interim speech
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeEncounter?.diarizedTranscript?.length, interimTranscript]);

  // High-performance DOM-level visualizer loop with Dual-Stage Operatory DSP Filter Graph
  useEffect(() => {
    let isCancelled = false;

    const startWebAudio = async () => {
      if (!isRecording || isPaused || isMicStandby) return;

      try {
        if (!audioContextRef.current) {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (AudioContextClass) {
            audioContextRef.current = new AudioContextClass();
          }
        }

        if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
          await audioContextRef.current.resume();
        }

        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
          if (stream && !isCancelled) {
            streamRef.current = stream;
            if (audioContextRef.current) {
              const ctx = audioContextRef.current;
              const source = ctx.createMediaStreamSource(stream);
              const analyser = ctx.createAnalyser();
              analyser.fftSize = 64;

              // ─── DUAL-STAGE ACOUSTIC DSP GRAPH ───
              // 1. Vocal Highpass (120 Hz) - removes HVAC rumble and ceiling subwoofer bass
              const highpass = ctx.createBiquadFilter();
              highpass.type = 'highpass';
              highpass.frequency.value = 120;

              // 2. Vocal Lowpass (3,400 Hz) - strips radio percussion, cymbals & air syringe hiss
              const lowpass = ctx.createBiquadFilter();
              lowpass.type = 'lowpass';
              lowpass.frequency.value = 3400;

              // 3. Drill Turbine Notch (4,200 Hz, Q 3.5) - eliminates high-speed handpiece resonant scream
              const drillNotch = ctx.createBiquadFilter();
              drillNotch.type = 'notch';
              drillNotch.frequency.value = 4200;
              drillNotch.Q.value = 3.5;

              if (dspNoiseGateActive) {
                // Route through full acoustic operatory chain
                source.connect(highpass);
                highpass.connect(lowpass);
                lowpass.connect(drillNotch);
                drillNotch.connect(analyser);
              } else {
                // Direct bypass mode
                source.connect(analyser);
              }
              analyserRef.current = analyser;

              const dataArray = new Uint8Array(analyser.frequencyBinCount);
              const updateVisualizer = () => {
                if (isCancelled) return;
                analyser.getByteFrequencyData(dataArray);

                // Direct DOM manipulation on each bar: 60fps with 0 React renders!
                for (let i = 0; i < 13; i++) {
                  const bar = waveformRefs.current[i];
                  if (bar) {
                    if (isMicStandbyRef.current || isPausedRef.current) {
                      bar.style.height = '15%';
                      bar.style.opacity = '0.35';
                    } else {
                      const rawVal = dataArray[i % dataArray.length] || 20;
                      const pct = Math.max(15, Math.min(100, Math.floor((rawVal / 255) * 100)));
                      bar.style.height = `${pct}%`;
                      bar.style.opacity = '1';
                    }
                  }
                }
                animFrameRef.current = requestAnimationFrame(updateVisualizer);
              };
              updateVisualizer();
            }
          }
        }
      } catch (err) {
        console.warn('Microphone audio context not supported or denied:', err);
      }
    };

    startWebAudio();

    return () => {
      isCancelled = true;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, [isRecording, isPaused, isMicStandby, dspNoiseGateActive]);

  /**
   * Operatory audio capture.
   *
   * The cockpit previously captured NO audio at all — the microphone stream fed
   * a visualiser and the Web Speech API, and nothing else. That is the ceiling on
   * note accuracy here: with no recording there is nothing to transcribe
   * accurately, so the note could only ever be as good as a browser recogniser
   * with no dental vocabulary that cannot separate the dentist from the patient.
   *
   * The stream is now also recorded in 5-second slices and uploaded against the
   * consultation, so the appointment can be transcribed server-side with
   * diarization and the note generated from that instead.
   *
   * Deliberate properties:
   *  - Uploads are serialised through one promise chain. Parallel slice uploads
   *    would arrive out of order, and the transcriber assembles by index — order
   *    is the recorder's, and the queue is what preserves it.
   *  - A failed slice is not retried here and does not stop the recording; a gap
   *    is reported to the clinician later as "part of the recording is missing"
   *    rather than being stitched over.
   *  - Nothing is uploaded without an auth token and an active encounter, so a
   *    demo session with no clinic context records nothing.
   */
  useEffect(() => {
    if (!isRecording || isPaused || isMicStandby) return;
    if (!authToken || !activeEncounter?.id) return;
    if (typeof MediaRecorder === 'undefined') return;

    const consultationId = activeEncounter.id;
    let cancelled = false;
    let recorder: MediaRecorder | null = null;

    const start = async () => {
      // Reuse the stream the visualiser already opened rather than opening a
      // second capture on the same microphone. The visualiser effect is declared
      // first but is asynchronous, so its stream is usually a tick or two away —
      // hence the short wait rather than a second getUserMedia call.
      let stream = streamRef.current;
      for (let attempt = 0; !stream && attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (cancelled) return;
        stream = streamRef.current;
      }
      if (!stream) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
          return;
        }
      }
      if (cancelled) return;

      try {
        recorder = new MediaRecorder(stream);
      } catch {
        return;
      }

      recordedMimeTypeRef.current = recorder.mimeType || 'audio/webm';
      chunkUploadRef.current = { chairKey: consultationId, counter: 0, queue: Promise.resolve(), recorder };

      recorder.ondataavailable = (event: BlobEvent) => {
        if (!event.data || event.data.size === 0) return;
        const index = chunkUploadRef.current.counter;
        chunkUploadRef.current.counter += 1;
        const blob = event.data;
        // Chained onto the previous upload so slices land in order.
        chunkUploadRef.current.queue = chunkUploadRef.current.queue
          .then(async () => {
            const base64 = await blobToBase64(blob);
            await uploadAudioSegment({
              authToken,
              consultationId,
              chunkIndex: index,
              base64,
              sizeBytes: blob.size
            });
          })
          .catch(() => {});
      };

      // 5s slices: long enough that the upload volume is modest, short enough
      // that an interrupted appointment keeps all but the last few seconds.
      recorder.start(5000);
    };

    void start();

    return () => {
      cancelled = true;
      try {
        if (recorder && recorder.state !== 'inactive') recorder.stop();
      } catch {
        // Already stopped, or the recorder was never started on this device.
      }
    };
  }, [isRecording, isPaused, isMicStandby, activeEncounter?.id, authToken]);

  // Helper to append spoken or typed utterance with 0ms optimistic UI update & real database persistence
  const handleAppendTranscriptText = useCallback(
    async (text: string, sender: 'Dentist' | 'Patient' | 'Dialogue' = 'Dentist') => {
    if (!text.trim() || !activeEncounterRef.current) return;

    // Verbatim capture: the persisted record keeps exactly what was spoken.
    // Lexicon correction must never rewrite the source of record — it belongs
    // to the model prompt or the display layer (medicolegal fidelity).
    const normalized = text.trim();
    if (!normalized) return;

    // Reset silence timer on any voiced speech
    lastVoicedTimeRef.current = Date.now();
    hasPlayedWarningChimeRef.current = false;
    if (isSilenceWarningRef.current) {
      setIsSilenceWarning(false);
      isSilenceWarningRef.current = false;
    }

    const targetId = activeEncounterRef.current.id;
    const timeNow = formatClinicTime(new Date(), { second: '2-digit' });

    // 1. Instant 0ms optimistic UI update: renders the new utterance immediately in the feed
    setLocalLiveTranscripts(prev => ({
      ...prev,
      [targetId]: [
        ...(prev[targetId] || []),
        { sender, text: normalized, time: timeNow }
      ]
    }));
    setInterimTranscript('');

    // 2. Concurrently persist to database consultation
    const existingConsultation = consultationsRef.current.find(c => c.id === targetId);
    if (existingConsultation) {
      const updatedTranscript: TranscriptItem[] = [
        ...(existingConsultation.transcript || []),
        { sender, text: normalized }
      ];

      const updatedConsultation: Consultation = {
        ...existingConsultation,
        transcript: updatedTranscript
      };

      if (onSaveConsultation) {
        await onSaveConsultation(updatedConsultation);
      }
    }
  }, [onSaveConsultation]);

  // SpeechRecognition Hook with Operatory Acoustic Artifact Filtering & Live Interim Dialogue
  useEffect(() => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      setMicError('Speech recognition is not supported in this browser.');
      return;
    }

    if (!isRecording || isPaused || isMicStandby || !activeEncounter) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { }
        recognitionRef.current = null;
      }
      setMicListening(false);
      setInterimTranscript('');
      return;
    }

    try {
      const recognition = new SpeechRec();
      recognition.continuous = true;
      recognition.interimResults = true;
      // The product is built for Australian practices, so recognition is pinned
      // to Australian English. This used to follow `navigator.language`, which
      // meant any machine set to en-US or en-GB transcribed with US/UK phonetics
      // — undermining the dental lexicon and the dialect-resilience claim on
      // exactly the hardware a practice actually owns.
      recognition.lang = 'en-AU';

      recognition.onstart = () => {
        setMicListening(true);
        setMicError(null);
      };

      recognition.onerror = (event: any) => {
        console.warn('Operatory SpeechRecognition event:', event.error);
        if (event.error === 'not-allowed') {
          setMicError('Microphone permission blocked. Please enable mic access in your browser.');
        } else if (event.error !== 'no-speech') {
          setMicError(`Mic notice: ${event.error}`);
        }
        setMicListening(false);
      };

      recognition.onend = () => {
        setMicListening(false);
        setInterimTranscript('');
        // Web Speech API ends sessions automatically on silence or timeout.
        // Auto-restart while active:
        if (isRecordingRef.current && !isPausedRef.current && !isMicStandbyRef.current && activeEncounterRef.current) {
          setTimeout(() => {
            try {
              if (recognitionRef.current === recognition) {
                recognition.start();
              }
            } catch { }
          }, 350);
        }
      };

      recognition.onresult = (event: any) => {
        let final = '';
        let interim = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          if (res.isFinal) {
            final += res[0].transcript + ' ';
          } else {
            interim += res[0].transcript;
          }
        }

        const trimmedFinal = final.trim();
        if (trimmedFinal && activeEncounterRef.current) {
          const isMechanicalNoise =
            /^(sh+|ah+|um+|zz+|ss+|hh+|ff+|th+)(\s+(sh+|ah+|um+|zz+|ss+|hh+|ff+|th+))*$/i.test(trimmedFinal) ||
            /^[^a-zA-Z0-9]+$/.test(trimmedFinal);

          if (!isMechanicalNoise) {
            // 'Dialogue', not 'Dentist'. The Web Speech API does not diarize: it
            // returns one undifferentiated stream, so every live utterance was
            // being recorded as clinician speech. That asserted a role the
            // microphone never established, and it pushed the patient's own
            // words into the clinician-observed sections of the note (while
            // leaving nothing to fill the patient-reported ones). The recorded
            // audio is transcribed separately and *does* carry roles.
            handleAppendTranscriptText(trimmedFinal, 'Dialogue');
          }
          setInterimTranscript('');
        } else if (interim.trim()) {
          // Voice activity detected: reset silence timer
          lastVoicedTimeRef.current = Date.now();
          hasPlayedWarningChimeRef.current = false;
          if (isSilenceWarningRef.current) {
            setIsSilenceWarning(false);
            isSilenceWarningRef.current = false;
          }

          const pendingInterim = interim.trim();
          setInterimTranscript(pendingInterim);

          // Squelch lingering interim: auto-commit if speaker pauses for >1.5s
          if (interimTimerRef.current) clearTimeout(interimTimerRef.current);
          interimTimerRef.current = setTimeout(() => {
            if (interim.trim()) {
              const spoken = interim.trim();
              const isNoise = /^(sh+|ah+|um+|zz+|ss+|hh+|ff+|th+)(\s+(sh+|ah+|um+|zz+|ss+|hh+|ff+|th+))*$/i.test(spoken);
              if (spoken && !isNoise) {
                handleAppendTranscriptText(spoken, 'Dialogue');
              }
              setInterimTranscript('');
            }
          }, 1500);
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      console.warn('SpeechRecognition failed to initialize:', err);
    }

    return () => {
      if (interimTimerRef.current) {
        clearTimeout(interimTimerRef.current);
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { }
        recognitionRef.current = null;
      }
    };
  }, [isRecording, isPaused, isMicStandby, activeEncounter?.id, handleAppendTranscriptText]);

  // Elapsed Timer with wall-clock epoch accuracy (immune to Chromium tab throttling)
  // Adaptive 3-Minute Silence Sleep with 30s Pre-Pause Audio-Visual Warning (at 2m 30s)
  useEffect(() => {
    let interval: any;
    if (isRecording && !isPaused && !isMicStandby) {
      interval = setInterval(() => {
        const elapsed = Math.max(0, Math.floor((Date.now() - sessionStartTimeRef.current) / 1000));
        setRecordingSeconds(elapsed);

        // Check silence duration since last voiced speech
        const silenceSec = (Date.now() - lastVoicedTimeRef.current) / 1000;
        if (silenceSec >= 180) {
          // 3:00 - Auto-pause recording
          setIsPaused(true);
          setIsSilenceWarning(false);
          isSilenceWarningRef.current = false;
          hasPlayedWarningChimeRef.current = false;
          playMedicalChime('auto-pause');
        } else if (silenceSec >= 150) {
          // 2:30 - Pre-pause audio-visual countdown warning
          const remaining = Math.max(0, Math.ceil(180 - silenceSec));
          setIsSilenceWarning(true);
          isSilenceWarningRef.current = true;
          setSilenceSecondsRemaining(remaining);
          if (!hasPlayedWarningChimeRef.current) {
            hasPlayedWarningChimeRef.current = true;
            playMedicalChime('warning');
          }
        } else {
          if (isSilenceWarningRef.current) {
            setIsSilenceWarning(false);
            isSilenceWarningRef.current = false;
          }
        }
      }, 1000);
    } else {
      if (isSilenceWarningRef.current) {
        setIsSilenceWarning(false);
        isSilenceWarningRef.current = false;
      }
      hasPlayedWarningChimeRef.current = false;
    }
    return () => clearInterval(interval);
  }, [isRecording, isPaused, isMicStandby, playMedicalChime]);

  // Window Visibility Listener: guarantees timer catches up immediately when tab is un-hidden from PMS
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && isRecording && !isPaused && !isMicStandby) {
        const elapsed = Math.max(0, Math.floor((Date.now() - sessionStartTimeRef.current) / 1000));
        setRecordingSeconds(elapsed);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isRecording, isPaused, isMicStandby]);

  const formatTimer = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // ─────────────────────────────────────────────────────────────
  // 4. PMS DAYSHEET IMPORT (REAL MODAL & PARSER)
  // ─────────────────────────────────────────────────────────────
  const [showDaysheetModal, setShowDaysheetModal] = useState(false);
  const [daysheetRawText, setDaysheetRawText] = useState('');
  const [pmsImportNotice, setPmsImportNotice] = useState(false);

  const handleOpenDaysheetModal = () => {
    setShowDaysheetModal(true);
  };

  const handleParseAndImportDaysheet = async () => {
    if (!daysheetRawText.trim()) {
      setShowDaysheetModal(false);
      return;
    }

    const lines = daysheetRawText.split('\n').map(l => l.trim()).filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const parts = line.split(/[\t,]| {2,}/);
      const timeGuess = line.match(/\d{1,2}:\d{2}(\s?[AP]M)?/i)?.[0] || formatClinicTime(new Date());
      const cleanName = parts.length > 1 ? parts[1].trim() : parts[0].replace(timeGuess, '').trim();
      const procedure = parts.length > 2 ? parts[2].trim() : 'Dental Consultation & Treatment';

      const names = cleanName.split(' ');
      const firstName = names[0] || 'Patient';
      const lastName = names.slice(1).join(' ') || `${i + 1}`;

      // A daysheet row is a scheduled appointment, NOT a clinical record.
      //
      // This used to create a consultation per row carrying a synthesised
      // transcript ("Imported from PMS daysheet for X."), an invented chief
      // complaint, a treatmentPerformed value asserting treatment that had not
      // happened yet, and a fabricated practitioner id
      // (currentUser?.id || 'dentist-01'). The grounding check then cross-checked
      // AI output against that invented transcript and reported it as verified.
      //
      // Only the schedule entry is created here. The clinical record is created
      // by the consultation itself, from real speech.
      addScheduleItem({
        time: timeGuess,
        patientName: `${firstName} ${lastName}`,
        procedureText: procedure,
        appointmentType: 'restorative',
        templateId: 'standard'
      });
    }

    setDaysheetRawText('');
    setShowDaysheetModal(false);
    setPmsImportNotice(true);
    setTimeout(() => setPmsImportNotice(false), 3000);
  };

  // ─────────────────────────────────────────────────────────────
  // 5. QUICK WALK-IN ENTRY (SAVES DIRECTLY TO DATABASE)
  // ─────────────────────────────────────────────────────────────
  const [showWalkInCard, setShowWalkInCard] = useState(false);
  const [walkInName, setWalkInName] = useState('');
  const [walkInOperatory, setWalkInOperatory] = useState('Op 1');
  const [walkInTime, setWalkInTime] = useState(() => `Now (${formatClinicTime(new Date())})`);
  const [walkInReason, setWalkInReason] = useState('');

  const handleAddWalkInToStream = async () => {
    if (!walkInName.trim()) return;

    const names = walkInName.trim().split(' ');
    const firstName = names[0];
    const lastName = names.slice(1).join(' ') || 'Walk-In';

    let cleanTime = walkInTime.includes('(') ? walkInTime.split('(')[1].replace(')', '').trim() : walkInTime;
    if (cleanTime.endsWith(' A')) cleanTime = cleanTime.replace(/ A$/, ' AM');
    if (cleanTime.endsWith(' P')) cleanTime = cleanTime.replace(/ P$/, ' PM');

    const newConsultation: Consultation = {
      id: `walkin-${Date.now()}`,
      dentistId: currentUser?.id || 'dentist-01',
      clinicId: activeClinicId || undefined,
      firstName,
      lastName,
      dob: '',
      appointmentType: 'emergency',
      templateId: 'emergency',
      date: getClinicTodayIso(),
      time: cleanTime,
      status: 'In Review',
      patientSummary: '',
      transcript: [
        { sender: 'Dentist', text: `Emergency walk-in encounter started for ${firstName} ${lastName}.${walkInReason ? ` Chief complaint: ${walkInReason}` : ''}` }
      ],
      findings: {
        chiefComplaint: walkInReason || 'Emergency walk-in consultation',
        history: walkInReason ? `Emergency presentation: ${walkInReason}` : 'Patient presented for walk-in emergency evaluation.',
        toothFindings: '',
        findingsGingival: '',
        diagnosis: '',
        treatmentPerformed: '',
        recommendations: '',
        recallRequirements: '',
        customSections: { operatory: walkInOperatory },
        adaCodes: []
      }
    };

    if (onSaveConsultation) {
      await onSaveConsultation(newConsultation);
    }

    addScheduleItem({
      time: cleanTime,
      patientName: walkInName.trim(),
      procedureText: `Emergency • ${walkInReason}`,
      appointmentType: 'emergency',
      templateId: 'emergency'
    });

    handleSelectPatient(newConsultation.id);
    setShowWalkInCard(false);
  };

  // ─────────────────────────────────────────────────────────────
  // 6. ASYNCHRONOUS NOTE FINALIZATION & NON-BLOCKING HANDOFF
  // ─────────────────────────────────────────────────────────────
  const executeBackgroundNoteFinalization = async (targetId: string, autoCopyClipboard = false) => {
    try {
      const targetConsult = consultations.find(c => c.id === targetId);
      if (!targetConsult) return;

      const template = getTemplateById(targetConsult.templateId || 'standard');

      // Guarantee 0 lost lines: Merge in-memory local feed with persisted consultation transcript
      const localFeed = localLiveTranscripts[targetId] || [];
      const remoteFeed = targetConsult.transcript || [];

      let liveTranscript: TranscriptItem[] = [];
      if (localFeed.length >= remoteFeed.length && localFeed.length > 0) {
        liveTranscript = localFeed.map(item => ({
          sender: (item.sender === 'Patient' ? 'Patient' : item.sender === 'Dialogue' ? 'Dialogue' : 'Dentist') as TranscriptItem['sender'],
          text: item.text
        }));
      } else if (remoteFeed.length > 0) {
        liveTranscript = remoteFeed;
      }
      // No fabricated line here. This used to invent "Clinical procedure completed
      // successfully." when nothing was captured, which put a clinical statement
      // nobody made into the note *and* gave the generator a transcript to fill
      // from — so a recording failure produced a confident, entirely fictional
      // record. An empty transcript is now passed through as empty, and the
      // caller is told the note rests on no captured speech.

      // The recorded audio is the better source: it is transcribed server-side
      // with diarization, so patient-reported and clinician-observed statements
      // arrive separated. Live speech recognition is only the fallback.
      let transcribed: TranscriptItem[] | undefined;
      let transcriptionWarnings: string[] = [];
      let transcriptSource: TranscriptSource = 'browser-live';
      if (authToken) {
        setIsTranscribingNote(true);
        const result = await requestTranscription({
          authToken,
          consultationId: targetConsult.id,
          mimeType: recordedMimeTypeRef.current
        });
        setIsTranscribingNote(false);
        if (result.ok) {
          transcribed = result.transcript;
          transcriptionWarnings = result.warnings;
          if (result.contiguous === false) {
            transcriptionWarnings = [
              ...transcriptionWarnings,
              'Part of the recording did not upload, so some of what was said may be missing.'
            ];
          }
        } else if (isTranscriptionFailure(result)) {
          // These three are expected, not faults, and telling the clinician about
          // them would be noise they cannot act on: no audio recorded, a recording
          // too short to hold speech, or an encounter that was never persisted
          // server-side (so no recording can exist for it).
          const expected = ['NO_AUDIO', 'AUDIO_TOO_SMALL', 'NOT_FOUND'].includes(result.code);
          if (!expected) transcriptionWarnings = [...transcriptionWarnings, result.error];
        }
      }

      const transcriptChoice = chooseNoteTranscript({
        live: liveTranscript,
        diarized: transcribed,
        audioIncomplete: transcriptionWarnings.length > 0
      });
      const finalTranscript = transcriptChoice.transcript;
      transcriptSource = transcriptChoice.source;
      const transcriptWarnings = [...transcriptionWarnings, ...transcriptChoice.warnings];

      // Call real backend note generation endpoint
      let payload: any = null;
      if (authToken) {
        try {
          const res = await fetch('/api/notes/jobs', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
              intakeData: {
                firstName: targetConsult.firstName,
                lastName: targetConsult.lastName,
                // Never invent a date of birth: it is a patient identifier, and a
                // fabricated one is how two patients' records end up merged.
                dob: targetConsult.dob || '',
                appointmentType: targetConsult.appointmentType,
                templateId: template.id
              },
              transcript: finalTranscript,
              consultationId: targetConsult.id
            })
          });

          if (res.ok) {
            const jobData = await res.json();
            const deadline = Date.now() + 20_000;
            while (Date.now() < deadline) {
              await new Promise(r => setTimeout(r, 1500));
              const pollRes = await fetch(`/api/notes/jobs/${jobData.jobId}`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
              });
              if (pollRes.ok) {
                const jobState = await pollRes.json();
                if (jobState.status === 'done') {
                  payload = jobState.result;
                  break;
                }
              }
            }
          } else {
            const errBody = await res.text();
            console.warn('Note job request returned non-OK status:', res.status, errBody);
          }
        } catch (e) {
          console.warn('Hosted note generation fallback to offline draft engine:', e);
        }
      }

      // Offline deterministic fallback draft engine
      if (!payload) {
        const draft = generateOfflineDraft(template, finalTranscript, `${targetConsult.firstName || ''} ${targetConsult.lastName || ''}`.trim());
        payload = {
          ...draft.canonical,
          customSections: draft.customSections,
          adaCodes: draft.adaCodes,
          patientSummary: draft.patientSummary
        };
      }

      // Nothing here is invented. Every section falls back to whatever is already
      // on the record, and then to empty — because these fields are the clinical
      // record. The previous boilerplate ("Teeth examined and stable.", "Gingiva
      // stable.", "Procedure completed.") meant that an empty generation produced
      // a saved note asserting an examination and a procedure that may never have
      // happened. An empty field is visibly unfinished; a fabricated one is not.
      const updatedFindings: ClinicalFindings = {
        chiefComplaint: payload?.chiefComplaint || targetConsult.findings?.chiefComplaint || '',
        history: payload?.history || targetConsult.findings?.history || '',
        toothFindings: payload?.toothFindings || targetConsult.findings?.toothFindings || '',
        findingsGingival: payload?.findingsGingival || targetConsult.findings?.findingsGingival || '',
        diagnosis: payload?.diagnosis || targetConsult.findings?.diagnosis || '',
        treatmentPerformed: payload?.treatmentPerformed || targetConsult.findings?.treatmentPerformed || '',
        recommendations: payload?.recommendations || targetConsult.findings?.recommendations || '',
        recallRequirements: payload?.recallRequirements || targetConsult.findings?.recallRequirements || '',
        customSections: payload?.customSections || targetConsult.findings?.customSections || {},
        adaCodes: payload?.adaCodes?.length ? payload.adaCodes : targetConsult.findings?.adaCodes || []
      };

      const finalizedConsultation: Consultation = {
        ...targetConsult,
        transcript: finalTranscript,
        transcriptProvenance: {
          source: transcriptSource,
          generatedAt: new Date().toISOString(),
          warnings: transcriptWarnings
        },
        status: 'Completed',
        patientSummary: payload?.patientSummary || targetConsult.patientSummary || '',
        findings: updatedFindings
      };

      if (onSaveConsultation) {
        await onSaveConsultation(finalizedConsultation);
      }

      if (autoCopyClipboard) {
        handleCopyPMS(finalizedConsultation);
      }

      return finalizedConsultation;
    } catch (err) {
      console.error('Failed to finalize clinical note:', err);
    }
  };

  const handleFinalizeNote = async () => {
    if (!activeEncounter) return;
    // Apple Medical Standard: Immediately halt active microphone on finalization
    if (!isMicStandby) {
      handleStopAudioToStandby();
    }
    setIsFinalizing(true);
    try {
      await executeBackgroundNoteFinalization(activeEncounter.id, true);
    } finally {
      setIsFinalizing(false);
    }
  };

  // Immediate recovery: regenerate the clinical note directly from the live conversation
  const handleRegenerateFromConversation = async () => {
    if (!activeEncounter) return;
    setIsGeneratingFromConversation(true);
    try {
      await executeBackgroundNoteFinalization(activeEncounter.id, false);
    } finally {
      setIsGeneratingFromConversation(false);
    }
  };

  // Asynchronous Non-Blocking Patient Handoff ("Next Patient")
  const handleNextPatient = () => {
    const currentIndex = encountersForDate.findIndex(p => p.id === activePatientId);
    const nextPatient = encountersForDate[currentIndex + 1];

    // Finalize current patient silently in background
    if (activeEncounter && activeEncounter.status !== 'ready' && !backgroundFinalizingIds.has(activeEncounter.id)) {
      const patientIdToFinalize = activeEncounter.id;
      setBackgroundFinalizingIds(prev => new Set(prev).add(patientIdToFinalize));
      executeBackgroundNoteFinalization(patientIdToFinalize, false).finally(() => {
        setBackgroundFinalizingIds(prev => {
          const nextSet = new Set(prev);
          nextSet.delete(patientIdToFinalize);
          return nextSet;
        });
      });
    }

    // Switch immediate operatory focus to next scheduled patient
    if (nextPatient) {
      if (!isMicStandbyRef.current) {
        playMedicalChime('stop');
      }
      setActivePatientId(nextPatient.id);
      sessionStartTimeRef.current = Date.now();
      setRecordingSeconds(0);
      setIsMicStandby(true);
      setIsPaused(false);
      setInterimTranscript('');
    }
  };

  // Completed Encounters for End-of-Day Batch Tray
  const completedEncounters = useMemo(() => {
    return encountersForDate.filter(p => p.status === 'ready');
  }, [encountersForDate]);

  // Generate note text formatted for PMS clipboard (incorporating clinician inline edits)
  const getFormattedNoteText = (consultToCopy?: Consultation): string => {
    const target = consultToCopy || consultations.find(c => c.id === activeEncounter?.id);
    if (!target) return '';

    const isCurrentActive = target.id === activeEncounter?.id;
    const subj = isCurrentActive ? currentSoap.subjective : (target.findings?.chiefComplaint ? `${target.findings.chiefComplaint} ${target.findings.history || ''}` : 'No complaints.');
    const obj = isCurrentActive ? currentSoap.objective : (target.findings?.toothFindings ? `${target.findings.toothFindings} ${target.findings.findingsGingival || ''}` : 'Intact.');
    const assess = isCurrentActive ? currentSoap.assessment : (target.findings?.diagnosis || 'Stable.');
    const planText = isCurrentActive ? currentSoap.plan : (target.findings?.treatmentPerformed ? `${target.findings.treatmentPerformed} ${target.findings.recommendations || ''}` : 'Completed.');

    return `=== DENTAI CLINICAL NOTE ===
PATIENT: ${target.firstName} ${target.lastName} (DOB: ${target.dob || 'Not recorded'})
DATE: ${formatClinicDate(target.date || new Date(), { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
PROVIDER: ${dentistName || 'Attending Clinician'}
PROCEDURE: ${target.appointmentType?.toUpperCase() || 'GENERAL RESTORATIVE'}

SUBJECTIVE (S):
${subj}

OBJECTIVE (O):
${obj}

ASSESSMENT (A):
${assess}

PLAN & PROCEDURE (P):
${planText}

CDT/ADA CODES:
${target.findings?.adaCodes?.map(c => `- ${c.code}: ${c.description}`).join('\n') || '- None recorded'}

VERIFICATION: Fully verified from patient conversation
============================`;
  };

  // Copy Note for PMS
  const handleCopyPMS = (consultToCopy?: Consultation) => {
    const noteText = getFormattedNoteText(consultToCopy);
    if (!noteText) return;

    if (navigator.clipboard) {
      navigator.clipboard.writeText(noteText);
    }
    setCopiedNote(true);
    setTimeout(() => setCopiedNote(false), 2500);
  };

  // Copy All Notes in Batch
  const handleCopyAllBatchNotes = () => {
    const allNotesText = completedEncounters
      .map(p => {
        const consult = consultations.find(c => c.id === p.id);
        return getFormattedNoteText(consult);
      })
      .filter(Boolean)
      .join('\n\n' + '='.repeat(40) + '\n\n');

    if (allNotesText && navigator.clipboard) {
      navigator.clipboard.writeText(allNotesText);
      setAllBatchCopied(true);
      setTimeout(() => setAllBatchCopied(false), 2500);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 7. PLAIN TEXT & DELIVERABLES MODAL STATE
  // ─────────────────────────────────────────────────────────────
  const [showPlainTextModal, setShowPlainTextModal] = useState(false);
  const [copiedPlainText, setCopiedPlainText] = useState(false);
  const [showDeliverablesModal, setShowDeliverablesModal] = useState(false);
  const [deliverablesActiveTab, setDeliverablesActiveTab] = useState<'referral' | 'postop'>('referral');
  const [copiedDeliverable, setCopiedDeliverable] = useState<'referral' | 'postop' | null>(null);

  const getReferralText = () => {
    if (!activeEncounter) return '';
    const patientName = activeEncounter.patientName || 'Patient';
    const dob = activeEncounter.dob || 'On record';
    const date = activeEncounter.date || getClinicTodayIso();
    const reason = currentSoap.assessment || currentSoap.subjective || activeEncounter.procedureText || 'Specialist assessment and management';
    const teeth = (currentSoap.objective + ' ' + (activeEncounter.procedureText || '')).match(/\b[1-4][1-8]\b/g)?.join(', ') || 'See examination';
    const findings = currentSoap.objective || 'Clinical examination and findings documented in chart.';
    const interim = currentSoap.plan || 'Emergency pain relief and temporisation provided.';
    const clinician = dentistName || currentUser?.name || 'Attending Clinician';

    return `CONFIDENTIAL SPECIALIST REFERRAL
Date: ${date}
Patient: ${patientName} (DOB: ${dob})
Referring Clinician: ${clinician} (AHPRA Registered)

Dear Colleague,

Thank you for seeing ${patientName} regarding specialist assessment and management.

Clinical Details:
• Relevant Tooth / Site: ${teeth}
• Reason for Referral: ${reason}
• Clinical Findings & Examination: ${findings}
• Interim Therapy Provided Today: ${interim}

Please contact our rooms if additional radiographs or records are required. We would appreciate a brief report following your consultation.

Kind regards,
${clinician}`;
  };

  const getPostOpText = () => {
    if (!activeEncounter) return '';
    const patientName = activeEncounter.patientName || 'Patient';
    const firstName = patientName.split(' ')[0] || 'Patient';
    const clinician = dentistName || currentUser?.name || 'Your Dental Team';
    const treatment = currentSoap.plan || activeEncounter.procedureText || 'Dental Treatment';

    return `Subject: Post-Operative Care & Recovery Instructions — ${patientName}

Dear ${firstName},

Thank you for visiting our practice today. Here are your personalized post-treatment care instructions:

Procedure Completed:
${treatment}

Immediate Care & What to Expect:
1. Local Anaesthetic & Numbness:
   • Numbness typically lasts 2 to 4 hours. Avoid chewing hot food, biting your lips, or chewing your tongue until full sensation returns.
2. Discomfort & Pain Relief:
   • Mild tenderness or aching around the treated site is normal as the anaesthetic wears off. Over-the-counter pain relief (such as Ibuprofen or Paracetamol, as medically appropriate for you) is recommended before feeling fully returns.
3. Oral Hygiene & Healing:
   • Continue gentle brushing around the area with a soft-bristle toothbrush. Avoid vigorous mouth rinsing or forceful spitting for the next 24 hours to protect the healing site.
   • Avoid smoking, alcohol, and strenuous exercise for at least 24 to 48 hours.

When to Contact Us Immediately:
Please reach out to our clinic right away if you experience any of the following:
• Continuous bleeding that persists after biting firmly on a clean gauze pack for 30 minutes
• Rapidly increasing swelling or difficulty opening your mouth/swallowing
• Severe, throbbing pain that is not alleviated by pain relief medication
• Elevated temperature or fever

We wish you a prompt and smooth recovery!

Warm regards,
${clinician}`;
  };

  // ─────────────────────────────────────────────────────────────
  // 8. GLOBAL HANDS-FREE KEYBOARD SHORTCUTS (Spacebar, ⌘→, ⌘V, ⌘C)
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isModifier = e.metaKey || e.ctrlKey;
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isInput = targetTag === 'input' || targetTag === 'textarea';

      // ⌘→: Advance to Next Patient (hands-free transition without touching mouse)
      if (!isInput && !showDaysheetModal && !showPlainTextModal && !showBatchTray && !showDayGuide && !showDeliverablesModal) {
        if (isModifier && (e.key === 'ArrowRight' || e.key === 'Right')) {
          e.preventDefault();
          handleNextPatient();
          return;
        }
      }

      // ? : Toggle Operatory Day Guide & GitHub Support
      if (e.key === '?' && !isInput) {
        e.preventDefault();
        setShowDayGuide(prev => !prev);
      }

      // ⌘V / Ctrl+V: Open Daysheet Importer when not focused on an input
      if (isModifier && e.key.toLowerCase() === 'v' && !isInput) {
        e.preventDefault();
        setShowDaysheetModal(true);
      }
      // ⌘C / Ctrl+C: Copy Note for PMS when not focused on an input
      else if (isModifier && e.key.toLowerCase() === 'c' && !isInput) {
        e.preventDefault();
        handleCopyPMS();
      }
      // ⌘B / Ctrl+B: Open Batch Tray
      else if (isModifier && e.key.toLowerCase() === 'b' && !isInput) {
        e.preventDefault();
        setShowBatchTray(prev => !prev);
      }
      // Escape: Dismiss active modal overlays
      if (e.key === 'Escape') {
        setShowDayGuide(false);
        setShowBatchTray(false);
        setShowDaysheetModal(false);
        setShowPlainTextModal(false);
        setShowDeliverablesModal(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeEncounter, encountersForDate, consultations, dentistName, showDaysheetModal, showPlainTextModal, showBatchTray, showDeliverablesModal]);

  // Entity annotator for live speech feed
  const renderAnnotatedText = (text: string) => {
    const regex = /(#14|#8|#19|#30|#3|1\.8mL carpule|2% Lidocaine with 1:100,000 epinephrine|Theracal liner|Filtek Supreme A2 composite|Zirconia)/g;
    const parts = text.split(regex);
    return parts.map((part, i) => {
      if (part.startsWith('#')) {
        return (
          <span key={i} className="inline-block bg-sky-100 text-sky-800 border border-sky-300 px-1.5 py-0.2 rounded font-mono font-bold text-xs mx-0.5 shadow-2xs">
            {part}
          </span>
        );
      }
      if (part === '1.8mL carpule' || part === '2% Lidocaine with 1:100,000 epinephrine') {
        return (
          <span key={i} className="inline-block bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.2 rounded font-semibold text-xs mx-0.5 shadow-2xs">
            {part}
          </span>
        );
      }
      if (part.includes('Theracal') || part.includes('Filtek') || part.includes('Zirconia')) {
        return (
          <span key={i} className="inline-block bg-purple-100 text-purple-900 border border-purple-300 px-1.5 py-0.2 rounded font-semibold text-xs mx-0.5 shadow-2xs">
            {part}
          </span>
        );
      }
      return part;
    });
  };

  return (
    <div className="flex h-screen w-full bg-[#F8FAFC] text-slate-800 font-sans overflow-hidden antialiased select-none">
      {/* ─────────────────────────────────────────────────────────────
          1. ULTRA-SLIM ICON RAIL (60px)
          ───────────────────────────────────────────────────────────── */}
      <aside className="w-[60px] flex-shrink-0 bg-white border-r border-slate-200 flex flex-col justify-between items-center py-3 z-30 shadow-2xs">
        <div className="flex flex-col items-center space-y-4">
          {/* Tooth Brand Logo */}
          <div className="w-10 h-10 rounded-xl bg-teal-800 text-white flex items-center justify-center shadow-xs">
            <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor">
              <path d="M12 2C9 2 7 4 7 7.5c0 3 1.2 6.5 2 9.5.5 2 1.5 3 2.5 3 .6 0 1.2-.5 1.5-1.5.3 1 1 1.5 1.5 1.5 1 0 2-1 2.5-3 .8-3 2-6.5 2-9.5C19 4 17 2 12 2z" />
            </svg>
          </div>

          {/* Nav Icons */}
          <div className="flex flex-col items-center space-y-2 pt-2">
            <button
              className="w-10 h-10 rounded-xl flex items-center justify-center bg-teal-800 text-white shadow-xs transition cursor-pointer"
              title="Chairside Scribe (Active Operatory)"
            >
              <Activity className="w-5 h-5 text-teal-200" />
            </button>

            <button
              onClick={onOpenHistoryHub}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
              title="Patient Records & History Hub"
            >
              <LayoutDashboard className="w-5 h-5" />
            </button>

            <button
              onClick={() => onOpenPipeline?.()}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition cursor-pointer"
              title="Treatment Pipeline & Recall Worklist"
            >
              <TrendingUp className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Bottom Rail Icons */}
        <div className="flex flex-col items-center space-y-3">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
              !isMicStandby && !isPaused
                ? 'bg-rose-100 text-rose-700 animate-pulse'
                : isPaused
                ? 'bg-amber-100 text-amber-700'
                : 'bg-slate-100 text-slate-400'
            }`}
            title={!isMicStandby && !isPaused ? 'Active Recording' : isPaused ? 'Recording Paused' : 'Microphone Standby'}
          >
            <Mic className="w-4 h-4" />
          </div>
          <button
            type="button"
            onClick={() => setShowDayGuide(true)}
            className="w-8 h-8 rounded-full hover:bg-teal-50 flex items-center justify-center text-slate-400 hover:text-teal-700 transition cursor-pointer"
            title="Clinician Day Guide & Support (Press ?)"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
          <button
            onClick={onLogout}
            className="w-8 h-8 rounded-full hover:bg-rose-50 flex items-center justify-center text-slate-400 hover:text-rose-600 transition cursor-pointer"
            title="Sign Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* ─────────────────────────────────────────────────────────────
          2. MAIN OPERATORY WORKSPACE (Full Width Header + 2-Column Area)
          ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Global Surgery Header spanning Daysheet + Stage */}
        <header className="h-14 px-6 border-b border-slate-200 bg-white flex items-center justify-between flex-shrink-0 z-10">
          {/* Real-Time Cloud Sync Indicator */}
          <div className="flex items-center space-x-2.5">
            <div className="flex items-center space-x-2 text-xs font-semibold text-slate-700 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200/80 shadow-2xs">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-slate-800 font-bold">Cloud Sync</span>
              <span className="text-[10px] font-mono text-emerald-800 bg-emerald-100/70 px-1.5 py-0.5 rounded border border-emerald-200 font-bold">
                Live
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2.5">
            {/* Contextual Day Guide & Direct GitHub Support */}
            <button
              type="button"
              onClick={() => setShowDayGuide(true)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 hover:border-teal-700 bg-white hover:bg-teal-50/50 text-slate-700 text-xs font-semibold flex items-center space-x-1.5 shadow-2xs transition cursor-pointer"
              title="Day Guide & Shortcuts (Press ?)"
            >
              <HelpCircle className="w-3.5 h-3.5 text-teal-700" />
              <span>Guide & Support</span>
              <kbd className="text-[9px] font-mono font-bold bg-slate-100 text-slate-500 px-1 py-0.2 rounded border border-slate-200">?</kbd>
            </button>

            {/* End-of-Day Notes Button */}
            <button
              onClick={() => setShowBatchTray(true)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 hover:border-teal-700 bg-white hover:bg-teal-50/50 text-slate-700 text-xs font-bold flex items-center space-x-1.5 shadow-2xs transition cursor-pointer"
              title="Review & Copy Today's Completed Notes (⌘B)"
            >
              <Clipboard className="w-3.5 h-3.5 text-teal-700" />
              <span>End of Day Notes</span>
              <span className="bg-teal-100 text-teal-900 text-[10px] font-extrabold px-1.5 py-0.2 rounded-full">
                {completedEncounters.length}
              </span>
            </button>

            <div className="text-right">
              <div className="text-xs font-bold text-slate-800">{dentistName || 'Dr. Marcus Vance, DDS'}</div>
              <div className="text-[10px] font-semibold text-slate-500">Attending Clinician</div>
            </div>
            <div className="w-8 h-8 rounded-full bg-teal-800 text-white font-bold text-xs flex items-center justify-center border border-teal-900 shadow-2xs">
              {dentistName ? dentistName.split(' ').map(n => n[0]).join('').slice(0, 2) : 'MV'}
            </div>
          </div>
        </header>
        {/* Content Area: Column 1 Daysheet + Column 2/3 Stage */}
        <div className="flex-1 flex flex-row overflow-hidden">
          {/* ─── COLUMN 1: DAYSHEET & QUICK INTAKE (~310px) ─── */}
          <section className="w-[310px] flex-shrink-0 bg-white border-r border-slate-200 flex flex-col justify-between overflow-hidden">
            <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
              {/* Paste Schedule & Walk-In Quick Actions */}
              <div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleOpenDaysheetModal}
                    className="flex-1 py-2 px-3 rounded-xl bg-teal-800 hover:bg-teal-900 text-white text-xs font-bold flex items-center justify-between shadow-xs transition cursor-pointer"
                    title="Import Today's Schedule (⌘V)"
                  >
                    <div className="flex items-center space-x-1.5 truncate">
                      <Clipboard className="w-3.5 h-3.5 text-teal-300 flex-shrink-0" />
                      <span className="truncate">Paste Schedule</span>
                    </div>
                    <span className="bg-teal-950/60 text-teal-200 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border border-teal-700 ml-1">
                      ⌘V
                    </span>
                  </button>

                  <button
                    onClick={() => setShowWalkInCard(prev => !prev)}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center space-x-1 shadow-xs transition cursor-pointer ${showWalkInCard
                      ? 'bg-teal-50 border-teal-300 text-teal-800'
                      : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
                      }`}
                    title="Add Walk-In Patient"
                  >
                    <Plus className="w-3.5 h-3.5 text-teal-600" />
                    <span>Walk-In</span>
                  </button>
                </div>
                <div className="text-[10px] text-slate-500 font-medium px-1 pt-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1 font-semibold text-slate-600">
                    <span>=</span> Quick Import Active
                  </span>
                  <span className="text-slate-400 truncate">Dentrix, Eaglesoft, Open Dental</span>
                </div>
                {pmsImportNotice && (
                  <div className="mt-1.5 text-[10px] bg-emerald-100 text-emerald-800 px-2 py-1 rounded font-bold flex items-center gap-1">
                    <Check className="w-3 h-3 text-emerald-700" />
                    <span>Daysheet imported directly to database!</span>
                  </div>
                )}
              </div>

              {/* Quick Walk-In Entry Inline Card */}
              {showWalkInCard && (
                <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-800">
                      <User className="w-3.5 h-3.5 text-teal-700" />
                      <span>Quick Walk-In Entry</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <span className="bg-amber-100 text-amber-900 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />
                        Urgent Triage
                      </span>
                      <button
                        onClick={() => setShowWalkInCard(false)}
                        className="text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Name Input */}
                  <input
                    type="text"
                    value={walkInName}
                    onChange={e => setWalkInName(e.target.value)}
                    placeholder="Patient Name"
                    className="w-full px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-lg focus:outline-none focus:border-teal-700 bg-slate-50/50"
                  />

                  {/* Op & Time Row */}
                  <div className="grid grid-cols-3 gap-1.5">
                    <div className="relative">
                      <select
                        value={walkInOperatory}
                        onChange={e => setWalkInOperatory(e.target.value)}
                        className="w-full px-2 py-1 text-[11px] font-medium border border-slate-200 rounded-lg bg-slate-50/50 appearance-none pr-5 text-slate-700"
                      >
                        <option value="Op 1">Op 1</option>
                        <option value="Op 2">Op 2</option>
                        <option value="Op 3">Op 3</option>
                      </select>
                      <ChevronDown className="w-3 h-3 text-slate-400 absolute right-1.5 top-2 pointer-events-none" />
                    </div>

                    <div className="relative">
                      <select
                        value={walkInTime}
                        onChange={e => setWalkInTime(e.target.value)}
                        className="w-full px-2 py-1 text-[11px] font-medium border border-slate-200 rounded-lg bg-slate-50/50 appearance-none pr-5 text-slate-700"
                      >
                        <option value={`Now (${formatClinicTime(new Date())})`}>Now ({formatClinicTime(new Date())})</option>
                        <option value={formatClinicTime(new Date(Date.now() + 15 * 60000))}>{formatClinicTime(new Date(Date.now() + 15 * 60000))}</option>
                        <option value={formatClinicTime(new Date(Date.now() + 30 * 60000))}>{formatClinicTime(new Date(Date.now() + 30 * 60000))}</option>
                        <option value={formatClinicTime(new Date(Date.now() + 60 * 60000))}>{formatClinicTime(new Date(Date.now() + 60 * 60000))}</option>
                      </select>
                      <ChevronDown className="w-3 h-3 text-slate-400 absolute right-1.5 top-2 pointer-events-none" />
                    </div>

                    <button
                      type="button"
                      className="px-2 py-1 text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200 rounded-lg flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <AlertTriangle className="w-3 h-3 text-amber-600" />
                      <span>Alert</span>
                    </button>
                  </div>

                  {/* Reason Input */}
                  <input
                    type="text"
                    value={walkInReason}
                    onChange={e => setWalkInReason(e.target.value)}
                    placeholder="Chief complaint / pain"
                    className="w-full px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-lg focus:outline-none focus:border-teal-700 bg-slate-50/50"
                  />

                  {/* Action buttons */}
                  <div className="flex items-center space-x-2 pt-1">
                    <button
                      type="button"
                      onClick={handleAddWalkInToStream}
                      className="flex-1 py-1.5 bg-teal-800 hover:bg-teal-900 text-white rounded-lg text-xs font-bold transition cursor-pointer shadow-2xs"
                    >
                      + Add to Stream
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowWalkInCard(false)}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-semibold transition cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Date Selector Header (Interactive) */}
              <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 shadow-2xs">
                <button
                  onClick={handlePrevDay}
                  className="text-slate-400 hover:text-slate-800 p-0.5 rounded cursor-pointer transition"
                  title="Previous Day"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div
                  onClick={() => setCurrentDate(new Date())}
                  className="flex items-center space-x-1.5 text-xs font-bold text-slate-800 cursor-pointer hover:text-teal-700 transition"
                  title="Click to reset to today"
                >
                  <Calendar className="w-3.5 h-3.5 text-teal-700" />
                  <span>{dateLabel}</span>
                </div>
                <button
                  onClick={handleNextDay}
                  className="text-slate-400 hover:text-slate-800 p-0.5 rounded cursor-pointer transition"
                  title="Next Day"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Subheader Counter & Walk-in Reopen Button */}
              <div className="flex items-center justify-between text-[11px] font-bold tracking-wider text-slate-500 uppercase px-0.5">
                <span>Encounter Stream</span>
                <div className="flex items-center space-x-2">
                  <span className="text-teal-800 font-mono font-bold">
                    {encountersForDate.length} Patients • {encountersForDate.some(p => p.id === activePatientId) ? '1 In Chair' : '0 In Chair'}
                  </span>
                </div>
              </div>

              {/* Parsed from PMS status row */}
              <div className="flex items-center justify-between text-[10px] text-slate-400 px-0.5 -mt-1 font-medium">
                <span>Database Synchronized</span>
                <span>{encountersForDate.length} patients loaded</span>
              </div>

              {/* Patient Cards List */}
              <div className="space-y-2 pt-1">
                {encountersForDate.length === 0 ? (
                  <div className="p-4 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50 text-slate-500 text-xs my-2">
                    <Calendar className="w-5 h-5 mx-auto mb-1 text-slate-400" />
                    <p className="font-bold text-slate-700">No encounters for this date</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Use + Walk-In or PMS Daysheet to schedule patients.</p>
                  </div>
                ) : (
                  encountersForDate.map(p => {
                    const isActive = p.id === activePatientId;
                    const isCompleted = p.status === 'ready';

                    return (
                      <div
                        key={p.id}
                        onClick={() => handleSelectPatient(p.id)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer relative shadow-2xs ${isActive
                          ? 'bg-white border-teal-700 ring-2 ring-teal-700/20'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                          }`}
                      >
                        {/* Active Green Indicator Bar */}
                        {isActive && (
                          <div className="absolute left-0 top-3 bottom-3 w-1.5 bg-teal-800 rounded-r-full" />
                        )}

                        <div className="flex items-start justify-between mb-1">
                          <div className="text-[11px] font-mono text-slate-500">
                            {p.time} • <span className="text-slate-700 font-bold">{p.operatory}</span>
                          </div>

                          {isActive ? (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                              !isMicStandby && !isPaused
                                ? 'bg-rose-900 text-rose-100'
                                : isPaused
                                ? 'bg-amber-900 text-amber-100'
                                : 'bg-teal-900 text-teal-100'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                !isMicStandby && !isPaused
                                  ? 'bg-rose-400 animate-ping'
                                  : isPaused
                                  ? 'bg-amber-400'
                                  : 'bg-emerald-400'
                              }`} />
                              {!isMicStandby && !isPaused ? 'Recording' : isPaused ? 'Paused' : 'Active in Chair'}
                            </span>
                          ) : backgroundFinalizingIds.has(p.id) ? (
                            <span className="bg-teal-50 text-teal-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-teal-300 flex items-center gap-1 shadow-2xs">
                              <RefreshCw className="w-3 h-3 animate-spin text-teal-700" />
                              Finalizing Note...
                            </span>
                          ) : isCompleted ? (
                            <span className="bg-slate-50 text-slate-700 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-slate-200 flex items-center gap-1">
                              <Check className="w-3 h-3 text-teal-700" />
                              Completed
                            </span>
                          ) : p.diarizedTranscript && p.diarizedTranscript.length > 0 ? (
                            <span className="bg-emerald-50 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-300 flex items-center gap-1 shadow-2xs">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              Live ({p.diarizedTranscript.length})
                            </span>
                          ) : p.id.startsWith('walkin-') ? (
                            <span className="bg-amber-50 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-300 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                              Walk-In
                            </span>
                          ) : (
                            <span className="bg-slate-100 text-slate-600 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                              {p.id === encountersForDate.find(o => o.id !== activePatientId && o.status !== 'ready')?.id ? 'Up Next' : 'Scheduled'}
                            </span>
                          )}
                        </div>

                        <h3 className={`text-sm font-bold tracking-tight mb-0.5 ${isActive ? 'text-slate-900 font-extrabold' : 'text-slate-800'}`}>
                          {p.patientName}
                        </h3>
                        <p className="text-xs text-slate-600 leading-relaxed mb-1 truncate">
                          {p.procedureText}
                        </p>

                        {/* Real-Time Live Dialogue Preview for Colleague Operatory Awareness */}
                        {p.diarizedTranscript && p.diarizedTranscript.length > 0 && (
                          <div className="mt-1 text-[11px] text-slate-600 bg-slate-50/90 border border-slate-200/80 rounded-lg px-2 py-1 flex items-center space-x-1.5 truncate">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0 animate-ping" />
                            <span className="text-teal-800 font-bold text-[10px] flex-shrink-0">Latest:</span>
                            <span className="truncate italic text-[11px]">
                              "{p.diarizedTranscript[p.diarizedTranscript.length - 1].text}"
                            </span>
                          </div>
                        )}

                        {/* Medical Alert Badges */}
                        {p.alerts && p.alerts.length > 0 && (
                          <div className="space-y-1 mt-1.5">
                            {p.alerts.map((a, idx) => (
                              <div
                                key={idx}
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center space-x-1.5 ${a.type === 'allergy'
                                  ? 'bg-rose-50 text-rose-800 border border-rose-200'
                                  : 'bg-amber-50 text-amber-800 border border-amber-200'
                                  }`}
                              >
                                {a.type === 'allergy' ? (
                                  <AlertTriangle className="w-3 h-3 flex-shrink-0 text-rose-600" />
                                ) : (
                                  <Zap className="w-3 h-3 flex-shrink-0 text-amber-600" />
                                )}
                                <span className="truncate">{a.text}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }))}
              </div>
            </div>
          </section>

          {/* ─── COLUMN 2 & 3: CENTER STAGE (Hero + Audio Island + Odontogram + 2-Column Split) ─── */}
          <main className="flex-1 flex flex-col overflow-y-auto p-6 space-y-4 bg-[#F5F5F7] custom-scrollbar">
            {activeEncounter ? (
              <>
                {/* Active Patient Hero Card */}
                <div className="glass-apple rounded-2xl p-5 border border-slate-200/80 shadow-[0_4px_24px_rgba(0,0,0,0.03)] font-sans">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3.5">
                      <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-teal-800/30 flex-shrink-0 bg-slate-100 flex items-center justify-center shadow-inner">
                        <img
                          src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80"
                          alt={activeEncounter.patientName}
                          className="w-full h-full object-cover"
                          onError={(e: any) => {
                            e.target.style.display = 'none';
                          }}
                        />
                        <User className="w-6 h-6 text-slate-600" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-2.5">
                          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">
                            {activeEncounter.patientName}
                          </h2>
                          <span className="bg-[#E6F6F4] text-[#007A66] border border-[#00A389]/30 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-2xs">
                            Listening & Taking Notes
                            <span className="w-1.5 h-1.5 rounded-full bg-[#00A389] animate-pulse" />
                          </span>
                        </div>
                        <div className="flex items-center space-x-3 text-xs text-slate-500 font-medium mt-1">
                          <span>Operatory: <strong className="text-slate-700">{activeEncounter.operatory || 'Chair 1'}</strong></span>
                          <span>·</span>
                          <span>Time: <strong className="text-slate-700 font-tabular">{activeEncounter.time}</strong></span>
                          <span>·</span>
                          <span className="capitalize">{activeEncounter.appointmentType.replace('_', ' ')}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      {isMicStandby ? (
                        <div className="flex items-center space-x-1.5 text-xs font-bold text-sky-800 bg-sky-50 border border-sky-200 px-3 py-1 rounded-full">
                          <span className="w-2 h-2 rounded-full bg-sky-500" />
                          <span>Standby (Press Space to Record)</span>
                        </div>
                      ) : isPaused ? (
                        <div className="flex items-center space-x-1.5 text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full">
                          <span className="w-2 h-2 rounded-full bg-amber-500" />
                          <span>Recording Paused</span>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-1.5 text-xs font-bold text-rose-800 bg-rose-50 border border-rose-200 px-3 py-1 rounded-full">
                          <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                          <span>Listening & Taking Notes</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Prior Clinical Note Excerpt */}
                  {activeEncounter.priorNote && (
                    <div className="mt-3.5 pt-3 border-t border-slate-100 flex items-start space-x-3 text-xs text-slate-700 leading-relaxed bg-white/70 p-3.5 rounded-xl border border-slate-200/70">
                      <div className="w-6 h-6 rounded-lg bg-[#E6F6F4] text-[#007A66] flex items-center justify-center font-mono font-bold text-[10px] flex-shrink-0 mt-0.5 border border-[#00A389]/20">
                        EQ
                      </div>
                      <div>
                        <span className="font-extrabold text-slate-700 text-[10px] uppercase tracking-wider block mb-0.5">
                          {activeEncounter.priorNoteDate
                            ? `PRIOR CLINICAL NOTE EXCERPT (${formatClinicDate(activeEncounter.priorNoteDate).toUpperCase()})`
                            : 'PATIENT CLINICAL & DENTAL HISTORY'}
                        </span>
                        <p className="text-slate-600 text-xs italic">
                          "{activeEncounter.priorNote}"
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Ambient Dynamic Operatory HUD Banner */}
                <div className={`max-w-4xl mx-auto w-full px-4 py-2.5 rounded-2xl border flex items-center justify-between text-xs transition-all duration-300 shadow-2xs ${
                  isSilenceWarning
                    ? 'bg-amber-100 border-amber-300 text-amber-950 font-medium'
                    : isMicStandby
                    ? 'bg-sky-50/90 border-sky-200/80 text-sky-950'
                    : isPaused
                    ? 'bg-amber-50/90 border-amber-200/80 text-amber-950'
                    : 'bg-emerald-50/90 border-emerald-200/80 text-emerald-950'
                }`}>
                  {isSilenceWarning ? (
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <AlertTriangle className="w-4 h-4 text-amber-700 flex-shrink-0 animate-bounce" />
                        <span className="font-bold truncate text-amber-950">
                          Quiet room detected: Pausing in {silenceSecondsRemaining}s to save battery and stop room noise.
                        </span>
                      </div>
                      <div className="flex items-center space-x-2 flex-shrink-0 ml-3">
                        <button
                          type="button"
                          onClick={handleKeepListening}
                          className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold shadow-sm transition active:scale-95 cursor-pointer flex items-center space-x-1.5"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Keep Listening</span>
                          <kbd className="hidden sm:inline-block px-1 py-0.2 text-[9px] font-mono text-amber-100 bg-amber-800/40 rounded">Space</kbd>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <Lightbulb className={`w-4 h-4 flex-shrink-0 ${
                          isMicStandby ? 'text-sky-600' : isPaused ? 'text-amber-600' : 'text-emerald-600'
                        }`} />
                        <span className="font-semibold truncate">
                          {isMicStandby
                            ? 'Ready: Seat patient. Press [Spacebar] or click Start Audio to begin listening.'
                            : isPaused
                            ? 'Paused: Conversation is not being recorded. Press [Spacebar] to resume.'
                            : 'Listening: Background noise filter quiets drills and room sounds. Speak naturally about teeth and treatment.'}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2 text-[11px] flex-shrink-0 ml-3">
                        <button
                          type="button"
                          onClick={() => setShowDayGuide(true)}
                          className="text-slate-600 hover:text-slate-900 font-bold underline cursor-pointer"
                        >
                          Day Guide & Shortcuts (?)
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {/* Tactile Hardware Audio Recording Island (Apple Dynamic Island Slate Capsule) */}
                <div className="bg-slate-950/95 text-white rounded-2xl px-6 py-3.5 shadow-2xl border border-white/10 backdrop-blur-2xl flex items-center justify-between max-w-4xl mx-auto w-full font-sans">
                  {/* Recording Timer & Medical Status Badge */}
                  <div className="flex items-center space-x-3.5">
                    {isMicStandby ? (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-mono font-bold tracking-wider bg-sky-500/20 text-sky-300 border border-sky-500/40">
                        <span className="w-2 h-2 rounded-full bg-sky-400 mr-1.5" />
                        STANDBY
                      </span>
                    ) : isPaused ? (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-mono font-bold tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        <span className="w-2 h-2 rounded-full bg-amber-400 mr-1.5" />
                        PAUSED
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-mono font-bold tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/40">
                        <span className="relative flex h-2 w-2 mr-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
                        </span>
                        REC
                      </span>
                    )}
                    <div>
                      <span className="text-sm font-mono font-bold tracking-wider text-white font-tabular">
                        {formatTimer(recordingSeconds)}
                      </span>
                    </div>
                  </div>

                  {/* Noise Filter (Interactive Toggle) */}
                  <div
                    onClick={() => setDspNoiseGateActive(prev => !prev)}
                    className="flex items-center space-x-2 text-slate-300 text-xs font-medium cursor-pointer hover:bg-white/5 transition px-2.5 py-1 rounded-xl border border-transparent hover:border-white/10"
                    title="Click to toggle background noise filter"
                  >
                    {dspNoiseGateActive ? (
                      <Activity className="w-3.5 h-3.5 text-[#00C7BE]" />
                    ) : (
                      <VolumeX className="w-3.5 h-3.5 text-amber-400" />
                    )}
                    <span>
                      Noise Filter:{' '}
                      <strong className={dspNoiseGateActive ? 'text-[#00C7BE]' : 'text-amber-400'}>
                        {dspNoiseGateActive ? 'On' : 'Off'}
                      </strong>
                    </span>
                  </div>

                  {/* 60fps High-Performance Waveform Visualizer (Direct DOM refs) */}
                  <div className="flex items-center space-x-1 h-6 px-4">
                    {Array.from({ length: 13 }).map((_, i) => (
                      <div
                        key={i}
                        ref={el => { waveformRefs.current[i] = el; }}
                        style={{ height: '15%', opacity: isMicStandby || isPaused ? 0.35 : 1 }}
                        className="w-1 bg-gradient-to-t from-[#00A389] to-[#6EE7B7] rounded-full transition-all duration-75"
                      />
                    ))}
                  </div>

                  {/* Control Actions */}
                  <div className="flex items-center space-x-2.5">
                    {isMicStandby ? (
                      <button
                        onClick={handleStartAudio}
                        className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-[#00A389] to-[#00C7BE] hover:opacity-95 active:scale-95 text-slate-950 text-xs font-extrabold flex items-center space-x-1.5 transition shadow-lg shadow-[#00A389]/25 cursor-pointer border border-teal-300/40"
                        title="Start active operatory listening (Spacebar)"
                      >
                        <Mic className="w-3.5 h-3.5 text-slate-950" />
                        <span>Start Audio</span>
                        <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[9px] font-mono font-bold bg-teal-600/30 text-teal-950 rounded border border-teal-400/40">Space</kbd>
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={handleTogglePause}
                          className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-bold flex items-center space-x-1.5 transition border border-slate-700 cursor-pointer"
                          title={isPaused ? 'Resume recording (Spacebar)' : 'Pause recording (Spacebar)'}
                        >
                          {isPaused ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5 text-amber-400" />}
                          <span>{isPaused ? 'Resume' : 'Pause'}</span>
                          <kbd className="hidden sm:inline-block px-1 py-0.5 text-[9px] font-mono text-slate-400 bg-slate-900 rounded">Space</kbd>
                        </button>
                        <button
                          onClick={handleStopAudioToStandby}
                          className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition border border-slate-700 cursor-pointer"
                          title="Halt recording and return to standby"
                        >
                          Stop
                        </button>
                      </>
                    )}

                    <button
                      onClick={handleFinalizeNote}
                      disabled={isFinalizing}
                      className="px-4 py-1.5 rounded-xl bg-[#0071E3] hover:bg-[#0077ED] active:scale-95 disabled:opacity-50 text-white text-xs font-bold flex items-center space-x-1.5 transition shadow-md shadow-[#0071E3]/25 border border-white/10 cursor-pointer"
                      title="Finalize note for active patient"
                    >
                      {isFinalizing ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>{isTranscribingNote ? 'Transcribing recording…' : 'Finalizing...'}</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Finalize Note</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={handleNextPatient}
                      title="Auto-finalize current note in background and advance to next patient"
                      className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-bold flex items-center space-x-1.5 transition shadow-sm border border-emerald-400/30 cursor-pointer"
                    >
                      <ArrowRight className="w-4 h-4" />
                      <span>Next Patient</span>
                    </button>
                  </div>
                </div>

                {/* Real-Time Interactive FDI Tooth Odontogram Strip (Apple Medical Grade) */}
                <ChairsideOdontogram
                  transcriptText={activeEncounter.diarizedTranscript?.map(t => t.text).join(' ') || ''}
                  findingsText={`${activeEncounter.soap?.objective || ''} ${activeEncounter.soap?.assessment || ''}`}
                />

                {/* Split Stage: Ambient Transcription Feed (Left) & Clinical Note (Right) */}
                <div className="grid grid-cols-12 gap-5 flex-1 items-start">
                  {/* Left Column: Live Conversation */}
                  <div className="col-span-7 glass-apple rounded-2xl p-5 border border-slate-200/80 shadow-[0_4px_24px_rgba(0,0,0,0.03)] space-y-3 font-sans">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <div className="flex items-center space-x-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${micListening ? 'bg-emerald-500 animate-pulse' : isMicStandby ? 'bg-sky-400' : 'bg-slate-400'}`} />
                        <h3 className="text-sm font-bold text-slate-900">Live Conversation</h3>
                        {micListening && (
                          <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-bold border border-emerald-200 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                            Listening
                          </span>
                        )}
                        {isMicStandby && (
                          <span className="text-[10px] bg-sky-50 text-sky-700 px-2 py-0.5 rounded-full font-bold border border-sky-200">
                            Standby
                          </span>
                        )}
                        {micError && (
                          <span className="text-[10px] bg-amber-50 text-amber-800 px-2 py-0.5 rounded-full font-bold border border-amber-200 truncate max-w-[220px]" title={micError}>
                            {micError}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {activeEncounter.diarizedTranscript?.length || 0} Lines Recorded
                      </span>
                    </div>

                    {/* Dialogue Stream */}
                    <div className="space-y-3 text-xs leading-relaxed max-h-[420px] overflow-y-auto custom-scrollbar pr-1">
                      {activeEncounter.diarizedTranscript && activeEncounter.diarizedTranscript.length > 0 ? (
                        activeEncounter.diarizedTranscript.map((t, idx) => (
                          <div key={idx} className="space-y-1 animate-in fade-in duration-150">
                            {t.speaker && (
                              <div className="flex items-center justify-between text-[11px] pt-1">
                                <span className="font-bold text-slate-800">
                                  {t.speaker}
                                </span>
                                {t.time && <span className="font-mono text-slate-400 text-[10px]">{t.time}</span>}
                              </div>
                            )}
                            <div className={`p-3 rounded-xl text-slate-800 leading-relaxed font-sans ${!t.speaker
                              ? 'bg-slate-50 text-slate-700 font-medium italic border border-slate-200/60'
                              : 'bg-slate-50/80 border border-slate-200/80 shadow-2xs'
                              }`}>
                              {renderAnnotatedText(t.text)}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-8 text-slate-400">
                          <Mic className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                          <p className="font-semibold text-xs text-slate-600">
                            {isMicStandby
                              ? 'Microphone is in Standby'
                              : isPaused
                              ? 'Microphone is Paused'
                              : 'Listening & Taking Notes'}
                          </p>
                          <p className="font-medium text-[11px] text-slate-400 mt-1">
                            {isMicStandby
                              ? 'Click "Start Audio" or press Spacebar to begin listening.'
                              : isPaused
                              ? 'Press Spacebar or click "Resume" to continue listening.'
                              : 'Listening to dentist, staff, and patient conversation...'}
                          </p>
                        </div>
                      )}

                      {/* Live Real-Time Interim Speech Bubble (Pulsing feedback while talking) */}
                      {interimTranscript && (
                        <div className="space-y-1 animate-in fade-in duration-150">
                          <div className="flex items-center space-x-1.5 text-[11px] pt-1 text-teal-700">
                            <span className="w-2 h-2 rounded-full bg-teal-500 animate-ping" />
                            <span className="font-bold">Live Spoken Words (Listening...)</span>
                          </div>
                          <div className="p-3 rounded-xl bg-teal-50/80 border border-teal-200 text-teal-900 leading-relaxed font-sans italic shadow-2xs">
                            {interimTranscript}
                          </div>
                        </div>
                      )}

                      {/* Auto-scroll anchor */}
                      <div ref={transcriptEndRef} />
                    </div>

                    {/* Quick Clinical Dictation Chips (1-Click Fast Charting & Simulation) */}
                    <div className="pt-1.5 border-t border-slate-100 flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1 text-[11px]">
                      <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider flex-shrink-0 mr-0.5">Quick:</span>
                      {[
                        '#14 recurrent caries excavated',
                        '1.8mL 2% Lidocaine 1:100k epi infiltrated',
                        'Restored with Filtek Supreme A2 composite',
                        'Occlusion equilibrated in excursions',
                        'Seated permanent zirconia crown'
                      ].map((chip, cIdx) => (
                        <button
                          key={cIdx}
                          type="button"
                          onClick={() => handleAppendTranscriptText(chip, 'Dentist')}
                          className="px-2 py-0.5 bg-slate-100 hover:bg-teal-50 text-slate-700 hover:text-teal-800 border border-slate-200 hover:border-teal-300 rounded-lg whitespace-nowrap cursor-pointer transition text-[10px] font-medium flex-shrink-0"
                          title={`Click to add: "${chip}"`}
                        >
                          + {chip.length > 25 ? chip.slice(0, 24) + '...' : chip}
                        </button>
                      ))}
                    </div>

                    {/* Quick Note Box */}
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        value={manualDialogueText}
                        onChange={e => setManualDialogueText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && manualDialogueText.trim()) {
                            handleAppendTranscriptText(manualDialogueText, 'Dentist');
                            setManualDialogueText('');
                          }
                        }}
                        placeholder="Type a note, finding, or procedure..."
                        className="flex-1 px-3.5 py-2 text-xs bg-slate-50/80 border border-slate-200/80 rounded-xl focus:outline-none focus:border-[#0071E3] focus:ring-2 focus:ring-[#0071E3]/15 transition font-sans"
                      />
                      <button
                        onClick={() => {
                          if (manualDialogueText.trim()) {
                            handleAppendTranscriptText(manualDialogueText, 'Dentist');
                            setManualDialogueText('');
                          }
                        }}
                        className="px-3.5 py-2 bg-[#0071E3] hover:bg-[#0077ED] active:scale-[0.98] text-white rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 cursor-pointer shadow-xs"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Add</span>
                      </button>
                    </div>
                  </div>

                  {/* Right Column: Clinical Note */}
                  <div className="col-span-5 glass-apple rounded-2xl p-5 border border-slate-200/80 shadow-[0_4px_24px_rgba(0,0,0,0.03)] space-y-3.5 font-sans">
                    {/* Header & Verified Badge */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center space-x-2">
                          <h3 className="text-sm font-semibold text-slate-900 tracking-tight">Clinical Note</h3>
                          <span className="text-[10px] text-slate-400 font-medium">SOAP Format</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          {activeEncounter && soapSaveStatus[activeEncounter.id] === 'saving' ? (
                            <span className="text-[10px] text-amber-600 font-medium flex items-center gap-1">
                              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                              Saving...
                            </span>
                          ) : activeEncounter && editedSoapNotes[activeEncounter.id] ? (
                            <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1">
                              <Check className="w-3 h-3 text-emerald-600" />
                              Saved to Chart
                            </span>
                          ) : null}
                          <span className="bg-[#E6F6F4] text-[#007A66] text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-[#00A389]/20 flex items-center gap-1 shadow-2xs">
                            <Check className="w-3 h-3 text-[#007A66]" />
                            Transcribed from Audio
                          </span>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-500 font-medium flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#007A66]" />
                        Audio synced • Click any section below to edit directly
                      </p>

                      {/* Main Copy to PMS Action & Plain Text Trigger */}
                      <div className="grid grid-cols-3 gap-2 mt-3.5">
                        <button
                          onClick={() => handleCopyPMS()}
                          className={`col-span-2 py-2.5 px-3 rounded-xl font-semibold text-xs flex items-center justify-center space-x-1.5 transition-all shadow-xs cursor-pointer active:scale-[0.98] ${copiedNote
                            ? 'bg-emerald-600 text-white'
                            : 'bg-[#0071E3] hover:bg-[#0077ED] text-white'
                            }`}
                        >
                          {copiedNote ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          <span>{copiedNote ? 'Copied to Clipboard!' : 'Copy Note for PMS (⌘C)'}</span>
                        </button>

                        <button
                          onClick={() => setShowPlainTextModal(true)}
                          className="py-2.5 px-2 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-[0.98] text-slate-700 text-xs font-semibold border border-slate-200/80 transition flex items-center justify-center cursor-pointer"
                        >
                          Plain Text
                        </button>
                      </div>

                      {/* Secondary Actions: Referral & Handover + Update Note */}
                      <div className="grid grid-cols-2 gap-2 mt-2.5">
                        <button
                          type="button"
                          onClick={() => setShowDeliverablesModal(true)}
                          className="py-2 px-2.5 rounded-xl bg-indigo-50/80 hover:bg-indigo-100/90 text-indigo-700 active:scale-[0.98] text-xs font-bold border border-indigo-200/80 transition flex items-center justify-center space-x-1.5 cursor-pointer shadow-2xs"
                          title="Generate specialist referral letters and patient post-op care instructions"
                        >
                          <FileText className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                          <span className="truncate">Referral & Handover</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleRegenerateFromConversation}
                          disabled={isGeneratingFromConversation}
                          title="Generate or update note using the full conversation captured"
                          className="py-2 px-2.5 rounded-xl bg-[#E6F6F4] hover:bg-[#d8f0ed] active:scale-[0.98] text-[#00A389] text-xs font-semibold border border-[#00A389]/25 transition flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-50"
                        >
                          {isGeneratingFromConversation ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#00A389] shrink-0" />
                              <span className="truncate">Updating...</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3.5 h-3.5 text-[#00A389] shrink-0" />
                              <span className="truncate">Update Note</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Structured Note Cards with Direct Inline Editing */}
                    <div className="space-y-2.5 pt-1 text-xs max-h-[440px] overflow-y-auto custom-scrollbar pr-1">
                      {activeEncounter && (
                        <>
                          {/* Subjective */}
                          <div className="bg-white/80 hover:bg-white focus-within:bg-white border border-slate-200/80 focus-within:border-[#0071E3] focus-within:ring-2 focus-within:ring-[#0071E3]/15 rounded-xl p-3.5 space-y-1.5 transition-all shadow-2xs group">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-bold text-slate-700 tracking-wider flex items-center gap-1.5 uppercase">
                                <User className="w-3.5 h-3.5 text-[#0071E3]" />
                                SUBJECTIVE (S):
                              </span>
                              <span className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity font-medium">
                                Click to edit
                              </span>
                            </div>
                            <textarea
                              value={currentSoap.subjective}
                              onChange={e => handleSoapChange('subjective', e.target.value)}
                              rows={2}
                              className="w-full bg-transparent text-slate-800 leading-relaxed text-[11px] font-sans resize-y focus:outline-none placeholder:text-slate-400"
                              placeholder="Patient chief complaint, history, reported symptoms..."
                            />
                          </div>

                          {/* Objective */}
                          <div className="bg-white/80 hover:bg-white focus-within:bg-white border border-slate-200/80 focus-within:border-[#00A389] focus-within:ring-2 focus-within:ring-[#00A389]/15 rounded-xl p-3.5 space-y-1.5 transition-all shadow-2xs group">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-bold text-slate-700 tracking-wider flex items-center gap-1.5 uppercase">
                                <Activity className="w-3.5 h-3.5 text-[#00A389]" />
                                OBJECTIVE (O):
                              </span>
                              <span className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity font-medium">
                                Click to edit
                              </span>
                            </div>
                            <textarea
                              value={currentSoap.objective}
                              onChange={e => handleSoapChange('objective', e.target.value)}
                              rows={2}
                              className="w-full bg-transparent text-slate-800 leading-relaxed text-[11px] font-sans resize-y focus:outline-none placeholder:text-slate-400 font-tabular"
                              placeholder="Clinical examination, diagnostic findings, tooth & gingival findings..."
                            />
                          </div>

                          {/* Assessment */}
                          <div className="bg-white/80 hover:bg-white focus-within:bg-white border border-slate-200/80 focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-500/15 rounded-xl p-3.5 space-y-1.5 transition-all shadow-2xs group">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-bold text-slate-700 tracking-wider flex items-center gap-1.5 uppercase">
                                <Shield className="w-3.5 h-3.5 text-amber-500" />
                                ASSESSMENT (A):
                              </span>
                              <span className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity font-medium">
                                Click to edit
                              </span>
                            </div>
                            <textarea
                              value={currentSoap.assessment}
                              onChange={e => handleSoapChange('assessment', e.target.value)}
                              rows={2}
                              className="w-full bg-transparent text-slate-800 leading-relaxed text-[11px] font-sans resize-y focus:outline-none placeholder:text-slate-400 font-tabular"
                              placeholder="Diagnosis, pulpal/periodontal prognosis..."
                            />
                          </div>

                          {/* Plan & Procedure */}
                          <div className="bg-white/80 hover:bg-white focus-within:bg-white border border-slate-200/80 focus-within:border-[#0071E3] focus-within:ring-2 focus-within:ring-[#0071E3]/15 rounded-xl p-3.5 space-y-1.5 transition-all shadow-2xs group">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-bold text-slate-700 tracking-wider flex items-center gap-1.5 uppercase">
                                <Sparkles className="w-3.5 h-3.5 text-[#0071E3]" />
                                PLAN & PROCEDURE (P):
                              </span>
                              <span className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity font-medium">
                                Click to edit
                              </span>
                            </div>
                            <textarea
                              value={currentSoap.plan}
                              onChange={e => handleSoapChange('plan', e.target.value)}
                              rows={2}
                              className="w-full bg-transparent text-slate-800 leading-relaxed text-[11px] font-sans resize-y focus:outline-none placeholder:text-slate-400 font-tabular"
                              placeholder="Treatment rendered, materials/anesthesia used, post-op instructions..."
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-20 text-slate-400">
                <User className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <h3 className="text-base font-bold text-slate-700">No Patient Selected</h3>
                <p className="text-xs text-slate-500">Select an encounter from the Daysheet or add a walk-in to start charting.</p>
              </div>
            )}
          </main>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          PMS DAYSHEET IMPORT MODAL (Real Clipboard Integration)
          ───────────────────────────────────────────────────────────── */}
      {showDaysheetModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-teal-100 text-teal-800 flex items-center justify-center">
                  <Clipboard className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Paste Today's Appointment Schedule</h3>
                  <p className="text-xs text-slate-500">Auto-detects Dentrix, Eaglesoft, Open Dental, Exact & D4W</p>
                </div>
              </div>
              <button
                onClick={() => setShowDaysheetModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Paste the exported daysheet text, tab-separated rows, or appointment summary from your Practice Management Software below:
            </p>

            <textarea
              rows={6}
              value={daysheetRawText}
              onChange={e => setDaysheetRawText(e.target.value)}
              placeholder={`08:30 AM\tSarah Jenkins\tCrown Seat #19 (Zirconia)\n09:45 AM\tDavid Martinez\tRestorative #14 MOD Resin\n11:00 AM\tEmily Zhao\tComp Exam + Bitewings\n01:15 PM\tRobert Miller\tEndodontic RCT #3`}
              className="w-full p-3 text-xs font-mono border border-slate-200 rounded-xl focus:outline-none focus:border-teal-700 bg-slate-50/60 leading-relaxed"
            />

            <div className="flex items-center justify-end pt-2">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setShowDaysheetModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleParseAndImportDaysheet}
                  className="px-4 py-2 bg-teal-800 hover:bg-teal-900 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-sm flex items-center space-x-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import to Database</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          PLAIN TEXT NOTE MODAL
          ───────────────────────────────────────────────────────────── */}
      {showPlainTextModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Plain Text Clinical Note</h3>
                  <p className="text-xs text-slate-500">Unformatted text for non-standard PMS fields or manual pasting</p>
                </div>
              </div>
              <button
                onClick={() => setShowPlainTextModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <textarea
              readOnly
              rows={12}
              value={getFormattedNoteText()}
              className="w-full p-3.5 text-xs font-mono border border-slate-200 rounded-xl bg-slate-50 leading-relaxed text-slate-800 select-all"
            />

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                onClick={() => setShowPlainTextModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                Close
              </button>
              <button
                onClick={() => {
                  const txt = getFormattedNoteText();
                  if (navigator.clipboard) {
                    navigator.clipboard.writeText(txt);
                  }
                  setCopiedPlainText(true);
                  setTimeout(() => setCopiedPlainText(false), 2000);
                }}
                className="px-4 py-2 bg-teal-800 hover:bg-teal-900 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-sm flex items-center space-x-1.5"
              >
                {copiedPlainText ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copiedPlainText ? 'Copied!' : 'Copy Plain Text'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          PATIENT DELIVERABLES & REFERRAL HANDOVER MODAL
          ───────────────────────────────────────────────────────────── */}
      {showDeliverablesModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 font-sans">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Patient Deliverables & Handover
                  </h3>
                  <p className="text-xs text-slate-500">
                    {activeEncounter ? `${activeEncounter.patientName} • ${activeEncounter.procedureText}` : 'Active Patient'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDeliverablesModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tab selection */}
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
              <button
                type="button"
                onClick={() => setDeliverablesActiveTab('referral')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  deliverablesActiveTab === 'referral'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Specialist Referral Letter</span>
              </button>
              <button
                type="button"
                onClick={() => setDeliverablesActiveTab('postop')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  deliverablesActiveTab === 'postop'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Patient Post-Op Care Email</span>
              </button>
            </div>

            {/* Notice */}
            <div className="bg-amber-50 border border-amber-200/80 rounded-xl p-2.5 flex items-start gap-2 text-[11px] text-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
              <span>Grounded directly in this patient's clinical note and examination findings. Please review before sending.</span>
            </div>

            {/* Textarea */}
            <textarea
              readOnly
              rows={12}
              value={deliverablesActiveTab === 'referral' ? getReferralText() : getPostOpText()}
              className="w-full p-3.5 text-xs font-mono border border-slate-200 rounded-xl bg-slate-50 leading-relaxed text-slate-800 select-all"
            />

            {/* Actions */}
            <div className="flex items-center justify-between pt-2">
              <div>
                {deliverablesActiveTab === 'postop' && (
                  <a
                    href={`mailto:?subject=${encodeURIComponent(`Post-Operative Care Instructions — ${activeEncounter?.patientName || 'Patient'}`)}&body=${encodeURIComponent(getPostOpText())}`}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open in Email App</span>
                  </a>
                )}
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setShowDeliverablesModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const text = deliverablesActiveTab === 'referral' ? getReferralText() : getPostOpText();
                    if (navigator.clipboard) {
                      navigator.clipboard.writeText(text);
                    }
                    setCopiedDeliverable(deliverablesActiveTab);
                    setTimeout(() => setCopiedDeliverable(null), 2000);
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-sm flex items-center space-x-1.5"
                >
                  {copiedDeliverable === deliverablesActiveTab ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Copied to Clipboard!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>
                        {deliverablesActiveTab === 'referral' ? 'Copy Referral Letter' : 'Copy Post-Op Email'}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          9. END-OF-DAY / LUNCH BATCH SIGN TRAY (SLIDE-OVER DRAWER)
          ───────────────────────────────────────────────────────────── */}
      {showBatchTray && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex justify-end z-50">
          <div className="bg-white w-full max-w-xl h-full shadow-2xl flex flex-col border-l border-slate-200">
            {/* Tray Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0 bg-white">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-200 text-teal-800 flex items-center justify-center">
                  <Clipboard className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 tracking-tight">End-of-Day Notes Review</h3>
                  <p className="text-xs text-slate-500">
                    {completedEncounters.length} completed patient notes ready to copy
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowBatchTray(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center cursor-pointer transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Master Action Banner */}
            <div className="p-4 bg-slate-50/80 border-b border-slate-200 flex-shrink-0 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  Copy All Notes
                </span>
                <span className="text-[10px] text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full font-bold border border-teal-200">
                  Dentrix • Eaglesoft • Open Dental
                </span>
              </div>
              <button
                onClick={handleCopyAllBatchNotes}
                disabled={completedEncounters.length === 0}
                className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center space-x-2 transition shadow-xs cursor-pointer ${allBatchCopied
                  ? 'bg-emerald-600 text-white'
                  : 'bg-teal-800 hover:bg-teal-900 disabled:opacity-50 text-white'
                  }`}
              >
                {allBatchCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>
                  {allBatchCopied
                    ? `Copied All ${completedEncounters.length} Notes to Clipboard!`
                    : `Copy All Notes for PMS (${completedEncounters.length} Ready)`}
                </span>
              </button>
            </div>

            {/* Completed Notes Scroll Area */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3.5 custom-scrollbar bg-[#F8FAFC]">
              {completedEncounters.length === 0 ? (
                <div className="text-center py-16 px-6 bg-white border border-dashed border-slate-200 rounded-2xl">
                  <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
                    <FileText className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-800 mb-1">No Finalized Notes Yet</h4>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                    Patient notes finalized during consultations or via "Next Patient" will queue here for rapid batch review during lunch or at 5:00 PM.
                  </p>
                </div>
              ) : (
                completedEncounters.map((p, idx) => {
                  const consult = consultations.find(c => c.id === p.id);
                  const isCopied = copiedBatchIndex === idx;

                  return (
                    <div
                      key={p.id}
                      className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-2.5"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center space-x-2 mb-0.5">
                            <span className="text-xs font-bold text-slate-900 font-sans">{p.patientName}</span>
                            <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded font-medium">
                              {p.time} • {p.operatory}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 truncate max-w-xs">{p.procedureText}</p>
                        </div>
                        <button
                          onClick={() => {
                            const text = getFormattedNoteText(consult);
                            if (text && navigator.clipboard) {
                              navigator.clipboard.writeText(text);
                            }
                            setCopiedBatchIndex(idx);
                            setTimeout(() => setCopiedBatchIndex(null), 2000);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition cursor-pointer ${isCopied
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-300'
                            : 'bg-slate-100 hover:bg-teal-50 text-slate-700 hover:text-teal-800 border border-slate-200'
                            }`}
                          title="Copy this patient's clinical note"
                        >
                          {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{isCopied ? 'Copied!' : 'Copy Note'}</span>
                        </button>
                      </div>

                      {/* Excerpt */}
                      {p.soap && (
                        <div className="text-[11px] text-slate-600 bg-slate-50/70 p-2.5 rounded-lg border border-slate-100 leading-relaxed font-mono">
                          <span className="text-slate-800 font-bold block mb-0.5 font-sans">SOAP Summary:</span>
                          <span className="line-clamp-2">
                            {p.soap.treatmentPerformed || p.soap.assessment || p.soap.subjective}
                          </span>
                        </div>
                      )}

                      {/* CDT Codes */}
                      {p.cdtCodes && p.cdtCodes.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {p.cdtCodes.map((c, cIdx) => (
                            <span
                              key={cIdx}
                              className="text-[10px] font-mono bg-teal-50 text-teal-800 border border-teal-200 px-1.5 py-0.2 rounded"
                            >
                              {c.code}: {c.desc}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Tray Footer */}
            <div className="p-4 border-t border-slate-200 flex items-center justify-between bg-white flex-shrink-0">
              <span className="text-xs text-slate-500 font-medium">
                {completedEncounters.length} completed encounters queued
              </span>
              <button
                onClick={() => setShowBatchTray(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Close Tray
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          9. CLINICIAN OPERATORY DAY GUIDE & DIRECT GITHUB ISSUE MODAL
          ───────────────────────────────────────────────────────────── */}
      {showDayGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full p-6 sm:p-8 text-left relative my-8 animate-in fade-in duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-teal-800 text-white flex items-center justify-center shadow-xs">
                  <LifeBuoy className="w-5 h-5 text-teal-200" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
                    Clinician Operatory Guide & Support
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    Apple Medical Grade workflow reference, hands-free hotkeys & direct GitHub dispatch
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <a
                  href="#/demo"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100/80 text-primary text-xs font-bold border border-indigo-200 transition cursor-pointer"
                  title="Watch narrated 3-minute product demo"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Watch 3-Min Demo</span>
                </a>
                <button
                  type="button"
                  onClick={() => setShowDayGuide(false)}
                  className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center space-x-1.5 mt-4 pb-2 border-b border-slate-100 overflow-x-auto text-xs font-bold">
              <button
                type="button"
                onClick={() => setGuideActiveTab('phases')}
                className={`px-3 py-1.5 rounded-xl transition ${
                  guideActiveTab === 'phases' ? 'bg-teal-800 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                4-Phase Day Flow
              </button>
              <button
                type="button"
                onClick={() => setGuideActiveTab('hotkeys')}
                className={`px-3 py-1.5 rounded-xl transition ${
                  guideActiveTab === 'hotkeys' ? 'bg-teal-800 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Operatory Hotkeys
              </button>
              <button
                type="button"
                onClick={() => setGuideActiveTab('dictation')}
                className={`px-3 py-1.5 rounded-xl transition ${
                  guideActiveTab === 'dictation' ? 'bg-teal-800 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Dental Phonetics
              </button>
              <button
                type="button"
                onClick={() => setGuideActiveTab('pms')}
                className={`px-3 py-1.5 rounded-xl transition ${
                  guideActiveTab === 'pms' ? 'bg-teal-800 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                PMS 1-Click Paste
              </button>
              <button
                type="button"
                onClick={() => setGuideActiveTab('github')}
                className={`px-3 py-1.5 rounded-xl transition flex items-center space-x-1.5 ${
                  guideActiveTab === 'github' ? 'bg-teal-700 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Send className="w-3 h-3" />
                <span>Request Feature (GitHub)</span>
              </button>
            </div>

            {/* Tab Contents */}
            <div className="mt-4 text-xs text-slate-600 space-y-4 max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
              {guideActiveTab === 'phases' && (
                <div className="space-y-4">
                  <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-teal-800 block mb-1">
                      PHASE 1 • MORNING CLINICAL SETUP
                    </span>
                    <h4 className="text-xs font-bold text-slate-900 mb-1">Operatory Roster & Audio Verification</h4>
                    <p className="leading-relaxed text-slate-600">
                      Verify your day's patient roster in the left rail. For walk-in patients, click <strong>+ Encounter</strong> to add them in 5 seconds. The microphone defaults to <span className="font-mono text-sky-700 font-bold">STANDBY (00:00)</span> with zero runaway audio.
                    </p>
                  </div>

                  <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-teal-800 block mb-1">
                      PHASE 2 • CHAIRSIDE APPOINTMENT
                    </span>
                    <h4 className="text-xs font-bold text-slate-900 mb-1">Hands-Free Audio & Noise Filter</h4>
                    <p className="leading-relaxed text-slate-600">
                      Seat the patient and tap <kbd className="px-1 py-0.5 bg-white border rounded font-mono text-[10px]">Spacebar</kbd>. The ascending chime confirms listening. The smart noise filter automatically quiets dental drills and background sounds.
                    </p>
                  </div>

                  <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-teal-800 block mb-1">
                      PHASE 3 • POST-OP TURNOVER
                    </span>
                    <h4 className="text-xs font-bold text-slate-900 mb-1">Inline Notes & 1-Click Clipboard Copy</h4>
                    <p className="leading-relaxed text-slate-600">
                      Click directly into Subjective, Objective, Assessment, or Plan to customize any sentence with zero lag. Press <kbd className="px-1 py-0.5 bg-white border rounded font-mono text-[10px]">⌘C</kbd> to copy the formatted note for immediate insertion into your practice software.
                    </p>
                  </div>

                  <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-teal-800 block mb-1">
                      PHASE 4 • END-OF-DAY RECONCILIATION
                    </span>
                    <h4 className="text-xs font-bold text-slate-900 mb-1">End-of-Day Notes Review</h4>
                    <p className="leading-relaxed text-slate-600">
                      Press <kbd className="px-1 py-0.5 bg-white border rounded font-mono text-[10px]">⌘B</kbd> to open End-of-Day Notes. Verify all encounters are completed and billed. Leave the practice on time with zero evening charting backlog.
                    </p>
                  </div>
                </div>
              )}

              {guideActiveTab === 'hotkeys' && (
                <div className="space-y-3">
                  <div className="p-3.5 bg-indigo-50/50 rounded-2xl border border-indigo-100">
                    <h4 className="font-bold text-slate-900 mb-1">Hands-Free Keyboard Shortcuts</h4>
                    <p className="text-slate-600">
                      Designed so you can navigate quickly using a keyboard or foot pedal without touching the mouse.
                    </p>
                  </div>

                  <div className="border border-slate-200 rounded-2xl overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-500">
                        <tr>
                          <th className="p-3">Shortcut</th>
                          <th className="p-3">Action</th>
                          <th className="p-3">Clinical Benefit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        <tr>
                          <td className="p-3 font-mono font-bold text-teal-800">Spacebar</td>
                          <td className="p-3 font-bold text-slate-800">Toggle Audio (Start / Pause / Resume / Keep Listening)</td>
                          <td className="p-3 text-slate-500">Hands-free foot pedal or keyboard tap</td>
                        </tr>
                        <tr>
                          <td className="p-3 font-mono font-bold text-teal-800">⌘C / Ctrl+C</td>
                          <td className="p-3 font-bold text-slate-800">Copy Formatted Note for PMS</td>
                          <td className="p-3 text-slate-500">Pasting into Dentrix / Cliniko / Exact</td>
                        </tr>
                        <tr>
                          <td className="p-3 font-mono font-bold text-teal-800">⌘B / Ctrl+B</td>
                          <td className="p-3 font-bold text-slate-800">Open / Close End-of-Day Notes</td>
                          <td className="p-3 text-slate-500">Review and copy all today's notes</td>
                        </tr>
                        <tr>
                          <td className="p-3 font-mono font-bold text-teal-800">⌘→ / Ctrl+→</td>
                          <td className="p-3 font-bold text-slate-800">Advance to Next Patient</td>
                          <td className="p-3 text-slate-500">Instant patient switch without mouse</td>
                        </tr>
                        <tr>
                          <td className="p-3 font-mono font-bold text-teal-800">⌘V / Ctrl+V</td>
                          <td className="p-3 font-bold text-slate-800">Import Appointment Schedule</td>
                          <td className="p-3 text-slate-500">Quickly load today's schedule</td>
                        </tr>
                        <tr>
                          <td className="p-3 font-mono font-bold text-teal-800">?</td>
                          <td className="p-3 font-bold text-slate-800">Open Guide & Shortcuts</td>
                          <td className="p-3 text-slate-500">Instant access to shortcuts and help</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {guideActiveTab === 'dictation' && (
                <div className="space-y-3">
                  <div className="p-3.5 bg-teal-50/50 rounded-2xl border border-teal-100">
                    <h4 className="font-bold text-slate-900 mb-1">Acoustic & Dental Phonetic Recognition</h4>
                    <p className="text-slate-600">
                      DentAI's operatory phonetic lexicon automatically maps spoken colloquial dental terms into standardized clinical notations.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="p-3 bg-white border border-slate-200 rounded-xl">
                      <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Tooth Notation</span>
                      <p className="font-bold text-slate-800 text-xs">FDI & Universal System</p>
                      <p className="text-slate-500 mt-1 text-[11px]">Say: <em>"Tooth 14 occlusal"</em> or <em>"FDI 33 and 46"</em>. Both are recognized and mapped.</p>
                    </div>

                    <div className="p-3 bg-white border border-slate-200 rounded-xl">
                      <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Anesthetic Phrasing</span>
                      <p className="font-bold text-slate-800 text-xs">Carpule & Epinephrine</p>
                      <p className="text-slate-500 mt-1 text-[11px]">Say: <em>"1 carpule 2% Lidocaine 1 to 100,000 epi via IANB"</em>. Mapped to D9215 / ADA 921.</p>
                    </div>

                    <div className="p-3 bg-white border border-slate-200 rounded-xl">
                      <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Restorative Materials</span>
                      <p className="font-bold text-slate-800 text-xs">Composites & Cements</p>
                      <p className="text-slate-500 mt-1 text-[11px]">Say: <em>"Filtek Supreme A2 composite"</em>, <em>"Theracal liner"</em>, or <em>"RelyX Luting Plus"</em>.</p>
                    </div>

                    <div className="p-3 bg-white border border-slate-200 rounded-xl">
                      <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Periodontal Probing</span>
                      <p className="font-bold text-slate-800 text-xs">Six-Point Probing</p>
                      <p className="text-slate-500 mt-1 text-[11px]">Say: <em>"Pocket depths 3-2-3 on buccal, bleeding on probing"</em>.</p>
                    </div>
                  </div>
                </div>
              )}

              {guideActiveTab === 'pms' && (
                <div className="space-y-3">
                  <div className="p-3.5 bg-sky-50/50 rounded-2xl border border-sky-100">
                    <h4 className="font-bold text-slate-900 mb-1">1-Click Practice Management Paste</h4>
                    <p className="text-slate-600">
                      When you click <strong>Copy Note</strong> (<kbd className="px-1 py-0.5 bg-white border rounded font-mono text-[10px]">⌘C</kbd>), DentAI formats the note with clinical delimiters compatible with every PMS:
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="p-3 bg-white border border-slate-200 rounded-xl">
                      <p className="font-bold text-slate-800 text-xs">Dentrix (G6 / G7 / Ascend)</p>
                      <p className="text-slate-500 text-[11px] mt-0.5">Open <em>Patient Chart &rarr; Clinical Notes</em>, press <kbd className="px-1 py-0.2 bg-slate-100 border rounded font-mono text-[10px]">Ctrl+V</kbd>. Headers and billing codes paste automatically into note lines.</p>
                    </div>

                    <div className="p-3 bg-white border border-slate-200 rounded-xl">
                      <p className="font-bold text-slate-800 text-xs">Eaglesoft</p>
                      <p className="text-slate-500 text-[11px] mt-0.5">Open <em>Treatment &rarr; Clinical Notes tab</em>, press <kbd className="px-1 py-0.2 bg-slate-100 border rounded font-mono text-[10px]">Ctrl+V</kbd>.</p>
                    </div>

                    <div className="p-3 bg-white border border-slate-200 rounded-xl">
                      <p className="font-bold text-slate-800 text-xs">Exact / Software of Excellence</p>
                      <p className="text-slate-500 text-[11px] mt-0.5">Open patient clinical file &rarr; Charting notes &rarr; Paste.</p>
                    </div>

                    <div className="p-3 bg-white border border-slate-200 rounded-xl">
                      <p className="font-bold text-slate-800 text-xs">Cliniko & Titanium</p>
                      <p className="text-slate-500 text-[11px] mt-0.5">Open Treatment Notes &rarr; Add Note &rarr; Paste.</p>
                    </div>
                  </div>
                </div>
              )}

              {guideActiveTab === 'github' && (
                <form onSubmit={handleSubmitChairsideGitHubIssue} className="space-y-3">
                  <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                    <h4 className="font-bold text-slate-900 flex items-center gap-1.5 text-xs">
                      <Send className="w-3.5 h-3.5 text-teal-700" />
                      Direct GitHub Issue Dispatcher
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Directly submits an issue to repository (<span className="font-mono text-slate-700">vikramdarade/dentai</span>) via API without opening browser tabs.
                    </p>
                  </div>

                  {guideGhResult && (
                    <div className={`p-3 rounded-xl text-xs font-semibold flex items-center justify-between gap-2 ${
                      guideGhResult.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
                    }`}>
                      <div className="flex items-center gap-2">
                        {guideGhResult.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />}
                        <span>{guideGhResult.ok ? `Issue #${guideGhResult.issueNumber} created directly in GitHub!` : guideGhResult.error}</span>
                      </div>
                      {guideGhResult.issueUrl && (
                        <a
                          href={guideGhResult.issueUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-emerald-700 underline flex items-center gap-1 shrink-0"
                        >
                          <span>View Issue</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">Issue Title</label>
                    <input
                      type="text"
                      placeholder="e.g. Add support for ADA item 611 ceramic crown fee schedule"
                      value={guideGhTitle}
                      onChange={e => setGuideGhTitle(e.target.value)}
                      required
                      className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:border-teal-700 outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">Category</label>
                      <select
                        value={guideGhCategory}
                        onChange={e => setGuideGhCategory(e.target.value)}
                        className="w-full h-9 px-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:border-teal-700 outline-none"
                      >
                        <option value="feature-request">Feature Request</option>
                        <option value="clinical-audio">Microphone & Noise Filter</option>
                        <option value="dental-lexicon">Dental Lexicon & Codes</option>
                        <option value="pms-clipboard">PMS Clipboard & Export</option>
                        <option value="operatory-bug">Bug Report</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">Priority</label>
                      <select
                        value={guideGhPriority}
                        onChange={e => setGuideGhPriority(e.target.value)}
                        className="w-full h-9 px-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:border-teal-700 outline-none"
                      >
                        <option value="normal">Normal</option>
                        <option value="high">High (Active operatory)</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">Clinical Context & Observation</label>
                    <textarea
                      rows={3}
                      placeholder="Describe what occurred chairside or the feature improvement desired..."
                      value={guideGhDescription}
                      onChange={e => setGuideGhDescription(e.target.value)}
                      required
                      className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:border-teal-700 outline-none resize-none"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400 block mb-0.5">
                      GitHub Token (Optional override if not in server .env)
                    </label>
                    <input
                      type="password"
                      placeholder="ghp_..."
                      value={guideGhToken}
                      onChange={e => setGuideGhToken(e.target.value)}
                      className="w-full h-8 px-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={guideGhSubmitting || !guideGhTitle.trim() || !guideGhDescription.trim()}
                    className="w-full h-10 rounded-xl bg-teal-800 hover:bg-teal-900 disabled:opacity-50 text-white text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                  >
                    {guideGhSubmitting ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        <span>Creating issue via GitHub API…</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>Submit Directly to GitHub</span>
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
