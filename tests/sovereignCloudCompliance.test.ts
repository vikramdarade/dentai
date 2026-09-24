import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CircuitBreaker,
  encryptPayload,
  decryptPayload,
  purgeAudioPayload,
  activeAudioRegistry,
  SovereignRouter
} from '../src/sovereignty';
import { formatAsClinicalBullets } from '../src/lib/draftEngine';

/**
 * Test Specification: Work Package 4.0 - Sovereign Cloud Architecture & Compliance (APP 8)
 *
 * Validates:
 * 1. Australian Privacy Principle 8 (APP 8) Sydney Sovereign Residency
 * 2. Multi-Provider Circuit Breaker State Transitions
 * 3. 4-Tier Sovereign Redundancy Failover Chain
 * 4. AES-256-GCM Cryptographic Envelope Integrity
 * 5. Rule 16 Immediate Raw Audio Scrubbing
 * 6. Structured Clinical Bullet Formatting
 */

describe('Work Package 4.0: Sovereign Cloud Architecture & Compliance (APP 8)', () => {
  describe('4.1 Multi-Provider Circuit Breaker', () => {
    let breaker: CircuitBreaker;

    beforeEach(() => {
      breaker = new CircuitBreaker({
        name: 'test-vertex-sydney',
        failureThreshold: 2,
        resetTimeoutMs: 1000,
        halfOpenSuccessThreshold: 1
      });
    });

    it('starts in CLOSED state and allows execution', () => {
      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.canExecute()).toBe(true);
    });

    it('trips OPEN immediately on 429 Too Many Requests / Quota Exhaustion', () => {
      breaker.recordFailure(true); // isQuotaOr429 = true
      expect(breaker.getState()).toBe('OPEN');
      expect(breaker.canExecute()).toBe(false);
    });

    it('trips OPEN after reaching consecutive failure threshold', () => {
      breaker.recordFailure(false);
      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.canExecute()).toBe(true);

      breaker.recordFailure(false);
      expect(breaker.getState()).toBe('OPEN');
      expect(breaker.canExecute()).toBe(false);
    });

    it('transitions to HALF_OPEN after cool-down timeout and closes upon success', async () => {
      breaker.recordFailure(true);
      expect(breaker.getState()).toBe('OPEN');
      expect(breaker.canExecute()).toBe(false);

      // Fast-forward past resetTimeoutMs (1000ms)
      await new Promise((r) => setTimeout(r, 1050));

      expect(breaker.canExecute()).toBe(true);
      expect(breaker.getState()).toBe('HALF_OPEN');

      breaker.recordSuccess();
      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.canExecute()).toBe(true);
    });
  });

  describe('4.2 Sovereign Failover Router (APP 8 Sydney Residency)', () => {
    const mockTranscript = [
      { sender: 'Dentist', text: 'Examined tooth 16 occlusal caries.' },
      { sender: 'Patient', text: 'It feels slightly sensitive.' }
    ];

    it('routes through Tier 1 (Vertex AI Sydney) when healthy and stamps APP 8 metadata', async () => {
      const mockVertex = vi.fn().mockResolvedValue({
        canonical: { toothFindings: 'Tooth 16: Occlusal caries.' }
      });

      const router = new SovereignRouter({
        vertexProject: 'gcp-dentai-au',
        vertexLocation: 'australia-southeast1',
        executeVertexCall: mockVertex
      });

      const result = await router.execute({
        transcript: mockTranscript,
        noteTemplateName: 'standard'
      });

      expect(result.ok).toBe(true);
      expect(mockVertex).toHaveBeenCalledTimes(1);
      expect(result.sovereignty.tierUsed).toBe('tier1-vertex-sydney');
      expect(result.sovereignty.dataSovereignty).toBe('AU_SYDNEY');
      expect(result.sovereignty.jurisdiction).toBe('APP_8_COMPLIANT');
      expect(result.sovereignty.region).toBe('australia-southeast1');
      expect(result.sovereignty.zeroRetentionConfirmed).toBe(true);
      expect(result.sovereignty.audioPurgedAt).toBeDefined();
    });

    it('fails over to Tier 2 (Hosted Secondary Key) when Tier 1 throws 429', async () => {
      const mockVertex = vi.fn().mockRejectedValue({
        status: 429,
        message: 'Resource exhausted (quota exceeded)'
      });
      const mockSecondary = vi.fn().mockResolvedValue({
        canonical: { toothFindings: 'Tooth 16: Restored via secondary.' }
      });

      const router = new SovereignRouter({
        executeVertexCall: mockVertex,
        executeSecondaryCall: mockSecondary
      });

      const result = await router.execute({
        transcript: mockTranscript,
        noteTemplateName: 'standard'
      });

      expect(result.ok).toBe(true);
      expect(mockVertex).toHaveBeenCalledTimes(1);
      expect(mockSecondary).toHaveBeenCalledTimes(1);
      expect(result.sovereignty.tierUsed).toBe('tier2-hosted-secondary');
      expect(result.sovereignty.dataSovereignty).toBe('AU_SYDNEY');
      expect(router.tier1Breaker.getState()).toBe('OPEN');
    });

    it('fails over to Tier 3 (Local LAN GPU) when cloud routes are down', async () => {
      const mockVertex = vi.fn().mockRejectedValue(new Error('Cloud outage'));
      const mockSecondary = vi.fn().mockRejectedValue(new Error('Cloud outage'));
      const mockLocalLan = vi.fn().mockResolvedValue({
        canonical: { toothFindings: 'Tooth 16: Restored via local clinic llama server.' }
      });

      const router = new SovereignRouter({
        tier1BreakerConfig: { failureThreshold: 1, resetTimeoutMs: 5000 },
        tier2BreakerConfig: { failureThreshold: 1, resetTimeoutMs: 5000 },
        executeVertexCall: mockVertex,
        executeSecondaryCall: mockSecondary,
        executeLocalLanCall: mockLocalLan
      });

      const result = await router.execute({
        transcript: mockTranscript,
        noteTemplateName: 'standard'
      });

      expect(result.ok).toBe(true);
      expect(mockLocalLan).toHaveBeenCalledTimes(1);
      expect(result.sovereignty.tierUsed).toBe('tier3-local-lan');
      expect(result.sovereignty.dataSovereignty).toBe('AU_LOCAL_ONPREM');
    });

    it('gracefully degrades to Tier 4 (Deterministic Offline Draft) during total network failure', async () => {
      const mockVertex = vi.fn().mockRejectedValue(new Error('Network down'));
      const mockSecondary = vi.fn().mockRejectedValue(new Error('Network down'));
      const mockLocalLan = vi.fn().mockRejectedValue(new Error('Server off'));

      const router = new SovereignRouter({
        tier1BreakerConfig: { failureThreshold: 1, resetTimeoutMs: 5000 },
        tier2BreakerConfig: { failureThreshold: 1, resetTimeoutMs: 5000 },
        executeVertexCall: mockVertex,
        executeSecondaryCall: mockSecondary,
        executeLocalLanCall: mockLocalLan
      });

      const result = await router.execute({
        transcript: mockTranscript,
        noteTemplateName: 'standard'
      });

      expect(result.ok).toBe(true);
      expect(result.sovereignty.tierUsed).toBe('tier4-offline-deterministic');
      expect(result.sovereignty.dataSovereignty).toBe('OFFLINE_DETERMINISTIC');
      expect(result.output.canonical).toBeDefined();
    });
  });

  describe('4.3 AES-256-GCM Envelope Encryption & Zero-Retention Scrubbing', () => {
    it('encrypts and decrypts clinical payload with authenticated tag verification', () => {
      const secretRecord = {
        patientName: 'Jane Citizen',
        medications: ['Warfarin 5mg', 'Metformin 500mg'],
        diagnosis: 'Tooth 48 pericoronitis'
      };

      const envelope = encryptPayload(secretRecord, 'test-secret-key-australia-sydney');
      expect(envelope.algorithm).toBe('aes-256-gcm');
      expect(envelope.iv).toHaveLength(24); // 12 bytes = 24 hex chars
      expect(envelope.authTag).toHaveLength(32); // 16 bytes = 32 hex chars
      expect(envelope.ciphertext).not.toContain('Jane Citizen');

      const decrypted = decryptPayload(envelope, 'test-secret-key-australia-sydney');
      expect(JSON.parse(decrypted)).toEqual(secretRecord);
    });

    it('rejects tampered ciphertext during GCM authentication verification', () => {
      const envelope = encryptPayload('Critical Clinical Information');
      // Tamper with the ciphertext
      const tamperedCiphertext = envelope.ciphertext.slice(0, -2) + (envelope.ciphertext.endsWith('a') ? 'b' : 'a');
      const tamperedEnvelope = { ...envelope, ciphertext: tamperedCiphertext };

      expect(() => decryptPayload(tamperedEnvelope)).toThrow();
    });

    it('enforces Rule 16: scrubs raw operatory audio buffer from memory immediately', () => {
      const sliceId = 'chunk-recording-042';
      const audioBuffer = Buffer.from('RAW_OPERATORY_VOICE_STREAM_DATA_NOT_SAVED');

      activeAudioRegistry.set(sliceId, {
        buffer: audioBuffer,
        timestamp: Date.now()
      });

      expect(activeAudioRegistry.has(sliceId)).toBe(true);
      expect(audioBuffer.toString('utf8')).toContain('RAW_OPERATORY_VOICE');

      const purgeResult = purgeAudioPayload(sliceId, activeAudioRegistry);

      expect(purgeResult.purged).toBe(true);
      expect(activeAudioRegistry.has(sliceId)).toBe(false);
      // Verify buffer memory was cryptographically zeroed
      expect(audioBuffer.every((byte) => byte === 0)).toBe(true);
    });
  });

  describe('4.4 Structured Clinical Bullet Formatting V2', () => {
    it('formats multi-sentence findings into clean clinical bullets', () => {
      const rawText = 'Deep caries on tooth 16 occlusal. Rubber dam placed. Restored with composite resin.';
      const bulleted = formatAsClinicalBullets(rawText);

      expect(bulleted).toContain('• Deep caries on tooth 16 occlusal.');
      expect(bulleted).toContain('• Rubber dam placed.');
      expect(bulleted).toContain('• Restored with composite resin.');
    });

    it('keeps single sentence text unchanged without unnecessary bulleting', () => {
      const single = 'No soft tissue abnormalities detected.';
      expect(formatAsClinicalBullets(single)).toBe(single);
    });
  });
});
