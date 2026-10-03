import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { useSignOff } from '../../src/hooks/useSignOff';
import { useGroundingReview } from '../../src/hooks/useGroundingReview';
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

describe('useGroundingReview', () => {
  it('returns null badge and not approved when groundingAudit is absent or false', () => {
    const consult: Consultation = {
      id: 'c-1',
      date: '2026-10-03',
      dentistId: 'd-1',
      status: 'In Review',
      groundingAudit: { isApprovedForSigning: false, blockingReasons: ['Missing vital examination evidence'] },
    } as unknown as Consultation;

    const hook = createHookHarness(() => useGroundingReview(consult, false));
    expect(hook.current.badge).toBeNull();
    expect(hook.current.isApprovedForSigning).toBe(false);
    expect(hook.current.groundingExplanation).toContain('Missing vital examination evidence');
  });

  it('returns "Verified from Audio" when server groundingAudit approves', () => {
    const consult: Consultation = {
      id: 'c-1',
      date: '2026-10-03',
      dentistId: 'd-1',
      status: 'In Review',
      groundingAudit: { isApprovedForSigning: true, blockingReasons: [] },
    } as unknown as Consultation;

    const hook = createHookHarness(() => useGroundingReview(consult, false));
    expect(hook.current.badge).toBe('Verified from Audio');
    expect(hook.current.isApprovedForSigning).toBe(true);
    expect(hook.current.groundingExplanation).toContain('All clinical claims have been ground-verified');
  });

  it('returns "Template Applied" when isMacroEngine is true, fail-closing verification', () => {
    const consult: Consultation = {
      id: 'c-1',
      date: '2026-10-03',
      dentistId: 'd-1',
      status: 'In Review',
      groundingAudit: { isApprovedForSigning: true, blockingReasons: [] },
    } as unknown as Consultation;

    const hook = createHookHarness(() => useGroundingReview(consult, true));
    expect(hook.current.badge).toBe('Template Applied');
  });
});

describe('useSignOff', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('detects signed state from existing attestation seal', () => {
    const consult: Consultation = {
      id: 'c-1',
      date: '2026-10-03',
      dentistId: 'd-1',
      status: 'Signed',
      attestation: {
        signatureHash: 'sha256-mock-sig',
        signedBy: 'Dr. Test',
        practitionerId: 'd-1',
        signedAt: '2026-10-03T08:00:00.000Z',
        contentDigest: 'digest-1',
        auditStatus: 'Verified from Audio',
      },
    } as unknown as Consultation;

    const hook = createHookHarness(() => useSignOff({
      consultation: consult,
      authToken: 'mock-token',
    }));

    expect(hook.current.isSigned).toBe(true);
    expect(hook.current.seal?.signatureHash).toBe('sha256-mock-sig');
  });

  it('fails gracefully when no consultation is loaded', async () => {
    const hook = createHookHarness(() => useSignOff({
      consultation: null,
      authToken: 'mock-token',
    }));

    const res = await hook.current.signRecord();
    expect(res).toBeNull();
    hook.rerender();
    expect(hook.current.refusalMessage).toContain('No consultation or authorization available');
  });

  it('submits expectedVersion and receives server seal on successful sign-off', async () => {
    const consult: Consultation = {
      id: 'c-123',
      date: '2026-10-03',
      dentistId: 'd-1',
      status: 'In Review',
      clinicalProgressNote: 'Routine checkup completed',
      version: 2,
    } as unknown as Consultation;

    const onSignedMock = vi.fn();

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        seal: {
          signatureHash: 'sha256-new-seal',
          signedBy: 'Dr. Test',
          practitionerId: 'd-1',
          signedAt: '2026-10-03T08:30:00.000Z',
          contentDigest: 'sha256-content',
          auditStatus: 'Verified from Audio',
        },
        recordVersion: 3,
        signedAt: '2026-10-03T08:30:00.000Z',
      }),
    });

    const hook = createHookHarness(() => useSignOff({
      consultation: consult,
      authToken: 'valid-jwt',
      onSigned: onSignedMock,
    }));

    const signResult = await hook.current.signRecord();
    expect(signResult?.ok).toBe(true);
    expect(onSignedMock).toHaveBeenCalledTimes(1);
    expect(onSignedMock.mock.calls[0][0].attestation.signatureHash).toBe('sha256-new-seal');
    expect(onSignedMock.mock.calls[0][0].status).toBe('Completed');
  });

  it('captures server refusal code and message upon unapproved grounding', async () => {
    const consult: Consultation = {
      id: 'c-123',
      date: '2026-10-03',
      dentistId: 'd-1',
      status: 'In Review',
      version: 1,
    } as unknown as Consultation;

    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({
        ok: false,
        code: 'GROUNDING_NOT_APPROVED',
        error: 'Record has 2 ungrounded claims that must be verified.',
      }),
    });

    const hook = createHookHarness(() => useSignOff({
      consultation: consult,
      authToken: 'valid-jwt',
    }));

    const signResult = await hook.current.signRecord();
    expect(signResult?.ok).toBe(false);
    hook.rerender();
    expect(hook.current.refusalMessage).toBe('Record has 2 ungrounded claims that must be verified.');
    expect(hook.current.lastRefusal?.code).toBe('GROUNDING_NOT_APPROVED');
  });

  it('self-heals and auto-reconciles when server answers STALE_VERSION with currentVersion', async () => {
    const consult: Consultation = {
      id: 'c-stale-1',
      date: '2026-10-03',
      dentistId: 'd-1',
      status: 'In Review',
      recordVersion: 1,
    } as unknown as Consultation;

    // First attempt: rejected with 409 STALE_VERSION because pre-sign auto-save bumped to 2
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        ok: false,
        code: 'STALE_VERSION',
        error: 'This record changed since your sign-off request was prepared.',
        currentVersion: 2,
      }),
    });

    // Retry attempt: succeeds with currentVersion: 2
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        seal: {
          signatureHash: 'sha256-reconciled-seal',
          signedBy: 'Dr. Test',
          signedAt: '2026-10-03T12:00:00Z',
          auditStatus: 'Verified from Audio',
        },
        recordVersion: 2,
        signedAt: '2026-10-03T12:00:00Z',
      }),
    });

    const onSignedMock = vi.fn();
    const hook = createHookHarness(() => useSignOff({
      consultation: consult,
      authToken: 'valid-jwt',
      onSigned: onSignedMock,
    }));

    const signResult = await hook.current.signRecord();
    expect(signResult?.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    // Verify second request used expectedVersion: 2
    const secondCallBody = JSON.parse((global.fetch as any).mock.calls[1][1].body);
    expect(secondCallBody.expectedVersion).toBe(2);

    expect(onSignedMock).toHaveBeenCalledTimes(1);
    expect(onSignedMock.mock.calls[0][0].attestation.signatureHash).toBe('sha256-reconciled-seal');
  });

  it('uses updated consultation returned by onBeforeSign', async () => {
    const initialConsult: Consultation = {
      id: 'c-pre-1',
      date: '2026-10-03',
      dentistId: 'd-1',
      status: 'In Review',
      recordVersion: 1,
    } as unknown as Consultation;

    const savedConsult: Consultation = {
      ...initialConsult,
      recordVersion: 2,
      clinicalProgressNote: 'Updated note text before signing',
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        seal: {
          signatureHash: 'sha256-pre-seal',
          signedBy: 'Dr. Test',
          signedAt: '2026-10-03T12:00:00Z',
          auditStatus: 'Verified from Audio',
        },
        recordVersion: 2,
        signedAt: '2026-10-03T12:00:00Z',
      }),
    });

    const onBeforeSignMock = vi.fn().mockResolvedValue(savedConsult);
    const hook = createHookHarness(() => useSignOff({
      consultation: initialConsult,
      authToken: 'valid-jwt',
      onBeforeSign: onBeforeSignMock,
    }));

    const signResult = await hook.current.signRecord();
    expect(signResult?.ok).toBe(true);
    expect(onBeforeSignMock).toHaveBeenCalledTimes(1);

    const callBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(callBody.expectedVersion).toBe(2);
  });
});
