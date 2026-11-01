/**
 * Minimal circuit breaker. After `failureThreshold` consecutive failures the
 * circuit opens and calls are skipped for `cooldownMs`; then a single trial call
 * is let through (half-open). Success closes it, failure re-opens it.
 *
 * Why: during an outage every new ticket would otherwise wait out the full
 * timeout-and-retry budget before falling back to rules. With the circuit open,
 * fallback is instant and we stop hammering a provider that is already struggling.
 */
export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private trialInFlight = false;

  constructor(
    private readonly failureThreshold = 5,
    private readonly cooldownMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when a call may proceed. A true result in half-open state reserves the trial slot. */
  allowRequest(): boolean {
    if (this.openedAt === null) return true;
    if (this.now() - this.openedAt < this.cooldownMs || this.trialInFlight) return false;
    this.trialInFlight = true;
    return true;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.trialInFlight = false;
  }

  recordFailure(): void {
    this.trialInFlight = false;
    this.consecutiveFailures++;
    if (this.openedAt !== null || this.consecutiveFailures >= this.failureThreshold) {
      this.openedAt = this.now();
    }
  }

  get state(): 'closed' | 'open' | 'half-open' {
    if (this.openedAt === null) return 'closed';
    return this.now() - this.openedAt < this.cooldownMs ? 'open' : 'half-open';
  }
}
