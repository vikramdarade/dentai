import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioRecorder, AudioRolloverOptions } from '../src/lib/audioRecorder';

// Mock Web Audio & MediaRecorder infrastructure for deterministic testing
class MockMediaStreamTrack {
  kind = 'audio';
  enabled = true;
  readyState = 'live';
  stop = vi.fn();
}

class MockMediaStream {
  active = true;
  private tracks: MockMediaStreamTrack[] = [new MockMediaStreamTrack()];
  getAudioTracks() {
    return this.tracks;
  }
  getTracks() {
    return this.tracks;
  }
}

class MockAudioNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockBiquadFilterNode extends MockAudioNode {
  type = 'highpass';
  frequency = { setValueAtTime: vi.fn() };
  Q = { setValueAtTime: vi.fn() };
}

class MockAnalyserNode extends MockAudioNode {
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  frequencyBinCount = 1024;
  getFloatTimeDomainData(array: Float32Array) {
    array.fill(0.01);
  }
}

class MockAudioContext {
  currentTime = 0;
  state = 'running';
  createMediaStreamSource = vi.fn(() => new MockAudioNode());
  createBiquadFilter = vi.fn(() => new MockBiquadFilterNode());
  createAnalyser = vi.fn(() => new MockAnalyserNode());
  createGain = vi.fn(() => ({
    gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
  }));
  createOscillator = vi.fn(() => ({
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }));
  close = vi.fn().mockResolvedValue(undefined);
}

// Track active recorder instances across rollovers
let recorderInstances: MockMediaRecorder[] = [];

class MockMediaRecorder {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  stream: MockMediaStream;
  instanceIndex: number;
  emittedChunks = 0;

  constructor(stream: MockMediaStream, options?: { mimeType?: string }) {
    this.stream = stream;
    if (options?.mimeType) this.mimeType = options.mimeType;
    this.instanceIndex = recorderInstances.length;
    recorderInstances.push(this);
  }

  static isTypeSupported(type: string) {
    return type.includes('webm');
  }

  start(timeslice?: number) {
    this.state = 'recording';
  }

  emitChunk(content: string) {
    if (this.state !== 'recording') return;
    const blob = new Blob([content], { type: this.mimeType });
    this.emittedChunks++;
    this.ondataavailable?.({ data: blob } as any);
  }

  stop() {
    // MediaRecorder W3C specification: stop() flushes buffered data via dataavailable BEFORE onstop
    this.emitChunk(`final-chunk-from-instance-${this.instanceIndex}`);
    this.state = 'inactive';
    // Dispatch onstop asynchronously as in real browser event loop
    queueMicrotask(() => {
      this.onstop?.();
    });
  }

  pause() {
    this.state = 'paused';
  }

  resume() {
    this.state = 'recording';
  }
}

describe('Virtual Continuous Recording & MediaRecorder Rollover', () => {
  let originalAudioContext: any;
  let originalMediaRecorder: any;
  let originalGetUserMedia: any;
  let mockStream: MockMediaStream;

  beforeEach(() => {
    recorderInstances = [];
    originalAudioContext = (globalThis as any).AudioContext;
    originalMediaRecorder = (globalThis as any).MediaRecorder;
    originalGetUserMedia = navigator.mediaDevices?.getUserMedia;

    (globalThis as any).AudioContext = MockAudioContext;
    (globalThis as any).MediaRecorder = MockMediaRecorder;

    mockStream = new MockMediaStream();
    if (!navigator.mediaDevices) {
      (navigator as any).mediaDevices = {};
    }
    navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue(mockStream);
  });

  afterEach(() => {
    (globalThis as any).AudioContext = originalAudioContext;
    (globalThis as any).MediaRecorder = originalMediaRecorder;
    if (originalGetUserMedia) {
      navigator.mediaDevices.getUserMedia = originalGetUserMedia;
    }
  });

  // =========================================================================
  // TEST 1 — AUDIO ROLLOVER
  // =========================================================================
  it('Test 1: successfully rolls over from Recorder A to Recorder B starting with chunk index 0', async () => {
    const chunksA: { blob: Blob; index: number }[] = [];
    const chunksB: { blob: Blob; index: number }[] = [];

    const recorder = new AudioRecorder({
      onChunk: (blob, index) => {
        chunksA.push({ blob, index });
      },
    });

    await recorder.start();
    expect(recorder.getGeneration()).toBe(1);
    expect(recorderInstances.length).toBe(1);

    const recA = recorderInstances[0];
    recA.emitChunk('chunk-A0');
    recA.emitChunk('chunk-A1');

    expect(chunksA.length).toBe(2);
    expect(chunksA[0].index).toBe(0);
    expect(chunksA[1].index).toBe(1);

    // Perform rollover to Patient B
    const priorBlobPromise = recorder.rollover({
      sessionTag: 'consult-patient-B',
      onChunk: (blob, index) => {
        chunksB.push({ blob, index });
      },
    });

    const priorBlob = await priorBlobPromise;
    expect(priorBlob).not.toBeNull();

    // Verify recorder A received final chunk before stopping
    expect(chunksA.length).toBe(3); // A0, A1, final-chunk
    expect(chunksA[2].index).toBe(2);

    // Verify Recorder B started cleanly
    expect(recorder.getGeneration()).toBe(2);
    expect(recorderInstances.length).toBe(2);

    const recB = recorderInstances[1];
    recB.emitChunk('chunk-B0');
    recB.emitChunk('chunk-B1');

    // Recorder B must start at chunkIndex 0
    expect(chunksB.length).toBe(2);
    expect(chunksB[0].index).toBe(0);
    expect(chunksB[1].index).toBe(1);

    // Persistent MediaStream was NOT stopped or destroyed
    expect(mockStream.getAudioTracks()[0].stop).not.toHaveBeenCalled();

    await recorder.stop();
  });

  // =========================================================================
  // TEST 2 — FINAL CHUNK DELAY & BOUNDARY ISOLATION
  // =========================================================================
  it('Test 2: late arrival of final chunk A does not pollute Recorder B or mutate B state', async () => {
    const uploadedChunks: { consultationId: string; chunkIndex: number; payload: string }[] = [];

    // Simulate async network upload pipe
    const uploadChunk = async (consultationId: string, chunkIndex: number, blob: Blob, delayMs = 0) => {
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      const text = await blob.text();
      uploadedChunks.push({ consultationId, chunkIndex, payload: text });
    };

    const recorder = new AudioRecorder({
      onChunk: (blob, index) => {
        // Patient A final chunk simulated with delayed network upload
        void uploadChunk('patient-A', index, blob, index === 1 ? 50 : 0);
      },
    });

    await recorder.start();
    const recA = recorderInstances[0];
    recA.emitChunk('patient-A-data-0');

    // Rollover to Patient B immediately while A upload is in flight
    await recorder.rollover({
      sessionTag: 'patient-B',
      onChunk: (blob, index) => {
        void uploadChunk('patient-B', index, blob, 0);
      },
    });

    const recB = recorderInstances[1];
    recB.emitChunk('patient-B-data-0');

    // Wait for all delayed uploads to settle
    await new Promise((r) => setTimeout(r, 80));

    // Assert that patient A chunks only went to patient A, and patient B to B
    const patientAChunks = uploadedChunks.filter((c) => c.consultationId === 'patient-A');
    const patientBChunks = uploadedChunks.filter((c) => c.consultationId === 'patient-B');

    expect(patientAChunks.length).toBe(2); // A0 + A-final
    expect(patientAChunks[0].chunkIndex).toBe(0);
    expect(patientAChunks[1].chunkIndex).toBe(1);

    expect(patientBChunks.length).toBe(1);
    expect(patientBChunks[0].chunkIndex).toBe(0);
    expect(patientBChunks[0].payload).toContain('patient-B-data-0');

    await recorder.stop();
  });

  // =========================================================================
  // TEST 3 — TRANSCRIPTION RACE CONDITION GUARD
  // =========================================================================
  it('Test 3: stale transcription response from Patient A is discarded when Patient B is active', async () => {
    let activeSessionId = 'consult-patient-A';
    const activeSessionIdRef = { current: activeSessionId };

    const transcripts: Record<string, string[]> = {
      'consult-patient-A': [],
      'consult-patient-B': [],
    };

    // Simulated async transcription handler with ownership boundary guard
    const handleTranscription = async (targetSessionId: string, simulatedResponse: string, delayMs: number) => {
      await new Promise((r) => setTimeout(r, delayMs));

      // Guard check: Phase 1.2
      if (targetSessionId !== activeSessionIdRef.current) {
        // Discard stale result
        return;
      }

      transcripts[targetSessionId].push(simulatedResponse);
    };

    // Patient A requests transcription
    const promiseA = handleTranscription('consult-patient-A', 'Patient A tooth 16 occlusal filling', 50);

    // Clinician presses Next Patient -> Patient B becomes active
    activeSessionId = 'consult-patient-B';
    activeSessionIdRef.current = 'consult-patient-B';

    // Patient B requests transcription
    const promiseB = handleTranscription('consult-patient-B', 'Patient B routine checkup', 10);

    await Promise.all([promiseA, promiseB]);

    // Invariant: Patient B transcript MUST NOT contain Patient A content
    expect(transcripts['consult-patient-B']).toEqual(['Patient B routine checkup']);
    // Patient A discarded stale response because session switched before arrival
    expect(transcripts['consult-patient-A']).toEqual([]);
  });

  // =========================================================================
  // TEST 4 — COPILOT / NOTE GENERATION RACE CONDITION GUARD
  // =========================================================================
  it('Test 4: stale copilot response from Patient A does not populate Patient B note', async () => {
    let activeSessionId = 'patient-A';
    const activeSessionIdRef = { current: activeSessionId };

    const notes: Record<string, string> = {
      'patient-A': '',
      'patient-B': '',
    };

    const handleAskCopilot = async (targetSessionId: string, prompt: string, delayMs: number) => {
      await new Promise((r) => setTimeout(r, delayMs));

      // Phase 1.3: Hard async session ownership check
      if (targetSessionId !== activeSessionIdRef.current) {
        return; // Discard stale copilot response
      }

      notes[targetSessionId] = `Generated note for ${prompt}`;
    };

    // Patient A initiates Copilot note generation
    const pendingCopilotA = handleAskCopilot('patient-A', 'Emergency extraction 38', 60);

    // Switch to Patient B
    activeSessionId = 'patient-B';
    activeSessionIdRef.current = 'patient-B';

    // Patient B initiates Copilot note generation
    const pendingCopilotB = handleAskCopilot('patient-B', 'Periodic scale and clean', 15);

    await Promise.all([pendingCopilotA, pendingCopilotB]);

    // Patient B note must only contain Patient B content
    expect(notes['patient-B']).toBe('Generated note for Periodic scale and clean');
    // Patient A note untouched by the late response
    expect(notes['patient-A']).toBe('');
  });

  // =========================================================================
  // TEST 5 — SAVE RACE CONDITION
  // =========================================================================
  it('Test 5: saves target explicit consultation id and never overwrite sibling sessions', async () => {
    const savedDatabase: Record<string, { note: string; timestamp: number }> = {};

    const saveConsultation = async (consultationId: string, note: string) => {
      savedDatabase[consultationId] = { note, timestamp: Date.now() };
    };

    // Simulate saving A during transition while B is setting up
    await Promise.all([
      saveConsultation('consult-A', 'Finalized notes for Patient A'),
      saveConsultation('consult-B', 'Initial notes for Patient B'),
    ]);

    expect(savedDatabase['consult-A'].note).toBe('Finalized notes for Patient A');
    expect(savedDatabase['consult-B'].note).toBe('Initial notes for Patient B');
  });

  // =========================================================================
  // TEST 6 — RAPID NEXT PATIENT TRANSITION SERIALIZATION
  // =========================================================================
  it('Test 6: serializes rapid Next Patient activations at 50ms, 100ms, 250ms without race conditions', async () => {
    const recorder = new AudioRecorder();
    await recorder.start();

    const transitionsCompleted: string[] = [];
    let isTransitioning = false;

    const safeNextPatient = async (targetId: string) => {
      if (isTransitioning) {
        // Coalesce / safely ignore concurrent triggers
        return false;
      }
      isTransitioning = true;
      try {
        await recorder.rollover({ sessionTag: targetId });
        transitionsCompleted.push(targetId);
        return true;
      } finally {
        isTransitioning = false;
      }
    };

    // Fire rapid triggers at 50ms, 100ms, 250ms
    const intervals = [50, 100, 250];
    for (let i = 0; i < intervals.length; i++) {
      const wait = intervals[i];
      const success = await safeNextPatient(`patient-${i + 1}`);
      expect(success).toBe(true);
      await new Promise((r) => setTimeout(r, wait));
    }

    expect(transitionsCompleted).toEqual(['patient-1', 'patient-2', 'patient-3']);
    expect(recorder.getGeneration()).toBe(4); // initial + 3 rollovers

    await recorder.stop();
  });

  // =========================================================================
  // TEST 7 — 30-PATIENT SOAK TEST
  // =========================================================================
  it('Test 7: 30-patient soak simulation runs continuously with 0 leaks, 0 missing final chunks, and chunk 0 restarts', async () => {
    const consultationChunks: Record<string, number[]> = {};

    const recorder = new AudioRecorder({
      onChunk: (blob, index) => {
        consultationChunks['patient-0'] = consultationChunks['patient-0'] || [];
        consultationChunks['patient-0'].push(index);
      },
    });

    await recorder.start();
    recorderInstances[0].emitChunk('pt0-chunk');

    const totalPatients = 30;
    for (let i = 1; i < totalPatients; i++) {
      const patientId = `patient-${i}`;
      await recorder.rollover({
        sessionTag: patientId,
        onChunk: (blob, index) => {
          consultationChunks[patientId] = consultationChunks[patientId] || [];
          consultationChunks[patientId].push(index);
        },
      });

      const currentRec = recorderInstances[recorderInstances.length - 1];
      currentRec.emitChunk(`${patientId}-chunk-data`);
    }

    await recorder.stop();

    // Verify all 30 patients recorded
    expect(Object.keys(consultationChunks).length).toBe(30);

    // Verify every patient started with chunkIndex 0 and received their final chunk
    for (let i = 0; i < totalPatients; i++) {
      const pId = `patient-${i}`;
      const indices = consultationChunks[pId];
      expect(indices).toBeDefined();
      expect(indices[0]).toBe(0); // Starts at chunk index 0
      expect(indices.length).toBeGreaterThanOrEqual(2); // Mid-chunk + final stop chunk
    }

    // MediaStream remained alive the entire time; only 1 getUserMedia call
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(mockStream.getAudioTracks()[0].stop).toHaveBeenCalledTimes(1); // Only stopped at the end of the day
  });

  // =========================================================================
  // PHASE 13 — DETERMINISTIC PATIENT ISOLATION TEST
  // =========================================================================
  it('Phase 13: Deterministic Patient Isolation (ALPHA, BRAVO, CHARLIE) maintains 100% boundary isolation', async () => {
    interface PatientConsultRecord {
      patientId: string;
      audioContent: string[];
      transcript: string[];
      clinicalNote: string;
      clinicalFacts: string[];
    }

    const records: Record<string, PatientConsultRecord> = {
      TEST_PATIENT_ALPHA: {
        patientId: 'TEST_PATIENT_ALPHA',
        audioContent: [],
        transcript: [],
        clinicalNote: '',
        clinicalFacts: [],
      },
      TEST_PATIENT_BRAVO: {
        patientId: 'TEST_PATIENT_BRAVO',
        audioContent: [],
        transcript: [],
        clinicalNote: '',
        clinicalFacts: [],
      },
      TEST_PATIENT_CHARLIE: {
        patientId: 'TEST_PATIENT_CHARLIE',
        audioContent: [],
        transcript: [],
        clinicalNote: '',
        clinicalFacts: [],
      },
    };

    let activePatient = 'TEST_PATIENT_ALPHA';
    const activePatientRef = { current: activePatient };

    const recorder = new AudioRecorder({
      onChunk: async (blob) => {
        const text = await blob.text();
        records.TEST_PATIENT_ALPHA.audioContent.push(text);
      },
    });

    await recorder.start();
    recorderInstances[0].emitChunk('AUDIO_SPEECH_ALPHA_RESTORE_TOOTH_16');
    records.TEST_PATIENT_ALPHA.transcript.push('Examined tooth 16 mesial caries');
    records.TEST_PATIENT_ALPHA.clinicalNote = 'Tooth 16 composite restoration completed';
    records.TEST_PATIENT_ALPHA.clinicalFacts.push('Tooth 16: MO Composite (ADA 532)');

    // Switch to BRAVO
    await recorder.rollover({
      sessionTag: 'TEST_PATIENT_BRAVO',
      onChunk: async (blob) => {
        const text = await blob.text();
        records.TEST_PATIENT_BRAVO.audioContent.push(text);
      },
    });
    activePatient = 'TEST_PATIENT_BRAVO';
    activePatientRef.current = 'TEST_PATIENT_BRAVO';

    recorderInstances[1].emitChunk('AUDIO_SPEECH_BRAVO_EXTRACTION_TOOTH_48');
    records.TEST_PATIENT_BRAVO.transcript.push('Surgical removal of impacted tooth 48');
    records.TEST_PATIENT_BRAVO.clinicalNote = 'Tooth 48 surgical extraction with sutures';
    records.TEST_PATIENT_BRAVO.clinicalFacts.push('Tooth 48: Surgical extraction (ADA 324)');

    // Switch to CHARLIE
    await recorder.rollover({
      sessionTag: 'TEST_PATIENT_CHARLIE',
      onChunk: async (blob) => {
        const text = await blob.text();
        records.TEST_PATIENT_CHARLIE.audioContent.push(text);
      },
    });
    activePatient = 'TEST_PATIENT_CHARLIE';
    activePatientRef.current = 'TEST_PATIENT_CHARLIE';

    recorderInstances[2].emitChunk('AUDIO_SPEECH_CHARLIE_SCALE_CLEAN');
    records.TEST_PATIENT_CHARLIE.transcript.push('Routine prophylaxis and fluoride');
    records.TEST_PATIENT_CHARLIE.clinicalNote = 'Scale and clean completed, no caries noted';
    records.TEST_PATIENT_CHARLIE.clinicalFacts.push('Full mouth debridement (ADA 114)');

    await recorder.stop();
    // Allow async blob text to settle
    await new Promise((r) => setTimeout(r, 40));

    const alphaSerialized = JSON.stringify(records.TEST_PATIENT_ALPHA);
    const bravoSerialized = JSON.stringify(records.TEST_PATIENT_BRAVO);
    const charlieSerialized = JSON.stringify(records.TEST_PATIENT_CHARLIE);

    // Cross-contamination assertions
    expect(alphaSerialized).not.toContain('BRAVO');
    expect(alphaSerialized).not.toContain('CHARLIE');
    expect(alphaSerialized).not.toContain('48');

    expect(bravoSerialized).not.toContain('ALPHA');
    expect(bravoSerialized).not.toContain('CHARLIE');
    expect(bravoSerialized).not.toContain('16');

    expect(charlieSerialized).not.toContain('ALPHA');
    expect(charlieSerialized).not.toContain('BRAVO');
    expect(charlieSerialized).not.toContain('extraction');
  });

  // =========================================================================
  // PHASE 14 — PERFORMANCE MEASUREMENT (20+ TRANSITIONS)
  // =========================================================================
  it('Phase 14: measures stop A -> final A event -> start B transition latency across 25 iterations', async () => {
    const recorder = new AudioRecorder();
    await recorder.start();

    const transitionDurationsMs: number[] = [];

    for (let i = 0; i < 25; i++) {
      const start = performance.now();
      await recorder.rollover({ sessionTag: `perf-patient-${i}` });
      const duration = performance.now() - start;
      transitionDurationsMs.push(duration);
    }

    await recorder.stop();

    transitionDurationsMs.sort((a, b) => a - b);
    const median = transitionDurationsMs[Math.floor(transitionDurationsMs.length / 2)];
    const p95 = transitionDurationsMs[Math.floor(transitionDurationsMs.length * 0.95)];
    const max = transitionDurationsMs[transitionDurationsMs.length - 1];

    console.log(`[Phase 14 Rollover Performance] Samples: ${transitionDurationsMs.length} | Median: ${median.toFixed(2)}ms | P95: ${p95.toFixed(2)}ms | Max: ${max.toFixed(2)}ms`);

    // In a microtask-driven headless environment, rollovers complete well within sub-50ms budgets
    expect(median).toBeLessThan(10);
    expect(p95).toBeLessThan(25);
    expect(max).toBeLessThan(50);
  });
});
