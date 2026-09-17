/**
 * Operatory Acoustic Filter (Web Audio API)
 *
 * Provides real-time acoustic signal conditioning for dental operatories:
 * 1. High-Pass Filter (120 Hz) to eliminate low-frequency compressor hum,
 *    chair motor vibration, and HVAC rumble.
 * 2. Low-Pass Filter (4200 Hz) to suppress high-pitched ultrasonic scaler
 *    whistle, turbine whine, and suction air hiss.
 * 3. Graceful pass-through fallback for environments where AudioContext is restricted.
 */

export interface FilteredAudioSession {
  filteredStream: MediaStream;
  audioContext: AudioContext;
  close: () => void;
}

export const OPERATORY_AUDIO_DEFAULTS = {
  highPassFreq: 120,
  lowPassFreq: 4200,
  q: 0.707,
} as const;

export function createOperatoryAudioStream(rawStream: MediaStream): FilteredAudioSession {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
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
    highPass.frequency.value = 120;
    highPass.Q.value = 0.707;

    // 2. Low-pass filter: 4200Hz (cuts ultrasonic scaler whine & suction hiss)
    const lowPass = audioContext.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.value = 4200;
    lowPass.Q.value = 0.707;

    // 3. Connect nodes in series: Source -> HighPass -> LowPass -> Destination
    const destination = audioContext.createMediaStreamDestination();
    source.connect(highPass);
    highPass.connect(lowPass);
    lowPass.connect(destination);

    const filteredStream = destination.stream;

    const close = () => {
      try {
        source.disconnect();
        highPass.disconnect();
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
