import { Pool } from '@neondatabase/serverless'
import { Redis } from '@upstash/redis'
import { snakeToCamel } from './naming'
import { REDIS_GLOBAL_CONFIG_KEY, ConfigCacheItem, ConfigType, SysConfig } from '../types/system'

/**
 * 全量加载数据库配置写入 Redis
 */
export async function loadAllConfigToCache(pool: Pool, redis: Redis): Promise<ConfigCacheItem[]> {
  const { rows } = await pool.query(`SELECT config_key, config_value, config_type FROM sys_config`)
  const cacheList: ConfigCacheItem[] = rows.map(row => ({
    configKey: row.config_key,
    configValue: row.config_value,
    configType: row.config_type
  }))
  await redis.set(REDIS_GLOBAL_CONFIG_KEY, JSON.stringify(cacheList))
  return cacheList
}

/**
 * 获取配置 Map（优先 Redis 缓存，未命中查库）
 */
export async function getConfigMap(pool: Pool, redis: Redis): Promise<Map<string, { value: string; type: ConfigType }>> {
  const cacheStr = await redis.get<string>(REDIS_GLOBAL_CONFIG_KEY)
  let list: ConfigCacheItem[]
  if (!cacheStr) {
    list = await loadAllConfigToCache(pool, redis)
  } else {
    list = JSON.parse(cacheStr)
  }
  const map = new Map<string, { value: string; type: ConfigType }>()
  list.forEach(item => map.set(item.configKey, { value: item.configValue, type: item.configType }))
  return map
}

/**
 * 通用根据 Key 获取配置，自动类型转换 + 默认值兜底
 */
export async function getConfigValue<T>(
  pool: Pool,
  redis: Redis,
  configKey: string,
  defaultValue: T
): Promise<T> {
  const map = await getConfigMap(pool, redis)
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
  pool: Pool,
  redis: Redis,
  data: {
    configKey: string
    configValue: string
    configDesc: string
    configType: ConfigType
  }
) {
  const now = new Date().toISOString()
  await pool.query(
    `INSERT INTO sys_config(config_key, config_value, config_desc, config_type, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [data.configKey, data.configValue, data.configDesc, data.configType, now, now]
  )
  // 新增后清空缓存
  await redis.del(REDIS_GLOBAL_CONFIG_KEY)
}

/**
 * 根据key删除配置项
 */
export async function deleteSysConfig(pool: Pool, redis: Redis, configKey: string) {
  await pool.query(`DELETE FROM sys_config WHERE config_key = $1`, [configKey])
  await redis.del(REDIS_GLOBAL_CONFIG_KEY)
}
/**
 * 查询完整配置字典列表（后台管理）
 */
export async function getSysConfigList(pool: Pool): Promise<SysConfig[]> {
  const { rows } = await pool.query(`SELECT * FROM sys_config ORDER BY id ASC`)
  return rows.map(row => snakeToCamel(row))
}

/**
 * 批量更新配置：PG事务更新 + 删除Redis缓存实现数据同步
 */
export async function batchUpdateConfig(
  pool: Pool,
  redis: Redis,
  updateList: Array<{ configKey: string; configValue: string; configType: ConfigType }>
) {
  const now = new Date().toISOString()
  await pool.query('BEGIN')
  try {
    for (const item of updateList) {
      await pool.query(
        `UPDATE sys_config SET config_value=$1,config_type=$2,updated_at=$3 WHERE config_key=$4`,
        [item.configValue, item.configType, now, item.configKey]
      )
    }
    await pool.query('COMMIT')
    await redis.del(REDIS_GLOBAL_CONFIG_KEY)
  } catch (err) {
    await pool.query('ROLLBACK')
    throw err
  }
}

/**
 * 分页获取配置字典
 */
export async function getSysConfigPageList(
  pool: Pool,
  page: number,
  pageSize: number
) {
  const offset = (page - 1) * pageSize
  // 分页数据
  const { rows } = await pool.query(`
    SELECT * FROM sys_config
    ORDER BY id ASC
    LIMIT $1 OFFSET $2
  `, [pageSize, offset])

  // 总条数
  const totalRes = await pool.query(`SELECT COUNT(*) AS total FROM sys_config`)
  const total = Number(totalRes.rows[0].total)

  return {
    list: rows.map(row => snakeToCamel(row)),
    total,
    page,
    pageSize
  }
}