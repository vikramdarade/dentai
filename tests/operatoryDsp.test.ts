import { describe, it, expect, vi } from 'vitest';
import {
  createOperatoryDspChain,
  HIGH_PASS_RUMBLE_FREQ_HZ,
  TURBINE_NOTCH_CENTER_FREQ_HZ,
  TURBINE_NOTCH_Q,
  SCALER_ROLLOFF_FREQ_HZ,
  DEFAULT_SNR_THRESHOLD_DB
} from '../src/lib/operatoryAudioDsp';

describe('Operatory Audio DSP Chain (WP 1.0)', () => {
  it('strictly adheres to clinical frequency specifications for dental operatory acoustics', () => {
    // 80 Hz low-frequency compressor and HVAC cut
    expect(HIGH_PASS_RUMBLE_FREQ_HZ).toBe(80);

    // Handpiece turbine notch centered in 5,000 Hz - 7,500 Hz with Q = 7.0
    expect(TURBINE_NOTCH_CENTER_FREQ_HZ).toBeGreaterThanOrEqual(5000);
    expect(TURBINE_NOTCH_CENTER_FREQ_HZ).toBeLessThanOrEqual(7500);
    expect(TURBINE_NOTCH_CENTER_FREQ_HZ).toBe(6250);
    expect(TURBINE_NOTCH_Q).toBe(7.0);

    // Ultrasonic scaler roll-off at 18 kHz
    expect(SCALER_ROLLOFF_FREQ_HZ).toBe(18000);

    // SNR threshold set to 12 dB for operatory warning
    expect(DEFAULT_SNR_THRESHOLD_DB).toBe(12.0);
  });

  it('safely falls back without throwing when Web Audio API is unavailable in headless environments', () => {
    const mockTrack = { stop: vi.fn(), kind: 'audio' };
    const mockStream: any = {
      getAudioTracks: () => [mockTrack],
      clone: () => mockStream
    };

    const dsp = createOperatoryDspChain(mockStream);
    expect(dsp).toBeDefined();
    expect(dsp.destinationStream).toBeDefined();
    expect(dsp.getCurrentSnrDb()).toBeGreaterThanOrEqual(12.0);
    expect(dsp.isLowSnr()).toBe(false);

    // Should teardown without throwing (Rule 14 cross-patient boundary)
    expect(() => dsp.destroy()).not.toThrow();
  });

  it('handles simulated AudioContext nodes correctly when Web Audio is mocked', () => {
    const mockBiquad = () => ({
      type: '',
      frequency: { setValueAtTime: vi.fn() },
      Q: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn()
    });

    const mockAnalyser = {
      fftSize: 0,
      smoothingTimeConstant: 0,
      getFloatTimeDomainData: vi.fn((buf) => buf.fill(0.05)),
      connect: vi.fn(),
      disconnect: vi.fn()
    };

    const mockDestination = {
      stream: { getAudioTracks: () => [{ stop: vi.fn() }] }
    };

    const mockSource = {
      connect: vi.fn(),
      disconnect: vi.fn()
    };

    const mockAudioContext: any = {
      createMediaStreamSource: vi.fn(() => mockSource),
      createBiquadFilter: vi.fn(() => mockBiquad()),
      createAnalyser: vi.fn(() => mockAnalyser),
      createMediaStreamDestination: vi.fn(() => mockDestination),
      currentTime: 0,
      state: 'running',
      close: vi.fn()
    };

    const mockStream: any = {
      getAudioTracks: () => [{ stop: vi.fn(), kind: 'audio' }]
    };

    // Temporarily inject AudioContext into global
    (globalThis as any).AudioContext = vi.fn(() => mockAudioContext);

    try {
      const dsp = createOperatoryDspChain(mockStream, { audioContext: mockAudioContext });
      expect(dsp.destinationStream).toBe(mockDestination.stream);
      expect(mockAudioContext.createBiquadFilter).toHaveBeenCalledTimes(3);

      dsp.destroy();
      expect(mockSource.disconnect).toHaveBeenCalled();
    } finally {
      delete (globalThis as any).AudioContext;
    }
  });
});
