import { verifyAccessToken } from "../config/jwt";
import { CODE } from "../types/response";
import { jsonResp } from "../utils/response";
import type { Env } from "../types/env";

export async function authMiddleware(req: Request, env: Env) {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return { error: jsonResp(null, CODE.UNAUTH, "请登录账号"), payload: null };
  }
  const token = auth.slice(7);
  try {
    const payload = await verifyAccessToken(token, env);
    return { error: null, payload };
  } catch {
    return { error: jsonResp(null, CODE.UNAUTH, "登录令牌失效，请重新登录",401), payload: null };
  }
}