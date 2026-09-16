import amqp, { ChannelModel, ConfirmChannel } from "amqplib";

const DEVELOPMENT_URL = "amqp://localhost";
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

let connection: ChannelModel | null = null;
let channel: ConfirmChannel | null = null;
let initializing: Promise<ConfirmChannel> | null = null;
let closing: Promise<void> | null = null;

const log = (scope: string, error: unknown) =>
  console.error(`[message-broker] ${scope}`, {
    error: error instanceof Error ? error.message : String(error),
  });

const resolveUrl = (value: string | undefined): string => {
  const configured = value?.trim() ?? "";
  const resolved =
    configured || (process.env.NODE_ENV === "production" ? "" : DEVELOPMENT_URL);
  if (!resolved) throw new Error("RABBITMQ_URL is required in production");
  const parsed = new URL(resolved);
  if (parsed.protocol !== "amqp:" && parsed.protocol !== "amqps:") {
    throw new TypeError("RabbitMQ URL must use amqp or amqps");
  }
  return resolved;
};

const establish = async (url: string): Promise<ConfirmChannel> => {
  const timeout = Number(process.env.RABBITMQ_CONNECT_TIMEOUT_MS) || DEFAULT_CONNECT_TIMEOUT_MS;
  const conn = await amqp.connect(url, { timeout });
  connection = conn;
  try {
    conn.on("error", (e) => log("connection error", e));
    conn.on("close", () => {
      if (connection === conn) {
        connection = null;
        channel = null;
      }
    });

    const ch = await conn.createConfirmChannel();
    if (connection !== conn) {
      await ch.close().catch(() => undefined);
      throw new Error("RabbitMQ connection closed during initialization");
    }
    channel = ch;
    ch.on("error", (e) => log("channel error", e));
    ch.on("close", () => {
      if (channel !== ch) return;
      channel = null;
      if (connection === conn) connection = null;
      void conn.close().catch((e) => log("connection close", e));
    });
    return ch;
  } catch (error) {
    if (connection === conn) connection = null;
    channel = null;
    await conn.close().catch((e) => log("connection close", e));
    throw error;
  }
};

export async function getRabbitChannel(
  url: string | undefined = process.env.RABBITMQ_URL,
): Promise<ConfirmChannel> {
  if (closing) await closing;
  if (channel) return channel;
  if (initializing) return initializing;

  const pending = establish(resolveUrl(url));
  initializing = pending;
  void pending.finally(() => {
    if (initializing === pending) initializing = null;
  }).catch(() => undefined);
  return pending;
}

const closeResources = async (): Promise<void> => {
  if (initializing) await initializing.catch(() => undefined);
  const ch = channel;
  const conn = connection;
  channel = null;
  connection = null;
  initializing = null;

  let failure: unknown;
  for (const closeable of [ch, conn]) {
    try {
      await closeable?.close();
    } catch (e) {
      failure ??= e;
    }
  }
  if (failure) throw failure;
};

export function closeRabbit(): Promise<void> {
  if (closing) return closing;
  const pending = closeResources();
  closing = pending;
  void pending.finally(() => {
    if (closing === pending) closing = null;
  }).catch(() => undefined);
  return pending;
}
