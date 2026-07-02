// src/index.ts 或 src/app.ts

import { UserController } from "../controller/user.controller";
import { AuthController } from "../controller/auth.controller";
import { NoteController } from "../controller/note.controller";
import { CategoryController } from "../controller/category.controller";
import { TagController } from "../controller/tag.controller";
import { FileController } from "../controller/file.controller";
import { ShareController } from "../controller/share.controller";
import { AIController } from "../controller/ai.controller";
import { HistoryController } from "../controller/history.controller";
import { authMiddleware } from "../middleware/middleware";
import { rateLimitCheck } from "../utils/rate-limit";
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
import type { Env } from "../types/env";
import type { UserJWTPayload } from "../types/model";
import { CaptchaController } from "../controller/captcha.controller";
import { ConfigController } from "../controller/config.controller";

// ============================================
// 类型定义
// ============================================

/**
 * HTTP 请求方法
 */
type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/**
 * 路由规则定义
 */
type RouteRule = {
  /** 路由路径，支持字符串或正则表达式 */
  path: string | RegExp;
  /** HTTP 方法 */
  method: HttpMethod;
  /** 是否为公开路由（无需登录） */
  isPublic: boolean;
  /** 是否需要管理员权限 */
  requireAdmin?: boolean;
  /** 路由描述 */
  desc?: string;
  /** 路由处理器函数 */
  handler: (
    env: Env,
    payload: UserJWTPayload | null,
    body?: any,
    search?: URLSearchParams,
    pathParam?: string,
  ) => Promise<Response>;
};

/**
 * 路由匹配结果
 */
type RouteMatchResult = {
  matched: RouteRule | null;
  pathParam: string | undefined;
  /** 是否存在相同路径的其他方法 */
  hasOtherMethod: boolean;
};

// ============================================
// 路由定义
// ============================================

/**
 * 路由列表
 * 按功能模块分组组织，便于维护
 */
const routeList: RouteRule[] = [
  // ==========================================
  // 1. 认证模块 (Auth)
  // ==========================================
  {
    path: "/api/user/register",
    method: "POST",
    isPublic: true,
    desc: "用户注册",
    handler: async (e, _, b) => AuthController.register(e, b),
  },
  {
    path: "/api/user/login",
    method: "POST",
    isPublic: true,
    desc: "用户登录",
    handler: async (e, _, b) => AuthController.login(e, b),
  },
  {
    path: "/api/user/refresh-token",
    method: "POST",
    isPublic: true,
    desc: "刷新令牌",
    handler: async (e, _, b) => AuthController.refreshToken(e, b),
  },
  {
    path: "/api/user/activate",
    method: "GET",
    isPublic: true,
    desc: "邮箱激活账号",
    handler: (e, _, __, s) => AuthController.activateUser(e, s?.get("token")),
  },
  {
    path: "/api/user/reset-pwd-send",
    method: "POST",
    isPublic: true,
    desc: "发送重置密码邮件",
    handler: (e, _, b) => AuthController.resetPwdSend(e, b),
  },
  {
    path: "/api/user/reset-pwd",
    method: "POST",
    isPublic: true,
    desc: "重置密码",
    handler: (e, _, b) => AuthController.resetPwd(e, b),
  },
  {
    path: "/api/user/resend-activate",
    method: "POST",
    isPublic: true,
    desc: "重发激活邮件",
    handler: (e, _, b) => AuthController.resendActivateMail(e, b),
  },
  {
    path: "/api/user/change-email",
    method: "GET",
    isPublic: true,
    desc: "邮箱更换激活",
    handler: async (e, _, __, s) => AuthController.activateChangeEmail(e, s),
  },

  // ==========================================
  // 2. 用户模块 (User)
  // ==========================================
  {
    path: "/api/user/info",
    method: "GET",
    isPublic: false,
    desc: "获取当前用户信息",
    handler: async (e, payload) =>
      UserController.getCurrentUserInfo(e, payload!.uid),
  },
  {
    path: "/api/user/list",
    method: "GET",
    isPublic: false,
    requireAdmin: true,
    desc: "管理员获取用户列表",
    handler: async (e, _p, _b, s) =>
      UserController.getUserList(e,  s),
  },
  {
    path: "/api/user/update",
    method: "POST",
    isPublic: false,
    desc: "管理员更新用户信息",
    handler: async (e, _, b) =>
      UserController.updateUserInfo(e, b),
  },
  {
    path: "/api/user/profile",
    method: "POST",
    isPublic: false,
    desc: "更新用户资料",
    handler: async (e, payload, b) =>
      UserController.updateProfile(e, payload!.uid, b),
  },
  {
    path: "/api/user/change-pwd",
    method: "POST",
    isPublic: false,
    desc: "修改密码",
    handler: async (e, payload, b) =>
      UserController.changePwd(e, payload!.uid, b),
  },
  {
    path: "/api/user/admin-reset-pwd",
    method: "POST",
    isPublic: false,
    requireAdmin: true,
    desc: "管理员重置用户密码",
    handler: async (e, _, b) =>
      UserController.adminResetUserPwd(e,  b),
  },
  {
    path: "/api/user/destroy",
    method: "DELETE",
    isPublic: false,
    desc: "注销账号",
    handler: async (e, payload) =>
      UserController.destroyAccount(e, payload!.uid),
  },

  // ==========================================
  // 3. 笔记模块 (Note)
  // ==========================================
  {
    path: "/api/note",
    method: "POST",
    isPublic: false,
    desc: "创建笔记",
    handler: async (e, payload, b) => NoteController.create(e, payload!.uid, b),
  },
  {
    path: "/api/note",
    method: "GET",
    isPublic: false,
    desc: "笔记列表",
    handler: async (e, payload, _, s) =>
      NoteController.list(e, payload!.uid, s!),
  },
  {
    path: /^\/api\/note\/(\d+)$/,
    method: "GET",
    isPublic: false,
    desc: "笔记详情",
    handler: async (e, payload, _b, s, p) =>
      NoteController.detail(e, payload!.uid, p!, s),
  },
  {
    path: /^\/api\/note\/(\d+)$/,
    method: "PUT",
    isPublic: false,
    desc: "更新笔记",
    handler: async (e, payload, b, _, p) =>
      NoteController.update(e, payload!.uid, p!, b),
  },
  {
    path: /^\/api\/note\/(\d+)$/,
    method: "DELETE",
    isPublic: false,
    desc: "移入回收站",
    handler: async (e, payload, _, __, p) =>
      NoteController.moveRecycle(e, payload!.uid, p!),
  },
  {
    path: /^\/api\/note\/(\d+)\/restore$/,
    method: "PUT",
    isPublic: false,
    desc: "恢复笔记",
    handler: async (e, payload, _, __, p) =>
      NoteController.restore(e, payload!.uid, p!),
  },
  {
    path: /^\/api\/note\/(\d+)\/destroy$/,
    method: "DELETE",
    isPublic: false,
    desc: "永久删除笔记",
    handler: async (e, payload, _, __, p) =>
      NoteController.permanentDelete(e, payload!.uid, p!),
  },
  {
    path: "/api/note/trash/clear",
    method: "DELETE",
    isPublic: false,
    desc: "清空回收站",
    handler: async (e, payload) => NoteController.clearTrash(e, payload!.uid),
  },
  {
    path: "/api/note/rollback",
    method: "POST",
    isPublic: false,
    desc: "版本回滚",
    handler: async (e, payload, b) =>
      NoteController.rollback(e, payload!.uid, b.noteId, b.historyId),
  },
  {
    path: "/api/note/export",
    method: "GET",
    isPublic: false,
    desc: "导出笔记",
    handler: async (e, payload, _b, s) =>
      NoteController.exportAllNote(e, payload!.uid, s!),
  },

  // ==========================================
  // 4. 分类模块 (Category)
  // ==========================================
  {
    path: "/api/category",
    method: "POST",
    isPublic: false,
    desc: "创建分类",
    handler: async (e, payload, b) =>
      CategoryController.create(e, payload!.uid, b),
  },
  {
    path: "/api/category",
    method: "GET",
    isPublic: false,
    desc: "分类列表",
    handler: async (e, payload) => CategoryController.list(e, payload!.uid),
  },
  {
    path: /^\/api\/category\/(\d+)$/,
    method: "PUT",
    isPublic: false,
    desc: "更新分类",
    handler: async (e, payload, b, _, p) =>
      CategoryController.update(e, payload!.uid, p!, b),
  },
  {
    path: /^\/api\/category\/(\d+)$/,
    method: "DELETE",
    isPublic: false,
    desc: "删除分类",
    handler: async (e, payload, _, __, p) =>
      CategoryController.del(e, payload!.uid, p!),
  },

  // ==========================================
  // 5. 标签模块 (Tag)
  // ==========================================
  {
    path: "/api/tag",
    method: "POST",
    isPublic: false,
    desc: "创建标签",
    handler: async (e, payload, b) => TagController.create(e, payload!.uid, b),
  },
  {
    path: "/api/tag",
    method: "GET",
    isPublic: false,
    desc: "标签列表",
    handler: async (e, payload) => TagController.list(e, payload!.uid),
  },
  {
    path: /^\/api\/tag\/(\d+)$/,
    method: "DELETE",
    isPublic: false,
    desc: "删除标签",
    handler: async (e, payload, _, __, p) =>
      TagController.del(e, payload!.uid, p!),
  },

  // ==========================================
  // 6. 文件模块 (File)
  // ==========================================
  {
    path: "/api/file/upload",
    method: "POST",
    isPublic: false,
    desc: "文件上传",
    handler: async (e, payload, b) =>
      FileController.upload(e, payload!.uid, b.file),
  },
  {
    path: "/api/file",
    method: "GET",
    isPublic: false,
    desc: "文件列表",
    handler: async (e, payload, _b, s) =>
      FileController.list(e, payload!.uid, s!),
  },
  {
    path: "/api/file/delete",
    method: "POST",
    isPublic: false,
    desc: "删除文件",
    handler: async (e, payload, b) =>
      FileController.delete(e, payload!.uid, b.path),
  },

  // ==========================================
  // 7. 分享模块 (Share)
  // ==========================================
  {
    path: "/api/share/create",
    method: "POST",
    isPublic: false,
    desc: "创建分享",
    handler: async (e, payload, b) =>
      ShareController.create(e, payload!.uid, b),
  },
  {
    path: "/api/share/list",
    method: "GET",
    isPublic: false,
    desc: "分享列表",
    handler: async (e, payload) => ShareController.myShareList(e, payload!.uid),
  },
  {
    path: /^\/api\/share\/(\d+)$/,
    method: "DELETE",
    isPublic: false,
    desc: "删除分享",
    handler: async (e, payload, _, __, p) =>
      ShareController.deleteShare(e, payload!.uid, p!),
  },
  {
    path: /^\/api\/share\/([\da-fA-F]{16,32})$/,
    method: "GET",
    isPublic: true,
    desc: "公开访问分享",
    handler: async (e, _, __, s, p) =>
      ShareController.getPublicShare(e, p!, s?.get("pwd")),
  },

  // ==========================================
  // 8. 验证码模块 (Captcha)
  // ==========================================
  {
    path: "/api/captcha/img",
    method: "GET",
    isPublic: true,
    desc: "获取验证码",
    handler: async (env) => CaptchaController.getImageCaptcha(env),
  },
  {
    path: "/api/captcha/verify",
    method: "POST",
    isPublic: true,
    desc: "校验验证码",
    handler: async (env, _, body) => {
      const { key, code } = body;
      return CaptchaController.verifyImageCaptcha(env, key, code);
    },
  },

  // ==========================================
  // 9. AI 模块 (AI)
  // ==========================================
  {
    path: "/api/ai/chat",
    method: "POST",
    isPublic: true,
    desc: "AI对话",
    handler: async (e, _, b) => AIController.chat(e, b),
  },
  {
    path: "/api/ai/summarize",
    method: "POST",
    isPublic: true,
    desc: "AI总结",
    handler: async (e, _, b) => AIController.summarize(e, b),
  },
  {
    path: "/api/ai/polish",
    method: "POST",
    isPublic: true,
    desc: "AI润色",
    handler: async (e, _, b) => AIController.polish(e, b),
  },
  {
    path: "/api/ai/continue",
    method: "POST",
    isPublic: true,
    desc: "AI续写",
    handler: async (e, _, b) => AIController.continueWrite(e, b),
  },
  {
    path: "/api/ai/translate",
    method: "POST",
    isPublic: true,
    desc: "AI翻译",
    handler: async (e, _, b) => AIController.translate(e, b),
  },
  {
    path: "/api/ai/batch",
    method: "POST",
    isPublic: true,
    desc: "AI批量处理",
    handler: async (e, _, b) => AIController.batchProcess(e, b),
  },
  {
    path: "/api/ai/clear-cache",
    method: "POST",
    isPublic: false,
    requireAdmin: true,
    desc: "清空AI缓存",
    handler: async () => AIController.clearCache(),
  },
  {
    path: "/api/ai/status",
    method: "GET",
    isPublic: true,
    desc: "AI状态",
    handler: async () => AIController.getStatus(),
  },

  // ==========================================
  // 10. 历史版本模块 (History)
  // ==========================================
  {
    path: /^\/api\/note\/(\d+)\/history$/,
    method: "GET",
    isPublic: false,
    desc: "获取历史版本",
    handler: async (e, payload, _, __, p) =>
      HistoryController.getNoteHistory(e, payload!.uid, p!),
  },
  {
    path: /^\/api\/note\/history\/(\d+)$/,
    method: "DELETE",
    isPublic: false,
    desc: "删除历史记录",
    handler: async (e, payload, _, __, p) =>
      HistoryController.deleteHistory(e, payload!.uid, p!),
  },

  // ==========================================
  // 11. 系统配置模块 (Config)
  // ==========================================
  {
    path: "/api/system/config",
    method: "GET",
    isPublic: true,
    desc: "获取公开配置",
    handler: (env) => ConfigController.getPublicConfig(env),
  },
  {
    path: "/api/system/config/list",
    method: "GET",
    isPublic: false,
    requireAdmin: true,
    desc: "获取全部配置",
    handler: (env) =>
      ConfigController.getConfigList(env),
  },
  {
    path: "/api/system/config/page",
    method: "GET",
    isPublic: false,
    requireAdmin: true,
    desc: "配置分页列表",
    handler: (env, _p, _b, search) =>
      ConfigController.getConfigPageList(env,  search),
  },
  {
    path: "/api/system/config/batch",
    method: "PUT",
    isPublic: false,
    requireAdmin: true,
    desc: "批量更新配置",
    handler: (env, _p, body) =>
      ConfigController.batchUpdateSystemConfig(env, body),
  },
  {
    path: "/api/system/config/add",
    method: "POST",
    isPublic: false,
    requireAdmin: true,
    desc: "新增配置项",
    handler: (env, _p, body) =>
      ConfigController.addConfigItem(env, body),
  },
  {
    path: "/api/system/config/delete",
    method: "DELETE",
    isPublic: false,
    requireAdmin: true,
    desc: "删除配置项",
    handler: (env, _p, _b, search) =>
      ConfigController.deleteConfigItem(env, search),
  },
];

// ============================================
// 辅助函数
// ============================================

/**
 * 解析请求体
 * 支持 JSON、FormData、URLEncoded 三种格式
 */
async function parseRequestBody(req: Request): Promise<any> {
  const contentType = req.headers.get("content-type") || "";
  
  // 处理 FormData (文件上传)
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const data: Record<string, any> = {};
    for (const [key, value] of form.entries()) {
      // 如果同一个 key 有多个值，收集为数组
      if (key in data) {
        if (Array.isArray(data[key])) {
          data[key].push(value);
        } else {
          data[key] = [data[key], value];
        }
      } else {
        data[key] = value;
      }
    }
    return data;
  }
  
  // 处理 JSON
  if (contentType.includes("application/json")) {
    try {
      return await req.json();
    } catch {
      return undefined;
    }
  }

  // 处理 application/x-www-form-urlencoded
  if (contentType.includes("application/x-www-form-urlencoded")) {
    try {
      const text = await req.text();
      const params = new URLSearchParams(text);
      const data: Record<string, any> = {};
      for (const [key, value] of params.entries()) {
        // 处理重复字段
        if (key in data) {
          if (Array.isArray(data[key])) {
            data[key].push(value);
          } else {
            data[key] = [data[key], value];
          }
        } else {
          data[key] = value;
        }
      }
      return data;
    } catch {
      return undefined;
    }
  }
  
  // 处理纯文本
  if (contentType.includes("text/plain")) {
    try {
      return await req.text();
    } catch {
      return undefined;
    }
  }
  
  return undefined;
}

/**
 * 匹配路由
 * 支持字符串精确匹配和正则表达式匹配
 * 同时检测是否有其他方法支持同一路径
 */
function matchRoute(
  path: string,
  method: HttpMethod
): RouteMatchResult {
  let matched: RouteRule | null = null;
  let pathParam: string | undefined = undefined;
  let hasOtherMethod = false;
  
  // 先匹配正则路由
  for (const route of routeList) {
    if (typeof route.path === "string") continue;
    
    const match = path.match(route.path);
    if (!match) continue;
    
    if (route.method === method) {
      matched = route;
      pathParam = match[1];
    } else {
      hasOtherMethod = true;
    }
  }
  
  // 如果已经匹配到正则路由，直接返回
  if (matched) {
    return { matched, pathParam, hasOtherMethod };
  }
  
  // 再匹配字符串精确路由
  for (const route of routeList) {
    if (typeof route.path !== "string") continue;
    
    if (route.path === path) {
      if (route.method === method) {
        matched = route;
        pathParam = undefined;
      } else {
        hasOtherMethod = true;
      }
    }
  }
  
  return { matched, pathParam, hasOtherMethod };
}

// ============================================
// 主请求分发器
// ============================================

/**
 * 请求分发器
 * 处理所有 HTTP 请求，进行路由匹配、权限验证和限流
 * 
 * @param req - HTTP 请求对象
 * @param env - 环境变量配置
 * @returns HTTP 响应
 */
export async function dispatch(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method as HttpMethod;
  const search = url.searchParams;

  // ==========================================
  // 1. 全局限流检查（基于 IP）
  // ==========================================
  const globalLimitRes = await rateLimitCheck(req, null, env);
  if (globalLimitRes) return globalLimitRes;

  // ==========================================
  // 2. 路由匹配
  // ==========================================
  const { matched, pathParam, hasOtherMethod } = matchRoute(path, method);
  
  if (!matched) {
    // 检查是否请求方法不支持（405）
    if (hasOtherMethod) {
      return jsonResp(null, CODE.METHOD_NOT_ALLOWED, "请求方法不支持");
    }
    return jsonResp(null, CODE.NOT_FOUND, "接口不存在");
  }

  // ==========================================
  // 3. 解析请求体（POST/PUT/PATCH 方法）
  // ==========================================
  let body: any;
  if (["POST", "PUT", "PATCH"].includes(method)) {
    body = await parseRequestBody(req);
  }

  // ==========================================
  // 4. 公开路由处理（无需登录）
  // ==========================================
  if (matched.isPublic) {
    return await matched.handler(env, null, body, search, pathParam);
  }

  // ==========================================
  // 5. 私有路由鉴权
  // ==========================================
  const { error, payload } = await authMiddleware(req, env);
  
  // 鉴权失败
  if (error) return error;
  if (!payload) {
    return jsonResp(null, CODE.UNAUTH, "身份验证失败，请重新登录");
  }
  
  // 管理员权限检查
  if (matched.requireAdmin && payload.role !== 'admin') {
    return jsonResp(null, CODE.FORBIDDEN, "权限不足，仅管理员可执行该操作");
  }

  // ==========================================
  // 6. 用户级限流检查（基于用户 ID）
  // ==========================================
  const userLimitRes = await rateLimitCheck(req, payload.uid, env);
  if (userLimitRes) return userLimitRes;

  // ==========================================
  // 7. 执行路由处理器
  // ==========================================
  return await matched.handler(env, payload, body, search, pathParam);
}