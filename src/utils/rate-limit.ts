import { v4 as uuidv4 } from "uuid";
import { createRedis } from "../config/redis";
import { jsonResp } from "./response";
import { CODE } from "../types/response";
import type { Env } from "../types/env";

export async function rateLimitCheck(req: Request, uid: number | null, env: Env) {
  const redis = createRedis(env);
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "127.0.0.1";
  const window = parseInt(env.RATE_LIMIT_WINDOW_SEC);
  const ipMax = parseInt(env.RATE_LIMIT_IP_MAX);
  const userMax = parseInt(env.RATE_LIMIT_USER_MAX);
  const now = Date.now();
  const windowStart = now - window * 1000;

  const ipKey = `ratelimit:ip:${ip}`;
  // 全小写方法 zremrangebyscore
  await redis.zremrangebyscore(ipKey, 0, windowStart);
  const ipCount = await redis.zcard(ipKey);
  if (ipCount >= ipMax) {
    return jsonResp(null, CODE.RATE_LIMIT, "请求过于频繁，请稍后再试", 429);
  }
  await redis.zadd(ipKey, { score: now, member: `${now}-${uuidv4()}` });
  await redis.expire(ipKey, window);

  if (uid) {
    const userKey = `ratelimit:user:${uid}`;
    await redis.zremrangebyscore(userKey, 0, windowStart);
    const userCount = await redis.zcard(userKey);
    if (userCount >= userMax) {
      return jsonResp(null, CODE.RATE_LIMIT, "操作频繁，请稍后", 429);
    }
    await redis.zadd(userKey, { score: now, member: `${now}-${uuidv4()}` });
    await redis.expire(userKey, window);
  }

  return null;
}