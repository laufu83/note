import { Redis } from '@upstash/redis'
import { Knex } from 'knex'
import { snakeToCamel } from './naming'
import { REDIS_GLOBAL_CONFIG_KEY, ConfigCacheItem, ConfigType, SysConfig } from '../types/system'

/**
 * 全量加载数据库配置写入 Redis
 */
export async function loadAllConfigToCache(knex: Knex, redis: Redis): Promise<ConfigCacheItem[]> {
  const rows = await knex('sys_config').select('config_key', 'config_value', 'config_type')
  const cacheList: ConfigCacheItem[] = rows.map(row => ({
    config_key: row.config_key,
    config_value: row.config_value,
    config_type: row.config_type
  }))
  await redis.set(REDIS_GLOBAL_CONFIG_KEY, JSON.stringify(cacheList))
  return cacheList
}

/**
 * 获取配置 Map（优先 Redis 缓存，未命中查库）
 */
export async function getConfigMap(knex: Knex, redis: Redis): Promise<Map<string, { value: string; type: ConfigType }>> {
  const cacheStr = await redis.get<string>(REDIS_GLOBAL_CONFIG_KEY)
  let list: ConfigCacheItem[]
  if (!cacheStr) {
    list = await loadAllConfigToCache(knex, redis)
  } else {
    list = JSON.parse(cacheStr)
  }
  const map = new Map<string, { value: string; type: ConfigType }>()
  list.forEach(item => map.set(item.config_key, { value: item.config_value, type: item.config_type }))
  return map
}

/**
 * 通用根据 Key 获取配置，自动类型转换 + 默认值兜底
 */
export async function getConfigValue<T>(
  knex: Knex,
  redis: Redis,
  configKey: string,
  defaultValue: T
): Promise<T> {
  const map = await getConfigMap(knex, redis)
  const item = map.get(configKey)
  if (!item) return defaultValue
  switch (item.type) {
    case 'bool':
      return (item.value === 'true') as unknown as T
    case 'int':
      return Number(item.value) as unknown as T
    case 'json':
      return JSON.parse(item.value) as T
    default:
      return item.value as unknown as T
  }
}

/**
 * 新增配置字典项
 */
export async function addSysConfig(
  knex: Knex,
  redis: Redis,
  data: {
    configKey: string
    configValue: string
    configDesc: string
    configType: ConfigType
  }
) {
  const now = knex.fn.now(6)
  await knex('sys_config').insert({
    config_key: data.configKey,
    config_value: data.configValue,
    config_desc: data.configDesc,
    config_type: data.configType,
    created_at: now,
    updated_at: now
  })
  // 新增后清空缓存
  await redis.del(REDIS_GLOBAL_CONFIG_KEY)
}

/**
 * 根据key删除配置项
 */
export async function deleteSysConfig(knex: Knex, redis: Redis, configKey: string) {
  await knex('sys_config').where('config_key', configKey).del()
  await redis.del(REDIS_GLOBAL_CONFIG_KEY)
}

/**
 * 查询完整配置字典列表（后台管理）
 */
export async function getSysConfigList(knex: Knex): Promise<SysConfig[]> {
  const rows = await knex('sys_config').orderBy('id', 'asc')
  return rows.map(row => snakeToCamel(row))
}

/**
 * 批量更新配置：Knex事务 + 删除Redis缓存实现数据同步
 */
export async function batchUpdateConfig(
  knex: Knex,
  redis: Redis,
  updateList: Array<{ configKey: string; configValue: string; configType: ConfigType }>
) {
  const now = knex.fn.now(6)
  await knex.transaction(async trx => {
    for (const item of updateList) {
      await trx('sys_config')
        .where('config_key', item.configKey)
        .update({
          config_value: item.configValue,
          config_type: item.configType,
          updated_at: now
        })
    }
  })
  await redis.del(REDIS_GLOBAL_CONFIG_KEY)
}

/**
 * 分页获取配置字典
 */
export async function getSysConfigPageList(
  knex: Knex,
  page: number,
  pageSize: number
) {
  const offset = (page - 1) * pageSize
  // 分页数据
  const rows = await knex('sys_config')
    .orderBy('id', 'asc')
    .limit(pageSize)
    .offset(offset)

  // 总条数
  const total = await knex('sys_config').count('* as total').first()

  return {
    list: rows.map(row => snakeToCamel(row)),
    total: Number(total?.total ?? 0),
    page,
    pageSize
  }
}