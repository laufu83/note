import { createPgPool } from "../config/pg";
import { getNowISO } from "../utils/time";
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
import type { Env } from "../types/env";

export const CategoryController = {
  async create(env: Env, uid: number, body: { name: string; sort: number }) {
    const pool = createPgPool(env);
    const now = getNowISO();
    try {
      const res = await pool.query(
        `INSERT INTO note_category(user_id,name,sort,created_at,updated_at) VALUES($1,$2,$3,$4,$5) RETURNING *`,
        [uid, body.name, body.sort, now, now]
      );
      return jsonResp(res.rows[0]);
    } catch {
      return jsonResp(null, CODE.FAIL, "该分类名称已存在");
    }
  },

  async list(env: Env, uid: number) {
    const pool = createPgPool(env);
    const { rows } = await pool.query(`SELECT * FROM note_category WHERE user_id=$1 ORDER BY sort DESC`, [uid]);
    return jsonResp(rows);
  },

  async update(env: Env, uid: number, cid: string, body: { name?: string; sort?: number }) {
    const pool = createPgPool(env);
    const now = getNowISO();
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (body.name !== undefined) {
      fields.push(`name=$${idx++}`);
      params.push(body.name);
    }
    if (body.sort !== undefined) {
      fields.push(`sort=$${idx++}`);
      params.push(body.sort);
    }
    params.push(now, cid, uid);
    const sql = `UPDATE note_category SET ${fields.join(",")},updated_at=$${idx++} WHERE id=$${idx++} AND user_id=$${idx++} RETURNING *`;
    const res = await pool.query(sql, params);
    if (res.rowCount === 0) return jsonResp(null, CODE.NOT_FOUND, "分类不存在");
    return jsonResp(res.rows[0]);
  },

  async del(env: Env, uid: number, cid: string) {
    const pool = createPgPool(env);
    await pool.query(`DELETE FROM note_category_rel WHERE category_id=$1`, [cid]);
    const res = await pool.query(`DELETE FROM note_category WHERE id=$1 AND user_id=$2`, [cid, uid]);
    if (res.rowCount === 0) return jsonResp(null, CODE.NOT_FOUND, "分类不存在");
    return jsonResp(null, CODE.SUCCESS, "删除成功");
  },
};