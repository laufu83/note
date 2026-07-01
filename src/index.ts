import { handleOptionsCors } from "./utils/cors";
import { dispatch } from "./route/router";
import { createKnex } from "./config/knex";

import type { Env } from "./types/env";
// 从 Cloudflare Workers 导入类型
import type { ScheduledEvent } from "@cloudflare/workers-types";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return handleOptionsCors();
    return dispatch(req, env);
  },
  async scheduled(_evt: ScheduledEvent, env: Env) {
    const knex = createKnex(env);
    // 回收站笔记自动清理：删除已逻辑删除且过期时间早于当前数据库时间的数据
    await knex("notes")
      .where("is_deleted", true)
      .where("delete_expired_at", "<", knex.fn.now(6))
      .del();

    // 过期刷新令牌清理
    await knex("user_refresh_token")
      .where("expired_at", "<", knex.fn.now(6))
      .del();
  },
};