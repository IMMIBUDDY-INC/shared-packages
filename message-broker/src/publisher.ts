import { getRabbitChannel } from "./connection";

export async function publishEvent(
  exchange: string,
  routingKey: string,
  payload: string | Buffer,
): Promise<void> {
  const channel = await getRabbitChannel();
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
  await new Promise<void>((resolve, reject) => {
    channel.publish(
      exchange,
      routingKey,
      body,
      { persistent: true, contentType: "application/json", timestamp: Date.now() },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}
