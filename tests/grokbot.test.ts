import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runProductAgent } from '../scripts/company/agents/productAgent.js';
import { runQaAgent } from '../scripts/company/agents/qaAgent.js';
import { runGtmAgent } from '../scripts/company/agents/gtmAgent.js';
import { runOpsAgent } from '../scripts/company/agents/opsAgent.js';
import { runGrokbotCycle, formatExecutiveBriefingMarkdown } from '../scripts/company/grokbot.js';

describe('DentAI Autonomous Company Harness (Grokbot)', () => {
  describe('Product & Strategy Agent', () => {
    it('synthesizes prioritized backlog with PMS integration criteria', async () => {
      const result = await runProductAgent();
      expect(result.agentName).toContain('Product');
      expect(result.prioritizedBacklog.length).toBeGreaterThan(0);
      expect(result.recommendedSprintFocus).toBeDefined();
      expect(result.recommendedSprintFocus.priority).toBe('P0');
      expect(result.recommendedSprintFocus.targetPMS).toContain('Dental4Windows');
      expect(result.pmsCompatibilityMatrix.d4w).toBe('Tier 1 Supported');
    });
  });

  describe('QA & Clinical Safety Auditor Agent', () => {
    it('executes clinical evals and issues a production safety certificate with zero hallucinations', async () => {
      const result = await runQaAgent('offline');
      expect(result.productionReady).toBe(true);
      expect(result.safetyCertificate.status).toBe('CERTIFIED_FOR_PRODUCTION');
      expect(result.safetyCertificate.hallucinationCount).toBe(0);
      expect(result.safetyCertificate.avgGroundingScore).toBeGreaterThanOrEqual(0.90);
      expect(result.safetyCertificate.passedCases).toBe(result.safetyCertificate.totalCases);
      expect(result.safetyCertificate.certificateId).toMatch(/^CERT-DENTAI-/);
    });
  });

  describe('GTM & Revenue Intelligence Agent', () => {
    it('calculates unbooked restorative recovery potential in AUD and generates changelog', async () => {
      const result = await runGtmAgent();
      expect(result.periodSummary.totalRecoverableValueAud).toBeGreaterThan(5000);
      expect(result.periodSummary.annualizedPracticeUpsideAud).toBeGreaterThan(100000);
      expect(result.periodSummary.topCategories.length).toBeGreaterThan(0);
      expect(result.practiceOwnerExecutiveBrief).toContain('Practice Principal ROI Teardown');
      expect(result.practiceManagerChangelog).toContain('Dental Practice Manager Update');
      expect(result.outboundSalesPitchAngle).toContain('unbooked');
    });
  });

  describe('Operations & Fleet Health Monitor Agent', () => {
    it('verifies deterministic offline draft engine and PMS clipboard formatting', async () => {
      const result = await runOpsAgent();
      expect(result.overallHealthScore).toBeGreaterThanOrEqual(75);
      expect(result.operationalStatus).toMatch(/OPERATIONAL|DEGRADED/);
      
      const offlineCheck = result.checks.find(c => c.name.includes('Offline Draft'));
      expect(offlineCheck?.status).toBe('HEALTHY');

      const clipboardCheck = result.checks.find(c => c.name.includes('Trojan Horse'));
      expect(clipboardCheck?.status).toBe('HEALTHY');
    });
  });

  describe('Grokbot Master Orchestration Cycle', () => {
    it('executes end-to-end company cycle and writes executive briefing report', async () => {
      const testReportPath = path.resolve(process.cwd(), 'reports', 'company', 'test-briefing.md');
      
      const briefing = await runGrokbotCycle({
        agent: 'all',
        evalTarget: 'offline',
        outputPath: testReportPath
      });

      expect(briefing.overallStatus).toBe('SHIP_READY');
      expect(briefing.company).toBe('DentAI Autonomous Dental Intelligence');
      expect(briefing.qa?.productionReady).toBe(true);
      expect(briefing.product).toBeDefined();
      expect(briefing.gtm).toBeDefined();
      expect(briefing.ops).toBeDefined();

      // Verify written report
      expect(fs.existsSync(testReportPath)).toBe(true);
      const fileContent = fs.readFileSync(testReportPath, 'utf-8');
      expect(fileContent).toContain('DentAI Grokbot Autonomous Company Daily Briefing');
      expect(fileContent).toContain('SHIP_READY');
      expect(fileContent).toContain('QA & Clinical Safety Auditor Bot');
      expect(fileContent).toContain('GTM & Revenue Intelligence Bot');

      // Cleanup test report
      fs.unlinkSync(testReportPath);
    });

    it('formats briefing markdown correctly', () => {
      const mockBriefing = {
        company: 'DentAI',
        cycleId: 'CYCLE-TEST-123',
        timestamp: '2026-09-13T00:00:00.000Z',
        overallStatus: 'SHIP_READY' as const,
        executiveSummary: 'All systems green.',
      };
      const md = formatExecutiveBriefingMarkdown(mockBriefing);
      expect(md).toContain('CYCLE-TEST-123');
      expect(md).toContain('SHIP_READY');
    });
  });
});
