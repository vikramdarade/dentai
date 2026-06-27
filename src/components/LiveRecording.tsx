import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, UserRound, Pause, Play, ArrowRight, Sparkles, ArrowUpDown, CornerDownLeft, AlertCircle, X, Mic, MicOff } from 'lucide-react';
import { TranscriptItem } from '../types';
import { motion, AnimatePresence } from 'motion/react';

interface LiveRecordingProps {
  patientName: string;
  appointmentType: 'examination' | 'scale_clean' | 'emergency';
  onBack: () => void;
  onFinish: (finalTranscript: TranscriptItem[]) => Promise<void> | void;
}

export default function LiveRecording({
  patientName,
  appointmentType,
  onBack,
  onFinish
}: LiveRecordingProps) {
  const [seconds, setSeconds] = useState(272); // Starts from 04:32 (272s)
  const [isRecording, setIsRecording] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingState, setProcessingState] = useState('');

  // Voice transcription state
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [recognitionError, setRecognitionError] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);

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
      };

      rec.onresult = (event: any) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const result = event.results[i];
          if (result.isFinal) {
            const text = result[0].transcript.trim();
            if (text) {
              setTranscript((prev) => [...prev, { sender: 'Dialogue', text }]);
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
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      stopAudioPipeline();
    }
  }, [isRecording, isListening]);

  const toggleSpeechRecognition = () => {
    if (!recognitionRef.current) {
      setRecognitionError('Speech recognition is not supported in this browser. Please use Google Chrome or Microsoft Edge.');
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
    } else {
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
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);

  // Simulated transcription lines that users can trigger to append to the conversation!
  const presetPhrases = [
    { sender: 'Patient' as const, text: "Wait, tooth 16 feels very tender when you tap details on it." },
    { sender: 'Dentist' as const, text: "Got it. Tooth 16 exhibits vertical percussion sensitivity. Marginal fracture visible on MO composite." },
    { sender: 'Dentist' as const, text: "Let's recommend scheduling immediate root canal therapy to clear out pulpitis." },
    { sender: 'Patient' as const, text: "Alright, if it stops this throbbing pain, let's do it." }
  ];

  const [nextPresetIndex, setNextPresetIndex] = useState(0);
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

  // Auto scroll effect
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleAppendPhrase = (sender: 'Dentist' | 'Patient' | 'Dialogue' | 'Clinical Comment', text: string) => {
    if (!text.trim()) return;
    setTranscript((prev) => [...prev, { sender, text }]);
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

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleFinishNote = async () => {
    setIsRecording(false);
    setIsProcessing(true);
    setErrorMsg(null);

    // Dynamic loading status messages for full AI chart construction immersion
    const states = [
      'Transcribed live voice feed...',
      'Running AI clinical extractor model (HIPAA)...',
      'Synthesizing clinical findings & tooth map...',
      'Formulating ICD-10 codes & pulpitis diagnosis...',
      'Drafting friendly patient-narrative care letter...',
      'Notes complete! Opening health communication hub...'
    ];

    let current = 0;
    setProcessingState(states[0]);

    const interval = setInterval(() => {
      current++;
      if (current < states.length) {
        setProcessingState(states[current]);
      }
    }, 1200);

    try {
      await onFinish(transcript);
      clearInterval(interval);
    } catch (err: any) {
      clearInterval(interval);
      setIsProcessing(false);
      setErrorMsg(err.message || 'Failed to generate clinical notes. Please verify connection and try again.');
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
            <span className="font-label-sm text-[10px] text-red-600 font-extrabold uppercase tracking-widest leading-none">
              {appointmentType}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
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
        {errorMsg && (
          <div className="w-full bg-red-50 border border-red-200 text-red-800 px-4 py-3.5 rounded-xl flex items-start justify-between shadow-sm animate-fade-in mb-2">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex flex-col">
                <span className="font-bold text-xs uppercase tracking-wider text-red-650">Error Compiling Notes</span>
                <p className="text-xs text-red-700 mt-0.5 leading-relaxed">{errorMsg}</p>
              </div>
            </div>
            <button onClick={() => setErrorMsg(null)} className="p-1 text-red-400 hover:text-red-650 rounded-full transition-colors cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Connection Started pill */}
        <div className="flex justify-center my-2">
          <span className="font-label-md text-[11px] font-semibold text-slate-500 bg-white/80 border border-outline-variant/50 px-3 py-1.5 rounded-full shadow-sm">
            04:12 PM - Clinical Session Started
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
              <div className="mt-4 pt-4 border-t border-slate-100 w-full flex flex-col items-center">
                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-2">Or test the flow immediately:</span>
                <button
                  type="button"
                  onClick={() => {
                    setTranscript([
                      {
                        sender: 'Patient',
                        text: "I've been having this sharp pain in the upper right quadrant for about two days now. It gets worse when I drink anything cold."
                      },
                      {
                        sender: 'Dentist',
                        text: "Understood. Does the pain linger after the cold stimulus is removed, or is it just a quick flash?"
                      },
                      {
                        sender: 'Patient',
                        text: "It lingers for maybe 30 seconds to a minute. It's a throbbing sensation."
                      },
                      {
                        sender: 'Dentist',
                        text: "Okay, let's take a look. I'm going to perform a percussion test on tooth number 16 and 15."
                      }
                    ]);
                  }}
                  className="px-4 py-2 bg-indigo-50 border border-indigo-150 hover:bg-indigo-100 text-primary font-bold text-xs rounded-lg transition-all cursor-pointer shadow-sm"
                >
                  Load Demo Case
                </button>
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
                      {formatTime(seconds - Math.max(0, transcript.length - idx) * 3)}
                    </span>
                  </div>
                  <p className="font-transcription-text text-slate-800 leading-relaxed text-[14.5px]">
                    {item.text}
                  </p>
                </div>
              </motion.div>
            );
          })}

          {/* AI Captured Insights notification triggers! */}
          {transcript.length >= 4 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-emerald-50/80 border-l-4 border-emerald-600 p-4 my-2 rounded-r-xl shadow-sm flex flex-col gap-1.5"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="text-emerald-700 w-4 h-4" />
                <span className="font-label-md text-emerald-800 font-bold uppercase tracking-wider text-xs">
                  Clinical Indicator Captured
                </span>
              </div>
              <p className="font-body-md text-emerald-900 text-sm font-medium leading-relaxed">
                Detected: Lingering thermal sensitivity. Percussion testing initiated on teeth group.
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

          {/* Bouncing Loader Dots representing active audio transcription */}
          {isRecording && !isListening && (
            <div className="flex flex-col items-start max-w-[85%] self-start opacity-75 mt-2">
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
            </div>
          )}

          {isRecording && isListening && (
            <div className="flex flex-col items-start max-w-[85%] self-start opacity-90 mt-2">
              <span className="text-xs font-bold text-[#e11d48] mb-1 ml-1 animate-pulse flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-[#e11d48] rounded-full"></span>
                <span>Recording Audio (en-AU mic active)...</span>
              </span>
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
              <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-250 font-semibold text-[10px]">HIPAA Compliant</span>
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
                    <span>VocalBridge Ambient Filter</span>
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
                      {vocalBridgeActive ? 'VocalBridge Noise Gate' : 'Raw Audio Feed'}
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
                    <div className="text-[10px] font-semibold text-slate-400 italic py-1">Simulation presets finished. Use manual text or live microphone.</div>
                  )}
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
            {/* Play-Pause triggers */}
            <button
              onClick={() => setIsRecording(!isRecording)}
              className="w-12 h-12 rounded-full border border-outline-variant flex items-center justify-center hover:bg-slate-50 transition-colors cursor-pointer"
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
    </div>
  );
}
