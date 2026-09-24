/**
 * Sovereign Cloud Architecture & Compliance Contracts (Work Package 4.0)
 *
 * Implements Australian Privacy Principle 8 (APP 8), sovereign Sydney data residency,
 * zero-retention raw audio scrubbing, and multi-provider circuit breaker contracts.
 */

export type SovereignRegion = 'australia-southeast1' | 'local-lan' | 'offline-local';

export type ProviderTier =
  | 'tier1-vertex-sydney'
  | 'tier2-hosted-secondary'
  | 'tier3-local-lan'
  | 'tier4-offline-deterministic';

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface SovereigntyMetadata {
  /** Australian Data Sovereignty guarantee under APP 8 */
  dataSovereignty: 'AU_SYDNEY' | 'AU_LOCAL_ONPREM' | 'OFFLINE_DETERMINISTIC';
  /** Regulatory jurisdiction */
  jurisdiction: 'APP_8_COMPLIANT';
  /** Specific cloud / server region */
  region: SovereignRegion | string;
  /** AI Model used */
  model: string;
  /** Active failover tier that fulfilled the request */
  tierUsed: ProviderTier;
  /** Execution latency in milliseconds */
  latencyMs: number;
  /** Confirmation that raw audio was not persisted on external servers */
  zeroRetentionConfirmed: boolean;
  /** Timestamp when raw audio voice data was cryptographically purged */
  audioPurgedAt?: string;
  /** Circuit breaker state at execution time */
  circuitState?: CircuitBreakerState;
}

export interface CircuitBreakerConfig {
  /** Name of the provider */
  name: string;
  /** Consecutive failures or 429s before tripping open */
  failureThreshold: number;
  /** Cool-down window in milliseconds before half-open probe */
  resetTimeoutMs: number;
  /** Maximum consecutive successes in half-open state before closing */
  halfOpenSuccessThreshold?: number;
}

export interface CircuitBreakerSnapshot {
  name: string;
  state: CircuitBreakerState;
  failureCount: number;
  successCount: number;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  nextAttemptAllowedAt: number | null;
}

export interface EncryptedPayloadEnvelope {
  /** Cipher identifier */
  algorithm: 'aes-256-gcm';
  /** Initialization vector in hex */
  iv: string;
  /** Authentication tag in hex */
  authTag: string;
  /** Encrypted ciphertext in hex or base64 */
  ciphertext: string;
  /** Timestamp when encrypted */
  encryptedAt: string;
}

export interface RouterExecutionContext {
  dentistId?: string;
  clinicId?: string;
  noteTemplateName?: string;
  intakeText?: string;
  transcript: any[];
  [key: string]: any;
}

export interface RouterExecutionResult {
  ok: boolean;
  output?: any;
  error?: string;
  isQuotaError?: boolean;
  sovereignty: SovereigntyMetadata;
}
