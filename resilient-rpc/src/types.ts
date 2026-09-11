export interface RpcRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
  replyTo?: string;
  timestamp?: number;
  signature?: string;
  requestId?: string;
}

export interface RpcResponse {
  id: string;
  result?: unknown;
  error?: string | null;
}

export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open',
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxCalls: number;
  onStateChange?: (from: CircuitState, to: CircuitState, channel: string) => void;
}

export const DEFAULT_CIRCUIT_BREAKER_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenMaxCalls: 1,
};

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableErrors: string[];
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 2,
  baseDelayMs: 200,
  maxDelayMs: 2_000,
  retryableErrors: ['econnrefused', 'redis not available', 'connection is closed'],
};

export interface ResilientRpcClientOptions {
  channel: string;
  defaultTimeoutMs: number;
  circuitBreaker: Partial<CircuitBreakerOptions>;
  retry: Partial<RetryOptions>;
}

export const DEFAULT_CLIENT_OPTIONS: ResilientRpcClientOptions = {
  channel: '',
  defaultTimeoutMs: 5_000,
  circuitBreaker: {},
  retry: {},
};

export interface RpcLogger {
  debug(msg: string, ...meta: unknown[]): void;
  info(msg: string, ...meta: unknown[]): void;
  warn(msg: string, ...meta: unknown[]): void;
  error(msg: string, ...meta: unknown[]): void;
}

export const noopLogger: RpcLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
