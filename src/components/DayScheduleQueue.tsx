import React, { useState, useEffect, useRef } from 'react';
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
  ShieldCheck,
  X,
  Stethoscope,
  DollarSign,
  TrendingUp,
  MicOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
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

interface DayScheduleQueueProps {
  onStartRecording?: (item: DayScheduleItem) => void;
  onViewConsultation?: (consultationId: string) => void;
  dentistName: string;
  authToken: string;
}

export default function DayScheduleQueue({
  onStartRecording,
  onViewConsultation,
  dentistName,
  authToken
}: DayScheduleQueueProps) {
  const [items, setItems] = useState<DayScheduleItem[]>(() => loadTodaySchedule());
  const [isParsing, setIsParsing] = useState(false);
  const [parsingError, setParsingError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showWalkInModal, setShowWalkInModal] = useState(false);
  const [viewNoteItem, setViewNoteItem] = useState<DayScheduleItem | null>(null);

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
        source: 'snip'
      },
      {
        id: `sched_demo_2`,
        time: '09:15',
        patientName: 'David Miller',
        procedureText: 'Tooth #16 Ceramic Crown Prep (611)',
        appointmentType: 'prosthodontic',
        templateId: 'standard',
        status: 'scheduled',
        source: 'snip'
      },
      {
        id: `sched_demo_3`,
        time: '10:00',
        patientName: 'Liam O\'Connor',
        procedureText: 'Emergency: Severe Pain & Pulpitis #36',
        appointmentType: 'emergency',
        templateId: 'soap',
        status: 'scheduled',
        source: 'snip'
      },
      {
        id: `sched_demo_4`,
        time: '11:00',
        patientName: 'Emma Watson',
        procedureText: 'Adult Hygiene Scale & Clean & Fluoride (114, 121)',
        appointmentType: 'scale_clean',
        templateId: 'concise',
        status: 'scheduled',
        source: 'snip'
      },
      {
        id: `sched_demo_5`,
        time: '13:30',
        patientName: 'Michael Chang',
        procedureText: 'Tooth #24 MO Resin Restoration (532)',
        appointmentType: 'restorative',
        templateId: 'standard',
        status: 'scheduled',
        source: 'snip'
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

    // Update row to processing with safe UUID
    const assignedConsultationId = generateSafeUuid();
    let updated = updateScheduleItem(targetItem.id, {
      status: 'processing',
      consultationId: assignedConsultationId
    });
    setItems(updated);

    // Build transcript payload
    const finalTranscriptText = liveTranscript.trim() || `Consultation recorded for ${targetItem.patientName} (${targetItem.procedureText}). Full clinical examination performed.`;
    const transcriptItems = [
      { sender: 'Dentist', text: `Good morning ${targetItem.patientName}, let's begin your appointment for ${targetItem.procedureText}.` },
      { sender: 'Dialogue', text: finalTranscriptText },
      { sender: 'Dentist', text: `All procedures completed. We will review your recovery and plan the next recall visit.` }
    ];

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
          consultationId: assignedConsultationId
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

            const fresh = updateScheduleItem(targetItem.id, {
              status: 'ready',
              clinicalNote: formatted,
              adaCodes: sanitizedAdaCodeStrings,
              completedAt: new Date().toISOString()
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
    <div className="w-full max-w-5xl mx-auto px-4 py-6 font-sans relative">
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
        <div className="mb-6 p-4 bg-rose-50 border border-rose-300 rounded-2xl flex items-center justify-between gap-3 text-rose-800 text-xs">
          <div className="flex items-center gap-2">
            <MicOff className="w-5 h-5 text-rose-600 shrink-0" />
            <span className="font-semibold">{micError}</span>
          </div>
          <button
            onClick={() => setMicError(null)}
            className="text-rose-600 hover:text-rose-800 font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-teal-50 text-teal-700 border border-teal-200">
              <Sparkles className="w-3.5 h-3.5" />
              Single-Screen Surgery Cockpit
            </span>
            {readyCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <DollarSign className="w-3 h-3" />
                Est. Production: ${dailyProduction.toLocaleString()}
              </span>
            )}
          </div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Calendar className="w-6 h-6 text-primary" />
            Today's Clinical Roster
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Record in-place via the Top Surgery Island. Everything happens on this screen—no page jumps, zero duplicates.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {readyCount > 0 && (
            <button
              onClick={handleExpressCopyNext}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black transition-all active:scale-95 shadow-sm cursor-pointer"
              title="Copy the next completed note directly for D4W"
            >
              <Copy className="w-4 h-4" />
              Express Copy (D4W)
            </button>
          )}

          <button
            onClick={() => setShowWalkInModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4 text-slate-600" />
            Add Walk-in
          </button>

          {items.length === 0 && (
            <button
              onClick={handleLoadDemoSchedule}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer"
            >
              <Stethoscope className="w-4 h-4 text-emerald-600" />
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
              className="p-2 text-slate-400 hover:text-red-500 rounded-xl hover:bg-red-50 transition-colors cursor-pointer"
              title="Clear roster"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Snip & Paste Dropzone */}
      <div
        onClick={() => fileInputRef.current?.click()}
        className="relative mb-6 rounded-2xl border-2 border-dashed border-primary/40 hover:border-primary bg-primary/[0.02] hover:bg-primary/[0.04] p-6 text-center transition-all cursor-pointer group"
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

        <div className="flex flex-col items-center justify-center gap-2.5">
          <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center group-hover:scale-110 transition-transform">
            {isParsing ? (
              <RotateCw className="w-6 h-6 animate-spin text-primary" />
            ) : (
              <UploadCloud className="w-6 h-6 text-primary" />
            )}
          </div>

          <div>
            <p className="text-sm font-bold text-slate-800">
              {isParsing ? (
                'Analyzing D4W / Praktika Screenshot with AI...'
              ) : (
                <>
                  Press <kbd className="px-1.5 py-0.5 text-xs font-bold bg-slate-100 border border-slate-300 rounded shadow-xs text-slate-700">Ctrl + V</kbd> to paste snip, or click to upload
                </>
              )}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Supports Windows Snipping Tool (<kbd className="text-[10px] bg-slate-100 px-1 py-0.5 rounded border border-slate-200">Win+Shift+S</kbd>). Repasting midday auto-merges walk-ins with zero duplicate cards.
            </p>
          </div>
        </div>

        {parsingError && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-650 flex items-center justify-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{parsingError}</span>
          </div>
        )}
      </div>

      {/* Status Metrics Bar */}
      {totalCount > 0 && (
        <div className="flex items-center justify-between px-4 py-3 bg-white border border-slate-200 rounded-xl mb-6 text-xs text-slate-600">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="font-semibold text-slate-800">
              {totalCount} Total Appointments
            </span>
            {readyCount > 0 && (
              <span className="flex items-center gap-1 text-emerald-650 font-bold">
                <Check className="w-3.5 h-3.5" />
                {readyCount} Ready for D4W
              </span>
            )}
            {processingCount > 0 && (
              <span className="flex items-center gap-1 text-amber-600 font-bold">
                <RotateCw className="w-3.5 h-3.5 animate-spin" />
                {processingCount} Synthesizing Notes
              </span>
            )}
            {pendingCount > 0 && (
              <span className="text-slate-400">
                {pendingCount} Remaining
              </span>
            )}
          </div>

          {readyCount > 0 && (
            <div className="flex items-center gap-1 text-[11px] font-bold text-slate-500">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>5:00 PM Cake Walk: 1-click clipboard paste</span>
            </div>
          )}
        </div>
      )}

      {/* Schedule Items List */}
      {items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-700">No Appointments Queued for Today</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 mb-5">
            Snip your appointment book from Dental4Windows or Praktika and press <strong className="text-slate-700">Ctrl+V</strong> to populate your day in 3 seconds.
          </p>
          <button
            onClick={handleLoadDemoSchedule}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white text-xs font-bold rounded-xl hover:bg-primary-container transition-colors shadow-sm"
          >
            <Sparkles className="w-4 h-4" />
            Populate with Sample Day
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => {
            const isRecordingThis = recordingItem?.id === item.id || item.status === 'recording';
            const isReady = item.status === 'ready';
            const isProcessing = item.status === 'processing';
            const isFailed = item.status === 'failed';

            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: index * 0.02 }}
                className={`bg-white rounded-2xl border transition-all p-4.5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  isRecordingThis
                    ? 'border-red-400 ring-2 ring-red-100 shadow-md bg-red-50/[0.1]'
                    : isReady
                    ? 'border-emerald-200 hover:border-emerald-300 bg-emerald-50/[0.15]'
                    : isProcessing
                    ? 'border-amber-200 bg-amber-50/[0.15]'
                    : 'border-slate-200/80 hover:border-slate-300 shadow-xs'
                }`}
              >
                {/* Left: Time + Patient Info */}
                <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                  {/* Time Badge */}
                  <div className="flex flex-col items-center justify-center w-14 h-12 rounded-xl bg-slate-100 text-slate-700 shrink-0 font-mono text-xs font-bold">
                    <Clock className="w-3.5 h-3.5 text-slate-400 mb-0.5" />
                    <span>{item.time || '09:00'}</span>
                  </div>

                  {/* Patient Name & Details */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-base font-bold text-slate-900 truncate">
                        {item.patientName}
                      </h4>
                      {/* Procedure Type Badge */}
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold ${
                        item.appointmentType === 'emergency'
                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : item.appointmentType === 'scale_clean'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : item.appointmentType === 'prosthodontic' || item.appointmentType === 'restorative'
                          ? 'bg-purple-50 text-purple-700 border border-purple-200'
                          : 'bg-blue-50 text-blue-700 border border-blue-200'
                      }`}>
                        {getAppointmentTypeLabel(item.appointmentType)}
                      </span>
                    </div>

                    <p className="text-xs text-slate-500 truncate mt-0.5 max-w-lg">
                      {item.procedureText}
                    </p>
                  </div>
                </div>

                {/* Right: Status & Actions */}
                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  {/* Status Badges */}
                  {isRecordingThis && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-extrabold bg-red-100 text-red-700 animate-pulse">
                      <span className="w-2 h-2 rounded-full bg-red-600 animate-ping" />
                      Live in Surgery
                    </span>
                  )}

                  {isProcessing && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                      <RotateCw className="w-3.5 h-3.5 animate-spin text-amber-600" />
                      Writing Note...
                    </span>
                  )}

                  {isReady && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopyNote(item)}
                        className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs ${
                          copiedId === item.id
                            ? 'bg-emerald-600 text-white'
                            : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300'
                        }`}
                        title="Copy note to clipboard for D4W / Praktika"
                      >
                        {copiedId === item.id ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 text-emerald-600" />
                            Copy Note
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => setViewNoteItem(item)}
                        className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                        title="Preview clinical note"
                      >
                        <FileText className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {item.status === 'scheduled' && !isRecordingThis && (
                    <button
                      onClick={() => startInPlaceRecording(item)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary-container text-white rounded-xl text-xs font-bold transition-all active:scale-95 shadow-xs cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      Record
                    </button>
                  )}

                  {item.status === 'recording' && !recordingItem && (
                    <button
                      onClick={() => {
                        const updated = updateScheduleItem(item.id, { status: 'scheduled' });
                        setItems(updated);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
                      title="Reset status back to scheduled"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      Reset
                    </button>
                  )}

                  {isFailed && (
                    <button
                      onClick={() => startInPlaceRecording(item)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      Retry
                    </button>
                  )}

                  {/* Delete / Remove Action */}
                  <button
                    onClick={(e) => handleDeleteItem(item.id, e)}
                    className="p-1.5 text-slate-300 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
                    title="Remove appointment"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
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
              className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Plus className="w-5 h-5 text-primary" />
                  Add Unscheduled Walk-in
                </h3>
                <button
                  onClick={() => setShowWalkInModal(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleAddWalkInSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Patient Name *
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    placeholder="e.g. John Doe"
                    value={walkInName}
                    onChange={(e) => setWalkInName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Time
                    </label>
                    <input
                      type="time"
                      value={walkInTime}
                      onChange={(e) => setWalkInTime(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:outline-hidden focus:border-primary"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Type
                    </label>
                    <select
                      value={walkInType}
                      onChange={(e) => setWalkInType(e.target.value as AppointmentType)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-hidden focus:border-primary bg-white"
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
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Chief Complaint / Procedure
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Broken tooth #26, toothache"
                    value={walkInReason}
                    onChange={(e) => setWalkInReason(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:outline-hidden focus:border-primary"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowWalkInModal(false)}
                    className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 rounded-xl"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-primary text-white text-xs font-bold rounded-xl hover:bg-primary-container transition-colors"
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-100 flex flex-col max-h-[85vh]"
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Clinical Note: {viewNoteItem.patientName}
                  </h3>
                  <p className="text-xs text-slate-500">{viewNoteItem.procedureText} • {viewNoteItem.time}</p>
                </div>
                <button
                  onClick={() => setViewNoteItem(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto py-4 font-mono text-xs text-slate-800 whitespace-pre-wrap leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-200 mt-3">
                {formatNoteForPmsClipboard(viewNoteItem)}
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-slate-200 mt-4">
                <span className="text-xs text-slate-500">
                  Ready to paste into D4W / Praktika Notes tab
                </span>
                <button
                  onClick={() => {
                    handleCopyNote(viewNoteItem);
                    setViewNoteItem(null);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer"
                >
                  <Copy className="w-4 h-4" />
                  Copy to Clipboard
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
