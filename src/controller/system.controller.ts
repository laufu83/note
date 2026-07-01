import { createKnex } from '../config/knex'
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
    const knex = createKnex(env)
    const redis = createRedis(env)

    const cacheStr = await redis.get<string>(REDIS_GLOBAL_CONFIG_KEY)
    let list: ConfigCacheItem[]

    if (!cacheStr) {
      // 只查询未删除配置
      list = await knex('sys_config')
        .where({ is_deleted: 0 })
        .select('config_key', 'config_value', 'config_type')
      await redis.set(REDIS_GLOBAL_CONFIG_KEY, JSON.stringify(list))
    } else {
      list = JSON.parse(cacheStr)
    }

    const configMap = new Map<string, { value: string; type: ConfigType }>()
    list.forEach(item => configMap.set(item.config_key, {
      value: item.config_value,
      type: item.config_type
    }))

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
    const knex = createKnex(env)
    const redis = createRedis(env)

    const cacheStr = await redis.get<string>(REDIS_GLOBAL_CONFIG_KEY)
    let list: ConfigCacheItem[]
    if (!cacheStr) {
      list = await knex('sys_config')
        .where({ is_deleted: 0 })
        .select('config_key', 'config_value', 'config_type')
      await redis.set(REDIS_GLOBAL_CONFIG_KEY, JSON.stringify(list))
    } else {
      list = JSON.parse(cacheStr)
    }

    const configMap = new Map<string, { value: string; type: ConfigType }>()
    list.forEach(item => configMap.set(item.config_key, { value: item.config_value, type: item.config_type }))

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

    const knex = createKnex(env)
    // 只查询未删除配置
    const list = await knex('sys_config')
      .where({ is_deleted: 0 })
      .orderBy('id', 'asc')
    return jsonResp(list, CODE.SUCCESS)
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

    const knex = createKnex(env)
    const totalRow = await knex('sys_config')
      .where({ is_deleted: 0 })
      .count('* as total')
      .first()
    const total = Number(totalRow?.total ?? 0)

    const list = await knex('sys_config')
      .where({ is_deleted: 0 })
      .orderBy('id', 'asc')
      .limit(size)
      .offset(offset)

    return jsonResp({
      list,
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

    const knex = createKnex(env)
    const redis = createRedis(env)

    // 新增不再手动传入 created_at、updated_at，数据库默认填充，带上软删除默认值
    await knex('sys_config').insert({
      config_key: body.config_key,
      config_value: body.config_value,
      config_desc: body.config_desc,
      config_type: body.config_type,
      is_deleted: 0
    })
    // 清空缓存
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

    const knex = createKnex(env)
    const redis = createRedis(env)
 

    await knex.transaction(async (trx) => {
      for (const item of updateList) {
        await trx('sys_config')
          .where({ config_key: item.config_key, is_deleted: 0 })
          .update({
            config_value: item.config_value,
            config_type: item.config_type,
            updated_at: knex.fn.now()
          })
      }
    })

    await redis.del(REDIS_GLOBAL_CONFIG_KEY)
    return jsonResp(null, CODE.SUCCESS, '配置更新成功，缓存已刷新')
  }

  /**
   * 管理员：删除配置项（逻辑删除）
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

    const knex = createKnex(env)
    const redis = createRedis(env)


    // 逻辑删除，不再物理删除
    await knex('sys_config')
      .where({ config_key, is_deleted: 0 })
      .update({
        is_deleted: 1,
        updated_at: knex.fn.now()
      })
    await redis.del(REDIS_GLOBAL_CONFIG_KEY)

    return jsonResp(null, CODE.SUCCESS, '删除成功')
  }
}