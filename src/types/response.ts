export const CODE = {
  SUCCESS: 200,
  FAIL: 500,
  PARAM_ERR: 400,
  UNAUTH: 401,
  SERVER_ERR : 500,
  UNAUTHORIZED :401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMIT: 429,
} as const;

export type CodeType = (typeof CODE)[keyof typeof CODE];

export type Resp<T = unknown> = {
  code: CodeType;
  msg: string;
  data?: T;
};