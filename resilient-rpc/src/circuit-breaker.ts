import {
  CircuitBreakerOptions,
  CircuitState,
  DEFAULT_CIRCUIT_BREAKER_OPTIONS,
} from './types';

export class CircuitOpenError extends Error {
  constructor(public readonly channel: string) {
    super(`Circuit breaker is OPEN for channel "${channel}"`);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private halfOpenCalls = 0;
  private lastFailureTime = 0;
  private readonly opts: CircuitBreakerOptions;

  constructor(
    private readonly channel: string,
    partialOpts?: Partial<CircuitBreakerOptions>,
  ) {
    this.opts = { ...DEFAULT_CIRCUIT_BREAKER_OPTIONS, ...partialOpts };
  }

  get currentState(): CircuitState {
    if (
      this.state === CircuitState.OPEN &&
      Date.now() - this.lastFailureTime >= this.opts.resetTimeoutMs
    ) {
      this.transition(CircuitState.HALF_OPEN);
      this.halfOpenCalls = 0;
    }
    return this.state;
  }

  allowRequest(): boolean {
    const s = this.currentState;

    if (s === CircuitState.CLOSED) return true;

    if (s === CircuitState.HALF_OPEN) {
      if (this.halfOpenCalls < this.opts.halfOpenMaxCalls) {
        this.halfOpenCalls++;
        return true;
      }
      return false;
    }

    return false;
  }

  recordSuccess(): void {
    this.failureCount = 0;
    if (this.state !== CircuitState.CLOSED) {
      this.transition(CircuitState.CLOSED);
    }
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.transition(CircuitState.OPEN);
      return;
    }

    if (
      this.state === CircuitState.CLOSED &&
      this.failureCount >= this.opts.failureThreshold
    ) {
      this.transition(CircuitState.OPEN);
    }
  }

  reset(): void {
    this.failureCount = 0;
    this.halfOpenCalls = 0;
    this.lastFailureTime = 0;
    if (this.state !== CircuitState.CLOSED) {
      this.transition(CircuitState.CLOSED);
    }
  }

  private transition(to: CircuitState): void {
    if (to === this.state) return;
    const from = this.state;
    this.state = to;
    this.opts.onStateChange?.(from, to, this.channel);
  }
}
