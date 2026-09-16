export { getRabbitChannel, closeRabbit } from "./connection";
export { publishEvent } from "./publisher";
export { consumeQueue, shutdown } from "./consumer";
export type { MessageHandler, ConsumeOptions } from "./consumer";
export {
  assertTopology,
  EVENTS_EXCHANGE,
  DLX_EXCHANGE,
  QUEUES,
  EMBEDDING_RETRY_QUEUE,
  EMBEDDING_RETRY_DELAY_MS,
} from "./topology";
