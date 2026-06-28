import type { Hyperdrive } from "@cloudflare/workers-types";

export type Env = {
  DATABASE_URL: string;
  REDIS_URL: string;
  REDIS_TOKEN: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  SUPABASE_STORAGE_BUCKET: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  ACCESS_TOKEN_EXPIRE: string;
  REFRESH_TOKEN_EXPIRE: string;
  BCRYPT_SALT_ROUND: string;
  RATE_LIMIT_IP_MAX: string;
  RATE_LIMIT_USER_MAX: string;
  RATE_LIMIT_WINDOW_SEC: string;
  ZHIPU_API_KEY:string;
  ZHIPU_BASE_URL:string;
  ZHIPU_MODEL :string;
   // 后端服务基础地址
  APP_BASE_URL: string;
   // Resend 邮件配置
  RESEND_API_KEY: string;
  EMAIL_FROM: string;
   // Hyperdrive 绑定
  HYPERDRIVE: Hyperdrive;
};