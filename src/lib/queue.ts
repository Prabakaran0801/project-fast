import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";

// Uses Upstash Redis or local Redis. Falls back to in-memory mock if no REDIS_URL.
let connection: IORedis | undefined;

function getConnection() {
  if (connection) return connection;
  const url = process.env.REDIS_URL;
  if (!url) return undefined as unknown as IORedis;
  // Upstash uses TLS, ioredis handles rediss://
  connection = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  return connection;
}

export const QUEUE_NAMES = {
  PARSE: "parse-queue",
  DOWNLOAD: "download-queue",
  TRANSFER: "transfer-queue",
} as const;

export function getQueue(name: string) {
  const conn = getConnection();
  if (!conn) {
    // No Redis configured — queue will be no-op, API will handle synchronously
    return null;
  }
  return new Queue(name, { connection: conn });
}

export function getQueueEvents(name: string) {
  const conn = getConnection();
  if (!conn) return null;
  return new QueueEvents(name, { connection: conn });
}
