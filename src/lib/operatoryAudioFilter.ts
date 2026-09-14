/**
 * Operatory Acoustic Filter & Room-Mic DSP Chain (Web Audio API)
 *
 * Provides real-time acoustic signal conditioning specifically tuned for dental operatories
 * using existing surgery PC/monitor room microphones (zero body-worn hardware):
 *
 * 1. High-Pass Filter (120 Hz, Q=0.707): Cuts compressor rumble, HVAC roar, and dental chair hydraulic motor vibration.
 * 2. High-Speed Turbine Notch Filter (4200 Hz, Q=4.5): Sharp attenuation of high-speed air-turbine whine and suction whistles.
 * 3. Surgical Mask Presence EQ (2800 Hz peaking, +3.5 dB, Q=1.2): Counteracts acoustic treble roll-off caused by ASTM Level 3 surgical masks.
 * 4. Room Distance Automatic Gain & Compression (DynamicsCompressorNode + GainNode): Normalizes speech amplitude across 1.5m - 2.0m distances,
 *    compensating for dentists turning between patient oral cavity and tray/screen.
 * 5. Anti-Alias Low-Pass Filter (5500 Hz, Q=0.707): Cuts ultrasonic scaler harmonics above intelligible human speech.
 * 6. Graceful pass-through fallback for restricted browser contexts.
 */

export interface FilteredAudioSession {
  filteredStream: MediaStream;
  audioContext: AudioContext;
  close: () => void;
}

export const OPERATORY_AUDIO_DEFAULTS = {
  highPassFreq: 120,
  drillNotchFreq: 4200,
  maskBoostFreq: 2800,
  maskBoostGainDb: 3.5,
  roomDistanceGain: 2.2, // ~ +6.8 dB digital distance compensation
  lowPassFreq: 5500,
  q: 0.707,
} as const;

export function createOperatoryAudioStream(rawStream: MediaStream): FilteredAudioSession {
  try {
    const AudioContextClass = typeof window !== 'undefined'
      ? (window.AudioContext || (window as any).webkitAudioContext)
      : null;
    if (!AudioContextClass) {
      return {
        filteredStream: rawStream,
        audioContext: null as any,
        close: () => {}
      };
    }

    const audioContext = new AudioContextClass();
    const source = audioContext.createMediaStreamSource(rawStream);

    // 1. High-pass filter: 120Hz (cuts motor & HVAC rumble)
    const highPass = audioContext.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = OPERATORY_AUDIO_DEFAULTS.highPassFreq;
    highPass.Q.value = OPERATORY_AUDIO_DEFAULTS.q;

    // 2. Surgical drill notch filter: 4200Hz (sharp air-turbine screech elimination)
    const drillNotch = audioContext.createBiquadFilter();
    drillNotch.type = 'notch';
    drillNotch.frequency.value = OPERATORY_AUDIO_DEFAULTS.drillNotchFreq;
    drillNotch.Q.value = 4.5;

    // 3. Mask presence EQ: 2800Hz peaking +3.5dB (recovers muffled mask speech)
    const maskBoost = audioContext.createBiquadFilter();
    maskBoost.type = 'peaking';
    maskBoost.frequency.value = OPERATORY_AUDIO_DEFAULTS.maskBoostFreq;
    maskBoost.gain.value = OPERATORY_AUDIO_DEFAULTS.maskBoostGainDb;
    maskBoost.Q.value = 1.2;

    // 4. Dynamics Compressor: Levels speech whether dentist speaks into mouth or turns to tray
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -24; // dB
    compressor.knee.value = 12; // dB
    compressor.ratio.value = 6; // 6:1 compression ratio
    compressor.attack.value = 0.003; // 3ms fast attack
    compressor.release.value = 0.25; // 250ms release

    // 5. Room Distance Gain Compensation (+6.8 dB gain for 1.5 - 2m distance)
    const distanceGain = audioContext.createGain();
    distanceGain.gain.value = OPERATORY_AUDIO_DEFAULTS.roomDistanceGain;

    // 6. Anti-Alias Low-Pass: 5500Hz (cuts ultrasonic scaler high harmonics)
    const lowPass = audioContext.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.value = OPERATORY_AUDIO_DEFAULTS.lowPassFreq;
    lowPass.Q.value = OPERATORY_AUDIO_DEFAULTS.q;

    // Connect nodes in sequence:
    // Source -> HighPass -> DrillNotch -> MaskBoost -> Compressor -> DistanceGain -> LowPass -> Destination
    const destination = audioContext.createMediaStreamDestination();
    source.connect(highPass);
    highPass.connect(drillNotch);
    drillNotch.connect(maskBoost);
    maskBoost.connect(compressor);
    compressor.connect(distanceGain);
    distanceGain.connect(lowPass);
    lowPass.connect(destination);

    const filteredStream = destination.stream;

    const close = () => {
      try {
        source.disconnect();
        highPass.disconnect();
        drillNotch.disconnect();
        maskBoost.disconnect();
        compressor.disconnect();
        distanceGain.disconnect();
        lowPass.disconnect();
        if (audioContext.state !== 'closed') {
          audioContext.close();
        }
      } catch (err) {
        console.warn('[OperatoryAudioFilter] Error closing audio context:', err);
      }
    };

    return {
      filteredStream,
      audioContext,
      close
    };
  } catch (err) {
    console.warn('[OperatoryAudioFilter] Web Audio filtering unavailable, using raw stream:', err);
    return {
      filteredStream: rawStream,
      audioContext: null as any,
      close: () => {}
    };
  }
}
