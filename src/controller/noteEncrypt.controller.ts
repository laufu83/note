import type { Env } from '../types/env';
import { createPgPool } from '../config/pg';
import { jsonResp } from '../utils/response';
import { CODE } from '../types/response';
import type { Pool } from 'pg';

// ===== 加密工具类 Web Crypto AES-GCM PBKDF2 =====
class EncryptionService {
  /**
   * 密码派生AES密钥
   */
  private async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt.buffer as ArrayBuffer, // 修复：正确转换为 ArrayBuffer
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  generateSaltBytes(): Uint8Array {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return arr;
  }

  saltToBase64(salt: Uint8Array): string {
    return btoa(String.fromCharCode(...salt));
  }

  base64ToSalt(base64: string): Uint8Array {
    return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  }

  generateIV(): Uint8Array {
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    return iv;
  }

  ivToBase64(iv: Uint8Array): string {
    return btoa(String.fromCharCode(...iv));
  }

  base64ToIV(base64: string): Uint8Array {
    return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  }

  async encrypt(plainText: string, password: string, saltBase64?: string) {
    const salt = saltBase64 ? this.base64ToSalt(saltBase64) : this.generateSaltBytes();
    const iv = this.generateIV();
    const key = await this.deriveKey(password, salt);
    const encoded = new TextEncoder().encode(plainText);
    const encryptedBuf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      key,
      encoded
    );

    return {
      cipherText: btoa(String.fromCharCode(...new Uint8Array(encryptedBuf))),
      salt: this.saltToBase64(salt),
      iv: this.ivToBase64(iv)
    };
  }

  async decrypt(cipherText: string, password: string, saltBase64: string, ivBase64: string) {
    try {
      const salt = this.base64ToSalt(saltBase64);
      const iv = this.base64ToIV(ivBase64);
      const key = await this.deriveKey(password, salt);
      const buf = Uint8Array.from(atob(cipherText), c => c.charCodeAt(0));
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
        key,
        buf.buffer as ArrayBuffer
      );
      return new TextDecoder().decode(decrypted);
    } catch (error) {
      throw new Error('decrypt_failed');
    }
  }

  validatePassword(password: string): { isValid: boolean; message: string } {
    if (!password || password.length < 6) {
      return { isValid: false, message: '密码至少6位' };
    }
    if (!/\d/.test(password) || !/[a-zA-Z]/.test(password)) {
      return { isValid: false, message: '密码必须包含字母+数字' };
    }
    return { isValid: true, message: '' };
  }
}

const encryptService = new EncryptionService();

// ===== 类型定义 =====
interface CreateEncryptedNoteBody {
  title: string;
  encrypt_content: string;
  note_password: string;
  categories?: string[];
  tags?: string[];
}

interface UpdateEncryptedNoteBody {
  title: string;
  encrypt_content: string;
  note_password: string;
  new_password?: string;
  categories?: string[];
  tags?: string[];
}

interface NoteEncryptRow {
  id: number;
  title: string;
  encrypt_content: string;
  password_hash: string;
  salt: string;
  iv: string;
  encrypted_categories: string;
  encrypted_tags: string;
  is_encrypted: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
}

// ===== 查询结果行类型 =====
interface NoteRow {
  id: number;
  title: string;
  salt: string;
  iv: string;
  encrypt_content: string;
  encrypted_categories: string;
  encrypted_tags: string;
  created_at: string;
  updated_at: string;
  version: number;
}

interface CountRow {
  total: string;
}

// ===== 控制器 =====
export class NoteEncryptController {
  /**
   * 创建加密笔记
   * POST /api/note/encrypted
   */
  static async createEncryptedNote(
    env: Env,
    uid: number,
    body: CreateEncryptedNoteBody
  ) {
    const pool: Pool = createPgPool(env);
    const { title, encrypt_content, note_password, categories = [], tags = [] } = body;

    // 验证密码
    const pwdCheck = encryptService.validatePassword(note_password);
    if (!pwdCheck.isValid) {
      return jsonResp(null, CODE.PARAM_ERR, pwdCheck.message);
    }
    
    if (!title || !encrypt_content) {
      return jsonResp(null, CODE.PARAM_ERR, '标题、内容不能为空');
    }

    const now = new Date().toISOString();

    // 加密业务字段（使用相同salt）
    const titleEnc = await encryptService.encrypt(title, note_password);
    const cateEnc = await encryptService.encrypt(
      JSON.stringify(categories),
      note_password,
      titleEnc.salt
    );
    const tagEnc = await encryptService.encrypt(
      JSON.stringify(tags),
      note_password,
      titleEnc.salt
    );

    await pool.query(
      `
      INSERT INTO note (
        user_id, title, content, encrypt_content,
        password_hash, salt, iv, encrypted_categories, encrypted_tags,
        is_encrypted, created_at, updated_at, version, is_deleted
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11, 1, false)
      `,
      [
        uid,
        titleEnc.cipherText,
        '',
        encrypt_content,
        '', // password_hash - 建议用bcrypt
        titleEnc.salt,
        titleEnc.iv,
        cateEnc.cipherText,
        tagEnc.cipherText,
        now,
        now
      ]
    );

    return jsonResp({}, CODE.SUCCESS, '加密笔记创建成功');
  }

  /**
   * 获取加密笔记详情（需密码解密）
   * GET /api/note/encrypted/:id?password=xxx
   */
  static async getEncryptedNote(
    env: Env,
    uid: number,
    noteId: string,
    searchParams: URLSearchParams
  ) {
    const pwd = searchParams.get('password');
    if (!pwd) {
      return jsonResp(null, CODE.PARAM_ERR, '请传入访问密码');
    }

    const id = parseInt(noteId, 10);
    if (isNaN(id)) {
      return jsonResp(null, CODE.PARAM_ERR, '笔记ID非法');
    }

    const pool: Pool = createPgPool(env);
    const { rows } = await pool.query<NoteRow>(
      `
      SELECT id, title, encrypt_content, salt, iv, 
             encrypted_categories, encrypted_tags,
             created_at, updated_at, version
      FROM note
      WHERE id = $1 AND user_id = $2 AND is_encrypted = true AND is_deleted = false
      `,
      [id, uid]
    );

    if (!rows.length) {
      return jsonResp(null, CODE.NOT_FOUND, '加密笔记不存在');
    }

    const row = rows[0];

    try {
      const title = await encryptService.decrypt(row.title, pwd, row.salt, row.iv);
      const cateStr = await encryptService.decrypt(
        row.encrypted_categories,
        pwd,
        row.salt,
        row.iv
      );
      const tagStr = await encryptService.decrypt(
        row.encrypted_tags,
        pwd,
        row.salt,
        row.iv
      );
      
      const categories = JSON.parse(cateStr) as string[];
      const tags = JSON.parse(tagStr) as string[];

      return jsonResp(
        {
          id: row.id,
          title,
          encrypt_content: row.encrypt_content,
          categories,
          tags,
          created_at: row.created_at,
          updated_at: row.updated_at,
          version: row.version
        },
        CODE.SUCCESS,
        '获取成功'
      );
    } catch (error) {
      return jsonResp(null, CODE.UNAUTH, '密码错误，解密失败');
    }
  }

  /**
   * 更新加密笔记（支持改密码）
   * PUT /api/note/encrypted/:id
   */
  static async updateEncryptedNote(
    env: Env,
    uid: number,
    noteId: string,
    body: UpdateEncryptedNoteBody
  ) {
    const pool: Pool = createPgPool(env);
    const id = parseInt(noteId, 10);
    if (isNaN(id)) {
      return jsonResp(null, CODE.PARAM_ERR, 'ID非法');
    }

    const { title, encrypt_content, note_password, new_password, categories, tags } = body;
    
    if (!title || !encrypt_content) {
      return jsonResp(null, CODE.PARAM_ERR, '标题内容不能为空');
    }

    // 查询现有笔记
    const { rows } = await pool.query<Pick<NoteRow, 'title' | 'salt' | 'iv'>>(
      `
      SELECT title, salt, iv
      FROM note
      WHERE id = $1 AND user_id = $2 AND is_encrypted = true AND is_deleted = false
      `,
      [id, uid]
    );
    
    if (!rows.length) {
      return jsonResp(null, CODE.NOT_FOUND, '笔记不存在');
    }

    // 校验旧密码
    try {
      await encryptService.decrypt(rows[0].title, note_password, rows[0].salt, rows[0].iv);
    } catch {
      return jsonResp(null, CODE.UNAUTH, '旧密码错误');
    }

    // 确定使用密码
    const usePwd = new_password || note_password;
    if (new_password) {
      const check = encryptService.validatePassword(new_password);
      if (!check.isValid) {
        return jsonResp(null, CODE.PARAM_ERR, check.message);
      }
    }

    // 重新随机盐值IV加密
    const titleEnc = await encryptService.encrypt(title, usePwd);
    const cateEnc = await encryptService.encrypt(
      JSON.stringify(categories ?? []),
      usePwd,
      titleEnc.salt
    );
    const tagEnc = await encryptService.encrypt(
      JSON.stringify(tags ?? []),
      usePwd,
      titleEnc.salt
    );
    
    const now = new Date().toISOString();

    await pool.query(
      `
      UPDATE note
      SET title = $1,
          encrypt_content = $2,
          salt = $3,
          iv = $4,
          encrypted_categories = $5,
          encrypted_tags = $6,
          updated_at = $7,
          version = version + 1
      WHERE id = $8 AND user_id = $9
      `,
      [
        titleEnc.cipherText,
        encrypt_content,
        titleEnc.salt,
        titleEnc.iv,
        cateEnc.cipherText,
        tagEnc.cipherText,
        now,
        id,
        uid
      ]
    );

    return jsonResp({}, CODE.SUCCESS, '更新成功');
  }

  /**
   * 软删除加密笔记
   * DELETE /api/note/encrypted/:id
   */
  static async deleteEncryptedNote(
    env: Env,
    uid: number,
    noteId: string,
    body: { password: string }
  ) {
    const pool: Pool = createPgPool(env);
    const id = parseInt(noteId, 10);
    if (isNaN(id)) {
      return jsonResp(null, CODE.PARAM_ERR, 'ID非法');
    }

    const { password } = body;

    const { rows } = await pool.query<Pick<NoteRow, 'title' | 'salt' | 'iv'>>(
      `
      SELECT title, salt, iv
      FROM note
      WHERE id = $1 AND user_id = $2 AND is_encrypted = true AND is_deleted = false
      `,
      [id, uid]
    );
    
    if (!rows.length) {
      return jsonResp(null, CODE.NOT_FOUND, '笔记不存在');
    }

    try {
      await encryptService.decrypt(rows[0].title, password, rows[0].salt, rows[0].iv);
    } catch {
      return jsonResp(null, CODE.UNAUTH, '密码错误');
    }

    const now = new Date().toISOString();
    await pool.query(
      `
      UPDATE note
      SET is_deleted = true, deleted_at = $1
      WHERE id = $2 AND user_id = $3
      `,
      [now, id, uid]
    );
    
    return jsonResp({}, CODE.SUCCESS, '已移入回收站');
  }

  /**
   * 加密笔记列表（仅元数据，不返回密文内容）
   * GET /api/note/encrypted/list
   */
  static async listEncryptedNotes(
    env: Env,
    uid: number,
    searchParams: URLSearchParams
  ) {
    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit')) || 20));
    const offset = (page - 1) * limit;
    
    const pool: Pool = createPgPool(env);

    const { rows } = await pool.query<{
      id: number;
      created_at: string;
      updated_at: string;
      version: number;
    }>(
      `
      SELECT id, created_at, updated_at, version
      FROM note
      WHERE user_id = $1 AND is_encrypted = true AND is_deleted = false
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [uid, limit, offset]
    );

    const { rows: countRows } = await pool.query<CountRow>(
      `
      SELECT COUNT(*) AS total
      FROM note
      WHERE user_id = $1 AND is_encrypted = true AND is_deleted = false
      `,
      [uid]
    );
    
    const total = parseInt(countRows[0]?.total || '0');

    return jsonResp(
      {
        list: rows,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      CODE.SUCCESS,
      '获取成功'
    );
  }

  /**
   * 密码校验接口
   * POST /api/note/encrypted/:id/verify
   */
  static async verifyPassword(
    env: Env,
    uid: number,
    noteId: string,
    body: { password: string }
  ) {
    const pool: Pool = createPgPool(env);
    const id = parseInt(noteId, 10);
    if (isNaN(id)) {
      return jsonResp({ isValid: false }, CODE.PARAM_ERR, 'ID非法');
    }

    const { rows } = await pool.query<Pick<NoteRow, 'title' | 'salt' | 'iv'>>(
      `
      SELECT title, salt, iv
      FROM note
      WHERE id = $1 AND user_id = $2 AND is_encrypted = true AND is_deleted = false
      `,
      [id, uid]
    );
    
    if (!rows.length) {
      return jsonResp({ isValid: false }, CODE.NOT_FOUND, '笔记不存在');
    }

    try {
      await encryptService.decrypt(
        rows[0].title,
        body.password,
        rows[0].salt,
        rows[0].iv
      );
      return jsonResp({ isValid: true }, CODE.SUCCESS, '密码正确');
    } catch {
      return jsonResp({ isValid: false }, CODE.UNAUTH, '密码错误');
    }
  }

  /**
   * 恢复加密笔记
   * POST /api/note/encrypted/:id/restore
   */
  static async restoreEncryptedNote(
    env: Env,
    uid: number,
    noteId: string
  ) {
    const pool: Pool = createPgPool(env);
    const id = parseInt(noteId, 10);
    if (isNaN(id)) {
      return jsonResp(null, CODE.PARAM_ERR, 'ID非法');
    }

    const { rowCount } = await pool.query(
      `
      UPDATE note
      SET is_deleted = false, deleted_at = null
      WHERE id = $1 AND user_id = $2 AND is_encrypted = true AND is_deleted = true
      `,
      [id, uid]
    );

    if (rowCount === 0) {
      return jsonResp(null, CODE.NOT_FOUND, '无已删除笔记可恢复');
    }
    
    return jsonResp({}, CODE.SUCCESS, '恢复成功');
  }
}