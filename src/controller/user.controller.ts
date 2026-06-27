import { createPgPool } from "../config/pg";
import { createRedis } from "../config/redis";
import { getNowISO } from "../utils/time";
import { hashPassword, comparePassword } from "../utils/password";
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
import {requireAdmin} from "../middleware/auth"
import type { Env } from "../types/env";
import type{UserJWTPayload } from "../types/model"
import { v4 as uuidv4 } from "uuid";
import { sendChangeEmail } from "../utils/email";
// Token黑名单过期时间：1天
const TOKEN_BLACK_EXPIRE = 86400;
export const UserController = { 
   /**
   * 获取当前登录用户详细信息
   */
  async getCurrentUserInfo(env: Env, uid: number) {
    const pool = createPgPool(env);
    
    const { rows } = await pool.query(
      `
      SELECT 
        id, 
        username, 
        email, 
        avatar,
        role, 
        status, 
        is_frozen, 
        created_at, 
        updated_at
      FROM users 
      WHERE id = $1 AND deleted = false
      `,
      [uid]
    );
    
    if (rows.length === 0) {
      return jsonResp(null, CODE.NOT_FOUND, "用户不存在或已被注销");
    }    
    const user = rows[0];      
    return jsonResp(user,CODE.SUCCESS, "获取用户信息成功" );
  },
/**
 * 修改个人资料：用户名、头像直接生效；邮箱需邮件激活后生效
 * 仅字段发生变更才执行更新/校验，相同值直接跳过处理
 */
async updateProfile(
  env: Env,
  uid: number,
  body: {
    username?: string
    email?: string
    avatar?: string
  }
) {
  const pool = createPgPool(env);
  const now = getNowISO();
  // 1. 一次性查询当前用户信息，用于新旧值比对
  const userRes = await pool.query(
    `SELECT id, username, email, avatar FROM users WHERE id = $1 AND deleted = false`,
    [uid]
  );
  if (userRes.rows.length === 0) {
    return jsonResp(null, CODE.NOT_FOUND, "用户不存在");
  }
  const current = userRes.rows[0];
  const updateFields: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;
  let needSendEmailActivate = false;
  let targetNewEmail = "";

  // ====================== 1. 用户名处理 ======================
  if (body.username?.trim()) {
    const newUsername = body.username.trim();
    // 新旧一致，直接跳过
    if (newUsername !== current.username) {
      // 格式校验
      if (newUsername.length < 2 || newUsername.length > 20) {
        return jsonResp(null, CODE.PARAM_ERR, "用户名长度需为2-20位");
      }
      // 唯一性校验
      const existUser = await pool.query(
        `SELECT 1 FROM users WHERE username = $1 AND id <> $2 AND deleted = false`,
        [newUsername, uid]
      );
      if (existUser.rows.length > 0) {
        return jsonResp(null, CODE.PARAM_ERR, "用户名已被占用");
      }
      updateFields.push(`username = $${paramIndex++}`);
      params.push(newUsername);
    }
  }

  // ====================== 2. 头像处理（支持清空） ======================
  if (body.avatar !== undefined) {
    const newAvatar = body.avatar?.trim() || null;
    if (newAvatar !== current.avatar) {
      updateFields.push(`avatar = $${paramIndex++}`);
      params.push(newAvatar);
    }
  }

  // ====================== 3. 邮箱处理（需激活，不直接更新主表） ======================
  if (body.email?.trim()) {
    const newEmail = body.email.trim();
    if (newEmail !== current.email) {
      // 格式校验
      const emailReg = /^[\w.-]+@[\w-]+\.[\w.-]+$/;
      if (!emailReg.test(newEmail)) {
        return jsonResp(null, CODE.PARAM_ERR, "邮箱格式错误");
      }
      // 全局唯一校验
      const existEmail = await pool.query(
        `SELECT 1 FROM users WHERE email = $1 AND deleted = false`,
        [newEmail]
      );
      if (existEmail.rows.length > 0) {
        return jsonResp(null, CODE.PARAM_ERR, "该邮箱已被其他账号绑定");
      }
      needSendEmailActivate = true;
      targetNewEmail = newEmail;
    }
  }
  // ====================== 全局拦截：无任何字段变更 ======================
  if (updateFields.length === 0 && !needSendEmailActivate) {
    return jsonResp(null, CODE.PARAM_ERR, "未修改任何资料内容");
  }

  // ====================== 事务保证：基础资料更新 + 邮箱激活记录 ======================
  try {
    await pool.query("BEGIN");

    // 更新用户名、头像
    if (updateFields.length > 0) {
      updateFields.push(`updated_at = $${paramIndex++}`);
      params.push(now);
      params.push(uid);
      const updateSql = `
        UPDATE users
        SET ${updateFields.join(", ")}
        WHERE id = $${paramIndex} AND deleted = false
        RETURNING id, username, email, avatar
      `;
      await pool.query(updateSql, params);
    }

    // 写入邮箱激活临时记录 + 发送激活邮件
    if (needSendEmailActivate) {
      const activateToken = uuidv4();
      const expireTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      // 冲突时覆盖上一次未激活记录
      await pool.query(`
        INSERT INTO user_email_activate (user_id, new_email, activate_token, expired_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id)
        DO UPDATE SET new_email = $2, activate_token = $3, expired_at = $4, created_at = NOW()
      `, [uid, targetNewEmail, activateToken, expireTime]);

      const activateUrl = `${env.APP_BASE_URL}/change-email?token=${activateToken}`;
      await sendChangeEmail(env, targetNewEmail, activateUrl);
    }

    await pool.query("COMMIT");
  } catch (err) {
    await pool.query("ROLLBACK");
    return jsonResp(null, CODE.FAIL, "资料更新失败，请稍后重试");
  }
  // 区分两种返回文案
  if (needSendEmailActivate) {
    return jsonResp(null, CODE.SUCCESS, "资料已保存，新邮箱请前往邮箱完成激活后生效");
  }
  return jsonResp(null, CODE.SUCCESS, "个人资料修改成功");
},
 /**
 * 修改当前登录用户密码（从JWT自动获取uid，禁止手动传uid越权）
 */
async changePwd(
  env: Env,
  uid: number,
  body: { oldPwd: string; newPwd: string }
) {  
  // 2. 请求参数合法性校验
  if (!body?.oldPwd?.trim() || !body?.newPwd?.trim()) {
    return jsonResp(null, CODE.PARAM_ERR, "原密码、新密码不能为空");
  }
  if (body.newPwd.length < 6) {
    return jsonResp(null, CODE.PARAM_ERR, "新密码长度不能少于6位");
  }
  if (body.oldPwd === body.newPwd) {
    return jsonResp(null, CODE.PARAM_ERR, "新密码不能与原密码一致");
  }

  const pool = createPgPool(env);
  const redis = createRedis(env);

  // 3. 查询当前登录未删除用户密码
  const { rows } = await pool.query(
    `SELECT password_hash FROM users WHERE id = $1 AND deleted = false`,
    [uid]
  );
  if (rows.length === 0) {
    return jsonResp(null, CODE.NOT_FOUND, "当前用户不存在或已被注销");
  }

  // 4. 校验原密码
  const isPwdMatch = await comparePassword(body.oldPwd, rows[0].password_hash);
  if (!isPwdMatch) {
    return jsonResp(null, CODE.PARAM_ERR, "原密码输入错误");
  }

  // 5. 更新新密码
  const salt = parseInt(env.BCRYPT_SALT_ROUND);
  const newPasswordHash = await hashPassword(body.newPwd, salt);
  const now = getNowISO();
  await pool.query(
    `UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3`,
    [newPasswordHash, now, uid]
  );

  // 6. 拉黑该用户所有刷新令牌，强制全设备下线
  const tokenRes = await pool.query(
    `SELECT refresh_token FROM user_refresh_token WHERE user_id = $1`,
    [uid]
  );
  const tokenList = tokenRes.rows;
  if (tokenList.length > 0) {
    for (const item of tokenList) {
      await redis.set(`token:black:${item.refresh_token}`, "1", { ex: TOKEN_BLACK_EXPIRE });
    }
    await pool.query(`DELETE FROM user_refresh_token WHERE user_id = $1`, [uid]);
  }

  return jsonResp(null, CODE.SUCCESS, "密码修改成功，请重新登录");
},

 /**
 * 当前登录用户注销账号（逻辑删除），从JWT获取当前用户uid，禁止外部传入uid
 */
async destroyAccount(
  env: Env,
  uid: number,
) { 
  const pool = createPgPool(env);
  const redis = createRedis(env);
  const now = getNowISO();
  const TOKEN_BLACK_EXPIRE = 86400;

  try {
    // 开启事务
    await pool.query("BEGIN");

    // 先校验用户是否存在且未注销
    const userRes = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND deleted = false`,
      [uid]
    );
    if (userRes.rows.length === 0) {
      await pool.query("ROLLBACK");
      return jsonResp(null, CODE.PARAM_ERR, "账号不存在或已注销");
    }

    // 逻辑删除用户
    await pool.query(
      `UPDATE users SET deleted = true, updated_at = $1 WHERE id = $2`,
      [now, uid]
    );

    // 拉黑并清理所有刷新令牌，强制全设备下线
    const tokenRes = await pool.query(
      `SELECT refresh_token FROM user_refresh_token WHERE user_id = $1`,
      [uid]
    );
    const tokenList = tokenRes.rows;
    if (tokenList.length > 0) {
      for (const item of tokenList) {
        await redis.set(`token:black:${item.refresh_token}`, "1", {
          ex: TOKEN_BLACK_EXPIRE
        });
      }
      await pool.query(`DELETE FROM user_refresh_token WHERE user_id = $1`, [uid]);
    }

    await pool.query("COMMIT");
    return jsonResp(null, CODE.SUCCESS, "账号注销完成");
  } catch (err) {
    await pool.query("ROLLBACK");
    return jsonResp(null, CODE.FAIL, "账号注销失败，请稍后重试");
  }
},
 
async getUserList(env: Env, payload: UserJWTPayload) {
  // 管理员校验
  const authErr = requireAdmin(payload);
  if (authErr) return authErr;

  const pool = createPgPool(env);
  // 分页可自行扩展
  const { rows } = await pool.query(`
    SELECT id, username, email, role, status, is_frozen, created_at
    FROM users
    WHERE deleted = false
    ORDER BY created_at DESC
  `);
  return jsonResp(rows, CODE.SUCCESS, "查询成功");
},
async updateUserInfo(
  env: Env,
  payload: UserJWTPayload,
  body: { userId: bigint; role?: string; isFrozen?: boolean }
) {
  const authErr = requireAdmin(payload);
  if (authErr) return authErr;
  const pool = createPgPool(env);
  const { userId, role, isFrozen } = body;

  const updateList: string[] = [];
  const params: any[] = [];
  let idx = 1;
  if (role) {
    updateList.push(`role = $${idx++}`);
    params.push(role);
  }
  if (isFrozen !== undefined) {
    updateList.push(`is_frozen = $${idx++}`);
    params.push(isFrozen);
  }
  if (updateList.length === 0) {
    return jsonResp(null, CODE.PARAM_ERR, "无更新字段");
  }
  params.push(userId);

  await pool.query(
    `UPDATE users SET ${updateList.join(',')} WHERE id = $${idx} AND deleted = false`,
    params
  );
  return jsonResp(null, CODE.SUCCESS, "用户信息更新成功");
},
async adminResetUserPwd(
  env: Env,
  payload: UserJWTPayload,
  body: { userId: bigint; newPwd: string }
) {
  const authErr = requireAdmin(payload);
  if (authErr) return authErr;
  const pool = createPgPool(env);
  const saltRounds = parseInt(env.BCRYPT_SALT_ROUND);
  const hash = await hashPassword(body.newPwd, saltRounds);
  await pool.query(
    `UPDATE users SET password_hash=$1, updated_at=$2 WHERE id=$3 AND deleted=false`,
    [hash, getNowISO(), body.userId]
  );
  return jsonResp(null, CODE.SUCCESS, "用户密码重置成功");
}, 
};