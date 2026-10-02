/**
 * Clinical Audio Engine.
 *
 * Framework-agnostic wrapper around `getUserMedia`, the Web Audio API and
 * `MediaRecorder`:
 * - computes a real-time, decibel-scaled RMS input level (0–100) from an
 *   `AnalyserNode` so the UI can render a live volume visualiser;
 * - tracks *speech silence* and delegates the decision to `silencePolicy`, so
 *   the browser recorder and the unit-tested policy can never drift apart:
 *   150s of continuous silence plays the 784 Hz warning chime (once), and
 *   180s auto-pauses the recording — no microphone left running chairside
 *   after the patient has been walked out.
 *
 * The class owns the microphone and the media stream; it deliberately owns no
 * React state. `AudioBar` renders it, the parent wires the callbacks.
 */
import {
  SILENCE_WARN_CHIME_HZ,
  SILENCE_WARN_SECONDS,
  SILENCE_SLEEP_SECONDS,
  decideSilenceAction,
} from './silencePolicy';

export { SILENCE_WARN_CHIME_HZ, SILENCE_WARN_SECONDS, SILENCE_SLEEP_SECONDS };

export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

/**
 * List available microphone inputs, tolerant of the pre-permission state where
 * browsers hide labels (`label === ''`). Callers should refresh after the first
 * successful `getUserMedia` — that is when labels become readable.
 */
export async function listAudioInputDevices(): Promise<AudioInputDevice[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === 'audioinput')
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Microphone ${index + 1}`,
      }));
  } catch {
    return [];
  }
}

export interface AudioRecorderOptions {
  /** Preferred input device; falls back to the system default when omitted. */
  deviceId?: string | null;
  /** Input level (0–100) at or below which a frame counts as silence. */
  silenceThreshold?: number;
  /** Real-time input level, 0 (silence) – 100 (near clipping). */
  onLevel?: (level: number) => void;
  /** Whole-second elapsed recording time, excluding paused spans. */
  onTick?: (elapsedSeconds: number) => void;
  /** Fired once when continuous silence crosses the 150s warning threshold. */
  onSilenceWarning?: (silenceSeconds: number) => void;
  /** Fired when silence hits 180s and the recorder auto-pauses itself. */
  onAutoPause?: (silenceSeconds: number) => void;
  /** Fired when the engine hits an unrecoverable error. */
  onError?: (error: Error) => void;
}

/** Double-pip warning tone, matching SILENCE_WARN_CHIME_HZ. Exported for reuse. */
export function playWarningChime(
  context: AudioContext,
  hz: number = SILENCE_WARN_CHIME_HZ,
  pips = 2,
): void {
  const now = context.currentTime;
  for (let i = 0; i < pips; i += 1) {
    const start = now + i * 0.24;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'sine';
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start(start);
    osc.stop(start + 0.2);
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

function resolveAudioContextCtor(): typeof AudioContext | undefined {
  if (typeof AudioContext !== 'undefined') return AudioContext;
  const legacy = globalThis as { webkitAudioContext?: typeof AudioContext };
  return legacy.webkitAudioContext;
}

export class AudioRecorder {
  private readonly options: AudioRecorderOptions;

  private state: RecorderState = 'idle';
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;

  private chunks: Blob[] = [];
  private sampleBuffer: Float32Array | null = null;
  private rafId: number | null = null;

  // Elapsed time is accumulated as wall-clock active spans, not frame deltas:
  // requestAnimationFrame is throttled in background tabs and the timer must
  // still freeze correctly on pause.
  private accumulatedMs = 0;
  private activeSince: number | null = null;
  private lastTickSecond = -1;

  private silenceStartedAt: number | null = null;
  private warned = false;
  private lastLevel = 0;

  constructor(options: AudioRecorderOptions = {}) {
    this.options = { silenceThreshold: 4, ...options };
  }

  getState(): RecorderState {
    return this.state;
  }

  isActive(): boolean {
    return this.state === 'recording' || this.state === 'paused';
  }

  getElapsedSeconds(): number {
    const live = this.activeSince != null ? nowMs() - this.activeSince : 0;
    return Math.floor((this.accumulatedMs + live) / 1000);
  }

  getLevel(): number {
    return this.lastLevel;
  }

  /** Acquire the microphone and begin capturing. Safe to call twice. */
  async start(): Promise<void> {
    if (this.isActive()) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone capture is not supported in this browser.');
    }
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('MediaRecorder is not supported in this browser.');
    }
    const AudioContextCtor = resolveAudioContextCtor();
    if (!AudioContextCtor) {
      throw new Error('The Web Audio API is not supported in this browser.');
    }

    const audioConstraints: MediaTrackConstraints | boolean = this.options.deviceId
      ? { deviceId: { exact: this.options.deviceId } }
      : true;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    this.stream = stream;

    // Reset per-session counters before the first frame arrives.
    this.chunks = [];
    this.accumulatedMs = 0;
    this.activeSince = nowMs();
    this.lastTickSecond = -1;
    this.silenceStartedAt = null;
    this.warned = false;
    this.lastLevel = 0;

    const context = new AudioContextCtor();
    this.audioContext = context;
    const source = context.createMediaStreamSource(stream);
    this.sourceNode = source;
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    this.analyser = analyser;
    this.sampleBuffer = new Float32Array(analyser.fftSize);

    const mimeType = pickMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };
    recorder.onerror = (event: Event) => {
      const error = (event as Event & { error?: DOMException }).error;
      this.options.onError?.(error instanceof Error ? error : new Error('Audio recording failed.'));
    };
    recorder.start(1000);
    this.mediaRecorder = recorder;

    this.state = 'recording';
    this.scheduleFrame();
  }

  /** Suspend capture without discarding the recording. */
  pause(): void {
    if (this.state !== 'recording') return;
    try {
      if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        this.mediaRecorder.pause();
      }
    } catch {
      /* recorder already inactive — the state below is what matters */
    }
    if (this.activeSince != null) {
      this.accumulatedMs += nowMs() - this.activeSince;
      this.activeSince = null;
    }
    this.silenceStartedAt = null;
    this.warned = false;
    this.state = 'paused';
    this.cancelFrame();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    try {
      if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
        this.mediaRecorder.resume();
      }
    } catch {
      /* fall through to state update */
    }
    this.activeSince = nowMs();
    this.silenceStartedAt = null;
    this.warned = false;
    this.state = 'recording';
    this.scheduleFrame();
  }

  /**
   * Stop, tear the microphone down and resolve with the recorded blob
   * (`null` when nothing was captured). Always releases the mic.
   */
  async stop(): Promise<Blob | null> {
    const recorder = this.mediaRecorder;
    if (this.activeSince != null) {
      this.accumulatedMs += nowMs() - this.activeSince;
      this.activeSince = null;
    }
    this.cancelFrame();

    let blob: Blob | null = null;
    if (recorder) {
      blob = await new Promise<Blob | null>((resolve) => {
        let settled = false;
        const finalize = () => {
          if (settled) return;
          settled = true;
          const type = recorder.mimeType || this.chunks[0]?.type || 'audio/webm';
          resolve(this.chunks.length > 0 ? new Blob(this.chunks, { type }) : null);
        };
        try {
          recorder.onstop = finalize;
          if (recorder.state === 'inactive') finalize();
          else recorder.stop();
        } catch {
          finalize();
        }
        // Never let a wedged recorder strand the UI on the stop button.
        setTimeout(finalize, 2000);
      });
    }

    this.teardown();
    this.state = 'stopped';
    return blob;
  }

  /** Release everything immediately, discarding any buffered audio. */
  dispose(): void {
    this.cancelFrame();
    if (this.mediaRecorder) {
      try {
        this.mediaRecorder.ondataavailable = null;
        this.mediaRecorder.onstop = null;
        if (this.mediaRecorder.state !== 'inactive') this.mediaRecorder.stop();
      } catch {
        /* ignore */
      }
    }
    this.teardown();
    this.state = 'idle';
  }

  private teardown(): void {
    this.cancelFrame();
    this.mediaRecorder = null;
    this.chunks = [];
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.sourceNode = null;
    this.analyser = null;
    this.sampleBuffer = null;
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    const context = this.audioContext;
    this.audioContext = null;
    if (context && context.state !== 'closed') {
      void context.close().catch(() => undefined);
    }
  }

  private scheduleFrame(): void {
    if (this.rafId != null) return;
    if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame(this.onFrame);
    } else {
      this.rafId = setTimeout(this.onFrame, 100) as unknown as number;
    }
  }

  private cancelFrame(): void {
    if (this.rafId == null) return;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.rafId);
    else clearTimeout(this.rafId);
    this.rafId = null;
  }

  private onFrame = (): void => {
    this.rafId = null;
    if (this.state !== 'recording') return;

    const level = this.sampleLevel();
    this.lastLevel = level;
    this.options.onLevel?.(level);

    this.evaluateSilence(level);

    // Only keep sampling if silence did not just pause us.
    if (this.state === 'recording') {
      const elapsed = this.getElapsedSeconds();
      if (elapsed !== this.lastTickSecond) {
        this.lastTickSecond = elapsed;
        this.options.onTick?.(elapsed);
      }
      this.scheduleFrame();
    }
  };

  private evaluateSilence(level: number): void {
    const threshold = this.options.silenceThreshold ?? 4;
    const now = nowMs();

    if (level > threshold) {
      this.silenceStartedAt = null;
      this.warned = false;
      return;
    }
    if (this.silenceStartedAt == null) this.silenceStartedAt = now;

    const silenceSeconds = (now - this.silenceStartedAt) / 1000;
    const action = decideSilenceAction(silenceSeconds);

    if (action === 'warn' && !this.warned) {
      this.warned = true;
      if (this.audioContext) playWarningChime(this.audioContext);
      this.options.onSilenceWarning?.(Math.round(silenceSeconds));
    } else if (action === 'pause') {
      this.options.onAutoPause?.(Math.round(silenceSeconds));
      this.pause();
    }
  }

  /** Decibel-scaled RMS: -60 dBFS → 0, 0 dBFS → 100. */
  private sampleLevel(): number {
    const analyser = this.analyser;
    if (!analyser) return 0;
    if (!this.sampleBuffer || this.sampleBuffer.length !== analyser.fftSize) {
      this.sampleBuffer = new Float32Array(analyser.fftSize);
    }
    analyser.getFloatTimeDomainData(this.sampleBuffer);
    let sumSquares = 0;
    for (let i = 0; i < this.sampleBuffer.length; i += 1) {
      sumSquares += this.sampleBuffer[i] * this.sampleBuffer[i];
    }
    const rms = Math.sqrt(sumSquares / this.sampleBuffer.length);
    const db = 20 * Math.log10(rms + 1e-8);
    const level = ((db + 60) / 60) * 100;
    return Math.max(0, Math.min(100, level));
  }
}
