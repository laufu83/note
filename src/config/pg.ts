import { Pool } from "pg";
import type { Env } from "../types/env";

export function createPgPool(env: Env) {
  return new Pool({
    //connectionString: env.DATABASE_URL,
    // 从 Hyperdrive 绑定获取连接地址
    connectionString: env.HYPER_PG.connectionString,
    max: 5,
    idleTimeoutMillis: 20000,
    ssl: true,
  });
}