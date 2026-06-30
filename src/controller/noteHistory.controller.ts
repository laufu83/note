import type { Env } from '../types/env'
import { createPgPool } from '../config/pg'
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
export class NoteHistoryController {

  /**
   * 获取笔记所有历史版本
   * GET /api/note/:id/history
   */
  static async getNoteHistory(env: Env, uid: number, noteId: string) {
   console.log(noteId,uid);
    const pool = createPgPool(env)

    const { rows } = await pool.query(`
      SELECT id, note_id, title, content, created_at
      FROM note_history
      WHERE note_id = $1 AND user_id = $2
      ORDER BY created_at DESC
    `, [noteId, uid])

    return jsonResp(rows, CODE.SUCCESS)
  }

  /**
   * 手动新建笔记历史快照（编辑保存时自动调用）
   * POST /api/note/history
   */
  static async createHistorySnapshot(
    env: Env,
    uid: number,
    body: { note_id: number; title: string; content: string }
  ) {
   
    const pool = createPgPool(env)
    const now = new Date().toISOString()

    await pool.query(`
      INSERT INTO note_history (user_id, note_id, title, content, created_at)
      VALUES ($1,$2,$3,$4,$5)
    `, [uid, body.note_id, body.title, body.content, now])

    return jsonResp(null, CODE.SUCCESS, '已保存历史快照')
  }

  /**
 * 删除单条笔记历史版本
 * DELETE /api/note/history/:id
 */
static async deleteHistory(env: Env,  uid:number,  id: string ) {
  console.log(id,uid);
  // 校验：只能删除当前用户所属的历史记录
  const pool = createPgPool(env)
  const result = await pool.query(
    `DELETE FROM note_history WHERE id = $1 AND user_id = $2`,
    [id, uid]
  );
  if (!result) {
    return jsonResp(null, CODE.NOT_FOUND, '该历史记录不存在或无权限删除');
  }

  return jsonResp(null, CODE.SUCCESS, '删除成功');
}
}