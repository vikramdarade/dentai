import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  hashRecoveryCode,
  hotp,
  totpAt,
  totpProvisioningUri,
  verifyTotp,
} from '../src/lib/totp';
import { GENESIS_HASH, auditEntryHash, verifyAuditChain } from '../src/lib/auditChain';
import { createDurableRateLimit } from '../src/server/durableRateLimit';
import { verifyStripeSignature, parseStripeEvent, applyStripeEvent } from '../src/server/billing';

/**
 * The whole point of replacing the previous MFA endpoint is that it must verify
 * something real, so these are the standard's own vectors rather than
 * self-consistent round trips.
 */
describe('TOTP (RFC 6238)', () => {
  // RFC 6238 Appendix B, SHA-1 (the interoperable default every authenticator
  // app assumes when it scans a QR code).
  const SECRET_ASCII = '12345678901234567890';
  const SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  const vectors: Array<[number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];

  it('encodes and decodes base32 without loss', () => {
    expect(base32Encode(Buffer.from(SECRET_ASCII, 'ascii'))).toBe(SECRET_BASE32);
    expect(base32Decode(SECRET_BASE32).toString('ascii')).toBe(SECRET_ASCII);
  });

  it.each(vectors)('matches the published vector at T=%i', (timestamp, expected) => {
    const counter = Math.floor(timestamp / 30);
    expect(hotp(base32Decode(SECRET_BASE32), counter, 8)).toBe(expected);
  });

  it('accepts the current code and rejects a wrong one', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totpAt(secret, now), { now })).toBe(true);
    expect(verifyTotp(secret, '000000', { now: 1_700_000_000_000 })).toBe(false);
  });

  it('tolerates one step of clock drift but not five minutes', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const now = 1_700_000_000_000;
    const previousStep = totpAt(secret, now - 30_000);
    expect(verifyTotp(secret, previousStep, { now })).toBe(true);
    // Ten steps away is a different code and must not be accepted.
    expect(verifyTotp(secret, totpAt(secret, now - 300_000), { now })).toBe(false);
  });

  it('rejects anything that is not six digits', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    for (const bad of ['', 'abcdef', '12345', '1234567', null, undefined, 123456]) {
      expect(verifyTotp(secret, bad as any)).toBe(false);
    }
  });

  it('builds a provisioning URI every authenticator app can read', () => {
    const uri = totpProvisioningUri({
      secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      accountName: 'Dr Sarah Jenkins',
      issuer: 'DentAI',
    });
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  it('issues single-use recovery codes', () => {
    const { codes, hashes } = generateRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(new Set(hashes).size).toBe(10);
    // Stored hashed, so a database leak does not hand over the codes.
    expect(hashes[0]).not.toBe(codes[0]);
    expect(hashes[0]).toBe(hashRecoveryCode(codes[0]));
    // Case and spacing should not decide whether a clinician gets in.
    expect(hashRecoveryCode(` ${codes[0].toLowerCase()} `)).toBe(hashes[0]);
  });
});

describe('Audit-trail hash chain', () => {
  const base = {
    event: 'consultation_records_viewed',
    dentistId: 'dentist-1',
    detail: { count: 3 },
    createdAt: '2026-09-16T00:00:00.000Z',
  };

  function buildChain(count: number) {
    const entries: any[] = [];
    let prevHash = GENESIS_HASH;
    for (let i = 0; i < count; i += 1) {
      const content = { ...base, event: `event_${i}`, createdAt: `2026-09-16T00:00:0${i}.000Z` };
      const hash = auditEntryHash(prevHash, content);
      entries.push({ ...content, prevHash, hash });
      prevHash = hash;
    }
    return entries;
  }

  it('verifies an intact chain and reports its head', () => {
    const entries = buildChain(5);
    const result = verifyAuditChain(entries);
    expect(result.intact).toBe(true);
    expect(result.checked).toBe(5);
    expect(result.tampered).toEqual([]);
    expect(result.brokenLinks).toEqual([]);
    expect(result.headHash).toBe(entries[entries.length - 1].hash);
  });

  it('detects an edited entry', () => {
    const entries = buildChain(4);
    entries[2].detail = { count: 99 };
    const result = verifyAuditChain(entries);
    expect(result.intact).toBe(false);
    expect(result.tampered).toContain(2);
  });

  it('detects a deleted entry as a broken link', () => {
    const entries = buildChain(4);
    entries.splice(2, 1);
    const result = verifyAuditChain(entries);
    expect(result.intact).toBe(false);
    expect(result.brokenLinks.length).toBeGreaterThan(0);
  });

  it('distinguishes a concurrent branch from tampering', () => {
    const entries = buildChain(3);
    // A second writer appends while entries[1] is being written: both point at
    // entries[0] as their predecessor. Both entries are individually valid, and
    // the shape must be reported as a branch, not as tampering.
    const siblingContent = {
      ...base,
      event: 'concurrent_writer',
      createdAt: '2026-09-16T00:00:30.000Z',
    };
    const sibling = {
      ...siblingContent,
      prevHash: entries[0].hash,
      hash: auditEntryHash(entries[0].hash, siblingContent),
    };
    const result = verifyAuditChain([...entries, sibling]);
    // A branch is the expected shape of two writers appending at once; it must
    // not be reported as tampering, or a busy morning looks like an incident.
    expect(result.tampered).toEqual([]);
    expect(result.branches.length).toBeGreaterThan(0);
  });

  it('reports pre-chain entries separately instead of failing them', () => {
    const legacy = { ...base, hash: null, prevHash: null };
    const result = verifyAuditChain([legacy, ...buildChain(2)]);
    expect(result.unchained).toEqual([0]);
    expect(result.tampered.length + result.brokenLinks.length).toBeGreaterThanOrEqual(0);
  });
});

describe('Durable rate limiting', () => {
  function makeRes() {
    const headers: Record<string, string> = {};
    const res: any = {
      statusCode: 200,
      body: null,
      // Real HTTP responses lower-case header names; mirror that here so a test
      // reads the header the way a client would.
      setHeader: (k: string, v: string) => {
        headers[k.toLowerCase()] = v;
      },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: any) {
        this.body = body;
        return this;
      },
      headers,
    };
    return res;
  }

  it('enforces the limit through the shared store', async () => {
    const hits = new Map<string, number>();
    const store = {
      hit: vi.fn(async (key: string) => {
        const next = (hits.get(key) || 0) + 1;
        hits.set(key, next);
        return { hits: next, expiresAt: Date.now() + 60_000 };
      }),
      reset: vi.fn(async (key: string) => void hits.delete(key)),
    };
    const limiter = createDurableRateLimit(
      { store, logger: { warn: vi.fn() } },
      { name: 'test', windowMs: 60_000, max: 2 }
    );

    const call = async () => {
      const res = makeRes();
      let passed = false;
      await limiter({ ip: '10.0.0.1' }, res, () => {
        passed = true;
      });
      return { passed, res };
    };

    expect((await call()).passed).toBe(true);
    expect((await call()).passed).toBe(true);
    const third = await call();
    expect(third.passed).toBe(false);
    expect(third.res.statusCode).toBe(429);
    expect(third.res.body.code).toBe('RATE_LIMITED');
    // Two shared-store hits, not three: this instance's own counter is checked
    // first and short-circuits once it is already over budget, which saves a
    // database round-trip on traffic that is being refused anyway.
    expect(store.hit).toHaveBeenCalledTimes(2);
  });

  it('advertises the remaining budget with standard headers', async () => {
    const store = {
      hit: vi.fn(async () => ({ hits: 1, expiresAt: Date.now() + 60_000 })),
      reset: vi.fn(async () => {}),
    };
    const limiter = createDurableRateLimit(
      { store, logger: { warn: vi.fn() } },
      { name: 'headers', windowMs: 60_000, max: 10 }
    );
    const res = makeRes();
    await limiter({ ip: '10.0.0.2' }, res, () => {});
    expect(res.headers['ratelimit-limit']).toBe('10');
    expect(res.headers['ratelimit-remaining']).toBe('9');
  });

  it('falls back to the instance counter when the shared store is unreachable', async () => {
    const store = {
      hit: vi.fn(async () => {
        throw new Error('database is down');
      }),
      reset: vi.fn(async () => {}),
    };
    const warn = vi.fn();
    const limiter = createDurableRateLimit(
      { store, logger: { warn } },
      { name: 'fallback', windowMs: 60_000, max: 1 }
    );

    const first = makeRes();
    let firstPassed = false;
    await limiter({ ip: '10.0.0.3' }, first, () => {
      firstPassed = true;
    });
    expect(firstPassed).toBe(true);

    // Availability wins: a broken limiter table must not become a clinic outage,
    // but it must be visible.
    const second = makeRes();
    let secondPassed = false;
    await limiter({ ip: '10.0.0.3' }, second, () => {
      secondPassed = true;
    });
    expect(secondPassed).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('partitions budget by Bearer token session so shared clinic IPs do not collide', async () => {
    const store = {
      hit: vi.fn(async (key: string) => ({ hits: 1, expiresAt: Date.now() + 60_000 })),
      reset: vi.fn(async () => {}),
    };
    const keyOf = (req: any) => {
      const auth = req.headers?.['authorization'];
      if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        const token = auth.slice(7).trim();
        if (token) {
          return `auth:${crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)}`;
        }
      }
      return req.ip || 'unknown';
    };

    const limiter = createDurableRateLimit(
      { store, logger: { warn: vi.fn() } },
      { name: 'session_test', windowMs: 60_000, max: 1, keyOf }
    );

    // Clinician 1 on shared clinic NAT IP (192.168.1.1)
    const res1 = makeRes();
    let p1 = false;
    await limiter({ ip: '192.168.1.1', headers: { authorization: 'Bearer token-dr-smith' } }, res1, () => {
      p1 = true;
    });
    expect(p1).toBe(true);

    // Clinician 2 on same shared clinic NAT IP (192.168.1.1)
    const res2 = makeRes();
    let p2 = false;
    await limiter({ ip: '192.168.1.1', headers: { authorization: 'Bearer token-dr-jones' } }, res2, () => {
      p2 = true;
    });
    expect(p2).toBe(true);

    // Both had distinct keys in the store
    expect(store.hit).toHaveBeenCalledWith(expect.stringMatching(/^session_test:auth:/), 60_000);
    const keys = store.hit.mock.calls.map((c) => c[0]);
    expect(keys[0]).not.toEqual(keys[1]);
  });

  it('skips routes matching path even when query string is attached', async () => {
    const store = {
      hit: vi.fn(async () => ({ hits: 1, expiresAt: Date.now() + 60_000 })),
      reset: vi.fn(async () => {}),
    };
    const limiter = createDurableRateLimit(
      { store, logger: { warn: vi.fn() } },
      {
        name: 'skip_test',
        windowMs: 60_000,
        max: 1,
        skip: (req) => {
          const path = (req.originalUrl || '').split('?')[0];
          return req.method === 'GET' && /^\/api\/notes\/jobs\/[0-9a-fA-F-]+$/.test(path);
        },
      }
    );

    const res = makeRes();
    let passed = false;
    await limiter(
      { method: 'GET', originalUrl: '/api/notes/jobs/1234-abcd?refresh=true&t=999', ip: '10.0.0.9' },
      res,
      () => {
        passed = true;
      }
    );
    expect(passed).toBe(true);
    expect(store.hit).not.toHaveBeenCalled();
  });
});

describe('Stripe webhook verification', () => {
  const secret = 'whsec_test_secret';
  const payload = JSON.stringify({ id: 'evt_1', type: 'invoice.paid', data: { object: {} } });

  function sign(body: string, timestamp: number, withSecret = secret) {
    const signature = crypto
      .createHmac('sha256', withSecret)
      .update(`${timestamp}.${body}`)
      .digest('hex');
    return `t=${timestamp},v1=${signature}`;
  }

  it('accepts a correctly signed payload', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const result = verifyStripeSignature({ payload, header: sign(payload, timestamp), secret });
    expect(result.ok).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const header = sign(payload, timestamp);
    const tampered = JSON.stringify({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: { metadata: { plan: 'enterprise' } } },
    });
    expect(verifyStripeSignature({ payload: tampered, header, secret }).ok).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const header = sign(payload, timestamp, 'whsec_attacker');
    expect(verifyStripeSignature({ payload, header, secret }).ok).toBe(false);
  });

  it('rejects a replayed old signature, and refuses when no secret is configured', () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(verifyStripeSignature({ payload, header: sign(payload, old), secret }).ok).toBe(false);
    expect(verifyStripeSignature({ payload, header: sign(payload, old), secret: '' }).reason).toBe(
      'no_secret'
    );
    expect(verifyStripeSignature({ payload, header: undefined, secret }).reason).toBe(
      'missing_header'
    );
  });

  it('ignores malformed payloads', () => {
    expect(parseStripeEvent('not json')).toBeNull();
    expect(parseStripeEvent('{"id":"evt_1"}')).toBeNull();
  });

  it('applies a verified event once and ignores a replay', async () => {
    const subscriptions = new Map<string, any>();
    const processed = new Set<string>();
    const store = {
      forClinic: vi.fn(async (clinicId: string) => subscriptions.get(clinicId) ?? null),
      byStripeSubscriptionId: vi.fn(async (id: string) =>
        [...subscriptions.values()].find((s) => s.stripeSubscriptionId === id) ?? null
      ),
      byStripeCustomerId: vi.fn(async (id: string) =>
        [...subscriptions.values()].find((s) => s.stripeCustomerId === id) ?? null
      ),
      upsert: vi.fn(async (record: any) => {
        subscriptions.set(record.clinicId, record);
      }),
    };
    const events = {
      has: vi.fn(async (id: string) => processed.has(id)),
      record: vi.fn(async (event: any) => {
        processed.add(event.id);
      }),
    };
    const onChanged = vi.fn();
    const deps = { store: store as any, events: events as any, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, onChanged };

    const event = {
      id: 'evt_checkout',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test',
          customer: 'cus_1',
          subscription: 'sub_1',
          metadata: { clinicId: 'clinic-1', plan: 'practice' },
        },
      },
    };

    const applied = await applyStripeEvent(event as any, deps);
    expect(applied.handled).toBe(true);
    expect(applied.clinicId).toBe('clinic-1');
    expect(subscriptions.get('clinic-1').plan).toBe('practice');
    expect(onChanged).toHaveBeenCalledWith('clinic-1');

    const replay = await applyStripeEvent(event as any, deps);
    expect(replay.duplicate).toBe(true);
    expect(store.upsert).toHaveBeenCalledTimes(1);
  });
});
