import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Consultation, TranscriptItem, ClinicalFindings } from '../types';
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
import { reformatNoteIntoTemplate, DENTAL_TEMPLATES } from '../lib/templateEngine';
import { markSessionDirty, getDirtySessionIds } from '../lib/sessionCache';
import { normalizeSpokenDentalText } from '../lib/dentalPhoneticLexicon';
import { useNotePipeline } from '../hooks/useNotePipeline';
import { getClinicTodayIso } from '../utils/date';
import { blobToBase64, uploadAudioSegment, requestTranscription, isTranscriptionFailure } from '../lib/transcribeClient';

export interface ClinicalWorkspaceProps {
  currentUser: AuthUser | null;
  dentistName?: string;
  authToken: string | null;
  consultations: Consultation[];
  activeClinicId: string | null;
  activeClinic: ClinicMembership | null;
  clinics: ClinicMembership[];
  onSelectClinic?: (id: string) => void;
  onJoinClinic?: (code: string) => Promise<{ ok: boolean; message: string }>;
  onClinicChanged?: () => void;
  onLogout: () => void;
  onSaveConsultation: (consult: Consultation) => Promise<any> | any;
  pendingSyncCount?: number;
  initialSessionId?: string;
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
  onJoinClinic,
  onClinicChanged,
  onLogout,
  onSaveConsultation,
  pendingSyncCount = 0,
  initialSessionId,
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

  // Adopt initialSessionId when provided from external navigation (e.g. Schedule Queue or History)
  useEffect(() => {
    if (initialSessionId) {
      setActiveSessionId(initialSessionId);
    }
  }, [initialSessionId]);

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
  // Rule 14: Cross-Patient Boundary Isolation — live in-memory transcripts scoped per consultation ID
  const [localLiveTranscripts, setLocalLiveTranscripts] = useState<Record<string, TranscriptItem[]>>({});
  const localLiveTranscriptsRef = useRef(localLiveTranscripts);
  useEffect(() => {
    localLiveTranscriptsRef.current = localLiveTranscripts;
  }, [localLiveTranscripts]);

  const [interimTranscript, setInterimTranscript] = useState('');
  const lastInterimRef = useRef('');
  const [isTranscribingAudio, setIsTranscribingAudio] = useState(false);
  const recordedChunkCountRef = useRef(0);
  const lastLoadedSessionIdRef = useRef<string | null>(null);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('ahpra-standard');
  const [currentNote, setCurrentNote] = useState<string>('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const saveDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Template display name lookup for quick header badge
  const currentTemplateName = useMemo(() => {
    return DENTAL_TEMPLATES.find(t => t.id === selectedTemplateId)?.name || 'AHPRA Standard';
  }, [selectedTemplateId]);

  // Canonical builder for the currently active consultation encounter (persisted or in-progress)
  const buildLiveConsultation = useCallback((overrides: Partial<Consultation> = {}): Consultation => {
    const rawFirst = patientName.trim().split(' ')[0] || '';
    const rawLast = patientName.trim().split(' ').slice(1).join(' ') || '';
    const defaultFindings: ClinicalFindings = {
      chiefComplaint: contextText,
      history: contextText,
      toothFindings: '',
      findingsGingival: '',
      diagnosis: '',
      treatmentPerformed: '',
      recommendations: '',
      recallRequirements: '',
    };

    const sessionTranscript = overrides.transcript ?? localLiveTranscriptsRef.current[activeSessionId] ?? transcript;

    const base: Consultation = activeConsultation || {
      id: activeSessionId,
      dentistId: currentUser?.id,
      dentistName: currentUser?.name || dentistName,
      clinicId: activeClinicId || undefined,
      firstName: rawFirst || 'Patient',
      lastName: rawLast,
      dob: '',
      date: getClinicTodayIso(),
      time: '09:00 AM',
      status: 'In Review',
      findings: defaultFindings,
      patientSummary: contextText || 'Consultation in progress',
      appointmentType: 'Comprehensive Examination',
      transcript: sessionTranscript,
      clinicalProgressNote: currentNote,
      consent: {
        obtainedAt: new Date().toISOString(),
        disclosureVersion: 'v1',
        recordedBy: currentUser?.id || dentistName || 'Dentist',
      },
    };

    return {
      ...base,
      recordVersion: overrides.recordVersion ?? base.recordVersion ?? (base.revisions?.length || 1),
      firstName: overrides.firstName ?? (base.firstName || rawFirst || 'Patient'),
      lastName: overrides.lastName ?? (base.lastName || rawLast),
      clinicalProgressNote: overrides.clinicalProgressNote ?? currentNote,
      transcript: sessionTranscript,
      findings: {
        ...(base.findings || defaultFindings),
        history: contextText,
        chiefComplaint: contextText,
        ...(overrides.findings || {}),
      },
      consent: overrides.consent ?? (base.consent?.obtainedAt ? base.consent : {
        obtainedAt: new Date().toISOString(),
        disclosureVersion: 'v1',
        recordedBy: currentUser?.id || dentistName || 'Dentist',
      }),
      ...overrides,
    };
  }, [activeConsultation, activeSessionId, currentUser?.id, currentUser?.name, dentistName, activeClinicId, patientName, contextText, currentNote, transcript]);

  // Comprehensive sessions list for drawer: includes all saved consultations + the live in-progress session
  const allDrawerSessions = useMemo(() => {
    const list = [...consultations];
    const liveRecord = buildLiveConsultation();
    const activeIdx = list.findIndex(c => c.id === activeSessionId);

    if (activeIdx >= 0) {
      list[activeIdx] = {
        ...list[activeIdx],
        ...liveRecord,
      };
    } else {
      // Current in-progress consultation placed at the top so it's instantly discoverable
      list.unshift(liveRecord);
    }
    return list;
  }, [consultations, activeSessionId, buildLiveConsultation]);

  // Auto-save on note edits
  const handleNoteChange = useCallback((newNote: string) => {
    setCurrentNote(newNote);
    markSessionDirty(activeSessionId);
    setDirtySessionIds(getDirtySessionIds());
    setSaveStatus('dirty');

    if (saveDebounceTimerRef.current) clearTimeout(saveDebounceTimerRef.current);
    setSaveStatus('saving');
    saveDebounceTimerRef.current = setTimeout(async () => {
      try {
        const record = buildLiveConsultation({ clinicalProgressNote: newNote });
        await onSaveConsultation(record);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('dirty');
      }
    }, 1000);
  }, [activeSessionId, buildLiveConsultation, onSaveConsultation]);

  // Auto-save on patient name edit
  const handlePatientNameChange = useCallback((newName: string) => {
    setPatientName(newName);
    markSessionDirty(activeSessionId);
    setDirtySessionIds(getDirtySessionIds());
    setSaveStatus('dirty');

    const parts = newName.trim().split(' ');
    const first = parts[0] || '';
    const last = parts.slice(1).join(' ') || '';
    if (saveDebounceTimerRef.current) clearTimeout(saveDebounceTimerRef.current);
    setSaveStatus('saving');
    saveDebounceTimerRef.current = setTimeout(async () => {
      try {
        const record = buildLiveConsultation({
          firstName: first || 'Patient',
          lastName: last,
        });
        (record as any).patientName = newName;
        await onSaveConsultation(record);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('dirty');
      }
    }, 800);
  }, [activeSessionId, buildLiveConsultation, onSaveConsultation]);

  // Auto-save on context edits
  const handleContextChange = useCallback((newContext: string) => {
    setContextText(newContext);
    markSessionDirty(activeSessionId);
    setDirtySessionIds(getDirtySessionIds());
    setSaveStatus('dirty');

    if (saveDebounceTimerRef.current) clearTimeout(saveDebounceTimerRef.current);
    setSaveStatus('saving');
    saveDebounceTimerRef.current = setTimeout(async () => {
      try {
        const currentFindings = activeConsultation?.findings || {
          chiefComplaint: newContext,
          history: newContext,
          toothFindings: '',
          findingsGingival: '',
          diagnosis: '',
          treatmentPerformed: '',
          recommendations: '',
          recallRequirements: '',
        };
        const record = buildLiveConsultation({
          findings: {
            ...currentFindings,
            chiefComplaint: newContext,
            history: newContext,
          },
        });
        await onSaveConsultation(record);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('dirty');
      }
    }, 1000);
  }, [activeSessionId, activeConsultation?.findings, buildLiveConsultation, onSaveConsultation]);

  // Rehydrate state when active consultation changes (strictly on session switch)
  useEffect(() => {
    if (activeConsultation && lastLoadedSessionIdRef.current !== activeSessionId) {
      lastLoadedSessionIdRef.current = activeSessionId;
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

      // Rehydrate transcript: prefer live in-memory transcript for this session if present
      const inMemory = localLiveTranscriptsRef.current[activeSessionId];
      if (inMemory && inMemory.length > 0) {
        setTranscript(inMemory);
      } else {
        const initial = Array.isArray(activeConsultation.transcript) ? activeConsultation.transcript : [];
        setTranscript(initial);
        setLocalLiveTranscripts(prev => ({ ...prev, [activeSessionId]: initial }));
      }

      // Rehydrate clinical note (Rule 18: clean blank canvas if none recorded)
      if (activeConsultation.clinicalProgressNote) {
        setCurrentNote(activeConsultation.clinicalProgressNote);
      } else {
        setCurrentNote('');
      }
    }
  }, [activeConsultation, activeSessionId]);

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

  // Copilot Bar & Note Pipeline State
  const [copilotInput, setCopilotInput] = useState('');
  const [isCopilotLoading, setIsCopilotLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Resilient 3-Tier Note Pipeline Hook (Phase 13 / J7)
  const {
    isGenerating: isPipelineGenerating,
    generateNote: executeNotePipeline,
  } = useNotePipeline(authToken);

  // Toast duration helper
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3500);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Helper to append spoken or typed utterance with 0ms optimistic UI update & persistence
  const handleAppendTranscriptText = useCallback(
    (text: string, sender: TranscriptItem['sender'] = 'Dialogue') => {
      if (!text.trim()) return;
      const normalized = normalizeSpokenDentalText(text.trim());
      if (!normalized) return;

      const isNoise =
        /^(sh+|ah+|um+|zz+|ss+|hh+|ff+|th+)(\s+(sh+|ah+|um+|zz+|ss+|hh+|ff+|th+))*$/i.test(normalized) ||
        /^[^a-zA-Z0-9]+$/.test(normalized);
      if (isNoise) return;

      const updatedItem: TranscriptItem = { sender, text: normalized };

      setLocalLiveTranscripts(prev => {
        const list = prev[activeSessionId] || transcript || [];
        return { ...prev, [activeSessionId]: [...list, updatedItem] };
      });

      setTranscript(prev => {
        const updated = [...prev, updatedItem];
        markSessionDirty(activeSessionId);
        setDirtySessionIds(getDirtySessionIds());
        setSaveStatus('saving');
        const record = buildLiveConsultation({ transcript: updated });
        void onSaveConsultation(record);
        setSaveStatus('saved');
        return updated;
      });
    },
    [activeSessionId, transcript, buildLiveConsultation, onSaveConsultation]
  );

  // Server-side audio diarisation & transcription via Whisper (Rule 16)
  const handleTranscribeRecordedAudio = useCallback(async () => {
    if (!authToken) {
      setToastMessage('Sign in required for server-side audio diarisation.');
      return;
    }
    setIsTranscribingAudio(true);
    setToastMessage('Transcribing & diarising captured audio...');
    try {
      const res = await requestTranscription({
        authToken,
        consultationId: activeSessionId,
      });
      if (res.ok && res.transcript && res.transcript.length > 0) {
        setLocalLiveTranscripts(prev => ({
          ...prev,
          [activeSessionId]: res.transcript!,
        }));
        setTranscript(res.transcript);
        markSessionDirty(activeSessionId);
        setDirtySessionIds(getDirtySessionIds());
        const record = buildLiveConsultation({ transcript: res.transcript });
        void onSaveConsultation(record);
        setToastMessage(`✓ Diarised transcript generated (${res.transcript.length} utterances).`);
      } else if (isTranscriptionFailure(res)) {
        setToastMessage(res.error || 'Server transcription did not find dialogue in this recording.');
      } else {
        setToastMessage('No spoken dialogue found in recording.');
      }
    } catch {
      setToastMessage('Transcription request failed.');
    } finally {
      setIsTranscribingAudio(false);
    }
  }, [authToken, activeSessionId, buildLiveConsultation, onSaveConsultation]);

  // Audio start handler with continuous speech recognition and audio segment streaming
  const handleStartAudio = useCallback(async (deviceId: string | null, mode: CaptureMode) => {
    try {
      setCaptureMode(mode);
      recordedChunkCountRef.current = 0;

      // Start hardware audio recorder for waveform, silence detection & chunk streaming
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
        onChunk: async (blob, index) => {
          recordedChunkCountRef.current = index + 1;
          if (!authToken) return;
          try {
            const base64 = await blobToBase64(blob);
            await uploadAudioSegment({
              authToken,
              consultationId: activeSessionId,
              chunkIndex: index,
              base64,
              sizeBytes: blob.size,
            });
          } catch (err) {
            console.warn('[AudioEngine] Chunk upload notice:', err);
          }
        },
      });

      audioRecorderRef.current = recorder;
      await recorder.start();

      setIsRecording(true);
      setIsPaused(false);
      isRecordingRef.current = true;
      isPausedRef.current = false;
      setSilenceSeconds(undefined);

      // Start Web Speech API with auto-restarting loop & interim handling
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
          let interim = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const res = event.results[i];
            if (res.isFinal) {
              lastInterimRef.current = '';
              setInterimTranscript('');
              const rawText = res[0].transcript.trim();
              if (rawText) {
                handleAppendTranscriptText(rawText, 'Dialogue');
              }
            } else {
              interim += res[0].transcript;
            }
          }
          if (interim.trim()) {
            const norm = normalizeSpokenDentalText(interim.trim());
            lastInterimRef.current = norm;
            setInterimTranscript(norm);
          }
        };

        recognizer.onend = () => {
          // Flush pending interim speech if user stopped or paused
          if (lastInterimRef.current.trim() && (!isRecordingRef.current || isPausedRef.current)) {
            handleAppendTranscriptText(lastInterimRef.current.trim(), 'Dialogue');
            lastInterimRef.current = '';
            setInterimTranscript('');
          }

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
          if (e.error === 'network' || e.error === 'service-not-allowed' || e.error === 'not-allowed') {
            setToastMessage('Audio is recording, but live transcription is unavailable — speech-to-text is not running.');
          }
        };

        recognizer.start();
        speechRecognizerRef.current = recognizer;
        setToastMessage('Listening & taking notes chairside...');
      } else {
        setToastMessage('This browser cannot transcribe speech — audio is recording only. Use Chrome for live transcription.');
      }
    } catch (err) {
      console.warn('[AudioEngine] Start failed:', err);
      setToastMessage('Please allow microphone access in your browser.');
    }
  }, [authToken, activeSessionId, handleAppendTranscriptText]);

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
    setRecordingSeconds(0);

    // Flush any pending interim speech
    if (lastInterimRef.current.trim()) {
      handleAppendTranscriptText(lastInterimRef.current.trim(), 'Dialogue');
      lastInterimRef.current = '';
      setInterimTranscript('');
    }

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
  }, [handleAppendTranscriptText]);

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
    userStartedSessionRef.current = true;
    if (isRecordingRef.current) {
      void handleStopAudio();
    }
    const newId = `sess-${Date.now()}`;
    lastLoadedSessionIdRef.current = newId;
    setActiveSessionId(newId);
    setPatientName('New Patient');
    setContextText('');
    setTranscript([]);
    setLocalLiveTranscripts(prev => ({ ...prev, [newId]: [] }));
    setCurrentNote('');
    setActiveTab('context');
    setToastMessage('Started fresh consultation session.');
  }, [handleStopAudio]);

  // Handle Note Generation via Resilient 3-Tier Pipeline
  const handleCreateNote = async () => {
    if (isRecordingRef.current) {
      await handleStopAudio();
    }

    setIsCopilotLoading(true);
    setToastMessage('Generating clinical note with ADA item codes (3-Tier Engine)...');

    try {
      const currentConsult: Consultation = activeConsultation || ({
        id: activeSessionId,
        firstName: patientName.split(' ')[0] || 'Patient',
        lastName: patientName.split(' ').slice(1).join(' ') || '',
        clinicalProgressNote: currentNote,
        transcript,
        date: new Date().toLocaleDateString('en-CA'),
        dentistName,
        status: 'In Review',
      } as Consultation);

      const generated = await executeNotePipeline({
        consultation: currentConsult,
        templateId: selectedTemplateId,
        context: contextText,
        transcript,
        dentistName,
        patientName,
      });

      if (generated && generated.trim().length > 0) {
        setCurrentNote(generated);
        setActiveTab('note');
        setToastMessage('Clinical note generated successfully!');

        const updatedConsult = buildLiveConsultation({
          clinicalProgressNote: generated,
          transcript,
          status: 'Completed',
        });
        void onSaveConsultation(updatedConsult);

        markSessionDirty(activeSessionId);
        setDirtySessionIds(getDirtySessionIds());
      }
    } catch (err) {
      console.warn('[Workspace] Note generation error, falling back to local template:', err);
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

  // Fast Back-to-Back Patient Advance (Atomic Boundary Isolation - Rule 14)
  const handleNextPatient = useCallback(async () => {
    // 1. Rule 14: Halt active audio immediately
    if (isRecordingRef.current) {
      await handleStopAudio();
    }

    // 2. Auto-save current consultation snapshot before leaving
    const snapshot = buildLiveConsultation({
      clinicalProgressNote: currentNote,
      transcript,
    });
    void onSaveConsultation(snapshot);

    // 3. Reset recording timer to 00:00 (Rule 14)
    setRecordingSeconds(0);
    setAudioLevel(0);
    setSilenceSeconds(undefined);

    // 4. Advance to next uncompleted consultation if available on today's roster
    const currentIndex = consultations.findIndex(c => c.id === activeSessionId);
    const nextConsult = consultations.slice(currentIndex + 1).find(c => c.status !== 'Completed' && !c.attestation?.signatureHash);

    if (nextConsult) {
      userStartedSessionRef.current = true;
      setActiveSessionId(nextConsult.id);
      setActiveTab('context');
      const name = nextConsult.firstName ? `${nextConsult.firstName} ${nextConsult.lastName || ''}`.trim() : 'Patient';
      setToastMessage(`Advanced to next patient: ${name}`);
    } else {
      // Clean fresh walk-in consultation
      handleNewSession();
      setToastMessage('Ready for next patient (New session created).');
    }
  }, [handleStopAudio, activeConsultation, currentNote, transcript, contextText, onSaveConsultation, consultations, activeSessionId, handleNewSession]);

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

          const updated = buildLiveConsultation({
            clinicalProgressNote: data.result,
            transcript,
          });
          void onSaveConsultation(updated);

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
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'ArrowRight' || e.key === 'Right')) {
        e.preventDefault();
        void handleNextPatient();
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
  }, [handleStartAudio, handlePauseAudio, handleResumeAudio, handleNewSession, handleNextPatient]);

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
          <div className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-100/70 transition-colors">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-[#2A1D24] text-white flex items-center justify-center font-bold text-xs tracking-wider shadow-sm shrink-0">
                {dentistName.split(' ').map(n => n[0]).filter(Boolean).join('').slice(0, 2).toUpperCase() || 'DR'}
              </div>
              <div className="flex flex-col leading-tight min-w-0">
                <span className="text-xs font-semibold text-slate-900 truncate">{dentistName}</span>
                {clinics && clinics.length > 1 ? (
                  <select
                    value={activeClinicId || ''}
                    onChange={(e) => onSelectClinic?.(e.target.value)}
                    className="text-[11px] text-slate-500 bg-transparent border-0 p-0 font-medium cursor-pointer focus:ring-0 truncate"
                    title="Switch practice"
                  >
                    {clinics.map(c => (
                      <option key={c.clinicId} value={c.clinicId}>{c.clinicName}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-[11px] text-slate-500 truncate">{activeClinic?.clinicName || 'Sunrise Dental'}</span>
                )}
              </div>
            </div>
          </div>

          {/* "+ New session" Button */}
          <button
            type="button"
            onClick={handleNewSession}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-[#2A1D24] hover:bg-[#3D2C35] text-white rounded-full text-xs font-semibold shadow-sm transition-all cursor-pointer active:scale-[0.98]"
            title="Start new clinical consultation session (Ctrl+N / Cmd+N)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            <span>New session</span>
            <kbd className="text-[10px] opacity-60 font-mono bg-white/20 px-1.5 py-0.5 rounded ml-1">⌘N</kbd>
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
              <span>Template Library</span>
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
        consultations={allDrawerSessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        dirtySessionIds={dirtySessionIds}
      />

      {/* --------------------------------------------------------------------- */}
      {/* Central Consultation Workspace Canvas                                 */}
      {/* --------------------------------------------------------------------- */}
      <main className="flex-1 flex flex-col min-w-0 bg-white">
        {/* Top Patient Header Bar */}
        <header className="px-6 py-3 border-b border-slate-200/80 bg-[#FAF9F7] flex items-center justify-between gap-4 select-none">
          {/* Patient Details & Status */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold text-xs flex items-center justify-center shrink-0">
              {patientName.split(' ').map(n => n[0]).filter(Boolean).join('').slice(0, 2).toUpperCase() || 'PT'}
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={patientName}
                  onChange={(e) => handlePatientNameChange(e.target.value)}
                  className="text-sm font-bold text-slate-900 bg-transparent border-0 focus:ring-0 p-0 hover:bg-slate-100/50 rounded cursor-text"
                  placeholder="Patient Name"
                />
                {/* Active Template Switcher Pill */}
                <button
                  type="button"
                  onClick={() => setShowTemplatesModal(true)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-semibold border border-indigo-200/60 transition-colors cursor-pointer"
                  title="Change note template"
                >
                  <span>{currentTemplateName}</span>
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <span>{activeConsultation?.date || new Date().toLocaleDateString('en-AU')}</span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  {saveStatus === 'saving' ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      <span className="text-amber-600">Saving...</span>
                    </>
                  ) : saveStatus === 'dirty' ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      <span className="text-amber-600">Unsaved edits</span>
                    </>
                  ) : (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span className="text-emerald-600">Saved</span>
                    </>
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Quick Header Actions */}
          <div className="flex items-center gap-2">
            {/* Fast Next Patient Advance (⌘→) */}
            <button
              type="button"
              onClick={() => void handleNextPatient()}
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200/80 text-xs font-semibold rounded-lg shadow-2xs transition-all cursor-pointer active:scale-[0.98]"
              title="Save current patient and advance to next consultation (⌘→)"
            >
              <span>Next Patient</span>
              <kbd className="font-mono text-[10px] bg-indigo-200/70 text-indigo-900 px-1 py-0.2 rounded ml-0.5">⌘→</kbd>
            </button>

            {/* Create Note Trigger */}
            <button
              onClick={handleCreateNote}
              disabled={isCopilotLoading}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all disabled:opacity-50 cursor-pointer"
            >
              <svg className={`w-3.5 h-3.5 ${isCopilotLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>{isCopilotLoading ? 'Generating note...' : 'Create note'}</span>
              <kbd className="hidden sm:inline font-mono text-[10px] bg-indigo-500 text-indigo-100 px-1 py-0.2 rounded ml-1">⌘↵</kbd>
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
              onChangeContext={handleContextChange}
              onSyncChangesToNote={() => handleAskCopilot(`Sync these updated context details into the clinical note: "${contextText}"`)}
              isSyncing={isCopilotLoading}
            />
          )}

          {activeTab === 'transcript' && (
            <TranscriptTab
              transcript={transcript}
              isLive={isRecording && !isPaused}
              interimText={interimTranscript}
              onAddUtterance={(text, sender) => handleAppendTranscriptText(text, sender)}
              onUpdateTranscript={(updated) => {
                setLocalLiveTranscripts(prev => ({ ...prev, [activeSessionId]: updated }));
                setTranscript(updated);
                markSessionDirty(activeSessionId);
                setDirtySessionIds(getDirtySessionIds());
                const record = buildLiveConsultation({ transcript: updated });
                void onSaveConsultation(record);
              }}
              onSeparateMergedSession={() => setShowSplitModal(true)}
              onStartListening={() => void handleStartAudio(null, captureMode)}
              hasRecordedAudio={recordingSeconds > 0 || recordedChunkCountRef.current > 0}
              isTranscribingAudio={isTranscribingAudio}
              onTranscribeRecordedAudio={handleTranscribeRecordedAudio}
            />
          )}

          {activeTab === 'note' && (
            <NoteTab
              noteText={currentNote}
              onChangeNoteText={handleNoteChange}
              selectedTemplateId={selectedTemplateId}
              onSelectTemplate={handleSelectTemplate}
              onOpenTemplateModal={() => setShowTemplatesModal(true)}
              patientName={patientName}
              dentistName={dentistName}
              consultation={buildLiveConsultation()}
              authToken={authToken}
              onSaveConsultation={onSaveConsultation}
              onSigned={(updated) => {
                void onSaveConsultation(updated);
                setToastMessage('Clinical note cryptographically signed & sealed.');
              }}
              onFeedback={(rating) => setToastMessage(rating === 'positive' ? 'Thank you! Note feedback recorded.' : 'Feedback recorded — you can ask copilot below to adjust note.')}
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
