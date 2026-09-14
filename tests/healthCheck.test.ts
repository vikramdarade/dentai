import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

describe('Production Readiness & Health Check', () => {
  let app: any;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const serverModule = await import('../server.ts');
    app = serverModule.app;
  });

  it('1. Responds with HTTP 200 and healthy metadata at /api/health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.ok).toBe(true);
    expect(res.body.version).toBe('2.4.0');
    expect(typeof res.body.uptimeSeconds).toBe('number');
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.environment).toBeDefined();
    expect(res.body.storageMode).toBeDefined();
  });

  it('2. Responds with HTTP 200 at alias /health for container orchestrators', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.ok).toBe(true);
  });
});
