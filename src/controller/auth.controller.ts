// src/controllers/auth.controller.ts
import { createKnex } from "../config/knex";
import { createRedis } from "../config/redis";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../config/jwt";
import { hashPassword, comparePassword } from "../utils/password";
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
import { sendActivateEmail, sendResetPasswordEmail } from "../utils/email";
import type { Env } from "../types/env";
import { v4 as uuidv4 } from "uuid";

export const AuthController = {
  async register(
    env: Env,
    body: { username: string; password: string; email?: string, captchaToken: string },
  ) {
    const knex = createKnex(env);
    const redis = createRedis(env);
    const { username, password, email, captchaToken } = body;

    // 1. 验证码校验
    if (!captchaToken) {
      return jsonResp(null, CODE.PARAM_ERR, "请先完成安全验证");
    }
    const tokenKey = `img:token:${captchaToken}`;
    const exists = await redis.exists(tokenKey);
    if (!exists) {
      return jsonResp(null, CODE.FAIL, "验证码已失效，请刷新验证码");
    }
    await redis.del(tokenKey);

    if (!username || !password)
      return jsonResp(null, CODE.PARAM_ERR, "账号密码不能为空");

    // 邮箱查重：必须带上软删除条件
    if (email) {
      const existUser = await knex("users")
        .where({ email, is_deleted: 0 })
        .first();
      if (existUser) {
        return jsonResp(null, CODE.FAIL, "该邮箱已被注册");
      }
    }

    const activateToken = uuidv4();
    const activateExpire = knex.raw(`CURRENT_TIMESTAMP + INTERVAL '1' DAY`);
    const salt = parseInt(env.BCRYPT_SALT_ROUND);
    const hash = await hashPassword(password, salt);

    try {
      const userId = await knex.transaction(async (trx) => {
        // 重点：移除 created_at、updated_at，数据库默认填充
        // 字段修正：activate_expired_at → activate_expire
        // 软删除统一 0/1
        const insertData = {
          username,
          email: email ?? null,
          password_hash: hash,
          status: "inactive",
          role: "user",
          activate_token: activateToken,
          activate_expire: activateExpire,
          is_deleted: 0,
          is_frozen: 0
        };
        // 双库兼容 returning 获取自增主键，废弃按用户名+时间查询
        const [newUser] = await trx("users")
          .insert(insertData)
          .returning("id");
        return Number(newUser.id);
      });

      if (email) {
        try {
          const activateUrl = `${env.APP_BASE_URL}/activate?token=${activateToken}`;
          await sendActivateEmail(env, email, activateUrl);
        } catch (emailErr) {
          const err = emailErr as Error;
          console.error("【注册】激活邮件发送失败", {
            username,
            email,
            errorMsg: err.message,
            stack: err.stack,
          });
          return jsonResp(
            { userId },
            CODE.SUCCESS,
            "注册成功，但激活邮件发送失败，请稍后重发激活邮件",
          );
        }
      }

      return jsonResp(
        { userId },
        CODE.SUCCESS,
        email ? "注册成功，请前往邮箱激活账号后登录" : "注册成功",
      );
    } catch (dbErr) {
      const err = dbErr as Error;
      console.error("【注册】数据库异常，用户名或邮箱重复", {
        username,
        email,
        errorMsg: err.message,
        stack: err.stack,
      });
      return jsonResp(null, CODE.FAIL, "用户名或邮箱已被占用");
    }
  },

  async login(env: Env, body: { username: string; password: string, captchaToken: string }) {
    const knex = createKnex(env);
    const redis = createRedis(env);
    const { username, password, captchaToken } = body;

    // 滑块验证码校验
    if (!captchaToken) {
      return jsonResp(null, CODE.PARAM_ERR, "请先完成安全验证");
    }
    const tokenKey = `img:token:${captchaToken}`;
    const exists = await redis.exists(tokenKey);
    if (!exists) {
      return jsonResp(null, CODE.FAIL, "验证码已失效，请刷新验证码");
    }
    await redis.del(tokenKey);

    // 邮箱正则
    const emailReg = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    let user;
    if (emailReg.test(username)) {
      user = await knex("users")
        .where({ email: username, is_deleted: 0 })
        .first("id", "password_hash", "status", "role", "is_frozen");
    } else {
      user = await knex("users")
        .where({ username, is_deleted: 0 })
        .first("id", "password_hash", "status", "role", "is_frozen");
    }

    if (!user) return jsonResp(null, CODE.UNAUTH, "账号不存在");

    if (user.is_frozen === 1) {
      return jsonResp(null, CODE.UNAUTH, "账号已被管理员冻结，禁止登录");
    }

    const ok = await comparePassword(password, user.password_hash);
    if (!ok) return jsonResp(null, CODE.UNAUTH, "密码错误");

    if (user.status !== "active") {
      return jsonResp(
        null,
        CODE.UNAUTH,
        "账号尚未激活，请前往注册邮箱完成激活",
      );
    }

    const accessToken = await signAccessToken(user.id, user.role, env);
    const refreshToken = await signRefreshToken(user.id, env);
    const expire = knex.raw(`CURRENT_TIMESTAMP + INTERVAL '30' DAY`);

    // user_refresh_token 新增不传 created_at
    await knex("user_refresh_token").insert({
      user_id: user.id,
      refresh_token: refreshToken,
      activate_expire: expire,
      is_deleted: 0
    });

    return jsonResp(
      { accessToken, refreshToken, uid: user.id, role: user.role },
      CODE.SUCCESS,
      "登录成功",
    );
  },

  async activateUser(env: Env, rawToken: string | null | undefined) {
    const token = rawToken?.trim();
    if (!token) {
      return jsonResp(null, CODE.PARAM_ERR, "激活令牌不能为空");
    }
    const knex = createKnex(env);  
    // 字段修正：activate_expired_at → activate_expire
    const user = await knex("users")
      .where({ activate_token: token, status: "inactive", is_deleted: 0 })
      .where("activate_expire", ">", knex.fn.now())
      .first("id");

    if (!user) {
      return jsonResp(null, CODE.FAIL, "激活链接无效或已过期，请重新注册");
    }

    // 更新必须手动维护 updated_at
    await knex("users")
      .where({ activate_token: token, is_deleted: 0 })
      .update({
        status: "active",
        activate_token: null,
        activate_expire: null,
        updated_at: knex.fn.now()
      });

    return jsonResp(null, CODE.SUCCESS, "账号激活成功，请前往登录");
  },

  async resendActivateMail(env: Env, body: { email: string }) {
    const knex = createKnex(env);
    const user = await knex("users")
      .where({ email: body.email, is_deleted: 0 })
      .first("id", "status");

    if (!user)
      return jsonResp(null, CODE.FAIL, "该邮箱未注册");
    if (user.status === "active")
      return jsonResp(null, CODE.SUCCESS, "账号已激活，直接登录即可");

    const newToken = uuidv4();
    const expire =knex.raw(`CURRENT_TIMESTAMP + INTERVAL '30' DAY`);
    await knex("users")
      .where({ email: body.email, is_deleted: 0 })
      .update({
        activate_token: newToken,
        activate_expire: expire,
        updated_at: knex.fn.now()
      });

    const activateUrl = `${env.APP_BASE_URL}/activate?token=${newToken}`;
    await sendActivateEmail(env, body.email, activateUrl);
    return jsonResp(null, CODE.SUCCESS, "激活邮件已重新发送，请查收");
  },

  async refreshToken(env: Env, body: { refreshToken: string }) {
    const knex = createKnex(env);
    const redis = createRedis(env);
    const { refreshToken } = body;

    const black = await redis.get(`token:black:${refreshToken}`);
    if (black) return jsonResp(null, CODE.UNAUTH, "该令牌已失效");

    try {
      const payload = await verifyRefreshToken(refreshToken, env);
      const uid = Number(payload.uid);
      const now = knex.fn.now();

      const tokenRecord = await knex("user_refresh_token")
        .where({ user_id: uid, refresh_token: refreshToken, is_deleted: 0 })
        .where("activate_expire", ">", now)
        .first("id");

      if (!tokenRecord)
        return jsonResp(null, CODE.UNAUTH, "刷新令牌已过期");

      const user = await knex("users")
        .where({ id: uid, is_deleted: 0 })
        .first("role");

      if (!user) {
        return jsonResp(null, CODE.UNAUTH, "用户不存在");
      }

      const newAccess = await signAccessToken(uid, user.role, env);
      return jsonResp({ accessToken: newAccess }, CODE.SUCCESS, "刷新成功");
    } catch (err) {
      const error = err as Error;
      console.error("【刷新令牌异常】", error.message, error.stack);
      return jsonResp(null, CODE.UNAUTH, "刷新令牌无效");
    }
  },

  /**
   * 发送密码重置邮件
   */
  async resetPwdSend(env: Env, body: { email: string }) {
    const knex = createKnex(env);
    const { email } = body;

    const user = await knex("users")
      .where({ email, is_deleted: 0 })
      .first("id");

    if (!user) {
      return jsonResp(null, CODE.FAIL, "该邮箱未注册");
    }
    const userId = user.id;

    const resetToken = uuidv4();
    const expire = knex.raw(`CURRENT_TIMESTAMP + INTERVAL '15' MINUTE`);

    // 清理旧重置记录（逻辑删除建议改为软删除，这里先物理删除）
    await knex("user_reset_token")
      .where({ user_id: userId })
      .update({ is_deleted: 1, updated_at: knex.fn.now() });

    await knex("user_reset_token").insert({
      user_id: userId,
      reset_token: resetToken,
      activate_expire: expire,
      is_deleted: 0
    });

    const resetUrl = `${env.APP_BASE_URL}/reset-password?token=${encodeURIComponent(resetToken)}`;
    await sendResetPasswordEmail(env, email, resetUrl);

    return jsonResp(
      null,
      CODE.SUCCESS,
      "密码重置邮件已发送，请前往邮箱查收，15分钟内有效",
    );
  },

  /**
   * 执行密码重置
   */
  async resetPwd(env: Env, body: { token: string; newPwd: string }) {
    const knex = createKnex(env);
    const redis = createRedis(env);
    const { token, newPwd } = body;
    const now = knex.fn.now();

    const tokenRow = await knex("user_reset_token")
      .where({ reset_token: token, is_deleted: 0 })
      .where("activate_expire", ">", now)
      .first("user_id");

    if (!tokenRow) {
      return jsonResp(null, CODE.FAIL, "重置链接无效或已过期");
    }
    const userId = tokenRow.user_id;

    const salt = parseInt(env.BCRYPT_SALT_ROUND);
    const hash = await hashPassword(newPwd, salt);

    await knex.transaction(async (trx) => {
      // 更新密码，必须更新updated_at
      await trx("users")
        .where({ id: userId, is_deleted: 0 })
        .update({
          password_hash: hash,
          updated_at: knex.fn.now(),
        });

      // 软删除重置记录
      await trx("user_reset_token")
        .where({ reset_token: token })
        .update({ is_deleted: 1, updated_at: knex.fn.now()});

      // 拉黑用户所有刷新令牌并软删除
      const refreshList = await trx("user_refresh_token")
        .where({ user_id: userId, is_deleted: 0 })
        .select("refresh_token");

      for (const item of refreshList) {
        await redis.set(`token:black:${item.refresh_token}`, "1", { ex: 86400 });
      }
      await trx("user_refresh_token")
        .where({ user_id: userId })
        .update({ is_deleted: 1, updated_at: knex.fn.now() });
    });

    return jsonResp(null, CODE.SUCCESS, "密码重置成功，请前往登录");
  },

  /**
   * 邮箱修改激活接口
   */
  async activateChangeEmail(env: Env, search?: URLSearchParams) {
    const token = search?.get("token");
    if (!token) {
      return jsonResp(null, CODE.PARAM_ERR, "激活令牌不能为空");
    }
    const knex = createKnex(env);
    const now = knex.fn.now();

    const activateRow = await knex("user_email_activate")
      .where({ activate_token: token, is_deleted: 0 })
      .where("activate_expire", ">", now)
      .first("user_id", "new_email");

    if (!activateRow) {
      return jsonResp(null, CODE.PARAM_ERR, "激活链接已过期或无效");
    }

    const { user_id, new_email } = activateRow;

    try {
      await knex.transaction(async (trx) => {
        await trx("users")
          .where({ id: user_id, is_deleted: 0 })
          .update({
            email: new_email,
            updated_at: knex.fn.now()
          });
        // 软删除激活记录
        await trx("user_email_activate")
          .where({ activate_token: token })
          .update({ is_deleted: 1, updated_at: knex.fn.now()});
      });
      return jsonResp(null, CODE.SUCCESS, "邮箱激活成功，已更新为新邮箱");
    } catch (err) {
      const error = err as Error;
      console.error("【更换邮箱激活异常】", error.message, error.stack);
      return jsonResp(null, CODE.FAIL, "邮箱激活失败，请重试");
    }
  }
};