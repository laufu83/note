// src/utils/note-encrypt.ts

/**
 * 笔记安全加密工具
 * 
 * 核心设计：
 * 1. 密码哈希：PBKDF2-SHA256 100000次迭代
 * 2. 正文加密：AES-256-GCM
 * 3. 盐复用：哈希和加密共用同一个16字节盐
 * 4. 常量时间比较：防御时序攻击
 * 5. 分片Base64：防止大文件栈溢出
 */

type PasswordHashResult = {
  salt: string;
  hash: string;
};

type EncryptResult = {
  cipherText: string;
  salt: string;
  iv: string;
};

type EncryptWithHashResult = EncryptResult & {
  hash: string;
};

const PBKDF2_ITERATIONS = 100000;
const SALT_BYTE_LENGTH = 16;
const IV_BYTE_LENGTH = 12;
const HASH_ALG = "SHA-256" as const;
const CHUNK_SIZE = 8192;

const ERRORS = {
  INVALID_SALT: 'INVALID_SALT',
  DECRYPT_FAILED: 'DECRYPT_FAILED',
} as const;

export class NoteEncryptionService {
  /**
   * ⭐ 辅助函数：将 Uint8Array 转换为 ArrayBuffer（修复类型错误）
   * 在 Cloudflare Workers / 浏览器环境中，Uint8Array.buffer 实际是 ArrayBuffer
   * 但 TypeScript 严格模式会报错，使用此函数安全转换
   */
  private toArrayBuffer(data: Uint8Array): ArrayBuffer {
    // 如果已经是 ArrayBuffer，直接返回
    if (data.buffer instanceof ArrayBuffer) {
      return data.buffer;
    }
    // 如果是 SharedArrayBuffer，复制一份（极少出现）
    const newBuffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(newBuffer).set(data);
    return newBuffer;
  }

  private async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: this.toArrayBuffer(salt), // ⭐ 修复点 1
        iterations: PBKDF2_ITERATIONS,
        hash: HASH_ALG
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  private generateSalt(): Uint8Array {
    const salt = new Uint8Array(SALT_BYTE_LENGTH);
    crypto.getRandomValues(salt);
    return salt;
  }

  private generateIV(): Uint8Array {
    const iv = new Uint8Array(IV_BYTE_LENGTH);
    crypto.getRandomValues(iv);
    return iv;
  }

  private bufferToBase64(buf: Uint8Array): string {
    if (buf.byteLength === 0) return "";
    
    if (buf.byteLength <= CHUNK_SIZE) {
      return btoa(String.fromCharCode(...buf));
    }

    const chunks: string[] = [];
    for (let i = 0; i < buf.byteLength; i += CHUNK_SIZE) {
      const end = Math.min(i + CHUNK_SIZE, buf.byteLength);
      const chunk = buf.subarray(i, end);
      chunks.push(String.fromCharCode(...chunk));
    }
    return btoa(chunks.join(''));
  }

  private base64ToBuffer(base64: string): Uint8Array {
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return bytes;
  }

  private isValidSalt(saltBase64: string): boolean {
    try {
      const salt = this.base64ToBuffer(saltBase64);
      return salt.byteLength === SALT_BYTE_LENGTH;
    } catch {
      return false;
    }
  }

  private constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.byteLength !== b.byteLength) return false;
    let diff = 0;
    for (let i = 0; i < a.byteLength; i++) {
      diff |= a[i] ^ b[i];
    }
    return diff === 0;
  }

  /**
   * 新建加密笔记（一步完成）
   * 自动生成盐 → 生成密码哈希 → 加密正文
   */
  async encryptWithNewSalt(
    plainText: string,
    password: string
  ): Promise<EncryptWithHashResult> {
    const salt = this.generateSalt();
    const saltBase64 = this.bufferToBase64(salt);

    // 1. 生成密码哈希
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const hashRaw = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: this.toArrayBuffer(salt), // ⭐ 修复点 2
        iterations: PBKDF2_ITERATIONS,
        hash: HASH_ALG
      },
      keyMaterial,
      256
    );
    const hashBase64 = this.bufferToBase64(new Uint8Array(hashRaw));

    // 2. 加密正文
    const iv = this.generateIV();
    const key = await this.deriveKey(password, salt);
    const encoded = new TextEncoder().encode(plainText);
    const encryptedRaw = await crypto.subtle.encrypt(
      { 
        name: "AES-GCM", 
        iv: this.toArrayBuffer(iv) // ⭐ 修复点 3
      },
      key,
      encoded
    );

    return {
      cipherText: this.bufferToBase64(new Uint8Array(encryptedRaw)),
      salt: saltBase64,
      iv: this.bufferToBase64(iv),
      hash: hashBase64
    };
  }

  /**
   * 复用盐加密（修改内容，密码不变）
   */
  async encryptWithExistingSalt(
    plainText: string,
    password: string,
    existingSaltBase64: string
  ): Promise<EncryptResult> {
    if (!this.isValidSalt(existingSaltBase64)) {
      throw new Error(ERRORS.INVALID_SALT);
    }

    const salt = this.base64ToBuffer(existingSaltBase64);
    const iv = this.generateIV();
    const key = await this.deriveKey(password, salt);

    const encoded = new TextEncoder().encode(plainText);
    const encryptedRaw = await crypto.subtle.encrypt(
      { 
        name: "AES-GCM", 
        iv: this.toArrayBuffer(iv) // ⭐ 修复点 4
      },
      key,
      encoded
    );

    return {
      cipherText: this.bufferToBase64(new Uint8Array(encryptedRaw)),
      salt: existingSaltBase64,
      iv: this.bufferToBase64(iv)
    };
  }

  /**
   * 修改密码（重新加密 + 生成新哈希）
   */
  async changePassword(
    plainText: string,
    newPassword: string,
    existingSaltBase64: string
  ): Promise<EncryptWithHashResult> {
    if (!this.isValidSalt(existingSaltBase64)) {
      throw new Error(ERRORS.INVALID_SALT);
    }

    const salt = this.base64ToBuffer(existingSaltBase64);
    const saltBase64 = existingSaltBase64;

    // 1. 生成新密码哈希
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(newPassword),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const hashRaw = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: this.toArrayBuffer(salt), // ⭐ 修复点 5
        iterations: PBKDF2_ITERATIONS,
        hash: HASH_ALG
      },
      keyMaterial,
      256
    );
    const hashBase64 = this.bufferToBase64(new Uint8Array(hashRaw));

    // 2. 用新密码加密正文
    const iv = this.generateIV();
    const key = await this.deriveKey(newPassword, salt);
    const encoded = new TextEncoder().encode(plainText);
    const encryptedRaw = await crypto.subtle.encrypt(
      { 
        name: "AES-GCM", 
        iv: this.toArrayBuffer(iv) // ⭐ 修复点 6
      },
      key,
      encoded
    );

    return {
      cipherText: this.bufferToBase64(new Uint8Array(encryptedRaw)),
      salt: saltBase64,
      iv: this.bufferToBase64(iv),
      hash: hashBase64
    };
  }

 
/**
 * 解密笔记正文
 */
async decrypt(
  cipherText: string,
  password: string,
  saltBase64: string,
  ivBase64: string
): Promise<string> {
  try {
    if (!this.isValidSalt(saltBase64)) {
      throw new Error(ERRORS.INVALID_SALT);
    }

    const salt = this.base64ToBuffer(saltBase64);
    const iv = this.base64ToBuffer(ivBase64);
    const key = await this.deriveKey(password, salt);

    // ⭐ 修复：将 Uint8Array 转换为 ArrayBuffer
    const encryptedBuf = this.base64ToBuffer(cipherText);
    const decryptedRaw = await crypto.subtle.decrypt(
      { 
        name: "AES-GCM", 
        iv: this.toArrayBuffer(iv) // IV 转为 ArrayBuffer
      },
      key,
      this.toArrayBuffer(encryptedBuf) // ⭐ 关键修复：密文也转为 ArrayBuffer
    );
    
    return new TextDecoder().decode(decryptedRaw);
  } catch (error) {
    if (error instanceof Error && error.message === ERRORS.INVALID_SALT) {
      throw new Error(`${ERRORS.DECRYPT_FAILED}: 数据损坏`);
    }
    throw new Error(ERRORS.DECRYPT_FAILED);
  }
}

  /**
   * ⭐ 独立使用：生成密码哈希
   */
  async hashPassword(password: string): Promise<PasswordHashResult> {
    const salt = this.generateSalt();
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    const hashRaw = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: this.toArrayBuffer(salt), // ⭐ 修复点 8
        iterations: PBKDF2_ITERATIONS,
        hash: HASH_ALG
      },
      keyMaterial,
      256
    );

    return {
      salt: this.bufferToBase64(salt),
      hash: this.bufferToBase64(new Uint8Array(hashRaw))
    };
  }

  /**
   * ⭐ 验证密码（常量时间比较）
   */
  async verifyPassword(
    password: string,
    storedSaltBase64: string,
    storedHashBase64: string
  ): Promise<boolean> {
    try {
      if (!this.isValidSalt(storedSaltBase64)) {
        return false;
      }

      const salt = this.base64ToBuffer(storedSaltBase64);
      const encoder = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        "PBKDF2",
        false,
        ["deriveBits"]
      );

      const hashRaw = await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          salt: this.toArrayBuffer(salt), // ⭐ 修复点 9
          iterations: PBKDF2_ITERATIONS,
          hash: HASH_ALG
        },
        keyMaterial,
        256
      );

      const calcHashBuf = new Uint8Array(hashRaw);
      const storedHashBuf = this.base64ToBuffer(storedHashBase64);

      return this.constantTimeEqual(calcHashBuf, storedHashBuf);
    } catch {
      return false;
    }
  }

  /**
   * 密码格式校验：6位以上，必须同时包含字母+数字
   */
  validatePassword(password: string): { isValid: boolean; message: string } {
    if (!password || password.length < 6) {
      return { isValid: false, message: "密码至少6位" };
    }
    if (!/\d/.test(password) || !/[a-zA-Z]/.test(password)) {
      return { isValid: false, message: "密码必须同时包含字母和数字" };
    }
    return { isValid: true, message: "" };
  }
}

export const noteEncryptService = new NoteEncryptionService();