import { createKnex } from "../config/knex";
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
import { v4 as uuidv4 } from "uuid";
import type { Env } from "../types/env";
import type { Knex } from "knex";

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
    const knex = createKnex(env);
    // 校验笔记归属 + 软删除过滤 is_deleted = 0
    const check = await knex("notes")
      .where({ id: body.noteId, user_id: uid, is_deleted: 0 })
      .first("id");

    if (!check)
      return jsonResp(null, CODE.FORBIDDEN, "无权分享该笔记");

    const code = uuidv4().replace(/-/g, "").slice(0, 16);
    let activateExpire: Knex.Raw | null = null;

    // 根据天数计算过期时间：0 = 永久有效
    if (body.expireDays && body.expireDays > 0) {
      // 修复：使用 MAKE_INTERVAL 安全参数化方式
      activateExpire = knex.raw(`CURRENT_TIMESTAMP(6) + MAKE_INTERVAL(days := ?)`, [body.expireDays]);
    }

    try {
      await knex("note_share").insert({
        note_id: body.noteId,
        share_code: code,
        access_password: body.password ?? null,
        permission: body.permission,
        activate_expire: activateExpire,
        is_deleted: 0
      });

      let shareUrl = `${env.APP_BASE_URL || "http://localhost:8787"}/share/${code}`;
      if (body.password?.trim()) {
        shareUrl += `?pwd=${encodeURIComponent(body.password.trim())}`;
      }

      return jsonResp({
        shareCode: code,
        shareUrl: shareUrl,
      });
    } catch (err) {
      const error = err as Error;
      console.error("【创建笔记分享失败】", { uid, noteId: body.noteId, msg: error.message });
      return jsonResp(null, CODE.FAIL, "创建分享失败");
    }
  },

  async getPublicShare(env: Env, code: string, pwd?: string | null) {
    const knex = createKnex(env);
    const rows = await knex("note_share as s")
      .join("notes as n", "s.note_id", "n.id")
      .where({
        "s.share_code": code,
        "s.is_deleted": 0,
        "n.is_deleted": 0
      })
      // 过期时间为空（永久有效） 或者 过期时间 > 当前数据库时间
      .where(function (qb) {
        qb.whereNull("s.activate_expire")
          .orWhere("s.activate_expire", ">", knex.fn.now(6));
      })
      .select("n.title", "n.content", "n.updated_at", "s.access_password", "s.activate_expire");

    if (rows.length === 0)
      return jsonResp(null, CODE.NOT_FOUND, "分享不存在或已失效");

    const item = rows[0];
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
    const knex = createKnex(env);
    const rows = await knex("note_share as s")
      .join("notes as n", "s.note_id", "n.id")
      .where({
        "n.user_id": uid,
        "s.is_deleted": 0
      })
      .orderBy("s.created_at", "desc")
      .select("s.*", "n.title");

    return jsonResp(rows);
  },

  async deleteShare(env: Env, uid: number, sid: string) {
    const knex = createKnex(env);

    // 改为逻辑删除，不再物理删除
    const rowCount = await knex("note_share")
      .whereIn("note_id", builder => {
        builder.select("id").from("notes").where({ user_id: uid, is_deleted: 0 });
      })
      .where({ id: sid, is_deleted: 0 })
      .update({
        is_deleted: 1,
        updated_at: knex.fn.now()
      });

    if (rowCount === 0)
      return jsonResp(null, CODE.NOT_FOUND, "分享记录不存在");

    return jsonResp(null, CODE.SUCCESS, "分享已销毁");
  },
};