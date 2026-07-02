import { Redis } from "@upstash/redis/cloudflare";
import type { Env } from "../types/env";
import type {
  KVNamespace,
  KVNamespacePutOptions,
  KVNamespaceListKey,
} from "@cloudflare/workers-types";

// ============================================
// 类型定义
// ============================================

/**
 * 缓存适配器统一接口
 */
export interface CacheAdapter {
  /** 获取缓存值 */
  get(key: string): Promise<string | null>;
  /** 设置缓存值（带过期时间，单位：秒） */
  set(key: string, value: string, ttl?: number): Promise<void>;
  /** 删除缓存 */
  del(key: string): Promise<void>;
  /** 检查键是否存在 */
  exists(key: string): Promise<boolean>;
  /** 设置过期时间（单位：秒） */
  expire(key: string, ttl: number): Promise<void>;
  /** 批量获取 */
  mget(keys: string[]): Promise<(string | null)[]>;
  /** 批量设置 */
  mset(entries: Record<string, string>, ttl?: number): Promise<void>;
  /** 原子自增 */
  incr(key: string): Promise<number>;
  /** 清空全部缓存 */
  flushAll?(): Promise<void>;

  // 滑动窗口限流 ZSet 相关接口
  /** 移除有序集合中 score 在 [min, max] 之间的元素 */
  zremrangebyscore(key: string, min: number, max: number): Promise<number>;
  /** 获取有序集合元素总数 */
  zcard(key: string): Promise<number>;
  /** 向有序集合添加元素 */
  zadd(key: string, item: { score: number; member: string }): Promise<number>;
}

/**
 * 缓存全局配置
 */
export interface CacheConfig {
  /** 默认过期时间（秒） */
  defaultTTL?: number;
  /** 是否开启压缩（预留扩展） */
  enableCompression?: boolean;
}

// ============================================
// 全局单例缓存（按环境变量唯一标识缓存实例）
// ============================================
type CacheInstanceKey = string;
const instanceMap = new Map<CacheInstanceKey, CacheAdapter>();

/**
 * 生成环境唯一标识，相同env配置复用同一个缓存实例
 */
function getEnvUniqueKey(env: Env): string {
  return `${env.REDIS_URL ?? ''}_${env.ENVIRONMENT ?? ''}`;
}

// ============================================
// Redis 适配器实现
// ============================================
class RedisAdapter implements CacheAdapter {
  private readonly redis: Redis;

  constructor(env: Env) {
    if (!env.REDIS_URL || !env.REDIS_TOKEN) {
      throw new Error('Redis 配置缺失：需要 REDIS_URL 与 REDIS_TOKEN');
    }
    this.redis = new Redis({
      url: env.REDIS_URL,
      token: env.REDIS_TOKEN,
    });
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get<string>(key);
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl) {
      await this.redis.set(key, value, { ex: ttl });
    } else {
      await this.redis.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const cnt = await this.redis.exists(key);
    return cnt === 1;
  }

  async expire(key: string, ttl: number): Promise<void> {
    await this.redis.expire(key, ttl);
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    return this.redis.mget<string[]>(...keys);
  }

  async mset(entries: Record<string, string>, ttl?: number): Promise<void> {
    const entryList = Object.entries(entries);
    if (entryList.length === 0) return;

    if (ttl) {
      const pipeline = this.redis.pipeline();
      for (const [k, v] of entryList) {
        pipeline.set(k, v, { ex: ttl });
      }
      await pipeline.exec();
    } else {
      await this.redis.mset(entries);
    }
  }

  async incr(key: string): Promise<number> {
    return this.redis.incr(key);
  }

  async flushAll(): Promise<void> {
    await this.redis.flushall();
  }

  // ZSet 限流方法
  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    return this.redis.zremrangebyscore(key, min, max);
  }

  async zcard(key: string): Promise<number> {
    return this.redis.zcard(key);
  }

  async zadd(key: string, item: { score: number; member: string }): Promise<number> {
    const res = await this.redis.zadd(key, { score: item.score, member: item.member });
    return res ?? 0;
  }
}

/**
 * 内存缓存适配器（仅开发环境兜底，全局单例，定时器只初始化一次）
 */
class MemoryAdapter implements CacheAdapter {
  // 全局静态存储，全局唯一
  private static globalStore = new Map<string, { value: string; expire: number }>();
  private static globalZsetStore = new Map<string, number[]>();
  private static timerRegistered = false;
  private readonly defaultTTL: number;

  constructor(config?: CacheConfig) {
    this.defaultTTL = config?.defaultTTL ?? 3600;
    // 全局只注册一次过期清理定时器，防止重复创建
    if (!MemoryAdapter.timerRegistered) {
      MemoryAdapter.timerRegistered = true;
      setInterval(() => {
        const now = Date.now();
        for (const [key, item] of MemoryAdapter.globalStore.entries()) {
          if (item.expire > 0 && now > item.expire) {
            MemoryAdapter.globalStore.delete(key);
          }
        }
      }, 10000);
    }
  }

  async get(key: string): Promise<string | null> {
    const item = MemoryAdapter.globalStore.get(key);
    if (!item) return null;
    if (item.expire > 0 && Date.now() > item.expire) {
      MemoryAdapter.globalStore.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    const ttlSec = ttl ?? this.defaultTTL;
    const expire = ttlSec > 0 ? Date.now() + ttlSec * 1000 : 0;
    MemoryAdapter.globalStore.set(key, { value, expire });
  }

  async del(key: string): Promise<void> {
    MemoryAdapter.globalStore.delete(key);
    MemoryAdapter.globalZsetStore.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const v = await this.get(key);
    return v !== null || MemoryAdapter.globalZsetStore.has(key);
  }

  async expire(key: string, ttl: number): Promise<void> {
    const item = MemoryAdapter.globalStore.get(key);
    if (item) {
      item.expire = Date.now() + ttl * 1000;
    }
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    return Promise.all(keys.map(k => this.get(k)));
  }

  async mset(entries: Record<string, string>, ttl?: number): Promise<void> {
    for (const [k, v] of Object.entries(entries)) {
      await this.set(k, v, ttl);
    }
  }

  async incr(key: string): Promise<number> {
    const val = await this.get(key);
    const num = val ? parseInt(val, 10) : 0;
    const next = num + 1;
    await this.set(key, String(next));
    return next;
  }

  async flushAll(): Promise<void> {
    MemoryAdapter.globalStore.clear();
    MemoryAdapter.globalZsetStore.clear();
  }

  // ZSet 方法
  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    const arr = MemoryAdapter.globalZsetStore.get(key) ?? [];
    const remain = arr.filter(ts => !(ts >= min && ts <= max));
    const delCount = arr.length - remain.length;
    MemoryAdapter.globalZsetStore.set(key, remain);
    return delCount;
  }

  async zcard(key: string): Promise<number> {
    return (MemoryAdapter.globalZsetStore.get(key) ?? []).length;
  }

  async zadd(key: string, item: { score: number; member: string }): Promise<number> {
    const arr = MemoryAdapter.globalZsetStore.get(key) ?? [];
    arr.push(item.score);
    MemoryAdapter.globalZsetStore.set(key, arr);
    return 1;
  }
}

// ============================================
// Cloudflare KV 适配器实现
// ============================================
class KVAdapter implements CacheAdapter {
  private readonly kv: KVNamespace;
  private readonly defaultTTL: number;

  constructor(kv: KVNamespace, config?: CacheConfig) {
    this.kv = kv;
    this.defaultTTL = config?.defaultTTL ?? 3600;
  }

  async get(key: string): Promise<string | null> {
    return this.kv.get(key);
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    const ttlSec = ttl ?? this.defaultTTL;
    const opts: KVNamespacePutOptions = {};
    if (ttlSec > 0) {
      opts.expirationTtl = ttlSec;
    }
    await this.kv.put(key, value, opts);
  }

  async del(key: string): Promise<void> {
    await this.kv.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const val = await this.kv.get(key);
    return val !== null;
  }

  async expire(key: string, ttl: number): Promise<void> {
    const val = await this.kv.get(key);
    if (val !== null) {
      await this.kv.put(key, val, { expirationTtl: ttl });
    }
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    return Promise.all(keys.map(k => this.kv.get(k)));
  }

  async mset(entries: Record<string, string>, ttl?: number): Promise<void> {
    const ttlSec = ttl ?? this.defaultTTL;
    const opts: KVNamespacePutOptions = {};
    if (ttlSec > 0) {
      opts.expirationTtl = ttlSec;
    }
    const list = Object.entries(entries);
    await Promise.all(list.map(([k, v]) => this.kv.put(k, v, opts)));
  }

  async incr(key: string): Promise<number> {
    const MAX_RETRY = 3;
    for (let i = 0; i < MAX_RETRY; i++) {
      try {
        const current = await this.kv.get<number>(key, 'json') ?? 0;
        const next = current + 1;
        await this.kv.put(key, JSON.stringify(next), {
          expirationTtl: this.defaultTTL
        });
        return next;
      } catch (err) {
        if (i === MAX_RETRY - 1) throw err;
        await new Promise(r => setTimeout(r, 100 * (i + 1)));
      }
    }
    throw new Error(`自增失败，已重试${MAX_RETRY}次`);
  }

  async flushAll(): Promise<void> {
    let cursor: string | undefined;
    let total = 0;
    const pageSize = 1000;
    while (true) {
      const res = await this.kv.list({ cursor, limit: pageSize });
      for (const item of res.keys) {
        await this.kv.delete(item.name);
        total++;
      }
      if (res.list_complete) break;
      cursor = res.cursor;
    }
    console.log(`[KV] 已清空 ${total} 个缓存键`);
  }

  public getKVInstance(): KVNamespace {
    return this.kv;
  }

  // KV 模拟 ZSet
  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    const raw = await this.get(key);
    if (!raw) return 0;
    const arr: number[] = JSON.parse(raw);
    const remain = arr.filter(ts => !(ts >= min && ts <= max));
    const delCount = arr.length - remain.length;
    await this.set(key, JSON.stringify(remain));
    return delCount;
  }

  async zcard(key: string): Promise<number> {
    const raw = await this.get(key);
    if (!raw) return 0;
    const arr: number[] = JSON.parse(raw);
    return arr.length;
  }

  async zadd(key: string, item: { score: number; member: string }): Promise<number> {
    const raw = await this.get(key);
    const arr: number[] = raw ? JSON.parse(raw) : [];
    arr.push(item.score);
    await this.set(key, JSON.stringify(arr));
    return 1;
  }
}

// ============================================
// 缓存类型枚举
// ============================================
export enum CacheType {
  REDIS = 'redis',
  KV = 'kv',
  AUTO = 'auto',
}

// ============================================
// 缓存工厂函数【全局单例优化 + 修复AUTO判断逻辑】
// ============================================
export function createCache(
  env: Env,
  type: CacheType = CacheType.AUTO,
  config?: CacheConfig
): CacheAdapter {
  const instanceKey = getEnvUniqueKey(env);
  // 命中相同环境直接复用实例
  if (instanceMap.has(instanceKey)) {
    return instanceMap.get(instanceKey)!;
  }

  const hasRedis = !!(env.REDIS_URL && env.REDIS_TOKEN);
  const hasKV = !!env.NOTE_KV;
  const isDev = env.ENVIRONMENT !== 'production';
  let instance: CacheAdapter;

  if (type === CacheType.AUTO) {
    // 优先级：Redis > KV > 开发环境内存兜底
    if (hasRedis) {
      console.log('[Cache] 自动选择 Redis 作为缓存后端');
      instance = new RedisAdapter(env);
    } else if (hasKV) {
      console.log('[Cache] Redis 不可用，自动降级到 KV');
      instance = new KVAdapter(env.NOTE_KV, config);
    } else if (isDev) {
      console.log('[Cache] 开发环境无Redis、无KV，使用内存缓存兜底（重启丢失数据）');
      instance = new MemoryAdapter(config);
    } else {
      throw new Error('未配置任何缓存后端，请配置 Redis 或 NOTE_KV');
    }
  } else if (type === CacheType.REDIS) {
    if (!hasRedis) throw new Error('未配置 Redis 环境变量');
    console.log('[Cache] 强制使用 Redis');
    instance = new RedisAdapter(env);
  } else if (type === CacheType.KV) {
    if (!hasKV) throw new Error('未绑定 NOTE_KV 命名空间');
    console.log('[Cache] 强制使用 KV');
    instance = new KVAdapter(env.NOTE_KV, config);
  } else {
    throw new Error(`不支持的缓存类型：${type}`);
  }

  // 存入全局单例缓存
  instanceMap.set(instanceKey, instance);
  return instance;
}

// ============================================
// 兼容旧版导出
// ============================================
/**
 * @deprecated 推荐使用 createCache 替代
 */
export function createRedis(env: Env): CacheAdapter {
  return createCache(env, CacheType.REDIS);
}

export function createKV(env: Env, config?: CacheConfig): CacheAdapter {
  return createCache(env, CacheType.KV, config);
}

/**
 * 清空所有缓存单例（仅测试环境使用）
 */
export function clearCacheSingleton() {
  instanceMap.clear();
}

// ============================================
// 缓存装饰器
// ============================================
export function cacheDecorator<T extends (...args: any[]) => Promise<unknown>>(
  cache: CacheAdapter,
  ttl: number = 3600,
  keyPrefix: string = ''
) {
  return function (fn: T): T {
    return (async (...args: Parameters<T>) => {
      const keyParts = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      );
      const cacheKey = `${keyPrefix}${keyParts.join(':')}`;

      try {
        const cached = await cache.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch (e) {
        console.warn(`[Cache] 读取缓存异常 key=${cacheKey}`, e);
      }

      const result = await fn(...args);

      try {
        await cache.set(cacheKey, JSON.stringify(result), ttl);
      } catch (e) {
        console.warn(`[Cache] 写入缓存异常 key=${cacheKey}`, e);
      }

      return result;
    }) as T;
  };
}

// ============================================
// 工具函数
// ============================================
export function generateCacheKey(...parts: (string | number)[]): string {
  return parts.map(p => String(p)).join(':');
}

/**
 * 根据前缀批量删除缓存
 */
export async function deleteCacheByPrefix(
  cache: CacheAdapter,
  prefix: string
): Promise<void> {
  if (cache instanceof KVAdapter) {
    const kv = cache.getKVInstance();
    let cursor: string | undefined;
    while (true) {
      const listRes = await kv.list({ prefix, cursor });
      for (const item of listRes.keys) {
        await kv.delete(item.name);
      }
      if (listRes.list_complete) break;
      cursor = listRes.cursor;
    }
    console.log(`[Cache] 已清理前缀 ${prefix} 下所有KV缓存`);
  } else if (cache instanceof RedisAdapter) {
    console.warn('[Cache] Redis 前缀批量删除请自行实现 SCAN + DEL 避免 KEYS 阻塞');
  }
}
