import { RetryOptions, DEFAULT_RETRY_OPTIONS } from './types';

export function isRetryableError(
  err: unknown,
  patterns: string[],
): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return patterns.some((p) => msg.includes(p.toLowerCase()));
}

export function computeDelay(attempt: number, opts: RetryOptions): number {
  const exponential = opts.baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * opts.baseDelayMs;
  return Math.min(exponential + jitter, opts.maxDelayMs);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  partialOpts?: Partial<RetryOptions>,
  logger?: { warn(msg: string, ...meta: unknown[]): void },
): Promise<T> {
  const opts: RetryOptions = { ...DEFAULT_RETRY_OPTIONS, ...partialOpts };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt >= opts.maxRetries || !isRetryableError(err, opts.retryableErrors)) {
        throw err;
      }

      const delay = computeDelay(attempt, opts);
      logger?.warn(
        `RPC call failed (attempt ${attempt + 1}/${opts.maxRetries + 1}), ` +
        `retrying in ${Math.round(delay)}ms: ${err instanceof Error ? err.message : String(err)}`,
      );
      await sleep(delay);
    }
  }

  throw lastError;
}
