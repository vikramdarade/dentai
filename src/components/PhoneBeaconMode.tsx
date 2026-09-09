import React, { useState, useEffect, useRef } from 'react';
import {
  Smartphone,
  Mic,
  Radio,
  Battery,
  BatteryCharging,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  Lock,
  Volume2
} from 'lucide-react';
import { saveAudioChunk, clearSessionChunks, reassembleAudioBlob } from '../lib/beaconAudioStorage';
import { detectDismissalCues } from '../lib/semanticDismissalDetector';

interface PhoneBeaconModeProps {
  onExit?: () => void;
}

export default function PhoneBeaconMode({ onExit }: PhoneBeaconModeProps) {
  // Parsing parameters from hash or query
  const [chairId, setChairId] = useState<string>('');
  const [pinInput, setPinInput] = useState<string>('');
  const [roomName, setRoomName] = useState<string>('Operatory Chair');
  const [isPaired, setIsPaired] = useState<boolean>(false);
  const [isPairing, setIsPairing] = useState<boolean>(false);
  const [pairError, setPairError] = useState<string | null>(null);

  // Active recording & audio states
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [isCharging, setIsCharging] = useState<boolean>(false);
  const [wakeLockActive, setWakeLockActive] = useState<boolean>(false);
  const [dismissalDetected, setDismissalDetected] = useState<{ phrase: string; time: number } | null>(null);
  const [inactivitySeconds, setInactivitySeconds] = useState<number>(0);

  // Audio capture refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunkIndexRef = useRef<number>(0);
  const wakeLockRef = useRef<any>(null);
  const lastAudioActivityRef = useRef<number>(Date.now());
  const recognitionRef = useRef<any>(null);

  // Extract chair and pin from URL on mount
  useEffect(() => {
    const parseUrlParams = () => {
      const fullHash = window.location.hash || '';
      const queryIdx = fullHash.indexOf('?');
      let params = new URLSearchParams();

      if (queryIdx !== -1) {
        params = new URLSearchParams(fullHash.slice(queryIdx + 1));
      } else if (window.location.search) {
        params = new URLSearchParams(window.location.search);
      }

      const cId = params.get('chair') || '';
      const pin = params.get('pin') || '';

      if (cId) setChairId(cId);
      if (pin) setPinInput(pin);

      if (cId && pin) {
        autoPair(cId, pin);
      }
    };

    parseUrlParams();
  }, []);

  // Monitor Battery API
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'getBattery' in navigator) {
      (navigator as any).getBattery().then((battery: any) => {
        setBatteryLevel(Math.round(battery.level * 100));
        setIsCharging(battery.charging);

        battery.addEventListener('levelchange', () => {
          setBatteryLevel(Math.round(battery.level * 100));
        });
        battery.addEventListener('chargingchange', () => {
          setIsCharging(battery.charging);
        });
      }).catch(() => {
        // Battery API blocked or unsupported
      });
    }
  }, []);

  // Request WakeLock to prevent phone sleep during dental surgeries
  const requestScreenWakeLock = async () => {
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        setWakeLockActive(true);
        wakeLockRef.current.addEventListener('release', () => {
          setWakeLockActive(false);
        });
      } catch (err) {
        console.warn('WakeLock request failed:', err);
      }
    }
  };

  const autoPair = async (cId: string, pin: string) => {
    setIsPairing(true);
    setPairError(null);

    try {
      const deviceInfo = {
        model: /iPhone|iPad|iPod/.test(navigator.userAgent)
          ? 'Apple iPhone'
          : /Android/.test(navigator.userAgent)
          ? 'Android Mobile'
          : 'Mobile Device',
        userAgent: navigator.userAgent
      };

      const res = await fetch('/api/beacon/chair/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chairId: cId, pinCode: pin, deviceInfo })
      });

      if (!res.ok) {
        const errData = await res.json();
        setPairError(errData.error || 'Invalid Chair ID or PIN');
        setIsPairing(false);
        return;
      }

      const data = await res.json();
      setIsPaired(true);
      setRoomName(data.roomName || 'Operatory Chair');
      setIsPairing(false);

      // Lock screen awake immediately
      requestScreenWakeLock();
    } catch {
      setPairError('Network error connecting to Operatory Chair.');
      setIsPairing(false);
    }
  };

  // Polling remote commands from Desktop PC
  useEffect(() => {
    if (!isPaired || !chairId) return;

    let timer: NodeJS.Timeout;

    const pollStatusAndCommands = async () => {
      try {
        const res = await fetch(`/api/beacon/chair/${chairId}/status`);
        if (!res.ok) return;
        const data = await res.json();

        // Check latest command from Desktop
        if (data.latestCommand) {
          const cmd = data.latestCommand;
          const isFresh = Date.now() - cmd.timestamp < 10_000;

          if (isFresh) {
            if (cmd.action === 'start_recording' && !isRecording) {
              startCapturingAudio();
            } else if (cmd.action === 'stop_recording' && isRecording) {
              stopCapturingAudio();
            }
          }
        }
      } catch {
        // Ignore polling failures
      }
    };

    timer = setInterval(pollStatusAndCommands, 1500);
    return () => clearInterval(timer);
  }, [isPaired, chairId, isRecording]);

  // Audio capture start
  const startCapturingAudio = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      audioStreamRef.current = stream;
      chunkIndexRef.current = 0;
      setRecordingSeconds(0);
      lastAudioActivityRef.current = Date.now();
      setInactivitySeconds(0);
      setDismissalDetected(null);

      // Web Audio Analyser for VAD & levels
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      // MediaRecorder with 5s slice chunking
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';

      const options = mimeType ? { mimeType } : undefined;
      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = async (event) => {
        if (event.data && event.data.size > 0) {
          const chunkIdx = chunkIndexRef.current++;
          await saveAudioChunk(chairId, chunkIdx, event.data);

          // Upload chunk to server
          try {
            await fetch(`/api/beacon/chair/${chairId}/upload-chunk`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chunkIndex: chunkIdx,
                sizeBytes: event.data.size
              })
            });
          } catch {
            // Buffer remains safe in IndexedDB
          }
        }
      };

      // Clear previous chunks for this chair
      await clearSessionChunks(chairId);

      // Start recorder with 5000ms slices
      recorder.start(5000);
      setIsRecording(true);

      // Start lightweight speech recognition for dismissal detection if supported
      startSpeechRecognition();
    } catch (err) {
      console.error('Audio capture error on beacon:', err);
    }
  };

  // Start speech recognition for clinical dismissal patterns
  const startSpeechRecognition = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-AU';

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }

        if (transcript) {
          lastAudioActivityRef.current = Date.now();
          const result = detectDismissalCues(transcript);
          if (result.detected && result.phrase) {
            setDismissalDetected({ phrase: result.phrase, time: Date.now() });

            // Send dismissal event to Desktop PC
            fetch(`/api/beacon/chair/${chairId}/telemetry`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                dismissalDetected: {
                  phrase: result.phrase,
                  confidence: result.confidence,
                  detectedAt: Date.now()
                }
              })
            }).catch(() => {});
          }
        }
      };

      recognition.onerror = () => {};
      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      // Speech recognition fallback
    }
  };

  // Audio capture stop
  const stopCapturingAudio = async () => {
    setIsRecording(false);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop());
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }

    // Reassemble full blob if needed
    try {
      await reassembleAudioBlob(chairId);
    } catch {
      // Handled
    }
  };

  // Inactivity & Audio Level interval
  useEffect(() => {
    if (!isRecording) return;

    const interval = setInterval(() => {
      setRecordingSeconds((prev) => prev + 1);

      // Check audio RMS level
      if (analyserRef.current) {
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length / 255;
        setAudioLevel(avg);

        if (avg > 0.06) {
          lastAudioActivityRef.current = Date.now();
        }
      }

      const idleSeconds = Math.floor((Date.now() - lastAudioActivityRef.current) / 1000);
      setInactivitySeconds(idleSeconds);

      // Post periodic telemetry every 3 seconds
      if (recordingSeconds % 3 === 0) {
        fetch(`/api/beacon/chair/${chairId}/telemetry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'recording',
            batteryLevel,
            isCharging,
            audioLevel,
            recordingSeconds,
            inactivitySeconds: idleSeconds
          })
        }).catch(() => {});
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isRecording, recordingSeconds, chairId, batteryLevel, isCharging, audioLevel]);

  // Clean exit
  const handleDisconnect = () => {
    stopCapturingAudio();
    setIsPaired(false);
    if (onExit) onExit();
  };

  // View 1: Pairing Entry (if not auto-paired from QR code)
  if (!isPaired) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 select-none">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div className="w-16 h-16 rounded-3xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 mx-auto shadow-lg">
            <Smartphone className="w-8 h-8" />
          </div>

          <div>
            <h1 className="text-xl font-black text-white">DentAI Phone Beacon</h1>
            <p className="text-xs text-slate-400 mt-1">Operatory Ambient Microphone Link</p>
          </div>

          <div className="bg-slate-900 rounded-3xl p-6 border border-slate-800 space-y-4 shadow-xl">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Enter 4-Digit Chair PIN
              </label>
              <input
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.slice(0, 4))}
                placeholder="4921"
                className="w-full bg-slate-950 border border-slate-700 text-center font-mono font-black text-3xl tracking-widest text-white rounded-2xl py-3 outline-none focus:border-indigo-500 transition-colors"
              />
            </div>

            {pairError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-medium">
                {pairError}
              </div>
            )}

            <button
              disabled={isPairing || pinInput.length < 4}
              onClick={() => autoPair(chairId || `chair-manual`, pinInput)}
              className="w-full py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold text-sm shadow-md transition-all active:scale-[0.98] cursor-pointer"
            >
              {isPairing ? 'Linking Chair...' : 'Connect as Ambient Mic'}
            </button>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed">
            Tip: You can also open your camera on this phone and scan the QR code displayed on the operatory PC to connect instantly.
          </p>
        </div>
      </div>
    );
  }

  // View 2: "Set & Forget" OLED Black Screen (Operatory Beacon Active)
  return (
    <div className="min-h-screen bg-black text-slate-200 flex flex-col justify-between p-6 select-none overflow-hidden font-sans">
      {/* Top Subtle Status Bar */}
      <div className="flex items-center justify-between text-xs text-slate-500 pt-2 px-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-bold text-slate-400">{roomName}</span>
        </div>

        <div className="flex items-center gap-3">
          {batteryLevel !== null && (
            <div className="flex items-center gap-1 font-mono font-semibold text-slate-400">
              {isCharging ? <BatteryCharging className="w-3.5 h-3.5" /> : <Battery className="w-3.5 h-3.5" />}
              <span>{batteryLevel}%</span>
            </div>
          )}
          <button
            onClick={handleDisconnect}
            className="text-[11px] text-slate-600 hover:text-slate-400 cursor-pointer"
          >
            Disconnect
          </button>
        </div>
      </div>

      {/* Center Aura & Ambient Status */}
      <div className="flex flex-col items-center justify-center my-auto space-y-6 text-center px-4">
        {/* Pulsing Acoustic Aura */}
        <div className="relative flex items-center justify-center">
          <div
            className={`w-36 h-36 rounded-full border border-emerald-500/30 transition-all duration-700 flex items-center justify-center ${
              isRecording ? 'animate-pulse ring-8 ring-emerald-500/10' : 'opacity-40'
            }`}
          >
            <div
              className={`w-24 h-24 rounded-full flex items-center justify-center ${
                isRecording ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'
              }`}
            >
              {isRecording ? <Radio className="w-10 h-10 animate-pulse" /> : <Mic className="w-10 h-10" />}
            </div>
          </div>
        </div>

        <div className="space-y-1.5 max-w-xs">
          <h2 className="text-base font-black text-white tracking-tight">
            {isRecording ? 'Ambient Microphone Active' : 'Microphone Armed & Standby'}
          </h2>
          <p className="text-xs text-slate-400 leading-snug">
            {isRecording
              ? 'Docked in stand or scrubs. Controlled remotely from Operatory PC.'
              : 'Waiting for dentist or nurse to click Start on desktop.'}
          </p>
        </div>

        {/* Live Timer while recording */}
        {isRecording && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-sm font-mono font-black text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            <span>
              {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:
              {String(recordingSeconds % 60).padStart(2, '0')}
            </span>
          </div>
        )}

        {/* Clinical Dismissal Cue Detected Notification */}
        {dismissalDetected && (
          <div className="p-3 rounded-2xl bg-indigo-950/60 border border-indigo-800 text-indigo-300 text-xs max-w-xs space-y-0.5 animate-pulse">
            <span className="font-bold flex items-center justify-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>Dismissal Phrase Detected</span>
            </span>
            <p className="text-[11px] opacity-80 italic">"{dismissalDetected.phrase}"</p>
          </div>
        )}
      </div>

      {/* Bottom Sterile Protocol Notice */}
      <div className="bg-slate-950/90 rounded-2xl p-3 border border-slate-900 text-center space-y-1 max-w-sm mx-auto w-full">
        <div className="flex items-center justify-center gap-1.5 text-slate-400 text-xs font-bold">
          <Lock className="w-3.5 h-3.5 text-emerald-500" />
          <span>Infection Control Protocol</span>
        </div>
        <p className="text-[10px] text-slate-500">
          Do not handle device while wearing surgical gloves. Session will finish automatically from operatory desk.
        </p>
      </div>
    </div>
  );
}
