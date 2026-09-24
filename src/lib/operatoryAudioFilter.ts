/**
 * Operatory Acoustic Filter (Web Audio API)
 *
 * Provides real-time acoustic signal conditioning for dental operatories:
 * 1. High-Pass Filter (80 Hz, Q 0.707) to eliminate low-frequency compressor hum,
 *    chair motor vibration, and HVAC rumble while preserving low male vocal fundamentals.
 * 2. Handpiece Turbine Notch Filter (5,000–7,500 Hz, center 6,250 Hz, Q 7.0) to eliminate
 *    high-speed air turbine whining without distorting vocal frequencies.
 * 3. Low-Pass Filter (18,000 Hz, Q 0.707) anti-aliasing / roll-off preserving dental sibilants.
 * 4. Graceful pass-through fallback for environments where AudioContext is restricted.
 */

import {
  createOperatoryDspChain,
  OPERATORY_DSP_DEFAULTS,
  type OperatoryDspChain
} from './operatoryAudioDsp';

export interface FilteredAudioSession {
  filteredStream: MediaStream;
  audioContext: AudioContext;
  dspChain?: OperatoryDspChain;
  close: () => void;
}

export const OPERATORY_AUDIO_DEFAULTS = {
  highPassFreq: OPERATORY_DSP_DEFAULTS.highPassFreqHz,
  lowPassFreq: OPERATORY_DSP_DEFAULTS.lowPassFreqHz,
  turbineNotchFreq: OPERATORY_DSP_DEFAULTS.handpieceNotchCenterHz,
  turbineNotchQ: OPERATORY_DSP_DEFAULTS.handpieceNotchQ,
  q: OPERATORY_DSP_DEFAULTS.butterworthQ,
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
    const dsp = createOperatoryDspChain(rawStream, { audioContext });

    const close = () => {
      try {
        dsp.destroy();
        if (audioContext.state !== 'closed') {
          audioContext.close();
        }
      } catch (err) {
        console.warn('[OperatoryAudioFilter] Error closing audio context:', err);
      }
    };

    return {
      filteredStream: dsp.destinationStream,
      audioContext,
      dspChain: dsp,
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
