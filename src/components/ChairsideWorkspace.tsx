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
  ChevronDown,
  Plus,
  Shield,
  User,
  FileText,
  Sparkles,
  Activity,
  LogOut,
  X,
  Clipboard,
  LayoutDashboard,
  TrendingUp,
  Mail,
  Send,
  RefreshCw,
  Upload,
  ArrowRight,
  HelpCircle,
  LifeBuoy,
  ExternalLink,
  Tag,
  RotateCw
} from 'lucide-react';
import { createOperatoryDspChain, type OperatoryDspChain } from '../lib/operatoryAudioDsp';
import { addScheduleItem, parseTimeToMinutes, ScheduleItemStatus } from '../lib/dayScheduleStorage';
import { Consultation, TranscriptItem, ClinicalFindings } from '../types';
import { chooseNoteTranscript, type TranscriptSource } from '../lib/transcription';
import {
  blobToBase64,
  isTranscriptionFailure,
  requestTranscription,
  uploadAudioSegment
} from '../lib/transcribeClient';
import { AuthUser } from '../utils/storage';
import { AppointmentType, getTemplateById, APPOINTMENT_TYPES } from '../lib/dentalLibrary';
import { generateOfflineDraft } from '../lib/draftEngine';
import { generateMacroNote } from '../lib/macroEngine';
import { normalizeSpokenDentalText } from '../lib/dentalPhoneticLexicon';
import { formatClinicDate, formatClinicTime, getClinicTodayIso } from '../utils/date';
import { decideSilenceAction, SILENCE_SLEEP_SECONDS } from '../lib/silencePolicy';
import { toPmsEncounter, renderUniversalProgressNote, renderD4W, renderExact } from '../lib/pms';
import { ClinicMembership } from '../lib/clinics';
import { CHAIRSIDE_MACRO_OPTIONS } from '../lib/australianClinicalMacros';
import { DaysheetModal } from './DaysheetModal';
import { DeliverablesModal } from './DeliverablesModal';
import { BatchTrayModal } from './BatchTrayModal';
import { DayGuideModal } from './DayGuideModal';
import { OperatoryPatientBanner } from './OperatoryPatientBanner';
import { LiveConversationPanel } from './LiveConversationPanel';
import { ClinicalNoteEditorPanel } from './ClinicalNoteEditorPanel';
import { AsepticShortcutFootbar } from './AsepticShortcutFootbar';

interface ChairsideWorkspaceProps {
  currentUser: AuthUser | null;
  dentistName: string;
  authToken: string | null;
  consultations: Consultation[];
  activeClinicId?: string | null;
  activeClinic?: ClinicMembership | null;
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
  status: ScheduleItemStatus;
  age?: number;
  dob?: string;
  team?: string;
  priorNote?: string;
  priorNoteDate?: string;
  alerts?: { type: 'allergy' | 'medication' | 'general'; text: string }[];
  diarizedTranscript?: {
    speaker?: string;
    role?: 'dentist' | 'assistant' | 'patient' | 'dialogue';
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
  activeClinic,
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

  const currentDateStr = useMemo(() => currentDate.toISOString().slice(0, 10), [currentDate]);

  const handlePrevDay = () => {
    setIsMicStandby(true);
    setIsPaused(false);
    setRecordingSeconds(0);
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 1));
  };

  const handleNextDay = () => {
    setIsMicStandby(true);
    setIsPaused(false);
    setRecordingSeconds(0);
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1));
  };

  // Real-time optimistic ambient transcript state (0ms latency, zero-lag UI feedback)
  const [localLiveTranscripts, setLocalLiveTranscripts] = useState<Record<string, { sender: string; text: string; time?: string }[]>>({});
  const [copiedEncounterIds, setCopiedEncounterIds] = useState<Set<string>>(() => new Set());
  const [failedEncounterIds, setFailedEncounterIds] = useState<Set<string>>(() => new Set());
  const [isPaused, setIsPaused] = useState(false);
  const [isMicStandby, setIsMicStandby] = useState(true); // Apple Medical Standard: Starts in explicit STANDBY (00:00)
  const [backgroundFinalizingIds, setBackgroundFinalizingIds] = useState<Set<string>>(new Set());

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
        const senderLower = (t.sender || '').toLowerCase();
        const role = senderLower.includes('patient')
          ? ('patient' as const)
          : senderLower.includes('assistant') || senderLower.includes('comment')
            ? ('assistant' as const)
            : senderLower.includes('dentist') || senderLower.includes('clinician')
              ? ('dentist' as const)
              : ('dialogue' as const);

        const speaker =
          role === 'patient'
            ? `${fullName} (Patient)`
            : role === 'assistant'
              ? 'Dental Assistant'
              : role === 'dentist'
                ? (dentistName || 'Dentist')
                : 'Dialogue';

        return {
          speaker,
          role,
          time: (t as any).time || (c.time || formatClinicTime(new Date())),
          text: t.text
        };
      });

      // Map real SOAP findings (never synthesize findings when unobserved, per Rule 12)
      const subjective = [c.findings?.chiefComplaint, c.findings?.history, c.findings?.customSections?.subjective, (c.findings as any)?.subjective]
        .filter((val, idx, arr): val is string => Boolean(val && typeof val === 'string' && val.trim()) && arr.indexOf(val) === idx)
        .join('\n\n');

      const objective = [c.findings?.toothFindings, c.findings?.findingsGingival, c.findings?.customSections?.objective, (c.findings as any)?.objective]
        .filter((val, idx, arr): val is string => Boolean(val && typeof val === 'string' && val.trim()) && arr.indexOf(val) === idx)
        .join('\n\n');

      const assessment = [c.findings?.diagnosis, c.findings?.customSections?.assessment, (c.findings as any)?.assessment]
        .filter((val, idx, arr): val is string => Boolean(val && typeof val === 'string' && val.trim()) && arr.indexOf(val) === idx)
        .join('\n\n');

      const plan = [c.findings?.treatmentPerformed, c.findings?.recommendations, c.findings?.recallRequirements, c.findings?.customSections?.plan, (c.findings as any)?.plan]
        .filter((val, idx, arr): val is string => Boolean(val && typeof val === 'string' && val.trim()) && arr.indexOf(val) === idx)
        .join('\n\n');

      const soap = {
        subjective,
        objective,
        assessment,
        plan
      };

      const cdtCodes = c.findings?.adaCodes?.map(a => ({
        code: a.code,
        desc: a.description,
        fee: '$180.00'
      })) || [];

      // A consultation only has a generated note if actual clinical findings or treatment
      // were synthesized/documented, not merely an imported appointment reason.
      const hasActualGeneratedNote = Boolean(
        c.noteOrigin ||
        (c.findings?.treatmentPerformed && c.findings.treatmentPerformed.trim().length > 0) ||
        (c.findings?.diagnosis && c.findings.diagnosis.trim().length > 0) ||
        (c.findings?.adaCodes && c.findings.adaCodes.length > 0)
      );

      let encounterStatus: ScheduleItemStatus = 'ready';
      if (copiedEncounterIds.has(c.id)) {
        encounterStatus = 'done';
      } else if (c.id === activePatientId && !isMicStandby && !isPaused) {
        encounterStatus = 'recording';
      } else if (backgroundFinalizingIds.has(c.id)) {
        encounterStatus = 'processing';
      } else if (failedEncounterIds.has(c.id)) {
        encounterStatus = 'recreate';
      } else if (hasActualGeneratedNote) {
        encounterStatus = 'note_generated';
      } else {
        encounterStatus = 'ready';
      }

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
        status: encounterStatus,
        dob: c.dob || '',
        priorNote,
        priorNoteDate,
        alerts,
        diarizedTranscript,
        soap,
        cdtCodes
      };
    });
  }, [consultations, activePatientId, dentistName, localLiveTranscripts, isMicStandby, isPaused, backgroundFinalizingIds, copiedEncounterIds, failedEncounterIds]);

  // Filter encounters for the selected day sheet date (Pure genuine data sorted chronologically by time)
  const encountersForDate: PatientEncounter[] = useMemo(() => {
    const shortDate = formatClinicDate(currentDate, { month: 'short', day: 'numeric' });
    return patientEncounters
      .filter(p => {
        const orig = consultations.find(c => c.id === p.id);
        if (!orig?.date) return false;
        const d = orig.date.trim();
        return d === currentDateStr || d === shortDate || d.startsWith(shortDate);
      })
      .sort((a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time));
  }, [patientEncounters, consultations, currentDateStr, currentDate]);

  // Compute latest consultation date available for 1-click schedule jump
  const { latestConsultDate, latestDateLabel } = useMemo(() => {
    if (!consultations || consultations.length === 0) return { latestConsultDate: null, latestDateLabel: '' };
    const withDate = consultations.filter(c => Boolean(c.date));
    if (withDate.length === 0) return { latestConsultDate: null, latestDateLabel: '' };
    const latest = withDate[0];
    let parsedDate: Date | null = null;
    if (latest.date) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(latest.date.trim())) {
        const [y, m, d] = latest.date.trim().split('-').map(Number);
        parsedDate = new Date(y, m - 1, d);
      } else {
        const currentYear = new Date().getFullYear();
        parsedDate = new Date(`${latest.date.trim()}, ${currentYear}`);
      }
    }
    if (parsedDate && !isNaN(parsedDate.getTime())) {
      return {
        latestConsultDate: parsedDate,
        latestDateLabel: formatClinicDate(parsedDate, { month: 'short', day: 'numeric' })
      };
    }
    return { latestConsultDate: null, latestDateLabel: '' };
  }, [consultations]);

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

  const activeConsult = useMemo(() => {
    if (!activeEncounter) return null;
    return consultations.find(c => c.id === activeEncounter.id) || null;
  }, [consultations, activeEncounter]);

  // Fallback to active chairside encounter when no pre-scheduled appointment exists
  const effectiveEncounter = useMemo<PatientEncounter>(() => {
    if (activeEncounter) return activeEncounter;
    return {
      id: 'chair-active',
      consultationId: 'chair-active',
      time: formatClinicTime(new Date()),
      operatory: 'Room 1',
      patientName: 'In-Chair Patient',
      procedureText: 'General Consultation',
      appointmentType: 'examination' as AppointmentType,
      templateId: 'standard',
      status: isMicStandby ? 'ready' : isPaused ? 'ready' : 'recording',
      alerts: [],
      diarizedTranscript: localLiveTranscripts['chair-active'] || [],
      soap: { subjective: '', objective: '', assessment: '', plan: '' },
      cdtCodes: []
    };
  }, [activeEncounter, isMicStandby, isPaused, localLiveTranscripts]);

  // Active transcript (no confidence gating — dentist decides when to regenerate)
  const currentOperatoryEncounter = activeEncounter || effectiveEncounter;

  const activeEncounterTranscript = useMemo(() => {
    if (!currentOperatoryEncounter) return [];
    return localLiveTranscripts[currentOperatoryEncounter.id] || currentOperatoryEncounter.diarizedTranscript || [];
  }, [currentOperatoryEncounter, localLiveTranscripts]);

  // ─────────────────────────────────────────────────────────────
  // 3. LIVE AUDIO RECORDING, DSP ACOUSTIC SQUELCH & WEBAUDIO GRAPH
  // ─────────────────────────────────────────────────────────────
  const isRecording = true;
  const [recordingSeconds, setRecordingSeconds] = useState(0); // Anchored at 00:00 until clinician initiates
  const [manualDialogueText, setManualDialogueText] = useState('');
  const [isFinalizing, setIsFinalizing] = useState(false);
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

  // Ergonomic Collapsible Day Schedule Sidebar & Utility Menu
  const [isScheduleCollapsed, setIsScheduleCollapsed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('dentai_schedule_collapsed') === 'true';
    }
    return false;
  });

  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const toolsMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setShowToolsMenu(false);
      }
    };
    if (showToolsMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showToolsMenu]);

  const handleToggleScheduleCollapse = () => {
    setIsScheduleCollapsed(prev => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('dentai_schedule_collapsed', String(next));
      }
      return next;
    });
  };

  // ─────────────────────────────────────────────────────────────
  // 3b. PROGRESS NOTE EDITOR STATE
  // ─────────────────────────────────────────────────────────────
  const [editedProgressNotes, setEditedProgressNotes] = useState<Record<string, string>>({});
  const [progressNoteSaveStatus, setProgressNoteSaveStatus] = useState<Record<string, 'saved' | 'saving'>>({});
  const [progressiveDrafts, setProgressiveDrafts] = useState<Record<string, string>>({});
  const progressiveDraftTimerRef = useRef<Record<string, any>>({});
  const [turnoverToast, setTurnoverToast] = useState<string | null>(null);

  useEffect(() => {
    if (!turnoverToast) return;
    const timer = setTimeout(() => setTurnoverToast(null), 4500);
    return () => clearTimeout(timer);
  }, [turnoverToast]);

  // ─────────────────────────────────────────────────────────────
  // 3c. CONTEXTUAL OPERATORY HELP
  // ─────────────────────────────────────────────────────────────
  const [showDayGuide, setShowDayGuide] = useState(false);
  const [guideActiveTab, setGuideActiveTab] = useState<'phases' | 'hotkeys' | 'dictation' | 'pms' | 'github'>('phases');

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
  const activeEncounterRef = useRef<PatientEncounter | null>(activeEncounter || effectiveEncounter);
  const consultationsRef = useRef(consultations);
  const localLiveTranscriptsRef = useRef(localLiveTranscripts);

  // Auto-restart flap detection (matching LiveRecording.tsx architecture)
  const lastSessionStartRef = useRef<number>(0);
  const unstableRestartsRef = useRef<number>(0);
  const RESTART_MIN_SESSION_MS = 1500;
  const MAX_UNSTABLE_RESTARTS = 3;

  // Background consultation debounced autosave (prevents per-word HTTP PUT flooding)
  const saveDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSaveConsultationRef = useRef<Consultation | null>(null);
  const lastUtteranceTimeRef = useRef<Record<string, number>>({});
  const handleAppendTranscriptRef = useRef<(text: string, sender?: 'Dentist' | 'Patient' | 'Dialogue') => Promise<void> | void>(() => {});

  useEffect(() => {
    isRecordingRef.current = isRecording;
    isPausedRef.current = isPaused;
    isMicStandbyRef.current = isMicStandby;
    activeEncounterRef.current = activeEncounter || effectiveEncounter;
    consultationsRef.current = consultations;
    localLiveTranscriptsRef.current = localLiveTranscripts;
  }, [isRecording, isPaused, isMicStandby, activeEncounter, effectiveEncounter, consultations, localLiveTranscripts]);

  // Flush any debounced consultation saves immediately before state transitions or note finalization
  const flushPendingConsultationSave = useCallback(async () => {
    if (saveDebounceTimerRef.current) {
      clearTimeout(saveDebounceTimerRef.current);
      saveDebounceTimerRef.current = null;
    }
    if (pendingSaveConsultationRef.current && onSaveConsultation) {
      const consultToSave = pendingSaveConsultationRef.current;
      pendingSaveConsultationRef.current = null;
      try {
        await onSaveConsultation(consultToSave);
      } catch (e) {
        console.warn('Failed to flush debounced consultation save:', e);
      }
    }
  }, [onSaveConsultation]);

  // Unmount safety: flush pending consultation saves
  useEffect(() => {
    return () => {
      if (saveDebounceTimerRef.current) {
        clearTimeout(saveDebounceTimerRef.current);
      }
      if (pendingSaveConsultationRef.current && onSaveConsultation) {
        onSaveConsultation(pendingSaveConsultationRef.current).catch(() => {});
      }
    };
  }, [onSaveConsultation]);

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
    setIsScheduleCollapsed(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem('dentai_schedule_collapsed', 'true');
    }
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
      } else {
        void flushPendingConsultationSave();
      }
      setIsSilenceWarning(false);
      isSilenceWarningRef.current = false;
      hasPlayedWarningChimeRef.current = false;
      playMedicalChime(next ? 'pause' : 'start');
      return next;
    });
  }, [playMedicalChime, flushPendingConsultationSave]);

  const handleStopAudioToStandby = useCallback(() => {
    void flushPendingConsultationSave();
    if (dspRef.current) {
      dspRef.current.destroy();
      dspRef.current = null;
    }
    setIsSnrLow(false);
    setIsMicStandby(true);
    setIsPaused(false);
    setIsSilenceWarning(false);
    isSilenceWarningRef.current = false;
    hasPlayedWarningChimeRef.current = false;
    setInterimTranscript('');
    playMedicalChime('stop');
  }, [playMedicalChime, flushPendingConsultationSave]);

  const handleSelectPatient = useCallback((patientId: string) => {
    hasUserManuallySelectedRef.current = true;
    if (patientId === activePatientId) return;

    void flushPendingConsultationSave();
    if (dspRef.current) {
      dspRef.current.destroy();
      dspRef.current = null;
    }
    setIsSnrLow(false);

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
  }, [activePatientId, playMedicalChime, flushPendingConsultationSave]);

  // Hands-Free Quick Start for unassigned / walk-in encounter
  const handleQuickStartRecording = useCallback(async () => {
    const cleanTime = formatClinicTime(new Date());
    const tempId = `chairside-${Date.now()}`;
    const newConsultation: Consultation = {
      id: tempId,
      dentistId: currentUser?.id || '',
      clinicId: activeClinicId || undefined,
      firstName: 'Chairside',
      lastName: 'Walk-In',
      dob: '',
      appointmentType: 'examination',
      templateId: 'general_exam_clean',
      date: getClinicTodayIso(),
      time: cleanTime,
      status: 'In Review',
      patientSummary: '',
      transcript: [],
      findings: {
        chiefComplaint: '',
        history: '',
        toothFindings: '',
        findingsGingival: '',
        diagnosis: '',
        treatmentPerformed: '',
        recommendations: '',
        recallRequirements: '',
        adaCodes: []
      }
    };

    if (onSaveConsultation) {
      await onSaveConsultation(newConsultation);
    }

    addScheduleItem({
      time: cleanTime,
      patientName: 'Chairside Walk-In',
      procedureText: 'General Examination',
      appointmentType: 'examination',
      templateId: 'general_exam_clean'
    });

    handleSelectPatient(newConsultation.id);
    setTimeout(() => {
      handleStartAudio();
    }, 150);
  }, [currentUser, activeClinicId, onSaveConsultation, handleSelectPatient, handleStartAudio]);

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
          } else if (!activeEncounter) {
            void handleQuickStartRecording();
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
  }, [handleKeepListening, handleStartAudio, handleTogglePause, activeEncounter, handleQuickStartRecording]);

  // Derived active SOAP (read-only from consultation record — no local override layer)
  const currentSoap = activeEncounter?.soap ?? { subjective: '', objective: '', assessment: '', plan: '' };

  const hasGeneratedNote = useMemo(() => {
    return Boolean(
      (activeEncounter && (activeEncounter.status === 'note_generated' || activeEncounter.status === 'done')) ||
      activeConsult?.noteOrigin ||
      (currentSoap.plan && currentSoap.plan.trim().length > 0) ||
      (currentSoap.objective && currentSoap.objective.trim().length > 0 && currentSoap.assessment && currentSoap.assessment.trim().length > 0)
    );
  }, [activeEncounter, activeConsult, currentSoap]);

  // Handle inline clinical Progress Note edit with instant optimistic UI & database auto-save
  const handleProgressNoteChange = useCallback(async (value: string) => {
    const targetId = activeEncounter?.id || effectiveEncounter.id;

    // 1. Optimistic UI update (0ms typing latency)
    setEditedProgressNotes(prev => ({
      ...prev,
      [targetId]: value
    }));
    setProgressNoteSaveStatus(prev => ({ ...prev, [targetId]: 'saving' }));

    // 2. Persist to consultation in database
    const existingConsultation = consultationsRef.current.find(c => c.id === targetId);
    if (existingConsultation && onSaveConsultation) {
      const updatedConsultation: Consultation = {
        ...existingConsultation,
        clinicalProgressNote: value
      };

      try {
        await onSaveConsultation(updatedConsultation);
        setProgressNoteSaveStatus(prev => ({ ...prev, [targetId]: 'saved' }));
      } catch (e) {
        console.warn('Failed to auto-save clinical progress note:', e);
      }
    } else {
      setProgressNoteSaveStatus(prev => ({ ...prev, [targetId]: 'saved' }));
    }
  }, [activeEncounter, onSaveConsultation]);

  // Web Audio Nodes & direct DOM ref array for 60fps zero-render visualizer
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const filteredStreamRef = useRef<MediaStream | null>(null);
  const dspRef = useRef<OperatoryDspChain | null>(null);
  const [isSnrLow, setIsSnrLow] = useState(false);
  const animFrameRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);
  const lastInterimRef = useRef<string>('');
  const waveformRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Sync bypass state when user toggles DSP noise filter
  useEffect(() => {
    if (dspRef.current) {
      dspRef.current.setBypass(!dspNoiseGateActive);
    }
  }, [dspNoiseGateActive]);

  // Auto-scroll ambient transcript stream to bottom on new utterance or interim speech
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeEncounter?.diarizedTranscript?.length, interimTranscript]);

  // High-performance DOM-level visualizer loop with Medical-Grade Operatory DSP Filter Graph
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
          const audioConstraints: MediaStreamConstraints = {
            audio: {
              echoCancellation: true, // Prevents app chimes (playMedicalChime) from feeding back into mic
              noiseSuppression: false, // Prevents Chrome's aggressive gate from clipping masked speech consonants
              autoGainControl: true,   // Far-field 4-5ft preamp normalization
              sampleRate: 48000
            }
          };
          const stream = await navigator.mediaDevices.getUserMedia(audioConstraints)
            .catch(() => navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null));
          if (stream && !isCancelled) {
            streamRef.current = stream;
            if (audioContextRef.current) {
              const ctx = audioContextRef.current;
              if (dspRef.current) {
                dspRef.current.destroy();
                dspRef.current = null;
              }

              // Build calibrated operatory DSP filter graph (High-pass 80Hz, Notch 5-7.5kHz, Low-pass 18kHz)
              const dsp = createOperatoryDspChain(stream, {
                audioContext: ctx,
                onSnrWarning: (lowSnr) => {
                  if (!isCancelled) {
                    setIsSnrLow(lowSnr);
                  }
                }
              });
              dsp.setBypass(!dspNoiseGateActive);
              dspRef.current = dsp;

              analyserRef.current = dsp.analyserNode;
              filteredStreamRef.current = dsp.destinationStream;

              const dataArray = new Uint8Array(dsp.analyserNode.frequencyBinCount);
              const updateVisualizer = () => {
                if (isCancelled) return;
                dsp.analyserNode.getByteFrequencyData(dataArray);

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
      if (dspRef.current) {
        dspRef.current.destroy();
        dspRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      filteredStreamRef.current = null;
      analyserRef.current = null;
      setIsSnrLow(false);
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
      // second capture on the same microphone. If the DSP filter is active,
      // record the filtered destination stream rather than raw microphone input.
      let stream = (dspNoiseGateActive && filteredStreamRef.current)
        ? filteredStreamRef.current
        : streamRef.current;
      for (let attempt = 0; !stream && attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (cancelled) return;
        stream = (dspNoiseGateActive && filteredStreamRef.current)
          ? filteredStreamRef.current
          : streamRef.current;
      }
      if (!stream) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: false,
              autoGainControl: true,
              sampleRate: 48000
            }
          }).catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
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
          .catch(() => { });
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

  // Helper to append spoken or typed utterance with 0ms optimistic UI update & debounced database persistence
  const handleAppendTranscriptText = useCallback(
    async (text: string, sender: 'Dentist' | 'Patient' | 'Dialogue' = 'Dentist') => {
      if (!text.trim() || !activeEncounterRef.current) return;

      const normalized = normalizeSpokenDentalText(text.trim());
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
      const nowMs = Date.now();

      // Deduplication & prefix expansion check against the last utterance
      const normCurr = normalized.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
      if (!normCurr) return;

      let shouldReplace = false;
      let shouldDrop = false;
      let shouldStitch = false;
      let stitchedText = '';

      // Check current transcripts synchronously from ref (decoupling hook dependency)
      const currentList = localLiveTranscriptsRef.current[targetId] || [];
      if (currentList.length > 0) {
        const lastItem = currentList[currentList.length - 1];
        const normLast = lastItem.text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
        const timeSinceLast = nowMs - (lastUtteranceTimeRef.current[targetId] || 0);

        // 1. Exact duplicate
        if (normCurr === normLast) {
          shouldDrop = true;
        } else if (normLast.length >= normCurr.length && (normLast.startsWith(normCurr) || normLast.includes(normCurr))) {
          // 2. Stale fragment (last already contains current)
          shouldDrop = true;
        } else if (normCurr.length > normLast.length && (normCurr.startsWith(normLast) || normCurr.includes(normLast))) {
          // 3. Progressive prefix expansion (current extends last)
          shouldReplace = true;
        } else if (
          sender === 'Dialogue' &&
          lastItem.sender === 'Dialogue' &&
          timeSinceLast < 3500
        ) {
          // 4. Conversational stitching for rapid speech or Chromium clause boundaries
          // Check if last item ended in a continuation word or lacked terminal punctuation
          const endsWithContinuation = /(^|\s)(the|to|for|we|are|have|and|or|with|is|a|an|of|in|on|at|by|from|that|this|our|your|my|their|as|but|so)[.,;]?$/i.test(lastItem.text.trim());
          const lacksTerminalPunctuation = !/[.?!]$/.test(lastItem.text.trim());

          if (endsWithContinuation || lacksTerminalPunctuation) {
            shouldStitch = true;
            stitchedText = `${lastItem.text.replace(/[.,;]+$/, '')} ${normalized}`;
          }
        }
      }

      if (shouldDrop) {
        setInterimTranscript('');
        return;
      }

      lastUtteranceTimeRef.current[targetId] = nowMs;

      // 1. Instant optimistic UI update
      setLocalLiveTranscripts(prev => {
        const list = prev[targetId] || [];
        if (shouldStitch && list.length > 0) {
          const updated = [...list];
          updated[updated.length - 1] = { sender, text: stitchedText, time: timeNow };
          return { ...prev, [targetId]: updated };
        }
        if (shouldReplace && list.length > 0) {
          const updated = [...list];
          updated[updated.length - 1] = { sender, text: normalized, time: timeNow };
          return { ...prev, [targetId]: updated };
        }
        return {
          ...prev,
          [targetId]: [
            ...list,
            { sender, text: normalized, time: timeNow }
          ]
        };
      });
      setInterimTranscript('');

      // 2. Debounced persistence to database consultation (prevents network thrash on every word)
      const existingConsultation = consultationsRef.current.find(c => c.id === targetId);
      if (existingConsultation) {
        const existingTranscript = existingConsultation.transcript || [];
        let updatedTranscript: TranscriptItem[];

        if (shouldStitch && existingTranscript.length > 0) {
          updatedTranscript = [...existingTranscript];
          updatedTranscript[updatedTranscript.length - 1] = { sender, text: stitchedText };
        } else if (shouldReplace && existingTranscript.length > 0) {
          updatedTranscript = [...existingTranscript];
          updatedTranscript[updatedTranscript.length - 1] = { sender, text: normalized };
        } else {
          updatedTranscript = [
            ...existingTranscript,
            { sender, text: normalized }
          ];
        }

        const updatedConsultation: Consultation = {
          ...existingConsultation,
          transcript: updatedTranscript
        };

        pendingSaveConsultationRef.current = updatedConsultation;
        if (saveDebounceTimerRef.current) {
          clearTimeout(saveDebounceTimerRef.current);
        }
        saveDebounceTimerRef.current = setTimeout(async () => {
          await flushPendingConsultationSave();
        }, 2000);
      }

      // 3. Progressive speech drafting: updates clinical canvas dynamically on speech pauses
      if (progressiveDraftTimerRef.current[targetId]) {
        clearTimeout(progressiveDraftTimerRef.current[targetId]);
      }
      progressiveDraftTimerRef.current[targetId] = setTimeout(() => {
        try {
          const targetConsult = consultationsRef.current.find(c => c.id === targetId) || existingConsultation;
          if (!targetConsult) return;
          const template = getTemplateById(targetConsult.templateId);
          const currTranscript = (localLiveTranscriptsRef.current[targetId] || []).map(i => ({ sender: i.sender as any, text: i.text }));
          if (currTranscript.length === 0) return;
          const patientFullName = `${targetConsult.firstName || ''} ${targetConsult.lastName || ''}`.trim();
          const draft = generateOfflineDraft(template, currTranscript, patientFullName);

          const draftConsult: Consultation = {
            ...targetConsult,
            transcript: currTranscript,
            findings: {
              ...targetConsult.findings,
              chiefComplaint: draft.canonical.chiefComplaint || targetConsult.findings?.chiefComplaint || '',
              history: draft.canonical.history || targetConsult.findings?.history || '',
              toothFindings: draft.canonical.toothFindings || targetConsult.findings?.toothFindings || '',
              findingsGingival: draft.canonical.findingsGingival || targetConsult.findings?.findingsGingival || '',
              diagnosis: draft.canonical.diagnosis || targetConsult.findings?.diagnosis || '',
              treatmentPerformed: draft.canonical.treatmentPerformed || targetConsult.findings?.treatmentPerformed || '',
              recommendations: draft.canonical.recommendations || targetConsult.findings?.recommendations || '',
              recallRequirements: draft.canonical.recallRequirements || targetConsult.findings?.recallRequirements || '',
              adaCodes: draft.adaCodes?.length ? draft.adaCodes : (targetConsult.findings?.adaCodes || []),
              customSections: {
                ...(targetConsult.findings?.customSections || {}),
                ...(draft.customSections || {})
              }
            },
            patientSummary: draft.patientSummary || targetConsult.patientSummary
          };
          const formatted = renderUniversalProgressNote(toPmsEncounter(draftConsult));
          if (formatted) {
            setProgressiveDrafts(prev => ({ ...prev, [targetId]: formatted }));
          }
        } catch (err) {
          console.warn('Progressive speech draft skipped:', err);
        }
      }, 800);
    }, [flushPendingConsultationSave]
  );

  useEffect(() => {
    handleAppendTranscriptRef.current = handleAppendTranscriptText;
  }, [handleAppendTranscriptText]);

  // SpeechRecognition Hook with Operatory Acoustic Artifact Filtering & Live Interim Dialogue
  // 1. Initialize once on mount (matches LiveRecording.tsx architecture to eliminate teardown thrashing)
  useEffect(() => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      setMicError('Speech recognition is not supported in this browser.');
      return;
    }

    const recognition = new SpeechRec();
    recognition.continuous = true;
    recognition.interimResults = true;
    // Australian English pinned for dental phonetic lexicon
    recognition.lang = 'en-AU';

    recognition.onstart = () => {
      lastSessionStartRef.current = Date.now();
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
      // Only flush pending interim if the session is NOT auto-restarting (e.g. recording stopped/paused by user)
      const willRestart =
        isRecordingRef.current &&
        !isPausedRef.current &&
        !isMicStandbyRef.current &&
        Boolean(activeEncounterRef.current);

      if (!willRestart) {
        const pending = (lastInterimRef.current || '').trim();
        if (pending && activeEncounterRef.current) {
          const isNoise =
            /^(sh+|ah+|um+|zz+|ss+|hh+|ff+|th+)(\s+(sh+|ah+|um+|zz+|ss+|hh+|ff+|th+))*$/i.test(pending) ||
            /^[^a-zA-Z0-9]+$/.test(pending);
          if (!isNoise) {
            handleAppendTranscriptRef.current(pending, 'Dialogue');
          }
        }
      }
      lastInterimRef.current = '';
      setInterimTranscript('');

      // Auto-restart while active with flap protection (matching LiveRecording.tsx)
      if (willRestart) {
        const sessionMs = Date.now() - lastSessionStartRef.current;
        if (sessionMs < RESTART_MIN_SESSION_MS) {
          unstableRestartsRef.current += 1;
        } else {
          unstableRestartsRef.current = 0;
        }

        if (unstableRestartsRef.current >= MAX_UNSTABLE_RESTARTS) {
          unstableRestartsRef.current = 0;
          setMicError('Microphone disconnected repeatedly. Tap Start Audio to reconnect.');
        } else {
          setTimeout(() => {
            try {
              if (
                isRecordingRef.current &&
                !isPausedRef.current &&
                !isMicStandbyRef.current &&
                activeEncounterRef.current
              ) {
                recognition.start();
              }
            } catch (e) {
              console.warn('Failed to auto-restart speech recognition:', e);
            }
          }, 50);
        }
      }
    };

    recognition.onresult = (event: any) => {
      let interim = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const res = event.results[i];
        if (res.isFinal) {
          lastInterimRef.current = '';
          const rawText = res[0].transcript.trim();
          const text = normalizeSpokenDentalText(rawText);
          if (text && activeEncounterRef.current) {
            const isMechanicalNoise =
              /^(sh+|ah+|um+|zz+|ss+|hh+|ff+|th+)(\s+(sh+|ah+|um+|zz+|ss+|hh+|ff+|th+))*$/i.test(text) ||
              /^[^a-zA-Z0-9]+$/.test(text);

            if (!isMechanicalNoise) {
              handleAppendTranscriptRef.current(text, 'Dialogue');
            }
          }
          setInterimTranscript('');
        } else {
          interim += res[0].transcript;
        }
      }

      if (interim.trim()) {
        // Voice activity detected: reset silence timer
        lastVoicedTimeRef.current = Date.now();
        hasPlayedWarningChimeRef.current = false;
        if (isSilenceWarningRef.current) {
          setIsSilenceWarning(false);
          isSilenceWarningRef.current = false;
        }

        const normInterim = normalizeSpokenDentalText(interim.trim());
        lastInterimRef.current = normInterim;
        setInterimTranscript(normInterim);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
    };
  }, []);

  // 2. Synchronize recording / pause / standby / patient transition without tearing down recognizer
  useEffect(() => {
    const shouldListen = isRecording && !isPaused && !isMicStandby && Boolean(activeEncounter || effectiveEncounter);

    if (!shouldListen) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
      setMicListening(false);
      setInterimTranscript('');
    } else {
      unstableRestartsRef.current = 0;
      if (recognitionRef.current) {
        setMicError(null);
        setInterimTranscript('');
        try {
          recognitionRef.current.start();
        } catch (err: any) {
          if (err?.name !== 'InvalidStateError') {
            console.warn('SpeechRecognition start notice:', err);
          }
        }
      }
    }
  }, [isRecording, isPaused, isMicStandby, activeEncounter?.id, effectiveEncounter?.id]);

  // Elapsed Timer with wall-clock epoch accuracy (immune to Chromium tab throttling)
  // Adaptive 3-Minute Silence Sleep with 30s Pre-Pause Audio-Visual Warning (at 2m 30s)
  useEffect(() => {
    let interval: any;
    if (isRecording && !isPaused && !isMicStandby) {
      interval = setInterval(() => {
        const elapsed = Math.max(0, Math.floor((Date.now() - sessionStartTimeRef.current) / 1000));
        setRecordingSeconds(elapsed);

        // Check silence duration since last voiced speech via pure policy
        const silenceSec = (Date.now() - lastVoicedTimeRef.current) / 1000;
        const action = decideSilenceAction(silenceSec);

        if (action === 'pause') {
          // 3:00 - Auto-pause recording
          setIsPaused(true);
          setIsSilenceWarning(false);
          isSilenceWarningRef.current = false;
          hasPlayedWarningChimeRef.current = false;
          playMedicalChime('auto-pause');
        } else if (action === 'warn') {
          // 2:30 - Pre-pause audio-visual countdown warning
          const remaining = Math.max(0, Math.ceil(SILENCE_SLEEP_SECONDS - silenceSec));
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
  // 4. PMS DAYSHEET & SCREENSHOT VISION IMPORT (D4W / EXACT / OCR)
  // ─────────────────────────────────────────────────────────────
  const [showDaysheetModal, setShowDaysheetModal] = useState(false);
  const [scheduleImportTab, setScheduleImportTab] = useState<'screenshot' | 'text'>('screenshot');
  const [isScheduleParsing, setIsScheduleParsing] = useState(false);
  const [scheduleParsingError, setScheduleParsingError] = useState<string | null>(null);
  const [schedulePreviewImage, setSchedulePreviewImage] = useState<string | null>(null);
  const [detectedScheduleItems, setDetectedScheduleItems] = useState<Array<{
    id: string;
    time: string;
    patientName: string;
    dob: string;
    room: string;
    procedureText: string;
    appointmentType: AppointmentType;
    templateId: string;
  }>>([]);
  const [daysheetRawText, setDaysheetRawText] = useState('');
  const [pmsImportNotice, setPmsImportNotice] = useState(false);
  const scheduleFileInputRef = useRef<HTMLInputElement | null>(null);

  const handleOpenDaysheetModal = () => {
    setShowDaysheetModal(true);
    setScheduleParsingError(null);
  };

  const handleScheduleImageFile = async (file: File) => {
    if (!file) return;
    setIsScheduleParsing(true);
    setScheduleParsingError(null);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result as string;
        setSchedulePreviewImage(base64);
        try {
          const res = await fetch('/api/schedule/parse-image', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
            },
            body: JSON.stringify({
              imageBase64: base64,
              mimeType: file.type || 'image/png',
              providerName: dentistName
            })
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || errData.message || 'Failed to parse appointment schedule image.');
          }

          const data = await res.json();
          const rawApps = Array.isArray(data.appointments) ? data.appointments : [];
          if (rawApps.length === 0) {
            throw new Error('No patient appointments detected in this screenshot.');
          }

          const mapped = rawApps.map((app: any, idx: number) => ({
            id: `detected-${Date.now()}-${idx}`,
            time: String(app.time || '09:00').trim(),
            patientName: String(app.patientName || 'Patient').trim(),
            dob: String(app.dob || '').trim(),
            room: `Room ${(idx % 3) + 1}`,
            procedureText: String(app.procedureText || 'General Consultation').trim(),
            appointmentType: (app.appointmentType || 'examination') as AppointmentType,
            templateId: app.templateId || 'standard'
          }));

          setDetectedScheduleItems(mapped);
        } catch (err: any) {
          setScheduleParsingError(err.message || 'Error processing appointment screenshot.');
        } finally {
          setIsScheduleParsing(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setScheduleParsingError(err.message || 'Failed to read image file.');
      setIsScheduleParsing(false);
    }
  };

  // Global clipboard listener: pasting a screenshot (Win+Shift+S / ⌘V) anywhere opens OCR scanner
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      // Don't intercept if user is typing inside text fields and pasting text
      const target = e.target as HTMLElement;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf('image') !== -1) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            setShowDaysheetModal(true);
            setScheduleImportTab('screenshot');
            handleScheduleImageFile(file);
            return;
          }
        }
      }

      // If pressing Ctrl+V outside input fields when modal is closed, open modal
      if (!isInput && !showDaysheetModal && e.clipboardData?.getData('text')) {
        const text = e.clipboardData.getData('text');
        if (text && text.length > 5) {
          setShowDaysheetModal(true);
          setScheduleImportTab('text');
          setDaysheetRawText(text);
        }
      }
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [authToken, dentistName, showDaysheetModal]);

  const parseDaysheetLine = (line: string): {
    time: string;
    patientName: string;
    dob: string;
    procedure: string;
  } => {
    // 1. Extract Time: e.g. "09:00 AM", "9:30am", "14:15", "11:00"
    let time = '';
    const timeMatch = line.match(/\b(0?[1-9]|1[0-2]):[0-5][0-9]\s*(?:AM|PM|am|pm)?\b|\b([01]?[0-9]|2[0-3]):[0-5][0-9]\b/i);
    if (timeMatch) {
      time = timeMatch[0].trim();
    } else {
      time = formatClinicTime(new Date());
    }

    let remaining = line;
    if (timeMatch) {
      remaining = remaining.replace(timeMatch[0], ' ');
    }

    // 2. Extract DOB: e.g. "DOB: 14/05/1988", "14/05/1988", "14-05-1988", "(12/03/1975)", "14 May 1988"
    let dob = '';
    const prefixMatch = remaining.match(/(?:DOB|D\.O\.B\.|b\.)[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i);
    if (prefixMatch) {
      dob = prefixMatch[1];
      remaining = remaining.replace(prefixMatch[0], ' ');
    } else {
      const parenMatch = remaining.match(/\((\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\)/);
      if (parenMatch) {
        dob = parenMatch[1];
        remaining = remaining.replace(parenMatch[0], ' ');
      } else {
        const namedMatch = remaining.match(/\b(\d{1,2}[\s\-](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s\-]\d{2,4})\b/i);
        if (namedMatch) {
          dob = namedMatch[1];
          remaining = remaining.replace(namedMatch[0], ' ');
        } else {
          const standaloneDate = remaining.match(/\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})\b/);
          if (standaloneDate) {
            dob = standaloneDate[1];
            remaining = remaining.replace(standaloneDate[0], ' ');
          }
        }
      }
    }

    // 3. Clean up delimiter artifacts (| , - tab double-spaces)
    const parts = remaining.split(/[\t|]|\s{2,}|(?<=[a-zA-Z\s])\s*[-–—]\s*(?=[a-zA-Z])/).map(s => s.trim()).filter(Boolean);
    let patientName = 'Patient';
    let procedure = 'General Dental Consultation';

    if (parts.length >= 2) {
      patientName = parts[0];
      procedure = parts.slice(1).join(' • ');
    } else if (parts.length === 1) {
      const words = parts[0].split(/\s+/);
      if (words.length >= 3) {
        patientName = `${words[0]} ${words[1]}`;
        procedure = words.slice(2).join(' ');
      } else {
        patientName = parts[0];
      }
    }

    return {
      time,
      patientName: patientName.replace(/^[,\-–—\s]+|[,\-–—\s]+$/g, '') || 'Patient',
      dob,
      procedure: procedure.replace(/^[,\-–—\s]+|[,\-–—\s]+$/g, '') || 'General Dental Consultation'
    };
  };

  const handleCommitDetectedSchedule = async () => {
    if (detectedScheduleItems.length === 0) return;

    let firstConsultId: string | null = null;

    for (let i = 0; i < detectedScheduleItems.length; i++) {
      const item = detectedScheduleItems[i];
      const names = item.patientName.split(' ');
      const firstName = names[0] || 'Patient';
      const lastName = names.slice(1).join(' ') || `${i + 1}`;
      const consultId = `sched-${Date.now()}-${i}`;

      if (!firstConsultId) {
        firstConsultId = consultId;
      }

      const newConsultation: Consultation = {
        id: consultId,
        dentistId: currentUser?.id || '',
        clinicId: activeClinicId || undefined,
        firstName,
        lastName,
        dob: item.dob || '',
        appointmentType: item.appointmentType || 'examination',
        templateId: item.templateId || 'standard',
        date: currentDateStr,
        time: item.time,
        status: 'In Review',
        patientSummary: '',
        transcript: [],
        findings: {
          chiefComplaint: item.procedureText,
          history: '',
          toothFindings: '',
          findingsGingival: '',
          diagnosis: '',
          treatmentPerformed: '',
          recommendations: '',
          recallRequirements: '',
          customSections: { operatory: item.room || `Room ${(i % 3) + 1}` },
          adaCodes: []
        }
      };

      if (onSaveConsultation) {
        await onSaveConsultation(newConsultation);
      }

      addScheduleItem({
        time: item.time,
        patientName: `${firstName} ${lastName}`,
        dob: item.dob || '',
        procedureText: item.procedureText,
        appointmentType: item.appointmentType || 'examination',
        templateId: item.templateId || 'standard'
      });
    }

    if (firstConsultId && !activePatientId) {
      handleSelectPatient(firstConsultId);
    }

    setDetectedScheduleItems([]);
    setSchedulePreviewImage(null);
    setShowDaysheetModal(false);
    setPmsImportNotice(true);
    playMedicalChime('start');
    setTimeout(() => setPmsImportNotice(false), 3500);
  };

  const handleParseAndImportDaysheet = async () => {
    if (!daysheetRawText.trim()) {
      setShowDaysheetModal(false);
      return;
    }

    const lines = daysheetRawText.split('\n').map(l => l.trim()).filter(Boolean);
    let firstConsultId: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const parsed = parseDaysheetLine(line);
      const names = parsed.patientName.split(' ');
      const firstName = names[0] || 'Patient';
      const lastName = names.slice(1).join(' ') || `${i + 1}`;
      const consultId = `sched-${Date.now()}-${i}`;

      if (!firstConsultId) {
        firstConsultId = consultId;
      }

      const newConsultation: Consultation = {
        id: consultId,
        dentistId: currentUser?.id || '',
        clinicId: activeClinicId || undefined,
        firstName,
        lastName,
        dob: parsed.dob || '',
        appointmentType: 'restorative',
        templateId: 'standard',
        date: currentDateStr,
        time: parsed.time,
        status: 'In Review',
        patientSummary: '',
        transcript: [],
        findings: {
          chiefComplaint: parsed.procedure,
          history: '',
          toothFindings: '',
          findingsGingival: '',
          diagnosis: '',
          treatmentPerformed: '',
          recommendations: '',
          recallRequirements: '',
          customSections: { operatory: `Room ${(i % 3) + 1}` },
          adaCodes: []
        }
      };

      if (onSaveConsultation) {
        await onSaveConsultation(newConsultation);
      }

      addScheduleItem({
        time: parsed.time,
        patientName: `${firstName} ${lastName}`,
        dob: parsed.dob || '',
        procedureText: parsed.procedure,
        appointmentType: 'restorative',
        templateId: 'standard'
      });
    }

    if (firstConsultId && !activePatientId) {
      handleSelectPatient(firstConsultId);
    }

    setDaysheetRawText('');
    setShowDaysheetModal(false);
    setPmsImportNotice(true);
    playMedicalChime('start');
    setTimeout(() => setPmsImportNotice(false), 3500);
  };

  // ─────────────────────────────────────────────────────────────
  // 5. QUICK WALK-IN ENTRY (WITH DOB & ROOM)
  // ─────────────────────────────────────────────────────────────
  const [showWalkInCard, setShowWalkInCard] = useState(false);
  const [walkInName, setWalkInName] = useState('');
  const [walkInDob, setWalkInDob] = useState('');
  const [walkInRoom, setWalkInRoom] = useState('Room 1');
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
      dentistId: currentUser?.id || '',
      clinicId: activeClinicId || undefined,
      firstName,
      lastName,
      dob: walkInDob.trim(),
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
        customSections: { operatory: walkInRoom },
        adaCodes: []
      }
    };

    if (onSaveConsultation) {
      await onSaveConsultation(newConsultation);
    }

    addScheduleItem({
      time: cleanTime,
      patientName: `${firstName} ${lastName}`,
      dob: walkInDob.trim(),
      procedureText: `Emergency • ${walkInReason || 'Evaluation'}`,
      appointmentType: 'emergency',
      templateId: 'emergency'
    });

    handleSelectPatient(newConsultation.id);
    setWalkInName('');
    setWalkInDob('');
    setWalkInReason('');
    setShowWalkInCard(false);
  };

  const handleUpdateAppointmentType = (targetId: string, newType: AppointmentType) => {
    const typeInfo = APPOINTMENT_TYPES.find(t => t.value === newType);
    const newTemplateId = typeInfo?.defaultTemplateId || 'standard';

    const targetConsult = consultations.find(c => c.id === targetId);
    if (targetConsult && onSaveConsultation) {
      const updatedConsult: Consultation = {
        ...targetConsult,
        appointmentType: newType,
        templateId: newTemplateId
      };
      onSaveConsultation(updatedConsult);
    }
  };

  const handleQuickInductPatient = useCallback(async (data: { patientName: string; dob?: string; operatory?: string; appointmentType?: AppointmentType }) => {
    const names = data.patientName.trim().split(' ');
    const firstName = names[0] || 'Patient';
    const lastName = names.slice(1).join(' ');
    const cleanTime = formatClinicTime(new Date());

    const targetEncounter = activeEncounter || effectiveEncounter;
    const existingConsult = targetEncounter ? consultations.find(c => c.id === targetEncounter.id) : undefined;
    const hasAudio = targetEncounter && (localLiveTranscriptsRef.current[targetEncounter.id]?.length || targetEncounter.diarizedTranscript?.length);

    // If active consultation is fresh without recorded audio, rename & reassign in-place
    if (existingConsult && !hasAudio && existingConsult.status !== 'Completed') {
      const updatedConsult: Consultation = {
        ...existingConsult,
        firstName,
        lastName,
        dob: data.dob || existingConsult.dob,
        appointmentType: data.appointmentType || existingConsult.appointmentType,
        findings: {
          ...existingConsult.findings,
          customSections: {
            ...existingConsult.findings?.customSections,
            operatory: data.operatory || existingConsult.findings?.customSections?.operatory || 'Room 1'
          }
        }
      };
      if (onSaveConsultation) {
        await onSaveConsultation(updatedConsult);
      }
      setTurnoverToast(`Patient updated: ${data.patientName}`);
      return;
    }

    // Otherwise create and activate a new walk-in patient
    const newConsultation: Consultation = {
      id: `patient-${Date.now()}`,
      dentistId: currentUser?.id,
      clinicId: activeClinicId || undefined,
      firstName,
      lastName,
      dob: data.dob,
      appointmentType: data.appointmentType || 'examination',
      templateId: data.appointmentType === 'emergency' ? 'emergency' : 'standard',
      date: getClinicTodayIso(),
      time: cleanTime,
      status: 'In Review',
      patientSummary: '',
      transcript: [],
      findings: {
        chiefComplaint: '',
        history: '',
        toothFindings: '',
        findingsGingival: '',
        diagnosis: '',
        treatmentPerformed: '',
        recommendations: '',
        recallRequirements: '',
        customSections: { operatory: data.operatory || 'Room 1' },
        adaCodes: []
      }
    };

    if (onSaveConsultation) {
      await onSaveConsultation(newConsultation);
    }

    addScheduleItem({
      time: cleanTime,
      patientName: data.patientName,
      dob: data.dob,
      procedureText: `${(data.appointmentType || 'examination').charAt(0).toUpperCase() + (data.appointmentType || 'examination').slice(1)} • Clinical Consult`,
      appointmentType: data.appointmentType || 'examination',
      templateId: data.appointmentType === 'emergency' ? 'emergency' : 'standard'
    });

    handleSelectPatient(newConsultation.id);
    setTurnoverToast(`In-chair patient set: ${data.patientName}`);
  }, [activeEncounter, effectiveEncounter, consultations, onSaveConsultation, currentUser, activeClinicId, addScheduleItem, handleSelectPatient]);

  // ─────────────────────────────────────────────────────────────
  // 6. ASYNCHRONOUS NOTE FINALIZATION & NON-BLOCKING HANDOFF
  // ─────────────────────────────────────────────────────────────
  const executeBackgroundNoteFinalization = async (targetId: string, autoCopyClipboard = false) => {
    try {
      await flushPendingConsultationSave();
      const targetConsult: Consultation = consultations.find(c => c.id === targetId) || {
        id: targetId,
        dentistId: currentUser?.id,
        dentistName: dentistName || 'Attending Clinician',
        firstName: effectiveEncounter.patientName || 'In-Chair Patient',
        lastName: '',
        dob: effectiveEncounter.dob || '',
        date: currentDateStr,
        time: effectiveEncounter.time || formatClinicTime(new Date()),
        status: 'Completed',
        appointmentType: effectiveEncounter.appointmentType || 'examination',
        templateId: 'standard',
        transcript: (localLiveTranscriptsRef.current[targetId] || localLiveTranscripts[targetId] || effectiveEncounter.diarizedTranscript || []).map(t => ({
          sender: (t.role === 'patient' || (t as any).sender === 'Patient' ? 'Patient' : t.role === 'dentist' || (t as any).sender === 'Dentist' ? 'Dentist' : 'Dialogue') as TranscriptItem['sender'],
          text: t.text
        })),
        findings: {
          chiefComplaint: '',
          history: '',
          toothFindings: '',
          findingsGingival: '',
          diagnosis: '',
          treatmentPerformed: '',
          recommendations: '',
          recallRequirements: '',
          adaCodes: []
        },
        patientSummary: ''
      };

      const template = getTemplateById(targetConsult.templateId || 'standard');

      // Guarantee 0 lost lines: Merge in-memory local feed with persisted consultation transcript
      const localFeed = localLiveTranscriptsRef.current[targetId] || localLiveTranscripts[targetId] || [];
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

      // Ensure all transcript senders conform to allowed roles before network transmission
      const sanitizedTranscript = finalTranscript.map(t => {
        let sender = t.sender || 'Dialogue';
        if (!['Dentist', 'Patient', 'Dialogue', 'Clinical Comment'].includes(sender)) {
          sender = 'Dialogue';
        }
        return { sender, text: t.text || '' };
      });

      // Call real backend note generation endpoint
      let payload: any = null;
      if (authToken) {
        // Tier 1: Fast direct synchronous generation (~1.3s response)
        try {
          const directRes = await fetch('/api/generate-notes', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
              intakeData: {
                firstName: targetConsult.firstName,
                lastName: targetConsult.lastName,
                dob: targetConsult.dob || '',
                appointmentType: targetConsult.appointmentType,
                templateId: template.id
              },
              transcript: sanitizedTranscript
            })
          });

          if (directRes.ok) {
            payload = await directRes.json();
          } else {
            console.info(`Direct note generation status: ${directRes.status}, falling back to background job queue.`);
          }
        } catch (directErr) {
          console.warn('Direct note generation fetch failed, falling back to background job queue:', directErr);
        }

        // Tier 2: Resilient background worker job queue with 25s polling deadline
        if (!payload) {
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
                  dob: targetConsult.dob || '',
                  appointmentType: targetConsult.appointmentType,
                  templateId: template.id
                },
                transcript: sanitizedTranscript,
                consultationId: targetConsult.id
              })
            });

            if (res.ok) {
              const jobData = await res.json();
              const deadline = Date.now() + 25_000;
              while (Date.now() < deadline) {
                await new Promise(r => setTimeout(r, 600));
                const pollRes = await fetch(`/api/notes/jobs/${jobData.jobId}`, {
                  headers: { 'Authorization': `Bearer ${authToken}` }
                });
                if (pollRes.ok) {
                  const jobState = await pollRes.json();
                  if (jobState.status === 'done' && jobState.result) {
                    payload = jobState.result;
                    break;
                  }
                  if (jobState.status === 'failed') {
                    console.warn('Note job generation failed on server:', jobState.error);
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
      }

      // Offline deterministic Australian Macro Engine
      if (!payload) {
        const macroNote = generateMacroNote(finalTranscript, template.id, targetConsult.appointmentType);
        const draft = generateOfflineDraft(template, finalTranscript, `${targetConsult.firstName || ''} ${targetConsult.lastName || ''}`.trim());
        payload = {
          chiefComplaint: macroNote.chiefComplaint || draft.canonical.chiefComplaint || '',
          history: macroNote.history || draft.canonical.history || '',
          toothFindings: macroNote.toothFindings || draft.canonical.toothFindings || '',
          findingsGingival: macroNote.findingsGingival || draft.canonical.findingsGingival || '',
          diagnosis: macroNote.diagnosis || draft.canonical.diagnosis || '',
          treatmentPerformed: macroNote.treatmentPerformed || draft.canonical.treatmentPerformed || '',
          recommendations: macroNote.recommendations || draft.canonical.recommendations || '',
          recallRequirements: macroNote.recallRequirements || draft.canonical.recallRequirements || '',
          customSections: {
            subjective: macroNote.chiefComplaint || draft.canonical.chiefComplaint || '',
            objective: macroNote.toothFindings || draft.canonical.toothFindings || '',
            assessment: macroNote.diagnosis || draft.canonical.diagnosis || '',
            plan: macroNote.treatmentPerformed || draft.canonical.treatmentPerformed || '',
            ...(draft.customSections || {})
          },
          adaCodes: macroNote.adaCodes.length ? macroNote.adaCodes : draft.adaCodes,
          patientSummary: macroNote.patientSummary || draft.patientSummary,
          missingProtocolNotices: macroNote.missingProtocolNotices,
        };
      }

      // Nothing here is invented. Every section falls back to whatever is already
      // on the record, and then to empty — because these fields are the clinical
      // record. The previous boilerplate ("Teeth examined and stable.", "Gingiva
      // stable.", "Procedure completed.") meant that an empty generation produced
      // a saved note asserting an examination and a procedure that may never have
      // happened. An empty field is visibly unfinished; a fabricated one is not.
      const updatedFindings: ClinicalFindings = {
        chiefComplaint: payload?.chiefComplaint || (payload as any)?.subjective || payload?.customSections?.subjective || targetConsult.findings?.chiefComplaint || '',
        history: payload?.history || targetConsult.findings?.history || '',
        toothFindings: payload?.toothFindings || (payload as any)?.objective || payload?.customSections?.objective || targetConsult.findings?.toothFindings || '',
        findingsGingival: payload?.findingsGingival || targetConsult.findings?.findingsGingival || '',
        diagnosis: payload?.diagnosis || (payload as any)?.assessment || payload?.customSections?.assessment || targetConsult.findings?.diagnosis || '',
        treatmentPerformed: payload?.treatmentPerformed || (payload as any)?.plan || payload?.customSections?.plan || targetConsult.findings?.treatmentPerformed || '',
        recommendations: payload?.recommendations || targetConsult.findings?.recommendations || '',
        recallRequirements: payload?.recallRequirements || targetConsult.findings?.recallRequirements || '',
        customSections: {
          subjective: payload?.chiefComplaint || (payload as any)?.subjective || payload?.customSections?.subjective || '',
          objective: payload?.toothFindings || (payload as any)?.objective || payload?.customSections?.objective || '',
          assessment: payload?.diagnosis || (payload as any)?.assessment || payload?.customSections?.assessment || '',
          plan: payload?.treatmentPerformed || (payload as any)?.plan || payload?.customSections?.plan || '',
          ...(payload?.customSections || targetConsult.findings?.customSections || {})
        },
        adaCodes: payload?.adaCodes?.length ? payload.adaCodes : targetConsult.findings?.adaCodes || []
      };

      const isHostedNote = Boolean(payload && payload.groundingReport);
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
        findings: updatedFindings,
        specialistReferral: payload?.specialistReferral || targetConsult.specialistReferral,
        patientConsent: payload?.patientConsent || targetConsult.patientConsent,
        treatmentQuote: payload?.treatmentQuote || targetConsult.treatmentQuote,
        noteOrigin: {
          engine: isHostedNote ? (payload?.noteOrigin?.engine || 'groq') : 'offline-draft',
          needsReview: isHostedNote ? !payload?.groundingReport?.isFullyGrounded : false,
          detail: payload?.groundingReport?.summary || (isHostedNote ? `Generated via ${payload?.noteOrigin?.engine || 'cloud AI'}` : 'Generated via Australian clinical macro engine.')
        },
        grounding: payload?.groundingReport
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

  // 1-Tap Australian Procedure Macro Application
  const handleApplyMacro = async (macroId: string) => {
    const targetEncounter = activeEncounter || effectiveEncounter;
    const targetConsult: Consultation = consultations.find(c => c.id === targetEncounter.id) || {
      id: targetEncounter.id,
      dentistId: currentUser?.id,
      dentistName: dentistName || 'Attending Clinician',
      firstName: targetEncounter.patientName || 'Patient',
      lastName: '',
      dob: '',
      date: currentDateStr,
      time: targetEncounter.time || formatClinicTime(new Date()),
      status: 'Completed',
      appointmentType: targetEncounter.appointmentType || 'examination',
      templateId: 'standard',
      transcript: (localLiveTranscriptsRef.current[targetEncounter.id] || targetEncounter.diarizedTranscript || []).map(t => ({
        sender: (t.role === 'patient' ? 'Patient' : t.role === 'dentist' ? 'Dentist' : 'Dialogue') as TranscriptItem['sender'],
        text: t.text
      })),
      findings: {
        chiefComplaint: '',
        history: '',
        toothFindings: '',
        findingsGingival: '',
        diagnosis: '',
        treatmentPerformed: '',
        recommendations: '',
        recallRequirements: '',
        adaCodes: []
      },
      patientSummary: ''
    };

    const transcriptToUse = (localLiveTranscriptsRef.current[targetConsult.id] || targetConsult.transcript || []).map(t => ({
      sender: (t.sender === 'Patient' ? 'Patient' : t.sender === 'Dialogue' ? 'Dialogue' : 'Dentist') as TranscriptItem['sender'],
      text: t.text
    }));

    const macroNote = generateMacroNote(transcriptToUse, macroId, targetConsult.appointmentType);

    const existingFindings = targetConsult.findings || {
      chiefComplaint: '',
      history: '',
      toothFindings: '',
      findingsGingival: '',
      diagnosis: '',
      treatmentPerformed: '',
      recommendations: '',
      recallRequirements: '',
      adaCodes: []
    };

    // Smart merge: retain spoken findings while incorporating macro procedure steps
    const mergedComplaint = existingFindings.chiefComplaint 
      ? (macroNote.chiefComplaint && !existingFindings.chiefComplaint.includes(macroNote.chiefComplaint)
          ? `${existingFindings.chiefComplaint}. ${macroNote.chiefComplaint}`
          : existingFindings.chiefComplaint)
      : macroNote.chiefComplaint;

    const mergedToothFindings = existingFindings.toothFindings
      ? (macroNote.toothFindings && !existingFindings.toothFindings.includes(macroNote.toothFindings)
          ? `${existingFindings.toothFindings}\n${macroNote.toothFindings}`
          : existingFindings.toothFindings)
      : macroNote.toothFindings;

    const mergedTreatment = existingFindings.treatmentPerformed
      ? (macroNote.treatmentPerformed && !existingFindings.treatmentPerformed.includes(macroNote.treatmentPerformed)
          ? `${existingFindings.treatmentPerformed}\n${macroNote.treatmentPerformed}`
          : existingFindings.treatmentPerformed)
      : macroNote.treatmentPerformed;

    const existingCodes = existingFindings.adaCodes || [];
    const macroCodes = macroNote.adaCodes || [];
    const mergedCodes = [...existingCodes];
    for (const mc of macroCodes) {
      if (!mergedCodes.some(c => c.code === mc.code && c.tooth === mc.tooth)) {
        mergedCodes.push(mc);
      }
    }

    const updatedFindings: ClinicalFindings = {
      ...existingFindings,
      chiefComplaint: mergedComplaint,
      history: existingFindings.history || macroNote.history,
      toothFindings: mergedToothFindings,
      findingsGingival: existingFindings.findingsGingival || macroNote.findingsGingival,
      diagnosis: existingFindings.diagnosis || macroNote.diagnosis,
      treatmentPerformed: mergedTreatment,
      recommendations: existingFindings.recommendations || macroNote.recommendations,
      recallRequirements: existingFindings.recallRequirements || macroNote.recallRequirements,
      customSections: {
        ...(existingFindings.customSections || {}),
        subjective: mergedComplaint,
        objective: mergedToothFindings,
        assessment: existingFindings.diagnosis || macroNote.diagnosis,
        plan: mergedTreatment,
      },
      adaCodes: mergedCodes,
    };

    const updatedConsultation: Consultation = {
      ...targetConsult,
      status: 'Completed',
      patientSummary: macroNote.patientSummary,
      findings: updatedFindings,
      noteOrigin: {
        engine: 'australian-clinical-macro' as any,
        needsReview: false,
        detail: `Generated via Australian ${macroNote.title} Macro`
      }
    };

    if (onSaveConsultation) {
      await onSaveConsultation(updatedConsultation);
    }

    setEditedProgressNotes(prev => {
      const next = { ...prev };
      delete next[targetConsult.id];
      return next;
    });

    setProgressiveDrafts(prev => {
      const next = { ...prev };
      delete next[targetConsult.id];
      return next;
    });
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
      setTurnoverToast('Prior patient note saved to End of Day Notes — ready for batch copy.');
    }
  };

  const handlePrevPatient = () => {
    const currentIndex = encountersForDate.findIndex(p => p.id === activePatientId);
    if (currentIndex <= 0) return;
    const prevPatient = encountersForDate[currentIndex - 1];

    if (prevPatient) {
      if (!isMicStandbyRef.current) {
        playMedicalChime('stop');
      }
      setActivePatientId(prevPatient.id);
      sessionStartTimeRef.current = Date.now();
      setRecordingSeconds(0);
      setIsMicStandby(true);
      setIsPaused(false);
      setInterimTranscript('');
    }
  };

  // Completed Encounters for End-of-Day Batch Tray
  const completedEncounters = useMemo(() => {
    return encountersForDate.filter(p => p.status === 'note_generated' || p.status === 'done' || p.status === 'ready');
  }, [encountersForDate]);

  const [selectedPmsTarget, setSelectedPmsTarget] = useState<'d4w' | 'exact' | 'cliniko' | 'generic'>('d4w');

  // Generate note text formatted for PMS clipboard (incorporating clinician inline edits & PMS adapter)
  const getFormattedNoteText = useCallback((consultToCopy?: Consultation): string => {
    const targetId = activeEncounter?.id || effectiveEncounter.id;
    const fallbackConsult: Consultation = {
      id: effectiveEncounter.id,
      firstName: effectiveEncounter.patientName,
      lastName: '',
      dob: effectiveEncounter.dob || '',
      date: currentDateStr,
      time: effectiveEncounter.time,
      appointmentType: effectiveEncounter.appointmentType || 'examination',
      status: 'Completed',
      templateId: 'standard',
      transcript: (localLiveTranscriptsRef.current[effectiveEncounter.id] || localLiveTranscripts[effectiveEncounter.id] || []).map(i => ({ sender: (i.sender || 'Dentist') as any, text: i.text })),
      findings: {
        chiefComplaint: '',
        history: '',
        toothFindings: '',
        findingsGingival: '',
        diagnosis: '',
        treatmentPerformed: '',
        recommendations: '',
        recallRequirements: '',
        adaCodes: []
      },
      patientSummary: ''
    };
    const target = consultToCopy || consultations.find(c => c.id === targetId) || activeConsult || fallbackConsult;
    if (!target) return '';

    // 1. If clinician actively authored/edited the progress note directly in the text box, return that exact text!
    if (targetId && editedProgressNotes[targetId] !== undefined) {
      return editedProgressNotes[targetId];
    }
    // 2. If progressive speech draft exists for this target, return it
    if (targetId && progressiveDrafts[targetId]) {
      return progressiveDrafts[targetId];
    }
    // 3. If the consultation already has a saved progress note, return it
    if (target.clinicalProgressNote && target.clinicalProgressNote.trim().length > 0) {
      return target.clinicalProgressNote;
    }

    // 4. Grounding Integrity Guard (Rule 12 & Rule 18):
    // If this is the generic in-chair scratchpad (chair-active) or an encounter with NO transcript audio in the current session:
    const isGenericChairActive = targetId === 'chair-active' || target.id === 'chair-active';
    const transcriptList = localLiveTranscriptsRef.current[targetId] || localLiveTranscripts[targetId] || (isGenericChairActive ? [] : (target.transcript || []));
    const hasAudio = transcriptList.length > 0;
    const isMacroOrigin = !isGenericChairActive && target.noteOrigin?.engine === 'australian-clinical-macro';
    const isCompleted = !isGenericChairActive && (target.status === 'Completed' || target.status === 'Signed');
    const hasObservedFindings = !isGenericChairActive && Boolean(
      target.findings?.toothFindings?.trim() ||
      target.findings?.chiefComplaint?.trim() ||
      target.findings?.diagnosis?.trim() ||
      target.findings?.treatmentPerformed?.trim()
    );

    if (!hasAudio && !isMacroOrigin && (!isCompleted || !hasObservedFindings)) {
      return '';
    }

    const isCurrentActive = target.id === targetId;
    const subj = target.findings?.chiefComplaint ? `${target.findings.chiefComplaint} ${target.findings.history || ''}` : '';
    const obj = target.findings?.toothFindings ? `${target.findings.toothFindings} ${target.findings.findingsGingival || ''}` : '';
    const assess = target.findings?.diagnosis || '';
    const planText = target.findings?.treatmentPerformed ? `${target.findings.treatmentPerformed} ${target.findings.recommendations || ''}` : '';

    // Construct synthesized consultation snapshot reflecting live clinician edits
    const liveConsult: Consultation = {
      ...target,
      findings: {
        ...target.findings,
        chiefComplaint: subj,
        toothFindings: obj,
        diagnosis: assess,
        treatmentPerformed: planText,
        adaCodes: isCurrentActive && (activeEncounter?.cdtCodes || effectiveEncounter.cdtCodes) ? (activeEncounter?.cdtCodes || effectiveEncounter.cdtCodes)!.map(c => ({ code: c.code, description: c.desc })) : (target.findings?.adaCodes || [])
      }
    };

    try {
      const pmsEncounter = toPmsEncounter(liveConsult);
      return renderUniversalProgressNote(pmsEncounter);
    } catch {
      try {
        return renderUniversalProgressNote(toPmsEncounter(target));
      } catch {
        return '';
      }
    }
  }, [activeEncounter, effectiveEncounter, activeConsult, consultations, currentDateStr, editedProgressNotes, progressiveDrafts]);

  const currentProgressNote = useMemo(() => {
    return getFormattedNoteText();
  }, [getFormattedNoteText]);

  const [copiedPmsTarget, setCopiedPmsTarget] = useState<string | null>(null);

  const PMS_RENDERERS: Record<string, (e: any) => string> = {
    d4w: renderD4W,
    exact: renderExact,
  };

  // Copy Note for Practice Management (Universal PMS, D4W, or Exact)
  const handleCopyPMS = (consultToCopy?: Consultation, format: 'pms' | 'd4w' | 'exact' = 'pms') => {
    const targetId = activeEncounter?.id || effectiveEncounter.id;
    const fallbackConsult: Consultation = {
      id: effectiveEncounter.id,
      firstName: effectiveEncounter.patientName,
      lastName: '',
      dob: effectiveEncounter.dob || '',
      date: currentDateStr,
      time: effectiveEncounter.time,
      appointmentType: effectiveEncounter.appointmentType || 'examination',
      status: 'Completed',
      templateId: 'standard',
      transcript: (localLiveTranscriptsRef.current[effectiveEncounter.id] || localLiveTranscripts[effectiveEncounter.id] || []).map(i => ({ sender: (i.sender || 'Dentist') as any, text: i.text })),
      findings: {
        chiefComplaint: '',
        history: '',
        toothFindings: '',
        findingsGingival: '',
        diagnosis: '',
        treatmentPerformed: '',
        recommendations: '',
        recallRequirements: '',
        adaCodes: []
      },
      patientSummary: ''
    };
    const target = consultToCopy || consultations.find(c => c.id === targetId) || fallbackConsult;
    const renderer = PMS_RENDERERS[format];
    let noteText = '';
    if (renderer && target) {
      try { noteText = renderer(toPmsEncounter(target)); } catch { noteText = getFormattedNoteText(consultToCopy); }
    } else {
      noteText = getFormattedNoteText(consultToCopy);
    }
    if (!noteText) return;

    if (navigator.clipboard) navigator.clipboard.writeText(noteText);
    if (target?.id) setCopiedEncounterIds(prev => new Set(prev).add(target.id));
    setCopiedNote(true);
    setCopiedPmsTarget(format);
    setTimeout(() => {
      setCopiedNote(false);
      setCopiedPmsTarget(null);
    }, 2500);
  };

  const handleCopyD4W = (consultToCopy?: Consultation) => handleCopyPMS(consultToCopy, 'd4w');
  const handleCopyExact = (consultToCopy?: Consultation) => handleCopyPMS(consultToCopy, 'exact');

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
      setCopiedEncounterIds(prev => {
        const next = new Set(prev);
        completedEncounters.forEach(p => next.add(p.id));
        return next;
      });
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

      // Spacebar: Start Audio / Pause Audio / Keep Listening
      if (e.key === ' ' && !isInput && !showDaysheetModal && !showBatchTray && !showDayGuide && !showDeliverablesModal) {
        e.preventDefault();
        if (isSilenceWarningRef.current) {
          handleKeepListening();
        } else if (isMicStandbyRef.current) {
          handleStartAudio();
        } else {
          handleTogglePause();
        }
        return;
      }

      // ⌘→: Advance to Next Patient (hands-free transition without touching mouse)
      if (!isInput && !showDaysheetModal && !showPlainTextModal && !showBatchTray && !showDayGuide && !showDeliverablesModal) {
        if (isModifier && (e.key === 'ArrowRight' || e.key === 'Right')) {
          e.preventDefault();
          handleNextPatient();
          return;
        }
        if (isModifier && (e.key === 'ArrowLeft' || e.key === 'Left')) {
          e.preventDefault();
          handlePrevPatient();
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
      // ⌘C / Ctrl+C / ⌘⇧C: Copy Note for PMS when not focused on an input
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



  return (
    <div className="flex h-screen w-full bg-[#F8F9FA] text-slate-800 font-sans overflow-hidden antialiased select-none">
      {/* ─────────────────────────────────────────────────────────────
          1. GLOBAL TOP SURGERY HEADER
          ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-14 px-6 border-b border-slate-200/80 bg-white flex items-center justify-between flex-shrink-0 z-20 shadow-[0_1px_3px_0_rgba(15,23,42,0.03)]">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#0050A0] to-[#0275E8] text-white flex items-center justify-center shadow-xs ring-1 ring-white/20">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor">
                <path d="M12 2C9 2 7 4 7 7.5c0 3 1.2 6.5 2 9.5.5 2 1.5 3 2.5 3 .6 0 1.2-.5 1.5-1.5.3 1 1 1.5 1.5 1.5 1 0 2-1 2.5-3 .8-3 2-6.5 2-9.5C19 4 17 2 12 2z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-slate-900 text-sm tracking-tight">DentAI</span>
                <span className="text-[10px] bg-sky-50 text-sky-800 font-semibold px-2 py-0.5 rounded-full border border-sky-200/80">Dental Assistant AI</span>
              </div>
              <div className="text-[10px] text-slate-400 font-medium">{activeClinic?.clinicName || 'Chairside Dental Practice'}</div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Direct High-Frequency Operatory Actions */}
            <button
              type="button"
              onClick={() => setShowDeliverablesModal(true)}
              className="px-3 py-1.5 rounded-xl border border-slate-200/90 hover:border-indigo-300 bg-white hover:bg-indigo-50/40 text-slate-700 text-xs font-semibold flex items-center space-x-1.5 shadow-2xs transition cursor-pointer"
              title="Generate specialist referral letters and patient post-op care instructions"
            >
              <FileText className="w-3.5 h-3.5 text-indigo-600" />
              <span>Referral & Handover</span>
            </button>

            <button
              onClick={() => setShowBatchTray(true)}
              className="px-3 py-1.5 rounded-xl border border-slate-200/90 hover:border-teal-300 bg-white hover:bg-teal-50/40 text-slate-700 text-xs font-semibold flex items-center space-x-1.5 shadow-2xs transition cursor-pointer"
              title="Review & Copy Today's Completed Notes (⌘B)"
            >
              <Clipboard className="w-3.5 h-3.5 text-teal-700" />
              <span>End of Day Notes</span>
              <span className="bg-teal-100 text-teal-900 text-[10px] font-bold px-2 py-0.2 rounded-full font-tabular">
                {completedEncounters.length}
              </span>
            </button>

            {/* Streamlined Tools Dropdown (Past Records, Worklist, Guide) */}
            <div className="relative" ref={toolsMenuRef}>
              <button
                type="button"
                onClick={() => setShowToolsMenu(prev => !prev)}
                className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center space-x-1.5 shadow-2xs transition cursor-pointer ${
                  showToolsMenu
                    ? 'bg-slate-100 border-slate-300 text-slate-900'
                    : 'bg-white hover:bg-slate-50 border-slate-200/90 text-slate-700'
                }`}
                title="Practice administration and reference tools"
              >
                <span>Tools</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              </button>

              {showToolsMenu && (
                <div className="absolute right-0 mt-1.5 w-52 bg-white rounded-xl border border-slate-200 shadow-lg py-1 z-50 text-xs">
                  <button
                    onClick={() => {
                      setShowToolsMenu(false);
                      onOpenHistoryHub();
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center space-x-2 text-slate-700 cursor-pointer"
                  >
                    <LayoutDashboard className="w-3.5 h-3.5 text-slate-500" />
                    <span>Past Patient Records</span>
                  </button>

                  {onOpenPipeline && (
                    <button
                      onClick={() => {
                        setShowToolsMenu(false);
                        onOpenPipeline();
                      }}
                      className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center space-x-2 text-slate-700 cursor-pointer"
                    >
                      <TrendingUp className="w-3.5 h-3.5 text-amber-600" />
                      <span>Treatment Worklist</span>
                    </button>
                  )}

                  <div className="h-[1px] bg-slate-100 my-1" />

                  <button
                    onClick={() => {
                      setShowToolsMenu(false);
                      setShowDayGuide(true);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center justify-between text-slate-700 cursor-pointer"
                  >
                    <div className="flex items-center space-x-2">
                      <HelpCircle className="w-3.5 h-3.5 text-sky-600" />
                      <span>Operatory Guide</span>
                    </div>
                    <kbd className="text-[10px] font-mono bg-slate-100 text-slate-500 px-1 py-0.5 rounded border border-slate-200">?</kbd>
                  </button>
                </div>
              )}
            </div>

            <div className="h-6 w-[1px] bg-slate-200/80 mx-1" />

            <div className="text-right">
              <div className="text-xs font-bold text-slate-800">{dentistName || 'Dr. Marcus Vance'}</div>
              <div className="text-[10px] font-medium text-slate-400">Attending Clinician</div>
            </div>
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 text-white font-bold text-xs flex items-center justify-center border border-slate-700 shadow-2xs">
              {dentistName ? dentistName.split(' ').map(n => n[0]).join('').slice(0, 2) : 'MV'}
            </div>
            <button
              onClick={onLogout}
              className="w-8 h-8 rounded-xl hover:bg-rose-50 flex items-center justify-center text-slate-400 hover:text-rose-600 transition cursor-pointer ml-1"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Content Area: 2-Pane Hybrid Split (Left 28% Clinic Day Schedule + Right 72% Apple Clinical Document) */}
        <div className="flex-1 flex flex-row overflow-hidden">
          {/* ─── PANE 1: CLINIC DAY SCHEDULE (Collapsible) ─── */}
          <section className={`flex-shrink-0 bg-white border-r border-slate-200 flex flex-col justify-between overflow-hidden shadow-2xs transition-all duration-200 ${
            isScheduleCollapsed ? 'w-14 items-center py-3' : 'w-[320px]'
          }`}>
            {isScheduleCollapsed ? (
              <div className="flex flex-col items-center space-y-3.5 w-full h-full">
                {/* Expand Toggle Button */}
                <button
                  onClick={handleToggleScheduleCollapse}
                  className="w-9 h-9 rounded-xl border border-slate-200 hover:border-sky-500 bg-slate-50 hover:bg-sky-50 text-slate-600 hover:text-sky-700 flex items-center justify-center transition shadow-2xs cursor-pointer"
                  title="Expand Clinic Day Schedule"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>

                {/* Patient Roster Quick Pill */}
                <div
                  onClick={handleToggleScheduleCollapse}
                  className="flex flex-col items-center py-2 px-1 rounded-xl bg-slate-50 hover:bg-sky-50 border border-slate-200 hover:border-sky-300 cursor-pointer transition shadow-2xs w-10"
                  title={`${encountersForDate.length} patients scheduled today. Click to expand.`}
                >
                  <Calendar className="w-3.5 h-3.5 text-slate-500 mb-1" />
                  <span className="text-[10px] font-bold text-slate-700">
                    {Math.max(1, encountersForDate.findIndex(p => p.id === activePatientId) + 1)}/{Math.max(1, encountersForDate.length)}
                  </span>
                </div>

                {/* Quick Walk-In Button */}
                <button
                  onClick={() => {
                    setIsScheduleCollapsed(false);
                    setShowWalkInCard(true);
                  }}
                  className="w-8 h-8 rounded-lg border border-slate-200 hover:border-sky-400 bg-white text-slate-600 hover:text-sky-700 flex items-center justify-center shadow-2xs transition cursor-pointer"
                  title="Add Walk-In Patient"
                >
                  <Plus className="w-4 h-4" />
                </button>

                {/* Quick Paste Button */}
                <button
                  onClick={handleOpenDaysheetModal}
                  className="w-8 h-8 rounded-lg border border-slate-200 hover:border-sky-400 bg-white text-slate-600 hover:text-sky-700 flex items-center justify-center shadow-2xs transition cursor-pointer"
                  title="Paste Schedule (⌘V)"
                >
                  <Clipboard className="w-3.5 h-3.5" />
                </button>

                {/* Vertical Label */}
                <div
                  onClick={handleToggleScheduleCollapse}
                  className="flex-1 flex items-center justify-center cursor-pointer select-none"
                >
                  <span className="text-[10px] font-bold tracking-widest text-slate-400 hover:text-slate-600 uppercase -rotate-90 whitespace-nowrap">
                    Day Schedule
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-3.5 space-y-3 custom-scrollbar">
                {/* Schedule Title & Import Actions */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-1.5">
                      <button
                        onClick={handleToggleScheduleCollapse}
                        className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                        title="Collapse Day Schedule"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Day Schedule</h3>
                    </div>
                    <div className="flex items-center space-x-1">
                    <button
                      onClick={handlePrevDay}
                      className="text-slate-400 hover:text-slate-800 p-0.5 rounded cursor-pointer transition"
                      title="Previous Day"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <span
                      onClick={() => setCurrentDate(new Date())}
                      className="text-[11px] font-bold text-slate-700 cursor-pointer hover:text-sky-600 transition"
                      title="Reset to today"
                    >
                      {dateLabel}
                    </span>
                    <button
                      onClick={handleNextDay}
                      className="text-slate-400 hover:text-slate-800 p-0.5 rounded cursor-pointer transition"
                      title="Next Day"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleOpenDaysheetModal}
                    className="w-full py-1.5 px-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-between shadow-2xs transition cursor-pointer"
                    title="Import Today's Schedule (⌘V)"
                  >
                    <div className="flex items-center space-x-1.5 truncate">
                      <Clipboard className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
                      <span className="truncate">Paste Schedule</span>
                    </div>
                    <span className="bg-slate-800 text-slate-300 text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border border-slate-700 ml-1">
                      ⌘V
                    </span>
                  </button>
                </div>
              </div>

              {/* Quick Walk-In Entry Inline Card */}
              {showWalkInCard && (
                <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-800">
                      <User className="w-3.5 h-3.5 text-sky-700" />
                      <span>Add Walk-In Patient</span>
                    </div>
                    <button
                      onClick={() => setShowWalkInCard(false)}
                      className="text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <input
                    type="text"
                    value={walkInName}
                    onChange={e => setWalkInName(e.target.value)}
                    placeholder="Patient Name (e.g. John Smith)"
                    className="w-full px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600 bg-slate-50/50"
                  />

                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      type="text"
                      value={walkInDob}
                      onChange={e => setWalkInDob(e.target.value)}
                      placeholder="DOB (DD/MM/YYYY)"
                      className="w-full px-2.5 py-1 text-[11px] font-medium border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600 bg-slate-50/50"
                    />

                    <select
                      value={walkInRoom}
                      onChange={e => setWalkInRoom(e.target.value)}
                      className="w-full px-2 py-1 text-[11px] font-medium border border-slate-200 rounded-lg bg-slate-50/50 text-slate-700"
                    >
                      <option value="Room 1">Room 1</option>
                      <option value="Room 2">Room 2</option>
                      <option value="Room 3">Room 3</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-1 gap-1.5">
                    <select
                      value={walkInTime}
                      onChange={e => setWalkInTime(e.target.value)}
                      className="w-full px-2 py-1 text-[11px] font-medium border border-slate-200 rounded-lg bg-slate-50/50 text-slate-700"
                    >
                      <option value={`Now (${formatClinicTime(new Date())})`}>Now ({formatClinicTime(new Date())})</option>
                      <option value={formatClinicTime(new Date(Date.now() + 15 * 60000))}>{formatClinicTime(new Date(Date.now() + 15 * 60000))}</option>
                      <option value={formatClinicTime(new Date(Date.now() + 30 * 60000))}>{formatClinicTime(new Date(Date.now() + 30 * 60000))}</option>
                    </select>
                  </div>

                  <input
                    type="text"
                    value={walkInReason}
                    onChange={e => setWalkInReason(e.target.value)}
                    placeholder="Chief Complaint / Reason"
                    className="w-full px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600 bg-slate-50/50"
                  />

                  <button
                    onClick={handleAddWalkInToStream}
                    disabled={!walkInName.trim()}
                    className="w-full py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-bold transition shadow-xs cursor-pointer"
                  >
                    + Add Walk-In Patient
                  </button>
                </div>
              )}

              {/* Patient Schedule List */}
              <div className="space-y-2">
                {encountersForDate.length === 0 ? (
                  <div className="p-4 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50/50 space-y-2.5">
                    <Calendar className="w-6 h-6 text-slate-400 mx-auto" />
                    <div>
                      <p className="text-xs font-semibold text-slate-700">No appointments scheduled</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Operatory is ready for in-chair consultation.
                      </p>
                    </div>

                    <div className="pt-1 flex flex-col gap-1.5">
                      <button
                        onClick={() => setShowWalkInCard(true)}
                        className="w-full py-1.5 px-2.5 rounded-lg bg-white border border-slate-200 hover:border-sky-400 text-xs font-semibold text-slate-700 hover:text-sky-700 transition shadow-2xs cursor-pointer"
                      >
                        + Add Walk-In Patient
                      </button>

                      {latestConsultDate && latestDateLabel && (
                        <button
                          onClick={() => setCurrentDate(latestConsultDate)}
                          className="w-full py-1.5 px-2.5 rounded-lg bg-sky-50 border border-sky-200 hover:bg-sky-100 text-xs font-semibold text-sky-800 transition shadow-2xs cursor-pointer"
                        >
                          Jump to Latest Visits ({latestDateLabel}) →
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  encountersForDate.map(p => {
                    const isActive = p.id === activePatientId;

                    return (
                      <div
                        key={p.id}
                        onClick={() => handleSelectPatient(p.id)}
                        className={`p-3 rounded-xl border transition cursor-pointer text-left ${isActive
                          ? 'bg-sky-50/70 border-sky-300/80 border-l-4 border-l-sky-600 shadow-xs ring-1 ring-sky-300/40'
                          : 'bg-white hover:bg-slate-50/80 border-slate-200/80 shadow-2xs'
                          }`}
                      >
                        <div className="flex items-start justify-between mb-1">
                          <div className="text-[11px] font-mono text-slate-500 font-tabular">
                            {p.time} • <span className="text-slate-700 font-semibold">{p.operatory?.replace(/Op /i, 'Room ') || 'Room 1'}</span>
                          </div>

                          {p.status === 'done' ? (
                            <span className="bg-emerald-50 text-emerald-800 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-emerald-200/90 flex items-center gap-1 shadow-2xs">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              <span>Done</span>
                            </span>
                          ) : p.status === 'recording' || (isActive && !isMicStandby && !isPaused) ? (
                            <span className="bg-rose-50 text-rose-800 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-rose-200/90 flex items-center gap-1 shadow-2xs">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                              <span>Recording ({formatTimer(recordingSeconds)})</span>
                            </span>
                          ) : p.status === 'processing' ? (
                            <span className="bg-amber-50 text-amber-800 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-amber-200/90 flex items-center gap-1 shadow-2xs">
                              <RefreshCw className="w-3 h-3 text-amber-600 animate-spin" />
                              <span>Generating...</span>
                            </span>
                          ) : p.status === 'recreate' ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                executeBackgroundNoteFinalization(p.id, false);
                              }}
                              className="bg-rose-50 hover:bg-rose-100 text-rose-800 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-rose-200 flex items-center gap-1 transition-colors cursor-pointer"
                              title="Note generation had an issue. Click to recreate note."
                            >
                              <RotateCw className="w-3 h-3 text-rose-600" />
                              <span>Recreate</span>
                            </button>
                          ) : p.status === 'note_generated' ? (
                            <span className="bg-teal-50 text-teal-800 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-teal-200/90 flex items-center gap-1 shadow-2xs">
                              <Sparkles className="w-3 h-3 text-teal-600" />
                              <span>Note Generated</span>
                            </span>
                          ) : isActive && isPaused ? (
                            <span className="bg-amber-50 text-amber-800 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-amber-200/90 flex items-center gap-1 shadow-2xs">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                              <span>Paused</span>
                            </span>
                          ) : isActive ? (
                            <span className="bg-sky-50 text-sky-800 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-sky-200/90 flex items-center gap-1 shadow-2xs">
                              <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                              <span>In Chair</span>
                            </span>
                          ) : p.diarizedTranscript && p.diarizedTranscript.length > 0 ? (
                            <span className="bg-emerald-50 text-emerald-800 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-emerald-200/90 flex items-center gap-1 shadow-2xs">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              <span>Live ({p.diarizedTranscript.length})</span>
                            </span>
                          ) : (
                            <span className="bg-slate-100/90 text-slate-600 text-[10px] font-medium px-2 py-0.5 rounded-full border border-slate-200/70">
                              {p.id === encountersForDate.find(o => o.id !== activePatientId && o.status !== 'done' && o.status !== 'note_generated')?.id ? 'Up Next' : 'Ready'}
                            </span>
                          )}
                        </div>

                        <h3 className={`text-sm font-semibold tracking-tight mb-0.5 ${isActive ? 'text-sky-950 font-bold' : 'text-slate-800'}`}>
                          {p.patientName}
                        </h3>
                        <p className="text-xs text-slate-600 leading-relaxed truncate">
                          {p.procedureText}
                        </p>
                      </div>
                    );
                  }))}
              </div>
            </div>
            )}
          </section>

          {/* ─── PANE 2: OPERATORY WORKSPACE COLUMN (MAIN + PINNED FOOTBAR) ─── */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-50/70">
            <main className="flex-1 flex flex-col overflow-y-auto p-4 space-y-3 custom-scrollbar">
              {/* Operatory Patient Demographics & Action Banner */}
              <OperatoryPatientBanner
                encounter={{
                  id: effectiveEncounter.id,
                  patientName: effectiveEncounter.patientName,
                  dob: effectiveEncounter.dob,
                  operatory: effectiveEncounter.operatory,
                  time: effectiveEncounter.time,
                  appointmentType: effectiveEncounter.appointmentType,
                  alerts: effectiveEncounter.alerts,
                }}
                currentIndex={Math.max(0, encountersForDate.findIndex(p => p.id === activePatientId))}
                totalEncounters={Math.max(1, encountersForDate.length)}
                onSelectPrev={handlePrevPatient}
                onSelectNext={handleNextPatient}
                onOpenDaysheet={handleOpenDaysheetModal}
                onOpenWalkIn={() => setShowWalkInCard(true)}
                onUpdateAppointmentType={(type) => handleUpdateAppointmentType(effectiveEncounter.id, type)}
                onQuickInductPatient={handleQuickInductPatient}
              />

              {/* Main Two-Panel Adaptive Split: Left (Live Speech & Mic HUD) / Right (Note Canvas & PMS Sync) */}
              <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0">
                <LiveConversationPanel
                  transcript={activeEncounterTranscript}
                  interimTranscript={interimTranscript}
                  isMicStandby={isMicStandby}
                  isPaused={isPaused}
                  recordingSeconds={recordingSeconds}
                  isSilenceWarning={isSilenceWarning}
                  silenceSecondsRemaining={silenceSecondsRemaining}
                  dspNoiseGateActive={dspNoiseGateActive}
                  onToggleNoiseGate={() => setDspNoiseGateActive(prev => !prev)}
                  onStartAudio={handleStartAudio}
                  onTogglePause={handleTogglePause}
                  onKeepListening={handleKeepListening}
                  onManualDialogueSubmit={(text) => handleAppendTranscriptText(text, 'Dentist')}
                  waveformRefs={waveformRefs}
                  micListening={micListening}
                  micError={micError}
                />

                <ClinicalNoteEditorPanel
                  activeEncounterId={effectiveEncounter.id}
                  noteText={currentProgressNote}
                  onNoteChange={handleProgressNoteChange}
                  isGenerating={isFinalizing || isGeneratingFromConversation}
                  onGenerateNote={() => executeBackgroundNoteFinalization(effectiveEncounter.id, false)}
                  onApplyMacro={(macroId) => handleApplyMacro(macroId)}
                  onCopyPMS={(format) => handleCopyPMS(undefined, format === 'universal' ? 'pms' : format)}
                  copiedFormat={copiedPmsTarget}
                  onOpenDeliverables={() => setShowDeliverablesModal(true)}
                  onNextPatient={handleNextPatient}
                  hasActualGeneratedNote={Boolean(
                    currentProgressNote.trim().length > 0 &&
                    ((localLiveTranscripts[effectiveEncounter.id]?.length || effectiveEncounter.diarizedTranscript?.length || 0) > 0 ||
                     effectiveEncounter.status === 'done' ||
                     effectiveEncounter.status === 'note_generated' ||
                     consultations.find(c => c.id === effectiveEncounter.id)?.noteOrigin?.engine === 'australian-clinical-macro')
                  )}
                  groundingBadge={
                    (localLiveTranscripts[effectiveEncounter.id]?.length || effectiveEncounter.diarizedTranscript?.length || 0) > 0
                      ? 'Verified from Audio'
                      : consultations.find(c => c.id === effectiveEncounter.id)?.noteOrigin?.engine === 'australian-clinical-macro'
                        ? 'Template Applied'
                        : undefined
                  }
                />
              </div>
            </main>

            {/* Persistent Tactile Aseptic Footbar Pinned at the Absolute Bottom */}
            <AsepticShortcutFootbar
              isRecording={isRecording}
              isPaused={isPaused}
              isMicStandby={isMicStandby}
              isSilenceWarning={isSilenceWarning}
              silenceSecondsRemaining={silenceSecondsRemaining}
              activePatientName={effectiveEncounter.patientName}
              onToggleAudio={isMicStandby ? handleStartAudio : handleTogglePause}
              onNextPatient={handleNextPatient}
              onPrevPatient={handlePrevPatient}
              onCopyPMS={() => handleCopyPMS(undefined, 'd4w')}
            />
          </div>
        </div>
      </div>

      {/* Non-Blocking Turnover Safety Net Toast */}
      {turnoverToast && (
        <div className="fixed bottom-16 right-6 z-50 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <div className="bg-slate-900/95 backdrop-blur-md text-white text-xs font-medium px-4 py-2.5 rounded-xl shadow-xl border border-slate-700/80 flex items-center space-x-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>{turnoverToast}</span>
            <button
              onClick={() => setTurnoverToast(null)}
              className="text-slate-400 hover:text-white ml-2 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Standalone Modal Overlays */}
      <DeliverablesModal
        isOpen={showDeliverablesModal}
        onClose={() => setShowDeliverablesModal(false)}
        activeEncounter={activeEncounter}
        deliverablesActiveTab={deliverablesActiveTab}
        setDeliverablesActiveTab={setDeliverablesActiveTab}
        getReferralText={getReferralText}
        getPostOpText={getPostOpText}
        copiedDeliverable={copiedDeliverable}
        setCopiedDeliverable={setCopiedDeliverable}
      />

      <DaysheetModal
        isOpen={showDaysheetModal}
        onClose={() => setShowDaysheetModal(false)}
        scheduleImportTab={scheduleImportTab}
        setScheduleImportTab={setScheduleImportTab}
        daysheetRawText={daysheetRawText}
        setDaysheetRawText={setDaysheetRawText}
        handleParseAndImportDaysheet={handleParseAndImportDaysheet}
        detectedScheduleItems={detectedScheduleItems}
        setDetectedScheduleItems={setDetectedScheduleItems}
        handleScheduleImageFile={handleScheduleImageFile}
        isScheduleParsing={isScheduleParsing}
        scheduleParsingError={scheduleParsingError}
        setScheduleParsingError={setScheduleParsingError}
        scheduleFileInputRef={scheduleFileInputRef}
        handleCommitDetectedSchedule={handleCommitDetectedSchedule}
        setSchedulePreviewImage={setSchedulePreviewImage}
      />

      <BatchTrayModal
        isOpen={showBatchTray}
        onClose={() => setShowBatchTray(false)}
        completedEncounters={completedEncounters}
        consultations={consultations}
        handleCopyAllBatchNotes={handleCopyAllBatchNotes}
        allBatchCopied={allBatchCopied}
        copiedBatchIndex={copiedBatchIndex}
        setCopiedBatchIndex={setCopiedBatchIndex}
        getFormattedNoteText={getFormattedNoteText}
      />

      <DayGuideModal
        isOpen={showDayGuide}
        onClose={() => setShowDayGuide(false)}
        guideActiveTab={guideActiveTab}
        setGuideActiveTab={setGuideActiveTab}
        dspNoiseGateActive={dspNoiseGateActive}
        activeEncounterProcedure={activeEncounter?.procedureText}
      />
    </div>
  );
}
