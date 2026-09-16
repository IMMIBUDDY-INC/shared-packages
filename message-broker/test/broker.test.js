const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertTopology,
  getRabbitChannel,
  publishEvent,
  consumeQueue,
  shutdown,
  QUEUES,
} = require("../dist");

const url = process.env.RABBITMQ_TEST_URL;

test("publish -> consume -> ack, and a thrown handler dead-letters", { skip: !url }, async () => {
  process.env.RABBITMQ_URL = url;
  const channel = await getRabbitChannel();
  await assertTopology(channel);
  const dlq = `${QUEUES.communityEvents}.dlq`;
  await channel.purgeQueue(QUEUES.communityEvents);
  await channel.purgeQueue(dlq);

  const seen = [];
  let resolveSeen;
  const twoSeen = new Promise((r) => (resolveSeen = r));
  await consumeQueue(QUEUES.communityEvents, async (msg, body) => {
    seen.push({ rk: msg.fields.routingKey, body });
    if (seen.length === 2) resolveSeen();
    if (body.includes("boom")) throw new Error("boom");
  });

  await publishEvent("events", "events.payments.ok", JSON.stringify({ ok: 1 }));
  await publishEvent("events", "events.payments.fail", JSON.stringify({ boom: 1 }));
  await twoSeen;

  // give the nack a moment to land in the DLQ
  await new Promise((r) => setTimeout(r, 200));
  const dead = await channel.checkQueue(dlq);
  assert.equal(seen[0].rk, "events.payments.ok");
  assert.equal(dead.messageCount, 1);

  const live = await channel.checkQueue(QUEUES.communityEvents);
  assert.equal(live.messageCount, 0);
  await shutdown();
});
