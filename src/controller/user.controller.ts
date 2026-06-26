import { createPgPool } from "../config/pg";
import { createRedis } from "../config/redis";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../config/jwt";
import { getNowISO } from "../utils/time";
import { hashPassword, comparePassword } from "../utils/password";
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
import { sendActivateEmail,sendResetPasswordEmail } from "../utils/email";
import type { Env } from "../types/env";
import { v4 as uuidv4 } from 'uuid';

export const UserController = {
  async register(
    env: Env,
    body: { username: string; password: string; email?: string },
  ) {
    const pool = createPgPool(env);
    const { username, password, email } = body;

    if (!username || !password)
      return jsonResp(null, CODE.PARAM_ERR, "账号密码不能为空");

    const now = getNowISO();
    if (email) {
      const exist = await pool.query(`SELECT id FROM users WHERE email=$1`, [email]);
      if (exist.rows.length > 0) {
        return jsonResp(null, CODE.FAIL, "该邮箱已被注册");
      }
    }

    const activateToken = uuidv4();
    const activateExpire = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const salt = parseInt(env.BCRYPT_SALT_ROUND);
    const hash = await hashPassword(password, salt);

    try {
      const res = await pool.query(
        `INSERT INTO users(
        username,email,password_hash,status,
        activate_token,activate_expire,created_at,updated_at
      ) VALUES($1,$2,$3,'inactive',$4,$5,$6,$6) RETURNING id`,
        [username, email ?? null, hash, activateToken, activateExpire, now],
      );

      if (email) {
        try {
           const activateUrl = `${env.APP_BASE_URL}/activate?token=${activateToken}`;
          await sendActivateEmail(env, email, activateUrl);
        } catch {
          return jsonResp(
            { userId: res.rows[0].id },
            CODE.SUCCESS,
            "注册成功，但激活邮件发送失败，请稍后重发激活邮件"
          );
        }
      }

      return jsonResp(
        { userId: res.rows[0].id },
        CODE.SUCCESS,
        email ? "注册成功，请前往邮箱激活账号后登录" : "注册成功"
      );
    } catch {
      return jsonResp(null, CODE.FAIL, "用户名或邮箱已被占用");
    }
  },

  async login(env: Env, body: { username: string; password: string }) {
    const pool = createPgPool(env);
    const { username, password } = body;
  // 邮箱正则
    const emailReg = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    let sql: string;
    let params: string[] = [username];

    if (emailReg.test(username)) {
        // 输入是邮箱，按邮箱查询
        sql = `SELECT id,password_hash,status FROM users WHERE email=$1 AND deleted=false`;
    } else {
        // 输入是用户名，按用户名查询
        sql = `SELECT id,password_hash,status FROM users WHERE username=$1 AND deleted=false`;
    }
    const { rows } = await pool.query(sql, params);
    if (rows.length === 0) return jsonResp(null, CODE.UNAUTH, "账号不存在");
    const user = rows[0];
    const ok = await comparePassword(password, user.password_hash);
    if (!ok) return jsonResp(null, CODE.UNAUTH, "密码错误");

    if (user.status !== "active") {
      return jsonResp(null, CODE.UNAUTH, "账号尚未激活，请前往注册邮箱完成激活");
    }

    const accessToken = await signAccessToken(user.id, env);
    const refreshToken = await signRefreshToken(user.id, env);
    const expire = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const now = getNowISO();
    await pool.query(
      `INSERT INTO user_refresh_token(user_id,refresh_token,expired_at,created_at) VALUES($1,$2,$3,$4)`,
      [user.id, refreshToken, expire, now],
    );
    return jsonResp({ accessToken, refreshToken, uid: user.id }, CODE.SUCCESS, "登录成功");
  },

  async activateUser(env: Env, rawToken: string | null | undefined) {
    const token = rawToken?.trim();
    if (!token) {
      return jsonResp(null, CODE.PARAM_ERR, "激活令牌不能为空");
    }
    const pool = createPgPool(env);
    const now = new Date();
    const userRes = await pool.query(
      `SELECT id FROM users WHERE activate_token = $1 AND status = 'inactive' AND activate_expire > $2`,
      [token, now],
    );

    if (userRes.rows.length === 0) {
      return jsonResp(null, CODE.FAIL, "激活链接无效或已过期，请重新注册");
    }

    await pool.query(
      `UPDATE users SET status = 'active', activate_token = null, activate_expire = null WHERE activate_token = $1`,
      [token],
    );

    return jsonResp(null, CODE.SUCCESS, "账号激活成功，请前往登录");
  },

  async resendActivateMail(env: Env, body: { email: string }) {
    const pool = createPgPool(env);
    const userRes = await pool.query(`SELECT id,status FROM users WHERE email=$1`, [body.email]);
    if (userRes.rows.length === 0)
      return jsonResp(null, CODE.FAIL, "该邮箱未注册");
    const user = userRes.rows[0];
    if (user.status === "active")
      return jsonResp(null, CODE.SUCCESS, "账号已激活，直接登录即可");

    const newToken = uuidv4();
    const expire = new Date(Date.now() + 24 * 3600 * 1000);
    await pool.query(`UPDATE users SET activate_token=$1,activate_expire=$2 WHERE email=$3`, [newToken, expire, body.email]);
    const activateUrl = `${env.APP_BASE_URL}/activate?token=${newToken}`;
    await sendActivateEmail(env, body.email, activateUrl);
    return jsonResp(null, CODE.SUCCESS, "激活邮件已重新发送，请查收");
  },

  async refreshToken(env: Env, body: { refreshToken: string }) {
    const pool = createPgPool(env);
    const redis = createRedis(env);
    const { refreshToken } = body;
    const black = await redis.get(`token:black:${refreshToken}`);
    if (black) return jsonResp(null, CODE.UNAUTH, "该令牌已失效");
    try {
      const payload = await verifyRefreshToken(refreshToken, env);
      const uid = Number(payload.uid);
      const now = getNowISO();
      const { rows } = await pool.query(
        `SELECT id FROM user_refresh_token WHERE user_id=$1 AND refresh_token=$2 AND expired_at>$3`,
        [uid, refreshToken, now],
      );
      if (rows.length === 0)
        return jsonResp(null, CODE.UNAUTH, "刷新令牌已过期");
      const newAccess = await signAccessToken(uid, env);
      return jsonResp({ accessToken: newAccess }, CODE.SUCCESS, "刷新成功");
    } catch {
      return jsonResp(null, CODE.UNAUTH, "刷新令牌无效");
    }
  },

  async changePwd(
    env: Env,
    uid: number,
    body: { oldPwd: string; newPwd: string },
  ) {
    const pool = createPgPool(env);
    const redis = createRedis(env);
    const { rows } = await pool.query(`SELECT password_hash FROM users WHERE id=$1`, [uid]);
    const match = await comparePassword(body.oldPwd, rows[0].password_hash);
    if (!match) return jsonResp(null, CODE.PARAM_ERR, "原密码错误");

    const salt = parseInt(env.BCRYPT_SALT_ROUND);
    const newHash = await hashPassword(body.newPwd, salt);
    const now = getNowISO();
    await pool.query(`UPDATE users SET password_hash=$1,updated_at=$2 WHERE id=$3`, [newHash, now, uid]);

    const tokens = await pool.query(`SELECT refresh_token FROM user_refresh_token WHERE user_id=$1`, [uid]);
    for (const t of tokens.rows) {
      await redis.set(`token:black:${t.refresh_token}`, "1", { ex: 86400 });
    }
    await pool.query(`DELETE FROM user_refresh_token WHERE user_id=$1`, [uid]);
    return jsonResp(null, CODE.SUCCESS, "密码修改成功，请重新登录");
  },

  async destroyAccount(env: Env, uid: number) {
    const pool = createPgPool(env);
    const redis = createRedis(env);
    const now = getNowISO();
    await pool.query(`UPDATE users SET deleted=true,updated_at=$1 WHERE id=$2`, [now, uid]);

    const tokens = await pool.query(`SELECT refresh_token FROM user_refresh_token WHERE user_id=$1`, [uid]);
    for (const t of tokens.rows) {
      await redis.set(`token:black:${t.refresh_token}`, "1", { ex: 86400 });
    }
    await pool.query(`DELETE FROM user_refresh_token WHERE user_id=$1`, [uid]);
    return jsonResp(null, CODE.SUCCESS, "账号注销完成");
  },
  /**
 * 发送密码重置邮件
 */
async resetPwdSend(env: Env, body: { email: string }) {
  const pool = createPgPool(env);
  const { email } = body;

  // 查询用户
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE email=$1 AND deleted=false`,
    [email]
  );
  if (rows.length === 0) {
    return jsonResp(null, CODE.FAIL, "该邮箱未注册");
  }
  const userId = rows[0].id;

  // 生成重置令牌，15分钟过期
  const resetToken = uuidv4();
  const now = getNowISO();
  const expire = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  // 先清理该用户旧的重置记录
  await pool.query(`DELETE FROM user_reset_token WHERE user_id=$1`, [userId]);

  // 插入新重置token
  await pool.query(
    `INSERT INTO user_reset_token(user_id, reset_token, expired_at, created_at) VALUES($1,$2,$3,$4)`,
    [userId, resetToken, expire, now]
  );

  // 发送重置邮件
  const resetUrl = `${env.APP_BASE_URL}/reset-password?token=${encodeURIComponent(resetToken)}`;
  await sendResetPasswordEmail(env, email, resetUrl);

  return jsonResp(null, CODE.SUCCESS, "密码重置邮件已发送，请前往邮箱查收，15分钟内有效");
},

/**
 * 执行密码重置
 */
async resetPwd(env: Env, body: { token: string; newPwd: string }) {
  const pool = createPgPool(env);
  const { token, newPwd } = body;
  const now = getNowISO();

  // 查询有效token
  const { rows } = await pool.query(
    `SELECT urt.user_id FROM user_reset_token urt
    WHERE urt.reset_token=$1 AND urt.expired_at > $2`,
    [token, now]
  );
  if (rows.length === 0) {
    return jsonResp(null, CODE.FAIL, "重置链接无效或已过期");
  }
  const userId = rows[0].user_id;

  // 加密新密码
  const salt = parseInt(env.BCRYPT_SALT_ROUND);
  const hash = await hashPassword(newPwd, salt);
  const updateTime = getNowISO();

  // 更新密码
  await pool.query(
    `UPDATE users SET password_hash=$1, updated_at=$2 WHERE id=$3`,
    [hash, updateTime, userId]
  );

  // 清除当前重置token
  await pool.query(`DELETE FROM user_reset_token WHERE reset_token=$1`, [token]);

  // 该用户所有刷新令牌拉黑，强制下线
  const redis = createRedis(env);
  const tokens = await pool.query(
    `SELECT refresh_token FROM user_refresh_token WHERE user_id=$1`,
    [userId]
  );
  for (const t of tokens.rows) {
    await redis.set(`token:black:${t.refresh_token}`, "1", { ex: 86400 });
  }
  await pool.query(`DELETE FROM user_refresh_token WHERE user_id=$1`, [userId]);

  return jsonResp(null, CODE.SUCCESS, "密码重置成功，请前往登录");
},
};