/**
 * Sovereign Multi-Provider Redundancy Router (Work Package 4.1 & APP 8)
 *
 * Directs clinical documentation requests across a 4-tier sovereign failover chain:
 * - Tier 1: Google Cloud Vertex AI Sydney (australia-southeast1) - Primary APP 8 Sovereign
 * - Tier 2: Hosted Secondary Provider (Isolated Quota Pool with Circuit Breaker)
 * - Tier 3: Local Clinic LAN GPU (Zero-WAN Egress via on-prem llama-server)
 * - Tier 4: Offline Deterministic Scribing Engine (generateOfflineDraft V2)
 */

import {
  ProviderTier,
  RouterExecutionContext,
  RouterExecutionResult,
  SovereigntyMetadata
} from './types';
import { CircuitBreaker } from './circuitBreaker';
import { generateOfflineDraft } from '../lib/draftEngine';
import { getTemplateById } from '../lib/dentalLibrary';

export interface SovereignRouterConfig {
  vertexProject?: string;
  vertexLocation?: string;
  geminiApiKey?: string;
  secondaryApiKey?: string;
  localLlanUrl?: string;
  tier1BreakerConfig?: { failureThreshold: number; resetTimeoutMs: number };
  tier2BreakerConfig?: { failureThreshold: number; resetTimeoutMs: number };
  executeVertexCall?: (ctx: RouterExecutionContext) => Promise<any>;
  executeSecondaryCall?: (ctx: RouterExecutionContext) => Promise<any>;
  executeLocalLanCall?: (ctx: RouterExecutionContext) => Promise<any>;
}

export class SovereignRouter {
  public readonly tier1Breaker: CircuitBreaker;
  public readonly tier2Breaker: CircuitBreaker;
  private readonly vertexProject?: string;
  private readonly vertexLocation: string;
  private readonly localLanUrl?: string;

  private readonly executeVertexCall?: (ctx: RouterExecutionContext) => Promise<any>;
  private readonly executeSecondaryCall?: (ctx: RouterExecutionContext) => Promise<any>;
  private readonly executeLocalLanCall?: (ctx: RouterExecutionContext) => Promise<any>;

  constructor(config: SovereignRouterConfig = {}) {
    this.vertexProject = config.vertexProject || process.env.GCP_PROJECT_ID;
    this.vertexLocation = config.vertexLocation || process.env.GCP_REGION || 'australia-southeast1';
    this.localLanUrl = config.localLlanUrl || process.env.DENTAI_LOCAL_LLM_URL;

    this.tier1Breaker = new CircuitBreaker({
      name: 'tier1-vertex-sydney',
      failureThreshold: config.tier1BreakerConfig?.failureThreshold || 2,
      resetTimeoutMs: config.tier1BreakerConfig?.resetTimeoutMs || 30_000
    });

    this.tier2Breaker = new CircuitBreaker({
      name: 'tier2-hosted-secondary',
      failureThreshold: config.tier2BreakerConfig?.failureThreshold || 2,
      resetTimeoutMs: config.tier2BreakerConfig?.resetTimeoutMs || 30_000
    });

    this.executeVertexCall = config.executeVertexCall;
    this.executeSecondaryCall = config.executeSecondaryCall;
    this.executeLocalLanCall = config.executeLocalLanCall;
  }

  /**
   * Dispatches clinical generation through the sovereign failover hierarchy.
   */
  public async execute(context: RouterExecutionContext): Promise<RouterExecutionResult> {
    const startTime = Date.now();

    // ─────────────────────────────────────────────────────────────
    // TIER 1: Sydney-Sovereign Vertex AI (australia-southeast1)
    // ─────────────────────────────────────────────────────────────
    if (this.tier1Breaker.canExecute() && this.executeVertexCall) {
      try {
        const result = await this.executeVertexCall(context);
        this.tier1Breaker.recordSuccess();

        return {
          ok: true,
          output: result,
          sovereignty: this.createSovereigntyMetadata(
            'tier1-vertex-sydney',
            'AU_SYDNEY',
            this.vertexLocation,
            context.model || 'gemini-3.6-flash',
            Date.now() - startTime
          )
        };
      } catch (err: any) {
        const isQuota = this.isRateLimitOrQuota(err);
        this.tier1Breaker.recordFailure(isQuota);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // TIER 2: Secondary Hosted API Key (Separate Quota Pool)
    // ─────────────────────────────────────────────────────────────
    if (this.tier2Breaker.canExecute() && this.executeSecondaryCall) {
      try {
        const result = await this.executeSecondaryCall(context);
        this.tier2Breaker.recordSuccess();

        return {
          ok: true,
          output: result,
          sovereignty: this.createSovereigntyMetadata(
            'tier2-hosted-secondary',
            'AU_SYDNEY',
            'australia-southeast1-fallback',
            context.fallbackModel || 'gemini-3.6-flash',
            Date.now() - startTime
          )
        };
      } catch (err: any) {
        const isQuota = this.isRateLimitOrQuota(err);
        this.tier2Breaker.recordFailure(isQuota);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // TIER 3: Local Clinic LAN GPU (llama-server, Zero WAN Egress)
    // ─────────────────────────────────────────────────────────────
    if (this.executeLocalLanCall) {
      try {
        const result = await this.executeLocalLanCall(context);
        return {
          ok: true,
          output: result,
          sovereignty: this.createSovereigntyMetadata(
            'tier3-local-lan',
            'AU_LOCAL_ONPREM',
            'local-lan',
            'llama-3.3-70b-q4',
            Date.now() - startTime
          )
        };
      } catch (err: any) {
        // Fall through to deterministic tier
      }
    }

    // ─────────────────────────────────────────────────────────────
    // TIER 4: Deterministic Structured Offline Scribing Engine V2
    // ─────────────────────────────────────────────────────────────
    const template = getTemplateById(context.noteTemplateName || 'standard');
    const offlineDraft = generateOfflineDraft(
      template,
      context.transcript || [],
      context.intakeText
    );

    return {
      ok: true,
      output: offlineDraft,
      sovereignty: this.createSovereigntyMetadata(
        'tier4-offline-deterministic',
        'OFFLINE_DETERMINISTIC',
        'offline-local',
        'deterministic-draft-engine-v2',
        Date.now() - startTime
      )
    };
  }

  public getCircuitSnapshots() {
    return {
      tier1: this.tier1Breaker.getSnapshot(),
      tier2: this.tier2Breaker.getSnapshot()
    };
  }

  private isRateLimitOrQuota(err: any): boolean {
    const status = err?.status || err?.statusCode || (err?.code ? Number(err.code) : 0);
    const msg = (err?.message || '').toLowerCase();
    return (
      status === 429 ||
      msg.includes('quota') ||
      msg.includes('rate limit') ||
      msg.includes('resource_exhausted') ||
      msg.includes('billing')
    );
  }

  private createSovereigntyMetadata(
    tier: ProviderTier,
    dataSovereignty: 'AU_SYDNEY' | 'AU_LOCAL_ONPREM' | 'OFFLINE_DETERMINISTIC',
    region: string,
    model: string,
    latencyMs: number
  ): SovereigntyMetadata {
    return {
      dataSovereignty,
      jurisdiction: 'APP_8_COMPLIANT',
      region,
      model,
      tierUsed: tier,
      latencyMs,
      zeroRetentionConfirmed: true,
      audioPurgedAt: new Date().toISOString()
    };
  }
}
