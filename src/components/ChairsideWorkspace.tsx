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
import { addScheduleItem, findScheduleItemBySlot, loadTodaySchedule, parseTimeToMinutes, updateScheduleItem, ScheduleItemStatus } from '../lib/dayScheduleStorage';
import {
  UNSCHEDULED_CHAIR,
  isUnscheduledChair,
  mintAppointmentId,
  mintIfUnseated,
} from '../lib/appointmentId';
import { consentForWrite, consentFromCapture, recordedConsent } from '../lib/aiConsent';
import { Consultation, TranscriptItem, ClinicalFindings, ConsultationConsent } from '../types';
import { chooseNoteTranscript, type TranscriptSource } from '../lib/transcription';
import { NOTE_JOB_CLIENT_POLL } from '../lib/noteJobs';
import {
  blobToBase64,
  isTranscriptionFailure,
  requestTranscription,
  uploadAudioSegment,
  transferAudioSegments,
  discardAudioSegments
} from '../lib/transcribeClient';
import { AuthUser } from '../utils/storage';
import { AppointmentType, getTemplateById, APPOINTMENT_TYPES } from '../lib/dentalLibrary';
import { generateOfflineDraft } from '../lib/draftEngine';
import { generateMacroNote } from '../lib/macroEngine';
import { normalizeSpokenDentalText } from '../lib/dentalPhoneticLexicon';
import { clinicDayKeyOfStoredDate, dobFieldError, formatClinicDate, formatClinicTime, getClinicTodayIso, getClinicTimeZone } from '../utils/date';
import { decideSilenceAction, SILENCE_SLEEP_SECONDS } from '../lib/silencePolicy';
import { toPmsEncounter, renderUniversalProgressNote, renderD4W, renderExact } from '../lib/pms';
import { ClinicMembership } from '../lib/clinics';
import { CHAIRSIDE_MACRO_OPTIONS } from '../lib/australianClinicalMacros';
import { DaysheetModal } from './DaysheetModal';
import { DeliverablesModal } from './DeliverablesModal';
import { BatchTrayModal } from './BatchTrayModal';
import { DayGuideModal } from './DayGuideModal';
import { GuardedTransitionModal } from './GuardedTransitionModal';
import { OperatoryPatientBanner } from './OperatoryPatientBanner';
import { LiveConversationPanel } from './LiveConversationPanel';
import { ClinicalNoteEditorPanel } from './ClinicalNoteEditorPanel';
import { AsepticShortcutFootbar } from './AsepticShortcutFootbar';
import { deriveGroundingBadge } from '../lib/uiVerification';
import { requestSignOff, type SignOffClientResult } from '../lib/signOffClient';
import {
  compareEncounters,
  decidePatientSwitch,
  resolveSubstantiveContent,
  buildWalkInIntake,
  generateWalkInId,
  canAdvanceEncounter,
} from '../lib/encounterSession';
import type { AttestationSeal } from '../lib/attestation';

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
 * Extracts medical alerts deterministically from patient clinical findings and operatory dialogue.
 * Supports antiresorptives (Denosumab / Prolia / MRONJ risk), anticoagulants, allergies, and GP clearance.
 */
function parseClinicalAlerts(
  findings?: ClinicalFindings,
  transcriptItems?: { text?: string }[]
): { type: 'allergy' | 'medication' | 'general'; text: string }[] {
  const alerts: { type: 'allergy' | 'medication' | 'general'; text: string }[] = [];
  const hist = (findings?.history || '').toLowerCase();
  const cc = (findings?.chiefComplaint || '').toLowerCase();
  const tx = (transcriptItems || []).map(t => t.text || '').join(' ').toLowerCase();
  const combined = `${hist} ${cc} ${tx}`;

  if (combined.includes('allergy') || combined.includes('allergic')) {
    alerts.push({ type: 'allergy', text: 'Patient Reported Drug Allergy' });
  }
  if (/\b(?:warfarin|anticoagulant|apixaban|rivaroxaban|eliquis|xarelto|blood thinner|inr)\b/i.test(combined)) {
    alerts.push({ type: 'medication', text: 'Anticoagulant Regimen' });
  }
  if (/\b(?:denosumab|prolia|xgeva|bisphosphonate|fosamax|alendronate|zoledron|reclast|antiresorptive|osteoporosis)\b/i.test(combined)) {
    alerts.push({ type: 'medication', text: 'Antiresorptive Regimen (MRONJ Risk — Denosumab / Prolia)' });
  }
  if (/\b(?:check with (?:your )?gp|gp clearance|medical clearance|consult (?:your )?gp|doctor clearance)\b/i.test(combined)) {
    alerts.push({ type: 'general', text: 'GP Medical Clearance Required' });
  }
  return alerts;
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

  // Strict Encounter Lifecycle State Machine & Operatory Guard
  const [encounterState, setEncounterState] = useState<'empty' | 'active' | 'finished'>('active');
  const [isFinishingEncounter, setIsFinishingEncounter] = useState(false);
  const [pendingSwitchPatientId, setPendingSwitchPatientId] = useState<string | null>(null);
  const [showGuardedTransitionModal, setShowGuardedTransitionModal] = useState(false);
  const [showAppointmentPicker, setShowAppointmentPicker] = useState(false);

  // In-chair dynamic session state (supports inline editing immediately & later, with auto-increment)
  const [inChairPatientNumber, setInChairPatientNumber] = useState<number>(1);
  const [inChairPatientCustomName, setInChairPatientCustomName] = useState<string>('');
  const inChairPatientCustomNameRef = useRef<string>('');
  const [inChairPatientDob, setInChairPatientDob] = useState<string>('');
  const [inChairOperatory, setInChairOperatory] = useState<string>('Room 1');
  const [inChairApptType, setInChairApptType] = useState<AppointmentType>('examination');

  useEffect(() => {
    inChairPatientCustomNameRef.current = inChairPatientCustomName;
  }, [inChairPatientCustomName]);

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
    const tz = getClinicTimeZone();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(currentDate);
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
    recorder: MediaRecorder | null;
    flush: () => Promise<unknown>;
  }>({ chairKey: '', recorder: null, flush: () => Promise.resolve() });

  // Convert real database consultations into live encounters (Zero mock fallbacks)
  const patientEncounters: PatientEncounter[] = useMemo(() => {
    return consultations.map((c, index) => {
      const operatory = c.findings?.customSections?.operatory || `Op ${(index % 3) + 1}`;
      const timeStr = c.time || formatClinicTime(new Date());
      const fullName = `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Patient';
      const procedureText = c.appointmentType
        ? `${c.appointmentType.charAt(0).toUpperCase() + c.appointmentType.slice(1)} • ${c.findings?.treatmentPerformed ? c.findings.treatmentPerformed.slice(0, 32) : 'Clinical Procedure'}`
        : 'Restorative Care';

      // Parse medical alerts from genuine patient history, findings, or live operatory transcript
      const combinedTranscript = (c.transcript || []).concat(localLiveTranscripts[c.id] || []);
      const alerts = parseClinicalAlerts(c.findings, combinedTranscript);

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
        (c.clinicalProgressNote && c.clinicalProgressNote.trim().length > 0) ||
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
      } else if (c.status === 'Completed' || hasActualGeneratedNote) {
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
    const fullDate = formatClinicDate(currentDate, { month: 'short', day: 'numeric', year: 'numeric' });
    const clinicTimeZone = getClinicTimeZone();
    return patientEncounters
      .filter(p => {
        const orig = consultations.find(c => c.id === p.id);
        if (!orig?.date) return false;
        // QLE-2026-0002: compare one canonical clinic-day key instead of
        // hand-matching date shapes, so "2026-09-28", a timestamp, "Sep 28" and
        // "28/09/2026" all resolve to the same day and a record that belongs to
        // today cannot be dropped by a format mismatch.
        const dayKey = clinicDayKeyOfStoredDate(orig.date, clinicTimeZone);
        if (dayKey) return dayKey === currentDateStr;
        // The stored date could not be interpreted. Fall back to the legacy
        // shape checks so an unfamiliar-but-recoverable format is not silently
        // excluded; an uninterpretable record is surfaced by the focus guard
        // below rather than causing a wrong-patient switch.
        const d = orig.date.trim();
        return d === currentDateStr || d === shortDate || d.startsWith(shortDate) || d === fullDate;
      })
      .sort((a, b) => {
        // Phase 13A (§20): shared deterministic ordering — normalized time →
        // createdAt → stable id/name. Tolerates "9 AM", "09:00", "9:00 AM";
        // unknown times no longer collapse onto a sentinel that silently
        // reorders the clinical day.
        const createdAtOf = (id: string) => consultations.find(c => c.id === id)?.createdAt;
        return compareEncounters(
          { ...a, createdAt: createdAtOf(a.id) },
          { ...b, createdAt: createdAtOf(b.id) }
        );
      });
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

  // Reset encounter state whenever active patient changes (guarantees clean reset across all 8+ switch sites)
  useEffect(() => {
    if (!activePatientId && encountersForDate.length === 0) {
      setEncounterState('empty');
    } else {
      setEncounterState('active');
    }
  }, [activePatientId, encountersForDate.length]);

  // Real-time multi-browser operatory synchronization — Phase 13A focus
  // invariant (§5/§8): an external roster event (another browser's walk-in or
  // live dialogue) may UPDATE the roster and SUGGEST a patient, but must
  // NEVER silently move the active encounter. Every switch below goes through
  // the ONE canonical transition (decidePatientSwitch): a clinical session
  // (mic live or finalization in flight) or a manual selection lock makes
  // external switching impossible; orphaned-active fallback (self-healing)
  // still routes through the same gate.
  useEffect(() => {
    // QLE-2026-0002: an explicitly opened record that EXISTS but is not dated to
    // the selected day (e.g. reopened from History Hub) must keep its focus. The
    // previous behaviour cleared it, which dropped the clinician onto the
    // "In-Chair Patient" scratchpad while still showing the patient's name in
    // the banner.
    // A record that has just been SEATED is being persisted asynchronously and
    // may not be in `consultations` yet. It still counts as existing here, or
    // the self-heal below would move the clinician off the patient they have
    // just sat down with.
    const activeRecordExists = Boolean(activePatientId)
      && !isUnscheduledChair(activePatientId)
      && (consultations.some(c => c.id === activePatientId)
        || seatingIdsRef.current.has(activePatientId));

    if (encountersForDate.length === 0) {
      if (activePatientId && !activeRecordExists) setActivePatientId('');
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

    // Do not hijack or redirect the ephemeral in-chair active encounter, nor an
    // appointment that is mid-seating.
    if (isUnscheduledChair(activePatientId) || seatingIdsRef.current.has(activePatientId)) return;

    // A clinical session is live while the microphone is recording/paused-mid-session or a
    // background finalization is in flight. External events must not move focus during one.
    const sessionActive = !isMicStandby || backgroundFinalizingIds.size > 0;

    // Self-healing: the active patient vanished from the roster (deleted,
    // date change, second browser). This is not a hijack — the current focus
    // points at nothing — but it still goes through the canonical gate.
    if (!encountersForDate.some(p => p.id === activePatientId)) {
      // QLE-2026-0002: never self-heal onto a DIFFERENT patient when the
      // focused record still exists — that is a wrong-patient surface. Keep the
      // clinician on their explicit selection and say why the roster does not
      // list it.
      if (activeRecordExists) {
        setTurnoverToast('This record is not dated to the selected day — its date could not be matched. Verify the patient before adding clinical content.');
        return;
      }
      const fallbackId = liveDiscussionEncounter?.id || encountersForDate[0].id;
      const decision = decidePatientSwitch({
        source: 'external-poll',
        targetPatientId: fallbackId,
        activePatientId,
        sessionActive,
      });
      if (decision.ok) {
        setActivePatientId(decision.targetPatientId);
        if (decision.effects.markManuallySelected) hasUserManuallySelectedRef.current = true;
      }
      return;
    }

    // If a brand-new walk-in arrived from another browser, remember it and —
    // when no session is active and the user has not locked onto a card —
    // SUGGEST it via the canonical gate (which refuses during a live session).
    if (walkInEncounter && walkInEncounter.id !== lastKnownWalkinIdRef.current) {
      lastKnownWalkinIdRef.current = walkInEncounter.id;
      if (!hasUserManuallySelectedRef.current) {
        const decision = decidePatientSwitch({
          source: 'external-poll',
          targetPatientId: walkInEncounter.id,
          activePatientId,
          sessionActive,
        });
        if (decision.ok) {
          setActivePatientId(walkInEncounter.id);
        } else {
          // This project compiles without strictNullChecks, under which union
          // narrowing is incomplete — explicit member check instead of `else if`
          // on a discriminated field (same pattern as signOffClient handling).
          const refusal = (decision as { refusal?: string }).refusal;
          if (refusal === 'external-focus-lock') {
            setTurnoverToast(`New walk-in added: ${walkInEncounter.patientName} — not switching (session active).`);
          }
        }
      }
      return;
    }

    // If user hasn't explicitly locked onto a card and a live encounter exists, suggest it.
    if (!hasUserManuallySelectedRef.current && liveDiscussionEncounter) {
      const decision = decidePatientSwitch({
        source: 'external-poll',
        targetPatientId: liveDiscussionEncounter.id,
        activePatientId,
        sessionActive,
      });
      if (decision.ok) {
        setActivePatientId(liveDiscussionEncounter.id);
      }
    }
  }, [encountersForDate, activePatientId, isMicStandby, backgroundFinalizingIds, consultations]);

  const activeEncounter = useMemo(() => {
    if (activePatientId === 'chair-active') return null;
    if (activePatientId) {
      const inDay = encountersForDate.find(p => p.id === activePatientId);
      if (inDay) return inDay;
      // QLE-2026-0002: an explicitly opened record that is not on the selected
      // day still resolves to ITSELF — never to the in-chair scratchpad and
      // never to a different patient. The record is mapped in patientEncounters
      // regardless of the day filter.
      const elsewhere = patientEncounters.find(p => p.id === activePatientId);
      if (elsewhere) return elsewhere;
      return null;
    }
    if (encountersForDate.length === 0) return null;
    return encountersForDate[0] || null;
  }, [encountersForDate, patientEncounters, activePatientId]);

  const activeConsult = useMemo(() => {
    if (!activeEncounter) return null;
    return consultations.find(c => c.id === activeEncounter.id) || null;
  }, [consultations, activeEncounter]);

  // Fallback to active chairside encounter when no pre-scheduled appointment exists
  const effectiveEncounter = useMemo<PatientEncounter>(() => {
    if (activeEncounter) return activeEncounter;
    const defaultName = inChairPatientNumber === 1 ? 'In-Chair Patient' : `In-Chair Patient ${inChairPatientNumber}`;
    const displayName = inChairPatientCustomName.trim() || defaultName;
    return {
      id: 'chair-active',
      consultationId: 'chair-active',
      time: formatClinicTime(new Date()),
      operatory: inChairOperatory,
      patientName: displayName,
      dob: inChairPatientDob || '',
      procedureText: inChairApptType === 'emergency' ? 'Emergency Examination' : 'General Consultation',
      appointmentType: inChairApptType,
      templateId: inChairApptType === 'emergency' ? 'emergency' : 'standard',
      status: isMicStandby ? 'ready' : isPaused ? 'ready' : 'recording',
      alerts: parseClinicalAlerts(undefined, localLiveTranscripts['chair-active'] || []),
      diarizedTranscript: localLiveTranscripts['chair-active'] || [],
      soap: { subjective: '', objective: '', assessment: '', plan: '' },
      cdtCodes: []
    };
  }, [activeEncounter, inChairPatientNumber, inChairPatientCustomName, inChairPatientDob, inChairOperatory, inChairApptType, isMicStandby, isPaused, localLiveTranscripts]);

  // ─────────────────────────────────────────────────────────────
  // 1c. APPOINTMENT IDENTITY — one id per visit, minted at seating
  // ─────────────────────────────────────────────────────────────
  // A just-seated appointment is persisted asynchronously, so it is not yet in
  // `consultations` when the focus invariant runs below. Tracking the ids being
  // seated is what stops that invariant from moving the clinician off the
  // patient they have just sat down with.
  const seatingIdsRef = useRef<Set<string>>(new Set());

  // The in-chair appointment this session is working under, once one has been
  // seated. It is what makes "switch back to the operatory" a SWITCH rather
  // than a second appointment — see openInChairAppointment below.
  const inChairAppointmentIdRef = useRef<string | null>(null);

  // ─────────────────────────────────────────────────────────────
  // 1d. AI-ASSIST CONSENT — one capture, carried by every write
  // ─────────────────────────────────────────────────────────────
  // A consultation that carries a transcript cannot be saved (nor signed) on a
  // deployment with DENTAI_REQUIRE_CONSENT=true unless consent has actually been
  // recorded for it. Consent is captured ONCE and is append-only, so the rule
  // here is: attach consent to a write when — and only when — it exists, either
  // on the record itself or as a capture this session's clinician made. Nothing
  // is assumed, back-dated or defaulted; see src/lib/aiConsent.ts.
  const [capturedConsents, setCapturedConsents] = useState<Record<string, ConsultationConsent>>({});
  const capturedConsentsRef = useRef<Record<string, ConsultationConsent>>({});
  const latestConsultationsRef = useRef<Consultation[]>(consultations);
  latestConsultationsRef.current = consultations;

  const rememberConsent = useCallback((id: string, consent: ConsultationConsent) => {
    capturedConsentsRef.current = { ...capturedConsentsRef.current, [id]: consent };
    setCapturedConsents(capturedConsentsRef.current);
  }, []);

  /**
   * Carry a day-sheet consent onto the encounter it was captured for.
   *
   * The day sheet and the encounter are two views of one appointment: the row
   * is what the desk captures consent against, the encounter is what records
   * the visit. Starting the appointment must carry that capture onto the
   * record — but only the capture that EXISTS: a flag with no instant converts
   * to nothing (see src/lib/aiConsent.ts), and a consent already on the record
   * always wins, because consent is append-only.
   */
  const adoptScheduleRowConsent = useCallback((encounterId: string): ConsultationConsent | null => {
    if (!encounterId || encounterId === UNSCHEDULED_CHAIR) return null;
    const record = latestConsultationsRef.current.find(c => c.id === encounterId);
    // A consent already on the record (or read back from the server) is the
    // consent that stands: consent is append-only, so nothing is re-adopted
    // over it and nothing overwrites it.
    if (recordedConsent(record)) return null;
    const rowConsent = consentFromCapture(
      loadTodaySchedule().find(
        row => row.consultationId === encounterId || (record?.scheduleItemId != null && row.id === record.scheduleItemId)
      ),
      currentUser?.id
    );
    if (!rowConsent) return null;
    if (!capturedConsentsRef.current[encounterId]) rememberConsent(encounterId, rowConsent);
    return rowConsent;
  }, [currentUser?.id, rememberConsent]);

  /**
   * Every consultation write leaving this workspace goes through here.
   *
   * Consent is a property of the RECORD (append-only), so a write that re-sends
   * a consented record is covered by the consent already on it; a write for an
   * encounter captured in this session is covered by that capture. A write for
   * an encounter with no consent is left alone — and a transcript-bearing one
   * will be refused by the server, visibly, rather than silently queued.
   */
  const saveConsultation = useCallback(
    (consult: Consultation): Promise<void> | void => {
      if (!onSaveConsultation) return;
      const record = consult.consent
        ? consult
        : latestConsultationsRef.current.find(c => c.id === consult.id);
      const consent = consentForWrite(record, capturedConsentsRef.current[consult.id] ?? null);
      return onSaveConsultation(consent && !consult.consent ? { ...consult, consent } : consult);
    },
    [onSaveConsultation]
  );

  // EVERY way an encounter becomes active — a day-schedule card, a History Hub
  // view, a reopened record — passes through `activePatientId`. The day-sheet
  // capture is adopted here, and persisted onto the record when the record
  // already exists: consent must be ON the record before a transcript-bearing
  // write needs it (a session-only capture would not travel with the write).
  useEffect(() => {
    if (!activePatientId) return;
    const adopted = adoptScheduleRowConsent(activePatientId);
    if (!adopted) return;
    const existing = latestConsultationsRef.current.find(c => c.id === activePatientId);
    if (existing && !recordedConsent(existing)) {
      void saveConsultation({ ...existing, consent: adopted });
    }
  }, [activePatientId, adoptScheduleRowConsent, saveConsultation]);

  // What the banner shows for the encounter on screen: the consent on the
  // record (server-held, append-only) or this session's capture. Absent means
  // "not recorded" — a state the UI must be able to present honestly.
  const activeEncounterId = activeEncounter?.id || effectiveEncounter.id;
  const activeConsent =
    recordedConsent(latestConsultationsRef.current.find(c => c.id === activeEncounterId))
    ?? capturedConsents[activeEncounterId]
    ?? null;

  /**
   * Seat a patient in the chair: mint ONE appointment id, make it the active
   * encounter, and persist the appointment immediately.
   *
   * Persisting before clinical content exists is the point, not an oversight.
   * `/api/transcribe/audio` refuses audio for a consultation the server has
   * never seen, and a record with no server-stamped version can never be
   * signed. Without this, the in-chair visit had no identity at all: its
   * recording was never stored, its transcript was never diarized server-side,
   * Sign Off was unreachable — and the record was renamed at finalisation,
   * which detached whatever had already been filed under the earlier id.
   */
  const seatInChairAppointment = (overrides?: Partial<Consultation>): string => {
    const id = mintAppointmentId();
    seatingIdsRef.current.add(id);
    inChairAppointmentIdRef.current = id;

    // A consent captured for the un-seated chair carries onto the appointment
    // the patient is now seated as — the capture belongs to the patient in the
    // chair, not to the placeholder id it was made under.
    const unseatedConsent = capturedConsentsRef.current[UNSCHEDULED_CHAIR];
    if (unseatedConsent) rememberConsent(id, unseatedConsent);

    const names = (inChairPatientCustomName || '').trim().split(' ').filter(Boolean);

    const seated: Consultation = {
      id,
      dentistId: currentUser?.id || '',
      clinicId: activeClinicId || undefined,
      firstName: names[0] || '',
      lastName: names.slice(1).join(' '),
      dob: inChairPatientDob || '',
      appointmentType: inChairApptType,
      templateId: inChairApptType === 'emergency' ? 'emergency' : 'standard',
      date: getClinicTodayIso(),
      time: formatClinicTime(new Date()),
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
        customSections: { operatory: inChairOperatory },
        adaCodes: []
      },
      ...overrides
    };

    setActivePatientId(id);
    // Fire-and-forget: the switch must stay synchronous (the clinician is
    // already with the next patient), and a shell that fails here is written
    // by the ordinary save path when the appointment is completed.
    void saveConsultation(seated);
    return id;
  };

  // Active transcript (no confidence gating — dentist decides when to regenerate)
  const currentOperatoryEncounter = activeEncounter || effectiveEncounter;

  // ─────────────────────────────────────────────────────────────
  // 2b. SERVER-AUTHORITATIVE SIGN-OFF (Phase 12E)
  // ─────────────────────────────────────────────────────────────
  // The record version a sign-off request is based on comes ONLY from server
  // responses (fetched records, save responses, refusal payloads) — never from
  // locally constructed state — so the server's optimistic-concurrency check
  // is meaningful and a stale request is refused with 409, not guessed past.
  const [serverRecordVersions, setServerRecordVersions] = useState<Record<string, number>>({});
  // Signed state / refusal state — populated ONLY from server responses.
  const [signOffSeal, setSignOffSeal] = useState<Record<string, AttestationSeal>>({});
  const [signOffBusyId, setSignOffBusyId] = useState<string | null>(null);
  const [signOffErrors, setSignOffErrors] = useState<Record<string, { code: string; message: string; currentVersion?: number }>>({});
  const signOffTargetVersion = serverRecordVersions[effectiveEncounter?.id || '']
    ?? consultations.find(c => c.id === effectiveEncounter?.id)?.recordVersion;

  useEffect(() => {
    const id = effectiveEncounter?.id;
    if (!id || id === 'chair-active') return;
    const rec = consultations.find(c => c.id === id);
    if (rec && typeof rec.recordVersion === 'number') {
      setServerRecordVersions(prev => (prev[id] === rec.recordVersion ? prev : { ...prev, [id]: rec.recordVersion }));
    }
  }, [consultations, effectiveEncounter?.id]);

  // Phase 13A (§23): the SERVER's persisted seal is the source of truth for
  // the signed projection. `signOffSeal` remains as the in-session mirror for
  // the just-signed instant (before the next roster refresh); the derived map
  // makes "Signed" survive reload, patient switch and a second browser.
  const serverSeals = useMemo(() => {
    const map: Record<string, AttestationSeal> = {};
    for (const c of consultations) {
      const seal = (c as unknown as { attestation?: AttestationSeal }).attestation;
      if (seal?.signatureHash) map[c.id] = seal;
    }
    return map;
  }, [consultations]);
  const effectiveSeals = useMemo(() => ({ ...serverSeals, ...signOffSeal }), [serverSeals, signOffSeal]);

  const handleSignOffActiveNote = useCallback(async () => {
    const targetId = activeEncounter?.id || effectiveEncounter.id;
    if (!authToken || !targetId || targetId === 'chair-active') return;
    if (signOffBusyId) return;
    const expectedVersion = serverRecordVersions[targetId]
      ?? consultations.find(c => c.id === targetId)?.recordVersion;
    if (typeof expectedVersion !== 'number') {
      // Without a server-stamped version the request cannot even be framed —
      // refuse locally rather than guess a version.
      setSignOffErrors(prev => ({ ...prev, [targetId]: { code: 'NO_VERSION', message: 'This record has not been saved to the server yet, so it cannot be signed.' } }));
      return;
    }
    setSignOffBusyId(targetId);
    try {
      const result = await requestSignOff({
        authToken,
        consultationId: targetId,
        expectedVersion,
        // Phase 13A: a DETERMINISTIC idempotency key. A timestamp-based nonce
        // could never collide, so it guarded nothing; a per-(record,version)
        // key lets the server recognize a genuine duplicate submission of the
        // same signing intent. The primary replay guard is the persisted seal.
        requestNonce: `${targetId}:${expectedVersion}`
      });
      // NOTE: explicit member extraction rather than relying on boolean-union
      // narrowing — this project compiles without strictNullChecks, under
      // which narrowing of `{ ok: true } | { ok: false; … }` is incomplete.
      if (result.ok) {
        const approval = result as Extract<SignOffClientResult, { ok: true }>;
        // Signed state is established by the server's response ONLY.
        setSignOffSeal(prev => ({ ...prev, [targetId]: approval.seal }));
        setSignOffErrors(prev => {
          const next = { ...prev };
          delete next[targetId];
          return next;
        });
        setServerRecordVersions(prev => ({ ...prev, [targetId]: approval.recordVersion }));
        setEncounterState('finished');
      } else {
        // Display the server's refusal verbatim. A stale-version refusal means
        // the record moved; the clinician must re-review — the client never
        // silently re-signs or overwrites.
        const refusal = result as Extract<SignOffClientResult, { ok: false }>;
        setSignOffErrors(prev => ({
          ...prev,
          [targetId]: { code: refusal.code, message: refusal.message, currentVersion: refusal.currentVersion }
        }));
        if (refusal.currentVersion != null) {
          setServerRecordVersions(prev => ({ ...prev, [targetId]: refusal.currentVersion }));
        }
      }
    } finally {
      setSignOffBusyId(null);
    }
  }, [activeEncounter, effectiveEncounter.id, authToken, signOffBusyId, serverRecordVersions, consultations]);

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
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [progressNoteSaveStatus, setProgressNoteSaveStatus] = useState<Record<string, 'saved' | 'saving'>>({});
  const [progressiveDrafts, setProgressiveDrafts] = useState<Record<string, string>>({});
  const progressiveDraftTimerRef = useRef<Record<string, any>>({});
  const [turnoverToast, setTurnoverToast] = useState<string | null>(null);
  // Phase 13A: which encounter the current turnover toast refers to, so the
  // Signed/Unsigned badge reflects the PRIOR patient (the one handed off),
  // not whichever patient is newly active on screen.
  const [turnoverToastTargetId, setTurnoverToastTargetId] = useState<string | null>(null);

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
    if (pendingSaveConsultationRef.current) {
      const consultToSave = pendingSaveConsultationRef.current;
      pendingSaveConsultationRef.current = null;
      try {
        await saveConsultation(consultToSave);
      } catch (e) {
        console.warn('Failed to flush debounced consultation save:', e);
      }
    }
  }, [saveConsultation]);

  // Unmount safety: flush pending consultation saves
  useEffect(() => {
    return () => {
      if (saveDebounceTimerRef.current) {
        clearTimeout(saveDebounceTimerRef.current);
      }
      if (pendingSaveConsultationRef.current) {
        Promise.resolve(saveConsultation(pendingSaveConsultationRef.current)).catch(() => {});
      }
    };
  }, [saveConsultation]);

  /**
   * Record the patient's AI-assist consent, chairside.
   *
   * This is the ONLY place the cockpit creates a consent object, and it can only
   * be reached by the clinician confirming that the disclosure was given: the
   * capture instant, the disclosure wording version and the practitioner are
   * stamped at that moment (see src/lib/aiConsent.ts), and the capture is
   * persisted immediately — so the consent is ON the record before a
   * transcript-bearing save needs it, never asserted as part of one.
   */
  const recordAiConsent = useCallback(async () => {
    const encounterId = activeEncounterRef.current?.id || '';
    if (!encounterId) return;
    const consent = consentFromCapture(
      {
        consentObtained: true,
        consentCapturedAt: new Date().toISOString(),
        consentPractitionerId: currentUser?.id || '',
      },
      currentUser?.id
    );
    if (!consent) return;
    rememberConsent(encounterId, consent);
    const existing = latestConsultationsRef.current.find(c => c.id === encounterId);
    if (existing) {
      await saveConsultation({ ...existing, consent });
    }
    setTurnoverToast(`AI-assist consent recorded (disclosure ${consent.disclosureVersion}).`);
  }, [currentUser?.id, rememberConsent, saveConsultation]);

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
    sessionStartTimeRef.current = recordingSeconds > 0 ? Date.now() - (recordingSeconds * 1000) : Date.now();
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

  const performPatientSwitch = useCallback((patientId: string) => {
    // Starting a scheduled appointment from the day sheet carries the consent
    // the desk captured for it onto the encounter being opened.
    adoptScheduleRowConsent(patientId);

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
    setEncounterState('active');
    setIsMicStandby(true);
    setIsPaused(false);
    setIsSilenceWarning(false);
    isSilenceWarningRef.current = false;
    hasPlayedWarningChimeRef.current = false;
    setRecordingSeconds(0);
    setInterimTranscript('');
    sessionStartTimeRef.current = Date.now();
    lastVoicedTimeRef.current = Date.now();
  }, [adoptScheduleRowConsent, flushPendingConsultationSave, playMedicalChime]);

  const handleSelectPatient = useCallback((patientId: string) => {
    hasUserManuallySelectedRef.current = true;
    if (patientId === activePatientId) return;

    // Check if the current encounter has an active recording or captured audio
    const currentId = activePatientId;
    const hasLiveAudioRecorded = !isMicStandbyRef.current || recordingSeconds > 0 || ((localLiveTranscriptsRef.current[currentId]?.length ?? 0) > 0);

    if (hasLiveAudioRecorded && encounterState !== 'finished') {
      setPendingSwitchPatientId(patientId);
      setShowGuardedTransitionModal(true);
      return;
    }

    performPatientSwitch(patientId);
  }, [activePatientId, recordingSeconds, encounterState, performPatientSwitch]);

  /**
   * The in-chair card's single entry point.
   *
   * The card is rendered on every day view, and it must never mint a second
   * appointment for a visit that is already open. Before this, clicking it while
   * the in-chair patient was active was a no-op (the scratchpad marker was
   * already the active id); minting here moved the clinician onto a fresh empty
   * record carrying the SAME patient's name — the duplicate chart the day
   * schedule then showed twice — and moved the audio namespace onto the record
   * that would not be the one signed. If the in-chair appointment is open, the
   * card SWITCHES back to it; only a session with no seated appointment starts
   * a new one.
   */
  const openInChairAppointment = () => {
    const seated = inChairAppointmentIdRef.current;
    if (seated && seated === activePatientId) return;
    if (
      seated &&
      (consultations.some(c => c.id === seated) || seatingIdsRef.current.has(seated))
    ) {
      handleSelectPatient(seated);
      return;
    }
    seatInChairAppointment();
  };

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

    await saveConsultation(newConsultation);

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
  }, [currentUser, activeClinicId, saveConsultation, handleSelectPatient, handleStartAudio]);


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
    if (existingConsultation) {
      const updatedConsultation: Consultation = {
        ...existingConsultation,
        clinicalProgressNote: value
      };

      try {
        await saveConsultation(updatedConsultation);
        setProgressNoteSaveStatus(prev => ({ ...prev, [targetId]: 'saved' }));
      } catch (e) {
        console.warn('Failed to auto-save clinical progress note:', e);
      }
    } else {
      setProgressNoteSaveStatus(prev => ({ ...prev, [targetId]: 'saved' }));
    }
  }, [activeEncounter, saveConsultation]);

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
      let localCounter = 0;
      let localQueue: Promise<unknown> = Promise.resolve();
      const currentTargetConsultId = consultationId;

      chunkUploadRef.current = {
        chairKey: currentTargetConsultId,
        recorder,
        flush: () => localQueue
      };

      recorder.ondataavailable = (event: BlobEvent) => {
        if (!event.data || event.data.size === 0) return;
        const index = localCounter;
        localCounter += 1;
        const blob = event.data;
        // Chained onto the previous upload so slices land in order without cross-recorder interference
        localQueue = localQueue
          .then(async () => {
            const base64 = await blobToBase64(blob);
            await uploadAudioSegment({
              authToken,
              consultationId: currentTargetConsultId,
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

      // Detect spoken greeting name (e.g. "Hi Josh, great to see you") to auto-populate in-chair name
      if (targetId === 'chair-active' && !inChairPatientCustomNameRef.current) {
        const greetingMatch = normalized.match(/\b(?:hi|hello|welcome|morning|afternoon)\s+([A-Z][a-z]{1,20})\b/i);
        if (greetingMatch && greetingMatch[1]) {
          const candidateName = greetingMatch[1].trim();
          const stopWords = ['there', 'everyone', 'again', 'doctor', 'nurse', 'assistant', 'today', 'mate', 'sir', 'madam'];
          if (!stopWords.includes(candidateName.toLowerCase())) {
            const capitalized = candidateName.charAt(0).toUpperCase() + candidateName.slice(1).toLowerCase();
            setInChairPatientCustomName(capitalized);
            inChairPatientCustomNameRef.current = capitalized;
          }
        }
      }

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
          const targetConsult: Consultation = consultationsRef.current.find(c => c.id === targetId) || existingConsultation || {
            id: targetId,
            dentistId: currentUser?.id || '',
            clinicId: activeClinicId || undefined,
            firstName: effectiveEncounter.patientName !== 'In-Chair Patient' ? effectiveEncounter.patientName : 'In-Chair',
            lastName: effectiveEncounter.patientName !== 'In-Chair Patient' ? '' : 'Patient',
            dob: effectiveEncounter.dob || '',
            appointmentType: effectiveEncounter.appointmentType || 'examination',
            date: currentDateStr,
            time: effectiveEncounter.time,
            status: 'In Review',
            templateId: effectiveEncounter.templateId || 'standard',
            transcript: [],
            findings: { chiefComplaint: '', history: '', toothFindings: '', findingsGingival: '', diagnosis: '', treatmentPerformed: '', recommendations: '', recallRequirements: '', adaCodes: [] },
            patientSummary: ''
          };
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
      const patientName = `${firstName} ${lastName}`.trim();

      // One appointment, one encounter. If this slot already IS a row on the
      // day sheet, start the record filed under it — never mint a second chart
      // under the same schedule row.
      const existingRow = findScheduleItemBySlot(loadTodaySchedule(currentDateStr), currentDateStr, item.time, patientName);
      const linkedEncounter = existingRow?.consultationId
        ? latestConsultationsRef.current.find(c => c.id === existingRow.consultationId)
        : undefined;
      // One identity per appointment: a minted id, not a stage name. The id is
      // the record, the audio namespace, the note-job key and (once signed) the
      // attestation target — so it must be the same value at every step.
      const consultId = linkedEncounter?.id || mintAppointmentId();

      if (!firstConsultId) {
        firstConsultId = consultId;
      }

      // The row is the appointment's address; write it — or its link — BEFORE
      // the encounter, so the encounter can name the row it belongs to.
      let rowId = existingRow?.id;
      if (existingRow) {
        updateScheduleItem(existingRow.id, {
          consultationId: consultId,
          dob: item.dob || existingRow.dob,
          procedureText: item.procedureText || existingRow.procedureText
        }, currentDateStr);
      } else {
        const createdRow = addScheduleItem({
          time: item.time,
          patientName,
          dob: item.dob || '',
          procedureText: item.procedureText,
          appointmentType: item.appointmentType || 'examination',
          templateId: item.templateId || 'standard',
          consultationId: consultId
        }, currentDateStr);
        rowId = createdRow.id;
      }

      // A record that predates this rule is healed in place: the encounter
      // exists, it simply has not named its row yet.
      if (linkedEncounter && !linkedEncounter.scheduleItemId && rowId) {
        await saveConsultation({ ...linkedEncounter, scheduleItemId: rowId });
      }

      if (!linkedEncounter) {
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
          // The row and the encounter name each other; consent captured on the
          // day sheet is carried, never invented (src/lib/aiConsent.ts).
          scheduleItemId: rowId,
          consent: consentFromCapture(existingRow, currentUser?.id) ?? undefined,
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

        await saveConsultation(newConsultation);
      }
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
      const patientName = `${firstName} ${lastName}`.trim();

      // One appointment, one encounter. If this slot already IS a row on the
      // day sheet, start the record filed under it — never mint a second chart
      // under the same schedule row.
      const existingRow = findScheduleItemBySlot(loadTodaySchedule(currentDateStr), currentDateStr, parsed.time, patientName);
      const linkedEncounter = existingRow?.consultationId
        ? latestConsultationsRef.current.find(c => c.id === existingRow.consultationId)
        : undefined;
      // One identity per appointment: a minted id, not a stage name. The id is
      // the record, the audio namespace, the note-job key and (once signed) the
      // attestation target — so it must be the same value at every step.
      const consultId = linkedEncounter?.id || mintAppointmentId();

      if (!firstConsultId) {
        firstConsultId = consultId;
      }

      // The row is the appointment's address; write it — or its link — BEFORE
      // the encounter, so the encounter can name the row it belongs to.
      let rowId = existingRow?.id;
      if (existingRow) {
        updateScheduleItem(existingRow.id, {
          consultationId: consultId,
          dob: parsed.dob || existingRow.dob,
          procedureText: parsed.procedure || existingRow.procedureText
        }, currentDateStr);
      } else {
        const createdRow = addScheduleItem({
          time: parsed.time,
          patientName,
          dob: parsed.dob || '',
          procedureText: parsed.procedure,
          appointmentType: 'restorative',
          templateId: 'standard',
          consultationId: consultId
        }, currentDateStr);
        rowId = createdRow.id;
      }

      // A record that predates this rule is healed in place: the encounter
      // exists, it simply has not named its row yet.
      if (linkedEncounter && !linkedEncounter.scheduleItemId && rowId) {
        await saveConsultation({ ...linkedEncounter, scheduleItemId: rowId });
      }

      if (!linkedEncounter) {
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
          // The row and the encounter name each other; consent captured on the
          // day sheet is carried, never invented (src/lib/aiConsent.ts).
          scheduleItemId: rowId,
          consent: consentFromCapture(existingRow, currentUser?.id) ?? undefined,
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

        await saveConsultation(newConsultation);
      }
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
  // A sentinel, not a clock string: the time is resolved from the clock when the
  // walk-in is actually added (see `resolveWalkInTime`).
  const [walkInTime, setWalkInTime] = useState('now');
  const [walkInReason, setWalkInReason] = useState('');
  // Set only when the clinician submits a date of birth that is not a real
  // calendar date; cleared as soon as they edit the field.
  const [walkInError, setWalkInError] = useState<string | null>(null);
  // Phase 13A (§18): the clinician picks the encounter type. Empty means "no
  // selection" — the safe generic intake applies, never a guessed emergency.
  const [walkInType, setWalkInType] = useState<AppointmentType | ''>('');

  /**
   * Resolves the walk-in time dropdown to a clock time at submit.
   *
   * The three options used to carry literal clock strings rendered at paint
   * time, so a card left open on a chairside screen filed the time it was first
   * drawn: a walk-in added at 8:52 AM was recorded at 6:57 AM, in the wrong
   * slot and in the wrong clinical day order. The option list also re-rendered
   * the label while the stored value stayed stale, so the visible choice and
   * the saved one disagreed.
   */
  const resolveWalkInTime = (selection: string): string => {
    if (selection === 'now') return formatClinicTime(new Date());
    if (selection === '+15') return formatClinicTime(new Date(Date.now() + 15 * 60000));
    if (selection === '+30') return formatClinicTime(new Date(Date.now() + 30 * 60000));
    return selection;
  };

  const handleAddWalkInToStream = async () => {
    if (!walkInName.trim()) return;

    // A date of birth is patient identity data: an impossible one is refused
    // here, where the clinician can see and fix it (see utils/date.dobFieldError).
    const dobProblem = dobFieldError(walkInDob);
    if (dobProblem) {
      setWalkInError(dobProblem);
      return;
    }

    let cleanTime = resolveWalkInTime(walkInTime).trim();
    if (cleanTime.endsWith(' A')) cleanTime = cleanTime.replace(/ A$/, ' AM');
    if (cleanTime.endsWith(' P')) cleanTime = cleanTime.replace(/ P$/, ' PM');

    // Phase 13A (§16–§18): collision-safe UUID id, explicit-or-safe-generic
    // appointment type, and NO fabricated transcript line — the intake note is
    // encounter metadata, not Dentist dialogue nobody spoke.
    const intake = buildWalkInIntake({
      patientName: walkInName,
      dob: walkInDob,
      appointmentType: walkInType || undefined,
      time: cleanTime,
      operatory: walkInRoom,
      chiefComplaint: walkInReason,
      newId: generateWalkInId,
    });

    // The day-sheet row and the encounter name each other, so a walk-in started
    // again from the schedule resolves to this same record.
    const typeLabel = APPOINTMENT_TYPES.find(t => t.value === intake.appointmentType)?.short || 'Consultation';
    const walkInRow = addScheduleItem({
      time: intake.time,
      patientName: `${intake.firstName} ${intake.lastName}`.trim(),
      dob: intake.dob,
      procedureText: `${typeLabel} • ${intake.chiefComplaint || 'Evaluation'}`,
      appointmentType: intake.appointmentType,
      templateId: intake.templateId,
      consultationId: intake.id
    });

    const newConsultation: Consultation = {
      id: intake.id,
      dentistId: currentUser?.id || '',
      clinicId: activeClinicId || undefined,
      firstName: intake.firstName,
      lastName: intake.lastName,
      dob: intake.dob,
      appointmentType: intake.appointmentType,
      templateId: intake.templateId,
      date: getClinicTodayIso(),
      time: intake.time,
      status: 'In Review',
      patientSummary: '',
      // §17: speech belongs in the transcript only when actually captured.
      transcript: [],
      scheduleItemId: walkInRow.id,
      findings: {
        // Only what the patient actually stated. An absent complaint stays
        // visibly absent instead of becoming "Emergency walk-in consultation".
        chiefComplaint: intake.chiefComplaint,
        history: '',
        toothFindings: '',
        findingsGingival: '',
        diagnosis: '',
        treatmentPerformed: '',
        recommendations: '',
        recallRequirements: '',
        customSections: { operatory: intake.operatory, intakeNote: intake.intakeNote },
        adaCodes: []
      }
    };

    await saveConsultation(newConsultation);

    handleSelectPatient(intake.id);
    setWalkInName('');
    setWalkInDob('');
    setWalkInReason('');
    setWalkInType('');
    setWalkInError(null);
    setShowWalkInCard(false);
  };

  const handleUpdateAppointmentType = (targetId: string, newType: AppointmentType) => {
    const typeInfo = APPOINTMENT_TYPES.find(t => t.value === newType);
    const newTemplateId = typeInfo?.defaultTemplateId || 'standard';

    const targetConsult = consultations.find(c => c.id === targetId);
    if (targetConsult) {
      const updatedConsult: Consultation = {
        ...targetConsult,
        appointmentType: newType,
        templateId: newTemplateId
      };
      void saveConsultation(updatedConsult);
    }
  };

  const handleQuickInductPatient = useCallback(async (data: { patientName: string; dob?: string; operatory?: string; appointmentType?: AppointmentType }) => {
    const trimmedName = data.patientName.trim();
    const names = trimmedName.split(' ');
    const firstName = names[0] || 'Patient';
    const lastName = names.slice(1).join(' ');

    const targetEncounter = activeEncounter || effectiveEncounter;
    const targetId = targetEncounter.id;

    // Always persist to in-chair dynamic state so edits immediately and permanently reflect
    if (!activeEncounter || activeEncounter.id === 'chair-active') {
      setInChairPatientCustomName(trimmedName);
      if (data.dob !== undefined) setInChairPatientDob(data.dob.trim());
      if (data.operatory) setInChairOperatory(data.operatory);
      if (data.appointmentType) setInChairApptType(data.appointmentType);
    }

    // If an existing consultation record is attached to this encounter, update it in-place
    const existingConsult = consultations.find(c => c.id === targetId);
    if (existingConsult) {
      const updatedConsult: Consultation = {
        ...existingConsult,
        firstName,
        lastName,
        dob: data.dob !== undefined ? data.dob.trim() : existingConsult.dob,
        appointmentType: data.appointmentType || existingConsult.appointmentType,
        findings: {
          ...existingConsult.findings,
          customSections: {
            ...existingConsult.findings?.customSections,
            operatory: data.operatory || existingConsult.findings?.customSections?.operatory || 'Room 1'
          }
        }
      };
      await saveConsultation(updatedConsult);
    }

    // Refresh any progressive draft so the patient header immediately reflects the updated name and DOB
    if (progressiveDrafts[targetId]) {
      const updatedHeaderDraft = progressiveDrafts[targetId].replace(
        /PATIENT:\s*([^\n\r]+)/i,
        `PATIENT: ${trimmedName}${data.dob ? ` (DOB: ${data.dob.trim()})` : ''}`
      );
      setProgressiveDrafts(prev => ({
        ...prev,
        [targetId]: updatedHeaderDraft
      }));
    }

    setTurnoverToast(`Patient updated: ${trimmedName}`);
  }, [activeEncounter, effectiveEncounter, consultations, saveConsultation, progressiveDrafts]);

  // ─────────────────────────────────────────────────────────────
  // 6. ASYNCHRONOUS NOTE FINALIZATION & NON-BLOCKING HANDOFF
  // ─────────────────────────────────────────────────────────────
  // Phase 13A (§10): synchronous in-flight guard for finalization. Unlike
  // `backgroundFinalizingIds` (React state, updated asynchronously and cleared
  // when the async work resolves), this ref is set SYNCHRONOUSLY and only
  // released when the attempt fully settles — so a rapid ⌘→ → ⌘← → ⌘→ (two
  // calls within one render cycle) can never start a second concurrent
  // finalization for the same consultation.
  const finalizationInFlightRef = useRef<Set<string>>(new Set());

  const executeBackgroundNoteFinalization = async (
    targetId: string,
    autoCopyClipboard = false,
    isFullFinalize = false,
    transcriptSnapshot?: TranscriptItem[],
    noteSnapshot?: string
  ) => {
    // Re-entrancy guard: an in-flight finalization for this consultation owns
    // the work end-to-end. This does NOT block the server's own durable-job
    // dedupe (Phase 9), which also protects two-browser races.
    if (finalizationInFlightRef.current.has(targetId)) {
      console.info(`Finalization already in flight for ${targetId}; skipping duplicate request.`);
      return undefined;
    }
    finalizationInFlightRef.current.add(targetId);
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
        status: isFullFinalize ? 'Completed' : 'In Review',
        appointmentType: effectiveEncounter.appointmentType || 'examination',
        templateId: 'standard',
        transcript: (transcriptSnapshot || localLiveTranscriptsRef.current[targetId] || localLiveTranscripts[targetId] || effectiveEncounter.diarizedTranscript || []).map(t => ({
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

      // Guarantee 0 lost lines: Prioritize passed immutable snapshot, then merge in-memory local feed with persisted consultation transcript
      let liveTranscript: TranscriptItem[] = [];
      if (transcriptSnapshot && transcriptSnapshot.length > 0) {
        liveTranscript = transcriptSnapshot;
      } else {
        const localFeed = localLiveTranscriptsRef.current[targetId] || localLiveTranscripts[targetId] || [];
        const remoteFeed = targetConsult.transcript || [];
        if (localFeed.length >= remoteFeed.length && localFeed.length > 0) {
          liveTranscript = localFeed.map(item => {
            const senderLower = ((item.sender || (item as any).role || (item as any).speaker || '').toLowerCase());
            const sender: TranscriptItem['sender'] = senderLower.includes('patient')
              ? 'Patient'
              : senderLower.includes('dentist') || senderLower.includes('clinician')
                ? 'Dentist'
                : 'Dialogue';
            return { sender, text: item.text };
          });
        } else if (remoteFeed.length > 0) {
          liveTranscript = remoteFeed;
        }
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
      const finalWarnings = [...transcriptionWarnings, ...transcriptChoice.warnings];

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
              transcript: sanitizedTranscript,
              // Phase 13A (§10): the synchronous path is keyed by consultation
              // id server-side, so a rapid next/previous toggle (or a second
              // browser) cannot start two concurrent generations for one
              // encounter — the duplicate receives 409 and falls through to
              // the idempotent durable-job path below.
              consultationId: targetConsult.id
            })
          });

          if (directRes.ok) {
            payload = await directRes.json();
          } else if (directRes.status === 409) {
            // Phase 13A (§10): the server reports another request is ALREADY
            // generating this note (rapid next/previous toggle across
            // browsers, or a concurrent tab). That peer owns the generation
            // and its save; this call must not duplicate it via the job queue
            // or the offline draft. The 3.5s roster poll will surface the
            // peer's completed note here.
            console.info('Direct generation already in progress for this consultation; deferring to the in-flight request.');
            return undefined;
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
              // QLE-2026-0018: the poll budget is derived from the worker's own
              // retry ladder, so the editor waits through the first server retry
              // (45s backoff) instead of abandoning a job that is about to
              // complete for the same encounter.
              const deadline = Date.now() + NOTE_JOB_CLIENT_POLL.deadlineMs;
              while (Date.now() < deadline) {
                await new Promise(r => setTimeout(r, NOTE_JOB_CLIENT_POLL.intervalMs));
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
      // record. An empty field is visibly unfinished; a fabricated one is not.
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

      // One identity per appointment. The id minted when the patient was SEATED
      // is the id this record is completed under — re-minting here is exactly
      // what detached the recorded audio (stored under the seated id), left the
      // note job unable to converge, and made the record unsignable. A record
      // with no identity at all (the un-seated marker) is minted once; every
      // record that already has an id keeps it, exactly as before.
      const persistId = mintIfUnseated(targetConsult.id);
      const isHostedNote = Boolean(payload && payload.groundingReport);
      let renderedNote = noteSnapshot;
      if (!renderedNote || !renderedNote.trim()) {
        try {
          renderedNote = renderUniversalProgressNote(toPmsEncounter({
            ...targetConsult,
            transcript: finalTranscript,
            findings: updatedFindings
          }));
        } catch {
          renderedNote = targetConsult.clinicalProgressNote || '';
        }
      }

      const finalizedConsultation: Consultation = {
        ...targetConsult,
        id: persistId,
        transcript: finalTranscript,
        transcriptProvenance: {
          source: transcriptSource,
          generatedAt: new Date().toISOString(),
          warnings: finalWarnings
        },
        status: isFullFinalize ? 'Completed' : 'In Review',
        patientSummary: payload?.patientSummary || targetConsult.patientSummary || '',
        findings: updatedFindings,
        clinicalProgressNote: renderedNote,
        specialistReferral: payload?.specialistReferral || targetConsult.specialistReferral,
        patientConsent: payload?.patientConsent || targetConsult.patientConsent,
        treatmentQuote: payload?.treatmentQuote || targetConsult.treatmentQuote,
        // Phase 12A: the engine stamp comes ONLY from the server payload. A
        // legacy record's old engine label must not gate the macro badge, and
        // the engine is never inferred client-side. Macro/template renderings
        // keep needsReview: true — a template is not a verification event.
        noteOrigin: payload?.noteOrigin
          ? {
              engine: (payload.noteOrigin as any).engine,
              needsReview: true,
              detail: payload?.groundingReport?.summary || `Generated via ${(payload.noteOrigin as any).engine || 'server engine'}`
            }
          : undefined,
        grounding: payload?.groundingReport
      };

      if (isFullFinalize || !isUnscheduledChair(targetConsult.id)) {
        await saveConsultation(finalizedConsultation);
        if (isFullFinalize) {
          const patientFullName = [finalizedConsultation.firstName, finalizedConsultation.lastName].filter(Boolean).join(' ') || 'In-Chair Patient';
          addScheduleItem({
            time: finalizedConsultation.time || formatClinicTime(new Date()),
            patientName: patientFullName,
            dob: finalizedConsultation.dob || '',
            procedureText: finalizedConsultation.findings?.chiefComplaint || (finalizedConsultation.appointmentType === 'emergency' ? 'Emergency Examination' : 'General Consultation'),
            appointmentType: finalizedConsultation.appointmentType || 'examination',
            templateId: finalizedConsultation.templateId || 'standard',
            status: 'done',
            consultationId: finalizedConsultation.id
          }, finalizedConsultation.date || currentDateStr);
        }
      }

      if (autoCopyClipboard) {
        handleCopyPMS(finalizedConsultation);
      }

      return finalizedConsultation;
    } catch (err) {
      // Phase 13A (§14): a failed finalization is a VISIBLE, recoverable
      // state — never a silent console entry while the UI claims success.
      console.error('Failed to finalize clinical note:', err);
      setFailedEncounterIds(prev => new Set(prev).add(targetId));
      setBackgroundFinalizingIds(prev => {
        const next = new Set(prev);
        next.delete(targetId);
        return next;
      });
      setTurnoverToast('Note generation failed — the encounter is marked for retry on the day view.');
      return undefined;
    } finally {
      // Phase 13A (§10): release the synchronous in-flight guard on every
      // exit path, whether the attempt succeeded, failed, or was skipped.
      finalizationInFlightRef.current.delete(targetId);
    }
  };

  const handleFinalizeNote = async () => {
    const targetEncounter = activeEncounter || effectiveEncounter;
    if (!targetEncounter) return;
    // Apple Medical Standard: Immediately halt active microphone on finalization
    if (!isMicStandby) {
      handleStopAudioToStandby();
    }
    setIsFinalizing(true);
    try {
      const snapTranscript = (localLiveTranscriptsRef.current[targetEncounter.id] || localLiveTranscripts[targetEncounter.id] || []).map(t => ({
        sender: (t.sender === 'Patient' || (t as any).role === 'patient' ? 'Patient' : t.sender === 'Dialogue' || (t as any).role === 'dialogue' ? 'Dialogue' : 'Dentist') as TranscriptItem['sender'],
        text: t.text
      }));
      const snapNote = editedProgressNotes[targetEncounter.id] || progressiveDrafts[targetEncounter.id] || '';
      await executeBackgroundNoteFinalization(targetEncounter.id, true, true, snapTranscript, snapNote);
    } finally {
      setIsFinalizing(false);
    }
  };

  // Immediate recovery: regenerate the clinical note directly from the live conversation
  const handleRegenerateFromConversation = () => {
    const targetEncounter = activeEncounter || effectiveEncounter;
    if (!targetEncounter) return;
    const manualEdit = editedProgressNotes[targetEncounter.id];
    if (manualEdit && manualEdit.trim().length > 0) {
      setShowRegenerateConfirm(true);
    } else {
      executeRegenerateNote();
    }
  };

  const executeRegenerateNote = async () => {
    const targetEncounter = activeEncounter || effectiveEncounter;
    if (!targetEncounter) return;
    setIsGeneratingFromConversation(true);
    try {
      // Clear manual edits for this encounter so the regenerated note immediately shows in the canvas
      setEditedProgressNotes(prev => {
        const next = { ...prev };
        delete next[targetEncounter.id];
        return next;
      });
      const finalized = await executeBackgroundNoteFinalization(targetEncounter.id, false, false);
      if (finalized) {
        const universalNote = renderUniversalProgressNote(toPmsEncounter(finalized));
        if (universalNote) {
          setProgressiveDrafts(prev => ({
            ...prev,
            [targetEncounter.id]: universalNote
          }));
        }
      }
      setTurnoverToast('Clinical note regenerated from live conversation.');
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
        // Phase 5 (fail-closed): a macro-finalized appointment is a template
        // rendering, not a verification event. Clinician review is required.
        needsReview: true,
        detail: `Generated via Australian ${macroNote.title} Macro`
      }
    };

    await saveConsultation(updatedConsultation);

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

  // Strict Encounter Lifecycle State Checks & Finalization Handler
  const isEncounterSealedOrDone = Boolean(
    effectiveEncounter.status === 'done' ||
    effectiveSeals[effectiveEncounter.id]?.signatureHash
  );

  const canAdvanceNextPatient = canAdvanceEncounter({
    encounterState,
    isEncounterSealedOrDone,
    recordingSeconds,
    isMicStandby,
    hasEditedNotes: Boolean(editedProgressNotes[effectiveEncounter.id]?.trim()),
    hasTranscript: Boolean(localLiveTranscripts[effectiveEncounter.id]?.length),
  });

  const handleFinishEncounter = async () => {
    const targetEncounter = activeEncounter || effectiveEncounter;
    if (!targetEncounter) return;
    setIsFinishingEncounter(true);
    try {
      if (!isMicStandbyRef.current) {
        handleStopAudioToStandby();
      }
      const snapTranscript = (localLiveTranscriptsRef.current[targetEncounter.id] || localLiveTranscripts[targetEncounter.id] || []).map(t => ({
        sender: (t.sender === 'Patient' || (t as any).role === 'patient' ? 'Patient' : t.sender === 'Dialogue' || (t as any).role === 'dialogue' ? 'Dialogue' : 'Dentist') as TranscriptItem['sender'],
        text: t.text
      }));
      const snapNote = editedProgressNotes[targetEncounter.id] || progressiveDrafts[targetEncounter.id] || '';
      const finalized = await executeBackgroundNoteFinalization(targetEncounter.id, false, true, snapTranscript, snapNote);
      
      // If finalization failed, do not mark as finished or unlock Next Patient
      if (!finalized) {
        return;
      }

      setEncounterState('finished');
      setTurnoverToast(`Encounter completed for ${targetEncounter.patientName}. Next Patient unlocked.`);
    } catch (err) {
      console.error('Failed to finish encounter:', err);
      setTurnoverToast('Failed to complete encounter. Please check connection.');
    } finally {
      setIsFinishingEncounter(false);
    }
  };

  // Guarded Transition Modal actions
  const handleGuardedSaveAndSwitch = useCallback(() => {
    if (!pendingSwitchPatientId) return;
    const currentId = activePatientId;
    const currentTarget = encountersForDate.find(p => p.id === currentId) || effectiveEncounter;
    const targetPatient = encountersForDate.find(p => p.id === pendingSwitchPatientId);

    const snapTranscript = (localLiveTranscriptsRef.current[currentId] || []).map(t => ({
      sender: (t.sender === 'Patient' || (t as any).role === 'patient' ? 'Patient' : t.sender === 'Dialogue' || (t as any).role === 'dialogue' ? 'Dialogue' : 'Dentist') as TranscriptItem['sender'],
      text: t.text
    }));
    const snapNote = editedProgressNotes[currentId] || progressiveDrafts[currentId] || '';

    void executeBackgroundNoteFinalization(currentId, false, true, snapTranscript, snapNote);
    performPatientSwitch(pendingSwitchPatientId);
    setShowGuardedTransitionModal(false);
    setPendingSwitchPatientId(null);
    setTurnoverToast(`Saved note for ${currentTarget.patientName}. Switched to ${targetPatient?.patientName || 'selected patient'}.`);
  }, [pendingSwitchPatientId, activePatientId, encountersForDate, effectiveEncounter, editedProgressNotes, progressiveDrafts, executeBackgroundNoteFinalization, performPatientSwitch]);

  const handleGuardedMoveAudioAndContinue = useCallback(async () => {
    if (!pendingSwitchPatientId) return;
    const currentId = activePatientId;
    const targetId = pendingSwitchPatientId;
    const targetPatient = encountersForDate.find(p => p.id === targetId);

    // 1. Flush any pending recorder slices
    await chunkUploadRef.current?.flush?.();

    // 2. Transfer server audio chunks from currentId to targetId
    void transferAudioSegments({
      authToken,
      fromConsultationId: currentId,
      toConsultationId: targetId
    });

    // 3. Transfer transcript buffer to target patient
    const liveItems = localLiveTranscriptsRef.current[currentId] || [];
    setLocalLiveTranscripts(prev => ({
      ...prev,
      [targetId]: [...liveItems],
      [currentId]: []
    }));
    localLiveTranscriptsRef.current[targetId] = [...liveItems];
    localLiveTranscriptsRef.current[currentId] = [];

    // 4. Transfer progressive draft if present
    const currentDraft = progressiveDrafts[currentId];
    if (currentDraft) {
      setProgressiveDrafts(prev => {
        const next = { ...prev, [targetId]: currentDraft };
        delete next[currentId];
        return next;
      });
    }

    // 5. Roll back Patient A's consultation record in database/cache
    const existingConsultA = consultations.find(c => c.id === currentId);
    if (existingConsultA) {
      const rolledBackA: Consultation = {
        ...existingConsultA,
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
        },
        clinicalProgressNote: '',
        patientSummary: ''
      };
      void saveConsultation(rolledBackA);
    }

    // 6. Switch patient identity while keeping microphone LIVE!
    adoptScheduleRowConsent(targetId);
    setActivePatientId(targetId);
    hasUserManuallySelectedRef.current = true;
    setEncounterState('active');
    setShowGuardedTransitionModal(false);
    setPendingSwitchPatientId(null);
    setTurnoverToast(`Moved active recording to ${targetPatient?.patientName || 'selected patient'}. Recording continues.`);
  }, [pendingSwitchPatientId, activePatientId, encountersForDate, progressiveDrafts, adoptScheduleRowConsent, authToken, consultations, saveConsultation]);

  const handleGuardedDiscardAndSwitch = useCallback(async () => {
    if (!pendingSwitchPatientId) return;
    const currentId = activePatientId;
    const targetPatient = encountersForDate.find(p => p.id === pendingSwitchPatientId);

    // 1. Purge server-side audio chunks for currentId
    void discardAudioSegments({ authToken, consultationId: currentId });

    // 2. Wipe local transcript & drafts for currentId
    setLocalLiveTranscripts(prev => ({ ...prev, [currentId]: [] }));
    localLiveTranscriptsRef.current[currentId] = [];
    setProgressiveDrafts(prev => {
      const next = { ...prev };
      delete next[currentId];
      return next;
    });
    setEditedProgressNotes(prev => {
      const next = { ...prev };
      delete next[currentId];
      return next;
    });

    // 3. Roll back Patient A's consultation in store
    const existingConsultA = consultations.find(c => c.id === currentId);
    if (existingConsultA) {
      const rolledBackA: Consultation = {
        ...existingConsultA,
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
        },
        clinicalProgressNote: '',
        patientSummary: ''
      };
      void saveConsultation(rolledBackA);
    }

    performPatientSwitch(pendingSwitchPatientId);
    setShowGuardedTransitionModal(false);
    setPendingSwitchPatientId(null);
    setTurnoverToast(`Discarded audio. Switched to ${targetPatient?.patientName || 'selected patient'}.`);
  }, [pendingSwitchPatientId, activePatientId, encountersForDate, performPatientSwitch, authToken, consultations, saveConsultation]);

  // Asynchronous Non-Blocking Patient Handoff ("Next Patient")
  // Phase 13A: the "nothing captured" decision consults the SERVER transcript
  // (§12) — not just local browser buffers — so a record whose dialogue lives
  // only in the server's diarized transcript can never be dismissed as empty.
  const handleNextPatient = () => {
    const currentTarget = activeEncounter || effectiveEncounter;
    const currentId = currentTarget.id;

    // Strict Encounter Lifecycle: block transition if encounter is not finished and has content
    if (!canAdvanceNextPatient) {
      setTurnoverToast(`Finish current encounter for ${currentTarget.patientName} to unlock next patient.`);
      return;
    }

    // 1. Silent non-blocking finalization of current patient with immutable snapshot (Rule 14 & Rule 18)
    // Guarantee 0 data loss: synchronously snapshot transcript and note before any state transition
    const existingConsult = consultations.find(c => c.id === currentId);
    const contentDecision = resolveSubstantiveContent({
      localTranscript: localLiveTranscriptsRef.current[currentId] || localLiveTranscripts[currentId],
      serverTranscript: existingConsult?.transcript,
      serverDiarizedTranscript: existingConsult?.transcriptProvenance?.source === 'server-diarized' ? existingConsult.transcript : undefined,
      noteText: editedProgressNotes[currentId] || progressiveDrafts[currentId] || (currentId === 'chair-active' ? '' : currentProgressNote) || '',
      hasExistingFindings: Boolean(
        existingConsult?.findings?.treatmentPerformed?.trim() ||
        existingConsult?.findings?.diagnosis?.trim() ||
        existingConsult?.findings?.toothFindings?.trim() ||
        existingConsult?.findings?.chiefComplaint?.trim() ||
        (existingConsult?.findings?.adaCodes && existingConsult.findings.adaCodes.length > 0) ||
        existingConsult?.clinicalProgressNote?.trim()
      ),
      finalizationPending: backgroundFinalizingIds.has(currentId),
    });
    const capturedTranscript = contentDecision.localSnapshot;
    const capturedNote = editedProgressNotes[currentId] || progressiveDrafts[currentId] || (currentId === 'chair-active' ? '' : currentProgressNote) || '';
    const hasSubstantiveContent = contentDecision.substantive;

    if (hasSubstantiveContent && !backgroundFinalizingIds.has(currentId)) {
      setBackgroundFinalizingIds(prev => new Set(prev).add(currentId));
      executeBackgroundNoteFinalization(currentId, false, true, capturedTranscript, capturedNote).finally(() => {
        setBackgroundFinalizingIds(prev => {
          const nextSet = new Set(prev);
          nextSet.delete(currentId);
          return nextSet;
        });
      });
    }

    // 2. Immediate halt of active audio on patient transition (Rule 14)
    if (!isMicStandbyRef.current) {
      handleStopAudioToStandby();
    } else {
      setIsMicStandby(true);
      setIsPaused(false);
      setRecordingSeconds(0);
      setInterimTranscript('');
    }

    // 3. Switch to next scheduled patient or auto-increment next in-chair patient.
    // Phase 13A: keyboard navigation is a MANUAL selection (§7) and goes
    // through the ONE canonical switch transition (§6).
    const currentIndex = encountersForDate.findIndex(p => p.id === activePatientId);
    const nextPatient = currentIndex !== -1 ? encountersForDate[currentIndex + 1] : undefined;

    if (nextPatient) {
      const decision = decidePatientSwitch({
        source: 'keyboard-next',
        targetPatientId: nextPatient.id,
        activePatientId,
        sessionActive: false,
      });
      if (!decision.ok) return;
      hasUserManuallySelectedRef.current = decision.effects.markManuallySelected;
      setActivePatientId(decision.targetPatientId);
      setEncounterState('active');
      sessionStartTimeRef.current = Date.now();
      setRecordingSeconds(0);
      // Phase 13A (§14): never claim the note was saved — finalization is
      // still in flight and can fail. The toast states what is actually true.
      if (hasSubstantiveContent) {
        setTurnoverToastTargetId(currentId);
        setTurnoverToast(`Finalizing prior note in background. Switched to scheduled patient: ${nextPatient.patientName}`);
      } else {
        setTurnoverToastTargetId(null);
        setTurnoverToast(`Switched to scheduled patient: ${nextPatient.patientName}`);
      }
    } else {
      // Advance to next in-chair patient with auto-incrementing designation.
      // Phase 13A (§13): the scratchpad is wiped ONLY when the just-finished
      // in-chair encounter has no meaningful content. When it does, the
      // buffers are RETAINED (the encounter was already enqueued for
      // finalization above and can be recovered from the day view) and the
      // toast tells the clinician what happened — never a silent discard.
      // Seat the next patient as a real appointment BEFORE recording can start:
      // the id minted here is the one every subsystem will use. The in-chair
      // identity fields still hold the PREVIOUS patient at this point (they are
      // cleared a few lines below), so the next appointment is born anonymous:
      // inheriting them would put one patient's name and date of birth on the
      // next patient's chart, and bind that chart to the wrong patient record.
      const seatedId = seatInChairAppointment({ firstName: '', lastName: '', dob: '' });
      const decision = decidePatientSwitch({
        source: 'keyboard-next',
        targetPatientId: seatedId,
        activePatientId,
        sessionActive: false,
      });
      if (!decision.ok) return;
      hasUserManuallySelectedRef.current = decision.effects.markManuallySelected;
      const nextNum = inChairPatientNumber + 1;
      setInChairPatientNumber(nextNum);
      setInChairPatientCustomName('');
      setInChairPatientDob('');
      setActivePatientId(seatedId);
      setEncounterState('active');
      sessionStartTimeRef.current = Date.now();
      setRecordingSeconds(0);

      if (hasSubstantiveContent) {
        // Retain the buffers: finalization owns the durable copy; wiping here
        // could destroy lines that arrived between snapshot and switch.
        setTurnoverToastTargetId(currentId);
        setTurnoverToast(`Finalizing prior note in background. Ready for In-Chair Patient ${nextNum}.`);
      } else {
        // Genuinely nothing captured — the wipe loses nothing (Rule 18).
        setLocalLiveTranscripts(prev => ({ ...prev, 'chair-active': [] }));
        localLiveTranscriptsRef.current['chair-active'] = [];
        setProgressiveDrafts(prev => {
          const next = { ...prev };
          delete next['chair-active'];
          return next;
        });
        setEditedProgressNotes(prev => {
          const next = { ...prev };
          delete next['chair-active'];
          return next;
        });
        setTurnoverToast(`Ready for In-Chair Patient ${nextNum}.`);
      }
    }
  };

  const handlePrevPatient = () => {
    const currentTarget = activeEncounter || effectiveEncounter;
    if (!canAdvanceNextPatient) {
      setTurnoverToast(`Finish current encounter for ${currentTarget.patientName} to unlock patient navigation.`);
      return;
    }

    const currentIndex = encountersForDate.findIndex(p => p.id === activePatientId);
    const prevPatient = currentIndex > 0
      ? encountersForDate[currentIndex - 1]
      : (currentIndex === -1 && encountersForDate.length > 0 ? encountersForDate[encountersForDate.length - 1] : undefined);
    if (!prevPatient) return;

    // Phase 13A: back-navigation uses the ONE canonical switch transition and
    // counts as manual selection, exactly like ⌘→ and a card click (§6/§7).
    const decision = decidePatientSwitch({
      source: 'keyboard-previous',
      targetPatientId: prevPatient.id,
      activePatientId,
      sessionActive: false,
    });
    if (!decision.ok) return;
    hasUserManuallySelectedRef.current = decision.effects.markManuallySelected;

    if (!isMicStandbyRef.current) {
      playMedicalChime('stop');
    }
    setActivePatientId(prevPatient.id);
    setEncounterState('active');
    sessionStartTimeRef.current = Date.now();
    setRecordingSeconds(0);
    setIsMicStandby(true);
    setIsPaused(false);
    setInterimTranscript('');
  };

  // Completed Encounters for End-of-Day Batch Tray (preserves count during asynchronous finalization)
  const completedEncounters = useMemo(() => {
    return encountersForDate.filter(p => p.status === 'note_generated' || p.status === 'done' || p.status === 'processing');
  }, [encountersForDate]);

  const [selectedPmsTarget, setSelectedPmsTarget] = useState<'d4w' | 'exact' | 'cliniko' | 'generic'>('d4w');

  // Generate note text formatted for PMS clipboard (incorporating clinician inline edits & PMS adapter)
  const getFormattedNoteText = useCallback((consultToCopy?: Consultation): string => {
    const targetId = consultToCopy ? consultToCopy.id : (activeEncounter?.id || effectiveEncounter.id);
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

    const isGenericChairActive = target.id === 'chair-active';
    const transcriptList = !isGenericChairActive && target.transcript && target.transcript.length > 0
      ? target.transcript
      : (localLiveTranscriptsRef.current[target.id] || localLiveTranscripts[target.id] || []);
    const hasAudio = transcriptList.length > 0;

    // 1. If clinician actively authored/edited the progress note directly in the text box, return that exact text!
    if (editedProgressNotes[target.id] !== undefined) {
      return editedProgressNotes[target.id];
    }
    // 2. If progressive speech draft exists for this target, return it
    if (progressiveDrafts[target.id]) {
      return progressiveDrafts[target.id];
    }
    // 3. If the consultation already has a saved progress note, return it
    // Rule 18: 'chair-active' with NO audio in the current session must NEVER inherit a saved progress note
    if (!isGenericChairActive && target.clinicalProgressNote && target.clinicalProgressNote.trim().length > 0) {
      return target.clinicalProgressNote;
    }

    // 4. Grounding Integrity Guard (Rule 12 & Rule 18):
    // If this is the generic in-chair scratchpad (chair-active) or an encounter with NO transcript audio in the current session:
    const isMacroOrigin = !isGenericChairActive && target.noteOrigin?.engine === 'australian-clinical-macro';
    const isCompleted = !isGenericChairActive && (target.status === 'Completed' || target.status === 'Signed');
    const hasObservedFindings = !isGenericChairActive && Boolean(
      target.findings?.toothFindings?.trim() ||
      target.findings?.chiefComplaint?.trim() ||
      target.findings?.diagnosis?.trim() ||
      target.findings?.treatmentPerformed?.trim() ||
      target.clinicalProgressNote?.trim()
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
      const targetEl = e.target as HTMLElement;
      const targetTag = targetEl?.tagName?.toLowerCase();
      const isInput =
        targetTag === 'input' ||
        targetTag === 'textarea' ||
        targetEl?.getAttribute('contenteditable') === 'true' ||
        Boolean(targetEl?.isContentEditable);

      // Spacebar: Start Audio / Pause Audio / Keep Listening
      if (e.key === ' ' && !isInput && !showRegenerateConfirm && !showDaysheetModal && !showBatchTray && !showDayGuide && !showDeliverablesModal && !showGuardedTransitionModal) {
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
      if (!isInput && !showRegenerateConfirm && !showDaysheetModal && !showPlainTextModal && !showBatchTray && !showDayGuide && !showDeliverablesModal && !showGuardedTransitionModal) {
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
      if (e.key === '?' && !isInput && !showRegenerateConfirm) {
        e.preventDefault();
        setShowDayGuide(prev => !prev);
      }

      // ⌘V / Ctrl+V: Open Daysheet Importer when not focused on an input
      if (isModifier && e.key.toLowerCase() === 'v' && !isInput && !showRegenerateConfirm) {
        e.preventDefault();
        setShowDaysheetModal(true);
      }
      // ⌘C / Ctrl+C / ⌘⇧C: Copy Note for PMS when not focused on an input
      else if (isModifier && e.key.toLowerCase() === 'c' && !isInput && !showRegenerateConfirm) {
        e.preventDefault();
        handleCopyPMS();
      }
      // ⌘B / Ctrl+B: Open Batch Tray
      else if (isModifier && e.key.toLowerCase() === 'b' && !isInput && !showRegenerateConfirm) {
        e.preventDefault();
        setShowBatchTray(prev => !prev);
      }
      // Escape: Dismiss active modal overlays
      if (e.key === 'Escape') {
        setShowRegenerateConfirm(false);
        setShowDayGuide(false);
        setShowBatchTray(false);
        setShowDaysheetModal(false);
        setShowPlainTextModal(false);
        setShowDeliverablesModal(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeEncounter, encountersForDate, consultations, dentistName, showDaysheetModal, showPlainTextModal, showBatchTray, showDeliverablesModal, showDayGuide, showRegenerateConfirm, showGuardedTransitionModal, handleKeepListening, handleStartAudio, handleTogglePause, handleNextPatient, handlePrevPatient, handleCopyPMS]);

  // QLE-2026-0001: signing out must never SILENTLY discard unsaved clinical
  // work. Whether that work must be preserved or may be discarded is a product
  // decision that is still open, so this implements the explicit-discard branch
  // only: the clinician is told that content exists and must confirm, instead of
  // the note disappearing with no signal on a routine action.
  const hasUnsavedClinicalWork = (): boolean => {
    const id = currentOperatoryEncounter?.id;
    if (!id) return false;
    const manual = (editedProgressNotes[id] || progressiveDrafts[id] || '').trim();
    const transcriptLines =
      (localLiveTranscripts[id]?.length || 0) +
      (Array.isArray((currentOperatoryEncounter as any)?.diarizedTranscript)
        ? (currentOperatoryEncounter as any).diarizedTranscript.length
        : 0);
    // A completed/signed record is durable — signing out cannot lose it.
    const finalised = activeConsult?.status === 'Completed' || Boolean(effectiveSeals[id]?.signatureHash);
    return !finalised && (manual.length > 0 || transcriptLines > 0);
  };

  const requestSignOut = () => {
    if (hasUnsavedClinicalWork()) {
      setShowLogoutConfirm(true);
      return;
    }
    onLogout();
  };

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
              onClick={requestSignOut}
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

                  {/* Phase 13A (§18): encounter type is an explicit choice.
                      Unselected = safe generic intake; only an explicit
                      Emergency applies emergency triage semantics. */}
                  <select
                    value={walkInType}
                    onChange={e => setWalkInType(e.target.value as AppointmentType | '')}
                    className="w-full px-2 py-1 text-[11px] font-medium border border-slate-200 rounded-lg bg-slate-50/50 text-slate-700"
                    aria-label="Encounter type"
                  >
                    <option value="">Encounter type — General (safe default)</option>
                    {APPOINTMENT_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>

                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      type="text"
                      value={walkInDob}
                      onChange={e => { setWalkInDob(e.target.value); if (walkInError) setWalkInError(null); }}
                      placeholder="DOB (DD/MM/YYYY)"
                      aria-invalid={walkInError ? true : undefined}
                      className={`w-full px-2.5 py-1 text-[11px] font-medium border rounded-lg focus:outline-none focus:border-sky-600 bg-slate-50/50 ${walkInError ? 'border-rose-300' : 'border-slate-200'}`}
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

                  {walkInError && (
                    <p className="text-[11px] font-semibold text-rose-700 flex items-start gap-1.5" data-testid="walkin-dob-error">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                      <span>{walkInError}</span>
                    </p>
                  )}

                  <div className="grid grid-cols-1 gap-1.5">
                    <select
                      value={walkInTime}
                      onChange={e => setWalkInTime(e.target.value)}
                      className="w-full px-2 py-1 text-[11px] font-medium border border-slate-200 rounded-lg bg-slate-50/50 text-slate-700"
                    >
                      <option value="now">Now ({formatClinicTime(new Date())})</option>
                      <option value="+15">{formatClinicTime(new Date(Date.now() + 15 * 60000))}</option>
                      <option value="+30">{formatClinicTime(new Date(Date.now() + 30 * 60000))}</option>
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
                {/* Active In-Chair Operatory Session Card (Always visible on today's schedule) */}
                {currentDateStr === getClinicTodayIso() && (() => {
                  // A SEATED in-chair appointment is still the operatory session.
                  // Without it the card loses its active/recording state the
                  // moment the patient is seated, and the clinician cannot tell
                  // which card the microphone is attached to.
                  const isChairActive = activePatientId === 'chair-active'
                    || (!activePatientId && encountersForDate.length === 0)
                    || (Boolean(inChairAppointmentIdRef.current) && activePatientId === inChairAppointmentIdRef.current);
                  return (
                    <div
                      key="chair-active"
                      onClick={openInChairAppointment}
                      className={`p-3 rounded-xl border transition cursor-pointer text-left ${isChairActive
                        ? 'bg-sky-50/70 border-sky-300/80 border-l-4 border-l-sky-600 shadow-xs ring-1 ring-sky-300/40'
                        : 'bg-white hover:bg-slate-50/80 border-slate-200/80 shadow-2xs'
                      }`}
                      title={isChairActive ? 'Active consultation in operatory' : 'Click to switch back to active operatory'}
                    >
                      <div className="flex items-start justify-between mb-1">
                        <div className="text-[11px] font-mono text-slate-500 font-tabular">
                          {effectiveEncounter.time} • <span className="text-slate-700 font-semibold">{effectiveEncounter.operatory?.replace(/Op /i, 'Room ') || 'Room 1'}</span>
                        </div>
                        {isChairActive && !isMicStandby && !isPaused ? (
                          <span className="bg-rose-50 text-rose-800 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-rose-200/90 flex items-center gap-1 shadow-2xs">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                            <span>Recording ({formatTimer(recordingSeconds)})</span>
                          </span>
                        ) : isChairActive && isPaused ? (
                          <span className="bg-amber-50 text-amber-800 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-amber-200/90 flex items-center gap-1 shadow-2xs">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                            <span>Paused</span>
                          </span>
                        ) : isChairActive ? (
                          <span className="bg-sky-50 text-sky-800 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-sky-200/90 flex items-center gap-1 shadow-2xs">
                            <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                            <span>In Operatory</span>
                          </span>
                        ) : (
                          <span className="bg-slate-100 text-slate-600 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-slate-200 flex items-center gap-1 shadow-2xs">
                            <span>Ready in Op</span>
                          </span>
                        )}
                      </div>
                      <div className="font-semibold text-xs text-slate-800 flex items-center justify-between">
                        <span>{effectiveEncounter.patientName}</span>
                        <span className="text-[10px] font-medium text-slate-500">{effectiveEncounter.procedureText}</span>
                      </div>
                    </div>
                  );
                })()}

                {encountersForDate.length === 0 && currentDateStr !== getClinicTodayIso() ? (
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
                                // Phase 13A (§14): the retry clears the failed
                                // marker BEFORE re-running finalization, so a
                                // second failure re-asserts it cleanly.
                                setFailedEncounterIds(prev => {
                                  const next = new Set(prev);
                                  next.delete(p.id);
                                  return next;
                                });
                                executeBackgroundNoteFinalization(p.id, false);
                              }}
                              className="bg-rose-50 hover:bg-rose-100 text-rose-800 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-rose-200 flex items-center gap-1 transition-colors cursor-pointer"
                              title="Note generation failed. Click to retry."
                            >
                              <RotateCw className="w-3 h-3 text-rose-600" />
                              <span>Retry</span>
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
                encounterState={encounterState}
                canAdvanceNextPatient={canAdvanceNextPatient}
                onSwitchAppointment={() => setShowAppointmentPicker(true)}
                consent={activeConsent}
                onRecordConsent={recordAiConsent}
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
                  onGenerateNote={handleRegenerateFromConversation}
                  onApplyMacro={(macroId) => handleApplyMacro(macroId)}
                  onCopyPMS={(format) => handleCopyPMS(undefined, format === 'universal' ? 'pms' : format)}
                  copiedFormat={copiedPmsTarget}
                  onOpenDeliverables={() => setShowDeliverablesModal(true)}
                  onNextPatient={handleNextPatient}
                  encounterState={encounterState}
                  canAdvanceNextPatient={canAdvanceNextPatient}
                  nextPatientLockReason="Finish current encounter to unlock next patient"
                  onFinishEncounter={handleFinishEncounter}
                  isFinishingEncounter={isFinishingEncounter}
                  hasActualGeneratedNote={Boolean(
                    currentProgressNote.trim().length > 0 &&
                    (Boolean(progressiveDrafts[effectiveEncounter.id]) ||
                     effectiveEncounter.status === 'done' ||
                     effectiveEncounter.status === 'note_generated' ||
                     consultations.find(c => c.id === effectiveEncounter.id)?.noteOrigin !== undefined)
                  )}
                  // Phase 12A: badge derivation lives in ONE fail-closed helper
                  // (uiVerification.ts) — the verified badge requires the
                  // server-derived condition
                  // groundingAudit.isApprovedForSigning === true; a macro
                  // rendering is always 'Template Applied'; anything else shows
                  // no verified claim at all. The badge is derived from the
                  // SERVER's consultation record (recomputed on every write),
                  // never from note existence, facts, generation success or the
                  // absence of errors.
                  groundingBadge={deriveGroundingBadge(
                    consultations.find(c => c.id === effectiveEncounter.id),
                    consultations.find(c => c.id === effectiveEncounter.id)?.noteOrigin?.engine === 'australian-clinical-macro'
                  ) ?? undefined}
                  // Phase 12: the canonical facts/evidence strip and the
                  // sign-off gate are consumers of the server's record only.
                  serverConsultation={consultations.find(c => c.id === effectiveEncounter.id) || null}
                  recordVersion={signOffTargetVersion ?? undefined}
                  onSignOff={handleSignOffActiveNote}
                  isSignedByServer={Boolean(effectiveSeals[effectiveEncounter.id]?.signatureHash)}
                  serverSeal={effectiveSeals[effectiveEncounter.id] || null}
                  signOffError={signOffErrors[effectiveEncounter.id] || null}
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
              canAdvanceNextPatient={canAdvanceNextPatient}
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
            {/* Phase 13A (§22): the turnover toast carries the day's
                attestation state so the clinician leaves each patient knowing
                what is signed and what still awaits sign-off. */}
            {turnoverToastTargetId && effectiveSeals[turnoverToastTargetId]?.signatureHash ? (
              <span className="ml-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300 border border-emerald-400/30">Signed</span>
            ) : (
              <span className="ml-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 border border-amber-400/30">Unsigned</span>
            )}
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

      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Unsaved Clinical Work</h3>
                <p className="text-xs text-slate-500">This consultation has not been completed</p>
              </div>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Signing out now will discard the captured lines and any note text for this encounter. Finish the note
              first if it should be kept.
            </p>
            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition cursor-pointer"
              >
                Stay Signed In
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowLogoutConfirm(false);
                  onLogout();
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition shadow-xs cursor-pointer"
              >
                Discard & Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {showRegenerateConfirm && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Replace Manual Edits?</h3>
                <p className="text-xs text-slate-500">Unsaved manual text detected in editor</p>
              </div>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Regenerating will replace your manual edits with fresh audio transcription from the recorded conversation. Continue?
            </p>
            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowRegenerateConfirm(false)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRegenerateConfirm(false);
                  executeRegenerateNote();
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-sky-700 hover:bg-sky-800 rounded-xl transition shadow-xs cursor-pointer flex items-center space-x-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Replace & Regenerate</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Appointment Switcher Modal ("Wrong patient? Switch Appointment") */}
      {showAppointmentPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Switch Active Appointment</h3>
                <p className="text-xs text-slate-500">Select the patient currently in the operatory chair ({dateLabel})</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAppointmentPicker(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2 flex-1">
              {encountersForDate.length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-xs">
                  No appointments scheduled for this date.
                </div>
              ) : (
                encountersForDate.map(p => {
                  const isCurrent = p.id === activePatientId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={isCurrent}
                      onClick={() => {
                        setShowAppointmentPicker(false);
                        handleSelectPatient(p.id);
                      }}
                      className={`w-full text-left p-3 rounded-xl border transition flex items-center justify-between cursor-pointer ${
                        isCurrent
                          ? 'border-sky-300 bg-sky-50/60 opacity-60 cursor-default'
                          : 'border-slate-200 hover:border-sky-500 hover:bg-sky-50/30'
                      }`}
                    >
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-bold text-slate-900">{p.patientName}</span>
                          {p.dob && <span className="text-[11px] text-slate-500 font-mono">DOB: {p.dob}</span>}
                          {isCurrent && (
                            <span className="text-[10px] font-bold text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded">
                              Current
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          <span>{p.time}</span> • <span>{p.procedureText}</span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    </button>
                  );
                })
              )}
            </div>

            <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setShowAppointmentPicker(false);
                  setShowWalkInCard(true);
                }}
                className="text-xs font-semibold text-sky-600 hover:text-sky-800 transition cursor-pointer"
              >
                + Add Walk-In Patient
              </button>
              <button
                type="button"
                onClick={() => setShowAppointmentPicker(false)}
                className="px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold transition cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Guarded Patient Transition Modal for active audio mistargeting protection */}
      <GuardedTransitionModal
        isOpen={showGuardedTransitionModal}
        currentPatientName={(activeEncounter || effectiveEncounter).patientName}
        targetPatientName={encountersForDate.find(p => p.id === pendingSwitchPatientId)?.patientName || 'Selected Patient'}
        onSaveAndSwitch={handleGuardedSaveAndSwitch}
        onMoveAudioAndContinue={handleGuardedMoveAudioAndContinue}
        onDiscardAndSwitch={handleGuardedDiscardAndSwitch}
        onCancel={() => {
          setShowGuardedTransitionModal(false);
          setPendingSwitchPatientId(null);
        }}
      />
    </div>
  );
}
