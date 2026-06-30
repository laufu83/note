import { UserController } from "../controller/user.controller";
import { AuthController } from "../controller/auth.controller";
import { NoteController } from "../controller/note.controller";
import { CategoryController } from "../controller/category.controller";
import { TagController } from "../controller/tag.controller";
import { FileController } from "../controller/file.controller";
import { ShareController } from "../controller/share.controller";
import { AIController } from "../controller/ai.controller";
import { NoteHistoryController } from "../controller/noteHistory.controller";
import { authMiddleware } from "./middleware";
import { rateLimitCheck } from "../utils/rate-limit";
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
import { snakeToCamel } from "../utils/naming";
import type { Env } from "../types/env";
import type { UserJWTPayload } from "../types/model";
import {
  getImageCaptcha,
  verifyImageCaptcha,
} from "../controller/captcha.controller";
import { SystemConfigController } from "../controller/system.controller";

type RouteRule = {
  path: string | RegExp;
  method: string;
  isPublic: boolean;
  handler: (
    env: Env,
    payload: UserJWTPayload | null,
    body?: any,
    search?: URLSearchParams,
    pathParam?: string,
  ) => Promise<Response>;
};

const routeList: RouteRule[] = [
  {
    path: "/api/user/register",
    method: "POST",
    isPublic: true,
    handler: async (e, _, b) => AuthController.register(e, b),
  },
  {
    path: "/api/user/login",
    method: "POST",
    isPublic: true,
    handler: async (e, _, b) => AuthController.login(e, b),
  },
  {
    path: "/api/user/refresh-token",
    method: "POST",
    isPublic: true,
    handler: async (e, _, b) => AuthController.refreshToken(e, b),
  },
  {
    path: /^\/api\/share\/([\da-fA-F]{16,32})$/,
    method: "GET",
    isPublic: true,
    handler: async (e, _, __, s, p) =>
      ShareController.getPublicShare(e, p!, s?.get("pwd")),
  },
  {
    path: /^\/api\/user\/activate$/,
    method: "GET",
    isPublic: true,
    handler: (e, _, __, s) => AuthController.activateUser(e, s?.get("token")),
  },
  {
    path: "/api/user/change-pwd",
    method: "POST",
    isPublic: false,
    handler: async (e, payload, b) =>
      UserController.changePwd(e, payload!.uid, b),
  },
  {
    path: "/api/user/destroy",
    method: "DELETE",
    isPublic: false,
    handler: async (e, payload) =>
      UserController.destroyAccount(e, payload!.uid),
  },
  {
    path: "/api/user/reset-pwd-send",
    method: "POST",
    isPublic: true,
    handler: (e, _, b) => AuthController.resetPwdSend(e, b),
  },
  {
    path: "/api/user/reset-pwd",
    method: "POST",
    isPublic: true,
    handler: (e, _, b) => AuthController.resetPwd(e, b),
  },
  {
    path: "/api/user/resend-activate",
    method: "POST",
    isPublic: true,
    handler: (e, _, b) => AuthController.resendActivateMail(e, b),
  },
  {
    path: "/api/user/change-email",
    method: "GET",
    isPublic: true,
    handler: async (e, _, __, s) => AuthController.activateChangeEmail(e, s),
  },
  {
    path: "/api/user/info",
    method: "GET",
    isPublic: false,
    handler: async (e, payload, _b) =>
      UserController.getCurrentUserInfo(e, payload!.uid),
  },
  {
    path: "/api/user/list",
    method: "GET",
    isPublic: false,  
    handler: async (e, payload, _b, s) => UserController.getUserList(e, payload!, s),
  },
  {
    path: "/api/user/update",
    method: "POST",
    isPublic: false,
    handler: async (e, payload, b) =>
      UserController.updateUserInfo(e, payload!, b),
  },
  {
    path: "/api/user/profile",
    method: "POST",
    isPublic: false,
    handler: async (e, payload, b) =>
      UserController.updateProfile(e, payload!.uid, b),
  },
  {
    path: "/api/user/admin-reset-pwd",
    method: "POST",
    isPublic: false,
    handler: async (e, payload, b) =>
      UserController.adminResetUserPwd(e, payload!, b),
  },
  {
    path: "/api/category",
    method: "POST",
    isPublic: false,
    handler: async (e, payload, b) =>
      CategoryController.create(e, payload!.uid, b),
  },
  {
    path: "/api/category",
    method: "GET",
    isPublic: false,
    handler: async (e, payload) => CategoryController.list(e, payload!.uid),
  },
  {
    path: /^\/api\/category\/(\d+)$/,
    method: "PUT",
    isPublic: false,
    handler: async (e, payload, b, _, p) =>
      CategoryController.update(e, payload!.uid, p!, b),
  },
  {
    path: /^\/api\/category\/(\d+)$/,
    method: "DELETE",
    isPublic: false,
    handler: async (e, payload, _, __, p) =>
      CategoryController.del(e, payload!.uid, p!),
  },
  {
    path: "/api/tag",
    method: "POST",
    isPublic: false,
    handler: async (e, payload, b) => TagController.create(e, payload!.uid, b),
  },
  {
    path: "/api/tag",
    method: "GET",
    isPublic: false,
    handler: async (e, payload) => TagController.list(e, payload!.uid),
  },
  {
    path: /^\/api\/tag\/(\d+)$/,
    method: "DELETE",
    isPublic: false,
    handler: async (e, payload, _, __, p) =>
      TagController.del(e, payload!.uid, p!),
  },
  {
    path: "/api/note",
    method: "POST",
    isPublic: false,
    handler: async (e, payload, b) => NoteController.create(e, payload!.uid, b),
  },
  {
    path: "/api/note",
    method: "GET",
    isPublic: false,
    handler: async (e, payload, _, s) =>
      NoteController.list(e, payload!.uid, s!),
  },
  {
    path: /^\/api\/note\/(\d+)$/,
    method: "GET",
    isPublic: false,
    handler: async (e, payload, _b, s, p) =>
      NoteController.detail(e, payload!.uid, p!,s),
  },
  {
    path: /^\/api\/note\/(\d+)$/,
    method: "PUT",
    isPublic: false,
    handler: async (e, payload, b, _, p) =>
      NoteController.update(e, payload!.uid, p!, b),
  },
  {
    path: /^\/api\/note\/(\d+)$/,
    method: "DELETE",
    isPublic: false,
    handler: async (e, payload, _, __, p) =>
      NoteController.moveRecycle(e, payload!.uid, p!),
  },
  {
    path: /^\/api\/note\/(\d+)\/restore$/,
    method: "PUT",
    isPublic: false,
    handler: async (e, payload, _, __, p) =>
      NoteController.restore(e, payload!.uid, p!),
  },
  {
    path: /^\/api\/note\/(\d+)\/destroy$/,
    method: "DELETE",
    isPublic: false,
    handler: async (e, payload, _, __, p) =>
      NoteController.permanentDelete(e, payload!.uid, p!),
  },
  {
    path: "/api/note/trash/clear",
    method: "DELETE",
    isPublic: false,
    handler: async (e, payload) => NoteController.clearTrash(e, payload!.uid),
  },
  {
    path: "/api/note/rollback",
    method: "POST",
    isPublic: false,
    handler: async (e, payload, b) =>
      NoteController.rollback(e, payload!.uid, b.noteId, b.historyId),
  },
  {
    path: "/api/note/export",
    method: "GET",
    isPublic: false,
    handler: async (e, payload, b, s) =>
      NoteController.exportAllNote(e, payload!.uid, s!),
  },

  {
    path: "/api/file/upload",
    method: "POST",
    handler: async (e, payload, b) =>
      FileController.upload(e, payload!.uid, b.file),
    isPublic: false,
  },
  {
    path: "/api/file",
    method: "GET",
    isPublic: false,
    handler: async (e, payload,_b,s) => FileController.list(e, payload!.uid, s!),
  },
  {
    path: "/api/file/delete",
    method: "POST",
    isPublic: false,
    handler: async (e, payload, b) =>
      FileController.delete(e, payload!.uid, b.path),
  },
  {
    path: "/api/share/create",
    method: "POST",
    isPublic: false,
    handler: async (e, payload, b) =>
      ShareController.create(e, payload!.uid, b),
  },
  {
    path: "/api/share/list",
    method: "GET",
    isPublic: false,
    handler: async (e, payload) => ShareController.myShareList(e, payload!.uid),
  },
  {
    path: /^\/api\/share\/(\d+)$/,
    method: "DELETE",
    isPublic: false,
    handler: async (e, payload, _, __, p) =>
      ShareController.deleteShare(e, payload!.uid, p!),
  },
  // ========== 新增滑块验证码公开路由 ==========
  {
    path: "/api/captcha/img",
    method: "GET",
    isPublic: true,
    handler: async (env, _, __, search) => getImageCaptcha(env),
  },
  {
    path: "/api/captcha/verify",
    method: "POST",
    isPublic: true,
    handler: async (env, _, body) => {
      const { key, code } = body;
      return verifyImageCaptcha(env, key, code);
    },
  }, // 系统配置路由
  {
    path: "/api/system/config",
    method: "GET",
    isPublic: true,
    handler: (env) => SystemConfigController.getPublicConfig(env),
  },
  {
    path: "/api/system/config/list",
    method: "GET",
    isPublic: false,
    handler: (env, payload) =>
      SystemConfigController.getConfigList(env, payload),
  },
  {
    path: "/api/system/config/page",
    method: "GET",
    isPublic: false,
    handler: (env, payload, _, search) =>
      SystemConfigController.getConfigPageList(env, payload, search),
  },
  {
    path: "/api/system/config/batch",
    method: "PUT",
    isPublic: false,
    handler: (env, payload, body) =>
      SystemConfigController.batchUpdateSystemConfig(env, payload, body),
  },
  {
    path: "/api/system/config/add",
    method: "POST",
    isPublic: false,
    handler: (env, payload, body) =>
      SystemConfigController.addConfigItem(env, payload, body),
  },
  {
    path: "/api/system/config/delete",
    method: "DELETE",
    isPublic: false,
    handler: (env, payload, _, search) =>
      SystemConfigController.deleteConfigItem(env, payload, search),
  },
  // AI 接口路由
  {
    path: "/api/ai/chat",
    method: "POST",
    isPublic: true,
    handler: async (e, _, b) => AIController.chat(e, b),
  },
  {
    path: "/api/ai/summarize",
    method: "POST",
    isPublic: true,
    handler: async (e, _, b) => AIController.summarize(e, b),
  },
  {
    path: "/api/ai/polish",
    method: "POST",
    isPublic: true,
    handler: async (e, _, b) => AIController.polish(e, b),
  },
  {
    path: "/api/ai/continue",
    method: "POST",
    isPublic: true,
    handler: async (e, _, b) => AIController.continueWrite(e, b),
  },
  {
    path: "/api/ai/translate",
    method: "POST",
    isPublic: true,
    handler: async (e, _, b) => AIController.translate(e, b),
  },

  // 笔记历史版本（正则捕获id）
  {
    path: /^\/api\/note\/(\d+)\/history$/,
    method: "GET",
    isPublic: false,
    handler: async (e, payload, _, __, p) =>
      NoteHistoryController.getNoteHistory(e, payload!.uid, p!),
  },
  {
  path: /^\/api\/note\/history\/(\d+)$/,
  method: "DELETE",
  isPublic: false, // 需要登录鉴权
  handler: async (e, payload, _, __, p) => NoteHistoryController.deleteHistory(e, payload!.uid, p!),
},

];

export async function dispatch(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  const search = url.searchParams;

  const limitRes = await rateLimitCheck(req, null, env);
  if (limitRes) return limitRes;

  let matched: RouteRule | null = null;
  let pathParam: string | undefined;
  for (const route of routeList) {
    if (route.method !== method) continue;
    if (typeof route.path === "string") {
      if (route.path === path) {
        matched = route;
        break;
      }
    } else {
      const match = path.match(route.path);
      if (match) {
        matched = route;
        pathParam = match[1];
        break;
      }
    }
  }
  if (!matched) return jsonResp(null, CODE.NOT_FOUND, "接口不存在");

  let body: any;
  if (["POST", "PUT", "PATCH"].includes(method)) {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      body = { file: form.get("file") };
    } else {
      try {
        body = await req.json();
      } catch {
        body = undefined;
      }
    }
  }

  if (matched.isPublic) {
    return await matched.handler(env, null, body, search, pathParam);
  }

  const { error, payload } = await authMiddleware(req, env);
  if (error) return error;
  if (!payload) return jsonResp(null, CODE.UNAUTH, "身份验证失败");

  const userLimit = await rateLimitCheck(req, payload?.uid, env);
  if (userLimit) return userLimit;  
  return await matched.handler(env,payload!,body, search, pathParam);
}
