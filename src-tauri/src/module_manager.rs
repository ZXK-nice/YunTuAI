//! 模块管理系统：注册、安装、启停第三方 MCP 模块。
//!
//! 模块数据存储在 `{installed_dir}/modules/` 下，独立于 OpenClaw 管控目录，
//! 避免触发 OpenClaw 配置文件的 SHA-256 漂移检测。

use crate::auth::assert_authenticated;
use crate::db::DbState;
use crate::owner::assert_owner;
use crate::openclaw_runtime::strip_bom;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::State;

const MODULES_DIR: &str = "modules";
const REGISTRY_FILE: &str = "modules.json";

// ── 数据结构 ───────────────────────────────────────────────

/// 模块运行时信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleRuntime {
    /// 运行环境类型
    #[serde(rename = "type")]
    pub runtime_type: String, // "python" | "node" | "binary"
    /// 启动命令（如 python / node / 可执行文件路径）
    pub command: String,
    /// 启动参数
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    /// 环境变量
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub env: HashMap<String, String>,
    /// 工作目录（非绝对路径时相对于模块根目录）
    #[serde(default)]
    pub cwd: String,
}

/// MCP 协议配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModuleMcpConfig {
    #[serde(default)]
    pub protocol: String, // "stdio"
    #[serde(default)]
    pub transport: String, // "json-rpc-2.0"
}

/// 配置项定义（用于前端生成配置编辑 UI）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleConfigField {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub field_type: String, // "string" | "number" | "boolean" | "select"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
}

/// 额外服务（如 text-to-cad 的 CAD Viewer）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleExtraService {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(rename = "type")]
    pub service_type: String,
    #[serde(default)]
    pub port: String,
}

/// 预声明的工具列表（运行时 tools/list 会覆盖此列表）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleToolDeclaration {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// 模块清单（module.json，随模块一起分发）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleManifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,

    pub runtime: ModuleRuntime,

    #[serde(default)]
    pub mcp: ModuleMcpConfig,

    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub permissions: Vec<String>,

    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub config: Vec<ModuleConfigField>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extras: Option<HashMap<String, ModuleExtraService>>,

    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tools: Vec<ModuleToolDeclaration>,
}

/// 用户配置覆盖
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleUserConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_overrides: Option<HashMap<String, serde_json::Value>>,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installed_at: Option<String>,
}

/// 模块注册表条目（modules.json 中的一条）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleRegistryEntry {
    /// 模块 ID
    pub id: String,
    /// 模块名称
    pub name: String,
    /// 模块版本
    pub version: String,
    /// 安装路径（模块文件所在目录的绝对路径）
    pub path: String,
    /// 用户配置
    #[serde(flatten)]
    pub user_config: ModuleUserConfig,
}

/// 模块注册表文件（modules.json）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModuleRegistry {
    modules: Vec<ModuleRegistryEntry>,
}

/// 返回给前端的模块信息（含 manifest + 注册表状态）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleInfo {
    /// 模块清单内容
    pub manifest: ModuleManifest,
    /// 是否启用
    pub enabled: bool,
    /// 安装路径
    pub path: String,
    /// 用户配置覆盖
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_overrides: Option<HashMap<String, serde_json::Value>>,
    /// 安装时间
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installed_at: Option<String>,
}

// ── 路径 ──────────────────────────────────────────────────

fn modules_dir() -> Result<PathBuf, String> {
    let dir = crate::paths::installed_dir()?.join(MODULES_DIR);
    fs::create_dir_all(&dir).map_err(|e| format!("创建模块目录失败: {e}"))?;
    Ok(dir)
}

fn registry_path() -> Result<PathBuf, String> {
    Ok(modules_dir()?.join(REGISTRY_FILE))
}

fn path_starts_with(child: &std::path::Path, parent: &std::path::Path) -> bool {
    child.starts_with(parent)
}

/// 仅允许从受信目录安装模块，避免任意路径代码执行。
fn assert_module_install_source_allowed(abs: &std::path::Path) -> Result<(), String> {
    let modules = modules_dir()?;
    if path_starts_with(abs, &modules) {
        return Ok(());
    }
    if let Ok(data) = crate::openclaw_control::managed_openclaw_data_dir() {
        let inbox = crate::openclaw_control::resolve_workspace_dir(&data)
            .unwrap_or_else(|_| data.join("workspace"))
            .join("inbox");
        if inbox.exists() {
            if let Ok(inbox_abs) = inbox.canonicalize() {
                if path_starts_with(abs, &inbox_abs) {
                    return Ok(());
                }
            }
        }
    }
    if let Some(home) = dirs::home_dir() {
        for sub in ["Downloads", "下载"] {
            let downloads = home.join(sub);
            if downloads.is_dir() {
                if let Ok(dl_abs) = downloads.canonicalize() {
                    if path_starts_with(abs, &dl_abs) {
                        return Ok(());
                    }
                }
            }
        }
    }
    Err("仅允许从 modules 目录、Downloads/下载 或 workspace/inbox 安装模块".into())
}

// ── 注册表读写 ─────────────────────────────────────────────

fn load_registry() -> Result<ModuleRegistry, String> {
    let path = registry_path()?;
    if !path.is_file() {
        return Ok(ModuleRegistry { modules: vec![] });
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("读取模块注册表失败: {e}"))?;
    serde_json::from_str(strip_bom(&raw)).map_err(|e| format!("解析模块注册表失败: {e}"))
}

fn save_registry(registry: &ModuleRegistry) -> Result<(), String> {
    let path = registry_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(&registry).map_err(|e| e.to_string())?;
    fs::write(&path, body).map_err(|e| e.to_string())?;
    Ok(())
}

// ── 核心操作 ───────────────────────────────────────────────

/// 读取模块目录中的 module.json
pub fn read_manifest(module_dir: &std::path::Path) -> Result<ModuleManifest, String> {
    let manifest_path = module_dir.join("module.json");
    let raw = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("读取 module.json 失败: {e}"))?;
    let manifest: ModuleManifest =
        serde_json::from_str(strip_bom(&raw)).map_err(|e| format!("解析 module.json 失败: {e}"))?;
    Ok(manifest)
}

/// 列出所有已安装模块
pub fn list_modules() -> Result<Vec<ModuleInfo>, String> {
    let registry = load_registry()?;
    let mut result = Vec::new();

    for entry in &registry.modules {
        let path = std::path::Path::new(&entry.path);
        let manifest = if path.join("module.json").is_file() {
            read_manifest(path).ok()
        } else {
            None
        };

        if let Some(manifest) = manifest {
            result.push(ModuleInfo {
                manifest,
                enabled: entry.user_config.enabled,
                path: entry.path.clone(),
                config_overrides: entry.user_config.config_overrides.clone(),
                installed_at: entry.user_config.installed_at.clone(),
            });
        }
    }

    Ok(result)
}

/// 从目录安装模块
pub fn install_module_from_dir(dir: &str) -> Result<ModuleInfo, String> {
    let dir_path = std::path::Path::new(dir);
    if !dir_path.is_dir() {
        return Err(format!("目录不存在: {dir}"));
    }

    let abs_path = dir_path
        .canonicalize()
        .map_err(|e| format!("获取绝对路径失败: {e}"))?;
    assert_module_install_source_allowed(&abs_path)?;

    let manifest = read_manifest(dir_path)?;

    // 验证模块清单
    validate_manifest(&manifest)?;

    // 检查是否已安装
    let mut registry = load_registry()?;
    if registry.modules.iter().any(|m| m.id == manifest.id) {
        return Err(format!("模块「{}」(ID: {}) 已安装。如需重新安装请先卸载。", manifest.name, manifest.id));
    }

    // 验证运行时依赖
    verify_runtime_available(&manifest, dir_path)?;

    // 标准化路径（绝对路径）并记录
    let path_str = abs_path.to_string_lossy().to_string();

    let entry = ModuleRegistryEntry {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        version: manifest.version.clone(),
        path: path_str,
        user_config: ModuleUserConfig {
            config_overrides: None,
            enabled: true,
            installed_at: Some(chrono::Utc::now().to_rfc3339()),
        },
    };

    registry.modules.push(entry);
    save_registry(&registry)?;

    // 同步到 OpenClaw MCP（AI 完全访问模式下自动注册到 openclaw.json）
    if let Err(e) = crate::openclaw_control::sync_module_to_openclaw_mcp(
        &manifest.id,
        &manifest.name,
        &manifest.runtime.command,
        &manifest.runtime.args,
        manifest.description.as_deref(),
        true,
    ) {
        eprintln!("[YunTuAI] 同步模块到 OpenClaw MCP 失败: {e}");
    }

    // 返回完整信息
    let info = ModuleInfo {
        manifest,
        enabled: true,
        path: abs_path.to_string_lossy().to_string(),
        config_overrides: None,
        installed_at: registry
            .modules
            .last()
            .map(|m| m.user_config.installed_at.clone())
            .unwrap_or_else(|| Some(chrono::Utc::now().to_rfc3339())),
    };

    Ok(info)
}

/// 验证模块清单的完整性和合法性
pub fn validate_manifest(manifest: &ModuleManifest) -> Result<(), String> {
    // 基本字段检查
    if manifest.id.is_empty() {
        return Err("模块 ID 不能为空".into());
    }
    if manifest.id.contains(char::is_whitespace) || manifest.id.contains('/') || manifest.id.contains('\\') {
        return Err(format!("模块 ID「{}」包含非法字符（不允许空格、斜杠）", manifest.id));
    }
    if manifest.name.is_empty() {
        return Err("模块名称不能为空".into());
    }
    if manifest.runtime.command.is_empty() {
        return Err("模块运行时命令不能为空".into());
    }

    // 验证运行时类型
    match manifest.runtime.runtime_type.as_str() {
        "python" | "node" | "binary" => {}
        t => return Err(format!("不支持的运行时类型: {t}（仅支持 python/node/binary）")),
    }

    // MCP 配置检查
    if manifest.mcp.protocol.is_empty() {
        return Err("MCP 协议不能为空".into());
    }

    // 工具检查
    for tool in &manifest.tools {
        if tool.name.is_empty() {
            return Err("工具名称不能为空".into());
        }
    }

    Ok(())
}

/// 验证模块运行时依赖是否可用
fn verify_runtime_available(manifest: &ModuleManifest, dir_path: &std::path::Path) -> Result<(), String> {
    match manifest.runtime.runtime_type.as_str() {
        "python" => {
            let main_file = if manifest.runtime.args.first().map(|a| !a.is_empty()).unwrap_or(false) {
                let arg0 = &manifest.runtime.args[0];
                let cwd = if manifest.runtime.cwd.is_empty() {
                    dir_path.to_path_buf()
                } else {
                    dir_path.join(&manifest.runtime.cwd)
                };
                cwd.join(arg0)
            } else {
                dir_path.join("main.py")
            };
            if !main_file.is_file() {
                return Err(format!(
                    "模块入口文件不存在: {}。请确认 module.json 中 runtime.args[0] 指向正确的 Python 脚本。",
                    main_file.display()
                ));
            }
        }
        "node" => {
            let main_file = if manifest.runtime.args.first().map(|a| !a.is_empty()).unwrap_or(false) {
                let arg0 = &manifest.runtime.args[0];
                let cwd = if manifest.runtime.cwd.is_empty() {
                    dir_path.to_path_buf()
                } else {
                    dir_path.join(&manifest.runtime.cwd)
                };
                cwd.join(arg0)
            } else {
                dir_path.join("main.js")
            };
            if !main_file.is_file() {
                return Err(format!(
                    "模块入口文件不存在: {}。请确认 module.json 中 runtime.args[0] 指向正确的 JS 脚本。",
                    main_file.display()
                ));
            }
        }
        "binary" => {
            // binary 类型不检查入口文件，由用户自行保证
        }
        _ => {}
    }
    Ok(())
}

/// 扫描结果：清单 + 所在目录（子目录扫描时安装路径不能误用父目录）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedModuleEntry {
    pub manifest: ModuleManifest,
    pub source_dir: String,
}

/// 扫描目录中的模块（按需发现 module.json）
pub fn scan_module_dir(dir: &str) -> Result<Vec<ScannedModuleEntry>, String> {
    let dir_path = std::path::Path::new(dir);
    if !dir_path.is_dir() {
        return Err(format!("目录不存在: {dir}"));
    }

    let mut manifests = Vec::new();

    // 如果目录本身就有 module.json，直接返回
    if dir_path.join("module.json").is_file() {
        let manifest = read_manifest(dir_path)?;
        manifests.push(ScannedModuleEntry {
            manifest,
            source_dir: dir_path.to_string_lossy().to_string(),
        });
        return Ok(manifests);
    }

    // 扫描一级子目录
    if let Ok(entries) = fs::read_dir(dir_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && path.join("module.json").is_file() {
                if let Ok(manifest) = read_manifest(&path) {
                    manifests.push(ScannedModuleEntry {
                        manifest,
                        source_dir: path.to_string_lossy().to_string(),
                    });
                }
            }
        }
    }

    if manifests.is_empty() {
        return Err(format!("在 {dir} 中未找到任何 module.json。请确认该目录包含有效的 MCP 模块。"));
    }

    Ok(manifests)
}

/// 卸载模块
pub fn uninstall_module(module_id: &str) -> Result<(), String> {
    let mut registry = load_registry()?;
    let idx = registry
        .modules
        .iter()
        .position(|m| m.id == module_id)
        .ok_or_else(|| format!("模块「{module_id}」未安装"))?;

    registry.modules.remove(idx);
    save_registry(&registry)?;

    // 从 OpenClaw MCP 移除
    if let Err(e) = crate::openclaw_control::remove_module_from_openclaw_mcp(module_id) {
        eprintln!("[YunTuAI] 从 OpenClaw MCP 移除模块失败: {e}");
    }

    Ok(())
}

/// 启用/禁用模块
pub fn set_module_enabled(module_id: &str, enabled: bool) -> Result<(), String> {
    let mut registry = load_registry()?;
    let entry = registry
        .modules
        .iter_mut()
        .find(|m| m.id == module_id)
        .ok_or_else(|| format!("模块「{module_id}」未安装"))?;

    entry.user_config.enabled = enabled;

    // 提前提取路径，避免后续借用冲突
    let entry_path = entry.path.clone();

    save_registry(&registry)?;
    // 释放 registry 借用，让 path 可以自由使用
    drop(registry);

    // 从模块目录读取 manifest 以获取完整 command/args
    let path = std::path::Path::new(&entry_path);
    if let Ok(manifest) = read_manifest(path) {
        if let Err(e) = crate::openclaw_control::sync_module_to_openclaw_mcp(
            &manifest.id,
            &manifest.name,
            &manifest.runtime.command,
            &manifest.runtime.args,
            manifest.description.as_deref(),
            enabled,
        ) {
            eprintln!("[YunTuAI] 同步模块启用状态到 OpenClaw MCP 失败: {e}");
        }
    }

    Ok(())
}

/// 读取模块的用户配置
pub fn read_module_user_config(module_id: &str) -> Result<Option<HashMap<String, serde_json::Value>>, String> {
    let registry = load_registry()?;
    let entry = registry
        .modules
        .iter()
        .find(|m| m.id == module_id)
        .ok_or_else(|| format!("模块「{module_id}」未安装"))?;

    Ok(entry.user_config.config_overrides.clone())
}

/// 保存模块的用户配置覆盖
pub fn save_module_user_config(
    module_id: &str,
    config: HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    let mut registry = load_registry()?;
    let entry = registry
        .modules
        .iter_mut()
        .find(|m| m.id == module_id)
        .ok_or_else(|| format!("模块「{module_id}」未安装"))?;

    entry.user_config.config_overrides = Some(config);
    save_registry(&registry)?;
    Ok(())
}

// ── Tauri IPC 命令 ────────────────────────────────────────

#[tauri::command]
pub fn module_list(
    state: State<'_, DbState>,
    token: String,
) -> Result<Vec<ModuleInfo>, String> {
    assert_authenticated(&state, &token)?;
    list_modules()
}

#[tauri::command]
pub fn module_install(
    state: State<'_, DbState>,
    token: String,
    dir: String,
) -> Result<ModuleInfo, String> {
    assert_owner(&state, &token)?;
    install_module_from_dir(&dir)
}

#[tauri::command]
pub fn module_uninstall(
    state: State<'_, DbState>,
    token: String,
    module_id: String,
) -> Result<(), String> {
    assert_owner(&state, &token)?;
    uninstall_module(&module_id)
}

#[tauri::command]
pub fn module_set_enabled(
    state: State<'_, DbState>,
    token: String,
    module_id: String,
    enabled: bool,
) -> Result<(), String> {
    assert_owner(&state, &token)?;
    set_module_enabled(&module_id, enabled)
}

#[tauri::command]
pub fn module_get_config(
    state: State<'_, DbState>,
    token: String,
    module_id: String,
) -> Result<Option<HashMap<String, serde_json::Value>>, String> {
    assert_authenticated(&state, &token)?;
    read_module_user_config(&module_id)
}

#[tauri::command]
pub fn module_save_config(
    state: State<'_, DbState>,
    token: String,
    module_id: String,
    config: HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    assert_owner(&state, &token)?;
    save_module_user_config(&module_id, config)
}

#[tauri::command]
pub fn module_validate_manifest(
    state: State<'_, DbState>,
    token: String,
    dir: String,
) -> Result<ModuleManifest, String> {
    assert_authenticated(&state, &token)?;
    let dir_path = std::path::Path::new(&dir);
    let manifest = read_manifest(dir_path)?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

#[tauri::command]
pub fn module_scan_dir(
    state: State<'_, DbState>,
    token: String,
    dir: String,
) -> Result<Vec<ScannedModuleEntry>, String> {
    assert_authenticated(&state, &token)?;
    scan_module_dir(&dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_manifest(dir: &std::path::Path, id: &str) {
        let json = format!(
            r#"{{
  "id": "{id}",
  "name": "Test {id}",
  "version": "1.0.0",
  "runtime": {{ "type": "node", "command": "node", "args": ["index.js"] }},
  "mcp": {{ "protocol": "stdio", "transport": "json-rpc-2.0" }},
  "permissions": [],
  "config": [],
  "tools": []
}}"#
        );
        fs::write(dir.join("module.json"), json).expect("write manifest");
    }

    fn temp_scan_root(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "yuntuai-module-scan-{}-{}",
            label,
            std::process::id()
        ))
    }

    #[test]
    fn scan_module_dir_returns_source_dir_for_root_manifest() {
        let base = temp_scan_root("root");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).expect("mkdir");
        write_manifest(&base, "mod-root");

        let entries = scan_module_dir(base.to_str().expect("utf8 path")).expect("scan");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].manifest.id, "mod-root");
        assert_eq!(
            std::path::Path::new(&entries[0].source_dir),
            base.as_path()
        );

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn scan_module_dir_returns_child_source_dirs() {
        let base = temp_scan_root("children");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).expect("mkdir");
        let child_a = base.join("child-a");
        let child_b = base.join("child-b");
        fs::create_dir_all(&child_a).expect("mkdir a");
        fs::create_dir_all(&child_b).expect("mkdir b");
        write_manifest(&child_a, "mod-a");
        write_manifest(&child_b, "mod-b");

        let entries = scan_module_dir(base.to_str().expect("utf8 path")).expect("scan");
        assert_eq!(entries.len(), 2);
        let dirs: Vec<_> = entries.iter().map(|e| e.source_dir.clone()).collect();
        assert!(dirs.iter().any(|d| d.ends_with("child-a") || d.ends_with("child-a\\")));
        assert!(dirs.iter().any(|d| d.ends_with("child-b") || d.ends_with("child-b\\")));

        let _ = fs::remove_dir_all(&base);
    }
}
