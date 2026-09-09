import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import dotenv from 'dotenv';
import {
  detectDismissalCues,
  shouldAutoStopConsultation,
  DISMISSAL_PATTERNS
} from '../src/lib/semanticDismissalDetector';
import { generateQrSvg } from '../src/lib/qrCodeSvg';

dotenv.config({ path: '.env.local' });
dotenv.config();

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'TEST_API_KEY';
process.env.DATABASE_URL = '';

// Dynamically import server app
const { app } = await import('../server.ts');

describe('Model 4: Semantic Dismissal Detector (Australian Dental Context)', () => {
  it('detects common Australian clinical dismissal and departure cues', () => {
    const transcript1 = "Tooth 24 composite polished and occlusion checked. All done for today Sarah! You can rinse out now.";
    const result1 = detectDismissalCues(transcript1);
    expect(result1.detected).toBe(true);
    expect(result1.phrase?.toLowerCase()).toContain('all done for today');

    const transcript2 = "Looks very clean. The girls at reception will help you book the next appointment.";
    const result2 = detectDismissalCues(transcript2);
    expect(result2.detected).toBe(true);
    expect(result2.phrase?.toLowerCase()).toContain('reception will help');

    const transcript3 = "Be careful with the numbness on your tongue for the next 2 hours, do not chew your lip.";
    const result3 = detectDismissalCues(transcript3);
    expect(result3.detected).toBe(true);
    expect(result3.phrase?.toLowerCase()).toContain('careful with the numbness');

    const transcript4 = "If there is any soreness, rinse with warm salt water this evening.";
    const result4 = detectDismissalCues(transcript4);
    expect(result4.detected).toBe(true);
    expect(result4.phrase?.toLowerCase()).toContain('warm salt water');

    const transcript5 = "Great hygiene. We'll recall in 6 months for your routine scale and clean.";
    const result5 = detectDismissalCues(transcript5);
    expect(result5.detected).toBe(true);
    expect(result5.phrase?.toLowerCase()).toContain('recall in 6 months');
  });

  it('does not trigger false dismissals during active mid-procedure dialogue', () => {
    const activeMidProc = "Open slightly wider please. Let's etch the enamel on tooth 46 and apply the bonding agent.";
    const result = detectDismissalCues(activeMidProc);
    expect(result.detected).toBe(false);
    expect(result.phrase).toBeUndefined();
  });

  it('verifies dismissal lull timer completion logic (Model 4)', () => {
    const dismissalTimestamp = 10000;
    
    // Inactivity lull has only run for 30s — consultation must not terminate prematurely
    const earlyCheck = shouldAutoStopConsultation(dismissalTimestamp, 30, 75);
    expect(earlyCheck).toBe(false);

    // Inactivity lull has passed 75s after a detected dismissal — trigger safe auto-stop
    const lateCheck = shouldAutoStopConsultation(dismissalTimestamp, 80, 75);
    expect(lateCheck).toBe(true);
  });
});

describe('Zero-Dependency QR Code Generator', () => {
  it('generates an SVG string with valid XML headers and coordinate elements', () => {
    const url = 'https://dentai.vercel.app/#/beacon?chair=chair-1&pin=1234';
    const svg = generateQrSvg(url, 200);

    expect(svg).toContain('<svg');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 200 200"');
    expect(svg).toContain('<rect');
    expect(svg).toContain('fill="#0f172a"');
  });
});

describe('Operatory Phone Beacon Server API', () => {
  let createdChairId: string;
  let createdPin: string;
  let chairToken: string;

  it('creates a new operatory chair beacon session with PIN and HMAC token', async () => {
    const res = await request(app)
      .post('/api/beacon/chair/create')
      .send({ roomName: 'Test Operatory 2' });

    expect(res.status).toBe(201);
    expect(res.body.chairId).toBeDefined();
    expect(res.body.pinCode).toMatch(/^\d{4}$/);
    expect(res.body.token).toBeDefined();
    expect(res.body.qrUrl).toContain('/#/beacon?chair=');

    createdChairId = res.body.chairId;
    createdPin = res.body.pinCode;
    chairToken = res.body.token;
  });

  it('retrieves chair session status for desktop polling', async () => {
    const res = await request(app)
      .get(`/api/beacon/chair/${createdChairId}/status`);

    expect(res.status).toBe(200);
    expect(res.body.chairId).toBe(createdChairId);
    expect(res.body.status).toBe('waiting');
    expect(res.body.isRecordingActive).toBe(false);
  });

  it('rejects pairing with an incorrect PIN', async () => {
    const res = await request(app)
      .post('/api/beacon/chair/pair')
      .send({
        chairId: createdChairId,
        pinCode: '0000',
        deviceModel: 'iPhone 15 Pro'
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Invalid or expired PIN');
  });

  it('successfully pairs phone beacon using the correct 4-digit PIN', async () => {
    const res = await request(app)
      .post('/api/beacon/chair/pair')
      .send({
        chairId: createdChairId,
        pinCode: createdPin,
        deviceModel: 'iPhone 15 Pro',
        batteryLevel: 88,
        isCharging: true
      });

    expect(res.status).toBe(200);
    expect(res.body.paired).toBe(true);
    expect(res.body.chairId).toBe(createdChairId);
    expect(res.body.token).toBeDefined();

    // Verify status changed to 'paired'
    const statusRes = await request(app)
      .get(`/api/beacon/chair/${createdChairId}/status`);
    expect(statusRes.body.status).toBe('paired');
    expect(statusRes.body.deviceModel).toBe('iPhone 15 Pro');
  });

  it('allows desktop to dispatch a remote recording command (start_recording)', async () => {
    const res = await request(app)
      .post(`/api/beacon/chair/${createdChairId}/command`)
      .send({
        command: 'start_recording'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Mobile polling status should now show the pending command and active recording state
    const statusRes = await request(app)
      .get(`/api/beacon/chair/${createdChairId}/status`);
    expect(statusRes.body.isRecordingActive).toBe(true);
    expect(statusRes.body.pendingCommand).toBe('start_recording');
  });

  it('records live telemetry heartbeats from the chairside phone beacon', async () => {
    const res = await request(app)
      .post(`/api/beacon/chair/${createdChairId}/telemetry`)
      .send({
        batteryLevel: 82,
        isCharging: false,
        audioLevel: 0.65,
        inactivitySeconds: 45,
        dismissalPhrase: 'all done for today',
        dismissalTime: Date.now()
      });

    expect(res.status).toBe(200);
    expect(res.body.acknowledged).toBe(true);

    // Verify desktop status reflects the telemetry
    const statusRes = await request(app)
      .get(`/api/beacon/chair/${createdChairId}/status`);
    expect(statusRes.body.batteryLevel).toBe(82);
    expect(statusRes.body.audioLevel).toBe(0.65);
    expect(statusRes.body.dismissalDetected?.phrase).toBe('all done for today');
  });

  it('receives resilient audio chunk uploads from the phone beacon', async () => {
    const res = await request(app)
      .post(`/api/beacon/chair/${createdChairId}/upload-chunk`)
      .send({
        chunkIndex: 0,
        chunkTotal: 1,
        audioData: 'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQ8=',
        consultationId: 'test-consultation-999'
      });

    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(true);
  });

  it('allows desktop to dispatch stop_recording command', async () => {
    const res = await request(app)
      .post(`/api/beacon/chair/${createdChairId}/command`)
      .send({
        command: 'stop_recording'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const statusRes = await request(app)
      .get(`/api/beacon/chair/${createdChairId}/status`);
    expect(statusRes.body.isRecordingActive).toBe(false);
  });
});
