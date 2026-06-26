import { createPgPool } from "../config/pg";
import { getNowISO } from "../utils/time";
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
import { v4 as uuidv4 } from "uuid";
import type { Env } from "../types/env";

export const ShareController = {
  async create(
    env: Env,
    uid: number,
    body: {
      noteId: number;
      password?: string;
      permission: string;
      expireDays?: number;
    }
  ) {
    const pool = createPgPool(env);
    // 校验笔记归属
    const check = await pool.query(
      `SELECT id FROM notes WHERE id=$1 AND user_id=$2 AND is_delete=false`,
      [body.noteId, uid]
    );
    if (check.rows.length === 0)
      return jsonResp(null, CODE.FORBIDDEN, "无权分享该笔记");

    const code = uuidv4().replace(/-/g, "").slice(0, 16);
    const now = new Date();
    let expireAt: string | null = null;

    // 根据天数计算过期时间：0 = 永久有效
    if (body.expireDays && body.expireDays > 0) {
      const expireTime = new Date(now.getTime() + body.expireDays * 24 * 60 * 60 * 1000);
      expireAt = expireTime.toISOString();
    }

    try {
      await pool.query(
        `INSERT INTO note_share
          (note_id, share_code, access_password, permission, expire_at, created_at)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [
          body.noteId,
          code,
          body.password ?? null,
          body.permission,
          expireAt,
          now.toISOString(),
        ]
      );

      // 拼接公开分享地址，可配置在环境变量
      let shareUrl = `${env.APP_BASE_URL || "http://127.0.0.1:8787"}/api/share/${code}`;
      // 如果设置了访问密码，自动拼接 pwd 参数
      if (body.password?.trim()) {
        shareUrl += `?pwd=${encodeURIComponent(body.password.trim())}`;
       }
      return jsonResp({
        shareCode: code,
        shareUrl: shareUrl,
      });
    } catch {
      return jsonResp(null, CODE.FAIL, "创建分享失败");
    }
  },

  async getPublicShare(env: Env, code: string, pwd?: string | null) {
  const pool = createPgPool(env);
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    `SELECT n.title, n.content, n.updated_at, s.access_password, s.expire_at
     FROM note_share s
     JOIN notes n ON s.note_id = n.id
     WHERE s.share_code = $1`,
    [code]
  );

  if (rows.length === 0)
    return jsonResp(null, CODE.NOT_FOUND, "分享不存在或已失效");

  const item = rows[0];
  // 判断是否过期
  if (item.expire_at && new Date(item.expire_at) < new Date(now)) {
    return jsonResp(null, CODE.FAIL, "该分享已过期");
  }

  // 密码校验
  if (item.access_password) {
    if (!pwd || pwd !== item.access_password) {
      return jsonResp(null, CODE.UNAUTH, "需要访问密码");
    }
  }

  return jsonResp({
    title: item.title,
    content: item.content,
    updated_at: item.updated_at
  });
},

  async myShareList(env: Env, uid: number) {
    const pool = createPgPool(env);
    const { rows } = await pool.query(
      `SELECT s.*, n.title, n.is_delete
       FROM note_share s
       JOIN notes n ON s.note_id = n.id
       WHERE n.user_id = $1
       ORDER BY s.created_at DESC`,
      [uid]
    );
    return jsonResp(rows);
  },

  async deleteShare(env: Env, uid: number, sid: string) {
    const pool = createPgPool(env);
    const res = await pool.query(
      `DELETE FROM note_share
       WHERE id = $1
       AND note_id IN (SELECT id FROM notes WHERE user_id = $2)`,
      [sid, uid]
    );
    if (res.rowCount === 0)
      return jsonResp(null, CODE.NOT_FOUND, "分享记录不存在");

    return jsonResp(null, CODE.SUCCESS, "分享已销毁");
  },
};