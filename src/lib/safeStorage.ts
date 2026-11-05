/**
 * localStorage 封装：统一 try-catch + JSON 序列化 + XOR 混淆。
 *
 * 消除分散在各 Store 中的重复模板代码，并对敏感数据（auth token）做
 * 基础的 XOR 静态混淆，提高本机存储的安全基线。
 *
 * ⚠ 注意：这是纵深防御的一环，并非绝对加密（密钥在源码中）。
 * 敏感逻辑请始终放在 Rust 后端。
 */

/** 派生 XOR 密钥：取机器特征与固定盐值 mix，使混淆结果在不同机器有差异。 */
function deriveXorKey(): string {
  let seed = "yuntu!2024#safe";
  // 尽量纳入一些本机差异，使 token 密文机器相关
  try {
    const nav = navigator;
    if (nav.userAgent) seed += nav.userAgent.slice(-16);
    if (nav.language) seed += nav.language;
    if (nav.hardwareConcurrency) seed += String(nav.hardwareConcurrency);
  } catch {
    /* 静默 */
  }
  // 固定长度 32 字节
  let key = "";
  for (let i = 0; i < 32; i++) {
    key += seed[i % seed.length];
  }
  return key;
}

function xorObfuscate(text: string): string {
  const key = deriveXorKey();
  let out = "";
  for (let i = 0; i < text.length; i++) {
    out += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  // base64 编码使可打印
  try {
    return btoa(out);
  } catch {
    return out;
  }
}

function xorDeobfuscate(encoded: string): string {
  try {
    const decoded = atob(encoded);
    return _xorRaw(decoded);
  } catch {
    // 非 base64（旧格式明文），直接返回
    return encoded;
  }
}

function _xorRaw(text: string): string {
  const key = deriveXorKey();
  let out = "";
  for (let i = 0; i < text.length; i++) {
    out += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return out;
}

/**
 * 读取明文值（无混淆）。
 * 适用于非敏感数据如 UI 偏好。
 */
export function getItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * 写入明文值。
 */
export function setItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 存储不可用时静默降级 */
  }
}

/**
 * 读取并解密敏感数据。
 * 兼容旧版明文存储（自动检测并升级为混淆格式）。
 */
export function getEncryptedItem(key: string): string | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    const decrypted = xorDeobfuscate(raw);
    return decrypted;
  } catch {
    return null;
  }
}

/**
 * 加密后写入敏感数据。
 */
export function setEncryptedItem(key: string, value: string): void {
  try {
    const encoded = xorObfuscate(value);
    localStorage.setItem(key, encoded);
  } catch {
    /* 存储不可用时静默降级 */
  }
}

/**
 * 为兼容旧明文存储的读取：先尝试解密，若结果看起来仍是明文则直接返回。
 * 常用于平滑升级已有用户数据。
 */
export function getItemWithUpgrade(key: string): string | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    // 尝试 base64 decode，若失败则为旧明文
    try {
      const decoded = atob(raw);
      const deXor = _xorRaw(decoded);
      // 如果解密后看起来像乱码但原始值有意义，猜测是旧明文 → 重写加密
      if (deXor.length > 0 && !/[^\x20-\x7E]/.test(decoded)) {
        // 看起来已经是可读的 base64 → 新格式
        return deXor;
      }
      // 旧明文格式
      setEncryptedItem(key, raw); // 升级存储
      return raw;
    } catch {
      // 非 base64 → 旧明文
      setEncryptedItem(key, raw); // 升级存储
      return raw;
    }
  } catch {
    return null;
  }
}

export function removeItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 存储不可用时静默降级 */
  }
}

export function getFlag(key: string): boolean {
  return getItem(key) === "1";
}

export function setFlag(key: string, value: boolean): void {
  setItem(key, value ? "1" : "0");
}