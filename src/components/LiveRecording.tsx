import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, UserRound, Pause, Play, ArrowRight, Sparkles, ArrowUpDown, CornerDownLeft, AlertCircle, X, Mic, MicOff, RotateCcw, RefreshCw, WifiOff, Bot, Check, CheckCircle, Smartphone } from 'lucide-react';
import ChairBeaconModal from './ChairBeaconModal';
import { TranscriptItem, GeneratedNotePayload } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { AppointmentType, getTemplateById, getAppointmentTypeLabel } from '../lib/dentalLibrary';
import { SAMPLE_TRANSCRIPTS, getSampleForType } from '../lib/sampleTranscripts';
import { generateOfflineDraft, evaluateAudioFallbackNeed } from '../lib/draftEngine';
import { generateWithOnDeviceModel, type OnDeviceResult } from '../lib/onDeviceModel';
import { normalizedToPayload } from '../lib/normalizeNoteOutput';
import { normalizeSpokenDentalText } from '../lib/dentalPhoneticLexicon';
import { OPERATORY_AUDIO_DEFAULTS } from '../lib/operatoryAudioFilter';

const isQuotaFailure = (msg: string): boolean =>
  msg.toLowerCase().includes('quota') ||
  msg.toLowerCase().includes('billing') ||
  msg.toLowerCase().includes('rate-limit');

interface LiveRecordingProps {
  patientName: string;
  dob?: string;
  appointmentType: AppointmentType;
  templateId?: string;
  onBack: () => void;
  onFinish: (
    finalTranscript: TranscriptItem[],
    fallbackNote?: { engine: 'offline-draft' | 'on-device'; modelId?: string; payload: GeneratedNotePayload }
  ) => Promise<void> | void;
  /** Live async-job status line (e.g. "retrying in ~45s") rendered on the processing overlay. */
  processingHint?: string | null;
  /** Auth token used to poll the clinic's AI usage meter for this session. */
  authToken?: string | null;
  /** Clinic the consultation will be stamped with — the usage-meter scope. */
  activeClinicId?: string | null;
}

interface ClinicUsageSnapshot {
  used: number;
  limit: number;
  exceeded: boolean;
}

export default function LiveRecording({
  patientName,
  dob,
  appointmentType,
  templateId,
  onBack,
  onFinish,
  processingHint,
  authToken,
  activeClinicId
}: LiveRecordingProps) {
  const [seconds, setSeconds] = useState(() => {
    const saved = sessionStorage.getItem('dentai_active_seconds');
    return saved ? parseInt(saved, 10) : 0;
  });
  const [sessionStart] = useState(() => new Date());
  const [isRecording, setIsRecording] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingState, setProcessingState] = useState('');

  // Clinic AI usage meter (async job fabric): refreshed on mount and every 60s so
  // the dentist sees how much of the clinic's daily hosted-AI allowance remains
  // BEFORE finishing a note — no more surprise quota dead-ends mid-day.
  const [clinicUsage, setClinicUsage] = useState<ClinicUsageSnapshot | null>(null);
  useEffect(() => {
    if (!authToken) return;
    let cancelled = false;
    const loadUsage = async () => {
      try {
        const params = activeClinicId ? `?clinicId=${encodeURIComponent(activeClinicId)}` : '';
        const res = await fetch(`/api/usage/today${params}`, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) return;
        const snap = await res.json();
        if (!cancelled) {
          setClinicUsage({ used: snap.used, limit: snap.limit, exceeded: snap.exceeded });
        }
      } catch {
        // The usage pill is non-critical; ignore transient network failures.
      }
    };
    loadUsage();
    const interval = setInterval(loadUsage, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [authToken, activeClinicId]);

  // Ambient Mode & Reset states
  const [isAmbientMode, setIsAmbientMode] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showBeaconModal, setShowBeaconModal] = useState(false);

  // Voice transcription state
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [recognitionError, setRecognitionError] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);

  // True while the user has explicitly paused the microphone — suppresses auto-restart.
  const micStoppedByUserRef = useRef(false);
  const isRecordingRef = useRef(isRecording);
  const secondsRef = useRef(seconds);

  // Guard against a flaky mic triggering a rapid restart loop: every recognition
  // session that ends and restarts toggles the UI, so a session that dies almost
  // immediately should stop auto-restarting after a few attempts.
  const lastSessionStartRef = useRef(0);
  const unstableRestartsRef = useRef(0);
  const RESTART_MIN_SESSION_MS = 1500;
  const MAX_UNSTABLE_RESTARTS = 3;

  // VocalBridge Web Audio API nodes & states
  const [vocalBridgeActive, setVocalBridgeActive] = useState(true);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const animationFrameIdRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wakeLockRef = useRef<any>(null);

  // Draw flat line on visualizer canvas
  const drawFlatLine = () => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) return;

    canvasCtx.fillStyle = '#0A1018';
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = '#1E3048'; // dark cockpit line
    canvasCtx.beginPath();
    canvasCtx.moveTo(0, canvas.height / 2);
    canvasCtx.lineTo(canvas.width, canvas.height / 2);
    canvasCtx.stroke();
  };

  // Live frequency/waveform animation visualizer
  const drawVisualizer = () => {
    if (!canvasRef.current || !analyserRef.current) return;
    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationFrameIdRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      canvasCtx.fillStyle = '#0A1018';
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

      canvasCtx.lineWidth = 2;
      // Electric cyan if VocalBridge active, indigo/violet if raw
      canvasCtx.strokeStyle = vocalBridgeActive ? '#22D3EE' : '#818CF8';
      canvasCtx.shadowBlur = 8;
      canvasCtx.shadowColor = vocalBridgeActive ? '#22D3EE' : '#818CF8';
      canvasCtx.beginPath();

      const sliceWidth = canvas.width * 1.0 / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * canvas.height / 2;

        if (i === 0) {
          canvasCtx.moveTo(x, y);
        } else {
          canvasCtx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      canvasCtx.lineTo(canvas.width, canvas.height / 2);
      canvasCtx.stroke();
      canvasCtx.shadowBlur = 0;
    };

    draw();
  };

  // Start noise suppression audio pipeline
  const startAudioPipeline = async () => {
    try {
      // Cancel any previous visualizer loop and stop any previous stream first, so
      // rapid recognition restarts can't stack overlapping pipelines (which make the
      // waveform canvas flicker between stale frames).
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
          channelCount: 1
        }
      });
      streamRef.current = stream;

      // Start voice-optimized Opus MediaRecorder buffer for Dual-Stream Hybrid Audio Scribe
      try {
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
      } catch (recErr) {
        console.warn('MediaRecorder buffer capture fallback:', recErr);
      }

      // Request Screen WakeLock to prevent operatory tablet/laptop sleep during long consultations
      if ('wakeLock' in navigator && (navigator as any).wakeLock?.request) {
        try {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        } catch (wlErr) {
          console.warn('[LiveRecording] WakeLock notice:', wlErr);
        }
      }

      const source = audioContextRef.current.createMediaStreamSource(stream);
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      if (vocalBridgeActive) {
        // High-pass filter to block low frequency motor, HVAC, compressor hums (<120Hz)
        const hpFilter = audioContextRef.current.createBiquadFilter();
        hpFilter.type = 'highpass';
        hpFilter.frequency.value = OPERATORY_AUDIO_DEFAULTS.highPassFreq;
        hpFilter.Q.value = OPERATORY_AUDIO_DEFAULTS.q;

        // Low-pass filter to block high frequency ultrasonic scaler whine & suction hiss (>4200Hz)
        const lpFilter = audioContextRef.current.createBiquadFilter();
        lpFilter.type = 'lowpass';
        lpFilter.frequency.value = OPERATORY_AUDIO_DEFAULTS.lowPassFreq;
        lpFilter.Q.value = OPERATORY_AUDIO_DEFAULTS.q;

        source.connect(hpFilter);
        hpFilter.connect(lpFilter);
        lpFilter.connect(analyser);
      } else {
        source.connect(analyser);
      }

      drawVisualizer();
    } catch (err) {
      console.warn('Web Audio capture failed or blocked:', err);
      // Fallback gracefully without crashing transcription
    }
  };

  // Stop audio filter pipeline
  const stopAudioPipeline = () => {
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        if (typeof (mediaRecorderRef.current as any).requestData === 'function') {
          (mediaRecorderRef.current as any).requestData();
        }
        mediaRecorderRef.current.stop();
      } catch {}
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.suspend();
      } catch (e) {}
    }

    if (wakeLockRef.current) {
      try {
        wakeLockRef.current.release();
      } catch {}
      wakeLockRef.current = null;
    }

    drawFlatLine();
  };



  // Initial draw flat line
  useEffect(() => {
    drawFlatLine();
    return () => {
      stopAudioPipeline();
    };
  }, []);

  // Sync VocalBridge toggle settings
  useEffect(() => {
    if (isListening) {
      stopAudioPipeline();
      startAudioPipeline();
    } else {
      drawFlatLine();
    }
  }, [vocalBridgeActive]);

  // Initialize SpeechRecognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-AU';

      rec.onstart = () => {
        lastSessionStartRef.current = Date.now();
        setIsListening(true);
        setRecognitionError(null);
        startAudioPipeline();
      };

      rec.onerror = (event: any) => {
        if (event.error === 'not-allowed') {
          console.error('Speech recognition error:', event.error);
          setRecognitionError('Microphone permission blocked. Please check browser settings.');
          setIsListening(false);
          stopAudioPipeline();
        } else if (event.error === 'no-speech') {
          // Pause in conversation or video is normal; do not stop audio pipeline!
          return;
        } else {
          console.warn('Speech recognition notice:', event.error);
        }
      };

      rec.onend = () => {
        // The Web Speech API ends recognition sessions on its own (silence or length
        // limits). Auto-restart while the session is still recording, unless the user
        // explicitly stopped the microphone. DO NOT kill the audio pipeline or mic tracks!
        if (isRecordingRef.current && !micStoppedByUserRef.current) {
          const sessionMs = Date.now() - lastSessionStartRef.current;
          if (sessionMs < RESTART_MIN_SESSION_MS) {
            unstableRestartsRef.current += 1;
          } else {
            unstableRestartsRef.current = 0;
          }
          
          // Exponential backoff if recognition repeatedly disconnects, but keep audio buffer recording intact
          const backoffDelay = Math.min(2000, 250 * Math.pow(1.5, Math.min(6, unstableRestartsRef.current)));
          if (unstableRestartsRef.current >= 10) {
            console.warn('[LiveRecording] Web Speech API frequent resets; relying on background audio buffer.');
          }

          setTimeout(() => {
            try {
              if (isRecordingRef.current && !micStoppedByUserRef.current) {
                rec.start();
              }
            } catch (e) {
              console.warn('Speech recognition auto-restart retry notice:', e);
            }
          }, backoffDelay);
        } else {
          setIsListening(false);
          stopAudioPipeline();
        }
      };

      rec.onresult = (event: any) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const result = event.results[i];
          if (result.isFinal) {
            const rawText = result[0].transcript.trim();
            const text = normalizeSpokenDentalText(rawText);
            if (text) {
              setTranscript((prev) => [...prev, { sender: 'Dialogue', text }]);
              setItemTimes((prev) => [...prev, secondsRef.current]);
            }
          } else {
            interim += result[0].transcript;
          }
        }
        setInterimTranscript(normalizeSpokenDentalText(interim));
      };

      recognitionRef.current = rec;
    } else {
      console.warn('SpeechRecognition is not supported in this browser.');
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {}
      }
    };
  }, []);

  // Sync isRecording state with SpeechRecognition
  useEffect(() => {
    if (!isRecording && isListening) {
      micStoppedByUserRef.current = true;
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      stopAudioPipeline();
    } else if (isRecording && !isListening) {
      micStoppedByUserRef.current = false;
      unstableRestartsRef.current = 0;
      if (recognitionRef.current) {
        setRecognitionError(null);
        setInterimTranscript('');
        try {
          recognitionRef.current.start();
        } catch (err) {
          console.error('Failed to auto-start speech recognition:', err);
        }
      }
    }
  }, [isRecording]);

  const toggleSpeechRecognition = () => {
    if (!recognitionRef.current) {
      setRecognitionError('Speech recognition is not supported in this browser. Please use Google Chrome or Microsoft Edge.');
      return;
    }

    if (isListening) {
      micStoppedByUserRef.current = true;
      recognitionRef.current.stop();
    } else {
      micStoppedByUserRef.current = false;
      unstableRestartsRef.current = 0;
      setRecognitionError(null);
      setInterimTranscript('');
      try {
        recognitionRef.current.start();
      } catch (err) {
        console.error('Failed to start speech recognition:', err);
      }
    }
  };


  // Initial transcription items matching screen layout (Starts empty for live clinical capture)
  const [transcript, setTranscript] = useState<TranscriptItem[]>(() => {
    const saved = sessionStorage.getItem('dentai_active_transcript');
    return saved ? JSON.parse(saved) : [];
  });

  // Real elapsed-session timestamps (seconds) recorded when each transcript item was added.
  const [itemTimes, setItemTimes] = useState<number[]>(() => {
    const saved = sessionStorage.getItem('dentai_active_item_times');
    return saved ? JSON.parse(saved) : [];
  });

  // Sample transcripts for testing — default picker choice follows the treatment
  // type chosen at intake so the recommended template matches the transcript.
  const [sampleType, setSampleType] = useState<AppointmentType>(appointmentType);

  const loadSampleTranscript = (type: AppointmentType) => {
    if (transcript.length > 0 && !window.confirm('Replace the current transcript with this sample?')) return;
    const sample = getSampleForType(type);
    if (!sample) return;
    const base = Math.max(0, secondsRef.current - sample.items.length * 3);
    setTranscript(sample.items);
    setItemTimes(sample.items.map((_, i) => base + i * 3));
    // The sample is a complete consultation — retire the per-line simulation presets.
    setNextPresetIndex(999);
  };

  // Simulated transcription lines that users can trigger to append to the conversation!
  const presetPhrases = [
    { sender: 'Patient' as const, text: "Wait, tooth 16 feels very tender when you tap details on it." },
    { sender: 'Dentist' as const, text: "Got it. Tooth 16 exhibits vertical percussion sensitivity. Marginal fracture visible on MO composite." },
    { sender: 'Dentist' as const, text: "Let's recommend scheduling immediate root canal therapy to clear out pulpitis." },
    { sender: 'Patient' as const, text: "Alright, if it stops this throbbing pain, let's do it." }
  ];

  const [nextPresetIndex, setNextPresetIndex] = useState(() => {
    const saved = sessionStorage.getItem('dentai_active_preset_index');
    return saved ? parseInt(saved, 10) : 0;
  });
  const [customInput, setCustomInput] = useState('');

  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Wall-clock time counting effect resilient against background tab throttling
  const recordingStartTimeRef = useRef<number | null>(null);
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isRecording) {
      if (!recordingStartTimeRef.current) {
        recordingStartTimeRef.current = Date.now() - seconds * 1000;
      }
      interval = setInterval(() => {
        if (recordingStartTimeRef.current) {
          const elapsed = Math.max(0, Math.floor((Date.now() - recordingStartTimeRef.current) / 1000));
          setSeconds(elapsed);
        }
      }, 1000);
    } else {
      recordingStartTimeRef.current = null;
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording]);

  // Operatory keyboard trigger: Spacebar toggles recording hands-free (when not focused on text fields)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        const target = e.target as HTMLElement;
        const isInputField = target && (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable
        );
        if (!isInputField && !showBeaconModal && !isProcessing) {
          e.preventDefault();
          setIsRecording((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showBeaconModal, isProcessing]);


  // Keep refs in sync for use inside long-lived callbacks (SpeechRecognition handlers).
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    secondsRef.current = seconds;
  }, [seconds]);

  // Auto scroll effect — only follow the transcript when the user is already near the
  // bottom, so new speech results never yank the viewport away while they're reading.
  useEffect(() => {
    const endEl = transcriptEndRef.current;
    if (!endEl) return;
    const container = endEl.closest('.overflow-y-auto') as HTMLElement | null;
    if (!container) return;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 140;
    if (nearBottom) {
      endEl.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcript]);

  // Sync recording session to sessionStorage to protect against accidental refreshes
  useEffect(() => {
    sessionStorage.setItem('dentai_active_transcript', JSON.stringify(transcript));
  }, [transcript]);

  useEffect(() => {
    sessionStorage.setItem('dentai_active_item_times', JSON.stringify(itemTimes));
  }, [itemTimes]);

  useEffect(() => {
    sessionStorage.setItem('dentai_active_seconds', seconds.toString());
  }, [seconds]);

  useEffect(() => {
    sessionStorage.setItem('dentai_active_preset_index', nextPresetIndex.toString());
  }, [nextPresetIndex]);

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatClock = (date: Date) => {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  const handleAppendPhrase = (sender: 'Dentist' | 'Patient' | 'Dialogue' | 'Clinical Comment', text: string) => {
    if (!text.trim()) return;
    const normalizedText = normalizeSpokenDentalText(text);
    setTranscript((prev) => [...prev, { sender, text: normalizedText }]);
    setItemTimes((prev) => [...prev, secondsRef.current]);
  };

  const triggerNextPreset = () => {
    if (nextPresetIndex < presetPhrases.length) {
      const phrase = presetPhrases[nextPresetIndex];
      handleAppendPhrase(phrase.sender, phrase.text);
      setNextPresetIndex(nextPresetIndex + 1);
    }
  };

  const handleSendCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customInput.trim()) return;
    handleAppendPhrase('Clinical Comment', customInput);
    setCustomInput('');
  };

  const handleResetSession = () => {
    setTranscript([]);
    setItemTimes([]);
    setSeconds(0);
    recordingStartTimeRef.current = Date.now();
    setIsRecording(true);
    setShowResetConfirm(false);
    setNextPresetIndex(0);
    micStoppedByUserRef.current = false;
    unstableRestartsRef.current = 0;
    
    sessionStorage.removeItem('dentai_active_transcript');
    sessionStorage.removeItem('dentai_active_seconds');
    sessionStorage.removeItem('dentai_active_preset_index');
    sessionStorage.removeItem('dentai_active_item_times');

    if (recognitionRef.current && !isListening) {
      setRecognitionError(null);
      setInterimTranscript('');
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.error('Failed to restart speech recognition during reset:', e);
      }
    }
  };

  const handleTactileTag = (tagText: string) => {
    handleAppendPhrase('Clinical Comment', tagText);
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([100]); // 100ms haptic feedback
    }
  };

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [processingSeconds, setProcessingSeconds] = useState(0);
  const processingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Only claim AI detection when clinical terminology is actually present in the transcript.
  const hasClinicalTerms = transcript.some((t) =>
    /(percussion|sensitivity|pulp|decay|caries|bleeding|mobility|root canal|filling|tooth\s*\d{1,2})/i.test(t.text)
  );

  const getProcessingStageDescription = (seconds: number, baseState: string): string => {
    if (baseState && baseState !== 'Formatting consultation dialogue...') {
      return baseState;
    }
    if (seconds >= 22) return 'Synthesizing complex multi-tooth examination findings...';
    if (seconds >= 15) return 'Structuring medical-legal clinical record & recommendations...';
    if (seconds >= 9) return 'Analyzing tooth chart, periodontal findings & clinical dialogue...';
    if (seconds >= 5) return 'Connecting to Dental AI clinical extractor...';
    if (seconds >= 2) return 'Transcribing consultation & mapping FDI tooth numbers...';
    return baseState || 'Formatting consultation dialogue...';
  };

  const stopProcessingTicker = () => {
    if (processingTimerRef.current) {
      clearInterval(processingTimerRef.current);
      processingTimerRef.current = null;
    }
    setIsProcessing(false);
  };

  const startProcessingSession = (initialState: string) => {
    setIsRecording(false);
    setIsProcessing(true);
    setErrorMsg(null);
    setProcessingSeconds(0);
    setProcessingState(initialState);

    if (processingTimerRef.current) clearInterval(processingTimerRef.current);
    processingTimerRef.current = setInterval(() => {
      setProcessingSeconds((prev) => prev + 1);
    }, 1000);
  };

  // Tier 1 — hosted AI (Gemini primary + secondary key failover on the server).
  const handleFinishNote = async () => {
    startProcessingSession('Formatting consultation dialogue...');

    // 1. Flush any pending interim speech into the working transcript
    let currentTranscript = [...transcript];
    if (interimTranscript && interimTranscript.trim()) {
      currentTranscript.push({ sender: 'Dialogue', text: interimTranscript.trim() });
    }

    // 2. Flush and stop raw audio recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        if (typeof (mediaRecorderRef.current as any).requestData === 'function') {
          (mediaRecorderRef.current as any).requestData();
        }
        mediaRecorderRef.current.stop();
      } catch {}
    }

    // 3. Dual-Stream Hybrid Audio Scribe:
    // Evaluate if speech recognition missed portions or clinical milestones of the consultation
    const fullText = currentTranscript.map(t => t.text).join(' ');
    const wordCount = fullText.split(/\s+/).filter(Boolean).length;
    const durationSeconds = Math.max(1, secondsRef.current || seconds);
    const evalResult = evaluateAudioFallbackNeed({
      hasAudioChunks: audioChunksRef.current.length > 0,
      wordCount,
      durationSeconds,
      transcriptText: fullText
    });

    if (evalResult.shouldFallback) {
      try {
        console.info(`[LiveRecording] Multimodal audio transcription triggered: ${evalResult.reason}`);
        setProcessingState('Transcribing high-fidelity operatory audio recording...');
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
                currentTranscript = txData.items;
                setTranscript(txData.items);
              } else if (txData.fullTranscript) {
                currentTranscript = [
                  { sender: 'Dialogue', text: txData.fullTranscript }
                ];
                setTranscript(currentTranscript);
              }
            } else if (txRes.status === 429) {
              console.warn('[LiveRecording] Multimodal audio transcription 429 rate limit reached.');
            }
          }
        }
      } catch (audioFallbackErr) {
        console.warn('[LiveRecording] Multimodal audio transcription fallback warning:', audioFallbackErr);
      }
    }

    // Free audio buffer memory
    audioChunksRef.current = [];

    setProcessingState('Synthesizing structured clinical notes...');

    try {
      await onFinish(currentTranscript);
      stopProcessingTicker();
    } catch (err: any) {
      stopProcessingTicker();
      setErrorMsg(err.message || 'Failed to generate clinical notes. Please verify connection and try again.');
    }
  };

  // Tier 3a — rule-based offline draft (works with no network / no GPU).
  const handleDraftOffline = async () => {
    startProcessingSession('Generating instant deterministic offline note from transcript...');

    try {
      const template = getTemplateById(templateId);
      const draft = generateOfflineDraft(template, transcript, getAppointmentTypeLabel(appointmentType));
      const payload: GeneratedNotePayload = {
        engine: 'offline-draft',
        canonical: draft.canonical,
        customSections: draft.customSections,
        patientSummary: draft.patientSummary,
        adaCodes: draft.adaCodes
      };
      await onFinish(transcript, { engine: 'offline-draft', payload });
      stopProcessingTicker();
    } catch (err: any) {
      stopProcessingTicker();
      setErrorMsg(err.message || 'The offline draft could not be created. Your transcript is preserved.');
    }
  };

  // Tier 3b — on-device WebLLM model (beta; requires WebGPU, first use downloads weights).
  const handleOnDeviceModel = async () => {
    startProcessingSession('Starting the on-device model (WebGPU)...');

    try {
      const template = getTemplateById(templateId);
      const res = await generateWithOnDeviceModel({
        template,
        patientName,
        dob: dob || '—',
        appointmentTypeLabel: getAppointmentTypeLabel(appointmentType),
        transcript,
        onProgress: (p) => setProcessingState(p.message)
      });
      if (!res.ok) {
        const failure = res as Extract<OnDeviceResult, { ok: false }>;
        throw new Error(failure.message);
      }
      const payload: GeneratedNotePayload = {
        ...normalizedToPayload(template, res.output),
        engine: 'on-device',
        modelId: res.modelId
      };
      await onFinish(transcript, { engine: 'on-device', modelId: res.modelId, payload });
      stopProcessingTicker();
    } catch (err: any) {
      stopProcessingTicker();
      setErrorMsg(err.message || 'The on-device model could not generate a note. Your transcript is preserved.');
    }
  };

  const getInitials = (name: string) => {
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <div id="live-recording-container" className="h-screen w-full flex flex-col bg-[#070B11] overflow-hidden text-slate-100">
      {/* Top App Bar */}
      <header className="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-4 md:px-8 h-16 bg-[#0A1018]/90 backdrop-blur-md border-b border-[#1E3048]">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 -ml-2 rounded-xl hover:bg-[#152338] text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex flex-col">
            <h1 className="text-base md:text-lg font-bold text-white leading-tight">
              {patientName}
            </h1>
            <span className="font-mono text-[10px] text-cyan-400 font-bold uppercase tracking-widest leading-none">
              {getAppointmentTypeLabel(appointmentType)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {clinicUsage && (
            <span
              title={`This clinic has used ${clinicUsage.used} of ${clinicUsage.limit} hosted AI notes today. Offline drafting stays available at any time.`}
              className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-mono font-bold uppercase tracking-wider shadow-sm ${
                clinicUsage.exceeded
                  ? 'bg-rose-950/60 border-rose-500/60 text-rose-300'
                  : clinicUsage.used >= clinicUsage.limit * 0.75
                    ? 'bg-amber-950/60 border-amber-500/60 text-amber-300'
                    : 'bg-[#0E1724] border-[#1E3048] text-slate-300'
              }`}
            >
              <Sparkles className={`w-3.5 h-3.5 ${clinicUsage.exceeded ? 'text-rose-400' : 'text-cyan-400'}`} />
              {clinicUsage.used}/{clinicUsage.limit} AI notes today
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowBeaconModal(true)}
            title="Pair chairside smartphone as hands-free beacon microphone"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#1E3048] bg-[#0E1724] hover:bg-[#152338] text-cyan-300 transition-all cursor-pointer shadow-sm"
          >
            <Smartphone className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider">Phone Beacon</span>
          </button>
          <button
            onClick={() => setIsAmbientMode(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-cyan-500/40 bg-cyan-950/40 hover:bg-cyan-900/50 text-cyan-300 transition-all cursor-pointer shadow-[0_0_12px_rgba(34,211,238,0.2)]"
          >
            <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider">Go Ambient</span>
          </button>
          <div className="w-8 h-8 rounded-xl bg-cyan-950/80 border border-cyan-800 flex items-center justify-center text-cyan-300 font-mono font-bold text-xs shadow-sm">
            {getInitials(patientName)}
          </div>
        </div>
      </header>

      {/* Main Transcription Stream */}
      <main className="flex-grow pt-20 pb-48 px-4 overflow-y-auto w-full max-w-2xl mx-auto custom-scrollbar flex flex-col gap-4">
        {recognitionError && (
          <div className="w-full bg-amber-950/40 border border-amber-500/40 text-amber-200 px-4 py-3.5 rounded-xl flex items-start justify-between shadow-sm animate-fade-in mb-2 font-sans">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex flex-col">
                <span className="font-mono font-bold text-xs uppercase tracking-wider text-amber-300">Microphone Status Alert</span>
                <p className="text-xs text-amber-200/90 mt-0.5 leading-relaxed">{recognitionError}</p>
              </div>
            </div>
            <button onClick={() => setRecognitionError(null)} className="p-1 text-amber-400 hover:text-amber-200 rounded-full transition-colors cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="w-full bg-rose-950/40 border border-rose-500/40 text-rose-200 px-4 py-3.5 rounded-xl shadow-sm animate-fade-in mb-2">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                <div className="flex flex-col">
                  <span className="font-mono font-bold text-xs uppercase tracking-wider text-rose-300">
                    {isQuotaFailure(errorMsg) ? 'AI quota reached — hosted AI unavailable' : 'Error Compiling Notes'}
                  </span>
                  <p className="text-xs text-rose-200/90 mt-0.5 leading-relaxed">{errorMsg}</p>
                  {(isQuotaFailure(errorMsg) || /offline|on-device|webgpu|model/i.test(errorMsg)) && (
                    <p className="text-xs text-rose-300 mt-2 font-semibold">No clinical record was created and your transcript is preserved. Choose how to continue below.</p>
                  )}
                </div>
              </div>
              <button onClick={() => setErrorMsg(null)} className="p-1 text-rose-400 hover:text-rose-200 rounded-full transition-colors cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 mt-3">
              <button
                onClick={handleFinishNote}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#0E1724] border border-[#1E3048] text-slate-200 font-mono font-bold text-[11px] uppercase tracking-wider hover:bg-[#152338] transition-all active:scale-95 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-cyan-400" /> Retry hosted AI
              </button>
              <button
                onClick={handleDraftOffline}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-mono font-bold text-[11px] uppercase tracking-wider transition-all active:scale-95 cursor-pointer"
              >
                <WifiOff className="w-3.5 h-3.5" /> Draft offline now
              </button>
              <button
                onClick={handleOnDeviceModel}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#0E1724] border border-[#1E3048] text-slate-200 font-mono font-bold text-[11px] uppercase tracking-wider hover:bg-[#152338] transition-all active:scale-95 cursor-pointer"
              >
                <Bot className="w-3.5 h-3.5 text-cyan-400" /> On-device model
              </button>
            </div>
          </div>
        )}

        {/* Connection Started pill */}
        <div className="flex justify-center my-2">
          <span className="font-mono text-[11px] font-semibold text-slate-400 bg-[#0E1724] border border-[#1E3048] px-3.5 py-1.5 rounded-full shadow-sm">
            {formatClock(sessionStart)} - Operatory Session Active
          </span>
        </div>

        {/* Conversation flow */}
        <div className="flex flex-col gap-4">
          {transcript.length === 0 && (
            <div className="flex flex-col items-center justify-center p-8 bg-[#0E1724]/70 border border-dashed border-[#1E3048] rounded-2xl text-center text-slate-400 my-4 shadow-sm max-w-md mx-auto w-full">
              <Mic className="w-8 h-8 text-cyan-400 mb-3 animate-pulse" />
              <h4 className="font-bold text-sm text-white">Ready to Capture Session</h4>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                Click the microphone button to start recording the live dentist-patient interaction, or type comments manually.
              </p>
              <div className="mt-4 pt-4 border-t border-[#1E3048] w-full flex flex-col items-center gap-2.5">
                <span className="font-mono text-[9px] text-cyan-400 font-bold uppercase tracking-wider">Test with a sample audio transcript:</span>
                <select
                  value={sampleType}
                  onChange={(e) => setSampleType(e.target.value as AppointmentType)}
                  className="w-full h-9 px-2.5 bg-[#0A1018] border border-[#1E3048] rounded-lg text-xs font-semibold text-slate-200 focus:ring-1 focus:ring-cyan-400 focus:border-cyan-400 outline-none transition-all cursor-pointer"
                >
                  {SAMPLE_TRANSCRIPTS.map((s) => (
                    <option key={s.appointmentType} value={s.appointmentType} className="bg-[#0A1018] text-slate-200">
                      {s.title} — {s.patient}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => loadSampleTranscript(sampleType)}
                  className="w-full px-4 py-2 bg-cyan-950/60 border border-cyan-800 hover:bg-cyan-900/60 text-cyan-300 font-mono font-bold text-xs uppercase tracking-wider rounded-lg transition-all cursor-pointer shadow-sm"
                >
                  Load Sample Audio Transcript
                </button>
                <p className="text-[10px] text-slate-500 leading-relaxed text-left w-full">
                  The note is generated against the template chosen at intake —{' '}
                  <span className="text-slate-300 font-semibold">{getTemplateById(templateId).name}</span> for {getAppointmentTypeLabel(appointmentType)}.
                </p>
              </div>
            </div>
          )}

          {transcript.map((item, idx) => {
            const isComment = item.sender === 'Clinical Comment';
            const isLegacyDentist = item.sender === 'Dentist';
            const isLegacyPatient = item.sender === 'Patient';

            let badgeBg = 'bg-[#121E2E] text-slate-300 border-[#1E3048]';
            let badgeLabel = 'Session Audio';
            if (isComment) {
              badgeBg = 'bg-cyan-950/60 text-cyan-300 border-cyan-800/60';
              badgeLabel = 'Clinical Comment';
            } else if (isLegacyDentist) {
              badgeBg = 'bg-blue-950/60 text-blue-300 border-blue-800/60';
              badgeLabel = 'Dentist';
            } else if (isLegacyPatient) {
              badgeBg = 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60';
              badgeLabel = 'Patient';
            }

            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col w-full"
              >
                <div className="bg-[#0E1724] border border-[#1E3048] rounded-2xl p-4 shadow-sm hover:border-[#2a4365] transition-all flex flex-col gap-2">
                  <div className="flex justify-between items-center text-[10px] font-mono font-bold uppercase tracking-wider">
                    <span className={`px-2 py-0.5 rounded-md border ${badgeBg}`}>
                      {badgeLabel}
                    </span>
                    <span className="text-slate-500 font-mono">
                      {formatTime(itemTimes[idx] ?? Math.max(0, seconds - Math.max(0, transcript.length - idx) * 3))}
                    </span>
                  </div>
                  <p className="font-transcription-text text-slate-100 leading-relaxed text-[14.5px]">
                    {item.text}
                  </p>
                </div>
              </motion.div>
            );
          })}

          {/* Honest session-progress indicator: only shown when clinical terms are actually present */}
          {hasClinicalTerms && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-emerald-950/30 border-l-4 border-emerald-400 border-t border-r border-b border-[#1E3048] p-4 my-2 rounded-r-xl shadow-sm flex flex-col gap-1.5"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="text-emerald-400 w-4 h-4" />
                <span className="font-mono text-emerald-300 font-bold uppercase tracking-wider text-xs">
                  Clinical Terms Detected
                </span>
              </div>
              <p className="text-emerald-200/90 text-xs font-medium leading-relaxed">
                The session transcript contains clinical terminology (e.g. tooth numbers, sensitivity, restorative targets). Findings will be extracted automatically into your note.
              </p>
            </motion.div>
          )}

          {/* Interim transcript live preview */}
          {isListening && interimTranscript && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col w-full opacity-90"
            >
              <div className="bg-[#0E1724] border border-dashed border-cyan-400/50 rounded-2xl p-4 shadow-inner flex flex-col gap-2">
                <div className="flex justify-between items-center text-[10px] font-mono font-bold uppercase tracking-wider">
                  <span className="px-2 py-0.5 rounded-md border bg-cyan-950/60 text-cyan-300 border-cyan-800/60 animate-pulse flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-ping"></span>
                    <span>Transcribing Operatory Voice...</span>
                  </span>
                </div>
                <p className="font-transcription-text text-slate-300 italic leading-relaxed text-[14.5px]">
                  {interimTranscript}
                </p>
              </div>
            </motion.div>
          )}

          {/* Mic status indicator — fixed-height container */}
          {isRecording && (
            <div className="flex flex-col items-start max-w-[85%] self-start mt-2 min-h-[64px] justify-end opacity-90">
              {isListening ? (
                <span className="text-xs font-mono font-bold text-rose-400 mb-1 ml-1 animate-pulse flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-ping"></span>
                  <span>Capturing Operatory Audio (en-AU)...</span>
                </span>
              ) : (
                <>
                  <span className="text-xs font-mono font-bold text-slate-500 mb-1 ml-1">
                    Mic Standby...
                  </span>
                  <div className="bg-[#0E1724] p-3 rounded-xl rounded-tl-none border border-[#1E3048]">
                    <div className="flex items-center gap-1.5 px-1 py-0.5">
                      <div className="w-2 h-2 bg-slate-600 rounded-full animate-bounce"></div>
                      <div
                        className="w-2 h-2 bg-slate-600 rounded-full animate-bounce"
                        style={{ animationDelay: '0.2s' }}
                      ></div>
                      <div
                        className="w-2 h-2 bg-slate-600 rounded-full animate-bounce"
                        style={{ animationDelay: '0.4s' }}
                      ></div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          <div ref={transcriptEndRef} />
        </div>
      </main>

      {/* Floating Speech Board (Mic + Simulation controls) */}
      {isRecording && (
        <div id="speech-simulation-board" className="fixed bottom-36 left-0 w-full px-4 z-40 pointer-events-none">
          <div className="max-w-2xl mx-auto bg-[#0A1018]/95 backdrop-blur-md border border-[#1E3048] rounded-2xl p-4 shadow-2xl flex flex-col gap-4 pointer-events-auto">
            
            {/* Top row: Section title & encryption flag */}
            <div className="flex items-center justify-between text-xs text-slate-400 font-mono font-bold uppercase tracking-wider border-b border-[#1E3048] pb-2">
              <span className="flex items-center gap-1.5 text-cyan-400">
                <Mic className="w-4 h-4" />
                <span>Active Operatory Capture</span>
              </span>
              <span className="text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/60 font-semibold text-[10px]">
                Secure &amp; Encrypted
              </span>
            </div>

            {/* Split layout: Left (Microphone controls) / Right (Simulator controls) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              
              {/* Left Column: Live Audio Transcription */}
              <div className="flex flex-col gap-2.5">
                <span className="font-mono text-[10px] text-slate-400 font-bold uppercase tracking-wide">Live Microphone</span>
                
                {recognitionError && (
                  <div className="text-xs bg-rose-950/40 text-rose-300 p-2 rounded-lg border border-rose-500/40 flex items-start gap-1">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span>{recognitionError}</span>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  {/* Microphone Toggle Button */}
                  <button
                    type="button"
                    onClick={toggleSpeechRecognition}
                    className={`w-12 h-12 rounded-xl flex items-center justify-center border transition-all cursor-pointer shadow-sm relative ${
                      isListening
                        ? 'bg-rose-950/60 border-rose-500/70 text-rose-400 shadow-[0_0_16px_rgba(244,63,94,0.3)]'
                        : 'bg-[#0E1724] border-[#1E3048] text-slate-400 hover:text-white hover:bg-[#152338]'
                    }`}
                    title={isListening ? "Stop voice recording" : "Start voice recording"}
                  >
                    {isListening ? (
                      <>
                        <Mic className="w-5 h-5 text-rose-400 animate-pulse" />
                        <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-rose-500"></span>
                        </span>
                      </>
                    ) : (
                      <MicOff className="w-5 h-5" />
                    )}
                  </button>

                  {/* Speaker Status Info */}
                  <div className="flex-grow flex flex-col gap-1">
                    <span className="font-mono text-[10px] text-slate-500 font-bold uppercase tracking-wide">Audio Engine:</span>
                    <span className="text-xs font-semibold flex items-center gap-1.5 mt-0.5">
                      {isListening ? (
                        <>
                          <span className="w-2 h-2 bg-rose-500 rounded-full animate-ping"></span>
                          <span className="text-rose-400 font-mono text-[11px]">Streaming operatory voice...</span>
                        </>
                      ) : (
                        <>
                          <span className="w-2 h-2 bg-slate-600 rounded-full"></span>
                          <span className="text-slate-400 font-mono text-[11px]">Microphone on standby</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>

                {/* VocalBridge Active Noise Cancellation / Filter toggle */}
                <div className="flex items-center justify-between mt-1 pt-1.5 border-t border-[#1E3048]">
                  <span className="font-mono text-[9px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-cyan-400" />
                    <span>VocalBridge DSP Filter</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setVocalBridgeActive(prev => !prev)}
                    className={`px-2.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wide transition-all border cursor-pointer ${
                      vocalBridgeActive
                        ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300 shadow-sm'
                        : 'bg-[#0E1724] border-[#1E3048] text-slate-400'
                    }`}
                  >
                    {vocalBridgeActive ? 'ACTIVE (120Hz-4.2kHz Bandpass)' : 'RAW PASS'}
                  </button>
                </div>

                {/* Web Audio API Waveform Visualizer Canvas */}
                <div className="bg-[#0A1018] rounded-xl overflow-hidden border border-[#1E3048] h-10 relative flex items-center justify-center">
                  <canvas
                    ref={canvasRef}
                    width={300}
                    height={40}
                    className="w-full h-full block"
                  />
                  {!isListening && (
                    <span className="absolute text-[8px] font-mono text-slate-600 font-bold uppercase tracking-widest pointer-events-none">
                      Microphone Suspended
                    </span>
                  )}
                  {isListening && (
                    <span className={`absolute top-1 left-1 px-1.5 py-0.5 rounded text-[7px] font-mono font-bold tracking-wider uppercase leading-none shadow-sm ${
                      vocalBridgeActive ? 'bg-cyan-950 border border-cyan-700 text-cyan-300' : 'bg-indigo-950 border border-indigo-700 text-indigo-300'
                    }`}>
                      {vocalBridgeActive ? 'Filtered Operatory Feed' : 'Raw Input'}
                    </span>
                  )}
                </div>
              </div>

              {/* Right Column: Preset / Simulation Shortcuts */}
              <div className="flex flex-col gap-2.5 border-t md:border-t-0 md:border-l border-[#1E3048] pt-3 md:pt-0 md:pl-4">
                <span className="font-mono text-[10px] text-slate-400 font-bold uppercase tracking-wide">Simulation Presets</span>
                
                <div className="flex flex-col gap-2">
                  {nextPresetIndex < presetPhrases.length ? (
                    <button
                      type="button"
                      onClick={triggerNextPreset}
                      className="w-full px-3 py-2 bg-[#0E1724] border border-[#1E3048] hover:bg-[#152338] text-cyan-300 font-bold text-xs rounded-xl transition-all flex items-center justify-between gap-1.5 cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <Sparkles className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
                        <span className="truncate text-slate-200">Say: "{presetPhrases[nextPresetIndex].sender}: {presetPhrases[nextPresetIndex].text.substring(0, 25)}..."</span>
                      </div>
                      <span className="bg-[#0A1018] border border-cyan-800/80 px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase text-cyan-400">Add</span>
                    </button>
                  ) : (
                    <div className="text-[10px] font-mono text-slate-500 italic py-1">Simulation presets completed.</div>
                  )}
                </div>

                {/* Sample audio transcripts */}
                <div className="flex flex-col gap-1.5 pt-2 border-t border-[#1E3048]">
                  <span className="font-mono text-[10px] text-slate-400 font-bold uppercase tracking-wide">Load Full Sample Audio</span>
                  <div className="flex gap-1.5">
                    <select
                      value={sampleType}
                      onChange={(e) => setSampleType(e.target.value as AppointmentType)}
                      className="flex-1 min-w-0 h-8 px-2 bg-[#0E1724] border border-[#1E3048] rounded-lg text-[11px] font-semibold text-slate-200 focus:ring-1 focus:ring-cyan-400 focus:border-cyan-400 outline-none transition-all cursor-pointer"
                    >
                      {SAMPLE_TRANSCRIPTS.map((s) => (
                        <option key={s.appointmentType} value={s.appointmentType} className="bg-[#0A1018] text-slate-200">
                          {s.title} — {s.patient}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => loadSampleTranscript(sampleType)}
                      className="shrink-0 px-3 h-8 bg-cyan-950/60 border border-cyan-800 hover:bg-cyan-900/60 text-cyan-300 font-mono font-bold text-[10px] uppercase tracking-wide rounded-lg transition-all active:scale-95 cursor-pointer"
                    >
                      Load
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Manual Commentary (Full Width) */}
            <div className="border-t border-[#1E3048] pt-3 mt-1 flex flex-col gap-2">
              <span className="font-mono text-[10px] text-slate-400 font-bold uppercase tracking-wide">Manual Operatory Findings</span>
              <form onSubmit={handleSendCustom} className="flex gap-2">
                <div className="flex-grow relative">
                  <input
                    type="text"
                    placeholder="Type clinical observation (e.g. Tooth 16 percussion positive, mesial decay)..."
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    className="w-full h-10 bg-[#0E1724] border border-[#1E3048] rounded-xl px-4 pr-10 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30 outline-none"
                  />
                  <button
                    type="submit"
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-cyan-400 hover:text-cyan-300 transition-all font-bold cursor-pointer"
                  >
                    <CornerDownLeft className="w-4 h-4" />
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Persistent Bottom Recording Toolbar */}
      <footer className="fixed bottom-0 left-0 w-full h-32 bg-[#0A1018]/95 backdrop-blur-md border-t border-[#1E3048] flex flex-col items-center justify-center px-4 pb-safe z-30">
        <div className="flex items-center justify-between w-full max-w-2xl">
          {/* Recording Status indicator badge containing clock */}
          <div className="bg-[#070B11] border border-[#1E3048] text-white px-5 py-2.5 rounded-2xl flex items-center gap-3.5 shadow-lg">
            <div
              className={`w-3 h-3 bg-rose-500 rounded-full ${
                isRecording ? 'animate-ping duration-1000' : ''
              }`}
            ></div>
            <span className="font-mono text-lg font-bold tracking-widest text-cyan-400">
              {formatTime(seconds)}
            </span>
          </div>

          {/* Core Navigation triggers */}
          <div className="flex items-center gap-3">
            {/* Reset button */}
            <button
              onClick={() => setShowResetConfirm(true)}
              className="w-12 h-12 rounded-xl border border-[#1E3048] bg-[#0E1724] flex items-center justify-center hover:bg-rose-950/30 text-slate-400 hover:text-rose-400 hover:border-rose-500/40 transition-colors cursor-pointer active:scale-95"
              title="Reset Session"
            >
              <RotateCcw className="w-5 h-5" />
            </button>

            {/* Play-Pause triggers */}
            <button
              onClick={() => setIsRecording(!isRecording)}
              className="w-12 h-12 rounded-xl border border-[#1E3048] bg-[#0E1724] flex items-center justify-center hover:bg-[#152338] text-slate-200 hover:text-white transition-colors cursor-pointer active:scale-95"
            >
              {isRecording ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5 fill-slate-200" />
              )}
            </button>

            {/* Finish notes trigger */}
            <button
              onClick={handleFinishNote}
              disabled={transcript.length === 0}
              className={`px-7 h-12 rounded-xl font-mono font-bold text-xs uppercase tracking-wider flex items-center gap-2 shadow-lg transition-all cursor-pointer ${
                transcript.length === 0
                  ? 'bg-[#121E2E] text-slate-600 border border-[#1E3048] cursor-not-allowed shadow-none'
                  : 'bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 shadow-[0_0_20px_rgba(34,211,238,0.35)] active:scale-95'
              }`}
              title={transcript.length === 0 ? "Record or type dialogue first" : "Generate clinical notes"}
            >
              <span>Finish Note</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Decorative subtle visual safe-indicator bar */}
        <div className="w-32 h-1 bg-[#1E3048] rounded-full mt-3"></div>
      </footer>

      {/* Fully Immersive AI Analysis Transcribing State Interstitial */}
      <AnimatePresence>
        {isProcessing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#070B11]/98 backdrop-blur-xl text-white p-6"
          >
            <div className="flex flex-col items-center max-w-sm text-center">
              {/* Active Elapsed Seconds Counter Badge */}
              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#0E1724] border border-[#1E3048] text-cyan-300 text-xs font-mono font-bold mb-6">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                <span>Elapsed: {formatTime(processingSeconds)}</span>
              </div>

              {/* Spinning sparkling indicator orb */}
              <div className="relative mb-6">
                <div className="w-20 h-20 rounded-full bg-cyan-500/10 border border-cyan-400 flex items-center justify-center animate-spin duration-[3000s] shadow-[0_0_30px_rgba(34,211,238,0.25)]">
                  <Sparkles className="w-10 h-10 text-cyan-400" />
                </div>
                {/* Outward gradient pulse wave */}
                <div className="absolute inset-0 rounded-full border border-cyan-500/40 animate-ping opacity-20"></div>
              </div>

              <h3 className="text-2xl font-bold tracking-tight mb-2 text-white">
                Compiling Clinical Record
              </h3>
              <p className="text-slate-400 text-xs mb-4 leading-relaxed">
                DentAI is synthesizing tooth charts, periodontal measurements, and restorative requirements.
              </p>

              {/* Dynamic Status bar loading pulse bar */}
              <div className="w-64 bg-[#121E2E] h-1.5 rounded-full overflow-hidden mb-3 border border-[#1E3048]">
                <div className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 animate-pulse w-full shadow-[0_0_8px_rgba(34,211,238,0.6)]"></div>
              </div>

              {/* Live job status & stage description */}
              <div
                key={processingHint || getProcessingStageDescription(processingSeconds, processingState)}
                className="text-xs font-mono text-cyan-300 tracking-wide animate-fade-in max-w-xs leading-relaxed"
              >
                {processingHint || getProcessingStageDescription(processingSeconds, processingState)}
              </div>

              {/* Proactive Zero-Wait Instant Offline Fallback */}
              {(processingSeconds >= 8 || Boolean(processingHint)) && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full max-w-sm mt-5 p-3.5 rounded-2xl bg-amber-950/40 border border-amber-500/40 text-amber-200 flex flex-col items-center gap-2 text-center"
                >
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                    <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
                    <span>{processingHint ? 'Cloud AI High Load / Rate-Limited' : 'Cloud AI Responding Slower Than Usual'}</span>
                  </div>
                  <p className="text-[11px] text-amber-200/80 leading-relaxed">
                    Don't lose chair time waiting. Generate a complete clinical note immediately from your spoken dialogue.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      stopProcessingTicker();
                      handleDraftOffline();
                    }}
                    className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-amber-400 to-emerald-400 hover:from-amber-300 hover:to-emerald-300 text-slate-950 font-extrabold text-xs flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer active:scale-95"
                  >
                    <Check className="w-4 h-4 text-slate-950 stroke-[3]" />
                    <span>Generate Instant Offline Note (0s Wait)</span>
                  </button>
                </motion.div>
              )}

              {/* Cancel Button */}
              <button
                type="button"
                onClick={stopProcessingTicker}
                className="mt-4 text-xs font-mono text-slate-400 hover:text-white underline cursor-pointer transition-colors"
              >
                Cancel & Return to Dialogue
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Ambient "Smart Scribe" Screen Overlay */}
      <AnimatePresence>
        {isAmbientMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[60] bg-gradient-to-b from-[#070B11] to-[#0A1018] text-white flex flex-col justify-between p-6 select-none"
          >
            <div className="w-full max-w-2xl h-full flex flex-col justify-between mx-auto">
            {/* Header */}
            <div className="relative z-50 flex items-center justify-between h-16 border-b border-[#1E3048]">
              <div className="flex flex-col">
                <span className="text-[10px] text-cyan-400 font-mono font-bold uppercase tracking-widest leading-none">Operatory Scribe</span>
                <span className="text-sm font-bold text-white mt-1">{patientName}</span>
              </div>
              <button
                onClick={() => setIsAmbientMode(false)}
                className="px-3.5 h-8.5 rounded-xl border border-[#1E3048] hover:border-cyan-500/50 bg-[#0E1724] hover:bg-[#152338] font-mono font-bold text-[9px] uppercase tracking-wider text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                Exit Ambient Mode
              </button>
            </div>

            {/* Center visualizer orb */}
            <div 
              onClick={() => setIsRecording(!isRecording)}
              className="flex-grow flex flex-col items-center justify-center gap-6 cursor-pointer relative z-10 group"
              title={isRecording ? "Click to Pause" : "Click to Resume"}
            >
              {/* Pulsing Audio Orb */}
              <div className="relative flex items-center justify-center">
                {isRecording && (
                  <>
                    <motion.div
                      animate={{ scale: [1, 1.3, 1] }}
                      transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                      className="absolute w-48 h-48 rounded-full bg-cyan-500/10 blur-xl"
                    />
                    <motion.div
                      animate={{ scale: [1, 1.15, 1] }}
                      transition={{ repeat: Infinity, duration: 2, ease: "easeInOut", delay: 0.5 }}
                      className="absolute w-36 h-36 rounded-full bg-cyan-400/15 blur-lg"
                    />
                  </>
                )}
                {/* Core Orb circle */}
                <div className={`w-28 h-28 rounded-full flex items-center justify-center transition-all duration-500 shadow-2xl border ${
                  isRecording
                    ? 'bg-gradient-to-br from-cyan-600 to-blue-700 border-cyan-400/60 shadow-[0_0_30px_rgba(34,211,238,0.3)] scale-105'
                    : 'bg-[#0E1724] border-[#1E3048] hover:border-slate-600 scale-100'
                }`}>
                  <Mic className={`w-10 h-10 transition-colors duration-500 ${
                    isRecording ? 'text-white' : 'text-slate-500'
                  }`} />
                </div>
              </div>

              {/* Scribing indicator */}
              <div className="flex flex-col items-center">
                <div className="flex items-center gap-2">
                  {isRecording ? (
                    <>
                      <span className="w-2 h-2 bg-emerald-400 rounded-full animate-ping"></span>
                      <span className="text-emerald-400 font-bold text-xs uppercase tracking-widest font-mono">Scribe Active</span>
                    </>
                  ) : (
                    <>
                      <span className="w-2 h-2 bg-slate-600 rounded-full"></span>
                      <span className="text-slate-400 font-bold text-xs uppercase tracking-widest font-mono">Scribe Paused</span>
                    </>
                  )}
                </div>
                <span className="text-[10px] text-slate-500 font-mono mt-2">Tap orb to {isRecording ? 'pause' : 'resume'}</span>
              </div>

              {/* Tactile Quick Tag Cards */}
              <div className="w-full max-w-sm px-4 flex flex-col gap-2 z-30">
                <span className="text-[9px] text-slate-500 font-mono font-bold uppercase tracking-widest text-center mb-0.5">
                  Tactile Quick Tags
                </span>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTactileTag('Note: Checked, overall state stable.');
                    }}
                    className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 hover:bg-emerald-950/50 active:scale-[0.96] duration-150 transition-all text-center cursor-pointer"
                  >
                    <svg className="w-4.5 h-4.5 text-emerald-400 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <span className="text-[9px] font-bold text-emerald-300">Stable</span>
                    <span className="text-[8px] text-emerald-400/60 mt-0.5 leading-none">No Pathology</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTactileTag('Note: Flagged potential active pathology.');
                    }}
                    className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-amber-950/30 border border-amber-500/30 hover:bg-amber-950/50 active:scale-[0.96] duration-150 transition-all text-center cursor-pointer"
                  >
                    <svg className="w-4.5 h-4.5 text-amber-400 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span className="text-[9px] font-bold text-amber-300">Pathology</span>
                    <span className="text-[8px] text-amber-400/60 mt-0.5 leading-none">Alert Flag</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTactileTag('Note: Bookmarked section for manual review.');
                    }}
                    className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-cyan-950/30 border border-cyan-500/30 hover:bg-cyan-950/50 active:scale-[0.96] duration-150 transition-all text-center cursor-pointer"
                  >
                    <svg className="w-4.5 h-4.5 text-cyan-400 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                    <span className="text-[9px] font-bold text-cyan-300">Bookmark</span>
                    <span className="text-[8px] text-cyan-400/60 mt-0.5 leading-none">Manual Rev</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Footer with Timer and Quick Controls */}
            <div className="relative z-50 flex items-center justify-between border-t border-[#1E3048] pt-6 pb-4">
              {/* Digital Clock */}
              <div className="bg-[#070B11] border border-[#1E3048] px-6 py-2.5 rounded-2xl flex items-center gap-3.5 shadow-xl">
                <div className={`w-2.5 h-2.5 bg-rose-500 rounded-full ${isRecording ? 'animate-ping' : ''}`}></div>
                <span className="font-mono text-2xl font-bold tracking-widest text-cyan-400">{formatTime(seconds)}</span>
              </div>

              {/* Quick Controls */}
              <div className="flex items-center gap-3.5">
                <button
                  onClick={() => setShowResetConfirm(true)}
                  className="w-12 h-12 rounded-xl border border-[#1E3048] hover:border-rose-500/50 bg-[#0E1724] hover:bg-rose-950/30 flex items-center justify-center transition-colors cursor-pointer text-slate-400 hover:text-rose-400"
                  title="Reset Recording"
                >
                  <RotateCcw className="w-5 h-5" />
                </button>
                <button
                  onClick={handleFinishNote}
                  disabled={transcript.length === 0}
                  className={`px-7 h-12 rounded-xl font-mono font-bold text-xs uppercase tracking-wider flex items-center gap-2 shadow-lg transition-all cursor-pointer ${
                    transcript.length === 0
                      ? 'bg-[#121E2E] text-slate-600 border border-[#1E3048] cursor-not-allowed shadow-none'
                      : 'bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 active:scale-95 shadow-[0_0_20px_rgba(34,211,238,0.35)]'
                  }`}
                >
                  <span>Finish Note</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal for Resetting */}
      <AnimatePresence>
        {showResetConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-[#070B11]/80 backdrop-blur-sm px-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="bg-[#0A1018] rounded-2xl p-6 flex flex-col items-center text-center max-w-sm w-full mx-auto shadow-2xl border border-[#1E3048]"
            >
              <div className="w-12 h-12 bg-rose-950/50 border border-rose-500/40 rounded-xl flex items-center justify-center mb-4 text-rose-400">
                <RotateCcw className="w-6 h-6 animate-spin duration-[1.5s]" style={{ animationIterationCount: 1 }} />
              </div>
              <h3 className="text-lg font-bold text-white mb-1.5">
                Reset Recording Session?
              </h3>
              <p className="text-slate-400 text-xs mb-6 leading-relaxed">
                This will permanently erase all transcribed conversation and clinical comments for this session. This action cannot be undone.
              </p>
              <div className="flex gap-3 w-full">
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(false)}
                  className="flex-1 border border-[#1E3048] bg-[#0E1724] hover:bg-[#152338] text-slate-300 font-mono font-bold h-11 rounded-xl transition-all cursor-pointer text-xs uppercase"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleResetSession}
                  className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-mono font-bold h-11 rounded-xl transition-all cursor-pointer text-xs uppercase shadow-[0_0_15px_rgba(244,63,94,0.3)]"
                >
                  Reset Session
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* High-Priority Universal Error & Instant Fallback Modal */}
      <AnimatePresence>
        {errorMsg && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-[#070B11]/85 backdrop-blur-sm px-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-[#0A1018] rounded-2xl p-6 flex flex-col items-center text-center max-w-md w-full mx-auto shadow-2xl border border-[#1E3048] text-slate-100"
            >
              <div className="w-12 h-12 rounded-xl bg-rose-950/60 border border-rose-500/50 text-rose-400 flex items-center justify-center mb-3.5 shadow-sm">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-white mb-1">
                Note Generation Delay / Status Alert
              </h3>
              <p className="text-xs text-slate-300 mb-3.5 leading-relaxed">
                {errorMsg}
              </p>
              <div className="w-full p-3.5 bg-emerald-950/40 border border-emerald-500/40 rounded-xl mb-4 text-left">
                <div className="flex items-center gap-2 text-emerald-300 font-mono font-bold text-xs mb-1">
                  <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span>Transcript 100% Preserved</span>
                </div>
                <p className="text-[11px] text-emerald-200/90 leading-relaxed">
                  No consultation data was lost. You can instantly generate a complete, structured clinical record offline right now.
                </p>
              </div>
              <div className="flex flex-col gap-2 w-full">
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null);
                    handleDraftOffline();
                  }}
                  className="w-full h-11 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-mono font-bold text-xs uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(52,211,153,0.3)] transition-all active:scale-95 cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Generate Note Offline Instantly (0s Wait)</span>
                </button>
                <div className="flex gap-2 w-full">
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      handleFinishNote();
                    }}
                    className="flex-1 h-9 bg-[#0E1724] border border-[#1E3048] hover:bg-[#152338] text-slate-200 font-mono font-bold text-xs rounded-lg transition-all cursor-pointer"
                  >
                    Retry Hosted AI
                  </button>
                  <button
                    type="button"
                    onClick={() => setErrorMsg(null)}
                    className="flex-1 h-9 border border-[#1E3048] hover:bg-[#152338] text-slate-400 hover:text-white font-mono font-bold text-xs rounded-lg transition-all cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Operatory Phone Beacon Pairing & Remote Control Modal */}
      <ChairBeaconModal
        isOpen={showBeaconModal}
        onClose={() => setShowBeaconModal(false)}
        roomName="Operatory Chair 1"
        clinicId={activeClinicId || undefined}
        onStartRecordingFromDesktop={() => setIsRecording(true)}
        onStopRecordingFromDesktop={() => setIsRecording(false)}
        isRecordingActive={isRecording}
      />
    </div>
  );
}
