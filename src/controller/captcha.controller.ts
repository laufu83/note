import { v4 as uuidv4 } from 'uuid'
import { Redis } from '@upstash/redis/cloudflare'
import { createRedis } from '../config/redis'
import { createSvgCaptcha } from '../utils/captcha'
import { jsonResp } from '../utils/response'
import { CODE } from '../types/response'
import type { Env } from '../types/env'

const CAPTCHA_KEY_PREFIX = 'img:captcha:'
const CAPTCHA_EXPIRE = 300

/** 获取图形验证码 */
export async function getImageCaptcha(env: Env) {
  const redis = createRedis(env)
  const { code, svg } = await createSvgCaptcha()
  const key = uuidv4()
  // 存储验证码，忽略大小写
  await redis.set(`${CAPTCHA_KEY_PREFIX}${key}`, code.toUpperCase(), { ex: CAPTCHA_EXPIRE })
  return jsonResp({
    key,
    svg: svg
  })
}

/** 校验图形验证码 */
export async function verifyImageCaptcha(env: Env, key: string, code: string) {
  const redis = createRedis(env)
  const realCode = await redis.get<string>(`${CAPTCHA_KEY_PREFIX}${key}`)
  if (!realCode) {
    return jsonResp(null, CODE.FAIL, '验证码已过期，请刷新')
  }
  // 校验后立即删除，防止重复使用
  await redis.del(`${CAPTCHA_KEY_PREFIX}${key}`)
  if (realCode.toUpperCase() !== code.toUpperCase()) {
    return jsonResp(null, CODE.FAIL, '验证码错误')
  }
  // 下发登录安全凭证
  const token = uuidv4()
  await redis.set(`img:token:${token}`, '1', { ex: CAPTCHA_EXPIRE })
  return jsonResp(token, CODE.SUCCESS, '验证通过')
}