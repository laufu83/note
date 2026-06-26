import { Redis } from "@upstash/redis/cloudflare";
import type { Env } from "../types/env";

export function createRedis(env: Env) {
  return new Redis({
    url: env.REDIS_URL,
    token: env.REDIS_TOKEN,
  });
}