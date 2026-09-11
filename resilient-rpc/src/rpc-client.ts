import * as crypto from 'crypto';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';
import { withRetry } from './retry';
import { getRequestId } from './request-id';
import {
  CircuitBreakerOptions,
  CircuitState,
  RetryOptions,
  RpcLogger,
  noopLogger,
  RpcRequest,
  RpcResponse,
  DEFAULT_CLIENT_OPTIONS,
} from './types';

export type RedisPublisher = {
  publish(channel: string, message: string): Promise<unknown>;
};

export type RedisSubscriber = {
  subscribe(...channels: string[]): Promise<unknown>;
  on(event: string, listener: (...args: any[]) => void): void;
  removeListener(event: string, listener: (...args: any[]) => void): void;
  unsubscribe(...channels: string[]): Promise<unknown>;
};

export type RedisGetter = {
  getPublisher: () => RedisPublisher;
  getSubscriber: () => RedisSubscriber;
};

export interface CreateResilientClientParams {
  channel: string;
  redis: RedisGetter;
  timeoutMs?: number;
  circuitBreaker?: Partial<CircuitBreakerOptions>;
  retry?: Partial<RetryOptions>;
  logger?: RpcLogger;
}

export interface ResilientClient {
  call<T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  getCircuitState(): CircuitState;
}

/** Error returned by the remote handler (business error). Does not count against the circuit breaker. */
export class RpcRemoteError extends Error {
  constructor(message: string, public readonly method: string) {
    super(message);
    this.name = 'RpcRemoteError';
  }
}

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  replyChannel: string;
};

export function createResilientRpcClient(opts: CreateResilientClientParams): ResilientClient {
  const { channel, redis, logger = noopLogger } = opts;
  const defaultTimeoutMs = opts.timeoutMs ?? DEFAULT_CLIENT_OPTIONS.defaultTimeoutMs;
  const breaker = new CircuitBreaker(channel, opts.circuitBreaker);

  // One 'message' listener per client, replies routed by id.
  const pending = new Map<string, Pending>();
  const attachedTo = new WeakSet<RedisSubscriber>();

  const onMessage = (_chan: string, message: string) => {
    let payload: RpcResponse;
    try {
      payload = JSON.parse(message);
    } catch {
      return;
    }
    const p = pending.get(payload.id);
    if (!p) return;
    if (payload.error) p.reject(new RpcRemoteError(payload.error, _chan));
    else p.resolve(payload.result);
  };

  function ensureListener(sub: RedisSubscriber) {
    // ponytail: subscriber instance can be swapped by closeRedis/initRedis, so key on the instance
    if (attachedTo.has(sub)) return;
    sub.on('message', onMessage);
    attachedTo.add(sub);
  }

  function rawRpcCall(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    const pub = redis.getPublisher();
    const sub = redis.getSubscriber();
    ensureListener(sub);

    const id = crypto.randomUUID();
    const replyChannel = `${channel}:response:${id}`;

    return new Promise<unknown>((resolve, reject) => {
      const settle = (fn: (v: any) => void) => (v: unknown) => {
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        clearTimeout(p.timer);
        sub.unsubscribe(replyChannel).catch(() => {});
        fn(v);
      };

      pending.set(id, {
        resolve: settle(resolve),
        reject: settle(reject),
        replyChannel,
        timer: setTimeout(() => settle(reject)(new Error('RPC timeout')), timeoutMs),
      });

      const req: RpcRequest = { id, method, params, replyTo: replyChannel };

      const rpcSecret = process.env.RPC_SECRET || process.env.RPC_HMAC_SECRET;
      if (rpcSecret) {
        req.timestamp = Date.now();
        // Must sign exactly what is sent (server signs req.params as received).
        const payload = `${id}:${method}:${JSON.stringify(params)}:${req.timestamp}`;
        req.signature = crypto.createHmac('sha256', rpcSecret).update(payload).digest('hex');
      }

      sub.subscribe(replyChannel)
        .then(() => pub.publish(channel, JSON.stringify(req)))
        .catch(settle(reject));
    });
  }

  function injectRequestId(params: Record<string, unknown> | undefined): Record<string, unknown> {
    const rid = getRequestId();
    return rid ? { ...(params || {}), _requestId: rid } : { ...(params || {}) };
  }

  return {
    async call<T = unknown>(
      method: string,
      params?: Record<string, unknown>,
      timeoutMs?: number,
    ): Promise<T> {
      if (!breaker.allowRequest()) throw new CircuitOpenError(channel);

      const finalParams = injectRequestId(params);
      try {
        const result = await withRetry(
          () => rawRpcCall(method, finalParams, timeoutMs ?? defaultTimeoutMs),
          opts.retry,
          logger,
        );
        breaker.recordSuccess();
        return result as T;
      } catch (err) {
        // Business errors from the remote handler are not infrastructure failures.
        if (!(err instanceof RpcRemoteError)) breaker.recordFailure();
        throw err;
      }
    },

    getCircuitState(): CircuitState {
      return breaker.currentState;
    },
  };
}
