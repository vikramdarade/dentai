import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runProductAgent } from '../scripts/company/agents/productAgent.js';
import { runEngineerAgent } from '../scripts/company/agents/engineerAgent.js';
import { runQaAgent } from '../scripts/company/agents/qaAgent.js';
import { runSecurityAgent } from '../scripts/company/agents/securityAgent.js';
import { runSupportAgent } from '../scripts/company/agents/supportAgent.js';
import { runFinanceAgent } from '../scripts/company/agents/financeAgent.js';
import { runGtmAgent } from '../scripts/company/agents/gtmAgent.js';
import { runOpsAgent } from '../scripts/company/agents/opsAgent.js';
import { runGrokbotCycle, formatExecutiveBriefingMarkdown } from '../scripts/company/grokbot.js';

describe('DentAI Autonomous SaaS Company Orchestrator (Grokbot)', () => {
  describe('1. Product & Strategy Agent', () => {
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

  describe('2. Autonomous Software Engineer Agent', () => {
    it('scaffolds implementation PRs and verifies type contracts from product tickets', async () => {
      const productResult = await runProductAgent();
      const result = await runEngineerAgent(productResult.recommendedSprintFocus);
      expect(result.agentName).toContain('Software Engineering');
      expect(result.generatedPR.prId).toMatch(/^PR-/);
      expect(result.generatedPR.branchName).toContain('feat/');
      expect(result.generatedPR.status).toBe('COMPILED_CLEAN');
      expect(result.generatedPR.targetFiles.length).toBeGreaterThan(0);
      expect(result.generatedPR.scaffoldedCodeSnippet).toContain('formatD4WClipboardPayload');
      expect(result.buildCheck.typeCheckPassed).toBe(true);
    });
  });

  describe('3. QA & Clinical Safety Auditor Agent', () => {
    it('executes clinical evals and issues a production safety certificate with zero hallucinations', async () => {
      const result = await runQaAgent('offline');
      expect(result.productionReady).toBe(true);
      expect(result.safetyCertificate.status).toBe('CERTIFIED_FOR_PRODUCTION');
      expect(result.safetyCertificate.hallucinationCount).toBe(0);
      expect(result.safetyCertificate.avgGroundingScore).toBeGreaterThanOrEqual(90);
      expect(result.safetyCertificate.passedCases).toBe(result.safetyCertificate.totalCases);
      expect(result.safetyCertificate.certificateId).toMatch(/^CERT-DENTAI-/);
    });
  });

  describe('4. Security & Compliance Agent', () => {
    it('audits Australian Privacy Act 1988, APRA CPS 234, and ephemeral audio processing', async () => {
      const result = await runSecurityAgent();
      expect(result.complianceRating).toBe('AHPRA_COMPLIANT');
      expect(result.overallScore).toBe(100);
      expect(result.dataResidency.audioPersistence).toBe('Ephemeral In-Memory Only');
      expect(result.checks.length).toBeGreaterThanOrEqual(5);

      const audioCheck = result.checks.find(c => c.id === 'SEC-01-EPHEMERAL-AUDIO');
      expect(audioCheck?.status).toBe('PASS');

      const pinCheck = result.checks.find(c => c.id === 'SEC-02-PIN-HASHING');
      expect(pinCheck?.status).toBe('PASS');
    });
  });

  describe('5. Customer Support & Clinic Onboarding Agent', () => {
    it('provides automated onboarding playbooks and clinic resolution tickets', async () => {
      const result = await runSupportAgent();
      expect(result.clinicSatisfactionScore).toBeGreaterThanOrEqual(95);
      expect(result.onboardingPlaybook.length).toBeGreaterThanOrEqual(2);
      expect(result.activeTriageTickets.length).toBeGreaterThanOrEqual(0);
      expect(result.onboardingPlaybook[0].steps.length).toBeGreaterThan(0);
    });
  });

  describe('6. Finance & Unit Economics Agent', () => {
    it('calculates SaaS gross margins, ARR, and clinic ROI multiples', async () => {
      const result = await runFinanceAgent();
      expect(result.financialHealthRating).toBe('STRONG_UNIT_ECONOMICS');
      expect(result.metrics.monthlyGrossMarginPercent).toBeGreaterThanOrEqual(95);
      expect(result.metrics.monthlyRecurringRevenueAud).toBeGreaterThan(0);
      expect(result.metrics.annualRecurringRevenueAud).toBeGreaterThan(0);
      expect(result.unitEconomics.clinicRoiMultiple).toBeGreaterThan(50);
      expect(result.quotaRunwayDays).toBeGreaterThan(30);
    });
  });

  describe('7. GTM & Revenue Intelligence Agent', () => {
    it('calculates unbooked restorative recovery potential in AUD and generates changelog', async () => {
      const result = await runGtmAgent();
      expect(result.periodSummary.totalRecoverableValueAud).toBeGreaterThan(0);
      expect(result.periodSummary.annualizedPracticeUpsideAud).toBeGreaterThan(0);
      expect(result.periodSummary.topCategories.length).toBeGreaterThan(0);
      expect(result.practiceOwnerExecutiveBrief).toContain('Practice Principal ROI Teardown');
      expect(result.practiceManagerChangelog).toContain('Dental Practice Manager Update');
      expect(result.outboundSalesPitchAngle).toContain('unbooked');
    });
  });

  describe('8. Operations & Fleet Health Monitor Agent', () => {
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

  describe('Master 8-Department Orchestration Cycle', () => {
    it('executes end-to-end autonomous company cycle and writes executive briefing report', async () => {
      const testReportPath = path.resolve(process.cwd(), 'reports', 'company', 'test-briefing.md');
      
      const briefing = await runGrokbotCycle({
        agent: 'all',
        evalTarget: 'offline',
        outputPath: testReportPath
      });

      expect(briefing.overallStatus).toBe('SHIP_READY');
      expect(briefing.company).toBe('DentAI Autonomous Dental Intelligence');
      expect(briefing.qa?.productionReady).toBe(true);
      expect(briefing.engineer).toBeDefined();
      expect(briefing.security).toBeDefined();
      expect(briefing.support).toBeDefined();
      expect(briefing.finance).toBeDefined();
      expect(briefing.product).toBeDefined();
      expect(briefing.gtm).toBeDefined();
      expect(briefing.ops).toBeDefined();

      // Verify written report
      expect(fs.existsSync(testReportPath)).toBe(true);
      const fileContent = fs.readFileSync(testReportPath, 'utf-8');
      expect(fileContent).toContain('DentAI Grokbot Autonomous Company Daily Briefing');
      expect(fileContent).toContain('SHIP_READY');
      expect(fileContent).toContain('QA & Clinical Safety Auditor Bot');
      expect(fileContent).toContain('Software Engineering Bot');
      expect(fileContent).toContain('Security, Privacy & Compliance Bot');
      expect(fileContent).toContain('Finance & Unit Economics Bot');
      expect(fileContent).toContain('Customer Support & Clinic Onboarding Bot');
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
        executiveSummary: 'All systems green across all 8 departments.',
      };
      const md = formatExecutiveBriefingMarkdown(mockBriefing);
      expect(md).toContain('CYCLE-TEST-123');
      expect(md).toContain('SHIP_READY');
    });
  });
});
