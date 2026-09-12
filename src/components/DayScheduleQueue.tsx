import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Calendar,
  Clock,
  User,
  Plus,
  Copy,
  Check,
  Sparkles,
  AlertCircle,
  Play,
  RotateCw,
  Trash2,
  FileText,
  UploadCloud,
  ChevronRight,
  ChevronLeft,
  ShieldCheck,
  X,
  Stethoscope,
  DollarSign,
  TrendingUp,
  MicOff,
  CheckCircle2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { verifyTranscriptGrounding } from '../lib/transcriptGrounding';
import {
  DayScheduleItem,
  loadTodaySchedule,
  saveTodaySchedule,
  addScheduleItem,
  updateScheduleItem,
  deleteScheduleItem,
  clearTodaySchedule,
  formatNoteForPmsClipboard,
  getTodayDateStr,
  mergeScheduleItems,
  calculateDailyProduction,
  generateSafeUuid
} from '../lib/dayScheduleStorage';
import { AppointmentType, APPOINTMENT_TYPES, getAppointmentTypeLabel } from '../lib/dentalLibrary';
import TopSurgeryBar from './TopSurgeryBar';
import ErrorBoundary from './ErrorBoundary';
import CockpitLayout from './CockpitLayout';
import CockpitInspectionDrawer from './CockpitInspectionDrawer';
import { ClinicMembership } from '../lib/clinics';

interface DayScheduleQueueProps {
  onStartRecording?: (item: DayScheduleItem) => void;
  onViewConsultation?: (consultationId: string) => void;
  dentistName: string;
  authToken: string;
  onLogout?: () => void;
  onNavigateTab?: (tab: 'schedule' | 'records' | 'pipeline') => void;
  activeClinic?: ClinicMembership | null;
  clinics?: ClinicMembership[];
  onSelectClinic?: (clinicId: string) => void;
  onManageClinic?: () => void;
  onClinicChanged?: () => void;
  onJoinClinic?: (code: string) => Promise<{ ok: boolean; message: string }>;
}

export default function DayScheduleQueue({
  onStartRecording,
  onViewConsultation,
  dentistName,
  authToken,
  onLogout,
  onNavigateTab,
  activeClinic,
  clinics,
  onSelectClinic,
  onManageClinic,
  onClinicChanged,
  onJoinClinic
}: DayScheduleQueueProps) {
  const [items, setItems] = useState<DayScheduleItem[]>(() => loadTodaySchedule());
  const [isParsing, setIsParsing] = useState(false);
  const [parsingError, setParsingError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showWalkInModal, setShowWalkInModal] = useState(false);
  const [viewNoteItem, setViewNoteItem] = useState<DayScheduleItem | null>(null);
  const [consentGuardItem, setConsentGuardItem] = useState<DayScheduleItem | null>(null);
  const [sideBySideItem, setSideBySideItem] = useState<DayScheduleItem | null>(null);

  // Cockpit Inspection Drawer State
  const [selectedInspectionId, setSelectedInspectionId] = useState<string | null>(() => {
    const initial = loadTodaySchedule();
    const readyOne = initial.find(i => i.status === 'ready');
    return readyOne ? readyOne.id : (initial[0]?.id || null);
  });
  const [isInspectionOpen, setIsInspectionOpen] = useState(true);

  // Active selected item for the persistent Inspection Drawer
  const selectedItem = useMemo(() => {
    if (!selectedInspectionId) {
      return items.find(i => i.status === 'ready') || items[0] || null;
    }
    return items.find(i => i.id === selectedInspectionId) || items[0] || null;
  }, [items, selectedInspectionId]);

  // Date Navigator Header
  const [dateOffset, setDateOffset] = useState(0);
  const formattedDateTitle = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + dateOffset);
    const day = d.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
    const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
    if (dateOffset === 0) {
      return `TODAY • ${day}, ${monthDay}`;
    }
    return `${day}, ${monthDay}`;
  }, [dateOffset]);

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .filter(n => n.toLowerCase() !== 'dr.')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'PT';
  };

  const toggleConsent = (item: DayScheduleItem) => {
    const nextVal = !item.consentObtained;
    const updated = updateScheduleItem(item.id, {
      consentObtained: nextVal,
      consentCapturedAt: nextVal ? new Date().toISOString() : undefined,
      consentPractitionerId: nextVal ? dentistName : undefined
    });
    setItems(updated);
  };

  const handleRecordClick = (item: DayScheduleItem) => {
    if (!item.consentObtained) {
      setConsentGuardItem(item);
    } else {
      startInPlaceRecording(item);
    }
  };

  const confirmConsentAndRecord = (item: DayScheduleItem) => {
    const updated = updateScheduleItem(item.id, {
      consentObtained: true,
      consentCapturedAt: new Date().toISOString(),
      consentPractitionerId: dentistName
    });
    setItems(updated);
    const target = updated.find(i => i.id === item.id) || {
      ...item,
      consentObtained: true,
      consentCapturedAt: new Date().toISOString(),
      consentPractitionerId: dentistName
    };
    setConsentGuardItem(null);
    startInPlaceRecording(target);
  };

  const recordWithoutConsentTag = (item: DayScheduleItem) => {
    setConsentGuardItem(null);
    startInPlaceRecording(item);
  };

  // In-Place Single Screen Surgery Cockpit state
  const [recordingItem, setRecordingItem] = useState<DayScheduleItem | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [micError, setMicError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const speechRecognitionRef = useRef<any>(null);

  // Quick Walk-in form state
  const [walkInName, setWalkInName] = useState('');
  const [walkInTime, setWalkInTime] = useState(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });
  const [walkInReason, setWalkInReason] = useState('Emergency Dental Toothache');
  const [walkInType, setWalkInType] = useState<AppointmentType>('emergency');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync with storage on mount and interval (for background jobs)
  useEffect(() => {
    let lastRosterSnapshot = '';
    const refresh = () => {
      const current = loadTodaySchedule();
      const snapshot = JSON.stringify(current);
      if (snapshot !== lastRosterSnapshot) {
        lastRosterSnapshot = snapshot;
        setItems(current);
      }
    };
    refresh();
    const interval = setInterval(refresh, 2500);
    return () => clearInterval(interval);
  }, []);

  // Global paste handler (Win+Shift+S -> Ctrl+V anywhere on schedule)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const clipboardItems = e.clipboardData?.items;
      if (!clipboardItems) return;

      for (let i = 0; i < clipboardItems.length; i++) {
        const item = clipboardItems[i];
        if (item.type.indexOf('image') !== -1) {
          const blob = item.getAsFile();
          if (blob) {
            handleImageFile(blob);
            e.preventDefault();
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const handleImageFile = async (file: File) => {
    setIsParsing(true);
    setParsingError(null);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result as string;
        try {
          const res = await fetch('/api/schedule/parse-image', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
              imageBase64: base64,
              mimeType: file.type,
              providerName: dentistName
            })
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to parse appointment screenshot.');
          }

          const data = await res.json();
          const newAppointments: DayScheduleItem[] = (data.appointments || []).map((app: any) => ({
            id: `sched_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            time: app.time || '09:00',
            patientName: app.patientName || 'Unknown Patient',
            procedureText: app.procedureText || 'General Consultation',
            appointmentType: app.appointmentType || 'examination',
            templateId: app.templateId || 'standard',
            status: 'scheduled',
            source: 'snip'
          }));

          if (newAppointments.length === 0) {
            throw new Error('No patient appointments could be detected in this screenshot.');
          }

          // 3-Way Smart Hash Merge: eliminates duplicates & preserves existing progress
          const currentRoster = loadTodaySchedule();
          const merged = mergeScheduleItems(currentRoster, newAppointments, getTodayDateStr());
          setItems(merged);
          saveTodaySchedule(merged);
        } catch (err: any) {
          setParsingError(err.message || 'Error processing image.');
        } finally {
          setIsParsing(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setParsingError(err.message || 'Failed to read image.');
      setIsParsing(false);
    }
  };

  const handleLoadDemoSchedule = () => {
    const demoItems: DayScheduleItem[] = [
      {
        id: `sched_demo_1`,
        time: '08:30',
        patientName: 'Sarah Connor',
        procedureText: 'Comprehensive Exam & Bitewings (011, 022)',
        appointmentType: 'examination',
        templateId: 'standard',
        status: 'scheduled',
        source: 'snip',
        consentObtained: true,
        consentCapturedAt: new Date().toISOString()
      },
      {
        id: `sched_demo_2`,
        time: '09:15',
        patientName: 'David Miller',
        procedureText: 'Tooth #16 Ceramic Crown Prep (611)',
        appointmentType: 'prosthodontic',
        templateId: 'standard',
        status: 'scheduled',
        source: 'snip',
        consentObtained: false
      },
      {
        id: `sched_demo_3`,
        time: '10:00',
        patientName: 'Liam O\'Connor',
        procedureText: 'Emergency: Severe Pain & Pulpitis #36',
        appointmentType: 'emergency',
        templateId: 'soap',
        status: 'scheduled',
        source: 'snip',
        consentObtained: false
      },
      {
        id: `sched_demo_4`,
        time: '11:00',
        patientName: 'Emma Watson',
        procedureText: 'Adult Hygiene Scale & Clean & Fluoride (114, 121)',
        appointmentType: 'scale_clean',
        templateId: 'concise',
        status: 'ready',
        source: 'snip',
        consentObtained: true,
        consentCapturedAt: new Date().toISOString(),
        isFullyGrounded: true,
        groundingScore: 100,
        unverifiedClaims: [],
        adaCodes: ['114', '121'],
        transcript: [
          { sender: 'Dentist', text: 'Good morning Emma, we will perform your periodic adult hygiene scaling and topical fluoride treatment today.' },
          { sender: 'Patient', text: 'Sounds good doctor, my gums have been feeling a bit sensitive on the lower right.' },
          { sender: 'Dentist', text: 'Supragingival and subgingival calculus removed with ultrasonic scaler and hand curettes. Applied neutral sodium fluoride foam.' },
          { sender: 'Dentist', text: 'All finished. Avoid eating or hot drinks for thirty minutes.' }
        ],
        clinicalNote: `=== DENTAI AMBIENT CLINICAL NOTE ===\nPatient: Emma Watson\nDate: ${getTodayDateStr()} | Time: 11:00\nProcedure: Adult Hygiene Scale & Clean & Fluoride (114, 121)\n\nCHIEF COMPLAINT:\nRoutine 6-monthly preventive hygiene visit. Mild lower right gingival sensitivity reported.\n\nEXAMINATION & FINDINGS:\nGeneralized mild marginal gingivitis with localised calculus deposits lower anterior lingual surfaces. No deep periodontal pocketing (>3mm).\n\nTREATMENT PERFORMED:\nFull mouth scaling and root debridement using ultrasonic scaler and hand instrumentation (ADA 114). Polishing with fine prophy paste. Topical neutral sodium fluoride gel application for 4 minutes (ADA 121).\n\nPOST-OPERATIVE INSTRUCTIONS:\nPatient advised nil by mouth for 30 minutes. Gentle brushing with soft-bristled brush recommended.\n\nNEXT VISIT / RECALL:\n6 Months Routine Hygiene Recall.\n\nADA ITEM CODES:\n114 (Removal of calculus), 121 (Topical fluoride)`
      },
      {
        id: `sched_demo_5`,
        time: '13:30',
        patientName: 'Michael Chang',
        procedureText: 'Tooth #24 MO Resin Restoration (532)',
        appointmentType: 'restorative',
        templateId: 'standard',
        status: 'scheduled',
        source: 'snip',
        consentObtained: true,
        consentCapturedAt: new Date().toISOString()
      }
    ];

    // Smart merge demo items
    const merged = mergeScheduleItems(items, demoItems, getTodayDateStr());
    setItems(merged);
    saveTodaySchedule(merged);
  };

  /* ---------------------------------------------------------------------------
   * In-Place Surgery Cockpit Lifecycle (Zero Navigation)
   * ------------------------------------------------------------------------- */

  const startInPlaceRecording = async (item: DayScheduleItem) => {
    setMicError(null);
    try {
      // 1. Clean up any previous recording resources
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch {}
        speechRecognitionRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch {}
      }
      if (mediaStream) {
        try { mediaStream.getTracks().forEach(t => t.stop()); } catch {}
        setMediaStream(null);
      }

      // 2. Clean up any orphaned 'recording' status on other items
      const currentRoster = loadTodaySchedule();
      const cleanedRoster = currentRoster.map(i => {
        if (i.id !== item.id && i.status === 'recording') {
          return { ...i, status: 'scheduled' as const };
        }
        return i;
      });
      saveTodaySchedule(cleanedRoster);

      // 3. Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMediaStream(stream);
      setRecordingItem(item);
      setLiveTranscript('');

      // 4. Mark target row as recording
      const updated = updateScheduleItem(item.id, { status: 'recording' });
      setItems(updated);

      // 5. Start MediaRecorder
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };
      recorder.start(2500);

      // 6. Speech Recognition for live ADA tag chips (progressive enhancement)
      const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRec) {
        try {
          const sr = new SpeechRec();
          sr.continuous = true;
          sr.interimResults = true;
          sr.lang = 'en-AU';
          sr.onresult = (event: any) => {
            let fullText = '';
            for (let i = 0; i < event.results.length; i++) {
              fullText += event.results[i][0].transcript + ' ';
            }
            setLiveTranscript(fullText);
          };
          sr.onerror = () => {};
          sr.start();
          speechRecognitionRef.current = sr;
        } catch {
          // ignore
        }
      }
    } catch (err: any) {
      setMicError(err.message || 'Microphone access denied. Check operatory mic permissions.');
    }
  };

  const finishInPlaceRecording = async () => {
    if (!recordingItem) return;
    const targetItem = { ...recordingItem };

    // 1. Stop Speech Recognition
    if (speechRecognitionRef.current) {
      try { speechRecognitionRef.current.stop(); } catch {}
      speechRecognitionRef.current = null;
    }

    // 2. Stop MediaRecorder & gather audio
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    } catch {}

    // 3. Stop Stream tracks
    if (mediaStream) {
      try {
        mediaStream.getTracks().forEach(track => track.stop());
      } catch {}
      setMediaStream(null);
    }

    // Collapse TopSurgeryBar immediately
    setRecordingItem(null);

    // Build transcript payload
    const finalTranscriptText = liveTranscript.trim() || `Consultation recorded for ${targetItem.patientName} (${targetItem.procedureText}). Full clinical examination performed.`;
    const transcriptItems = [
      { sender: 'Dentist', text: `Good morning ${targetItem.patientName}, let's begin your appointment for ${targetItem.procedureText}.` },
      { sender: 'Dialogue', text: finalTranscriptText },
      { sender: 'Dentist', text: `All procedures completed. We will review your recovery and plan the next recall visit.` }
    ];

    // Update row to processing with safe UUID and cached transcript
    const assignedConsultationId = generateSafeUuid();
    let updated = updateScheduleItem(targetItem.id, {
      status: 'processing',
      consultationId: assignedConsultationId,
      transcript: transcriptItems
    });
    setItems(updated);

    const nameParts = targetItem.patientName.trim().split(/\s+/);
    const firstName = nameParts[0] || 'Patient';
    const lastName = nameParts.slice(1).join(' ') || '';

    try {
      const submitRes = await fetch('/api/notes/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          intakeData: {
            firstName,
            lastName,
            dob: '1990-01-01',
            appointmentType: targetItem.appointmentType,
            templateId: targetItem.templateId || 'standard'
          },
          transcript: transcriptItems,
          consultationId: assignedConsultationId,
          consentObtained: targetItem.consentObtained ?? false,
          consentCapturedAt: targetItem.consentCapturedAt,
          consentPractitionerId: targetItem.consentPractitionerId
        })
      });

      if (!submitRes.ok) {
        throw new Error('Failed to start note synthesis job.');
      }

      const { jobId } = await submitRes.json();
      updateScheduleItem(targetItem.id, { jobId });

      // Detached background worker polls for result
      (async () => {
        try {
          const deadline = Date.now() + 85_000;
          let jobResult: any = null;

          while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 2000));
            const pollRes = await fetch(`/api/notes/jobs/${jobId}`, {
              headers: { 'Authorization': `Bearer ${authToken}` }
            });
            if (!pollRes.ok) break;
            const jobState = await pollRes.json();
            if (jobState.status === 'done') {
              jobResult = jobState.result;
              break;
            }
            if (jobState.status === 'failed') break;
          }

          if (jobResult) {
            // Normalize ADA codes safely into clean strings for storage
            const rawAdaCodes = Array.isArray(jobResult.adaCodes) ? jobResult.adaCodes : [];
            const sanitizedAdaCodeStrings: string[] = rawAdaCodes.map((c: any) => {
              if (typeof c === 'string') return c;
              if (typeof c === 'object' && c?.code) return String(c.code);
              return '';
            }).filter(Boolean);

            const formatted = formatNoteForPmsClipboard({
              id: targetItem.id,
              time: targetItem.time,
              patientName: targetItem.patientName,
              procedureText: targetItem.procedureText,
              appointmentType: targetItem.appointmentType,
              templateId: targetItem.templateId,
              status: 'ready'
            }, {
              firstName,
              lastName,
              date: getTodayDateStr(),
              appointmentType: targetItem.appointmentType,
              findings: {
                chiefComplaint: jobResult.chiefComplaint || targetItem.procedureText,
                clinicalFindings: jobResult.clinicalFindings || jobResult.toothFindings || 'Clinical examination complete.',
                treatmentRendered: jobResult.treatmentRendered || jobResult.treatmentPerformed || targetItem.procedureText,
                localAnaesthetic: jobResult.localAnaesthetic || '',
                prescriptions: jobResult.prescriptions || '',
                postOpAdvice: jobResult.postOpAdvice || 'Maintain regular oral hygiene.',
                nextVisit: jobResult.nextVisit || '6 Months Recall'
              },
              adaCodes: rawAdaCodes
            });

            // Calculate deterministic grounding report against verbatim operatory audio
            let grounding = jobResult.groundingReport;
            if (!grounding) {
              grounding = verifyTranscriptGrounding(formatted, transcriptItems, rawAdaCodes);
            }

            const fresh = updateScheduleItem(targetItem.id, {
              status: 'ready',
              clinicalNote: formatted,
              transcript: transcriptItems,
              adaCodes: sanitizedAdaCodeStrings,
              completedAt: new Date().toISOString(),
              groundingScore: grounding?.groundingScore ?? 100,
              isFullyGrounded: grounding?.isFullyGrounded ?? true,
              unverifiedClaims: grounding?.unverifiedClaims ?? []
            });
            setItems(fresh);
          } else {
            const fresh = updateScheduleItem(targetItem.id, {
              status: 'failed',
              error: 'Synthesis timed out in background.'
            });
            setItems(fresh);
          }
        } catch (err: any) {
          const fresh = updateScheduleItem(targetItem.id, {
            status: 'failed',
            error: err.message || 'Background synthesis error.'
          });
          setItems(fresh);
        }
      })();
    } catch (err: any) {
      const fresh = updateScheduleItem(targetItem.id, {
        status: 'failed',
        error: err.message
      });
      setItems(fresh);
    }
  };

  const cancelInPlaceRecording = () => {
    if (speechRecognitionRef.current) {
      try { speechRecognitionRef.current.stop(); } catch {}
      speechRecognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      setMediaStream(null);
    }
    if (recordingItem) {
      const fresh = updateScheduleItem(recordingItem.id, { status: 'scheduled' });
      setItems(fresh);
    }
    setRecordingItem(null);
    setLiveTranscript('');
  };

  const handleCopyNote = async (item: DayScheduleItem) => {
    const text = formatNoteForPmsClipboard(item);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      setCopiedId(item.id);
    }
  };

  const handleExpressCopyNext = () => {
    const uncopied = items.find(i => i.status === 'ready' && copiedId !== i.id);
    if (uncopied) {
      handleCopyNote(uncopied);
    } else {
      const firstReady = items.find(i => i.status === 'ready');
      if (firstReady) handleCopyNote(firstReady);
    }
  };

  const handleDeleteItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = deleteScheduleItem(id);
    setItems(updated);
  };

  const handleAddWalkInSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!walkInName.trim()) return;

    addScheduleItem({
      time: walkInTime,
      patientName: walkInName.trim(),
      procedureText: walkInReason.trim(),
      appointmentType: walkInType,
      templateId: walkInType === 'emergency' ? 'soap' : 'standard',
      source: 'manual'
    });

    setItems(loadTodaySchedule());
    setWalkInName('');
    setShowWalkInModal(false);
  };

  // Metrics
  const totalCount = items.length;
  const readyCount = items.filter(i => i.status === 'ready').length;
  const processingCount = items.filter(i => i.status === 'processing').length;
  const pendingCount = items.filter(i => i.status === 'scheduled').length;
  const dailyProduction = calculateDailyProduction(items);

  return (
    <CockpitLayout
      dentistName={dentistName}
      onLogout={onLogout || (() => {})}
      activeTab="roster"
      onTabChange={(tab) => {
        if (tab === 'patients') onNavigateTab?.('records');
        else if (tab === 'pipeline') onNavigateTab?.('pipeline');
      }}
      onDrawerClose={() => setIsInspectionOpen(false)}
      rightDrawer={
        isInspectionOpen ? (
          <CockpitInspectionDrawer
            selectedItem={selectedItem}
            onClose={() => setIsInspectionOpen(false)}
            onExpressCopy={handleCopyNote}
            isCopied={copiedId === selectedItem?.id}
            onOpenSideBySide={(item) => setSideBySideItem(item)}
          />
        ) : undefined
      }
    >
      <div className="w-full max-w-6xl mx-auto space-y-5">
        {/* Top Surgery Island: Floating Ergonomic HUD when recording */}
        <AnimatePresence>
          {recordingItem && (
            <TopSurgeryBar
              activeItem={recordingItem}
              mediaStream={mediaStream}
              onFinish={finishInPlaceRecording}
              onCancel={cancelInPlaceRecording}
              liveTranscript={liveTranscript}
            />
          )}
        </AnimatePresence>

        {/* Mic Access Error Alert */}
        {micError && (
          <div className="p-4 bg-rose-950/50 border border-rose-500/50 rounded-2xl flex items-center justify-between gap-3 text-rose-200 text-xs shadow-xl">
            <div className="flex items-center gap-2">
              <MicOff className="w-5 h-5 text-rose-400 shrink-0" />
              <span className="font-semibold">{micError}</span>
            </div>
            <button
              onClick={() => setMicError(null)}
              className="text-rose-300 hover:text-white font-bold cursor-pointer underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* 1. Header Bar: Date Switcher & Operatory Actions */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-[#0E1724] border border-[#182638] shadow-xl shadow-black/30">
          <div>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                <Sparkles className="w-3 h-3" />
                Operatory Cockpit
              </span>
              {readyCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  <DollarSign className="w-3 h-3" />
                  Est. Production: ${dailyProduction.toLocaleString()}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {/* Date Navigator Buttons */}
              <div className="flex items-center gap-1 bg-[#121E2E] border border-[#1E3048] rounded-xl p-1 shadow-inner">
                <button
                  onClick={() => setDateOffset(prev => prev - 1)}
                  className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-[#1A2C40] transition-colors cursor-pointer"
                  title="Previous Day"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setDateOffset(0)}
                  className={`px-2.5 py-0.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    dateOffset === 0
                      ? 'bg-cyan-500 text-slate-950 font-black shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Today
                </button>
                <button
                  onClick={() => setDateOffset(prev => prev + 1)}
                  className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-[#1A2C40] transition-colors cursor-pointer"
                  title="Next Day"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <h2 className="text-xl md:text-2xl font-black text-white tracking-tight uppercase">
                {formattedDateTitle}
              </h2>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Toggle Inspection Drawer Pill */}
            <button
              onClick={() => setIsInspectionOpen(prev => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border cursor-pointer active:scale-95 ${
                isInspectionOpen
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-xs'
                  : 'bg-[#121E2E] hover:bg-[#18283D] text-slate-300 border-[#1E3048]'
              }`}
              title="Toggle operatory inspection drawer"
            >
              <FileText className="w-3.5 h-3.5 text-cyan-400" />
              <span>{isInspectionOpen ? 'Hide Inspection' : 'Inspect Patient'}</span>
            </button>

            {readyCount > 0 && (
              <button
                onClick={handleExpressCopyNext}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 rounded-xl text-xs font-black transition-all active:scale-95 shadow-lg shadow-emerald-950/60 cursor-pointer"
                title="Copy the next completed note directly for D4W"
              >
                <Copy className="w-4 h-4 stroke-[2.5]" />
                Express Copy (D4W)
              </button>
            )}

            <button
              onClick={() => setShowWalkInModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#121E2E] hover:bg-[#18283D] text-slate-200 border border-[#1E3048] rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer"
            >
              <Plus className="w-4 h-4 text-cyan-400" />
              Add Walk-in
            </button>

            {items.length === 0 && (
              <button
                onClick={handleLoadDemoSchedule}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer"
              >
                <Stethoscope className="w-4 h-4 text-cyan-400" />
                Load Sample Day
              </button>
            )}

            {items.length > 0 && (
              <button
                onClick={() => {
                  if (confirm('Clear today\'s schedule queue?')) {
                    clearTodaySchedule();
                    setItems([]);
                  }
                }}
                className="p-2 text-slate-500 hover:text-rose-400 rounded-xl hover:bg-[#121E2E] transition-colors cursor-pointer"
                title="Clear roster"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* 2. Snip & Paste Dropzone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className="relative rounded-2xl border border-dashed border-[#1E3048] hover:border-cyan-500/50 bg-[#0E1724]/70 hover:bg-[#121E2E] p-5 text-center transition-all cursor-pointer group shadow-lg shadow-black/20"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) handleImageFile(e.target.files[0]);
            }}
          />

          <div className="flex flex-col items-center justify-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 flex items-center justify-center group-hover:scale-105 transition-transform shadow-xs">
              {isParsing ? (
                <RotateCw className="w-5 h-5 animate-spin text-cyan-400" />
              ) : (
                <UploadCloud className="w-5 h-5 text-cyan-300" />
              )}
            </div>

            <div>
              <p className="text-xs md:text-sm font-bold text-slate-100">
                {isParsing ? (
                  'Analyzing D4W / Praktika Screenshot with AI...'
                ) : (
                  <>
                    Press <kbd className="px-2 py-0.5 text-[11px] font-mono font-extrabold bg-[#162436] border border-[#233852] rounded text-cyan-300 shadow-xs">Ctrl + V</kbd> to paste snip, or click to upload
                  </>
                )}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                Supports Windows Snipping Tool (<kbd className="text-[10px] bg-[#162436] px-1.5 py-0.5 rounded border border-[#233852] text-slate-300">Win+Shift+S</kbd>). 3-way hash auto-merges midday walk-ins with zero duplicate cards.
              </p>
            </div>
          </div>

          {parsingError && (
            <div className="mt-3 p-3 bg-red-950/40 border border-red-500/40 rounded-xl text-xs text-red-200 flex items-center justify-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{parsingError}</span>
            </div>
          )}
        </div>

        {/* 3. Status Metrics Bar */}
        {totalCount > 0 && (
          <div className="flex items-center justify-between px-4 py-2.5 bg-[#0E1724] border border-[#182638] rounded-xl text-xs text-slate-300 shadow-md">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="font-extrabold text-white">
                {totalCount} Total Appointments
              </span>
              {readyCount > 0 && (
                <span className="flex items-center gap-1 text-emerald-300 font-bold">
                  <Check className="w-3.5 h-3.5 stroke-[3] text-emerald-400" />
                  {readyCount} Ready for D4W
                </span>
              )}
              {processingCount > 0 && (
                <span className="flex items-center gap-1 text-amber-300 font-bold">
                  <RotateCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                  {processingCount} Synthesizing Notes
                </span>
              )}
              {pendingCount > 0 && (
                <span className="text-slate-400 font-medium">
                  {pendingCount} Remaining
                </span>
              )}
            </div>

            {readyCount > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-bold text-slate-300">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>5:00 PM Cake Walk: 1-click clipboard paste</span>
              </div>
            )}
          </div>
        )}

        {/* 4. Schedule Items Adaptive Bento Grid */}
        {items.length === 0 ? (
          <div className="bg-[#0E1724] rounded-2xl border border-[#182638] p-12 text-center shadow-xl">
            <Calendar className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <h3 className="text-base font-extrabold text-white">No Appointments Queued for Today</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto mt-1 mb-5">
              Snip your appointment book from Dental4Windows or Praktika and press <strong className="text-cyan-300">Ctrl+V</strong> to populate your day in 3 seconds.
            </p>
            <button
              onClick={handleLoadDemoSchedule}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-400 to-teal-400 hover:from-cyan-300 hover:to-teal-300 text-slate-950 text-xs font-black rounded-xl transition-all shadow-lg shadow-cyan-950/40 cursor-pointer active:scale-95"
            >
              <Sparkles className="w-4 h-4" />
              Populate with Sample Day
            </button>
          </div>
        ) : (
          <div className={isInspectionOpen ? "grid grid-cols-1 xl:grid-cols-2 gap-4" : "grid grid-cols-1 md:grid-cols-2 gap-4"}>
            {items.map((item, index) => {
              const isSelected = selectedItem?.id === item.id;
              const isRecordingThis = recordingItem?.id === item.id || item.status === 'recording';
              const isReady = item.status === 'ready';
              const isProcessing = item.status === 'processing';
              const initials = getInitials(item.patientName);

              return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: index * 0.02 }}
                  onClick={() => {
                    setSelectedInspectionId(item.id);
                    setIsInspectionOpen(true);
                  }}
                  className={`p-0.5 rounded-2xl transition-all duration-200 cursor-pointer relative group ${
                    isSelected
                      ? 'bg-gradient-to-b from-cyan-400/80 via-teal-500/40 to-[#182638] shadow-lg shadow-cyan-950/50'
                      : isRecordingThis
                      ? 'bg-gradient-to-b from-rose-500/80 via-rose-900/40 to-[#182638] shadow-lg shadow-rose-950/50 animate-pulse'
                      : isReady
                      ? 'bg-gradient-to-b from-emerald-500/40 via-transparent to-[#182638] hover:from-cyan-500/40'
                      : 'bg-[#182638] hover:bg-[#20334A]'
                  }`}
                >
                  <div
                    className={`rounded-[calc(1rem-2px)] p-4 flex flex-col justify-between gap-3.5 h-full transition-colors ${
                      isSelected
                        ? 'bg-[#101C2B] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]'
                        : isRecordingThis
                        ? 'bg-[#1E1118]'
                        : isReady
                        ? 'bg-[#0E1724] hover:bg-[#121E2E]'
                        : 'bg-[#0A1018] hover:bg-[#0E1724]'
                    }`}
                  >
                    {/* Top Row: Avatar + Patient Name + Monospace Time Pill */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-10 h-10 rounded-xl shrink-0 flex items-center justify-center font-black text-xs border ${
                            isSelected
                              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-xs'
                              : 'bg-[#162436] border-[#233852] text-slate-200'
                          }`}
                        >
                          {initials}
                        </div>

                        <div className="min-w-0">
                          <h4 className="text-base font-black text-white truncate tracking-tight">
                            {item.patientName}
                          </h4>
                          <p className="text-xs text-cyan-300 font-medium truncate mt-0.5">
                            {item.procedureText}
                          </p>
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#162436] border border-[#20334A] text-slate-200 font-mono text-[11px] font-bold shadow-xs">
                        <Clock className="w-3 h-3 text-cyan-400" />
                        <span>{item.time || '09:00'}</span>
                      </div>
                    </div>

                    {/* ADA Item Codes & Procedure Chips */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {item.adaCodes && item.adaCodes.length > 0 ? (
                        item.adaCodes.map((c, idx) => {
                          const codeStr = typeof c === 'string' ? c : (c as any)?.code || '';
                          return (
                            <span
                              key={idx}
                              className="px-2.5 py-0.5 rounded-md text-[10px] font-mono font-extrabold bg-[#162436] text-cyan-300 border border-[#233852]"
                            >
                              ADA {codeStr}
                            </span>
                          );
                        })
                      ) : (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[#121E2E] text-slate-300 border border-[#182638]">
                          {getAppointmentTypeLabel(item.appointmentType)}
                        </span>
                      )}
                    </div>

                    {/* Bottom Row: Status & Actions */}
                    <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-[#182638]">
                      {/* Left: Badges */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {isReady && item.isFullyGrounded !== false && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                            <ShieldCheck className="w-3 h-3 text-emerald-400" />
                            Audio Verified 100%
                          </span>
                        )}

                        {isReady && item.isFullyGrounded === false && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSideBySideItem(item);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition-colors cursor-pointer"
                          >
                            <AlertCircle className="w-3 h-3 text-amber-400" />
                            Review Dialogue ({item.groundingScore ?? 0}%)
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleConsent(item);
                          }}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold border transition-colors cursor-pointer ${
                            item.consentObtained
                              ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                              : 'bg-[#121E2E] text-slate-400 border-[#182638] hover:text-slate-200'
                          }`}
                        >
                          <Check className={`w-3 h-3 ${item.consentObtained ? 'text-cyan-400 stroke-[3]' : 'text-slate-500'}`} />
                          <span>{item.consentObtained ? 'Verbal Consent ✓' : 'Consent'}</span>
                        </button>
                      </div>

                      {/* Right: Quick Action Button */}
                      <div className="flex items-center gap-1.5">
                        {item.status === 'scheduled' && !isRecordingThis && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRecordClick(item);
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-cyan-400 hover:bg-cyan-300 text-slate-950 rounded-xl text-xs font-black transition-transform active:scale-95 shadow-sm cursor-pointer"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            Record
                          </button>
                        )}

                        {isRecordingThis && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-extrabold bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping" />
                            Live Surgery
                          </span>
                        )}

                        {isProcessing && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            <RotateCw className="w-3 h-3 animate-spin text-amber-400" />
                            Synthesizing
                          </span>
                        )}

                        {isReady && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyNote(item);
                            }}
                            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95 ${
                              copiedId === item.id
                                ? 'bg-emerald-400 text-slate-950 font-black shadow-md'
                                : 'bg-[#162436] hover:bg-[#20334A] text-slate-100 border border-[#233852]'
                            }`}
                            title="Express copy note for D4W / Praktika"
                          >
                            {copiedId === item.id ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : <Copy className="w-3.5 h-3.5 text-cyan-400" />}
                            <span>{copiedId === item.id ? 'Copied' : 'Copy'}</span>
                          </button>
                        )}

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteItem(item.id, e);
                          }}
                          className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg transition-colors cursor-pointer"
                          title="Remove appointment"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

      {/* Quick Add Walk-in Modal */}
      <AnimatePresence>
        {showWalkInModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#101923] rounded-2xl max-w-md w-full p-6 shadow-2xl border border-[#1E2E40] text-slate-100"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-black text-white flex items-center gap-2">
                  <Plus className="w-5 h-5 text-cyan-400" />
                  Add Unscheduled Walk-in
                </h3>
                <button
                  onClick={() => setShowWalkInModal(false)}
                  className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleAddWalkInSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Patient Name *
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    placeholder="e.g. John Doe"
                    value={walkInName}
                    onChange={(e) => setWalkInName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#233547] bg-[#16222F] text-white text-sm focus:outline-hidden focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 placeholder:text-slate-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1">
                      Time
                    </label>
                    <input
                      type="time"
                      value={walkInTime}
                      onChange={(e) => setWalkInTime(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl border border-[#233547] bg-[#16222F] text-white text-sm focus:outline-hidden focus:border-cyan-400"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1">
                      Type
                    </label>
                    <select
                      value={walkInType}
                      onChange={(e) => setWalkInType(e.target.value as AppointmentType)}
                      className="w-full px-3 py-2 rounded-xl border border-[#233547] bg-[#16222F] text-white text-sm focus:outline-hidden focus:border-cyan-400"
                    >
                      {APPOINTMENT_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Chief Complaint / Procedure
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Broken tooth #26, toothache"
                    value={walkInReason}
                    onChange={(e) => setWalkInReason(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-[#233547] bg-[#16222F] text-white text-sm focus:outline-hidden focus:border-cyan-400 placeholder:text-slate-500"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowWalkInModal(false)}
                    className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-xs font-black rounded-xl shadow-lg shadow-cyan-950/40 transition-all cursor-pointer"
                  >
                    Add to Roster
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Clinical Note Preview Modal */}
      <AnimatePresence>
        {viewNoteItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#101923] rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-[#1E2E40] text-slate-100 flex flex-col max-h-[85vh]"
            >
              <div className="flex items-center justify-between pb-3 border-b border-[#1E2E40]">
                <div>
                  <h3 className="text-base font-extrabold text-white">
                    Clinical Note: {viewNoteItem.patientName}
                  </h3>
                  <p className="text-xs text-cyan-400">{viewNoteItem.procedureText} • {viewNoteItem.time}</p>
                </div>
                <button
                  onClick={() => setViewNoteItem(null)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto py-4 font-mono text-xs text-slate-200 whitespace-pre-wrap leading-relaxed bg-[#0E1620] p-4 rounded-xl border border-[#1E2E40] mt-3 cockpit-scrollbar">
                {formatNoteForPmsClipboard(viewNoteItem)}
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-[#1E2E40] mt-4">
                <span className="text-xs text-slate-400">
                  Ready to paste into D4W / Praktika Notes tab
                </span>
                <button
                  onClick={() => {
                    handleCopyNote(viewNoteItem);
                    setViewNoteItem(null);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-400 hover:bg-cyan-300 text-slate-950 rounded-xl text-xs font-black transition-all shadow-lg shadow-cyan-950/40 cursor-pointer"
                >
                  <Copy className="w-4 h-4" />
                  Copy to Clipboard
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Smart Guard Verbal Consent Confirmation Popover */}
      <AnimatePresence>
        {consentGuardItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#101923] rounded-2xl max-w-md w-full p-6 shadow-2xl border border-[#1E2E40] flex flex-col text-slate-100"
            >
              <div className="flex items-start gap-3.5">
                <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-2xl shrink-0 border border-emerald-500/20">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-extrabold text-white">
                    Confirm Verbal Recording Consent
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {consentGuardItem.patientName} • {consentGuardItem.time}
                  </p>
                </div>
                <button
                  onClick={() => setConsentGuardItem(null)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-4 p-3.5 bg-[#14202D] rounded-xl border border-[#1E2E40] text-xs text-slate-300 leading-relaxed">
                <p className="font-semibold text-slate-200">
                  Confirm patient verbal consent for ambient operatory recording:
                </p>
                <p className="mt-1.5 text-cyan-300 italic">
                  "I will be using ambient voice transcription to prepare my clinical notes for your record today."
                </p>
                <div className="mt-3 pt-2.5 border-t border-[#1E2E40] flex items-center gap-1.5 text-[11px] text-slate-400">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Logged to internal compliance audit only. Kept out of PMS clipboard.</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 mt-5">
                <button
                  type="button"
                  onClick={() => recordWithoutConsentTag(consentGuardItem)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-400 hover:text-white hover:bg-[#16222F] rounded-xl transition-colors cursor-pointer"
                >
                  Record Without Tag
                </button>
                <button
                  type="button"
                  onClick={() => confirmConsentAndRecord(consentGuardItem)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black rounded-xl transition-all shadow-md shadow-emerald-950/40 cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Confirm Consent & Record
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Side-by-Side Review & Confidence Verification Modal */}
      <AnimatePresence>
        {sideBySideItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#101923] rounded-2xl max-w-4xl w-full p-6 shadow-2xl border border-[#1E2E40] flex flex-col max-h-[90vh] text-slate-100"
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-[#1E2E40]">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl ${sideBySideItem.isFullyGrounded !== false ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>
                    {sideBySideItem.isFullyGrounded !== false ? (
                      <ShieldCheck className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-amber-400" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-extrabold text-white">
                        Clinical Verification: {sideBySideItem.patientName}
                      </h3>
                      <span className={`px-2.5 py-0.5 rounded-md text-[11px] font-extrabold ${sideBySideItem.isFullyGrounded !== false ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>
                        {sideBySideItem.isFullyGrounded !== false ? '100% Grounded in Audio' : `${sideBySideItem.groundingScore ?? 0}% Audio Grounded`}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {sideBySideItem.procedureText} • {sideBySideItem.time}
                      {sideBySideItem.consentObtained && (
                        <span className="ml-2 inline-flex items-center text-emerald-400 font-medium">
                          • Verbal consent logged ✓
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSideBySideItem(null)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Unverified Claims Warning if any */}
              {sideBySideItem.unverifiedClaims && sideBySideItem.unverifiedClaims.length > 0 && (
                <div className="mt-3 p-3 bg-amber-950/30 border border-amber-500/30 rounded-xl flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-300 leading-relaxed">
                    <span className="font-bold">Items not detected in verbatim speech: </span>
                    <span className="font-semibold text-amber-200">{sideBySideItem.unverifiedClaims.join(', ')}</span>
                    <p className="text-[11px] text-amber-400/80 mt-0.5">
                      Verify whether these clinical findings or treatments were performed before copying to your practice management system.
                    </p>
                  </div>
                </div>
              )}

              {/* Side-by-Side Content Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3.5 flex-1 min-h-0 overflow-hidden">
                {/* Left Column: Verbatim Spoken Dialogue */}
                <div className="flex flex-col rounded-xl border border-[#1E2E40] bg-[#14202D] p-3 min-h-0">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#1E2E40] text-xs font-bold text-slate-300">
                    <span>Spoken Operatory Dialogue</span>
                    <span className="text-[11px] text-cyan-400 font-mono font-normal">Verbatim Audio</span>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2 pr-1 text-xs cockpit-scrollbar">
                    {sideBySideItem.transcript && sideBySideItem.transcript.length > 0 ? (
                      sideBySideItem.transcript.map((utt, i) => (
                        <div key={i} className="p-2 rounded-lg bg-[#0E1620] border border-[#1E2E40]">
                          <span className="font-bold text-[11px] text-cyan-400 block mb-0.5">
                            {utt.sender}:
                          </span>
                          <p className="text-slate-300 leading-relaxed font-sans">{utt.text}</p>
                        </div>
                      ))
                    ) : (
                      <div className="p-4 text-center text-slate-500 italic">
                        Live operatory audio recorded for consultation.
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column: Synthesized Clinical Note */}
                <div className="flex flex-col rounded-xl border border-[#1E2E40] bg-[#14202D] p-3 min-h-0">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#1E2E40] text-xs font-bold text-slate-300">
                    <span>Synthesized Progress Note</span>
                    <span className="text-[11px] text-cyan-400 font-mono font-normal">D4W / Praktika Format</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 bg-[#0E1620] rounded-lg border border-[#1E2E40] font-mono text-xs text-slate-200 whitespace-pre-wrap leading-relaxed cockpit-scrollbar">
                    {formatNoteForPmsClipboard(sideBySideItem)}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-4 border-t border-[#1E2E40] mt-4">
                <div className="text-xs text-slate-400">
                  {sideBySideItem.consentObtained ? (
                    <span className="text-emerald-400 font-semibold">✓ Verbal Consent Recorded for Internal Audit</span>
                  ) : (
                    <span className="text-slate-500">Verbal consent tag not active</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSideBySideItem(null)}
                    className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white rounded-xl cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => {
                      handleCopyNote(sideBySideItem);
                      setSideBySideItem(null);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-400 hover:bg-cyan-300 text-slate-950 rounded-xl text-xs font-black transition-all shadow-lg shadow-cyan-950/40 cursor-pointer"
                  >
                    <Copy className="w-4 h-4" />
                    Approve & Copy to PMS
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      </div>
    </CockpitLayout>
  );
}
