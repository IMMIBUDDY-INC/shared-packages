import type { ConsumeMessage } from "amqplib";
import { closeRabbit, getRabbitChannel } from "./connection";

export type MessageHandler = (msg: ConsumeMessage, body: string) => Promise<void>;

export interface ConsumeOptions {
  prefetch?: number;
}

type Registration = { queue: string; handler: MessageHandler; prefetch: number };

const registrations: Registration[] = [];
const inFlight = new Set<Promise<void>>();
let consumerTags: string[] = [];
let stopping = false;

const log = (level: "info" | "error", msg: string, meta?: object) =>
  console[level](`[message-broker] ${msg}`, meta ?? "");

const attach = async (reg: Registration): Promise<void> => {
  const channel = await getRabbitChannel();
  await channel.prefetch(reg.prefetch);
  const { consumerTag } = await channel.consume(reg.queue, (msg) => {
    if (!msg) return; // consumer cancelled by broker
    const task = reg
      .handler(msg, msg.content.toString("utf8"))
      .then(() => channel.ack(msg))
      .catch((err) => {
        log("error", "handler failed, dead-lettering", {
          queue: reg.queue,
          routingKey: msg.fields.routingKey,
          error: err instanceof Error ? err.message : String(err),
        });
        // requeue:false -> DLX. Never requeue:true: that is an instant hot loop.
        channel.nack(msg, false, false);
      })
      .finally(() => inFlight.delete(task));
    inFlight.add(task);
  });
  consumerTags.push(consumerTag);

  channel.once("close", () => {
    consumerTags = consumerTags.filter((t) => t !== consumerTag);
    if (stopping) return;
    log("error", "channel closed, reconnecting consumer", { queue: reg.queue });
    void reconnect(reg);
  });
};

const reconnect = async (reg: Registration, attempt = 1): Promise<void> => {
  try {
    await attach(reg);
    log("info", "consumer reconnected", { queue: reg.queue });
  } catch (err) {
    if (stopping) return;
    const delay = Math.min(1000 * 2 ** (attempt - 1), 30_000);
    log("error", `reconnect failed, retrying in ${delay}ms`, {
      queue: reg.queue,
      error: err instanceof Error ? err.message : String(err),
    });
    setTimeout(() => void reconnect(reg, attempt + 1), delay).unref();
  }
};

export async function consumeQueue(
  queue: string,
  handler: MessageHandler,
  options: ConsumeOptions = {},
): Promise<void> {
  const reg: Registration = { queue, handler, prefetch: options.prefetch ?? 10 };
  registrations.push(reg);
  await attach(reg);
}

export async function shutdown(): Promise<void> {
  stopping = true;
  try {
    const channel = await getRabbitChannel();
    await Promise.all(consumerTags.map((t) => channel.cancel(t).catch(() => undefined)));
  } catch {
    // no live channel: nothing to cancel
  }
  consumerTags = [];
  await Promise.allSettled([...inFlight]);
  await closeRabbit();
}
