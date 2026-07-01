// src/controllers/file.controller.ts
import { createKnex } from "../config/knex";
import { createSupabase } from "../config/supabase";
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
import type { Env } from "../types/env";

export const FileController = {
  async upload(env: Env, uid: number, file: File) {
    const supabase = createSupabase(env);
    const knex = createKnex(env);
    const bucketName = env.SUPABASE_STORAGE_BUCKET;
    const filePath = `${uid}/${Date.now()}_${file.name}`;

    const { error } = await supabase.storage
      .from(bucketName)
      .upload(filePath, file, {
        contentType: file.type,
      });

    if (error) {
      console.error("【文件上传云存储失败】", { uid, filePath, err: error.message });
      return jsonResp(null, CODE.FAIL, "文件上传失败");
    }

    const { data } = supabase.storage
      .from(bucketName)
      .getPublicUrl(filePath);

    try {
      // 新增不传 created_at / updated_at，数据库默认填充，带上软删除默认值
      const insertData = {
        user_id: uid,
        storage_path: filePath,
        file_name: file.name,
        mime_type: file.type,
        size: file.size,
        is_deleted: 0
      };
      // 双库使用 returning 获取插入记录，避免按路径回查并发问题
      const [fileRecord] = await knex("user_file")
        .insert(insertData)
        .returning("*");

      return jsonResp({ ...fileRecord, url: data.publicUrl });
    } catch (err) {
      const error = err as Error;
      console.error("【文件数据库记录插入失败】", { uid, filePath, msg: error.message, stack: error.stack });
      // 上传成功但入库失败，删除云端残留文件
      await supabase.storage.from(bucketName).remove([filePath]);
      return jsonResp(null, CODE.FAIL, "文件保存记录失败");
    }
  },

  async list(env: Env, uid: number, search: URLSearchParams) {
    const knex = createKnex(env);
    // 分页参数
    const page = parseInt(search.get('page') || '1')
    const pageSize = parseInt(search.get('pageSize') || '10')
    const current = page > 0 ? page : 1
    const size = pageSize > 0 && pageSize <= 100 ? pageSize : 10
    const offset = (current - 1) * size

    // 只查询未删除文件
    const countRow = await knex("user_file")
      .where({ user_id: uid, is_deleted: 0 })
      .count("* as total")
      .first();
    const total = Number(countRow?.total ?? 0);

    const list = await knex("user_file")
      .where({ user_id: uid, is_deleted: 0 })
      .orderBy("created_at", "desc")
      .limit(size)
      .offset(offset);

    return jsonResp({
      list,
      total,
      page: current,
      pageSize: size
    });
  },

  async delete(env: Env, uid: number, path: string) {
    const supabase = createSupabase(env);
    const bucketName = env.SUPABASE_STORAGE_BUCKET;
    const knex = createKnex(env);

    // 仅查询未删除文件
    const fileRecord = await knex("user_file")
      .where({ user_id: uid, storage_path: path, is_deleted: 0 })
      .first("id");

    if (!fileRecord) return jsonResp(null, CODE.NOT_FOUND, "文件不存在");

    // 云端真实删除，数据库逻辑删除
    await supabase.storage.from(bucketName).remove([path]);
    await knex("user_file")
      .where({ user_id: uid, storage_path: path, is_deleted: 0 })
      .update({
        is_deleted: 1,
        updated_at: knex.fn.now()
      });

    return jsonResp(null, CODE.SUCCESS, "删除成功");
  },
};