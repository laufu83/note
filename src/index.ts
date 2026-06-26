import { handleOptionsCors } from "./utils/cors";
import { dispatch } from "./route/router";
import { createPgPool } from "./config/pg";
import { getNowISO } from "./utils/time";
import type { Env } from "./types/env";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return handleOptionsCors();
    return dispatch(req, env);
  },

  async scheduled(_evt: ScheduledEvent, env: Env) {
    const pool = createPgPool(env);
    const now = getNowISO();
    await pool.query(`DELETE FROM notes WHERE is_delete=true AND delete_expire < $1`, [now]);
    await pool.query(`DELETE FROM user_refresh_token WHERE expired_at < $1`, [now]);
  },
};