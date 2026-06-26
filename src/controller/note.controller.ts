import { createPgPool } from "../config/pg";
import { getNowISO } from "../utils/time";
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
import type { Env } from "../types/env";

export const NoteController = {
  async create(
    env: Env,
    uid: number,
    body: {
      title: string;
      content?: string;
      categoryIds?: number[];
      tagNames?: string[];
      isDraft?: boolean;
      isTop?: boolean;
      isStar?: boolean;
    }
  ) {
    const pool = createPgPool(env);
    const now = getNowISO();
    const { rows } = await pool.query(
      `INSERT INTO notes(user_id,title,content,is_draft,is_top,is_star,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [uid, body.title, body.content ?? null, body.isDraft ?? false, body.isTop ?? false, body.isStar ?? false, now, now]
    );
    const noteId = rows[0].id;
    await pool.query(`INSERT INTO note_history(note_id,title,content,created_at) VALUES($1,$2,$3,$4)`, [noteId, body.title, body.content, now]);
    if (body.categoryIds && body.categoryIds.length) {
      for (const cid of body.categoryIds) {
        await pool.query(`INSERT INTO note_category_rel(note_id,category_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [noteId, cid]);
      }
    }
    if (body.tagNames && body.tagNames.length) {
      for (const name of body.tagNames) {
        let tagRes = await pool.query(`SELECT id FROM note_tag WHERE user_id=$1 AND name=$2`, [uid, name]);
        let tid: number;
        if (tagRes.rows.length === 0) {
          tagRes = await pool.query(`INSERT INTO note_tag(user_id,name,created_at) VALUES($1,$2,$3) RETURNING id`, [uid, name, now]);
        }
        tid = tagRes.rows[0].id;
        await pool.query(`INSERT INTO note_tag_rel(note_id,tag_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [noteId, tid]);
      }
    }
    const detail = await pool.query(`SELECT * FROM notes WHERE id=$1`, [noteId]);
    return jsonResp(detail.rows[0]);
  },
async list(env: Env, uid: number, search: URLSearchParams) {
  const page = parseInt(search.get("page") || "1");
  const size = parseInt(search.get("size") || "20");
  const keyword = search.get("q");
  const isDraft = search.get("draft");
  const isStar = search.get("star");
  const isDelete = search.get("trash") === "1";
  const offset = (page - 1) * size;

  let sql = `
    SELECT 
      n.*,
      COUNT(*) OVER() total,
      COALESCE(c.category_ids, '[]'::json) AS "categoryIds",
      COALESCE(c.category_names, '[]'::json) AS "categoryNames",
      COALESCE(t.tag_names, '[]'::json) AS "tagNames"
    FROM notes n
    LEFT JOIN (
      SELECT 
        ncr.note_id,
        json_agg(ncr.category_id) AS category_ids,
        json_agg(nc.name) AS category_names
      FROM note_category_rel ncr
      LEFT JOIN note_category nc ON ncr.category_id = nc.id
      GROUP BY ncr.note_id
    ) c ON n.id = c.note_id
    LEFT JOIN (
      SELECT ntr.note_id, json_agg(nt.name) tag_names
      FROM note_tag_rel ntr
      LEFT JOIN note_tag nt ON ntr.tag_id = nt.id
      GROUP BY ntr.note_id
    ) t ON n.id = t.note_id
    WHERE n.user_id=$1 AND n.is_delete=$2
  `;

  const params: any[] = [uid, isDelete];
  let idx = 3;

  if (keyword) {
    sql += ` AND n.note_tsv @@ to_tsquery('simple',$${idx++})`;
    params.push(keyword.replace(/\s+/g, " & "));
  }
  if (isDraft !== null) {
    sql += ` AND n.is_draft=$${idx++}`;
    params.push(isDraft === "1");
  }
  if (isStar !== null) {
    sql += ` AND n.is_star=$${idx++}`;
    params.push(isStar === "1");
  }

  sql += ` ORDER BY n.is_top DESC, n.updated_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(size, offset);

  const pool = createPgPool(env);
  const { rows } = await pool.query(sql, params);
  const total = rows.length ? Number(rows[0].total) : 0;

  const list = rows.map(row => {
    delete row.total;
    row.tags = row.tagNames;
    return row;
  });

  return jsonResp({ list, total });
},
  async detail(env: Env, uid: number, nid: string) {
  const pool = createPgPool(env);
  // 查询笔记基础信息
  const noteRes = await pool.query(
    `SELECT * FROM notes WHERE id=$1 AND user_id=$2 AND is_delete=false`,
    [nid, uid]
  );
  if (noteRes.rows.length === 0) return jsonResp(null, CODE.NOT_FOUND, "笔记不存在");
  const note = noteRes.rows[0];

  // 查询该笔记绑定的所有分类ID
  const cateRes = await pool.query(
    `SELECT category_id FROM note_category_rel WHERE note_id=$1`,
    [nid]
  );
  note.categoryIds = cateRes.rows.map(item => item.category_id);

  // 查询该笔记绑定的所有标签名称
  const tagRes = await pool.query(
    `SELECT nt.name FROM note_tag_rel ntr
     LEFT JOIN note_tag nt ON ntr.tag_id = nt.id
     WHERE ntr.note_id=$1 AND nt.user_id=$2`,
    [nid, uid]
  );
  note.tagNames = tagRes.rows.map(item => item.name);

  return jsonResp(note);
},

  async update(
  env: Env,
  uid: number,
  nid: string,
  body: {
    title?: string;
    content?: string;
    isDraft?: boolean;
    isTop?: boolean;
    isStar?: boolean;
    categoryIds?: number[];
    tagNames?: string[];
  }
) {
  const pool = createPgPool(env);
  const now = getNowISO();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const check = await client.query(
      `SELECT id,title,content FROM notes WHERE id=$1 AND user_id=$2 AND is_delete=false`,
      [nid, uid]
    );
    if (check.rows.length === 0) {
      throw new Error("笔记不存在");
    }

    // 保存历史版本
    await client.query(
      `INSERT INTO note_history(note_id,title,content,created_at) VALUES($1,$2,$3,$4)`,
      [nid, check.rows[0].title, check.rows[0].content, now]
    );

    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (body.title !== undefined) {
      fields.push(`title=$${idx++}`);
      params.push(body.title);
    }
    if (body.content !== undefined) {
      fields.push(`content=$${idx++}`);
      params.push(body.content);
    }
    if (body.isDraft !== undefined) {
      fields.push(`is_draft=$${idx++}`);
      params.push(body.isDraft);
    }
    if (body.isTop !== undefined) {
      fields.push(`is_top=$${idx++}`);
      params.push(body.isTop);
    }
    if (body.isStar !== undefined) {
      fields.push(`is_star=$${idx++}`);
      params.push(body.isStar);
    }
    params.push(now, nid, uid);
    const sql = `UPDATE notes SET ${fields.join(",")},updated_at=$${idx++} WHERE id=$${idx++} AND user_id=$${idx++} RETURNING *`;
    const res = await client.query(sql, params);

    // 仅前端传了才更新分类关联
    if (body.categoryIds !== undefined) {
      await client.query(`DELETE FROM note_category_rel WHERE note_id=$1`, [nid]);
      for (const cid of body.categoryIds) {
        await client.query(
          `INSERT INTO note_category_rel(note_id,category_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
          [nid, cid]
        );
      }
    }

    // 仅前端传了才更新标签关联
    if (body.tagNames !== undefined) {
      await client.query(`DELETE FROM note_tag_rel WHERE note_id=$1`, [nid]);
      for (const name of body.tagNames) {
        let tagRes = await client.query(`SELECT id FROM note_tag WHERE user_id=$1 AND name=$2`, [uid, name]);
        let tid: number;
        if (tagRes.rows.length === 0) {
          tagRes = await client.query(
            `INSERT INTO note_tag(user_id,name,created_at) VALUES($1,$2,$3) RETURNING id`,
            [uid, name, now]
          );
        }
        tid = tagRes.rows[0].id;
        await client.query(
          `INSERT INTO note_tag_rel(note_id,tag_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
          [nid, tid]
        );
      }
    }

    await client.query("COMMIT");
    return jsonResp(res.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
},

  async moveRecycle(env: Env, uid: number, nid: string) {
    const pool = createPgPool(env);
    const expire = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const now = getNowISO();
    const res = await pool.query(
      `UPDATE notes SET is_delete=true,delete_expire=$1,updated_at=$2 WHERE id=$3 AND user_id=$4 RETURNING *`,
      [expire, now, nid, uid]
    );
    if (res.rowCount === 0) return jsonResp(null, CODE.NOT_FOUND);
    return jsonResp(null, CODE.SUCCESS, "已移入回收站");
  },

  async restore(env: Env, uid: number, nid: string) {
    const pool = createPgPool(env);
    const now = getNowISO();
    const res = await pool.query(
      `UPDATE notes SET is_delete=false,delete_expire=null,updated_at=$1 WHERE id=$2 AND user_id=$3 RETURNING *`,
      [now, nid, uid]
    );
    if (res.rowCount === 0) return jsonResp(null, CODE.NOT_FOUND);
    return jsonResp(null, CODE.SUCCESS, "恢复成功");
  },

  async permanentDelete(env: Env, uid: number, nid: string) {
    const pool = createPgPool(env);
    await pool.query(`DELETE FROM note_category_rel WHERE note_id=$1`, [nid]);
    await pool.query(`DELETE FROM note_tag_rel WHERE note_id=$1`, [nid]);
    await pool.query(`DELETE FROM note_history WHERE note_id=$1`, [nid]);
    await pool.query(`DELETE FROM note_share WHERE note_id=$1`, [nid]);
    const res = await pool.query(`DELETE FROM notes WHERE id=$1 AND user_id=$2`, [nid, uid]);
    if (res.rowCount === 0) return jsonResp(null, CODE.NOT_FOUND);
    return jsonResp(null, CODE.SUCCESS, "永久删除成功");
  },

  async getHistory(env: Env, uid: number, nid: string) {
    const pool = createPgPool(env);
    const check = await pool.query(`SELECT id FROM notes WHERE id=$1 AND user_id=$2`, [nid, uid]);
    if (check.rows.length === 0) return jsonResp(null, CODE.FORBIDDEN);
    const { rows } = await pool.query(`SELECT * FROM note_history WHERE note_id=$1 ORDER BY created_at DESC`, [nid]);
    return jsonResp(rows);
  },

  async rollback(env: Env, uid: number, nid: string, hid: number) {
    const pool = createPgPool(env);
    const now = getNowISO();
    const noteCheck = await pool.query(`SELECT id FROM notes WHERE id=$1 AND user_id=$2`, [nid, uid]);
    if (noteCheck.rows.length === 0) return jsonResp(null, CODE.FORBIDDEN);
    const historyRes = await pool.query(`SELECT title,content FROM note_history WHERE id=$1 AND note_id=$2`, [hid, nid]);
    if (historyRes.rows.length === 0) return jsonResp(null, CODE.NOT_FOUND, "版本不存在");
    const old = historyRes.rows[0];
    await pool.query(`INSERT INTO note_history(note_id,title,content,created_at) VALUES($1,(SELECT title FROM notes WHERE id=$1),(SELECT content FROM notes WHERE id=$1),$2)`, [nid, now]);
    await pool.query(`UPDATE notes SET title=$1,content=$2,updated_at=$3 WHERE id=$4`, [old.title, old.content, now, nid]);
    return jsonResp(null, CODE.SUCCESS, "版本回滚成功");
  },
};