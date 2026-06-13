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
  const [activeSpeaker, setActiveSpeaker] = useState<'Dentist' | 'Patient'>('Dentist');

  const recognitionRef = useRef<any>(null);
  const activeSpeakerRef = useRef(activeSpeaker);

  // Sync active speaker ref
  useEffect(() => {
    activeSpeakerRef.current = activeSpeaker;
  }, [activeSpeaker]);

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
      };

      rec.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
          setRecognitionError('Microphone permission blocked. Please check browser settings.');
        } else {
          setRecognitionError(`Speech recognition error: ${event.error}`);
        }
        setIsListening(false);
      };

      rec.onend = () => {
        setIsListening(false);
      };

      rec.onresult = (event: any) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const result = event.results[i];
          if (result.isFinal) {
            const text = result[0].transcript.trim();
            if (text) {
              setTranscript((prev) => [...prev, { sender: activeSpeakerRef.current, text }]);
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
    if (!isRecording && isListening && recognitionRef.current) {
      recognitionRef.current.stop();
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

  // Initial transcription items matching screen layout
  const [transcript, setTranscript] = useState<TranscriptItem[]>([
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

  // Simulated transcription lines that users can trigger to append to the conversation!
  const presetPhrases = [
    { sender: 'Patient' as const, text: "Wait, tooth 16 feels very tender when you tap details on it." },
    { sender: 'Dentist' as const, text: "Got it. Tooth 16 exhibits vertical percussion sensitivity. Marginal fracture visible on MO composite." },
    { sender: 'Dentist' as const, text: "Let's recommend scheduling immediate root canal therapy to clear out pulpitis." },
    { sender: 'Patient' as const, text: "Alright, if it stops this throbbing pain, let's do it." }
  ];

  const [nextPresetIndex, setNextPresetIndex] = useState(0);
  const [customInput, setCustomInput] = useState('');
  const [customSender, setCustomSender] = useState<'Dentist' | 'Patient'>('Dentist');

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

  const handleAppendPhrase = (sender: 'Dentist' | 'Patient', text: string) => {
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
    handleAppendPhrase(customSender, customInput);
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
          {transcript.map((item, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className={`flex flex-col max-w-[85%] ${
                item.sender === 'Dentist' ? 'self-end items-end' : 'self-start items-start'
              }`}
            >
              <span className={`text-xs font-bold text-slate-400 mb-1 px-1 ${
                item.sender === 'Dentist' ? 'mr-1' : 'ml-1'
              }`}>
                {item.sender}
              </span>
              <div
                className={`p-4 rounded-xl shadow-sm ${
                  item.sender === 'Dentist'
                    ? 'bg-blue-50/90 border border-blue-200 text-slate-800 rounded-tr-none'
                    : 'bg-slate-200/90 text-slate-800 rounded-tl-none'
                }`}
              >
                <p className="font-transcription-text text-slate-800 leading-relaxed text-[15px]">
                  {item.text}
                </p>
              </div>
            </motion.div>
          ))}

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
              className={`flex flex-col max-w-[85%] ${
                activeSpeaker === 'Dentist' ? 'self-end items-end' : 'self-start items-start'
              }`}
            >
              <span className={`text-xs font-bold text-slate-400 mb-1 px-1 ${
                activeSpeaker === 'Dentist' ? 'mr-1' : 'ml-1'
              }`}>
                {activeSpeaker} (transcribing...)
              </span>
              <div
                className={`p-4 rounded-xl shadow-sm italic text-slate-550 bg-white/70 border border-outline-variant ${
                  activeSpeaker === 'Dentist'
                    ? 'rounded-tr-none border-blue-100'
                    : 'rounded-tl-none border-slate-100'
                }`}
              >
                <p className="font-transcription-text leading-relaxed text-[15px]">
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

                  {/* Speaker Toggle (Who is speaking) */}
                  <div className="flex-grow flex flex-col gap-1">
                    <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Record as Speaker:</span>
                    <div className="flex border border-slate-250 rounded-lg p-0.5 bg-slate-50">
                      <button
                        type="button"
                        onClick={() => setActiveSpeaker('Dentist')}
                        className={`flex-1 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${
                          activeSpeaker === 'Dentist'
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-slate-600 hover:bg-slate-150'
                        }`}
                      >
                        Dentist
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveSpeaker('Patient')}
                        className={`flex-1 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${
                          activeSpeaker === 'Patient'
                            ? 'bg-slate-700 text-white shadow-sm'
                            : 'text-slate-650 hover:bg-slate-150'
                        }`}
                      >
                        Patient
                      </button>
                    </div>
                  </div>
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
                <button
                  type="button"
                  onClick={() => setCustomSender((prev) => (prev === 'Dentist' ? 'Patient' : 'Dentist'))}
                  className={`px-3 rounded-xl text-[10px] font-extrabold flex items-center gap-1.5 border transition-all cursor-pointer h-10 ${
                    customSender === 'Dentist'
                      ? 'bg-blue-55 border-blue-200 text-blue-700'
                      : 'bg-slate-150 border-slate-350 text-slate-700'
                  }`}
                  title="Toggle sender role for typing input"
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  <span>As: {customSender}</span>
                </button>
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
              className="bg-primary-container hover:bg-opacity-95 text-white px-7 h-12 rounded-full font-bold text-xs uppercase tracking-widest flex items-center gap-2 shadow-lg active:scale-95 transition-all cursor-pointer"
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
