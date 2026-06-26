import { corsHeaders } from "../utils/cors";
import type { UserJWTPayload } from "../types/model";

export function requireAdmin(payload: UserJWTPayload): Response | null {
  // payload 一定存在 uid，再判断角色
  if (!payload || payload.role !== "admin") {
    return new Response(
      JSON.stringify({
        code: 403,
        msg: "权限不足，仅系统管理员可访问"
      }),
      {
        status: 403,
        headers: { ...corsHeaders }
      }
    );
  }
  return null;
}