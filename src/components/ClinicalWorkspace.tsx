import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Consultation, TranscriptItem } from '../types';
import { ClinicMembership } from '../lib/clinics';
import { AuthUser } from '../utils/storage';

// Modular Stream A & B Components
import AudioBar, { CaptureMode } from './workspace/AudioBar';
import ContextTab from './workspace/ContextTab';
import TranscriptTab from './workspace/TranscriptTab';
import NoteTab from './workspace/NoteTab';
import DocumentTab from './workspace/DocumentTab';
import SidebarDrawer from './workspace/SidebarDrawer';
import TemplateModal from './workspace/TemplateModal';
import SplitSessionModal from './workspace/SplitSessionModal';
import KeyboardModal from './workspace/KeyboardModal';

// Domain Engines & Exporters
import { AudioRecorder } from '../lib/audioRecorder';
import { splitConsultationTranscript, TranscriptSplit } from '../lib/sessionSeparator';
import { reformatNoteIntoTemplate } from '../lib/templateEngine';
import { markSessionDirty, getDirtySessionIds } from '../lib/sessionCache';
import { normalizeSpokenDentalText } from '../lib/dentalPhoneticLexicon';

interface ClinicalWorkspaceProps {
  currentUser: AuthUser | null;
  dentistName?: string;
  authToken: string | null;
  consultations: Consultation[];
  activeClinicId: string | null;
  activeClinic: ClinicMembership | null;
  clinics: ClinicMembership[];
  onSelectClinic?: (id: string) => void;
  onLogout: () => void;
  onSaveConsultation: (consult: Consultation) => Promise<void> | void;
  pendingSyncCount?: number;
}

type TabType = 'context' | 'transcript' | 'note' | 'document';

export default function ClinicalWorkspace({
  currentUser,
  dentistName = 'Dr. Kathryn Simmons',
  authToken,
  consultations,
  activeClinicId,
  activeClinic,
  clinics,
  onSelectClinic,
  onLogout,
  onSaveConsultation,
  pendingSyncCount = 0,
}: ClinicalWorkspaceProps) {
  // Active Consultation Session State
  //
  // `userStartedSessionRef` records that the clinician explicitly asked for a
  // new consultation, and the align-on-load effect below must never take that
  // session over. It used to replace any id starting with `sess-` — which is
  // also what "New session" mints — so clicking New session on a device that
  // already held records silently reopened the most recent patient (their name,
  // transcript and note back on screen) with no indication the request had been
  // ignored.
  //
  // Deliberately a plain ref set by the click handler and NOT by the state
  // initializer: StrictMode invokes an initializer twice, so a ref written there
  // can disagree with the value React keeps and the alignment silently stops
  // working (caught by e2e/smoke.e2e.ts).
  const userStartedSessionRef = useRef(false);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    return consultations[0]?.id || `sess-${Date.now()}`;
  });

  const [activeTab, setActiveTab] = useState<TabType>('note');
  const [showSessionsDrawer, setShowSessionsDrawer] = useState(false);
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [dirtySessionIds, setDirtySessionIds] = useState<string[]>(() => getDirtySessionIds());

  // Adopt the most recent stored consultation once records arrive (mount has no
  // records yet on a fresh device). A session the clinician explicitly started
  // is never taken over: their intent outranks the newest-record guess.
  useEffect(() => {
    if (userStartedSessionRef.current) return;
    if (consultations.length === 0) return;
    if (consultations.some(c => c.id === activeSessionId)) return;
    setActiveSessionId(consultations[0].id);
  }, [consultations, activeSessionId]);

  // Find active consultation object
  const activeConsultation = useMemo(() => {
    return consultations.find(c => c.id === activeSessionId) || null;
  }, [consultations, activeSessionId]);

  // Synchronized Patient Demographics & Tab Content States
  const [patientName, setPatientName] = useState('Patient');
  const [contextText, setContextText] = useState('');
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('ahpra-standard');
  const [currentNote, setCurrentNote] = useState<string>('');

  // Rehydrate state when active consultation changes
  useEffect(() => {
    if (activeConsultation) {
      const rawFirst = (activeConsultation.firstName || '').trim();
      const rawLast = (activeConsultation.lastName || '').trim();
      const fallbackName = (activeConsultation as any).patientName || (activeConsultation as any).name;
      const resolvedName = (rawFirst || rawLast) ? `${rawFirst} ${rawLast}`.trim() : (fallbackName || 'Patient');
      setPatientName(resolvedName);

      // Rehydrate context from findings or notes
      const initialContext =
        activeConsultation.findings?.history ||
        activeConsultation.findings?.chiefComplaint ||
        (activeConsultation as any).notes ||
        (activeConsultation.findings ? `Medical history: ${activeConsultation.findings.history || 'Reviewed'}` : '');
      setContextText(initialContext);

      // Rehydrate transcript
      setTranscript(Array.isArray(activeConsultation.transcript) ? activeConsultation.transcript : []);

      // Rehydrate clinical note
      if (activeConsultation.clinicalProgressNote) {
        setCurrentNote(activeConsultation.clinicalProgressNote);
      } else {
        const defaultNote = `### SUBJECTIVE / PRESENTING COMPLAINT
- Patient attends for dental consultation.
- Medical History: Reviewed. Nil known drug allergies.

### CLINICAL EXAMINATION & FINDINGS
- Extraoral: WNL. Intraoral soft tissues healthy. Dentition examined.

### DIAGNOSIS
- Pending examination findings.

### TREATMENT PERFORMED
- Consultation and clinical examination.

### ITEM CODES (ADA 13th Ed.)
- 014: Consultation`;
        setCurrentNote(defaultNote);
      }
    }
  }, [activeConsultation]);

  // Audio Capture Engine State
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [silenceSeconds, setSilenceSeconds] = useState<number | undefined>(undefined);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('transcribe');

  // Refs for audio lifecycle
  const audioRecorderRef = useRef<AudioRecorder | null>(null);
  const speechRecognizerRef = useRef<any>(null);
  const isRecordingRef = useRef(false);
  const isPausedRef = useRef(false);

  // Keep refs in sync with state
  useEffect(() => {
    isRecordingRef.current = isRecording;
    isPausedRef.current = isPaused;
  }, [isRecording, isPaused]);

  // Copilot Bar State
  const [copilotInput, setCopilotInput] = useState('');
  const [isCopilotLoading, setIsCopilotLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // A toast is a statement about now. Without this it stayed on screen for the
  // rest of the consultation, so "Consultation recording finalized." was still
  // sitting there while the next patient was being recorded. Same 3.5s the
  // note and document tabs use.
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3500);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Audio start handler with continuous speech recognition
  const handleStartAudio = useCallback(async (deviceId: string | null, mode: CaptureMode) => {
    try {
      setCaptureMode(mode);

      // Start hardware audio recorder for waveform & silence detection
      const recorder = new AudioRecorder({
        deviceId,
        onLevel: (lvl) => setAudioLevel(lvl),
        onTick: (elapsed) => setRecordingSeconds(elapsed),
        onSilenceWarning: (s) => {
          setSilenceSeconds(s);
          setToastMessage('30s silence warning: recording will sleep soon (Rule 8)');
        },
        onAutoPause: () => {
          setIsRecording(false);
          setIsPaused(true);
          isRecordingRef.current = false;
          isPausedRef.current = true;
          setToastMessage('Auto-paused recording after 3 minutes of silence.');
        },
        onError: (err) => console.warn('[AudioEngine] Recorder warning:', err),
      });

      audioRecorderRef.current = recorder;
      await recorder.start();

      setIsRecording(true);
      setIsPaused(false);
      isRecordingRef.current = true;
      isPausedRef.current = false;
      setSilenceSeconds(undefined);

      // Start Web Speech API with auto-restarting loop
      const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRec) {
        if (speechRecognizerRef.current) {
          try { speechRecognizerRef.current.stop(); } catch {}
        }

        const recognizer = new SpeechRec();
        recognizer.continuous = true;
        recognizer.interimResults = true;
        recognizer.lang = 'en-AU';

        recognizer.onresult = (event: any) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const res = event.results[i];
            if (res.isFinal) {
              const rawText = res[0].transcript.trim();
              const text = normalizeSpokenDentalText(rawText);
              if (text && text.length > 0) {
                // Squelch pure mechanical noise
                const isNoise = /^(sh+|ah+|um+|zz+|ss+|hh+|ff+|th+)(\s+(sh+|ah+|um+|zz+|ss+|hh+|ff+|th+))*$/i.test(text);
                if (!isNoise) {
                  setTranscript(prev => [...prev, { sender: 'Dialogue', text }]);
                }
              }
            }
          }
        };

        recognizer.onend = () => {
          // Auto-restart loop while recording is active (browser speech API timeout resilience)
          if (isRecordingRef.current && !isPausedRef.current) {
            setTimeout(() => {
              try {
                if (isRecordingRef.current && !isPausedRef.current) {
                  recognizer.start();
                }
              } catch (e) {
                console.warn('[Speech] Auto-restart loop notice:', e);
              }
            }, 80);
          }
        };

        recognizer.onerror = (e: any) => {
          if (e.error !== 'no-speech') {
            console.warn('[Speech] Recognition notice:', e.error);
          }
          // The recorder keeps running and the bar still says "Listening…", so
          // a speech service that is unreachable (or refused) used to look
          // exactly like a consultation being captured — the clinician only
          // found out when the transcript stayed empty. Say it out loud.
          if (e.error === 'network' || e.error === 'service-not-allowed' || e.error === 'not-allowed') {
            setToastMessage('Audio is recording, but live transcription is unavailable — speech-to-text is not running.');
          }
        };

        recognizer.start();
        speechRecognizerRef.current = recognizer;
        setToastMessage('Listening & taking notes chairside...');
      } else {
        // Safari and Firefox have no Web Speech API: dictation would silently
        // capture audio and transcribe nothing.
        setToastMessage('This browser cannot transcribe speech — audio is recording only. Use Chrome for live transcription.');
      }
    } catch (err) {
      console.warn('[AudioEngine] Start failed:', err);
      setToastMessage('Please allow microphone access in your browser.');
    }
  }, []);

  const handlePauseAudio = useCallback(() => {
    audioRecorderRef.current?.pause();
    setIsPaused(true);
    isPausedRef.current = true;
    setToastMessage('Microphone paused.');
  }, []);

  const handleResumeAudio = useCallback(() => {
    audioRecorderRef.current?.resume();
    setIsPaused(false);
    isPausedRef.current = false;
    try {
      speechRecognizerRef.current?.start();
    } catch {}
    setToastMessage('Listening resumed.');
  }, []);

  const handleStopAudio = useCallback(async () => {
    setIsRecording(false);
    setIsPaused(false);
    isRecordingRef.current = false;
    isPausedRef.current = false;
    setAudioLevel(0);
    setSilenceSeconds(undefined);

    if (speechRecognizerRef.current) {
      try {
        speechRecognizerRef.current.stop();
      } catch {}
      speechRecognizerRef.current = null;
    }

    if (audioRecorderRef.current) {
      try {
        await audioRecorderRef.current.stop();
      } catch {}
      audioRecorderRef.current = null;
    }

    setToastMessage('Consultation recording finalized.');
  }, []);

  // Patient switch handler (strictly enforcing Cross-Patient Boundary Isolation Rule 14)
  const handleSelectSession = useCallback((sessionId: string) => {
    if (isRecordingRef.current) {
      void handleStopAudio();
    }
    setActiveSessionId(sessionId);
    setShowSessionsDrawer(false);
  }, [handleStopAudio]);

  // New Session Button (Instant Start)
  const handleNewSession = useCallback(() => {
    // Mark the intent before minting the id so the align-on-load effect cannot
    // swap this fresh session for the newest stored record.
    userStartedSessionRef.current = true;
    if (isRecordingRef.current) {
      void handleStopAudio();
    }
    const newId = `sess-${Date.now()}`;
    setActiveSessionId(newId);
    setPatientName('New Patient');
    setContextText('');
    setTranscript([]);
    setCurrentNote(`### SUBJECTIVE / PRESENTING COMPLAINT
- Patient attends for dental consultation.
- Medical History: Reviewed. Nil known drug allergies.

### CLINICAL EXAMINATION & FINDINGS
- Extraoral: WNL. Intraoral soft tissues healthy. Dentition examined.

### DIAGNOSIS
- Pending examination findings.

### TREATMENT PERFORMED
- Consultation and clinical examination.

### ITEM CODES (ADA 13th Ed.)
- 014: Consultation`);
    setActiveTab('context');
    setToastMessage('Started fresh consultation session.');
  }, [handleStopAudio]);

  // Handle Note Generation
  const handleCreateNote = async () => {
    if (isRecordingRef.current) {
      await handleStopAudio();
    }

    setIsCopilotLoading(true);
    setToastMessage('Generating clinical note with ADA item codes...');

    try {
      const res = await fetch('/api/copilot/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken || ''}`,
        },
        body: JSON.stringify({
          prompt: `Generate an Australian AHPRA-compliant clinical progress note using template "${selectedTemplateId}". Extract findings and ADA item codes from the transcript and context.`,
          currentNote,
          context: contextText,
          transcript,
          patientName,
          dentistName,
          appointmentType: selectedTemplateId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.result) {
          setCurrentNote(data.result);
          setActiveTab('note');
          setToastMessage('Clinical note generated successfully!');

          // Save updated consultation
          if (activeConsultation) {
            const updatedConsult: Consultation = {
              ...activeConsultation,
              clinicalProgressNote: data.result,
              transcript,
              findings: {
                ...activeConsultation.findings,
                history: contextText,
                chiefComplaint: contextText,
              },
            };
            void onSaveConsultation(updatedConsult);
          }

          markSessionDirty(activeSessionId);
          setDirtySessionIds(getDirtySessionIds());
        }
      } else {
        // High-resilience deterministic synthesis integrating context & transcript
        const synthesized = reformatNoteIntoTemplate(selectedTemplateId, {
          complaint: contextText,
          medicalHistory: contextText,
          examination: transcript.map(t => `${t.sender}: ${t.text}`).join('\n'),
        }, currentNote);
        setCurrentNote(synthesized);
        setActiveTab('note');
        setToastMessage('Note formatted with context and transcript.');
      }
    } catch {
      const synthesized = reformatNoteIntoTemplate(selectedTemplateId, {
        complaint: contextText,
        medicalHistory: contextText,
        examination: transcript.map(t => `${t.sender}: ${t.text}`).join('\n'),
      }, currentNote);
      setCurrentNote(synthesized);
      setActiveTab('note');
      setToastMessage('Note formatted with template.');
    } finally {
      setIsCopilotLoading(false);
    }
  };

  // Handle Ask DentAI Copilot
  const handleAskCopilot = async (queryText?: string) => {
    const query = queryText || copilotInput;
    if (!query || query.trim().length === 0) return;

    setIsCopilotLoading(true);
    setCopilotInput('');

    try {
      const res = await fetch('/api/copilot/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken || ''}`,
        },
        body: JSON.stringify({
          prompt: query,
          currentNote,
          context: contextText,
          transcript,
          patientName,
          dentistName,
          appointmentType: selectedTemplateId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.result) {
          setCurrentNote(data.result);
          setActiveTab('note');
          setToastMessage('Clinical note updated by DentAI.');

          if (activeConsultation) {
            const updated: Consultation = {
              ...activeConsultation,
              clinicalProgressNote: data.result,
              transcript,
            };
            void onSaveConsultation(updated);
          }

          markSessionDirty(activeSessionId);
          setDirtySessionIds(getDirtySessionIds());
        }
      }
    } catch (err) {
      console.warn('Copilot error:', err);
    } finally {
      setIsCopilotLoading(false);
    }
  };

  // Template switch handler
  const handleSelectTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const reformatted = reformatNoteIntoTemplate(templateId, {
      complaint: contextText,
      medicalHistory: contextText,
      examination: transcript.map(t => `${t.sender}: ${t.text}`).join('\n'),
    }, currentNote);
    setCurrentNote(reformatted);
    setToastMessage(`Switched template to ${templateId.toUpperCase()}`);
  };

  // Split Session handler
  const handleApplySplit = (split: TranscriptSplit) => {
    void onSaveConsultation(split.sessionA);
    void onSaveConsultation(split.sessionB);
    setActiveSessionId(split.sessionA.id);
    setTranscript(split.sessionA.transcript || []);
    setToastMessage('Separated merged consultation into 2 individual patient records.');
  };

  // Hands-free keyboard listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName);

      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void handleCreateNote();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleNewSession();
      } else if (!isInput && e.key === ' ') {
        e.preventDefault();
        if (isRecordingRef.current) {
          if (isPausedRef.current) handleResumeAudio();
          else handlePauseAudio();
        } else {
          void handleStartAudio(null, 'transcribe');
        }
      } else if (!isInput && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        setShowShortcutsModal(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleStartAudio, handlePauseAudio, handleResumeAudio, handleNewSession]);

  return (
    <div className="flex h-screen w-full bg-[#FAF9F7] text-slate-800 font-sans overflow-hidden">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-xl text-xs font-medium animate-fade-in">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* Left Navigation Sidebar                                                */}
      {/* --------------------------------------------------------------------- */}
      <aside className="w-64 flex-shrink-0 bg-[#FAF9F7] border-r border-slate-200/80 flex flex-col justify-between p-4 select-none">
        <div className="flex flex-col gap-4">
          {/* Practice & Clinician Profile */}
          <div className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-100/70 transition-colors cursor-pointer">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-[#2A1D24] text-white flex items-center justify-center font-bold text-xs tracking-wider shadow-sm">
                {dentistName.split(' ').map(n => n[0]).filter(Boolean).join('').slice(0, 2).toUpperCase() || 'DR'}
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-xs font-semibold text-slate-900 truncate max-w-[130px]">{dentistName}</span>
                <span className="text-[11px] text-slate-500 truncate max-w-[130px]">{activeClinic?.clinicName || 'Sunrise Dental'}</span>
              </div>
            </div>
          </div>

          {/* "+ New session" Button */}
          <button
            type="button"
            onClick={handleNewSession}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-[#2A1D24] hover:bg-[#3D2C35] text-white rounded-full text-xs font-semibold shadow-sm transition-all cursor-pointer active:scale-[0.98]"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            <span>New session</span>
          </button>

          {/* Navigation Links */}
          <nav className="flex flex-col gap-1 mt-2">
            <button
              type="button"
              onClick={() => setShowSessionsDrawer(prev => !prev)}
              className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                showSessionsDrawer ? 'bg-slate-200/80 text-slate-900' : 'text-slate-600 hover:bg-slate-100/70 hover:text-slate-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>Sessions</span>
              </div>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-700">
                {consultations.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setShowTemplatesModal(true)}
              className="flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100/70 hover:text-slate-900 transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              <span>Template library</span>
            </button>

            <button
              type="button"
              onClick={() => setShowShortcutsModal(true)}
              className="flex items-center justify-between text-xs text-slate-600 hover:bg-slate-100/70 hover:text-slate-900 px-3 py-2 rounded-xl transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <span>⌨️</span>
                <span>Shortcuts</span>
              </div>
              <kbd className="font-mono text-[10px] bg-slate-200 px-1.5 py-0.5 rounded text-slate-700">S</kbd>
            </button>
          </nav>
        </div>

        {/* Bottom Sidebar Footer */}
        <div className="flex flex-col gap-2 pt-4 border-t border-slate-200/80">
          {pendingSyncCount > 0 && (
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-amber-50 text-amber-900 text-[11px] font-medium border border-amber-200">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
              <span>{pendingSyncCount} session waiting to sync</span>
            </div>
          )}
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-rose-600 transition-colors py-1 cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* --------------------------------------------------------------------- */}
      {/* Slide-out Sessions Drawer                                             */}
      {/* --------------------------------------------------------------------- */}
      <SidebarDrawer
        isOpen={showSessionsDrawer}
        onClose={() => setShowSessionsDrawer(false)}
        consultations={consultations}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        dirtySessionIds={dirtySessionIds}
      />

      {/* --------------------------------------------------------------------- */}
      {/* Central Consultation Workspace Canvas                                 */}
      {/* --------------------------------------------------------------------- */}
      <main className="flex-1 flex flex-col min-w-0 bg-white">
        {/* Top Patient Header Bar */}
        <header className="px-6 py-3 border-b border-slate-200/80 bg-[#FAF9F7] flex items-center justify-between gap-4 select-none">
          {/* Patient Details */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold text-xs flex items-center justify-center shrink-0">
              {patientName.split(' ').map(n => n[0]).filter(Boolean).join('').slice(0, 2).toUpperCase() || 'PT'}
            </div>
            <div className="flex flex-col min-w-0">
              <input
                type="text"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                className="text-sm font-bold text-slate-900 bg-transparent border-0 focus:ring-0 p-0 hover:bg-slate-100/50 rounded cursor-text"
                placeholder="Patient Name"
              />
              <span className="text-[11px] text-slate-400">
                {activeConsultation?.date || new Date().toLocaleDateString('en-AU')} • Active consult
              </span>
            </div>
          </div>

          {/* Create Note Trigger */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreateNote}
              disabled={isCopilotLoading}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all disabled:opacity-50 cursor-pointer"
            >
              <svg className={`w-3.5 h-3.5 ${isCopilotLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>{isCopilotLoading ? 'Generating note...' : 'Create note'}</span>
            </button>
          </div>
        </header>

        {/* Dedicated AudioBar Strip */}
        <AudioBar
          isRecording={isRecording}
          isPaused={isPaused}
          elapsedSeconds={recordingSeconds}
          level={audioLevel}
          silenceSeconds={silenceSeconds}
          mode={captureMode}
          onModeChange={setCaptureMode}
          onStart={handleStartAudio}
          onPause={handlePauseAudio}
          onResume={handleResumeAudio}
          onStop={handleStopAudio}
        />

        {/* Tab Navigation */}
        <div className="flex items-center justify-between px-6 border-b border-slate-200/80 bg-white select-none">
          <div className="flex items-center gap-6">
            <button
              onClick={() => setActiveTab('context')}
              className={`py-3 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
                activeTab === 'context'
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              Context
            </button>
            <button
              onClick={() => setActiveTab('transcript')}
              className={`py-3 text-xs font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'transcript'
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              <span>Transcript</span>
              {transcript.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded-full font-bold">
                  {transcript.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('note')}
              className={`py-3 text-xs font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'note'
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              <span>Note</span>
              {/* Same claim as the compliance badges: a green dot on an empty
                  note reads as "this record is in order". */}
              {currentNote.trim().length > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('document')}
              className={`py-3 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
                activeTab === 'document'
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              + Document
            </button>
          </div>
        </div>

        {/* Tab Canvas Area */}
        <div className="flex-1 overflow-hidden relative">
          {activeTab === 'context' && (
            <ContextTab
              contextText={contextText}
              onChangeContext={setContextText}
              onSyncChangesToNote={() => handleAskCopilot(`Sync these updated context details into the clinical note: "${contextText}"`)}
              isSyncing={isCopilotLoading}
            />
          )}

          {activeTab === 'transcript' && (
            <TranscriptTab
              transcript={transcript}
              onUpdateTranscript={setTranscript}
              onSeparateMergedSession={() => setShowSplitModal(true)}
              isLive={isRecording}
            />
          )}

          {activeTab === 'note' && (
            <NoteTab
              noteText={currentNote}
              onChangeNoteText={setCurrentNote}
              selectedTemplateId={selectedTemplateId}
              onSelectTemplate={handleSelectTemplate}
              onOpenTemplateModal={() => setShowTemplatesModal(true)}
              patientName={patientName}
              dentistName={dentistName}
            />
          )}

          {/* Kept mounted while hidden: a generated document is the product of
              an AI call the clinician cannot get back, so glancing at the note
              and returning must not empty the panel. Keyed by session so one
              patient's draft can never appear on another patient's record. */}
          <div key={activeSessionId} className={activeTab === 'document' ? 'h-full' : 'hidden'}>
            <DocumentTab
              authToken={authToken}
              currentNote={currentNote}
              contextText={contextText}
              transcript={transcript}
              patientName={patientName}
              dentistName={dentistName}
              appointmentType={selectedTemplateId}
            />
          </div>
        </div>

        {/* Bottom Copilot Input Bar */}
        <div className="px-6 py-3 border-t border-slate-200/80 bg-[#FAF9F7]">
          {/* Quick Prompt Chips */}
          <div className="flex items-center gap-1.5 mb-2 overflow-x-auto no-scrollbar">
            {['Make note shorter', 'Add ADA codes', 'Draft referral letter', 'Patient home care guide'].map((chip) => (
              <button
                key={chip}
                onClick={() => handleAskCopilot(chip)}
                className="text-[11px] font-medium px-2.5 py-1 bg-white border border-slate-200/80 hover:border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Natural Language Prompt Bar */}
          <div className="flex items-center gap-2">
            <div className="flex-1 relative flex items-center">
              <span className="absolute left-3 text-slate-400 text-xs">💬</span>
              <input
                type="text"
                value={copilotInput}
                onChange={(e) => setCopilotInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAskCopilot();
                }}
                placeholder="Ask DentAI to edit note, add warnings, or summarize treatment..."
                className="w-full text-xs bg-white border border-slate-200 rounded-xl pl-8 pr-4 py-2 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100"
              />
            </div>
            <button
              onClick={() => handleAskCopilot()}
              disabled={isCopilotLoading || !copilotInput.trim()}
              className="px-4 py-2 bg-[#2A1D24] hover:bg-[#3D2C35] text-white text-xs font-semibold rounded-xl transition-all disabled:opacity-40 cursor-pointer"
            >
              Ask
            </button>
          </div>
        </div>
      </main>

      {/* --------------------------------------------------------------------- */}
      {/* Modals: Template, Split Session, and Keyboard Shortcuts                */}
      {/* --------------------------------------------------------------------- */}
      <TemplateModal
        isOpen={showTemplatesModal}
        selectedTemplateId={selectedTemplateId}
        onSelectTemplate={handleSelectTemplate}
        onClose={() => setShowTemplatesModal(false)}
      />

      {showSplitModal && activeConsultation && (
        <SplitSessionModal
          session={activeConsultation}
          onClose={() => setShowSplitModal(false)}
          onSplit={handleApplySplit}
        />
      )}

      <KeyboardModal
        isOpen={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
      />
    </div>
  );
}
