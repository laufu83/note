import { createKnex } from "../config/knex";
import type { Env } from "../types/env";

// 通用定时任务：清理过期回收站笔记、过期刷新token（适配双库+全局软删除规范）
export async function scheduleTaskHandler(env: Env) {
  const knex = createKnex(env);
  const now = knex.fn.now();

  // 1. 物理删除：回收站中已过期的笔记（仅is_deleted=1且过期的数据）
  await knex("notes")
    .where({ is_deleted: 1 })
    .where("delete_expire", "<", now)
    .delete();

  // 2. 物理删除：已过期的刷新令牌（仅未被软删除且过期）
  await knex("user_refresh_token")
    .where({ is_deleted: 0 })
    .where("activate_expire", "<", now)
    .delete();
}