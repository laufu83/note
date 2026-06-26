import { createPgPool } from "../config/pg";
import { getNowISO } from "../utils/time";
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
import type { Env } from "../types/env";

export const TagController = {
  async create(env: Env, uid: number, body: { name: string }) {
    const pool = createPgPool(env);
    const now = getNowISO();
    try {
      const res = await pool.query(
        `INSERT INTO note_tag(user_id,name,created_at) VALUES($1,$2,$3) RETURNING *`,
        [uid, body.name, now]
      );
      return jsonResp(res.rows[0]);
    } catch {
      return jsonResp(null, CODE.FAIL, "标签已存在");
    }
  },

  async list(env: Env, uid: number) {
    const pool = createPgPool(env);
    const { rows } = await pool.query(`SELECT * FROM note_tag WHERE user_id=$1`, [uid]);
    return jsonResp(rows);
  },

  async del(env: Env, uid: number, tid: string) {
    const pool = createPgPool(env);
    await pool.query(`DELETE FROM note_tag_rel WHERE tag_id=$1`, [tid]);
    const res = await pool.query(`DELETE FROM note_tag WHERE id=$1 AND user_id=$2`, [tid, uid]);
    if (res.rowCount === 0) return jsonResp(null, CODE.NOT_FOUND, "标签不存在");
    return jsonResp(null, CODE.SUCCESS, "删除成功");
  },
};