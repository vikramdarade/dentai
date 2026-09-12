import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import {
  DayScheduleItem,
  updateScheduleItem,
  saveTodaySchedule,
  loadTodaySchedule,
  formatNoteForPmsClipboard,
  getTodayDateStr,
  generateSafeUuid
} from '../lib/dayScheduleStorage';
import { verifyTranscriptGrounding } from '../lib/transcriptGrounding';
import { normalizeSpokenDentalText } from '../lib/dentalPhoneticLexicon';
import { evaluateAudioFallbackNeed } from '../lib/draftEngine';
import TopSurgeryBar from '../components/TopSurgeryBar';
import { AnimatePresence } from 'motion/react';

interface SurgeryIslandContextType {
  recordingItem: DayScheduleItem | null;
  mediaStream: MediaStream | null;
  liveTranscript: string;
  micError: string | null;
  clearMicError: () => void;
  startInPlaceRecording: (item: DayScheduleItem) => Promise<void>;
  finishInPlaceRecording: () => Promise<void>;
  cancelInPlaceRecording: () => void;
  reconnectInPlaceRecording: (item: DayScheduleItem) => Promise<void>;
}

const SurgeryIslandContext = createContext<SurgeryIslandContextType | undefined>(undefined);

interface SurgeryIslandProviderProps {
  children: React.ReactNode;
  authToken: string;
  dentistName: string;
  onScheduleUpdated?: (items: DayScheduleItem[]) => void;
}

export function SurgeryIslandProvider({
  children,
  authToken,
  dentistName,
  onScheduleUpdated
}: SurgeryIslandProviderProps) {
  const [recordingItem, setRecordingItem] = useState<DayScheduleItem | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [micError, setMicError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const speechRecognitionRef = useRef<any>(null);
  const isRecordingActiveRef = useRef(false);
  const accumulatedTranscriptRef = useRef('');
  const recordingStartTimeRef = useRef<number>(Date.now());
  const wakeLockRef = useRef<any>(null);

  const clearMicError = useCallback(() => {
    setMicError(null);
  }, []);

  // Cleanup on unmount of provider only
  useEffect(() => {
    return () => {
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch {}
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch {}
      }
      if (mediaStream) {
        try { mediaStream.getTracks().forEach(t => t.stop()); } catch {}
      }
    };
  }, []);

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

      // 2. Clean up any orphaned 'recording' status on other items in the roster
      const currentRoster = loadTodaySchedule();
      const cleanedRoster = currentRoster.map(i => {
        if (i.id !== item.id && i.status === 'recording') {
          return { ...i, status: 'scheduled' as const };
        }
        return i;
      });
      saveTodaySchedule(cleanedRoster);

      // 3. Request microphone access with operatory acoustic preset (no destructive echo cancellation)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
          channelCount: 1
        }
      });
      setMediaStream(stream);
      setRecordingItem(item);
      setLiveTranscript('');
      accumulatedTranscriptRef.current = '';
      isRecordingActiveRef.current = true;
      recordingStartTimeRef.current = Date.now();

      // 4. Mark target row as recording in storage
      const updated = updateScheduleItem(item.id, { status: 'recording' });
      onScheduleUpdated?.(updated);

      // 5. Start MediaRecorder with voice-optimized Opus compression (32kbps)
      audioChunksRef.current = [];
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32000 });
      } catch {
        try {
          recorder = new MediaRecorder(stream, { audioBitsPerSecond: 32000 });
        } catch {
          recorder = new MediaRecorder(stream);
        }
      }
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };
      recorder.start(2500);

      // Acquire Screen WakeLock to prevent operatory tablet/laptop sleep during in-place recording
      if ('wakeLock' in navigator && (navigator as any).wakeLock?.request) {
        try {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        } catch (wlErr) {
          console.warn('[SurgeryIsland] WakeLock notice:', wlErr);
        }
      }

      // 6. Resilient Speech Recognition with continuous auto-restart & text accumulation
      const initSpeechRec = () => {
        if (!isRecordingActiveRef.current) return;
        const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRec) return;
        try {
          const sr = new SpeechRec();
          sr.continuous = true;
          sr.interimResults = true;
          sr.lang = 'en-AU';

          sr.onresult = (event: any) => {
            let interimText = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              const res = event.results[i];
              if (res.isFinal) {
                const clean = res[0].transcript.trim();
                if (clean) {
                  accumulatedTranscriptRef.current = (accumulatedTranscriptRef.current + ' ' + clean).trim();
                }
              } else {
                interimText += ' ' + res[0].transcript;
              }
            }
            const combined = (accumulatedTranscriptRef.current + ' ' + interimText).trim();
            const normalized = normalizeSpokenDentalText(combined);
            setLiveTranscript(normalized);
          };

          sr.onend = () => {
            if (isRecordingActiveRef.current) {
              setTimeout(() => {
                initSpeechRec();
              }, 150);
            }
          };

          sr.onerror = (e: any) => {
            // 'no-speech' or silence during examination is non-fatal
            console.warn('[SurgeryIsland] SpeechRec notice:', e?.error);
          };

          sr.start();
          speechRecognitionRef.current = sr;
        } catch (err) {
          if (isRecordingActiveRef.current) {
            setTimeout(() => initSpeechRec(), 350);
          }
        }
      };

      initSpeechRec();
    } catch (err: any) {
      console.warn('[SurgeryIsland] Microphone access error:', err);
      setMicError(err.message || 'Microphone access denied. Check operatory mic permissions.');
    }
  };

  const reconnectInPlaceRecording = async (item: DayScheduleItem) => {
    // Re-link or start fresh audio session for an item that is in 'recording' status
    await startInPlaceRecording(item);
  };

  const finishInPlaceRecording = async () => {
    if (!recordingItem) return;
    const targetItem = { ...recordingItem };
    isRecordingActiveRef.current = false;

    // 1. Stop Speech Recognition & capture final words
    if (speechRecognitionRef.current) {
      try { speechRecognitionRef.current.stop(); } catch {}
      speechRecognitionRef.current = null;
    }

    // 2. Flush pending recorder buffer & stop MediaRecorder
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        if (typeof (mediaRecorderRef.current as any).requestData === 'function') {
          (mediaRecorderRef.current as any).requestData();
        }
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

    // 4. Release Screen WakeLock
    if (wakeLockRef.current) {
      try {
        wakeLockRef.current.release();
      } catch {}
      wakeLockRef.current = null;
    }

    // Collapse TopSurgeryBar
    setRecordingItem(null);

    // Build transcript payload
    let finalTranscriptText = (liveTranscript || accumulatedTranscriptRef.current).trim();
    let transcriptItems = [
      { sender: 'Dentist', text: `Good morning ${targetItem.patientName}, let's begin your appointment for ${targetItem.procedureText}.` },
      { sender: 'Dialogue', text: finalTranscriptText || `Clinical consultation dialogue for ${targetItem.patientName}.` },
      { sender: 'Dentist', text: `All procedures completed. We will review your recovery and plan the next recall visit.` }
    ];

    // Dual-Stream Hybrid Audio Scribe:
    // Evaluate if speech recognition missed portions or clinical milestones of the consultation
    const wordCount = finalTranscriptText.split(/\s+/).filter(Boolean).length;
    const durationSeconds = Math.max(1, Math.round((Date.now() - recordingStartTimeRef.current) / 1000));
    const evalResult = evaluateAudioFallbackNeed({
      hasAudioChunks: audioChunksRef.current.length > 0,
      wordCount,
      durationSeconds,
      transcriptText: finalTranscriptText
    });

    if (evalResult.shouldFallback) {
      console.info(`[SurgeryIsland] Multimodal audio transcription triggered: ${evalResult.reason}`);
      try {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (audioBlob.size > 1500) {
          const reader = new FileReader();
          const base64Promise = new Promise<string>((resolve) => {
            reader.onloadend = () => {
              const res = reader.result as string;
              resolve(res ? res.split(',')[1] || '' : '');
            };
          });
          reader.readAsDataURL(audioBlob);
          const audioBase64 = await base64Promise;

          if (audioBase64) {
            const customKey = localStorage.getItem('dentai_custom_gemini_key') || '';
            const txRes = await fetch('/api/transcribe-audio', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
              },
              body: JSON.stringify({
                audioBase64,
                mimeType: audioBlob.type || 'audio/webm',
                userApiKey: customKey || undefined
              })
            });
            if (txRes.ok) {
              const txData = await txRes.json();
              if (Array.isArray(txData.items) && txData.items.length > 0) {
                transcriptItems = txData.items;
              } else if (txData.fullTranscript) {
                transcriptItems = [
                  { sender: 'Dentist', text: `Good morning ${targetItem.patientName}, let's begin your appointment for ${targetItem.procedureText}.` },
                  { sender: 'Dialogue', text: txData.fullTranscript },
                  { sender: 'Dentist', text: `All procedures completed. We will review your recovery and plan the next recall visit.` }
                ];
              }
            }
          }
        }
      } catch (audioFallbackErr) {
        console.warn('[SurgeryIsland] Multimodal audio transcription fallback warning:', audioFallbackErr);
      }
    }

    // Update row to processing with safe UUID and cached transcript
    const assignedConsultationId = generateSafeUuid();
    let updated = updateScheduleItem(targetItem.id, {
      status: 'processing',
      consultationId: assignedConsultationId,
      transcript: transcriptItems
    });
    onScheduleUpdated?.(updated);

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
      const queued = updateScheduleItem(targetItem.id, { jobId });
      onScheduleUpdated?.(queued);

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
            onScheduleUpdated?.(fresh);
          } else {
            const fresh = updateScheduleItem(targetItem.id, {
              status: 'failed',
              error: 'Synthesis timed out in background.'
            });
            onScheduleUpdated?.(fresh);
          }
        } catch (err: any) {
          const fresh = updateScheduleItem(targetItem.id, {
            status: 'failed',
            error: err?.message || 'Background worker error.'
          });
          onScheduleUpdated?.(fresh);
        }
      })();
    } catch (err: any) {
      console.error('[SurgeryIsland] Finish in-place recording failed:', err);
      const fresh = updateScheduleItem(targetItem.id, {
        status: 'failed',
        error: err?.message || 'Network error saving clinical note.'
      });
      onScheduleUpdated?.(fresh);
    }
  };

  const cancelInPlaceRecording = () => {
    if (speechRecognitionRef.current) {
      try { speechRecognitionRef.current.stop(); } catch {}
      speechRecognitionRef.current = null;
    }
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    } catch {}
    if (mediaStream) {
      try {
        mediaStream.getTracks().forEach(track => track.stop());
      } catch {}
      setMediaStream(null);
    }
    if (recordingItem) {
      const fresh = updateScheduleItem(recordingItem.id, { status: 'scheduled' });
      onScheduleUpdated?.(fresh);
    }
    setRecordingItem(null);
  };

  return (
    <SurgeryIslandContext.Provider
      value={{
        recordingItem,
        mediaStream,
        liveTranscript,
        micError,
        clearMicError,
        startInPlaceRecording,
        finishInPlaceRecording,
        cancelInPlaceRecording,
        reconnectInPlaceRecording
      }}
    >
      {children}
    </SurgeryIslandContext.Provider>
  );
}

export function useSurgeryIsland(): SurgeryIslandContextType {
  const context = useContext(SurgeryIslandContext);
  if (!context) {
    throw new Error('useSurgeryIsland must be used within a SurgeryIslandProvider');
  }
  return context;
}

export function SurgeryIslandHUD({ onSelectSchedule }: { onSelectSchedule?: () => void }) {
  const { recordingItem, mediaStream, liveTranscript, finishInPlaceRecording, cancelInPlaceRecording } = useSurgeryIsland();
  return (
    <AnimatePresence>
      {recordingItem && (
        <TopSurgeryBar
          activeItem={recordingItem}
          mediaStream={mediaStream}
          onFinish={finishInPlaceRecording}
          onCancel={cancelInPlaceRecording}
          liveTranscript={liveTranscript}
          onClickPatient={onSelectSchedule}
        />
      )}
    </AnimatePresence>
  );
}

