export const CODE = {
  SUCCESS: 0,
  FAIL: -1,
  PARAM_ERR: 400,
  UNAUTH: 401,
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