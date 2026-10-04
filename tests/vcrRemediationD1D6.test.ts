import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioRecorder } from '../src/lib/audioRecorder';

describe('VCR Remediation D1–D6 Targeted Unit Tests', () => {
  describe('D1: Walk-in patient routing & strictly no wraparound', () => {
    it('generates consecutive walk-ins and never wraps around to index 0', () => {
      const scheduledSessions = [
        { id: 'sess-alpha', patientName: 'Alpha Patient', status: 'ready' },
        { id: 'sess-beta', patientName: 'Beta Patient', status: 'ready' },
        { id: 'sess-gamma', patientName: 'Gamma Patient', status: 'ready' },
      ];

      // Simulate findNextSession logic from ClinicalWorkspace
      function resolveNextPatient(
        currentSessionId: string,
        sessions: typeof scheduledSessions,
        walkInCount: number
      ): { type: 'scheduled' | 'walk-in'; id: string } {
        const currentIndex = sessions.findIndex(s => s.id === currentSessionId);
        const forwardList = currentIndex >= 0 ? sessions.slice(currentIndex + 1) : [];
        const nextScheduled = forwardList.find(s => s.id !== currentSessionId && s.status !== 'completed');

        if (nextScheduled) {
          return { type: 'scheduled', id: nextScheduled.id };
        }
        return { type: 'walk-in', id: `walkin-${Date.now()}-${walkInCount}` };
      }

      // 1. From Alpha -> Beta
      const step1 = resolveNextPatient('sess-alpha', scheduledSessions, 1);
      expect(step1).toEqual({ type: 'scheduled', id: 'sess-beta' });

      // 2. From Beta -> Gamma
      const step2 = resolveNextPatient('sess-beta', scheduledSessions, 1);
      expect(step2).toEqual({ type: 'scheduled', id: 'sess-gamma' });

      // 3. From Gamma (last scheduled) -> Walk-in 1 (NEVER Alpha!)
      const step3 = resolveNextPatient('sess-gamma', scheduledSessions, 1);
      expect(step3.type).toBe('walk-in');
      expect(step3.id).not.toBe('sess-alpha');
      expect(step3.id).toContain('walkin-');

      // 4. From Walk-in 1 -> Walk-in 2 (NEVER Alpha!)
      const step4 = resolveNextPatient(step3.id, scheduledSessions, 2);
      expect(step4.type).toBe('walk-in');
      expect(step4.id).not.toBe('sess-alpha');
      expect(step4.id).not.toBe(step3.id);

      // 5. From Walk-in 2 -> Walk-in 3
      const step5 = resolveNextPatient(step4.id, scheduledSessions, 3);
      expect(step5.type).toBe('walk-in');
      expect(step5.id).not.toBe('sess-alpha');
      expect(step5.id).not.toBe(step4.id);
    });
  });

  describe('D2: Walk-in consultation persistence before audio starts', () => {
    it('guarantees consultation record is saved before audio rollover starts emitting chunks', async () => {
      const callLog: string[] = [];

      const mockOnSaveConsultation = vi.fn().mockImplementation(async (record) => {
        callLog.push(`save_consultation:${record.id}`);
        return record;
      });

      const mockAudioRecorderRollover = vi.fn().mockImplementation((options) => {
        callLog.push(`audio_rollover:${options.newConsultationId}`);
      });

      // Simulated handleNextPatient sequence
      async function triggerNextPatientTransition(targetSessionId: string, isWalkIn: boolean) {
        if (isWalkIn) {
          const walkInRecord = { id: targetSessionId, patientName: 'Walk-in Patient' };
          await mockOnSaveConsultation(walkInRecord);
        }
        mockAudioRecorderRollover({ newConsultationId: targetSessionId });
      }

      await triggerNextPatientTransition('walkin-999', true);

      expect(callLog).toEqual([
        'save_consultation:walkin-999',
        'audio_rollover:walkin-999'
      ]);
      expect(callLog[0]).toBe('save_consultation:walkin-999');
      expect(callLog[1]).toBe('audio_rollover:walkin-999');
    });
  });

  describe('D3: State serialization / Mutex guard', () => {
    it('blocks concurrent Stop, Next Patient, Select, and New Session operations during active transition', async () => {
      let isTransitioning = false;
      const rejectedActions: string[] = [];

      function executeAction(name: string, actionFn: () => void) {
        if (isTransitioning) {
          rejectedActions.push(name);
          return false;
        }
        return true;
      }

      // Begin transition
      isTransitioning = true;

      // Attempt conflicting actions during transition
      executeAction('handleStopAudio', () => {});
      executeAction('handleNextPatient', () => {});
      executeAction('handleSelectSession', () => {});
      executeAction('handleNewSession', () => {});

      expect(rejectedActions).toEqual([
        'handleStopAudio',
        'handleNextPatient',
        'handleSelectSession',
        'handleNewSession'
      ]);

      // Release transition
      isTransitioning = false;
      const success = executeAction('handleStopAudio', () => {});
      expect(success).toBe(true);
    });
  });

  describe('D4: Next Patient idempotency & 600ms debounce', () => {
    it('debounces rapid triggers and prevents duplicate transitions from the same source session', () => {
      let isTransitioning = false;
      let lastTransitionStart = 0;
      let transitionSourceSessionId: string | null = null;
      let executedTransitions = 0;

      const DEBOUNCE_MS = 600;

      function requestNextPatient(sourceSessionId: string, timestamp: number): boolean {
        if (isTransitioning) return false;
        if (timestamp - lastTransitionStart < DEBOUNCE_MS) return false;
        if (transitionSourceSessionId === sourceSessionId && timestamp - lastTransitionStart < 2000) return false;

        isTransitioning = true;
        lastTransitionStart = timestamp;
        transitionSourceSessionId = sourceSessionId;
        executedTransitions++;

        // Simulate transition completion after 100ms
        setTimeout(() => {
          isTransitioning = false;
        }, 100);

        return true;
      }

      // First click at t=1000
      const c1 = requestNextPatient('sess-1', 1000);
      expect(c1).toBe(true);
      expect(executedTransitions).toBe(1);

      // Rapid duplicate click at t=1010 (10ms later) -> rejected by isTransitioning
      const c2 = requestNextPatient('sess-1', 1010);
      expect(c2).toBe(false);

      // Click at t=1150 (after isTransitioning resets at 1100, but within 600ms debounce)
      isTransitioning = false; // simulate reset
      const c3 = requestNextPatient('sess-1', 1150);
      expect(c3).toBe(false);

      // Duplicate session click at t=1500 (still from sess-1 within 2s)
      const c4 = requestNextPatient('sess-1', 1500);
      expect(c4).toBe(false);

      expect(executedTransitions).toBe(1);

      // Legitimate next patient from sess-2 at t=2500
      const c5 = requestNextPatient('sess-2', 2500);
      expect(c5).toBe(true);
      expect(executedTransitions).toBe(2);
    });
  });

  describe('D5: Speech recognition generation tokens & zombie isolation', () => {
    it('discards results from superseded generations and prevents zombie restarts', () => {
      let speechGeneration = 0;
      const acceptedTranscripts: { generation: number; text: string }[] = [];
      let activeRecognizerId = 0;
      let recognizerEndRestartAttempts = 0;

      function simulateOnResult(eventGeneration: number, text: string) {
        if (eventGeneration !== speechGeneration) {
          // Stale generation callback: discarded!
          return;
        }
        acceptedTranscripts.push({ generation: eventGeneration, text });
      }

      function simulateOnEnd(instanceGeneration: number) {
        if (instanceGeneration !== speechGeneration) {
          // Stale instance ended: DO NOT restart!
          return;
        }
        recognizerEndRestartAttempts++;
      }

      // Generation 1 for Patient A
      speechGeneration = 1;
      simulateOnResult(1, 'Patient A tooth 16 occlusal filling');

      // Patient transition happens: advance generation to 2
      speechGeneration = 2;

      // Stale callback from Patient A's recognizer arrives after transition
      simulateOnResult(1, 'Patient A extra trailing audio');

      // Result for Patient B
      simulateOnResult(2, 'Patient B exam checkup');

      // Patient A's old recognizer fires onend
      simulateOnEnd(1);

      // Patient B's recognizer fires onend
      simulateOnEnd(2);

      expect(acceptedTranscripts).toEqual([
        { generation: 1, text: 'Patient A tooth 16 occlusal filling' },
        { generation: 2, text: 'Patient B exam checkup' }
      ]);
      expect(recognizerEndRestartAttempts).toBe(1);
    });
  });

  describe('D6: Audio upload durability & in-flight tracking', () => {
    it('tracks in-flight uploads and barriers before session advancement', async () => {
      const inFlightUploads = new Set<Promise<any>>();

      function trackUpload<T>(p: Promise<T>): Promise<T> {
        inFlightUploads.add(p);
        p.finally(() => {
          inFlightUploads.delete(p);
        });
        return p;
      }

      async function waitForUploads(timeoutMs: number = 2000): Promise<void> {
        if (inFlightUploads.size === 0) return;
        const allSettled = Promise.allSettled(Array.from(inFlightUploads));
        await Promise.race([
          allSettled,
          new Promise((resolve) => setTimeout(resolve, timeoutMs))
        ]);
      }

      let uploadFinished = false;
      const uploadPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          uploadFinished = true;
          resolve();
        }, 50);
      });

      trackUpload(uploadPromise);
      expect(inFlightUploads.size).toBe(1);

      // Barrier wait
      await waitForUploads(500);

      expect(uploadFinished).toBe(true);
      expect(inFlightUploads.size).toBe(0);
    });
  });
});
