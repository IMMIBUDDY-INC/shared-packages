import { CircuitState } from './types';

export interface HealthCheck {
  (): boolean;
}

export interface CircuitBreakerProvider {
  (): CircuitState;
}

export interface HealthContext {
  serviceName?: string;
  redis?: HealthCheck;
  mongo?: HealthCheck;
  circuitBreakers?: Record<string, CircuitBreakerProvider>;
}

interface HealthResponse {
  status: string;
  service: string;
  uptime?: number;
  checks?: Record<string, string>;
  circuitBreakers?: Record<string, string>;
}

const startedAt = Date.now();

function buildReadinessPayload(ctx: HealthContext): { body: HealthResponse; statusCode: number } {
  const checks: Record<string, string> = {};
  let allReady = true;

  if (ctx.redis) {
    checks.redis = ctx.redis() ? 'connected' : 'disconnected';
    if (checks.redis !== 'connected') allReady = false;
  }
  if (ctx.mongo) {
    checks.mongo = ctx.mongo() ? 'connected' : 'disconnected';
    if (checks.mongo !== 'connected') allReady = false;
  }

  const cbStates: Record<string, string> = {};
  if (ctx.circuitBreakers) {
    for (const [name, getState] of Object.entries(ctx.circuitBreakers)) {
      const state = getState();
      cbStates[name] = state;
      if (state !== CircuitState.CLOSED) allReady = false;
    }
  }

  const body: HealthResponse = {
    status: allReady ? 'ready' : 'not_ready',
    service: ctx.serviceName || process.env.SERVICE_NAME || 'unknown',
    checks,
    circuitBreakers: cbStates,
  };

  return { body, statusCode: allReady ? 200 : 503 };
}

export function createExpressHealthRouter(ctx: HealthContext): any {
  let Router: any;
  try {
    Router = require('express').Router;
  } catch {
    throw new Error(
      'createExpressHealthRouter requires express as a peer dependency. ' +
      'Install it with: npm install express',
    );
  }

  const router = Router();

  router.get('/health', (_req: any, res: any) => {
    res.status(200).json({
      status: 'ok',
      service: ctx.serviceName || process.env.SERVICE_NAME || 'unknown',
      uptime: Math.floor((Date.now() - startedAt) / 1000),
    });
  });

  router.get('/ready', (_req: any, res: any) => {
    const { body, statusCode } = buildReadinessPayload(ctx);
    res.status(statusCode).json(body);
  });

  return router;
}

export { buildReadinessPayload as buildReadyPayload };

export function buildHealthPayload(ctx: HealthContext): HealthResponse {
  return {
    status: 'ok',
    service: ctx.serviceName || process.env.SERVICE_NAME || 'unknown',
    uptime: Math.floor((Date.now() - startedAt) / 1000),
  };
}
