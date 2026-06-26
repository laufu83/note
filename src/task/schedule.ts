import { createPgPool } from "../config/pg";
import { getNowISO } from "../utils/time";
import type { AppScheduleCtx } from "../types/platform";

// 通用定时任务：清理过期回收站、过期刷新token
export async function scheduleTaskHandler(ctx: AppScheduleCtx) {
  const pool = createPgPool(ctx.env);
  const now = getNowISO();
  await pool.query(`DELETE FROM notes WHERE is_delete=true AND delete_expire < $1`, [now]);
  await pool.query(`DELETE FROM user_refresh_token WHERE expired_at < $1`, [now]);
}