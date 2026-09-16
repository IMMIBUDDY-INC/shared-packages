import type { Channel } from "amqplib";

export const EVENTS_EXCHANGE = "events";
export const DLX_EXCHANGE = "dlx";

export const QUEUES = {
  notifications: "notifications",
  communityEvents: "community-events",
  embeddingSync: "embedding-sync",
} as const;

export const EMBEDDING_RETRY_QUEUE = "embedding-sync.retry";
export const EMBEDDING_RETRY_DELAY_MS = 60_000;

const BINDINGS: Array<[queue: string, pattern: string]> = [
  [QUEUES.notifications, "events.#"],
  [QUEUES.communityEvents, "events.payments.#"],
  [QUEUES.embeddingSync, "events.program.#"],
];

export async function assertTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(EVENTS_EXCHANGE, "topic", { durable: true });
  await channel.assertExchange(DLX_EXCHANGE, "direct", { durable: true });

  for (const [queue, pattern] of BINDINGS) {
    const dlq = `${queue}.dlq`;

    const deadLetterKey = queue === QUEUES.embeddingSync ? EMBEDDING_RETRY_QUEUE : dlq;

    await channel.assertQueue(dlq, { durable: true });
    await channel.bindQueue(dlq, DLX_EXCHANGE, dlq);
    await channel.assertQueue(queue, {
      durable: true,
      deadLetterExchange: DLX_EXCHANGE,
      deadLetterRoutingKey: deadLetterKey,
    });
    await channel.bindQueue(queue, EVENTS_EXCHANGE, pattern);
  }

  await channel.assertQueue(EMBEDDING_RETRY_QUEUE, {
    durable: true,
    messageTtl: EMBEDDING_RETRY_DELAY_MS,
    deadLetterExchange: "",
    deadLetterRoutingKey: QUEUES.embeddingSync,
  });
  await channel.bindQueue(EMBEDDING_RETRY_QUEUE, DLX_EXCHANGE, EMBEDDING_RETRY_QUEUE);
}
