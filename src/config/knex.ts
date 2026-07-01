// src/config/knex.ts
import knex from 'knex';
import type { Env } from '../types/env';

const pg = require('pg');
const { Client, Pool } = pg;
const mysql2 = require('mysql2');

export function createKnex(env: Env) {
  const client = env.DB_CLIENT || 'pg';

  if (client === 'pg') {
    if (!env.HYPER_PG) {
      throw new Error('HYPER_PG is not configured');
    }

    const config = {
      client: 'pg',
      connection: {
        connectionString: env.HYPER_PG.connectionString,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
        keepalives: 1,
        keepalives_idle: 60,
      },
      pool: {
        min: 0,
        max: 5,
        idleTimeoutMillis: 10000,
        acquireTimeoutMillis: 30000,
         // 每次新建连接时自动设置东八区
        afterCreate: (conn: any, done: Function) => {
          conn.query("SET TIME ZONE 'Asia/Shanghai'", (err: any) => {
            done(err, conn);
          });
        }
      },
      acquireConnectionTimeout: 30000,
      useNullAsDefault: true,
    };

    const db = knex(config);
    const pgClient = db.client as any;
    pgClient.driver = {
      Client,
      Pool,
      ...pg,
    };

    console.log('PostgreSQL Knex instance created with patched driver');
    return db;
  }

  if (client === 'mysql2') {
    if (!env.HYPER_MYSQL) {
      throw new Error('HYPER_MYSQL is not configured');
    }

    const config = {
      client: 'mysql2',
      connection: {
        host: env.HYPER_MYSQL.host,
        user: env.HYPER_MYSQL.user,
        password: env.HYPER_MYSQL.password,
        port: env.HYPER_MYSQL.port || 3306,
        database: env.HYPER_MYSQL.database,
        disableEval: true,
        charset: 'utf8mb4',
         // 替换原来的对象写法，使用 mysql2 支持的字符串模式
       // ssl: env.DB_SSL === 'true' ? 'require' : false,
         // 新增：自动格式化日期
        dateStrings: true,
        connectTimeout: 10000,
         // MySQL 指定东八区时区
        timezone: '+08:00',
      },
      pool: {
        min: 0,
        max: 5,
        idleTimeoutMillis: 10000,
        acquireTimeoutMillis: 30000,
      },
      acquireConnectionTimeout: 30000,
      useNullAsDefault: true,
    };

    const db = knex(config);
    // 关键：给 mysql2 客户端手动挂载驱动
    const mysqlClient = db.client as any;
    mysqlClient.driver = mysql2;

    console.log('MySQL Knex instance created with patched driver');
    return db;
  }

  throw new Error(`不支持的数据库客户端: ${client}`);
}