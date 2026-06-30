// src/controllers/note.controller.ts

import { createPgPool } from "../config/pg";
import { getNowISO } from "../utils/time";
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
import type { Env } from "../types/env";
import { noteEncryptService } from "../utils/note-encrypt";

// 扩展请求体类型，支持加密相关字段
type NoteCreateBody = {
  title: string;
  content?: string;
  categoryIds?: number[];
  tagNames?: string[];
  is_draft?: boolean;
  is_top?: boolean;
  is_star?: boolean;
  is_encrypted?: boolean;
  note_password?: string;
};

type NoteUpdateBody = {
  title?: string;
  content?: string;
  is_draft?: boolean;
  is_top?: boolean;
  is_star?: boolean;
  categoryIds?: number[];
  tagNames?: string[];
  is_encrypted?: boolean;
  note_password?: string;    // 旧密码（修改加密笔记时必传）
  new_password?: string;     // 新密码（修改密码时使用）
};

export const NoteController = {
  /**
   * 创建笔记：仅正文加密，标题、分类、标签明文存储
   */
  async create(env: Env, uid: number, body: NoteCreateBody) {
    const pool = createPgPool(env);
    const now = getNowISO();
    const { title, content, categoryIds, tagNames, is_draft, is_top, is_star, is_encrypted, note_password } = body;

    // 加密参数校验
    if (is_encrypted) {
      if (!note_password) {
        return jsonResp(null, CODE.PARAM_ERR, '开启笔记加密必须设置访问密码');
      }
      const pwdCheck = noteEncryptService.validatePassword(note_password);
      if (!pwdCheck.isValid) {
        return jsonResp(null, CODE.PARAM_ERR, pwdCheck.message);
      }
      if (!title || !content) {
        return jsonResp(null, CODE.PARAM_ERR, '标题、内容不能为空');
      }
    }

    let saveTitle: string = title;
    let saveContent: string | null = content ?? null;
    let salt: string | null = null;
    let iv: string | null = null;
    let passwordHash: string | null = null;

    // 🔐 仅加密正文，标题、分类、标签明文
    if (is_encrypted) {
      // ⭐ 使用 encryptWithNewSalt 一步完成加密和哈希
      const result = await noteEncryptService.encryptWithNewSalt(content!, note_password!);
      saveContent = result.cipherText;
      salt = result.salt;
      iv = result.iv;
      passwordHash = result.hash;
    }

    // 插入主表
    const { rows } = await pool.query(
      `INSERT INTO notes(
        user_id, title, content, is_draft, is_top, is_star, is_encrypted,
        salt, iv, password_hash, created_at, updated_at, version, is_delete
      ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, false) RETURNING id`,
      [uid, saveTitle, saveContent, is_draft ?? false, is_top ?? false, is_star ?? false, 
       !!is_encrypted, salt, iv, passwordHash, now, now]
    );
    const noteId = rows[0].id;

    // 保存历史版本
    await pool.query(
      `INSERT INTO note_history(note_id, user_id, title, content, created_at) VALUES($1, $2, $3, $4, $5)`,
      [noteId, uid, saveTitle, saveContent, now]
    );

    // 绑定分类
    if (categoryIds && categoryIds.length) {
      for (const cid of categoryIds) {
        await pool.query(
          `INSERT INTO note_category_rel(note_id, category_id) VALUES($1, $2) ON CONFLICT DO NOTHING`,
          [noteId, cid]
        );
      }
    }

    // 绑定标签
    if (tagNames && tagNames.length) {
      for (const name of tagNames) {
        let tagRes = await pool.query(
          `SELECT id FROM note_tag WHERE user_id = $1 AND name = $2`,
          [uid, name]
        );
        let tid: number;
        if (tagRes.rows.length === 0) {
          tagRes = await pool.query(
            `INSERT INTO note_tag(user_id, name, created_at) VALUES($1, $2, $3) RETURNING id`,
            [uid, name, now]
          );
        }
        tid = tagRes.rows[0].id;
        await pool.query(
          `INSERT INTO note_tag_rel(note_id, tag_id) VALUES($1, $2) ON CONFLICT DO NOTHING`,
          [noteId, tid]
        );
      }
    }

    const detail = await pool.query(`SELECT * FROM notes WHERE id = $1`, [noteId]);
    const result = detail.rows[0];
    
    // 加密笔记隐藏正文
    if (result.is_encrypted) {
      result.content = null;
    }
    
    return jsonResp(result);
  },

  /**
   * 笔记列表：加密笔记只隐藏 content，标题、分类、标签正常返回
   */
  async list(env: Env, uid: number, search: URLSearchParams) {
    const page = parseInt(search.get("page") || "1");
    const size = parseInt(search.get("size") || "20");
    const keyword = search.get("q");
    const isDraft = search.get("is_draft");
    const isStar = search.get("is_star");
    const isTop = search.get("is_top");
    const isDelete = search.get("trash") === "1" || search.get("is_delete") === "true";
    const offset = (page - 1) * size;

    let sql = `
      SELECT 
        n.id,
        n.title,
        n.is_top,
        n.is_draft,
        n.is_star,
        n.is_delete,
        n.is_encrypted,
        n.created_at,
        n.updated_at,
        COUNT(*) OVER() total,
        COALESCE(c.category_ids, '[]'::json) AS "categoryIds",
        COALESCE(c.category_names, '[]'::json) AS "categoryNames",
        COALESCE(t.tag_names, '[]'::json) AS "tagNames"
      FROM notes n
      LEFT JOIN (
        SELECT ncr.note_id, json_agg(ncr.category_id) category_ids, json_agg(nc.name) category_names
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
      WHERE n.user_id = $1 AND n.is_delete = $2
    `;

    const params: any[] = [uid, isDelete];
    let idx = 3;

    // 加密笔记禁止全文检索正文，仅标题模糊匹配
    if (keyword) {
      sql += ` AND (n.is_encrypted = false AND n.note_tsv @@ to_tsquery('simple', $${idx}) OR n.is_encrypted = true AND n.title ILIKE $${idx + 1})`;
      params.push(keyword.replace(/\s+/g, " & "), `%${keyword}%`);
      idx += 2;
    }
    
    if (isDraft !== null) {
      sql += ` AND n.is_draft = $${idx++}`;
      params.push(isDraft === "true");
    }
    if (isStar !== null) {
      sql += ` AND n.is_star = $${idx++}`;
      params.push(isStar === "true");
    }
    if (isTop !== null) {
      sql += ` AND n.is_top = $${idx++}`;
      params.push(isTop === "true");
    }

    sql += ` ORDER BY n.is_top DESC, n.updated_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(size, offset);

    const pool = createPgPool(env);
    const { rows } = await pool.query(sql, params);
    const total = rows.length ? Number(rows[0].total) : 0;

    // 加密笔记仅清空正文，分类标签正常返回
    const list = rows.map(row => {
      delete row.total;
      row.tags = row.tagNames;
      if (row.is_encrypted) {
        row.content = null;
      }
      return row;
    });

    return jsonResp({ list, total });
  },

  /**
   * 笔记详情：
   * 未加密：返回完整明文、分类标签
   * 已加密：不传密码返回标题+分类+标签，content=null；传密码解密正文返回完整内容
   */
  async detail(env: Env, uid: number, nid: string, search?: URLSearchParams) {
    const pool = createPgPool(env);
    const query = search || new URLSearchParams();
    const decryptPwd = query.get('password');
    
    const noteRes = await pool.query(
      `SELECT * FROM notes WHERE id = $1 AND user_id = $2 AND is_delete = false`,
      [nid, uid]
    );
    
    if (noteRes.rows.length === 0) {
      return jsonResp(null, CODE.NOT_FOUND, "笔记不存在");
    }
    const note = noteRes.rows[0];

    // 查询分类标签
    const cateRes = await pool.query(
      `SELECT category_id FROM note_category_rel WHERE note_id = $1`,
      [nid]
    );
    note.categoryIds = cateRes.rows.map(item => item.category_id);
    
    const tagRes = await pool.query(
      `SELECT nt.name FROM note_tag_rel ntr 
       LEFT JOIN note_tag nt ON ntr.tag_id = nt.id 
       WHERE ntr.note_id = $1 AND nt.user_id = $2`,
      [nid, uid]
    );
    note.tagNames = tagRes.rows.map(item => item.name);

    // 未加密直接返回全部
    if (!note.is_encrypted) {
      return jsonResp(note);
    }

    // 加密笔记未传密码：返回标题、分类、标签，正文置空
    if (!decryptPwd) {
      return jsonResp({
        id: note.id,
        title: note.title,
        categoryIds: note.categoryIds,
        tagNames: note.tagNames,
        content: null,
        is_encrypted: true,
        is_top: note.is_top,
        is_star: note.is_star,
        is_draft: note.is_draft,
        is_delete: note.is_delete,
        created_at: note.created_at,
        updated_at: note.updated_at,
        version: note.version
      }, CODE.SUCCESS, '需要传入访问密码解密查看正文内容');
    }

    // ⭐ 验证密码哈希
    const isValid = await noteEncryptService.verifyPassword(
      decryptPwd,
      note.salt,          // ⭐ 注意：使用 note.salt，不是 password_hash
      note.password_hash
    );
    
    if (!isValid) {
      return jsonResp(null, CODE.UNAUTH, '密码错误');
    }

    // 解密正文
    try {
      const plainContent = await noteEncryptService.decrypt(
        note.content, 
        decryptPwd, 
        note.salt, 
        note.iv
      );
      
      return jsonResp({
        id: note.id,
        title: note.title,
        content: plainContent,
        categoryIds: note.categoryIds,
        tagNames: note.tagNames,
        is_encrypted: true,
        is_top: note.is_top,
        is_star: note.is_star,
        is_draft: note.is_draft,
        is_delete: note.is_delete,
        created_at: note.created_at,
        updated_at: note.updated_at,
        version: note.version
      });
    } catch (error) {
      return jsonResp(null, CODE.UNAUTH, '解密失败，数据可能已损坏');
    }
  },

  /**
   * 更新笔记：仅正文加密，标题、分类、标签始终明文
   */
  async update(env: Env, uid: number, nid: string, body: NoteUpdateBody) {
    const pool = createPgPool(env);
    const now = getNowISO();
    const client = await pool.connect();
    
    try {
      await client.query("BEGIN");

      // 查询原笔记数据（包含 password_hash）
      const check = await client.query(
        `SELECT id, title, content, is_encrypted, salt, iv, password_hash 
         FROM notes WHERE id = $1 AND user_id = $2 AND is_delete = false`,
        [nid, uid]
      );
      
      if (check.rows.length === 0) {
        throw new Error("笔记不存在");
      }
      const origin = check.rows[0];

      // 保存历史版本
      await client.query(
        `INSERT INTO note_history(note_id, user_id, title, content, created_at) VALUES($1, $2, $3, $4, $5)`,
        [nid, uid, origin.title, origin.content, now]
      );

      const { title, content, categoryIds, tagNames, is_encrypted, note_password, new_password } = body;
      let saveTitle: string = title ?? origin.title;
      let saveContent: string = origin.content;
      let newSalt: string | null = origin.salt;
      let newIv: string | null = origin.iv;
      let newPasswordHash: string | null = origin.password_hash;

      // 🔐 原笔记已加密
      if (origin.is_encrypted) {
        if (!note_password) {
          throw new Error('修改加密笔记必须传入原访问密码');
        }
        
        // ⭐ 验证旧密码
        const isValid = await noteEncryptService.verifyPassword(
          note_password,
          origin.salt,
          origin.password_hash
        );
        
        if (!isValid) {
          throw new Error('原访问密码错误');
        }

        // 子场景1：继续加密
        if (is_encrypted) {
          const usePwd = new_password || note_password;
          
          // 如果修改了密码，使用 changePassword 方法
          if (new_password) {
            // ⭐ 使用 changePassword 一步完成
            const result = await noteEncryptService.changePassword(
              content!,
              new_password,
              origin.salt
            );
            saveContent = result.cipherText;
            newSalt = result.salt;
            newIv = result.iv;
            newPasswordHash = result.hash;
          } else {
            // 密码不变，只修改内容
            // ⭐ 使用 encryptWithExistingSalt 复用盐
            const result = await noteEncryptService.encryptWithExistingSalt(
              content!,
              note_password,
              origin.salt
            );
            saveContent = result.cipherText;
            newSalt = result.salt;
            newIv = result.iv;
            // password_hash 不变
          }
        } else {
          // 子场景2：关闭加密
          const plainText = await noteEncryptService.decrypt(
            origin.content, 
            note_password, 
            origin.salt, 
            origin.iv
          );
          saveContent = content ?? plainText;
          newSalt = null;
          newIv = null;
          newPasswordHash = null;
        }
      } else {
        // 📝 原笔记明文
        if (!is_encrypted) {
          // 保持明文
          saveContent = content ?? origin.content;
          newSalt = null;
          newIv = null;
          newPasswordHash = null;
        } else {
          // 明文开启加密
          if (!note_password) {
            throw new Error('开启加密必须设置访问密码');
          }
          
          const checkPwd = noteEncryptService.validatePassword(note_password);
          if (!checkPwd.isValid) {
            throw new Error(checkPwd.message);
          }
          
          // ⭐ 使用 encryptWithNewSalt 一步完成
          const result = await noteEncryptService.encryptWithNewSalt(
            content!,
            note_password
          );
          saveContent = result.cipherText;
          newSalt = result.salt;
          newIv = result.iv;
          newPasswordHash = result.hash;
        }
      }

      // 构建更新字段
      const fields: string[] = [];
      const params: any[] = [];
      let idx = 1;

      fields.push(`title = $${idx++}`);
      params.push(saveTitle);
      
      fields.push(`content = $${idx++}`);
      params.push(saveContent);
      
      fields.push(`salt = $${idx++}`);
      params.push(newSalt);
      
      fields.push(`iv = $${idx++}`);
      params.push(newIv);
      
      fields.push(`password_hash = $${idx++}`);
      params.push(newPasswordHash);
      
      fields.push(`is_encrypted = $${idx++}`);
      params.push(!!is_encrypted);
      
      fields.push(`updated_at = $${idx++}`);
      params.push(now);

      // 可选字段
      if (body.is_top !== undefined) {
        fields.push(`is_top = $${idx++}`);
        params.push(body.is_top);
      }
      if (body.is_star !== undefined) {
        fields.push(`is_star = $${idx++}`);
        params.push(body.is_star);
      }
      if (body.is_draft !== undefined) {
        fields.push(`is_draft = $${idx++}`);
        params.push(body.is_draft);
      }

      fields.push(`version = version + 1`);

      params.push(nid, uid);
      const updateSql = `UPDATE notes SET ${fields.join(", ")} 
                         WHERE id = $${idx++} AND user_id = $${idx++} 
                         RETURNING *`;
      const res = await client.query(updateSql, params);

      // 更新分类
      if (categoryIds !== undefined) {
        await client.query(`DELETE FROM note_category_rel WHERE note_id = $1`, [nid]);
        for (const cid of categoryIds) {
          await client.query(
            `INSERT INTO note_category_rel(note_id, category_id) VALUES($1, $2) ON CONFLICT DO NOTHING`,
            [nid, cid]
          );
        }
      }

      // 更新标签
      if (tagNames !== undefined) {
        await client.query(`DELETE FROM note_tag_rel WHERE note_id = $1`, [nid]);
        for (const name of tagNames) {
          let tagRes = await client.query(
            `SELECT id FROM note_tag WHERE user_id = $1 AND name = $2`,
            [uid, name]
          );
          let tid: number;
          if (tagRes.rows.length === 0) {
            tagRes = await client.query(
              `INSERT INTO note_tag(user_id, name, created_at) VALUES($1, $2, $3) RETURNING id`,
              [uid, name, now]
            );
          }
          tid = tagRes.rows[0].id;
          await client.query(
            `INSERT INTO note_tag_rel(note_id, tag_id) VALUES($1, $2) ON CONFLICT DO NOTHING`,
            [nid, tid]
          );
        }
      }

      await client.query("COMMIT");
      
      const result = res.rows[0];
      // 加密笔记隐藏正文
      if (result.is_encrypted) {
        result.content = null;
      }
      
      return jsonResp(result);
    } catch (err) {
      await client.query("ROLLBACK");
      return jsonResp(null, CODE.FAIL, (err as Error).message);
    } finally {
      client.release();
    }
  },

  /**
   * 移入回收站：加密笔记移入不需要密码，仅软删除
   */
  async moveRecycle(env: Env, uid: number, nid: string) {
    const pool = createPgPool(env);
    const expire = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const now = getNowISO();
    const res = await pool.query(
      `UPDATE notes SET is_delete = true, delete_expire = $1, updated_at = $2 
       WHERE id = $3 AND user_id = $4 RETURNING *`,
      [expire, now, nid, uid]
    );
    if (res.rowCount === 0) {
      return jsonResp(null, CODE.NOT_FOUND, "笔记不存在");
    }
    return jsonResp(null, CODE.SUCCESS, "已移入回收站");
  },

  async restore(env: Env, uid: number, nid: string) {
    const pool = createPgPool(env);
    const now = getNowISO();
    const res = await pool.query(
      `UPDATE notes SET is_delete = false, delete_expire = null, updated_at = $1 
       WHERE id = $2 AND user_id = $3 RETURNING *`,
      [now, nid, uid]
    );
    if (res.rowCount === 0) {
      return jsonResp(null, CODE.NOT_FOUND, "笔记不存在");
    }
    return jsonResp(null, CODE.SUCCESS, "恢复成功");
  },

  async permanentDelete(env: Env, uid: number, nid: string) {
    const pool = createPgPool(env);
    await pool.query(`DELETE FROM note_category_rel WHERE note_id = $1`, [nid]);
    await pool.query(`DELETE FROM note_tag_rel WHERE note_id = $1`, [nid]);
    await pool.query(`DELETE FROM note_history WHERE note_id = $1`, [nid]);
    await pool.query(`DELETE FROM note_share WHERE note_id = $1`, [nid]);
    const res = await pool.query(
      `DELETE FROM notes WHERE id = $1 AND user_id = $2`,
      [nid, uid]
    );
    if (res.rowCount === 0) {
      return jsonResp(null, CODE.NOT_FOUND, "笔记不存在");
    }
    return jsonResp(null, CODE.SUCCESS, "永久删除成功");
  },

  async rollback(env: Env, uid: number, nid: string, hid: number) {
    const pool = createPgPool(env);
    const now = getNowISO();
    
    const noteCheck = await pool.query(
      `SELECT id FROM notes WHERE id = $1 AND user_id = $2`,
      [nid, uid]
    );
    if (noteCheck.rows.length === 0) {
      return jsonResp(null, CODE.FORBIDDEN, "无权限操作");
    }
    
    const historyRes = await pool.query(
      `SELECT title, content FROM note_history WHERE id = $1 AND note_id = $2`,
      [hid, nid]
    );
    if (historyRes.rows.length === 0) {
      return jsonResp(null, CODE.NOT_FOUND, "版本不存在");
    }
    
    const old = historyRes.rows[0];
    await pool.query(
      `INSERT INTO note_history(note_id, user_id, title, content, created_at) 
       VALUES($1, $2, (SELECT title FROM notes WHERE id = $1), (SELECT content FROM notes WHERE id = $1), $3)`,
      [nid, uid, now]
    );
    await pool.query(
      `UPDATE notes SET title = $1, content = $2, updated_at = $3 WHERE id = $4`,
      [old.title, old.content, now, nid]
    );
    
    return jsonResp(null, CODE.SUCCESS, "版本回滚成功");
  },

  async clearTrash(env: Env, uid: number) {
    const pool = createPgPool(env);
    try {
      await pool.query("BEGIN");
      
      const noteRes = await pool.query(
        `SELECT id FROM notes WHERE user_id = $1 AND is_delete = true`,
        [uid]
      );
      const noteIds = noteRes.rows.map(item => item.id);
      
      if (noteIds.length === 0) {
        await pool.query("ROLLBACK");
        return jsonResp(null, CODE.PARAM_ERR, "回收站暂无数据可清空");
      }
      
      await pool.query(`DELETE FROM note_category_rel WHERE note_id = ANY($1::bigint[])`, [noteIds]);
      await pool.query(`DELETE FROM note_tag_rel WHERE note_id = ANY($1::bigint[])`, [noteIds]);
      await pool.query(`DELETE FROM notes WHERE user_id = $1 AND is_delete = true`, [uid]);
      
      await pool.query("COMMIT");
      return jsonResp(null, CODE.SUCCESS, "回收站清空成功");
    } catch (err) {
      await pool.query("ROLLBACK");
      return jsonResp(null, CODE.FAIL, "清空回收站失败，请稍后重试");
    }
  },

  /**
   * 导出：加密笔记仅隐藏正文，分类标签正常返回
   */
  async exportAllNote(env: Env, uid: number, search: URLSearchParams) {
    const page = parseInt(search.get("page") || "1");
    const size = parseInt(search.get("size") || "0");
    const keyword = search.get("q")?.trim();
    const isDraftStr = search.get("is_draft");
    const isStarStr = search.get("is_star");
    const isDelete = search.get("trash") === "1" || search.get("is_delete") === "true";
    const offset = size > 0 ? (page - 1) * size : 0;

    const pool = createPgPool(env);
    let sql = `
      SELECT 
        n.id,
        n.title,
        n.content,
        n.is_top,
        n.is_draft,
        n.is_star,
        n.is_delete,
        n.is_encrypted,
        n.created_at,
        n.updated_at,
        COALESCE(c.category_ids, '[]'::json) AS "categoryIds",
        COALESCE(c.category_names, '[]'::json) AS "categoryNames",
        COALESCE(t.tag_names, '[]'::json) AS "tagNames"
      FROM notes n
      LEFT JOIN (
        SELECT ncr.note_id, json_agg(ncr.category_id) category_ids, json_agg(nc.name) category_names
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
      WHERE n.user_id = $1 AND n.is_delete = $2
    `;

    const params: any[] = [uid, isDelete];
    let idx = 3;
    
    if (keyword) {
      sql += ` AND (n.is_encrypted = false AND n.note_tsv @@ to_tsquery('simple', $${idx}) OR n.is_encrypted = true AND n.title ILIKE $${idx + 1})`;
      params.push(keyword.replace(/\s+/g, " & "), `%${keyword}%`);
      idx += 2;
    }
    
    if (isDraftStr !== null) {
      sql += ` AND n.is_draft = $${idx++}`;
      params.push(isDraftStr === "true");
    }
    if (isStarStr !== null) {
      sql += ` AND n.is_star = $${idx++}`;
      params.push(isStarStr === "true");
    }
    
    sql += ` ORDER BY n.is_top DESC, n.updated_at DESC`;
    if (size > 0) {
      sql += ` LIMIT $${idx++} OFFSET $${idx++}`;
      params.push(size, offset);
    }

    const { rows } = await pool.query(sql, params);
    
    // 加密笔记只清空正文
    const result = rows.map(row => {
      if (row.is_encrypted) {
        row.content = null;
      }
      return row;
    });
    
    return jsonResp(result, CODE.SUCCESS, "查询成功");
  }
};