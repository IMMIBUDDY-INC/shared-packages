import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestId<T>(
  requestId: string,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return storage.run({ requestId }, fn);
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

export function generateRequestId(): string {
  return randomUUID();
}

export function requestIdMiddleware(
  req: { headers: Record<string, any> },
  res: { setHeader(name: string, value: string): void },
  next: () => void,
): void {
  const incoming =
    (req.headers['x-request-id'] as string | undefined) ||
    (req.headers['X-Request-Id'] as string | undefined);
  const id = incoming && incoming.length <= 128 ? incoming : generateRequestId();

  req.headers['x-request-id'] = id;
  res.setHeader('x-request-id', id);

  storage.run({ requestId: id }, next);
}
