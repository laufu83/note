import { SignJWT, jwtVerify } from "jose";
import type { Env } from "../types/env";
import type { UserJWTPayload } from "../types/model";

function getSecret(env: Env, type: "access" | "refresh"): Uint8Array {
  const key = type === "access" ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET;
  return new TextEncoder().encode(key);
}

export async function signAccessToken(uid: number, env: Env) {
  return new SignJWT({ uid })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(env.ACCESS_TOKEN_EXPIRE)
    .sign(getSecret(env, "access"));
}

export async function signRefreshToken(uid: number, env: Env) {
  return new SignJWT({ uid })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(env.REFRESH_TOKEN_EXPIRE)
    .sign(getSecret(env, "refresh"));
}

export async function verifyAccessToken(token: string, env: Env) {
  const { payload } = await jwtVerify(token, getSecret(env, "access"));
  return payload as UserJWTPayload;
}

export async function verifyRefreshToken(token: string, env: Env) {
  const { payload } = await jwtVerify(token, getSecret(env, "refresh"));
  return payload as UserJWTPayload;
}