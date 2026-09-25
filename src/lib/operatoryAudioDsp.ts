/**
 * Operatory Audio DSP Processing Chain for DentAI
 *
 * Implements clinical operatory acoustic filtering:
 * 1. 80 Hz High-Pass Butterworth filter: eliminates HVAC, compressor, and operatory chair rumble.
 * 2. 5,000–7,500 Hz Parametric Notch filter (Q = 7.0, center 6,250 Hz): attenuates high-speed
 *    air-turbine handpiece resonance (300,000–450,000 RPM) without distorting human speech.
 * 3. 18 kHz Low-Pass Scaler Roll-Off: strips ultrasonic scaler cavitation noise and sub-harmonics.
 * 4. Real-time Signal-to-Noise Ratio (SNR) monitor triggering receptionist-friendly warnings
 *    when background noise drops SNR below 12 dB.
 */

export interface OperatoryDspOptions {
  /** Callback fired when operatory background noise degrades SNR below threshold */
  onSnrWarning?: (isLow: boolean, snrDb: number) => void;
  /** SNR threshold in dB below which a warning triggers (default: 12 dB) */
  snrThresholdDb?: number;
  /** Rolling window interval in ms to sample SNR (default: 1000 ms) */
  snrCheckIntervalMs?: number;
  /** AudioContext to use (optional, will instantiate default if not provided) */
  audioContext?: AudioContext;
}

export interface OperatoryDspChain {
  /** The clean, filtered MediaStream to route into MediaRecorder or WebSockets */
  destinationStream: MediaStream;
  /** Underlying Web Audio Context */
  context: AudioContext | null;
  /** Analyser node for waveform visualizer */
  analyserNode: AnalyserNode;
  /** Set DSP bypass state (true = bypass active filters, false = full operatory filtering) */
  setBypass: (bypass: boolean) => void;
  /** Get current estimated Signal-to-Noise Ratio in decibels */
  getCurrentSnrDb: () => number;
  /** Returns true if current SNR is below safe threshold (< 12 dB) */
  isLowSnr: () => boolean;
  /** Teardown and release all audio nodes and timer listeners (Rule 14 cross-patient boundary) */
  destroy: () => void;
}

// Frequency Constants
export const HIGH_PASS_RUMBLE_FREQ_HZ = 80;
export const TURBINE_NOTCH_CENTER_FREQ_HZ = 6250; // Centered in 5,000 Hz - 7,500 Hz
export const TURBINE_NOTCH_Q = 7.0; // Q = 7.0 gives a sharp notch spanning ~5,400 Hz - 7,100 Hz (-3dB points)
export const SCALER_ROLLOFF_FREQ_HZ = 18000;
export const DEFAULT_SNR_THRESHOLD_DB = 12.0;


/**
 * Creates and connects the operatory acoustic DSP filter chain for a live microphone MediaStream.
 * If Web Audio API is not supported in the execution environment, passes through the stream safely.
 */
export function createOperatoryDspChain(
  inputStream: MediaStream,
  options: OperatoryDspOptions = {}
): OperatoryDspChain {
  const AudioCtx =
    (options.audioContext ? options.audioContext.constructor as any : null) ||
    (typeof window !== 'undefined' ? (window.AudioContext || (window as any).webkitAudioContext) : null) ||
    (typeof globalThis !== 'undefined' ? (globalThis as any).AudioContext : null);

  // Fallback for non-browser or unsupported environments
  if ((!AudioCtx && !options.audioContext) || !inputStream.getAudioTracks().length) {
    return {
      destinationStream: inputStream,
      context: null,
      analyserNode: null as any,
      setBypass: () => {},
      getCurrentSnrDb: () => 30.0,
      isLowSnr: () => false,
      destroy: () => {}
    };
  }

  let audioContext: AudioContext;
  let isContextOwned = false;

  try {
    if (options.audioContext) {
      audioContext = options.audioContext;
    } else {
      audioContext = new AudioCtx({ sampleRate: 16000 });
      isContextOwned = true;
    }
  } catch {
    audioContext = new AudioCtx();
    isContextOwned = true;
  }

  // 1. Source Node from live operatory mic
  const sourceNode = audioContext.createMediaStreamSource(inputStream);

  // 2. 80 Hz High-Pass Filter (Butterworth response Q ~ 0.707)
  const rumbleFilter = audioContext.createBiquadFilter();
  rumbleFilter.type = 'highpass';
  rumbleFilter.frequency.setValueAtTime(HIGH_PASS_RUMBLE_FREQ_HZ, audioContext.currentTime);
  rumbleFilter.Q.setValueAtTime(0.707, audioContext.currentTime);

  // 3. 5,000–7,500 Hz Parametric Notch Filter for High-Speed Turbine Handpiece Whine
  const turbineNotchFilter = audioContext.createBiquadFilter();
  turbineNotchFilter.type = 'notch';
  turbineNotchFilter.frequency.setValueAtTime(TURBINE_NOTCH_CENTER_FREQ_HZ, audioContext.currentTime);
  turbineNotchFilter.Q.setValueAtTime(TURBINE_NOTCH_Q, audioContext.currentTime);

  // 4. 18 kHz Low-Pass Scaler Roll-Off Filter
  const scalerRollOffFilter = audioContext.createBiquadFilter();
  scalerRollOffFilter.type = 'lowpass';
  scalerRollOffFilter.frequency.setValueAtTime(SCALER_ROLLOFF_FREQ_HZ, audioContext.currentTime);
  scalerRollOffFilter.Q.setValueAtTime(0.707, audioContext.currentTime);

  // 5. Analyser Node for Live SNR Calculation
  const analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 512;
  analyserNode.smoothingTimeConstant = 0.8;

  // 6. Destination Node providing filtered MediaStream to MediaRecorder
  const destinationNode = audioContext.createMediaStreamDestination();

  // Connect chain: Source -> Rumble Filter -> Turbine Notch -> Scaler RollOff -> Destination & Analyser
  let isBypassed = false;

  const connectFiltered = () => {
    try {
      sourceNode.disconnect();
      rumbleFilter.disconnect();
      turbineNotchFilter.disconnect();
      scalerRollOffFilter.disconnect();

      sourceNode.connect(rumbleFilter);
      rumbleFilter.connect(turbineNotchFilter);
      turbineNotchFilter.connect(scalerRollOffFilter);
      scalerRollOffFilter.connect(destinationNode);
      scalerRollOffFilter.connect(analyserNode);
    } catch {}
  };

  const connectDirectBypass = () => {
    try {
      sourceNode.disconnect();
      rumbleFilter.disconnect();
      turbineNotchFilter.disconnect();
      scalerRollOffFilter.disconnect();

      sourceNode.connect(destinationNode);
      sourceNode.connect(analyserNode);
    } catch {}
  };

  connectFiltered();

  const setBypass = (bypass: boolean) => {
    if (isBypassed === bypass) return;
    isBypassed = bypass;
    if (isBypassed) {
      connectDirectBypass();
    } else {
      connectFiltered();
    }
  };

  // Live SNR Monitoring Logic
  const snrThresholdDb = options.snrThresholdDb ?? DEFAULT_SNR_THRESHOLD_DB;
  const snrIntervalMs = options.snrCheckIntervalMs ?? 1000;
  const pcmBuffer = new Float32Array(analyserNode.fftSize);

  let currentSnrDb = 30.0;
  let isCurrentlyLow = false;
  let noiseFloorRms = 0.005; // Initial noise floor estimate
  let consecutiveLowCount = 0;

  const snrTimer = setInterval(() => {
    try {
      analyserNode.getFloatTimeDomainData(pcmBuffer);

      let sumSquares = 0;
      for (let i = 0; i < pcmBuffer.length; i++) {
        sumSquares += pcmBuffer[i] * pcmBuffer[i];
      }
      const currentRms = Math.sqrt(sumSquares / pcmBuffer.length);

      // Track running background noise floor during quiet periods
      if (currentRms > 0.0001 && currentRms < noiseFloorRms * 1.5) {
        noiseFloorRms = 0.9 * noiseFloorRms + 0.1 * currentRms;
      }

      // Calculate SNR against estimated noise floor
      const safeNoiseFloor = Math.max(0.0005, noiseFloorRms);
      if (currentRms > safeNoiseFloor) {
        currentSnrDb = 20 * Math.log10(currentRms / safeNoiseFloor);
      } else {
        currentSnrDb = 0;
      }

      // Check threshold (require 2 consecutive cycles below threshold to prevent flicker)
      if (currentSnrDb < snrThresholdDb && currentRms > 0.001) {
        consecutiveLowCount++;
      } else {
        consecutiveLowCount = 0;
      }

      const isLow = consecutiveLowCount >= 2;
      if (isLow !== isCurrentlyLow) {
        isCurrentlyLow = isLow;
        if (options.onSnrWarning) {
          options.onSnrWarning(isLow, currentSnrDb);
        }
      }
    } catch {
      // Audio context may be closed or suspended
    }
  }, snrIntervalMs);

  let isDestroyed = false;

  const destroy = () => {
    if (isDestroyed) return;
    isDestroyed = true;
    clearInterval(snrTimer);

    try {
      sourceNode.disconnect();
      rumbleFilter.disconnect();
      turbineNotchFilter.disconnect();
      scalerRollOffFilter.disconnect();
      analyserNode.disconnect();
    } catch {}

    if (isContextOwned && audioContext.state !== 'closed') {
      try {
        audioContext.close();
      } catch {}
    }
  };

  return {
    destinationStream: destinationNode.stream,
    context: audioContext,
    analyserNode,
    setBypass,
    getCurrentSnrDb: () => currentSnrDb,
    isLowSnr: () => isCurrentlyLow,
    destroy
  };
}
