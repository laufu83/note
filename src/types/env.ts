import type { Hyperdrive, KVNamespace } from "@cloudflare/workers-types";

/**
 * Cloudflare Workers 环境变量类型定义
 * 所有在 wrangler.toml / .dev.vars 中配置的环境变量、资源绑定统一在此声明
 */
export type Env = {
  /** 当前运行环境：development / production */
  ENVIRONMENT: string;

  /** 数据库客户端类型：pg | mysql2 */
  DB_CLIENT: string;
  /** 通用数据库连接地址（备用数据库连接串） */
  DATABASE_URL: string;
  /** 数据库是否开启SSL加密：true / false */
  DB_SSL: string;

  /** Upstash Redis 服务连接地址 */
  REDIS_URL: string;
  /** Upstash Redis 访问密钥 */
  REDIS_TOKEN: string;

  /** Supabase 项目接口地址 */
  SUPABASE_URL: string;
  /** Supabase 服务端密钥（拥有全量权限） */
  SUPABASE_SERVICE_KEY: string;
  /** Supabase 文件存储桶名称 */
  SUPABASE_STORAGE_BUCKET: string;

  /** JWT 短期访问令牌加密密钥 */
  JWT_ACCESS_SECRET: string;
  /** JWT 刷新令牌加密密钥 */
  JWT_REFRESH_SECRET: string;
  /** 访问令牌过期时间，如 15m、1h */
  ACCESS_TOKEN_EXPIRE: string;
  /** 刷新令牌过期时间，如 7d、30d */
  REFRESH_TOKEN_EXPIRE: string;

  /** Bcrypt 密码加密加盐轮次 */
  BCRYPT_SALT_ROUND: string;

  /** IP维度限流：单个时间窗口内最大请求次数 */
  RATE_LIMIT_IP_MAX: string;
  /** 用户账号维度限流：单个时间窗口内最大请求次数 */
  RATE_LIMIT_USER_MAX: string;
  /** 限流时间窗口，单位：秒 */
  RATE_LIMIT_WINDOW_SEC: string;

  /** 智谱AI 接口密钥 */
  ZHIPU_API_KEY: string;
  /** 智谱AI 接口请求地址 */
  ZHIPU_BASE_URL: string;
  /** 智谱AI 使用的模型名称 */
  ZHIPU_MODEL: string;

  /** 后端服务公网基础地址，用于拼接回调、分享链接、邮件跳转地址 */
  APP_BASE_URL: string;

  /** Resend 邮件发送服务密钥 */
  RESEND_API_KEY: string;
  /** 邮件发送人邮箱地址 */
  EMAIL_FROM: string;

  /** PostgreSQL 数据库 Hyperdrive 连接绑定 */
  HYPER_PG: Hyperdrive;
  /** MySQL 数据库 Hyperdrive 连接绑定 */
  HYPER_MYSQL: Hyperdrive;

  /** 项目缓存KV命名空间：用于限流、验证码、临时缓存，Redis不可用时自动降级 */
  NOTE_KV: KVNamespace;
};