/**
 * Sovereign Multi-Provider Circuit Breaker (Work Package 4.1.3)
 *
 * Prevents cascading latency and user-facing crashes by immediately tripping
 * upon detecting 429 Too Many Requests, quota exhaustion, or consecutive network failures.
 */

import {
  CircuitBreakerConfig,
  CircuitBreakerSnapshot,
  CircuitBreakerState
} from './types';

export class CircuitBreaker {
  public readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenSuccessThreshold: number;

  private state: CircuitBreakerState = 'CLOSED';
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private nextAttemptAllowedAt: number | null = null;

  constructor(config: CircuitBreakerConfig) {
    this.name = config.name;
    this.failureThreshold = Math.max(1, config.failureThreshold || 3);
    this.resetTimeoutMs = Math.max(1000, config.resetTimeoutMs || 30_000);
    this.halfOpenSuccessThreshold = Math.max(1, config.halfOpenSuccessThreshold || 1);
  }

  /**
   * Evaluates if execution is permitted through this provider route.
   */
  public canExecute(): boolean {
    const now = Date.now();

    if (this.state === 'CLOSED') {
      return true;
    }

    if (this.state === 'OPEN') {
      if (this.nextAttemptAllowedAt !== null && now >= this.nextAttemptAllowedAt) {
        this.transitionTo('HALF_OPEN');
        return true;
      }
      return false;
    }

    if (this.state === 'HALF_OPEN') {
      return true;
    }

    return true;
  }

  /**
   * Records a successful execution through this provider.
   */
  public recordSuccess(): void {
    const now = Date.now();
    this.lastSuccessAt = now;

    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.halfOpenSuccessThreshold) {
        this.transitionTo('CLOSED');
        this.failureCount = 0;
        this.nextAttemptAllowedAt = null;
      }
    } else if (this.state === 'CLOSED') {
      this.failureCount = 0;
    }
  }

  /**
   * Records an execution failure through this provider.
   * If error is 429 or quota exhaustion, trips OPEN immediately.
   */
  public recordFailure(isQuotaOr429: boolean = false): void {
    const now = Date.now();
    this.lastFailureAt = now;
    this.failureCount++;

    if (this.state === 'HALF_OPEN' || isQuotaOr429 || this.failureCount >= this.failureThreshold) {
      this.transitionTo('OPEN');
      this.nextAttemptAllowedAt = now + this.resetTimeoutMs;
      this.successCount = 0;
    }
  }

  /**
   * Resets the circuit breaker to clean closed state.
   */
  public reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureAt = null;
    this.lastSuccessAt = null;
    this.nextAttemptAllowedAt = null;
  }

  /**
   * Current snapshot of circuit breaker health metrics.
   */
  public getSnapshot(): CircuitBreakerSnapshot {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
      nextAttemptAllowedAt: this.nextAttemptAllowedAt
    };
  }

  public getState(): CircuitBreakerState {
    return this.state;
  }

  private transitionTo(newState: CircuitBreakerState): void {
    this.state = newState;
  }
}
