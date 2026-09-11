// Runs against dist/. `npm test` builds first.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const {
  createResilientRpcClient,
  CircuitOpenError,
  RpcRemoteError,
  CircuitState,
  runWithRequestId,
} = require('../dist');

// In-memory pub/sub with a scripted server handler.
function fakeRedis(handler) {
  const sub = new EventEmitter();
  sub.subscribe = async () => {};
  sub.unsubscribe = async () => {};
  const pub = {
    async publish(_chan, msg) {
      const req = JSON.parse(msg);
      const res = await handler(req);
      if (res) setImmediate(() => sub.emit('message', req.replyTo, JSON.stringify({ id: req.id, ...res })));
    },
  };
  return { redis: { getPublisher: () => pub, getSubscriber: () => sub }, sub };
}

test('signature covers the params actually sent (incl. _requestId)', async () => {
  process.env.RPC_SECRET = 's3cret';
  const { redis } = fakeRedis((req) => {
    const expected = crypto
      .createHmac('sha256', 's3cret')
      .update(`${req.id}:${req.method}:${JSON.stringify(req.params)}:${req.timestamp}`)
      .digest('hex');
    assert.equal(req.signature, expected);
    assert.equal(req.params._requestId, 'rid-1');
    return { result: 'ok' };
  });
  const client = createResilientRpcClient({ channel: 'rpc:x', redis });
  const out = await runWithRequestId('rid-1', () => client.call('ping', { a: 1 }));
  assert.equal(out, 'ok');
  delete process.env.RPC_SECRET;
});

test('remote business errors do not trip the breaker; timeouts do', async () => {
  const { redis } = fakeRedis(() => ({ error: 'User not found' }));
  const client = createResilientRpcClient({
    channel: 'rpc:x', redis, circuitBreaker: { failureThreshold: 2 },
  });
  for (let i = 0; i < 5; i++) {
    await assert.rejects(client.call('get'), RpcRemoteError);
  }
  assert.equal(client.getCircuitState(), CircuitState.CLOSED);

  const silent = fakeRedis(() => null); // never replies
  const c2 = createResilientRpcClient({
    channel: 'rpc:y', redis: silent.redis, timeoutMs: 10, circuitBreaker: { failureThreshold: 2 },
  });
  await assert.rejects(c2.call('get'), /RPC timeout/);
  await assert.rejects(c2.call('get'), /RPC timeout/);
  await assert.rejects(c2.call('get'), CircuitOpenError);
});

test('one message listener regardless of concurrency', async () => {
  const { redis, sub } = fakeRedis((req) => ({ result: req.params.n }));
  const client = createResilientRpcClient({ channel: 'rpc:x', redis });
  const results = await Promise.all(
    Array.from({ length: 50 }, (_, n) => client.call('echo', { n })),
  );
  assert.deepEqual(results, Array.from({ length: 50 }, (_, n) => n));
  assert.equal(sub.listenerCount('message'), 1);
});

test('timeout is not retried by default', async () => {
  let calls = 0;
  const { redis } = fakeRedis(() => { calls++; return null; });
  const client = createResilientRpcClient({ channel: 'rpc:x', redis, timeoutMs: 10 });
  await assert.rejects(client.call('slow'), /RPC timeout/);
  assert.equal(calls, 1);
});
