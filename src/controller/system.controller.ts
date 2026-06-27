import { createPgPool } from '../config/pg'
import { createRedis } from '../config/redis'
import { REDIS_GLOBAL_CONFIG_KEY, ConfigCacheItem, ConfigType } from '../types/system'
import { jsonResp } from "../utils/response";
import { CODE } from "../types/response";
import type { Env } from "../types/env";
import type { UserJWTPayload } from "../types/model";

/**
 * 系统配置控制器
 */
export class SystemConfigController {
  /**
   * 管理员权限统一校验
   */
  private static checkAdminPermission(payload: UserJWTPayload | null) {
    if (!payload || payload.role !== 'admin') {
      return jsonResp(null, CODE.FORBIDDEN, '仅管理员可操作')
    }
    return true
  }

  /**
   * 【公开接口】前端获取解析后的配置键值
   */
  static async getPublicConfig(env: Env) {
    const pool = createPgPool(env)
    const redis = createRedis(env)

    const cacheStr = await redis.get<string>(REDIS_GLOBAL_CONFIG_KEY)
    let list: ConfigCacheItem[]

    if (!cacheStr) {
      const { rows } = await pool.query(`SELECT config_key, config_value, config_type FROM sys_config`)
      list = rows
      await redis.set(REDIS_GLOBAL_CONFIG_KEY, JSON.stringify(list))
    } else {
      list = JSON.parse(cacheStr)
    }

    const configMap = new Map<string, { value: string; type: ConfigType }>()
    list.forEach(item => configMap.set(item.configKey, { value: item.configValue, type: item.configType }))

    const result: Record<string, string | number | boolean | unknown> = {}
    for (const [key, item] of configMap) {
      switch (item.type) {
        case 'bool':
          result[key] = item.value === 'true'
          break
        case 'int':
          result[key] = Number(item.value)
          break
        case 'json':
          result[key] = JSON.parse(item.value)
          break
        default:
          result[key] = item.value
      }
    }
    return jsonResp(result, CODE.SUCCESS)
  }

  /**
   * 通用根据 Key 获取配置，自动类型转换 + 默认值兜底
   */
  static async getConfigValue<T>(
    env: Env,
    configKey: string,
    defaultValue: T
  ): Promise<T> {
    const pool = createPgPool(env)
    const redis = createRedis(env)

    const cacheStr = await redis.get<string>(REDIS_GLOBAL_CONFIG_KEY)
    let list: ConfigCacheItem[]
    if (!cacheStr) {
      const { rows } = await pool.query(`SELECT config_key, config_value, config_type FROM sys_config`)
      list = rows
      await redis.set(REDIS_GLOBAL_CONFIG_KEY, JSON.stringify(list))
    } else {
      list = JSON.parse(cacheStr)
    }

    const configMap = new Map<string, { value: string; type: ConfigType }>()
    list.forEach(item => configMap.set(item.configKey, { value: item.configValue, type: item.configType }))

    const item = configMap.get(configKey)
    if (!item) return defaultValue
    switch (item.type) {
      case 'bool':
        return (item.value === 'true') as unknown as T
      case 'int':
        return Number(item.value) as unknown as T
      case 'json':
        return JSON.parse(item.value) as unknown as T
      default:
        return item.value as unknown as T
    }
  }

  /**
   * 管理员：不分页获取全部配置字典
   */
  static async getConfigList(env: Env, payload: UserJWTPayload | null) {
    const permissionCheck = this.checkAdminPermission(payload)
    if (permissionCheck !== true) return permissionCheck

    const pool = createPgPool(env)
    const { rows } = await pool.query(`SELECT * FROM sys_config ORDER BY id ASC`)
    return jsonResp(rows, CODE.SUCCESS)
  }

  /**
   * 管理员：分页获取配置字典
   */
  static async getConfigPageList(
    env: Env,
    payload: UserJWTPayload | null,
    search: URLSearchParams = new URLSearchParams()
  ) {
    const permissionCheck = this.checkAdminPermission(payload)
    if (permissionCheck !== true) return permissionCheck

    const page = parseInt(search.get('page') || '1')
    const pageSize = parseInt(search.get('pageSize') || '10')
    const current = page > 0 ? page : 1
    const size = pageSize > 0 && pageSize <= 100 ? pageSize : 10
    const offset = (current - 1) * size

    const pool = createPgPool(env)
    const { rows } = await pool.query(`
      SELECT * FROM sys_config
      ORDER BY id ASC
      LIMIT $1 OFFSET $2
    `, [size, offset])

    const totalRes = await pool.query(`SELECT COUNT(*) AS total FROM sys_config`)
    const total = Number(totalRes.rows[0].total)
    return jsonResp({
      list: rows,
      total,
      page: current,
      pageSize: size
    }, CODE.SUCCESS)
  }

  /**
   * 管理员：新增配置项
   */
  static async addConfigItem(
    env: Env,
    payload: UserJWTPayload | null,
    body: {
      config_key: string
      config_value: string
      config_desc: string
      config_type: ConfigType
    }
  ) {
    const permissionCheck = this.checkAdminPermission(payload)
    if (permissionCheck !== true) return permissionCheck

    if (!body.config_key?.trim()) {
      return jsonResp(null, CODE.PARAM_ERR, '配置键不能为空')
    }

    const pool = createPgPool(env)
    const redis = createRedis(env)
    const now = new Date().toISOString()
    await pool.query(
      `INSERT INTO sys_config(config_key, config_value, config_desc, config_type, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [body.config_key, body.config_value, body.config_desc, body.config_type, now, now]
    )
    await redis.del(REDIS_GLOBAL_CONFIG_KEY)
    return jsonResp(null, CODE.SUCCESS, '新增配置成功')
  }

  /**
   * 管理员：批量更新配置
   */
  static async batchUpdateSystemConfig(
    env: Env,
    payload: UserJWTPayload | null,
    updateList: Array<{ config_key: string; config_value: string; config_type: ConfigType }>
  ) {
    const permissionCheck = this.checkAdminPermission(payload)
    if (permissionCheck !== true) return permissionCheck

    const pool = createPgPool(env)
    const redis = createRedis(env)
    const now = new Date().toISOString()

    await pool.query('BEGIN')
    try {
      for (const item of updateList) {
        await pool.query(
          `UPDATE sys_config SET config_value=$1,config_type=$2,updated_at=$3 WHERE config_key=$4`,
          [item.config_value, item.config_type, now, item.config_key]
        )
      }
      await pool.query('COMMIT')
      await redis.del(REDIS_GLOBAL_CONFIG_KEY)
    } catch (err) {
      await pool.query('ROLLBACK')
      throw err
    }

    return jsonResp(null, CODE.SUCCESS, '配置更新成功，缓存已刷新')
  }

  /**
   * 管理员：删除配置项
   */
  static async deleteConfigItem(
    env: Env,
    payload: UserJWTPayload | null,
    search: URLSearchParams = new URLSearchParams()
  ) {
    const permissionCheck = this.checkAdminPermission(payload)
    if (permissionCheck !== true) return permissionCheck

    const config_key = search.get('key')
    if (!config_key) {
      return jsonResp(null, CODE.PARAM_ERR, '配置键不能为空')
    }

    const pool = createPgPool(env)
    const redis = createRedis(env)
    await pool.query(`DELETE FROM sys_config WHERE config_key = $1`, [config_key])
    await redis.del(REDIS_GLOBAL_CONFIG_KEY)

    return jsonResp(null, CODE.SUCCESS, '删除成功')
  }
}