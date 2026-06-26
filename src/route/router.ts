import { UserController } from "../controller/user.controller";
import { NoteController } from "../controller/note.controller";
import { CategoryController } from "../controller/category.controller";
import { TagController } from "../controller/tag.controller";
import { FileController } from "../controller/file.controller";
import { ShareController } from "../controller/share.controller";
import { authMiddleware } from "./middleware";
import { rateLimitCheck } from "../utils/rate-limit";
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
import { snakeToCamel } from "../utils/naming";
import type { Env } from "../types/env";
import type { UserJWTPayload } from "../types/model";
import { getImageCaptcha, verifyImageCaptcha } from '../controller/captcha.controller'

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
    handler: async (e, _, b) => UserController.register(e, b),
  },
  {
    path: "/api/user/login",
    method: "POST",
    isPublic: true,
    handler: async (e, _, b) => UserController.login(e, b),
  },
  {
    path: "/api/user/refresh-token",
    method: "POST",
    isPublic: true,
    handler: async (e, _, b) => UserController.refreshToken(e, b),
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
    handler: (e, _, __, s) => UserController.activateUser(e, s?.get("token")),
  },
  {
    path: "/api/user/change-pwd",
    method: "POST",
    isPublic: false,
    handler: async (e, payload, b) => UserController.changePwd(e, payload!.uid, b),
  },
  {
    path: "/api/user/destroy",
    method: "DELETE",
    isPublic: false,
    handler: async (e, payload) => UserController.destroyAccount(e, payload!.uid),
  },
  {
    path: "/api/user/reset-pwd-send",
    method: "POST",
    isPublic: true,
    handler: (e, _, b) => UserController.resetPwdSend(e, b),
  },
  {
    path: "/api/user/reset-pwd",
    method: "POST",
    isPublic: true,
    handler: (e, _, b) => UserController.resetPwd(e, b),
  },
  {
    path: "/api/user/resend-activate",
    method: "POST",
    isPublic: true,
    handler: (e, _, b) => UserController.resendActivateMail(e, b),
  },
  {
    path: "/api/user/list",
    method: "GET",
    isPublic: false,
    handler: async (e, payload, _b) => UserController.getUserList(e, payload!)
  },
  {
    path: "/api/user/update",
    method: "POST",
    isPublic: false,
    handler: async (e, payload, b) => UserController.updateUserInfo(e, payload!, b)
  },
  {
    path: "/api/user/admin-reset-pwd",
    method: "POST",
    isPublic: false,
    handler: async (e, payload, b) => UserController.adminResetUserPwd(e, payload!, b)
  },
  {
    path: "/api/category",
    method: "POST",
    isPublic: false,
    handler: async (e, payload, b) => CategoryController.create(e, payload!.uid, b),
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
    handler: async (e, payload, b, _, p) => CategoryController.update(e, payload!.uid, p!, b),
  },
  {
    path: /^\/api\/category\/(\d+)$/,
    method: "DELETE",
    isPublic: false,
    handler: async (e, payload, _, __, p) => CategoryController.del(e, payload!.uid, p!),
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
    handler: async (e, payload, _, __, p) => TagController.del(e, payload!.uid, p!),
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
    handler: async (e, payload, _, s) => NoteController.list(e, payload!.uid, s!),
  },
  {
    path: /^\/api\/note\/(\d+)$/,
    method: "GET",
    isPublic: false,
    handler: async (e, payload, _, __, p) => NoteController.detail(e, payload!.uid, p!),
  },
  {
    path: /^\/api\/note\/(\d+)$/,
    method: "PUT",
    isPublic: false,
    handler: async (e, payload, b, _, p) => NoteController.update(e, payload!.uid, p!, b),
  },
  {
    path: /^\/api\/note\/(\d+)$/,
    method: "DELETE",
    isPublic: false,
    handler: async (e, payload, _, __, p) => NoteController.moveRecycle(e, payload!.uid, p!),
  },
  {
    path: /^\/api\/note\/(\d+)\/restore$/,
    method: "PUT",
    isPublic: false,
    handler: async (e, payload, _, __, p) => NoteController.restore(e, payload!.uid, p!),
  },
  {
    path: /^\/api\/note\/(\d+)\/destroy$/,
    method: "DELETE",
    isPublic: false,
    handler: async (e, payload, _, __, p) =>
      NoteController.permanentDelete(e, payload!.uid, p!),
  },
  {
    path: /^\/api\/note\/(\d+)\/history$/,
    method: "GET",
    isPublic: false,
    handler: async (e, payload, _, __, p) => NoteController.getHistory(e, payload!.uid, p!),
  },
  {
    path: "/api/note/rollback",
    method: "POST",
    isPublic: false,
    handler: async (e, payload, b) =>
      NoteController.rollback(e, payload!.uid, b.noteId, b.historyId),
  },
  {
    path: "/api/file/upload",
    method: "POST",
    handler: async (e, payload, b) => FileController.upload(e, payload!.uid, b.file),
    isPublic: false,
  },
  {
    path: "/api/file",
    method: "GET",
    isPublic: false,
    handler: async (e, payload) => FileController.list(e, payload!.uid),
  },
  {
    path: "/api/file/delete",
    method: "POST",
    isPublic: false,
    handler: async (e, payload, b) => FileController.delete(e, payload!.uid, b.path),
  },
  {
    path: "/api/share/create",
    method: "POST",
    isPublic: false,
    handler: async (e, payload, b) => ShareController.create(e, payload!.uid, b),
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
    handler: async (e, payload, _, __, p) => ShareController.deleteShare(e, payload!.uid, p!),
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
    const { key, code } = body
    return verifyImageCaptcha(env, key, code)
  }
}
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
        const rawBody = await req.json();
        body = snakeToCamel(rawBody);
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
  const userLimit = await rateLimitCheck(req, payload?.uid, env);
  if (userLimit) return userLimit;

  return await matched.handler(env, payload!, body, search, pathParam);
}