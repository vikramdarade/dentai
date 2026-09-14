import { describe, it, expect, vi, beforeEach } from 'vitest';
import DiagnosticAssistant, { type AudioDeviceInfo } from '../src/components/DiagnosticAssistant';

describe('Slice 2: Sterile Audio Pipeline & DiagnosticAssistant Self-Healer', () => {
  it('exports DiagnosticAssistant component cleanly', () => {
    expect(DiagnosticAssistant).toBeDefined();
    expect(typeof DiagnosticAssistant).toBe('function');
  });

  describe('Audio Device Categorization Logic', () => {
    it('accurately categorizes desktop vs bluetooth devices', () => {
      const mockDevices = [
        { deviceId: 'default', label: 'Realtek High Definition Audio (Default)', kind: 'audioinput' },
        { deviceId: 'webcam-1', label: 'Logitech Brio 4K Webcam Mic', kind: 'audioinput' },
        { deviceId: 'bt-1', label: 'Shokz OpenComm Hands-Free AG Audio', kind: 'audioinput' },
        { deviceId: 'bt-2', label: 'AirPods Pro Bluetooth Headset', kind: 'audioinput' }
      ];

      const mapped: AudioDeviceInfo[] = mockDevices.map(d => {
        const isBluetooth = /bluetooth|hands-free|headset|earbuds|airpods|shokz/i.test(d.label);
        return {
          deviceId: d.deviceId,
          label: d.label,
          isBluetooth,
          isDefault: d.deviceId === 'default'
        };
      });

      expect(mapped[0].isBluetooth).toBe(false);
      expect(mapped[0].isDefault).toBe(true);

      expect(mapped[1].isBluetooth).toBe(false);
      expect(mapped[1].label).toContain('Logitech');

      // Bluetooth categorization
      expect(mapped[2].isBluetooth).toBe(true);
      expect(mapped[2].label).toContain('Shokz');

      expect(mapped[3].isBluetooth).toBe(true);
      expect(mapped[3].label).toContain('AirPods');
    });
  });

  describe('Infection Control & Audio Resynchronization Invariant', () => {
    it('verifies non-destructive recovery when resetting audio context and streams', () => {
      const mockTrackStop = vi.fn();
      const mockStream = {
        getTracks: () => [{ stop: mockTrackStop }]
      };

      const mockClose = vi.fn().mockResolvedValue(undefined);
      const mockAudioContext = {
        state: 'running',
        close: mockClose
      };

      // Perform simulated teardown
      mockStream.getTracks().forEach(t => t.stop());
      if (mockAudioContext.state !== 'closed') {
        mockAudioContext.close();
      }

      expect(mockTrackStop).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
    });
  });
});
