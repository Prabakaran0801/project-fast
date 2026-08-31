import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let ratelimit: Ratelimit | null = null;

function getRatelimit() {
  if (ratelimit) return ratelimit;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const redis = new Redis({ url, token });
  ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "1 m"),
    prefix: "speed-dl",
  });
  return ratelimit;
}

export async function checkRateLimit(identifier: string) {
  const rl = getRatelimit();
  if (!rl) return { success: true, remaining: 999 };
  const result = await rl.limit(identifier);
  return result;
}
