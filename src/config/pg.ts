import { Pool } from "@neondatabase/serverless";
import type { Env } from "../types/env";

export function createPgPool(env: Env) {
  return new Pool({
    connectionString: env.DATABASE_URL,
  });
}