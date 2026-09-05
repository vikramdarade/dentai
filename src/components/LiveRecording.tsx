import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, UserRound, Pause, Play, ArrowRight, Sparkles, ArrowUpDown, CornerDownLeft, AlertCircle, X, Mic, MicOff, RotateCcw, RefreshCw, WifiOff, Bot } from 'lucide-react';
import { TranscriptItem, GeneratedNotePayload } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { AppointmentType, getTemplateById, getAppointmentTypeLabel } from '../lib/dentalLibrary';
import { SAMPLE_TRANSCRIPTS, getSampleForType } from '../lib/sampleTranscripts';
import { generateOfflineDraft } from '../lib/draftEngine';
import { generateWithOnDeviceModel, type OnDeviceResult } from '../lib/onDeviceModel';
import { normalizedToPayload } from '../lib/normalizeNoteOutput';

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
  const animationFrameIdRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Draw flat line on visualizer canvas
  const drawFlatLine = () => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) return;

    canvasCtx.fillStyle = '#faf9f7';
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
    canvasCtx.lineWidth = 2.5;
    canvasCtx.strokeStyle = '#cbd5e1'; // light slate line
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

      canvasCtx.fillStyle = '#faf9f7';
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

      canvasCtx.lineWidth = 2.5;
      // Blue/cyan if VocalBridge active, purple if off
      canvasCtx.strokeStyle = vocalBridgeActive ? '#004ac6' : '#8b5cf6';
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

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const source = audioContextRef.current.createMediaStreamSource(stream);
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      if (vocalBridgeActive) {
        // High-pass filter to block low frequency hums (<150Hz)
        const hpFilter = audioContextRef.current.createBiquadFilter();
        hpFilter.type = 'highpass';
        hpFilter.frequency.value = 150;

        // Low-pass filter to block high frequency drill shrieks (>3400Hz)
        const lpFilter = audioContextRef.current.createBiquadFilter();
        lpFilter.type = 'lowpass';
        lpFilter.frequency.value = 3400;

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

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.suspend();
      } catch (e) {}
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
        console.error('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
          setRecognitionError('Microphone permission blocked. Please check browser settings.');
        } else {
          setRecognitionError(`Speech recognition error: ${event.error}`);
        }
        setIsListening(false);
        stopAudioPipeline();
      };

      rec.onend = () => {
        setIsListening(false);
        stopAudioPipeline();
        // The Web Speech API ends recognition sessions on its own (silence or length
        // limits). Auto-restart while the session is still recording, unless the user
        // explicitly stopped the microphone or the mic keeps dying immediately.
        if (isRecordingRef.current && !micStoppedByUserRef.current) {
          const sessionMs = Date.now() - lastSessionStartRef.current;
          if (sessionMs < RESTART_MIN_SESSION_MS) {
            unstableRestartsRef.current += 1;
          } else {
            unstableRestartsRef.current = 0;
          }
          if (unstableRestartsRef.current >= MAX_UNSTABLE_RESTARTS) {
            unstableRestartsRef.current = 0;
            setRecognitionError('Microphone keeps disconnecting. Check your connection and tap the microphone button to retry.');
          } else {
            setTimeout(() => {
              try {
                rec.start();
              } catch (e) {
                console.warn('Failed to auto-restart speech recognition:', e);
              }
            }, 250);
          }
        }
      };

      rec.onresult = (event: any) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const result = event.results[i];
          if (result.isFinal) {
            const text = result[0].transcript.trim();
            if (text) {
              setTranscript((prev) => [...prev, { sender: 'Dialogue', text }]);
              setItemTimes((prev) => [...prev, secondsRef.current]);
            }
          } else {
            interim += result[0].transcript;
          }
        }
        setInterimTranscript(interim);
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

  // Time counting effect
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isRecording) {
      interval = setInterval(() => {
        setSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording]);

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
    setTranscript((prev) => [...prev, { sender, text }]);
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
  const processingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Only claim AI detection when clinical terminology is actually present in the transcript.
  const hasClinicalTerms = transcript.some((t) =>
    /(percussion|sensitivity|pulp|decay|caries|bleeding|mobility|root canal|filling|tooth\s*\d{1,2})/i.test(t.text)
  );

  const stopProcessingTicker = () => {
    if (processingIntervalRef.current) {
      clearInterval(processingIntervalRef.current);
      processingIntervalRef.current = null;
    }
    setIsProcessing(false);
  };

  const startProcessingTicker = (states: string[]) => {
    setIsRecording(false);
    setIsProcessing(true);
    setErrorMsg(null);
    let current = 0;
    setProcessingState(states[0]);
    processingIntervalRef.current = setInterval(() => {
      current++;
      if (current < states.length) {
        setProcessingState(states[current]);
      }
    }, 1300);
  };

  // Tier 1 — hosted AI (Gemini primary + secondary key failover on the server).
  const handleFinishNote = async () => {
    startProcessingTicker([
      'Transcribed live voice feed...',
      'Running AI clinical extractor model (secure)...',
      'Synthesizing clinical findings & tooth map...',
      'Extracting ADA billing item codes...',
      'Drafting friendly patient-narrative care letter...',
      'Notes complete! Opening health communication hub...'
    ]);

    try {
      await onFinish(transcript);
      stopProcessingTicker();
    } catch (err: any) {
      stopProcessingTicker();
      setErrorMsg(err.message || 'Failed to generate clinical notes. Please verify connection and try again.');
    }
  };

  // Tier 3a — rule-based offline draft (works with no network / no GPU).
  const handleDraftOffline = async () => {
    startProcessingTicker([
      'Preparing a secure offline draft...',
      'Matching the transcript to the treatment template...',
      'Filling note sections only from what was said...',
      'Offline draft complete — verify before saving!'
    ]);

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
    startProcessingTicker([
      'Starting the on-device model (WebGPU)...',
      'Downloading/loading the local model — first use ~1 GB...',
      'Generating the clinical note on this device...',
      'Notes drafted on-device — verify before saving!'
    ]);

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
    <div id="live-recording-container" className="h-screen w-full flex flex-col bg-[#F8F7F5] overflow-hidden text-on-surface">
      {/* Top App Bar */}
      <header className="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-4 h-16 bg-white border-b border-outline-variant">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1 rounded-full hover:bg-slate-100 transition-all cursor-pointer"
          >
            <ArrowLeft className="text-primary w-6 h-6" />
          </button>
          <div className="flex flex-col">
            <h1 className="font-headline-sm text-base md:text-lg font-bold text-on-surface leading-tight">
              {patientName}
            </h1>
            <span className="font-label-sm text-[10px] text-indigo-600 font-extrabold uppercase tracking-widest leading-none">
              {getAppointmentTypeLabel(appointmentType)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {clinicUsage && (
            <span
              title={`This clinic has used ${clinicUsage.used} of ${clinicUsage.limit} hosted AI notes today. Offline drafting stays available at any time.`}
              className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-wider shadow-sm ${
                clinicUsage.exceeded
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : clinicUsage.used >= clinicUsage.limit * 0.75
                    ? 'bg-amber-50 border-amber-200 text-amber-700'
                    : 'bg-white border-outline-variant text-slate-500'
              }`}
            >
              <Sparkles className={`w-3.5 h-3.5 ${clinicUsage.exceeded ? 'text-red-500' : 'text-primary'}`} />
              {clinicUsage.used}/{clinicUsage.limit} AI notes today
            </span>
          )}
          <button
            onClick={() => setIsAmbientMode(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-outline-variant bg-white hover:bg-slate-50 text-primary transition-all cursor-pointer mr-2 shadow-sm hover:shadow-md"
          >
            <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Go Ambient</span>
          </button>
          <button className="p-2 rounded-full hover:bg-slate-50 transition-colors text-slate-500 hover:text-primary">
            <UserRound className="w-5 h-5" />
          </button>
          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-primary font-bold text-xs shadow-sm">
            {getInitials(patientName)}
          </div>
        </div>
      </header>

      {/* Main Transcription Stream */}
      <main className="flex-grow pt-20 pb-48 px-4 overflow-y-auto w-full max-w-2xl mx-auto custom-scrollbar flex flex-col gap-4">
        {recognitionError && (
          <div className="w-full bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3.5 rounded-xl flex items-start justify-between shadow-sm animate-fade-in mb-2 font-sans">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex flex-col">
                <span className="font-bold text-xs uppercase tracking-wider text-amber-700">Microphone Status Alert</span>
                <p className="text-xs text-amber-850 mt-0.5 leading-relaxed">{recognitionError}</p>
              </div>
            </div>
            <button onClick={() => setRecognitionError(null)} className="p-1 text-amber-400 hover:text-amber-700 rounded-full transition-colors cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="w-full bg-red-50 border border-red-200 text-red-800 px-4 py-3.5 rounded-xl shadow-sm animate-fade-in mb-2">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="flex flex-col">
                  <span className="font-bold text-xs uppercase tracking-wider text-red-650">
                    {isQuotaFailure(errorMsg) ? 'AI quota reached — hosted AI unavailable' : 'Error Compiling Notes'}
                  </span>
                  <p className="text-xs text-red-700 mt-0.5 leading-relaxed">{errorMsg}</p>
                  {(isQuotaFailure(errorMsg) || /offline|on-device|webgpu|model/i.test(errorMsg)) && (
                    <p className="text-xs text-red-700 mt-2 font-semibold">No clinical record was created and your transcript is preserved. Choose how to continue below.</p>
                  )}
                </div>
              </div>
              <button onClick={() => setErrorMsg(null)} className="p-1 text-red-400 hover:text-red-650 rounded-full transition-colors cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 mt-3">
              <button
                onClick={handleFinishNote}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-red-200 text-red-700 font-bold text-[11px] uppercase tracking-wider hover:bg-red-100/60 transition-all active:scale-95 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry hosted AI
              </button>
              <button
                onClick={handleDraftOffline}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-700 text-white font-bold text-[11px] uppercase tracking-wider hover:bg-red-800 transition-all active:scale-95 cursor-pointer"
              >
                <WifiOff className="w-3.5 h-3.5" /> Draft offline now
              </button>
              <button
                onClick={handleOnDeviceModel}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-red-200 text-slate-700 font-bold text-[11px] uppercase tracking-wider hover:bg-slate-100 transition-all active:scale-95 cursor-pointer"
              >
                <Bot className="w-3.5 h-3.5" /> On-device model
              </button>
            </div>
          </div>
        )}

        {/* Connection Started pill */}
        <div className="flex justify-center my-2">
          <span className="font-label-md text-[11px] font-semibold text-slate-500 bg-white/80 border border-outline-variant/50 px-3 py-1.5 rounded-full shadow-sm">
            {formatClock(sessionStart)} - Clinical Session Started
          </span>
        </div>

        {/* Conversation flow */}
        <div className="flex flex-col gap-4">
          {transcript.length === 0 && (
            <div className="flex flex-col items-center justify-center p-8 bg-white border border-dashed border-slate-300 rounded-2xl text-center text-slate-500 my-4 shadow-sm max-w-md mx-auto w-full">
              <Mic className="w-8 h-8 text-primary mb-3 animate-pulse" />
              <h4 className="font-bold text-sm text-slate-700">Ready to Capture Session</h4>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                Click the microphone button to start recording the live dentist-patient interaction, or type comments manually.
              </p>
              <div className="mt-4 pt-4 border-t border-slate-100 w-full flex flex-col items-center gap-2.5">
                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Test with a sample audio transcript:</span>
                <select
                  value={sampleType}
                  onChange={(e) => setSampleType(e.target.value as AppointmentType)}
                  className="w-full h-9 px-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-all"
                >
                  {SAMPLE_TRANSCRIPTS.map((s) => (
                    <option key={s.appointmentType} value={s.appointmentType}>
                      {s.title} — {s.patient}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => loadSampleTranscript(sampleType)}
                  className="w-full px-4 py-2 bg-indigo-50 border border-indigo-150 hover:bg-indigo-100 text-primary font-bold text-xs rounded-lg transition-all cursor-pointer shadow-sm"
                >
                  Load Sample Audio Transcript
                </button>
                <p className="text-[9px] text-slate-400 leading-relaxed text-left w-full">
                  The note is generated against the template chosen at intake —{' '}
                  {getTemplateById(templateId).name} for {getAppointmentTypeLabel(appointmentType)}.
                  Pick the same treatment type at intake for an exact template match.
                </p>
              </div>
            </div>
          )}

          {transcript.map((item, idx) => {
            const isComment = item.sender === 'Clinical Comment';
            const isLegacyDentist = item.sender === 'Dentist';
            const isLegacyPatient = item.sender === 'Patient';

            let badgeBg = 'bg-slate-100 text-slate-600 border-slate-200';
            let badgeLabel = 'Session Audio';
            if (isComment) {
              badgeBg = 'bg-blue-50 text-blue-700 border-blue-150';
              badgeLabel = 'Clinical Comment';
            } else if (isLegacyDentist) {
              badgeBg = 'bg-indigo-50 text-indigo-700 border-indigo-150';
              badgeLabel = 'Dentist';
            } else if (isLegacyPatient) {
              badgeBg = 'bg-amber-50 text-amber-700 border-amber-150';
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
                <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all flex flex-col gap-2">
                  <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-wider">
                    <span className={`px-2 py-0.5 rounded-full border ${badgeBg}`}>
                      {badgeLabel}
                    </span>
                    <span className="text-slate-400 font-mono">
                      {formatTime(itemTimes[idx] ?? Math.max(0, seconds - Math.max(0, transcript.length - idx) * 3))}
                    </span>
                  </div>
                  <p className="font-transcription-text text-slate-800 leading-relaxed text-[14.5px]">
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
              className="bg-emerald-50/80 border-l-4 border-emerald-600 p-4 my-2 rounded-r-xl shadow-sm flex flex-col gap-1.5"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="text-emerald-700 w-4 h-4" />
                <span className="font-label-md text-emerald-800 font-bold uppercase tracking-wider text-xs">
                  Clinical Terms Detected
                </span>
              </div>
              <p className="font-body-md text-emerald-900 text-sm font-medium leading-relaxed">
                The session transcript contains clinical terminology (e.g. tooth numbers, sensitivity, treatment terms). Confirm the generated note against the conversation before saving.
              </p>
            </motion.div>
          )}

          {/* Interim transcript live preview */}
          {isListening && interimTranscript && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col w-full opacity-85"
            >
              <div className="bg-white border border-dashed border-red-200 rounded-2xl p-4 shadow-inner flex flex-col gap-2">
                <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-wider">
                  <span className="px-2 py-0.5 rounded-full border bg-red-50 text-red-700 border-red-150 animate-pulse flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-red-650 rounded-full animate-ping"></span>
                    <span>Transcribing Voice...</span>
                  </span>
                </div>
                <p className="font-transcription-text text-slate-700 italic leading-relaxed text-[14.5px]">
                  {interimTranscript}
                </p>
              </div>
            </motion.div>
          )}

          {/* Mic status indicator — fixed-height container so recognition restarts swap
              the label without shifting the transcript layout (no more bouncing). */}
          {isRecording && (
            <div className="flex flex-col items-start max-w-[85%] self-start mt-2 min-h-[64px] justify-end opacity-90">
              {isListening ? (
                <span className="text-xs font-bold text-[#e11d48] mb-1 ml-1 animate-pulse flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-[#e11d48] rounded-full"></span>
                  <span>Recording Audio (en-AU mic active)...</span>
                </span>
              ) : (
                <>
                  <span className="text-xs font-bold text-slate-400 mb-1 ml-1">
                    Listening...
                  </span>
                  <div className="bg-slate-100 p-4 rounded-xl rounded-tl-none border border-dashed border-slate-300">
                    <div className="flex items-center gap-1.5 px-1 py-0.5">
                      <div className="w-2.5 h-2.5 bg-slate-400 rounded-full animate-bounce"></div>
                      <div
                        className="w-2.5 h-2.5 bg-slate-400 rounded-full animate-bounce"
                        style={{ animationDelay: '0.2s' }}
                      ></div>
                      <div
                        className="w-2.5 h-2.5 bg-slate-400 rounded-full animate-bounce"
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
        <div id="speech-simulation-board" className="fixed bottom-36 left-0 w-full px-4 z-40">
          <div className="max-w-2xl mx-auto bg-white border border-outline-variant rounded-2xl p-4 shadow-xl flex flex-col gap-4">
            
            {/* Top row: Section title & encryption flag */}
            <div className="flex items-center justify-between text-xs text-slate-500 font-bold uppercase tracking-wider border-b border-slate-100 pb-2">
              <span className="flex items-center gap-1.5 text-primary">
                <Mic className="w-4 h-4" />
                <span>Active Session Capture</span>
              </span>
              <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-250 font-semibold text-[10px]">Secure &amp; Confidential</span>
            </div>

            {/* Split layout: Left (Microphone controls) / Right (Simulator controls) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              
              {/* Left Column: Live Audio Transcription */}
              <div className="flex flex-col gap-2.5">
                <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wide">Live Microphone</span>
                
                {recognitionError && (
                  <div className="text-xs bg-red-50 text-red-755 p-2 rounded-lg border border-red-150 flex items-start gap-1">
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
                        ? 'bg-red-55 border-red-200 text-red-650 animate-pulse'
                        : 'bg-slate-50 border-slate-200 text-slate-650 hover:bg-slate-100'
                    }`}
                    title={isListening ? "Stop voice recording" : "Start voice recording"}
                  >
                    {isListening ? (
                      <>
                        <Mic className="w-5 h-5 text-red-600 animate-pulse" />
                        <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-red-500"></span>
                        </span>
                      </>
                    ) : (
                      <MicOff className="w-5 h-5" />
                    )}
                  </button>

                  {/* Speaker Status Info */}
                  <div className="flex-grow flex flex-col gap-1">
                    <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wide">Status:</span>
                    <span className="text-xs text-slate-600 font-semibold flex items-center gap-1.5 mt-1">
                      {isListening ? (
                        <>
                          <span className="w-2 h-2 bg-red-600 rounded-full animate-ping"></span>
                          <span className="text-red-700">Capturing live conversation...</span>
                        </>
                      ) : (
                        <>
                          <span className="w-2 h-2 bg-slate-400 rounded-full"></span>
                          <span>Microphone on standby</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>

                {/* VocalBridge Active Noise Cancellation / Filter toggle */}
                <div className="flex items-center justify-between mt-1 pt-1.5 border-t border-slate-100">
                  <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-primary" />
                    <span>VocalBridge Visualizer Filter</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setVocalBridgeActive(prev => !prev)}
                    className={`px-2.5 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-wide transition-all border cursor-pointer ${
                      vocalBridgeActive
                        ? 'bg-emerald-50 border-emerald-250 text-emerald-700 shadow-sm'
                        : 'bg-slate-50 border-slate-200 text-slate-650'
                    }`}
                  >
                    {vocalBridgeActive ? 'ACTIVE (150Hz - 3.4kHz)' : 'INACTIVE'}
                  </button>
                </div>

                {/* Web Audio API Waveform Visualizer Canvas */}
                <div className="bg-slate-100 rounded-lg overflow-hidden border border-slate-200 h-10 relative flex items-center justify-center">
                  <canvas
                    ref={canvasRef}
                    width={300}
                    height={40}
                    className="w-full h-full block"
                  />
                  {!isListening && (
                    <span className="absolute text-[8px] text-slate-400 font-extrabold uppercase tracking-widest pointer-events-none">
                      Microphone Suspended
                    </span>
                  )}
                  {isListening && (
                    <span className={`absolute top-1 left-1 px-1.5 py-0.5 rounded text-[7px] font-extrabold tracking-wider uppercase leading-none shadow-sm ${
                      vocalBridgeActive ? 'bg-blue-600 text-white animate-pulse' : 'bg-purple-600 text-white'
                    }`}>
                      {vocalBridgeActive ? 'Filtered Audio Preview' : 'Raw Audio Feed'}
                    </span>
                  )}
                </div>
                
                {isListening && (
                  <span className="text-[10px] text-red-650 font-bold animate-pulse flex items-center gap-1 mt-0.5">
                    <span className="w-1.5 h-1.5 bg-red-600 rounded-full"></span>
                    <span>Microphone is listening (en-AU)...</span>
                  </span>
                )}
              </div>

              {/* Right Column: Preset / Simulation Shortcuts */}
              <div className="flex flex-col gap-2.5 border-t md:border-t-0 md:border-l border-slate-150 pt-3 md:pt-0 md:pl-4">
                <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wide">Simulation Presets</span>
                
                <div className="flex flex-col gap-2">
                  {nextPresetIndex < presetPhrases.length ? (
                    <button
                      type="button"
                      onClick={triggerNextPreset}
                      className="w-full px-3 py-2 bg-indigo-50 border border-indigo-100 hover:bg-[#efecff] text-primary font-bold text-xs rounded-lg transition-all flex items-center justify-between gap-1.5 cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">Say: "{presetPhrases[nextPresetIndex].sender}: {presetPhrases[nextPresetIndex].text.substring(0, 25)}..."</span>
                      </div>
                      <span className="bg-white border border-indigo-200 px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase text-indigo-700">Add Preset</span>
                    </button>
                  ) : (
                    <div className="text-[10px] font-semibold text-slate-400 italic py-1">Simulation presets finished — use a sample transcript below, manual text, or the live microphone.</div>
                  )}
                </div>

                {/* Sample audio transcripts — always available while the session is recording */}
                <div className="flex flex-col gap-1.5 pt-2.5 border-t border-slate-150">
                  <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wide">Or Load a Sample Audio Transcript</span>
                  <div className="flex gap-1.5">
                    <select
                      value={sampleType}
                      onChange={(e) => setSampleType(e.target.value as AppointmentType)}
                      className="flex-1 min-w-0 h-8 px-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-semibold text-slate-700 focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-all"
                    >
                      {SAMPLE_TRANSCRIPTS.map((s) => (
                        <option key={s.appointmentType} value={s.appointmentType}>
                          {s.title} — {s.patient}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => loadSampleTranscript(sampleType)}
                      className="shrink-0 px-3 h-8 bg-indigo-50 border border-indigo-150 hover:bg-indigo-100 text-primary font-bold text-[10px] uppercase tracking-wide rounded-lg transition-all active:scale-95 cursor-pointer"
                    >
                      Load Sample
                    </button>
                  </div>
                  <p className="text-[9px] text-slate-400 leading-snug">
                    Fills the session with a realistic consultation for that treatment type. The note is drafted against the
                    template chosen at intake ({getTemplateById(templateId).name}) — pick the matching treatment type there
                    for an exact template test.
                  </p>
                </div>
              </div>
            </div>

            {/* Manual Commentary (Full Width) */}
            <div className="border-t border-slate-100 pt-3 mt-1 flex flex-col gap-2">
              <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wide">Or Type Manual Clinical Comments</span>
              <form onSubmit={handleSendCustom} className="flex gap-2">
                <div className="flex-grow relative">
                  <input
                    type="text"
                    placeholder="Type a clinical comment and press Enter (e.g. Tooth 16 percussion positive)..."
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    className="w-full h-10 bg-slate-50 border border-slate-200 rounded-xl px-4 pr-10 text-xs focus:ring-1 focus:ring-primary focus:border-primary outline-none text-on-surface"
                  />
                  <button
                    type="submit"
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-primary hover:text-[#004ac6] transition-all font-bold cursor-pointer"
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
      <footer className="fixed bottom-0 left-0 w-full h-32 bg-white/90 backdrop-blur-md border-t border-outline-variant flex flex-col items-center justify-center px-4 pb-safe z-30">
        <div className="flex items-center justify-between w-full max-w-2xl">
          {/* Recording Status indicator badge containing clock */}
          <div className="bg-[#1a1a2e] text-white px-5 py-3 rounded-full flex items-center gap-3.5 shadow-lg">
            <div
              className={`w-3 h-3 bg-red-600 rounded-full ${
                isRecording ? 'animate-ping duration-1000' : ''
              }`}
            ></div>
            <span className="font-mono text-lg font-extrabold tracking-widest">
              {formatTime(seconds)}
            </span>
          </div>

          {/* Core Navigation triggers */}
          <div className="flex items-center gap-3">
            {/* Reset button */}
            <button
              onClick={() => setShowResetConfirm(true)}
              className="w-12 h-12 rounded-full border border-outline-variant flex items-center justify-center hover:bg-red-50 text-slate-650 hover:text-red-700 transition-colors cursor-pointer active:scale-95"
              title="Reset Session"
            >
              <RotateCcw className="w-5 h-5" />
            </button>

            {/* Play-Pause triggers */}
            <button
              onClick={() => setIsRecording(!isRecording)}
              className="w-12 h-12 rounded-full border border-outline-variant flex items-center justify-center hover:bg-slate-50 transition-colors cursor-pointer active:scale-95"
            >
              {isRecording ? (
                <Pause className="text-slate-800 w-5 h-5" />
              ) : (
                <Play className="text-slate-800 w-5 h-5 fill-slate-800" />
              )}
            </button>

            {/* Finish notes trigger */}
            <button
              onClick={handleFinishNote}
              disabled={transcript.length === 0}
              className={`px-7 h-12 rounded-full font-bold text-xs uppercase tracking-widest flex items-center gap-2 shadow-lg transition-all cursor-pointer ${
                transcript.length === 0
                  ? 'bg-slate-200 text-slate-400 border border-slate-300 cursor-not-allowed shadow-none active:scale-100'
                  : 'bg-primary-container hover:bg-opacity-95 text-white active:scale-95'
              }`}
              title={transcript.length === 0 ? "Record or type dialogue first" : "Generate clinical notes"}
            >
              <span>Finish Note</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Decorative subtle visual safe-indicator bar */}
        <div className="w-32 h-1 bg-slate-200 rounded-full mt-3"></div>
      </footer>

      {/* Fully Immersive AI Analysis Transcribing State Interstitial */}
      <AnimatePresence>
        {isProcessing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-indigo-950/95 backdrop-blur-md text-white p-6"
          >
            <div className="flex flex-col items-center max-w-sm text-center">
              {/* Spinning sparkling indicator orb */}
              <div className="relative mb-8">
                <div className="w-20 h-20 rounded-full bg-primary-container/20 border border-primary-container flex items-center justify-center animate-spin duration-[3000s]">
                  <Sparkles className="w-10 h-10 text-primary-fixed" />
                </div>
                {/* Outward gradient pulse wave */}
                <div className="absolute inset-0 rounded-full border border-indigo-400 animate-ping opacity-20"></div>
              </div>

              <h3 className="font-headline-lg text-2xl font-bold tracking-tight mb-2">
                Processing Clinical Record
              </h3>
              <p className="text-indigo-200 text-sm mb-6 leading-relaxed">
                DentAI's specialized dental LLM is structuring oral examination findings...
              </p>

              {/* Live job status from the async fabric (server backoff, attempt count). */}
              {processingHint && (
                <div className="text-[11px] font-mono text-amber-300 tracking-wide animate-fade-in mb-3 max-w-xs leading-relaxed">
                  {processingHint}
                </div>
              )}

              {/* Dynamic Status bar loading text ticker */}
              <div className="w-64 bg-indigo-900 h-1.5 rounded-full overflow-hidden mb-3">
                <div className="h-full bg-[#6ffbbe] animate-pulse w-full"></div>
              </div>
              <div
                key={processingState}
                className="text-xs font-mono text-[#6ffbbe] tracking-wide animate-fade-in"
              >
                {processingState}
              </div>
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
            className="fixed inset-0 z-[60] bg-gradient-to-b from-[#0b0f19] to-[#120f26] text-white flex flex-col justify-between p-6 select-none"
          >
            <div className="w-full max-w-2xl h-full flex flex-col justify-between mx-auto">
            {/* Header */}
            <div className="relative z-50 flex items-center justify-between h-16 border-b border-white/5">
              <div className="flex flex-col">
                <span className="text-[10px] text-indigo-400 font-extrabold uppercase tracking-widest leading-none font-bold">Smart Scribe</span>
                <span className="text-sm font-bold text-slate-200 mt-1">{patientName}</span>
              </div>
              <button
                onClick={() => setIsAmbientMode(false)}
                className="px-3.5 h-8.5 rounded-full border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 font-bold text-[9px] uppercase tracking-wider transition-colors cursor-pointer"
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
              {/* Pulsing Audio Orb (Aesthetic Circular Waveform) */}
              <div className="relative flex items-center justify-center">
                {/* Outer glowing layers */}
                {isRecording && (
                  <>
                    <motion.div
                      animate={{ scale: [1, 1.3, 1] }}
                      transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                      className="absolute w-48 h-48 rounded-full bg-indigo-500/10 blur-xl"
                    />
                    <motion.div
                      animate={{ scale: [1, 1.15, 1] }}
                      transition={{ repeat: Infinity, duration: 2, ease: "easeInOut", delay: 0.5 }}
                      className="absolute w-36 h-36 rounded-full bg-indigo-400/20 blur-lg"
                    />
                  </>
                )}
                {/* Core Orb circle */}
                <div className={`w-28 h-28 rounded-full flex items-center justify-center transition-all duration-500 shadow-2xl border ${
                  isRecording
                    ? 'bg-gradient-to-br from-indigo-505 to-[#004ac6] border-indigo-400/50 shadow-indigo-500/30 shadow-2xl scale-105'
                    : 'bg-[#2a293b] border-slate-700/85 hover:border-slate-655 scale-100'
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
                      <span className="w-2 h-2 bg-emerald-500 rounded-full animate-ping"></span>
                      <span className="text-emerald-400 font-bold text-xs uppercase tracking-widest font-mono">Scribe Active</span>
                    </>
                  ) : (
                    <>
                      <span className="w-2 h-2 bg-slate-500 rounded-full"></span>
                      <span className="text-slate-400 font-bold text-xs uppercase tracking-widest font-mono">Scribe Paused</span>
                    </>
                  )}
                </div>
                <span className="text-[10px] text-slate-400 font-medium mt-2">Tap orb to {isRecording ? 'pause' : 'resume'}</span>
              </div>

              {/* Tactile Quick Tag Cards */}
              <div className="w-full max-w-sm px-4 flex flex-col gap-2 z-30">
                <span className="text-[9px] text-[#5c5d7a] font-extrabold uppercase tracking-widest text-center mb-0.5">
                  Tactile Quick Tags (Vibration Feedback)
                </span>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTactileTag('Note: Checked, overall state stable.');
                    }}
                    className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 active:scale-[0.96] duration-150 transition-all text-center cursor-pointer font-sans"
                  >
                    <svg className="w-4.5 h-4.5 text-emerald-400 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <span className="text-[9px] font-bold text-emerald-300">Stable</span>
                    <span className="text-[8px] text-emerald-500/70 mt-0.5 leading-none">No Pathology</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTactileTag('Note: Flagged potential active pathology.');
                    }}
                    className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 active:scale-[0.96] duration-150 transition-all text-center cursor-pointer font-sans"
                  >
                    <svg className="w-4.5 h-4.5 text-amber-400 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span className="text-[9px] font-bold text-amber-300">Pathology</span>
                    <span className="text-[8px] text-amber-500/70 mt-0.5 leading-none">Alert Flag</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTactileTag('Note: Bookmarked section for manual review.');
                    }}
                    className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 active:scale-[0.96] duration-150 transition-all text-center cursor-pointer font-sans"
                  >
                    <svg className="w-4.5 h-4.5 text-indigo-400 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                    <span className="text-[9px] font-bold text-indigo-300">Bookmark</span>
                    <span className="text-[8px] text-indigo-500/70 mt-0.5 leading-none">Manual Rev</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Footer with Timer and Quick Controls */}
            <div className="relative z-50 flex items-center justify-between border-t border-white/5 pt-6 pb-4">
              {/* Digital Clock */}
              <div className="bg-[#121127] border border-white/5 px-6 py-3 rounded-full flex items-center gap-3.5 shadow-xl">
                <div className={`w-2.5 h-2.5 bg-red-600 rounded-full ${isRecording ? 'animate-ping' : ''}`}></div>
                <span className="font-mono text-2xl font-black tracking-widest text-indigo-100">{formatTime(seconds)}</span>
              </div>

              {/* Quick Controls */}
              <div className="flex items-center gap-3.5">
                <button
                  onClick={() => setShowResetConfirm(true)}
                  className="w-12 h-12 rounded-full border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors cursor-pointer text-slate-400 hover:text-white"
                  title="Reset Recording"
                >
                  <RotateCcw className="w-5 h-5" />
                </button>
                <button
                  onClick={handleFinishNote}
                  disabled={transcript.length === 0}
                  className={`px-7 h-12 rounded-full font-bold text-xs uppercase tracking-widest flex items-center gap-2 shadow-lg transition-all cursor-pointer ${
                    transcript.length === 0
                      ? 'bg-slate-800 text-slate-600 border border-slate-700/50 cursor-not-allowed shadow-none'
                      : 'bg-white hover:bg-opacity-95 text-slate-900 active:scale-95'
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
            className="fixed inset-0 z-[100] flex items-center justify-center bg-indigo-950/40 backdrop-blur-sm px-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="bg-white rounded-2xl p-6 flex flex-col items-center text-center max-w-sm w-full mx-auto shadow-2xl border border-indigo-50"
            >
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4 text-red-650">
                <RotateCcw className="w-6 h-6 animate-spin duration-[1.5s]" style={{ animationIterationCount: 1 }} />
              </div>
              <h3 className="text-lg font-bold text-slate-800 mb-1.5">
                Reset Recording Session?
              </h3>
              <p className="text-slate-500 text-xs mb-6 leading-relaxed">
                This will permanently erase all transcribed conversation and clinical comments for this session. This action cannot be undone.
              </p>
              <div className="flex gap-3 w-full">
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(false)}
                  className="flex-1 border border-slate-200 hover:bg-slate-50 text-slate-500 font-bold h-11 rounded-xl transition-all cursor-pointer text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleResetSession}
                  className="flex-1 bg-red-600 hover:bg-red-750 text-white font-bold h-11 rounded-xl transition-all cursor-pointer text-xs"
                >
                  Reset Session
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
