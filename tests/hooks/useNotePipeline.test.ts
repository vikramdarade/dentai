import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { useNotePipeline } from '../../src/hooks/useNotePipeline';
import type { Consultation } from '../../src/types';

// Lightweight React 19 hook test harness
function createHookHarness<T>(hookFn: () => T) {
  let stateSlots: any[] = [];
  let stateIndex = 0;
  let latestValue: T;

  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

  const mockDispatcher = {
    useState: (initial: any) => {
      const idx = stateIndex++;
      if (stateSlots.length <= idx) {
        stateSlots[idx] = typeof initial === 'function' ? initial() : initial;
      }
      const setState = (next: any) => {
        stateSlots[idx] = typeof next === 'function' ? next(stateSlots[idx]) : next;
      };
      return [stateSlots[idx], setState];
    },
    useMemo: (fn: any) => fn(),
    useCallback: (fn: any) => fn,
    useEffect: (fn: any) => {
      fn();
    },
    useRef: (initial: any) => ({ current: initial }),
  };

  const run = () => {
    stateIndex = 0;
    const prevDispatcher = internals.H;
    internals.H = mockDispatcher;
    try {
      latestValue = hookFn();
    } finally {
      internals.H = prevDispatcher;
    }
  };

  run();

  return {
    get current() {
      return latestValue;
    },
    rerender: () => {
      run();
    },
  };
}

describe('useNotePipeline (3-Tier Resilience Ladder)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('Tier 1: successfully generates note via direct synchronous route', async () => {
    const consult: Consultation = {
      id: 'c-1',
      date: '2026-10-03',
      dentistId: 'd-1',
      firstName: 'Alice',
      lastName: 'Smith',
      transcript: [{ sender: 'Dentist', text: 'Examining tooth 16 occlusal caries.' }],
    } as unknown as Consultation;

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        result: '### SUBJECTIVE\nExamining tooth 16.\n### PLAN\nRestore 16 MO.',
      }),
    });

    const hook = createHookHarness(() => useNotePipeline('valid-token'));
    const note = await hook.current.generateNote({
      consultation: consult,
      templateId: 'ahpra-standard',
    });

    expect(note).toContain('Examining tooth 16.');
    expect(note).toContain('Restore 16 MO.');
    hook.rerender();
    expect(hook.current.statusMessage).toContain('Tier 1');
  });

  it('Tier 1: gracefully handles 409 concurrency conflict by preserving latest draft', async () => {
    const consult: Consultation = {
      id: 'c-1',
      date: '2026-10-03',
      dentistId: 'd-1',
      clinicalProgressNote: 'Existing in-flight progress note.',
    } as unknown as Consultation;

    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 409,
    });

    const hook = createHookHarness(() => useNotePipeline('valid-token'));
    const note = await hook.current.generateNote({
      consultation: consult,
      templateId: 'ahpra-standard',
    });

    expect(note).toBe('Existing in-flight progress note.');
    hook.rerender();
    expect(hook.current.statusMessage).toContain('already in progress');
  });

  it('Tier 2: falls back to background job queue when direct route fails', async () => {
    const consult: Consultation = {
      id: 'c-2',
      date: '2026-10-03',
      dentistId: 'd-1',
      firstName: 'Bob',
      transcript: [{ sender: 'Dentist', text: 'Emergency pulp extirpation.' }],
    } as unknown as Consultation;

    // Call 1: Direct sync fails
    (global.fetch as any).mockRejectedValueOnce(new Error('Tier 1 timeout'));

    // Call 2: Job submission succeeds
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jobId: 'job-999' }),
    });

    // Call 3: Job poll returns done
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'done',
        result: '### PROCEDURE\nEmergency pulp extirpation completed ADA 414.',
      }),
    });

    const hook = createHookHarness(() => useNotePipeline('valid-token'));
    const note = await hook.current.generateNote({
      consultation: consult,
      templateId: 'endodontics',
    });

    expect(note).toContain('Emergency pulp extirpation completed ADA 414.');
    hook.rerender();
    expect(hook.current.statusMessage).toContain('Tier 2');
  });

  it('Tier 3: falls back to deterministic offline template synthesis when network is down', async () => {
    const consult: Consultation = {
      id: 'c-3',
      date: '2026-10-03',
      dentistId: 'd-1',
      firstName: 'Charlie',
      transcript: [{ sender: 'Dentist', text: 'Scale and clean 114 and fluoride 121 applied.' }],
    } as unknown as Consultation;

    // Both network calls throw
    (global.fetch as any).mockRejectedValue(new Error('Network unreachable'));

    const hook = createHookHarness(() => useNotePipeline('valid-token'));
    const note = await hook.current.generateNote({
      consultation: consult,
      templateId: 'ahpra-standard',
      context: 'Routine dental clean and checkup.',
    });

    expect(note).toBeTruthy();
    expect(note.length).toBeGreaterThan(20);
    hook.rerender();
    expect(hook.current.statusMessage).toContain('Tier 3');
  });
});
