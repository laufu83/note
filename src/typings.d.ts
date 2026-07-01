declare module 'bcryptjs';
declare var crypto: Crypto
declare var OffscreenCanvas: typeof globalThis.OffscreenCanvas

// src/types/knex.d.ts
import 'knex';

declare module 'knex' {
  interface Config {
    driver?: {
      Client: any;
      Pool: any;
    };
  }
}