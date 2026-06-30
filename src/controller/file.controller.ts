import { createPgPool } from "../config/pg";
import { createSupabase } from "../config/supabase";
import { getNowISO } from "../utils/time";
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
import type { Env } from "../types/env";

export const FileController = {
  async upload(env: Env, uid: number, file: File) {
    const supabase = createSupabase(env);
    const pool = createPgPool(env);
    const bucketName = env.SUPABASE_STORAGE_BUCKET;
    const now = getNowISO();
    const filePath = `${uid}/${Date.now()}_${file.name}`;

    const { error } = await supabase.storage
      .from(bucketName)
      .upload(filePath, file, {
        contentType: file.type,
      });

    if (error) return jsonResp(null, CODE.FAIL, "文件上传失败");

    const { data } = supabase.storage
      .from(bucketName)
      .getPublicUrl(filePath);

    const { rows } = await pool.query(
      `INSERT INTO user_file(user_id,storage_path,file_name,mime_type,size,created_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [uid, filePath, file.name, file.type, file.size, now]
    );

    return jsonResp({ ...rows[0], url: data.publicUrl });
  },

// 后端修改
async list(env: Env, uid: number, search: URLSearchParams) {
  const pool = createPgPool(env);
// 分页参数
  const page = parseInt(search.get('page') || '1')
  const pageSize = parseInt(search.get('pageSize') || '10')
  const current = page > 0 ? page : 1
  const size = pageSize > 0 && pageSize <= 100 ? pageSize : 10
  const offset = (current - 1) * size

  // 搜索参数
 // const keyword = search.get('keyword')?.trim()
  // 获取总数
  const countResult = await pool.query(
    `SELECT COUNT(*) as total FROM user_file WHERE user_id=$1`,
    [uid]
  );
  const total = parseInt(countResult.rows[0].total);
  
  // 获取分页数据
  const { rows } = await pool.query(
    `SELECT * FROM user_file WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [uid, size, offset]
  );
  
  return jsonResp({
    list: rows,
    total: total,
    page: page,
    pageSize: pageSize
  });
},

  async delete(env: Env, uid: number, path: string) {
    const supabase = createSupabase(env);
    const bucketName = env.SUPABASE_STORAGE_BUCKET;
    const pool = createPgPool(env);

    const check = await pool.query(
      `SELECT id FROM user_file WHERE user_id=$1 AND storage_path=$2`,
      [uid, path]
    );
    if (check.rows.length === 0) return jsonResp(null, CODE.NOT_FOUND, "文件不存在");

    await supabase.storage.from(bucketName).remove([path]);
    await pool.query(
      `DELETE FROM user_file WHERE user_id=$1 AND storage_path=$2`,
      [uid, path]
    );

    return jsonResp(null, CODE.SUCCESS, "删除成功");
  },
};