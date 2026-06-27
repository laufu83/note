// 配置值类型
export type ConfigType = 'bool' | 'int' | 'string' | 'json'

// 数据库配置全字段
export interface SysConfig {
  id: number
  configKey: string
  configValue: string
  configDesc: string
  configType: ConfigType
  createdAt: string
  updatedAt: string
}

// Redis缓存存储精简结构
export type ConfigCacheItem = {
  configKey: string
  configValue: string
  configType: ConfigType
}

// Redis全局缓存Key
export const REDIS_GLOBAL_CONFIG_KEY = 'sys:config:global'