/**
 * 模块管理系统 — Tauri IPC 桥接
 *
 * 所有 IPC 调用走 invokeAuthed（带 token 的鉴权 invoke）。
 */
import { invokeAuthed } from "./tauri-invoke";
import { isTauriRuntime } from "./tauri-env";

/* ── 类型定义 ──────────────────────────────────────────── */

export type ModuleRuntime = {
  type: "python" | "node" | "binary";
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export type ModuleMcpConfig = {
  protocol: string;
  transport: string;
};

export type ModuleConfigField = {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "select";
  default?: unknown;
  description?: string;
  options?: string[];
  min?: number;
  max?: number;
};

export type ModuleExtraService = {
  label?: string;
  command: string;
  args: string[];
  type: string;
  port: string;
};

export type ModuleToolDeclaration = {
  name: string;
  description?: string;
};

export type ModuleManifest = {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  icon?: string;
  runtime: ModuleRuntime;
  mcp: ModuleMcpConfig;
  permissions: string[];
  config: ModuleConfigField[];
  extras?: Record<string, ModuleExtraService>;
  tools: ModuleToolDeclaration[];
};

export type ModuleInfo = {
  manifest: ModuleManifest;
  enabled: boolean;
  path: string;
  configOverrides?: Record<string, unknown>;
  installedAt?: string;
};

/* ── IPC 封装 ──────────────────────────────────────────── */

export async function fetchModuleList(): Promise<ModuleInfo[]> {
  if (!isTauriRuntime()) return [];
  const result = await invokeAuthed<ModuleInfo[]>("module_list");
  return result ?? [];
}

export async function installModuleFromDir(dir: string): Promise<ModuleInfo | null> {
  if (!isTauriRuntime()) return null;
  return invokeAuthed<ModuleInfo>("module_install", { dir });
}

export async function uninstallModule(moduleId: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const result = await invokeAuthed<null>("module_uninstall", { moduleId });
  return result !== null;
}

export async function setModuleEnabled(moduleId: string, enabled: boolean): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const result = await invokeAuthed<null>("module_set_enabled", { moduleId, enabled });
  return result !== null;
}

export async function getModuleConfig(
  moduleId: string,
): Promise<Record<string, unknown> | null> {
  if (!isTauriRuntime()) return null;
  return invokeAuthed<Record<string, unknown> | null>("module_get_config", { moduleId });
}

export async function saveModuleConfig(
  moduleId: string,
  config: Record<string, unknown>,
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const result = await invokeAuthed<null>("module_save_config", { moduleId, config });
  return result !== null;
}

/** 验证模块目录中的 module.json 是否合法 */
export async function validateModuleManifest(dir: string): Promise<ModuleManifest | null> {
  if (!isTauriRuntime()) return null;
  return invokeAuthed<ModuleManifest>("module_validate_manifest", { dir });
}

export type ScannedModuleEntry = {
  manifest: ModuleManifest;
  sourceDir: string;
};

/** 扫描目录中的模块（自动发现 module.json） */
export async function scanModuleDir(dir: string): Promise<ScannedModuleEntry[]> {
  if (!isTauriRuntime()) return [];
  const result = await invokeAuthed<ScannedModuleEntry[]>("module_scan_dir", { dir });
  return result ?? [];
}
