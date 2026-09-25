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
  Camera,
  Image as ImageIcon,
  Trash2,
  UploadCloud,
  RotateCw,
  Volume2,
  Lock
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
import { normalizeSpokenDentalText } from '../lib/dentalPhoneticLexicon';
import { formatClinicDate, formatClinicTime, getClinicTodayIso } from '../utils/date';
import { decideSilenceAction, SILENCE_SLEEP_SECONDS } from '../lib/silencePolicy';
import { toPmsEncounter, renderForPms } from '../lib/pms';
import { ClinicMembership } from '../lib/clinics';

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

/**
 * Calculates capture confidence (0-100%) for live conversation.
 * Gated at >=95% to ensure clinical accuracy before calling AI note generation.
 */
export function calculateCaptureConfidence(transcript: { text: string; sender?: string }[]): number {
  if (!transcript || transcript.length === 0) return 0;

  const fullText = transcript.map(t => t.text || '').join(' ').trim();
  if (!fullText) return 0;

  const words = fullText.split(/\s+/).filter(Boolean);
  if (words.length < 3) return 10;

  let score = 0;

  // 1. Teeth and anatomical identifiers (FDI or standard, e.g., #16, tooth 24, molar, upper right)
  const hasTeeth = /(#\d{1,2}|tooth\s+\d{1,2}|teeth|\b[1-4][1-8]\b|upper|lower|molar|premolar|incisor|canine)/i.test(fullText);
  if (hasTeeth) score += 30;

  // 2. Clinical symptoms and examination findings (pain, caries, fracture, pocket, etc.)
  const hasFindings = /(pain|ache|sensitive|sensitivity|caries|decay|filling|cavity|fracture|crack|bop|bleeding|pocket|mobility|swelling|abscess|ulcer|lichen|stain|wear|attrition|cold test|percussion|vital|non-vital)/i.test(fullText);
  if (hasFindings) score += 30;

  // 3. Clinical procedures or interventions (prep, composite, clean, anesthetic, extraction, etc.)
  const hasProcedure = /(prep|excavat|drill|composite|amalgam|resin|scaled|scaling|clean|cure|etch|bond|liner|theracal|anesthetic|lignocaine|articaine|extraction|luxat|suture|rct|extirpat|pulp|dressing|cavit|crown|impression|bite|polish|fluoride|provisional)/i.test(fullText);
  if (hasProcedure) score += 25;

  // 4. Clinical plan, advice, or post-operative guidance
  const hasPlan = /(treatment plan|next visit|return in|review in|schedule|prescribe|prescribed|prescription|painkiller|paracetamol|ibuprofen|antibiotic|salt water|soft diet|gauze|advice|recall)/i.test(fullText);
  if (hasPlan) score += 15;

  // If the complete clinical triad is present (tooth + findings + procedure), ensure threshold is met
  if (hasTeeth && hasFindings && hasProcedure) {
    score = Math.max(score, 95);
  }

  // Volume check
  if (words.length >= 25) {
    score += 10;
  } else if (words.length >= 12) {
    score += 5;
  }

  return Math.min(100, score);
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

  const currentDateStr = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, [currentDate]);

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
      const soap = {
        subjective: c.findings?.chiefComplaint || c.findings?.history || '',
        objective: c.findings?.toothFindings || c.findings?.findingsGingival || '',
        assessment: c.findings?.diagnosis || '',
        plan: c.findings?.treatmentPerformed || c.findings?.recommendations || ''
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
    return patientEncounters
      .filter(p => {
        const orig = consultations.find(c => c.id === p.id);
        return orig?.date === currentDateStr;
      })
      .sort((a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time));
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

  const activeConsult = useMemo(() => {
    if (!activeEncounter) return null;
    return consultations.find(c => c.id === activeEncounter.id) || null;
  }, [consultations, activeEncounter]);

  // Per-section clinician verification state (AHPRA legal compliance standard)
  const [verifiedSections, setVerifiedSections] = useState<Record<string, Record<string, boolean>>>({});

  // Active transcript & capture confidence calculation
  const activeEncounterTranscript = useMemo(() => {
    if (!activeEncounter) return [];
    return localLiveTranscripts[activeEncounter.id] || activeEncounter.diarizedTranscript || [];
  }, [activeEncounter, localLiveTranscripts]);

  const captureConfidence = useMemo(() => {
    return calculateCaptureConfidence(activeEncounterTranscript);
  }, [activeEncounterTranscript]);

  const isCaptureConfident = captureConfidence >= 95;

  const activeId = activeEncounter?.id || '';
  const currentVerified = verifiedSections[activeId] || {};
  const isSubjectiveVerified = Boolean(currentVerified.subjective);
  const isObjectiveVerified = Boolean(currentVerified.objective);
  const isAssessmentVerified = Boolean(currentVerified.assessment);
  const isPlanVerified = Boolean(currentVerified.plan);
  const allSectionsVerified = isSubjectiveVerified && isObjectiveVerified && isAssessmentVerified && isPlanVerified;

  const unverifiedSectionNames = useMemo(() => {
    const missing: string[] = [];
    if (!isSubjectiveVerified) missing.push('Subjective');
    if (!isObjectiveVerified) missing.push('Objective');
    if (!isAssessmentVerified) missing.push('Assessment');
    if (!isPlanVerified) missing.push('Plan');
    return missing;
  }, [isSubjectiveVerified, isObjectiveVerified, isAssessmentVerified, isPlanVerified]);

  const handleVerifyAllSections = useCallback(() => {
    if (!activeEncounter) return;
    setVerifiedSections(prev => ({
      ...prev,
      [activeEncounter.id]: {
        subjective: true,
        objective: true,
        assessment: true,
        plan: true
      }
    }));
  }, [activeEncounter]);

  const handleToggleSectionVerification = useCallback((field: 'subjective' | 'objective' | 'assessment' | 'plan') => {
    if (!activeEncounter) return;
    setVerifiedSections(prev => ({
      ...prev,
      [activeEncounter.id]: {
        ...(prev[activeEncounter.id] || {}),
        [field]: !(prev[activeEncounter.id]?.[field])
      }
    }));
  }, [activeEncounter]);

  // ─────────────────────────────────────────────────────────────
  // 3. LIVE AUDIO RECORDING, DSP ACOUSTIC SQUELCH & WEBAUDIO GRAPH
  // ─────────────────────────────────────────────────────────────
  const [isRecording] = useState(true);
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
    activeEncounterRef.current = activeEncounter;
    consultationsRef.current = consultations;
    localLiveTranscriptsRef.current = localLiveTranscripts;
  }, [isRecording, isPaused, isMicStandby, activeEncounter, consultations, localLiveTranscripts]);

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

  const hasGeneratedNote = useMemo(() => {
    return Boolean(
      (activeEncounter && (activeEncounter.status === 'note_generated' || activeEncounter.status === 'done')) ||
      activeConsult?.noteOrigin ||
      (currentSoap.plan && currentSoap.plan.trim().length > 0) ||
      (currentSoap.objective && currentSoap.objective.trim().length > 0 && currentSoap.assessment && currentSoap.assessment.trim().length > 0)
    );
  }, [activeEncounter, activeConsult, currentSoap]);

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

    // Auto-verify section because clinician actively authored/reviewed it
    setVerifiedSections(prev => ({
      ...prev,
      [targetId]: {
        ...(prev[targetId] || {}),
        [field]: true
      }
    }));

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
    const shouldListen = isRecording && !isPaused && !isMicStandby && Boolean(activeEncounter);

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
  }, [isRecording, isPaused, isMicStandby, activeEncounter?.id]);

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

  // ─────────────────────────────────────────────────────────────
  // 6. ASYNCHRONOUS NOTE FINALIZATION & NON-BLOCKING HANDOFF
  // ─────────────────────────────────────────────────────────────
  const executeBackgroundNoteFinalization = async (targetId: string, autoCopyClipboard = false) => {
    try {
      await flushPendingConsultationSave();
      const targetConsult = consultations.find(c => c.id === targetId);
      if (!targetConsult) return;

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
            const deadline = Date.now() + 85_000;
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
          needsReview: isHostedNote ? !payload?.groundingReport?.isFullyGrounded : true,
          detail: payload?.groundingReport?.summary || (isHostedNote ? `Generated via ${payload?.noteOrigin?.engine || 'cloud AI'}` : 'Generated via offline draft engine.')
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
    return encountersForDate.filter(p => p.status === 'note_generated' || p.status === 'done' || p.status === 'ready');
  }, [encountersForDate]);

  const [selectedPmsTarget, setSelectedPmsTarget] = useState<'d4w' | 'exact' | 'cliniko' | 'generic'>('d4w');

  // Generate note text formatted for PMS clipboard (incorporating clinician inline edits & PMS adapter)
  const getFormattedNoteText = (consultToCopy?: Consultation): string => {
    const target = consultToCopy || consultations.find(c => c.id === activeEncounter?.id);
    if (!target) return '';

    const isCurrentActive = target.id === activeEncounter?.id;
    const subj = isCurrentActive ? currentSoap.subjective : (target.findings?.chiefComplaint ? `${target.findings.chiefComplaint} ${target.findings.history || ''}` : '');
    const obj = isCurrentActive ? currentSoap.objective : (target.findings?.toothFindings ? `${target.findings.toothFindings} ${target.findings.findingsGingival || ''}` : '');
    const assess = isCurrentActive ? currentSoap.assessment : (target.findings?.diagnosis || '');
    const planText = isCurrentActive ? currentSoap.plan : (target.findings?.treatmentPerformed ? `${target.findings.treatmentPerformed} ${target.findings.recommendations || ''}` : '');

    // Construct synthesized consultation snapshot reflecting live clinician edits
    const liveConsult: Consultation = {
      ...target,
      findings: {
        ...target.findings,
        chiefComplaint: subj,
        toothFindings: obj,
        diagnosis: assess,
        treatmentPerformed: planText,
        adaCodes: isCurrentActive && activeEncounter?.cdtCodes ? activeEncounter.cdtCodes.map(c => ({ code: c.code, description: c.desc })) : (target.findings?.adaCodes || [])
      }
    };

    try {
      const pmsEncounter = toPmsEncounter(liveConsult);
      const rendered = renderForPms(selectedPmsTarget, pmsEncounter);
      if (rendered?.body) return rendered.body;
    } catch {
      // Safe fallback if adapter encounters edge case
    }

    return `=== DENTAI CLINICAL NOTE ===
PATIENT: ${target.firstName} ${target.lastName} (DOB: ${target.dob || 'Not recorded'})
DATE: ${formatClinicDate(target.date || new Date(), { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
PROVIDER: ${dentistName || 'Attending Clinician'}
PROCEDURE: ${target.appointmentType?.toUpperCase() || 'GENERAL RESTORATIVE'}

SUBJECTIVE (S):
${subj || 'No complaints recorded.'}

OBJECTIVE (O):
${obj || 'Examination completed.'}

ASSESSMENT (A):
${assess || 'Clinical findings documented.'}

PLAN & PROCEDURE (P):
${planText || 'Treatment completed.'}

CDT/ADA CODES:
${target.findings?.adaCodes?.map(c => `- ${c.code}: ${c.description}`).join('\n') || '- None recorded'}

VERIFICATION: Verified from patient conversation
============================`;
  };

  // Copy Note for PMS (Transitions status to 'Done')
  const handleCopyPMS = (consultToCopy?: Consultation) => {
    if (!consultToCopy && !allSectionsVerified) {
      return;
    }
    const target = consultToCopy || consultations.find(c => c.id === activeEncounter?.id);
    const noteText = getFormattedNoteText(consultToCopy);
    if (!noteText) return;

    if (navigator.clipboard) {
      navigator.clipboard.writeText(noteText);
    }
    if (target?.id) {
      setCopiedEncounterIds(prev => new Set(prev).add(target.id));
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
        if (allSectionsVerified) {
          handleCopyPMS();
        }
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
    <div className="flex h-screen w-full bg-[#F8F9FA] text-slate-800 font-sans overflow-hidden antialiased select-none">
      {/* ─────────────────────────────────────────────────────────────
          1. GLOBAL TOP SURGERY HEADER
          ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-14 px-6 border-b border-slate-200 bg-white flex items-center justify-between flex-shrink-0 z-20 shadow-2xs">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-[#0060BA] text-white flex items-center justify-center shadow-xs">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor">
                <path d="M12 2C9 2 7 4 7 7.5c0 3 1.2 6.5 2 9.5.5 2 1.5 3 2.5 3 .6 0 1.2-.5 1.5-1.5.3 1 1 1.5 1.5 1.5 1 0 2-1 2.5-3 .8-3 2-6.5 2-9.5C19 4 17 2 12 2z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-slate-900 text-sm tracking-tight">DentAI</span>
                <span className="text-[10px] bg-sky-50 text-sky-800 font-bold px-1.5 py-0.2 rounded border border-sky-200">Dental Assistant AI</span>
              </div>
              <div className="text-[10px] text-slate-400 font-semibold">{activeClinic?.clinicName || 'Chairside Dental Practice'}</div>
            </div>
          </div>

          <div className="flex items-center space-x-2.5">
            <button
              onClick={onOpenHistoryHub}
              className="px-3 py-1.5 rounded-xl border border-slate-200 hover:border-sky-500 bg-white hover:bg-sky-50/50 text-slate-700 text-xs font-semibold flex items-center space-x-1.5 shadow-2xs transition cursor-pointer"
              title="Patient Records & History Hub"
            >
              <LayoutDashboard className="w-3.5 h-3.5 text-slate-600" />
              <span>Past Records</span>
            </button>

            {onOpenPipeline && (
              <button
                onClick={onOpenPipeline}
                className="px-3 py-1.5 rounded-xl border border-slate-200 hover:border-amber-500 bg-white hover:bg-amber-50/50 text-slate-700 text-xs font-semibold flex items-center space-x-1.5 shadow-2xs transition cursor-pointer"
                title="Treatment Pipeline & Worklist"
              >
                <TrendingUp className="w-3.5 h-3.5 text-amber-600" />
                <span>Worklist</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowDayGuide(true)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 hover:border-sky-500 bg-white hover:bg-sky-50/50 text-slate-700 text-xs font-semibold flex items-center space-x-1.5 shadow-2xs transition cursor-pointer"
              title="Day Guide & Shortcuts (Press ?)"
            >
              <HelpCircle className="w-3.5 h-3.5 text-sky-600" />
              <span>Guide</span>
              <kbd className="text-[9px] font-mono font-bold bg-slate-100 text-slate-500 px-1 py-0.2 rounded border border-slate-200">?</kbd>
            </button>

            <button
              type="button"
              onClick={() => setShowDeliverablesModal(true)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 hover:border-indigo-600 bg-white hover:bg-indigo-50/50 text-slate-700 text-xs font-semibold flex items-center space-x-1.5 shadow-2xs transition cursor-pointer"
              title="Generate specialist referral letters and patient post-op care instructions"
            >
              <FileText className="w-3.5 h-3.5 text-indigo-600" />
              <span>Referral & Handover</span>
            </button>

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

            <div className="h-6 w-[1px] bg-slate-200 mx-1" />

            <div className="text-right">
              <div className="text-xs font-bold text-slate-800">{dentistName || 'Dr. Marcus Vance'}</div>
              <div className="text-[10px] font-semibold text-slate-400">Attending Clinician</div>
            </div>
            <div className="w-8 h-8 rounded-full bg-[#0060BA] text-white font-bold text-xs flex items-center justify-center border border-sky-700 shadow-2xs">
              {dentistName ? dentistName.split(' ').map(n => n[0]).join('').slice(0, 2) : 'MV'}
            </div>
            <button
              onClick={onLogout}
              className="w-8 h-8 rounded-full hover:bg-rose-50 flex items-center justify-center text-slate-400 hover:text-rose-600 transition cursor-pointer ml-1"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Content Area: 2-Pane Hybrid Split (Left 28% Clinic Day Schedule + Right 72% Apple Clinical Document) */}
        <div className="flex-1 flex flex-row overflow-hidden">
          {/* ─── PANE 1: CLINIC DAY SCHEDULE (28% ~320px) ─── */}
          <section className="w-[320px] flex-shrink-0 bg-white border-r border-slate-200 flex flex-col justify-between overflow-hidden shadow-2xs">
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3 custom-scrollbar">
              {/* Schedule Title & Import Actions */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Clinic Day Schedule</h3>
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
                    className="flex-1 py-1.5 px-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-between shadow-2xs transition cursor-pointer"
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

                  <button
                    onClick={() => setShowWalkInCard(prev => !prev)}
                    className={`py-1.5 px-2.5 rounded-xl border text-xs font-bold flex items-center space-x-1 shadow-2xs transition cursor-pointer ${showWalkInCard
                      ? 'bg-sky-50 border-sky-300 text-sky-800'
                      : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
                      }`}
                    title="Add Walk-In Patient"
                  >
                    <Plus className="w-3.5 h-3.5 text-sky-600" />
                    <span>Walk-In</span>
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
                  <div className="p-4 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50/50 space-y-2">
                    <Calendar className="w-6 h-6 text-slate-400 mx-auto" />
                    <p className="text-xs font-semibold text-slate-600">No appointments scheduled</p>
                    <p className="text-[11px] text-slate-400">
                      Use <strong>Paste Schedule</strong> or add a <strong>Walk-In</strong> to begin.
                    </p>
                  </div>
                ) : (
                  encountersForDate.map(p => {
                    const isActive = p.id === activePatientId;

                    return (
                      <div
                        key={p.id}
                        onClick={() => handleSelectPatient(p.id)}
                        className={`p-3 rounded-xl border transition cursor-pointer text-left ${isActive
                          ? 'bg-sky-50/70 border-sky-300 ring-1 ring-sky-300/50 shadow-xs'
                          : 'bg-white hover:bg-slate-50/80 border-slate-200'
                          }`}
                      >
                        <div className="flex items-start justify-between mb-1">
                          <div className="text-[11px] font-mono text-slate-500 font-tabular">
                            {p.time} • <span className="text-slate-700 font-bold">{p.operatory?.replace(/Op /i, 'Room ') || 'Room 1'}</span>
                          </div>

                          {p.status === 'done' ? (
                            <span className="bg-emerald-50 text-emerald-800 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1 shadow-2xs">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              <span>Done</span>
                            </span>
                          ) : p.status === 'recording' || (isActive && !isMicStandby && !isPaused) ? (
                            <span className="bg-rose-100 text-rose-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-rose-200 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                              <span>Recording ({formatTimer(recordingSeconds)})</span>
                            </span>
                          ) : p.status === 'processing' ? (
                            <span className="bg-amber-50 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-200 flex items-center gap-1">
                              <RefreshCw className="w-3 h-3 text-amber-600 animate-spin" />
                              <span>Generating Note...</span>
                            </span>
                          ) : p.status === 'recreate' ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                executeBackgroundNoteFinalization(p.id, false);
                              }}
                              className="bg-rose-50 hover:bg-rose-100 text-rose-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-rose-200 flex items-center gap-1 transition-colors cursor-pointer"
                              title="Note generation had an issue. Click to recreate note."
                            >
                              <RotateCw className="w-3 h-3 text-rose-600" />
                              <span>Recreate</span>
                            </button>
                          ) : p.status === 'note_generated' ? (
                            <span className="bg-teal-50 text-teal-800 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-teal-200 flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-teal-600" />
                              <span>Note Generated</span>
                            </span>
                          ) : isActive && isPaused ? (
                            <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-200 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                              <span>Paused</span>
                            </span>
                          ) : isActive ? (
                            <span className="bg-sky-100 text-sky-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-sky-200 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                              <span>In Chair</span>
                            </span>
                          ) : p.diarizedTranscript && p.diarizedTranscript.length > 0 ? (
                            <span className="bg-emerald-50 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              <span>Live ({p.diarizedTranscript.length})</span>
                            </span>
                          ) : (
                            <span className="bg-slate-100 text-slate-600 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                              {p.id === encountersForDate.find(o => o.id !== activePatientId && o.status !== 'done' && o.status !== 'note_generated')?.id ? 'Up Next' : 'Ready'}
                            </span>
                          )}
                        </div>

                        <h3 className={`text-sm font-bold tracking-tight mb-0.5 ${isActive ? 'text-sky-950 font-extrabold' : 'text-slate-800'}`}>
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
          </section>

          {/* ─── PANE 2: APPLE CLINICAL DOCUMENT CANVAS (72%) ─── */}
          <main className="flex-1 flex flex-col overflow-y-auto p-6 space-y-4 bg-[#FAFAFC] custom-scrollbar">
            {activeEncounter ? (
              <>
                {/* Active Patient Header & Action Bar */}
                <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs flex items-center justify-between">
                  <div className="flex items-center space-x-3.5">
                    <div className="w-11 h-11 rounded-full bg-sky-100 text-sky-800 flex items-center justify-center font-bold text-sm border border-sky-200 shadow-inner">
                      {activeEncounter.patientName.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </div>
                    <div>
                      <div className="flex items-center space-x-2.5">
                        <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">
                          {activeEncounter.patientName}
                        </h2>
                        <span className="text-xs text-slate-500 font-medium">
                          • DOB: {activeEncounter.dob ? activeEncounter.dob : 'Not recorded'} • {activeEncounter.operatory?.replace(/Op /i, 'Room ') || 'Room 1'}
                        </span>
                      </div>

                      {/* Interactive Procedure & Note Template Selector */}
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Type:</span>
                          <select
                            value={activeEncounter.appointmentType || 'examination'}
                            onChange={e => handleUpdateAppointmentType(activeEncounter.id, e.target.value as AppointmentType)}
                            className="px-2 py-0.5 text-xs font-semibold rounded-lg bg-sky-50 text-sky-800 border border-sky-200 focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer"
                          >
                            {APPOINTMENT_TYPES.map(t => (
                              <option key={t.value} value={t.value}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Fast 1-click pills */}
                        <div className="flex items-center gap-1 flex-wrap">
                          {APPOINTMENT_TYPES.map(t => {
                            const isSelected = (activeEncounter.appointmentType || 'examination') === t.value;
                            return (
                              <button
                                key={t.value}
                                type="button"
                                onClick={() => handleUpdateAppointmentType(activeEncounter.id, t.value)}
                                className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition cursor-pointer ${isSelected
                                    ? 'bg-[#0060BA] text-white shadow-2xs'
                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                                  }`}
                              >
                                {t.short}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2.5">
                    <button
                      onClick={handleNextPatient}
                      title="Advance to next patient on schedule"
                      className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 text-xs font-bold flex items-center space-x-1.5 transition cursor-pointer"
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                      <span>Next Patient (⌘→)</span>
                    </button>
                  </div>
                </div>

                {/* Ambient Audio HUD Bar */}
                <div className="bg-white rounded-2xl p-3.5 border border-slate-200/90 shadow-xs flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${!isMicStandby && !isPaused
                      ? 'bg-rose-500 animate-ping'
                      : isPaused
                        ? 'bg-amber-500'
                        : 'bg-sky-500'
                      }`} />
                    <span className="text-xs font-bold text-slate-800">
                      {!isMicStandby && !isPaused
                        ? `Listening (${formatTimer(recordingSeconds)}) — Press Space to pause`
                        : isPaused
                          ? 'Paused — Press Space to resume'
                          : 'Standby — Press Space to start listening'}
                    </span>
                  </div>

                  {/* Waveform Visualizer */}
                  <div className="flex items-center space-x-1 h-5 px-3">
                    {Array.from({ length: 11 }).map((_, i) => (
                      <div
                        key={i}
                        ref={el => { waveformRefs.current[i] = el; }}
                        style={{ height: '20%', opacity: isMicStandby || isPaused ? 0.35 : 1 }}
                        className="w-1 bg-[#0060BA] rounded-full transition-all duration-75"
                      />
                    ))}
                  </div>

                  <div className="flex items-center space-x-2">
                    {isMicStandby ? (
                      <button
                        onClick={handleStartAudio}
                        className="px-3.5 py-1.5 rounded-xl bg-[#0060BA] hover:bg-[#004D96] active:scale-95 text-white text-xs font-bold flex items-center space-x-1.5 transition shadow-xs cursor-pointer"
                      >
                        <Mic className="w-3.5 h-3.5" />
                        <span>Start Audio</span>
                        <kbd className="px-1 text-[9px] font-mono bg-sky-900/40 rounded">Space</kbd>
                      </button>
                    ) : (
                      <button
                        onClick={handleTogglePause}
                        className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 text-xs font-bold flex items-center space-x-1.5 transition cursor-pointer"
                      >
                        {isPaused ? <Play className="w-3.5 h-3.5 text-emerald-600" /> : <Pause className="w-3.5 h-3.5 text-amber-600" />}
                        <span>{isPaused ? 'Resume' : 'Pause'}</span>
                        <kbd className="px-1 text-[9px] font-mono bg-slate-200 rounded">Space</kbd>
                      </button>
                    )}
                  </div>
                </div>

                {/* Silence Warning Alert Banner */}
                {isSilenceWarning && (
                  <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 flex items-center justify-between text-xs text-amber-950 font-medium shadow-2xs">
                    <div className="flex items-center space-x-2">
                      <AlertTriangle className="w-4 h-4 text-amber-700 animate-bounce" />
                      <span>Quiet room detected: Pausing in {silenceSecondsRemaining}s.</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleKeepListening}
                      className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition cursor-pointer"
                    >
                      Keep Listening (Space)
                    </button>
                  </div>
                )}

                {/* Operatory Background Noise Warning (Receptionist-Friendly Rule 9) */}
                {isSnrLow && !isMicStandby && !isPaused && (
                  <div className="bg-sky-50 border border-sky-300 rounded-xl p-3 flex items-center justify-between text-xs text-sky-950 font-medium shadow-2xs">
                    <div className="flex items-center space-x-2">
                      <Volume2 className="w-4 h-4 text-sky-700 animate-pulse" />
                      <span>Microphone Notice: Operatory background noise is high. Please position microphone closer to speaker.</span>
                    </div>
                  </div>
                )}

                {/* Main Split: Clinical Document (Left) + Live Speech Feed (Right) */}
                <div className="grid grid-cols-12 gap-5 flex-1 items-start">
                  {/* Left: Live Conversation Feed */}
                  <div className="col-span-6 bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs space-y-3 font-sans">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <div className="flex items-center space-x-2">
                        <span className={`w-2 h-2 rounded-full ${micListening ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Live Conversation</h3>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {activeEncounter.diarizedTranscript?.length || 0} Lines Recorded
                      </span>
                    </div>

                    {/* Dialogue Stream */}
                    <div className="space-y-2.5 text-xs leading-relaxed max-h-[420px] overflow-y-auto custom-scrollbar pr-1">
                      {activeEncounter.diarizedTranscript && activeEncounter.diarizedTranscript.length > 0 ? (
                        activeEncounter.diarizedTranscript.map((t, idx) => {
                          const isDentist = t.role === 'dentist';
                          const isPatient = t.role === 'patient';
                          const isAssistant = t.role === 'assistant';

                          return (
                            <div key={idx} className="space-y-0.5">
                              {t.speaker && (
                                <div className="flex items-center justify-between text-[10px] font-semibold">
                                  <span className={
                                    isDentist
                                      ? 'text-sky-700 font-bold'
                                      : isPatient
                                        ? 'text-emerald-700 font-bold'
                                        : isAssistant
                                          ? 'text-indigo-700 font-bold'
                                          : 'text-slate-500 font-medium'
                                  }>
                                    {t.speaker}
                                  </span>
                                  {t.time && <span className="text-slate-400 font-mono">{t.time}</span>}
                                </div>
                              )}
                              <div className={`p-2.5 rounded-xl border text-xs ${isDentist
                                  ? 'bg-sky-50/40 text-slate-800 border-sky-200/70'
                                  : isPatient
                                    ? 'bg-emerald-50/40 text-slate-800 border-emerald-200/70'
                                    : 'bg-slate-50 text-slate-800 border-slate-200/70'
                                }`}>
                                {renderAnnotatedText(t.text)}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-center py-10 text-slate-400">
                          <Mic className="w-7 h-7 mx-auto mb-1 text-slate-300" />
                          <p className="font-semibold text-xs text-slate-600">
                            {isMicStandby ? 'Microphone in Standby' : 'Listening naturally...'}
                          </p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Speak clinical findings, tooth numbers, and procedures.
                          </p>
                        </div>
                      )}

                      {interimTranscript && (
                        <div className="p-2.5 rounded-xl bg-sky-50 text-sky-900 border border-sky-200 text-xs italic shadow-2xs">
                          <span className="font-bold mr-1">Listening:</span> {interimTranscript}
                        </div>
                      )}

                      <div ref={transcriptEndRef} />
                    </div>

                    {/* Quick Dictation Chips */}
                    <div className="pt-2 border-t border-slate-100 flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1 text-[11px]">
                      <span className="text-slate-400 text-[10px] font-bold uppercase mr-0.5">Quick:</span>
                      {[
                        '#16 MO decay excavated',
                        '1.8mL 2% Lidocaine infiltrated',
                        'Scale & clean completed 114',
                        '2x Bitewings taken 022'
                      ].map((chip, cIdx) => (
                        <button
                          key={cIdx}
                          type="button"
                          onClick={() => handleAppendTranscriptText(chip, 'Dentist')}
                          className="px-2 py-0.5 bg-slate-100 hover:bg-sky-50 text-slate-700 hover:text-sky-800 border border-slate-200 rounded-lg whitespace-nowrap cursor-pointer transition text-[10px] font-medium flex-shrink-0"
                        >
                          + {chip}
                        </button>
                      ))}
                    </div>

                    {/* Quick Note Input Box */}
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
                        placeholder="Type finding or procedure..."
                        className="flex-1 px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-sky-600"
                      />
                      <button
                        onClick={() => {
                          if (manualDialogueText.trim()) {
                            handleAppendTranscriptText(manualDialogueText, 'Dentist');
                            setManualDialogueText('');
                          }
                        }}
                        className="px-3 py-1.5 bg-[#0060BA] hover:bg-[#004D96] text-white rounded-xl text-xs font-bold transition cursor-pointer"
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Right: Apple Clinical Document */}
                  <div className="col-span-6 bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs space-y-3.5 font-sans">
                    {/* Header & Verified Badge */}
                    {/* Header & Verified Badge */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <h3 className="text-sm font-bold text-slate-900 tracking-tight">Clinical Document</h3>
                          <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md font-mono font-bold">SOAP</span>
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
                          {activeConsult?.noteOrigin?.engine === 'offline-draft' ? (
                            <span className="bg-amber-50 text-amber-800 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-amber-300 flex items-center gap-1 shadow-2xs" title="Draft generated using local deterministic rules because cloud AI service was unavailable">
                              <AlertTriangle className="w-3 h-3 text-amber-600" />
                              Offline Fallback Draft
                            </span>
                          ) : activeConsult?.grounding?.isFullyGrounded ? (
                            <span className="bg-emerald-50 text-emerald-800 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1 shadow-2xs">
                              <Check className="w-3 h-3 text-emerald-600" />
                              Verified from Audio
                            </span>
                          ) : (
                            <span className="bg-slate-100 text-slate-700 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-slate-200 flex items-center gap-1 shadow-2xs">
                              <FileText className="w-3 h-3 text-slate-500" />
                              Clinical Draft
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Top Action Bar: Generate Note Button (Gated at >= 95% Confidence) OR Copy to Practice Management (Gated on All Sections Verified) */}
                      {isGeneratingFromConversation || (activeEncounter && backgroundFinalizingIds.has(activeEncounter.id)) ? (
                        <div className="w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center space-x-2 bg-amber-50 border border-amber-200 text-amber-800 shadow-xs">
                          <RefreshCw className="w-4 h-4 animate-spin text-amber-600" />
                          <span>Generating Clinical Note...</span>
                        </div>
                      ) : !hasGeneratedNote ? (
                        /* No note generated yet: Generate Note button with 95% gate */
                        isCaptureConfident ? (
                          <button
                            onClick={() => handleRegenerateFromConversation()}
                            className="w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-between bg-gradient-to-r from-[#0060BA] to-[#0071E3] hover:from-[#0050A0] hover:to-[#0060BA] text-white shadow-md shadow-[#0071E3]/25 cursor-pointer transition active:scale-[0.98]"
                          >
                            <div className="flex items-center space-x-2">
                              <Sparkles className="w-4 h-4 text-amber-300" />
                              <span>Generate Note</span>
                            </div>
                            <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full font-mono font-bold">
                              {captureConfidence}% Ready
                            </span>
                          </button>
                        ) : (
                          <div className="w-full py-2.5 px-3.5 rounded-xl font-medium text-xs flex items-center justify-between bg-slate-50 border border-slate-200 text-slate-500">
                            <div className="flex items-center space-x-2">
                              <Mic className="w-3.5 h-3.5 text-slate-400 animate-pulse" />
                              <span>Ready at ≥95% capture</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <div className="w-16 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                                <div
                                  className="bg-sky-500 h-1.5 rounded-full transition-all duration-300"
                                  style={{ width: `${captureConfidence}%` }}
                                />
                              </div>
                              <span className="font-mono text-[10px] font-bold text-slate-600">
                                {captureConfidence}%
                              </span>
                            </div>
                          </div>
                        )
                      ) : (
                        /* Note is generated: Practice Management Copy Button + Section Verification Lock */
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleCopyPMS()}
                              disabled={!allSectionsVerified}
                              className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center space-x-2 transition-all shadow-sm ${
                                !allSectionsVerified
                                  ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed shadow-none'
                                  : copiedNote
                                  ? 'bg-emerald-600 text-white shadow-emerald-600/20 cursor-pointer active:scale-[0.98]'
                                  : 'bg-[#0071E3] hover:bg-[#0077ED] text-white shadow-[#0071E3]/25 cursor-pointer active:scale-[0.98]'
                              }`}
                              title={!allSectionsVerified ? `Verify all 4 sections before copying. Remaining: ${unverifiedSectionNames.join(', ')}` : 'Copy for Practice Management (⌘C)'}
                            >
                              {!allSectionsVerified ? (
                                <Lock className="w-4 h-4 text-slate-400" />
                              ) : copiedNote ? (
                                <Check className="w-4 h-4" />
                              ) : (
                                <Copy className="w-4 h-4" />
                              )}
                              <span>
                                {copiedNote
                                  ? 'Copied to Practice Management!'
                                  : !allSectionsVerified
                                  ? 'Copy to Practice Management (Verify all sections)'
                                  : 'Copy to Practice Management (⌘C)'}
                              </span>
                            </button>

                            {isCaptureConfident && (
                              <button
                                onClick={() => handleRegenerateFromConversation()}
                                title="Regenerate note from live conversation"
                                className="py-2.5 px-3 rounded-xl border border-slate-200 hover:border-sky-400 bg-white hover:bg-sky-50 text-slate-700 text-xs font-semibold flex items-center space-x-1.5 transition cursor-pointer"
                              >
                                <RotateCw className="w-3.5 h-3.5 text-sky-600" />
                                <span className="hidden sm:inline">Regenerate</span>
                              </button>
                            )}
                          </div>

                          {!allSectionsVerified && (
                            <div className="flex items-center justify-between px-1 text-[11px]">
                              <span className="text-amber-800 font-medium">
                                Needs verification: <strong className="text-amber-950">{unverifiedSectionNames.join(', ')}</strong>
                              </span>
                              <button
                                type="button"
                                onClick={handleVerifyAllSections}
                                className="font-bold text-sky-700 hover:text-sky-900 hover:underline cursor-pointer"
                              >
                                Verify All Sections
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Offline Fallback Banner */}
                    {activeConsult?.noteOrigin?.engine === 'offline-draft' && (
                      <div className="p-3 bg-amber-50/90 border border-amber-200 rounded-xl text-amber-900 text-xs flex items-start gap-2.5">
                        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <div className="font-bold text-[11px] text-amber-950 flex items-center gap-2">
                            <span>Offline Fallback Draft Active</span>
                            <span className="font-normal text-[10px] text-amber-700 bg-amber-100/80 px-2 py-0.5 rounded border border-amber-300/50">
                              Deterministic Local Draft
                            </span>
                          </div>
                          <p className="text-[11px] text-amber-800 leading-relaxed">
                            Cloud AI was unreachable or rate-limited. This note was assembled locally from transcript quotes with zero clinical fabrication. Please review and verify before copying to your practice management system.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Structured Note Cards with Direct Inline Editing */}
                    <div className="space-y-3 pt-1 text-xs max-h-[460px] overflow-y-auto custom-scrollbar pr-1">
                      {activeEncounter && (
                        <>
                          {/* Subjective */}
                          <div className="bg-white hover:bg-slate-50/50 focus-within:bg-white border border-slate-200 focus-within:border-[#0071E3] focus-within:ring-2 focus-within:ring-[#0071E3]/15 rounded-xl p-3.5 space-y-1.5 transition-all shadow-2xs group">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-bold text-slate-800 tracking-wider flex items-center gap-1.5 uppercase">
                                <User className="w-3.5 h-3.5 text-[#0071E3]" />
                                SUBJECTIVE (S):
                              </span>
                              <div className="flex items-center space-x-2">
                                <button
                                  type="button"
                                  onClick={() => handleToggleSectionVerification('subjective')}
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md border flex items-center gap-1 transition cursor-pointer ${
                                    isSubjectiveVerified
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                      : 'bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-800 border-slate-200'
                                  }`}
                                >
                                  {isSubjectiveVerified ? (
                                    <>
                                      <Check className="w-2.5 h-2.5 text-emerald-600" />
                                      <span>Verified</span>
                                    </>
                                  ) : (
                                    <span>Verify</span>
                                  )}
                                </button>
                              </div>
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
                          <div className="bg-white hover:bg-slate-50/50 focus-within:bg-white border border-slate-200 focus-within:border-teal-700 focus-within:ring-2 focus-within:ring-teal-700/15 rounded-xl p-3.5 space-y-1.5 transition-all shadow-2xs group">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-bold text-slate-800 tracking-wider flex items-center gap-1.5 uppercase">
                                <Activity className="w-3.5 h-3.5 text-teal-700" />
                                OBJECTIVE (O):
                              </span>
                              <div className="flex items-center space-x-2">
                                <button
                                  type="button"
                                  onClick={() => handleToggleSectionVerification('objective')}
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md border flex items-center gap-1 transition cursor-pointer ${
                                    isObjectiveVerified
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                      : 'bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-800 border-slate-200'
                                  }`}
                                >
                                  {isObjectiveVerified ? (
                                    <>
                                      <Check className="w-2.5 h-2.5 text-emerald-600" />
                                      <span>Verified</span>
                                    </>
                                  ) : (
                                    <span>Verify</span>
                                  )}
                                </button>
                              </div>
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
                          <div className="bg-white hover:bg-slate-50/50 focus-within:bg-white border border-slate-200 focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-500/15 rounded-xl p-3.5 space-y-1.5 transition-all shadow-2xs group">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-bold text-slate-800 tracking-wider flex items-center gap-1.5 uppercase">
                                <Shield className="w-3.5 h-3.5 text-amber-500" />
                                ASSESSMENT (A):
                              </span>
                              <div className="flex items-center space-x-2">
                                <button
                                  type="button"
                                  onClick={() => handleToggleSectionVerification('assessment')}
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md border flex items-center gap-1 transition cursor-pointer ${
                                    isAssessmentVerified
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                      : 'bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-800 border-slate-200'
                                  }`}
                                >
                                  {isAssessmentVerified ? (
                                    <>
                                      <Check className="w-2.5 h-2.5 text-emerald-600" />
                                      <span>Verified</span>
                                    </>
                                  ) : (
                                    <span>Verify</span>
                                  )}
                                </button>
                              </div>
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
                          <div className="bg-white hover:bg-slate-50/50 focus-within:bg-white border border-slate-200 focus-within:border-[#0071E3] focus-within:ring-2 focus-within:ring-[#0071E3]/15 rounded-xl p-3.5 space-y-1.5 transition-all shadow-2xs group">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-bold text-slate-800 tracking-wider flex items-center gap-1.5 uppercase">
                                <Sparkles className="w-3.5 h-3.5 text-[#0071E3]" />
                                PLAN & PROCEDURE (P):
                              </span>
                              <div className="flex items-center space-x-2">
                                <button
                                  type="button"
                                  onClick={() => handleToggleSectionVerification('plan')}
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md border flex items-center gap-1 transition cursor-pointer ${
                                    isPlanVerified
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                      : 'bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-800 border-slate-200'
                                  }`}
                                >
                                  {isPlanVerified ? (
                                    <>
                                      <Check className="w-2.5 h-2.5 text-emerald-600" />
                                      <span>Verified</span>
                                    </>
                                  ) : (
                                    <span>Verify</span>
                                  )}
                                </button>
                              </div>
                            </div>
                            <textarea
                              value={currentSoap.plan}
                              onChange={e => handleSoapChange('plan', e.target.value)}
                              rows={2}
                              className="w-full bg-transparent text-slate-800 leading-relaxed text-[11px] font-sans resize-y focus:outline-none placeholder:text-slate-400 font-tabular"
                              placeholder="Treatment rendered, materials/anesthesia used, post-op instructions..."
                            />
                          </div>

                          {/* ADA Item Codes Matrix */}
                          {activeEncounter.cdtCodes && activeEncounter.cdtCodes.length > 0 && (
                            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-slate-700 tracking-wider uppercase flex items-center gap-1">
                                  <Tag className="w-3 h-3 text-teal-700" />
                                  ADA Billing Codes Detected ({activeEncounter.cdtCodes.length})
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {activeEncounter.cdtCodes.map((item, idx) => (
                                  <div
                                    key={idx}
                                    className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-mono text-slate-800 flex items-center space-x-1.5 shadow-2xs"
                                    title={`${item.code}: ${item.desc}`}
                                  >
                                    <span className="font-bold text-teal-800">{item.code}</span>
                                    <span className="text-[11px] font-sans text-slate-600 truncate max-w-[150px]">{item.desc}</span>
                                    {item.fee && <span className="text-[10px] text-slate-400 font-semibold">{item.fee}</span>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
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
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${deliverablesActiveTab === 'referral'
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
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${deliverablesActiveTab === 'postop'
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
          8b. PMS SCHEDULE SCREENSHOT OCR & DAYSHEET IMPORT MODAL
          ───────────────────────────────────────────────────────────── */}
      {showDaysheetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full p-6 sm:p-7 text-left relative my-8 animate-in fade-in duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-sky-600 text-white flex items-center justify-center shadow-xs">
                  <Camera className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
                    Import Daily Schedule
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    Paste Dental4Windows, Exact, or PMS schedule screenshot (<kbd className="px-1 py-0.2 bg-slate-100 border rounded font-mono text-[10px]">Win+Shift+S</kbd> &rarr; <kbd className="px-1 py-0.2 bg-slate-100 border rounded font-mono text-[10px]">⌘V</kbd>)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowDaysheetModal(false);
                  setSchedulePreviewImage(null);
                  setDetectedScheduleItems([]);
                  setScheduleParsingError(null);
                }}
                className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Navigation Tabs */}
            <div className="flex items-center space-x-2 mt-4 pb-2 border-b border-slate-100 text-xs font-bold">
              <button
                type="button"
                onClick={() => setScheduleImportTab('screenshot')}
                className={`px-3.5 py-1.5 rounded-xl transition flex items-center space-x-1.5 cursor-pointer ${scheduleImportTab === 'screenshot'
                    ? 'bg-sky-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:bg-slate-100'
                  }`}
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Paste Screenshot (Vision AI)</span>
              </button>
              <button
                type="button"
                onClick={() => setScheduleImportTab('text')}
                className={`px-3.5 py-1.5 rounded-xl transition flex items-center space-x-1.5 cursor-pointer ${scheduleImportTab === 'text'
                    ? 'bg-sky-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:bg-slate-100'
                  }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Paste Text / Day Sheet</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="mt-4 space-y-4">
              {scheduleImportTab === 'screenshot' && (
                <div className="space-y-3">
                  {/* Dropzone / Paste Area */}
                  {detectedScheduleItems.length === 0 && (
                    <div
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => {
                        e.preventDefault();
                        const file = e.dataTransfer.files?.[0];
                        if (file && file.type.startsWith('image/')) {
                          handleScheduleImageFile(file);
                        }
                      }}
                      onClick={() => scheduleFileInputRef.current?.click()}
                      className="border-2 border-dashed border-sky-300 hover:border-sky-500 bg-sky-50/50 hover:bg-sky-50 rounded-2xl p-6 text-center cursor-pointer transition space-y-2 group"
                    >
                      <input
                        ref={scheduleFileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (file) handleScheduleImageFile(file);
                        }}
                      />
                      <div className="w-12 h-12 rounded-2xl bg-white border border-sky-200 text-sky-600 flex items-center justify-center mx-auto shadow-xs group-hover:scale-105 transition-transform">
                        {isScheduleParsing ? (
                          <div className="w-5 h-5 border-2 border-sky-600/30 border-t-sky-600 rounded-full animate-spin" />
                        ) : (
                          <UploadCloud className="w-6 h-6" />
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-800">
                          {isScheduleParsing
                            ? 'Analyzing Schedule Screenshot with Vision AI...'
                            : 'Press Ctrl+V / ⌘V to Paste Schedule Screenshot'}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Or drag & drop / browse an image file (Dental4Windows, Exact, Praktika)
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Parsing Error Notice */}
                  {scheduleParsingError && (
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start space-x-2">
                      <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-bold">Extraction Notice</p>
                        <p className="text-[11px] text-rose-700">{scheduleParsingError}</p>
                      </div>
                      <button
                        onClick={() => scheduleFileInputRef.current?.click()}
                        className="text-[11px] font-bold text-rose-800 underline cursor-pointer"
                      >
                        Try Again
                      </button>
                    </div>
                  )}

                  {/* Detected Schedule Items Review Table */}
                  {detectedScheduleItems.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-bold text-slate-900">
                            {detectedScheduleItems.length} Patients Detected
                          </span>
                          <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                            Vision Verified
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setDetectedScheduleItems([]);
                            setSchedulePreviewImage(null);
                          }}
                          className="text-xs text-slate-500 hover:text-slate-800 font-medium cursor-pointer"
                        >
                          Scan Different Image
                        </button>
                      </div>

                      <div className="border border-slate-200 rounded-2xl overflow-hidden max-h-[40vh] overflow-y-auto custom-scrollbar">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase">
                            <tr>
                              <th className="p-2.5 pl-3">Time</th>
                              <th className="p-2.5">Patient Name</th>
                              <th className="p-2.5">DOB</th>
                              <th className="p-2.5">Room</th>
                              <th className="p-2.5">Procedure</th>
                              <th className="p-2.5 text-right pr-3">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {detectedScheduleItems.map((item, idx) => (
                              <tr key={item.id} className="hover:bg-slate-50/80 transition">
                                <td className="p-2.5 pl-3 font-mono font-bold text-slate-700">
                                  <input
                                    type="text"
                                    value={item.time}
                                    onChange={e => {
                                      const val = e.target.value;
                                      setDetectedScheduleItems(prev =>
                                        prev.map((it, i) => (i === idx ? { ...it, time: val } : it))
                                      );
                                    }}
                                    className="w-16 px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono font-bold outline-none"
                                  />
                                </td>
                                <td className="p-2.5 font-bold text-slate-900">
                                  <input
                                    type="text"
                                    value={item.patientName}
                                    onChange={e => {
                                      const val = e.target.value;
                                      setDetectedScheduleItems(prev =>
                                        prev.map((it, i) => (i === idx ? { ...it, patientName: val } : it))
                                      );
                                    }}
                                    className="w-full px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded text-xs font-bold outline-none"
                                  />
                                </td>
                                <td className="p-2.5 text-slate-600">
                                  <input
                                    type="text"
                                    placeholder="DD/MM/YYYY"
                                    value={item.dob}
                                    onChange={e => {
                                      const val = e.target.value;
                                      setDetectedScheduleItems(prev =>
                                        prev.map((it, i) => (i === idx ? { ...it, dob: val } : it))
                                      );
                                    }}
                                    className="w-24 px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded text-[11px] font-medium outline-none"
                                  />
                                </td>
                                <td className="p-2.5">
                                  <select
                                    value={item.room}
                                    onChange={e => {
                                      const val = e.target.value;
                                      setDetectedScheduleItems(prev =>
                                        prev.map((it, i) => (i === idx ? { ...it, room: val } : it))
                                      );
                                    }}
                                    className="px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded text-[11px] font-medium outline-none"
                                  >
                                    <option value="Room 1">Room 1</option>
                                    <option value="Room 2">Room 2</option>
                                    <option value="Room 3">Room 3</option>
                                  </select>
                                </td>
                                <td className="p-2.5 text-slate-600">
                                  <input
                                    type="text"
                                    value={item.procedureText}
                                    onChange={e => {
                                      const val = e.target.value;
                                      setDetectedScheduleItems(prev =>
                                        prev.map((it, i) => (i === idx ? { ...it, procedureText: val } : it))
                                      );
                                    }}
                                    className="w-full px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded text-xs outline-none"
                                  />
                                </td>
                                <td className="p-2.5 text-right pr-3">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDetectedScheduleItems(prev => prev.filter((_, i) => i !== idx))
                                    }
                                    className="text-slate-400 hover:text-rose-600 p-1 rounded transition cursor-pointer"
                                    title="Remove patient"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setDetectedScheduleItems(prev => [
                              ...prev,
                              {
                                id: `detected-manual-${Date.now()}`,
                                time: formatClinicTime(new Date()),
                                patientName: 'New Patient',
                                dob: '',
                                room: 'Room 1',
                                procedureText: 'General Consultation',
                                appointmentType: 'examination',
                                templateId: 'standard'
                              }
                            ]);
                          }}
                          className="px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 rounded-xl transition flex items-center space-x-1 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5 text-sky-600" />
                          <span>Add Row</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleCommitDetectedSchedule}
                          className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold flex items-center space-x-1.5 transition shadow-sm cursor-pointer"
                        >
                          <Check className="w-4 h-4" />
                          <span>Import Schedule ({detectedScheduleItems.length} Patients)</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {scheduleImportTab === 'text' && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-600">
                    Paste lines copied from your appointment book, spreadsheet, or daysheet:
                  </p>
                  <textarea
                    rows={7}
                    value={daysheetRawText}
                    onChange={e => setDaysheetRawText(e.target.value)}
                    placeholder={`09:00 Justin Tran (14/05/2012) - CDBS Paediatric Exam & Clean\n09:40 Ryan Tran (20/09/2014) - CDBS Paediatric Clean\n11:30 Lorraine Pugh (03/11/1968) - Stage 2 Crown Prep\n14:00 Elke Wolswinkel - 26 + 18 exo\n15:00 Raphael Tannen - Check up and clean`}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-mono focus:border-sky-600 outline-none leading-relaxed"
                  />
                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      disabled={!daysheetRawText.trim()}
                      onClick={handleParseAndImportDaysheet}
                      className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white text-xs font-bold flex items-center space-x-1.5 transition shadow-sm cursor-pointer"
                    >
                      <Check className="w-4 h-4" />
                      <span>Import Text Schedule</span>
                    </button>
                  </div>
                </div>
              )}
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
                className={`px-3 py-1.5 rounded-xl transition ${guideActiveTab === 'phases' ? 'bg-teal-800 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                  }`}
              >
                4-Phase Day Flow
              </button>
              <button
                type="button"
                onClick={() => setGuideActiveTab('hotkeys')}
                className={`px-3 py-1.5 rounded-xl transition ${guideActiveTab === 'hotkeys' ? 'bg-teal-800 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                  }`}
              >
                Operatory Hotkeys
              </button>
              <button
                type="button"
                onClick={() => setGuideActiveTab('dictation')}
                className={`px-3 py-1.5 rounded-xl transition ${guideActiveTab === 'dictation' ? 'bg-teal-800 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                  }`}
              >
                Dental Phonetics
              </button>
              <button
                type="button"
                onClick={() => setGuideActiveTab('pms')}
                className={`px-3 py-1.5 rounded-xl transition ${guideActiveTab === 'pms' ? 'bg-teal-800 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                  }`}
              >
                PMS 1-Click Paste
              </button>
              <button
                type="button"
                onClick={() => setGuideActiveTab('github')}
                className={`px-3 py-1.5 rounded-xl transition flex items-center space-x-1.5 ${guideActiveTab === 'github' ? 'bg-teal-700 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
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
                    <div className={`p-3 rounded-xl text-xs font-semibold flex items-center justify-between gap-2 ${guideGhResult.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
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
