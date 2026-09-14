import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Smartphone,
  QrCode,
  CheckCircle2,
  AlertCircle,
  Battery,
  BatteryCharging,
  Radio,
  X,
  Copy,
  Check,
  ExternalLink,
  Volume2,
  Clock,
  Sparkles,
  ShieldCheck,
  Mic,
  Square
} from 'lucide-react';
import { generateQrSvg } from '../lib/qrCodeSvg';

interface ChairBeaconModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomName?: string;
  clinicId?: string;
  onStartRecordingFromDesktop?: () => void;
  onStopRecordingFromDesktop?: () => void;
  isRecordingActive?: boolean;
}

export default function ChairBeaconModal({
  isOpen,
  onClose,
  roomName = 'Chair 1',
  clinicId,
  onStartRecordingFromDesktop,
  onStopRecordingFromDesktop,
  isRecordingActive = false
}: ChairBeaconModalProps) {
  const [chairId, setChairId] = useState<string>('');
  const [pinCode, setPinCode] = useState<string>('');
  const [qrUrl, setQrUrl] = useState<string>('');
  const [phoneConnected, setPhoneConnected] = useState<boolean>(false);
  const [deviceModel, setDeviceModel] = useState<string>('Smartphone');
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [isCharging, setIsCharging] = useState<boolean>(false);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);
  const [dismissalAlert, setDismissalAlert] = useState<{ phrase: string; time: number } | null>(null);
  const [inactivityAlert, setInactivityAlert] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);

  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize or fetch chair session
  useEffect(() => {
    if (!isOpen) {
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
      return;
    }

    let isMounted = true;

    async function initChair() {
      try {
        const res = await fetch('/api/beacon/chair/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomName, clinicId })
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!isMounted) return;

        setChairId(data.chairId);
        setPinCode(data.pinCode);

        // Construct full link
        const origin = window.location.origin;
        const fullUrl = `${origin}/#/beacon?chair=${data.chairId}&pin=${data.pinCode}`;
        setQrUrl(fullUrl);

        // Start polling chair status every 1.5s
        pollingTimerRef.current = setInterval(async () => {
          try {
            const statusRes = await fetch(`/api/beacon/chair/${data.chairId}/status`);
            if (!statusRes.ok) return;
            const statusData = await statusRes.json();

            setPhoneConnected(!!statusData.phoneConnected);
            if (statusData.deviceInfo?.model) {
              setDeviceModel(statusData.deviceInfo.model);
            }
            if (typeof statusData.telemetry?.batteryLevel === 'number') {
              setBatteryLevel(statusData.telemetry.batteryLevel);
            }
            if (typeof statusData.telemetry?.isCharging === 'boolean') {
              setIsCharging(statusData.telemetry.isCharging);
            }
            if (typeof statusData.telemetry?.audioLevel === 'number') {
              setAudioLevel(statusData.telemetry.audioLevel);
            }
            if (typeof statusData.telemetry?.recordingSeconds === 'number') {
              setRecordingSeconds(statusData.telemetry.recordingSeconds);
            }
            if (statusData.telemetry?.dismissalDetected?.phrase) {
              setDismissalAlert({
                phrase: statusData.telemetry.dismissalDetected.phrase,
                time: statusData.telemetry.dismissalDetected.detectedAt
              });
            }
            if (
              typeof statusData.telemetry?.inactivitySeconds === 'number' &&
              statusData.telemetry.inactivitySeconds >= 210
            ) {
              setInactivityAlert(true);
            } else {
              setInactivityAlert(false);
            }
          } catch {
            // Ignore transient network blips
          }
        }, 1500);
      } catch {
        // Handle init error gracefully
      }
    }

    initChair();

    return () => {
      isMounted = false;
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    };
  }, [isOpen, roomName, clinicId]);

  // Spacebar trigger listener
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is actively typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.code === 'Space' || (e.ctrlKey && e.code === 'Space')) {
        e.preventDefault();
        if (isRecordingActive) {
          handleStop();
        } else {
          handleStart();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isRecordingActive, chairId]);

  const handleStart = async () => {
    if (!chairId) return;
    try {
      await fetch(`/api/beacon/chair/${chairId}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start_recording' })
      });
      if (onStartRecordingFromDesktop) onStartRecordingFromDesktop();
    } catch (e) {
      console.error(e);
    }
  };

  const handleStop = async () => {
    if (!chairId) return;
    try {
      await fetch(`/api/beacon/chair/${chairId}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop_recording' })
      });
      if (onStopRecordingFromDesktop) onStopRecordingFromDesktop();
      onClose();
    } catch (e) {
      console.error(e);
    }
  };

  const handleCopyUrl = () => {
    if (!qrUrl) return;
    navigator.clipboard.writeText(qrUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden"
      >
        {/* Header */}
        <div className="bg-slate-900 text-white p-5 px-6 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-sm text-white">Operatory Phone Beacon</h3>
                <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 text-[10px] font-bold">
                  {roomName}
                </span>
              </div>
              <p className="text-xs text-slate-400">Zero-Touch Ambient Chairside Microphone</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 flex items-center justify-center transition-all cursor-pointer active:scale-95"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 space-y-5 bg-slate-50/50">
          {/* Status Badge */}
          <div
            className={`p-3.5 rounded-2xl border flex items-center justify-between transition-all ${
              phoneConnected
                ? 'bg-emerald-50/90 border-emerald-200 text-emerald-900'
                : 'bg-amber-50/90 border-amber-200 text-amber-900'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div
                className={`w-3 h-3 rounded-full ${
                  phoneConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                }`}
              />
              <div>
                <span className="text-xs font-extrabold block">
                  {phoneConnected ? `Paired: ${deviceModel}` : 'Awaiting Phone Beacon Connection'}
                </span>
                <span className="text-[11px] opacity-80 block">
                  {phoneConnected
                    ? 'Device docked in stand or scrub pocket. Controlled remotely.'
                    : 'Open camera on your iPhone / Android and scan the QR code below.'}
                </span>
              </div>
            </div>

            {phoneConnected && batteryLevel !== null && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white/80 border border-emerald-200 text-[11px] font-mono font-bold text-emerald-800">
                {isCharging ? <BatteryCharging className="w-3.5 h-3.5" /> : <Battery className="w-3.5 h-3.5" />}
                <span>{batteryLevel}%</span>
              </div>
            )}
          </div>

          {/* Model 4 Dismissal & Silence Alerts */}
          {dismissalAlert && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3.5 rounded-2xl bg-indigo-50 border border-indigo-200 flex items-start gap-2.5"
            >
              <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
              <div className="text-xs text-indigo-900 leading-snug">
                <span className="font-bold block">Dismissal Cue Recognized:</span>
                <span className="italic">"{dismissalAlert.phrase}"</span>
                <p className="text-[11px] text-indigo-700 mt-1 font-semibold">
                  Patient dismissal detected &bull; Press <b>Spacebar</b> to generate notes.
                </p>
              </div>
            </motion.div>
          )}

          {inactivityAlert && !dismissalAlert && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 flex items-start gap-2.5"
            >
              <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-900 leading-snug">
                <span className="font-bold block">Surgery Inactivity Safety Net:</span>
                Continuous room silence has reached 3m 30s. Press <b>Spacebar</b> to generate notes or continue exam.
              </div>
            </motion.div>
          )}

          {/* QR Code & PIN Code Grid */}
          {!phoneConnected ? (
            <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs flex flex-col sm:flex-row items-center gap-6">
              {/* QR Container */}
              <div className="shrink-0 flex flex-col items-center">
                {qrUrl ? (
                  <div
                    dangerouslySetInnerHTML={{ __html: generateQrSvg(qrUrl, 160) }}
                    className="shadow-sm"
                  />
                ) : (
                  <div className="w-40 h-40 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400">
                    <QrCode className="w-8 h-8 animate-spin" />
                  </div>
                )}
                <span className="text-[10px] font-bold text-slate-400 mt-1.5 uppercase tracking-wider">
                  Scan with Camera
                </span>
              </div>

              {/* PIN Code & Instructions */}
              <div className="space-y-3 text-center sm:text-left flex-1">
                <div>
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    Or Enter 4-Digit Chair PIN
                  </span>
                  <div className="inline-flex items-center gap-2 mt-1">
                    {pinCode ? (
                      pinCode.split('').map((char, i) => (
                        <span
                          key={i}
                          className="w-10 h-12 rounded-xl bg-slate-100 border border-slate-200/80 font-mono font-black text-xl text-slate-900 flex items-center justify-center shadow-xs"
                        >
                          {char}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm font-mono text-slate-400">Loading...</span>
                    )}
                  </div>
                </div>

                <p className="text-xs text-slate-500 leading-relaxed">
                  Open <b>dentai.app/#/beacon</b> on your iPhone or Android and enter this PIN to link {roomName}.
                </p>

                <div className="flex items-center gap-2 pt-1 justify-center sm:justify-start">
                  <button
                    onClick={handleCopyUrl}
                    className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 hover:text-indigo-600 bg-slate-100 hover:bg-slate-200/80 px-3 py-1.5 rounded-lg border border-slate-200 transition-all cursor-pointer active:scale-95"
                  >
                    {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedUrl ? 'Link Copied!' : 'Copy Direct Beacon Link'}</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Connected Live Visualizer & Remote Controls */
            <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Radio className="w-4 h-4 text-emerald-600 animate-pulse" />
                  <span className="text-xs font-bold text-slate-800">
                    {isRecordingActive ? 'Capturing Ambient Audio' : 'Microphone Armed on Phone'}
                  </span>
                </div>
                {isRecordingActive && (
                  <span className="text-xs font-mono font-black text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
                    {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:
                    {String(recordingSeconds % 60).padStart(2, '0')}
                  </span>
                )}
              </div>

              {/* Audio visualizer bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  <span>Microphone Sensitivity</span>
                  <span>{audioLevel > 0.05 ? 'Voice Detected' : 'Room Quiet'}</span>
                </div>
                <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200/70">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-indigo-600 transition-all duration-100"
                    style={{ width: `${Math.min(100, Math.max(8, audioLevel * 100))}%` }}
                  />
                </div>
              </div>

              {/* Operatory Remote Controls */}
              <div className="pt-2 flex flex-col sm:flex-row items-center gap-2.5">
                {!isRecordingActive ? (
                  <button
                    onClick={handleStart}
                    className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <Mic className="w-4 h-4" />
                    <span>Start Consultation (Spacebar)</span>
                  </button>
                ) : (
                  <button
                    onClick={handleStop}
                    className="w-full py-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <Square className="w-4 h-4" />
                    <span>Finish &amp; Generate Notes (Spacebar)</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Keyboard & Hands-Free Shortcuts Guide */}
          <div className="p-3 bg-slate-100/80 rounded-xl border border-slate-200 flex items-center justify-between text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 rounded bg-white font-mono font-bold text-slate-800 border border-slate-300 shadow-2xs text-[11px]">
                Spacebar
              </span>
              <span className="text-[11px]">Tap desktop spacebar to start / finish without touching phone</span>
            </div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Zero-Touch</span>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-white p-4 px-6 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Encrypted P2P Operatory Link &bull; APP 11 Compliant</span>
          </div>
          <button
            onClick={onClose}
            className="font-bold text-slate-700 hover:text-slate-900 cursor-pointer text-xs"
          >
            Use Desktop Microphone Instead
          </button>
        </div>
      </motion.div>
    </div>
  );
}
