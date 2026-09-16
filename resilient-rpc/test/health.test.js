// Runs against dist/. `npm test` builds first.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReadyPayload, CircuitState } = require('../dist');

test('ready when redis connected and every breaker closed', () => {
  const { body, statusCode } = buildReadyPayload({
    serviceName: 'svc',
    redis: () => true,
    circuitBreakers: {
      'rpc:users': () => CircuitState.CLOSED,
      'rpc:admissions': () => CircuitState.CLOSED,
    },
  });

  assert.equal(statusCode, 200);
  assert.equal(body.status, 'ready');
  assert.deepEqual(body.circuitBreakers, {
    'rpc:users': 'closed',
    'rpc:admissions': 'closed',
  });
});

test('not ready when a breaker is open', () => {
  const { body, statusCode } = buildReadyPayload({
    serviceName: 'svc',
    redis: () => true,
    circuitBreakers: {
      'rpc:users': () => CircuitState.OPEN,
      'rpc:admissions': () => CircuitState.CLOSED,
    },
  });

  assert.equal(statusCode, 503);
  assert.equal(body.status, 'not_ready');
  assert.equal(body.circuitBreakers['rpc:users'], 'open');
});

test('not ready while a breaker is half-open', () => {
  const { body, statusCode } = buildReadyPayload({
    serviceName: 'svc',
    redis: () => true,
    circuitBreakers: {
      'rpc:users': () => CircuitState.HALF_OPEN,
    },
  });

  assert.equal(statusCode, 503);
  assert.equal(body.status, 'not_ready');
});

test('not ready when redis is disconnected even if breakers are closed', () => {
  const { body, statusCode } = buildReadyPayload({
    serviceName: 'svc',
    redis: () => false,
    circuitBreakers: { 'rpc:users': () => CircuitState.CLOSED },
  });

  assert.equal(statusCode, 503);
  assert.equal(body.status, 'not_ready');
  assert.equal(body.checks.redis, 'disconnected');
});

test('not ready when mongo is disconnected', () => {
  const { body, statusCode } = buildReadyPayload({
    serviceName: 'svc',
    redis: () => true,
    mongo: () => false,
  });

  assert.equal(statusCode, 503);
  assert.equal(body.status, 'not_ready');
  assert.equal(body.checks.mongo, 'disconnected');
});
