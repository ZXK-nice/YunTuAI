# OpenClaw Gateway 对接说明（YunTuAI）

本文档描述 YunTuAI 与 OpenClaw Gateway 的集成边界。协议权威来源：[Gateway Protocol](https://docs.openclaw.ai/gateway/protocol/)（WebSocket JSON、`connect` 握手、`req`/`res`/`event` 帧）。

## 1. 连接方式

| 能力 | 说明 |
|------|------|
| 传输 | WebSocket，文本帧 JSON |
| 默认地址 | `ws://127.0.0.1:18789`（端口以 `~/.openclaw` 配置为准） |
| 认证 | 握手 `connect` 的 `params.auth.token`；URL 查询 `?token=` 亦可（由 `buildGatewayWsUrl` 生成） |
| 配置文件 | Rust 命令读取 `~/.openclaw/openclaw.json`、`config.json`、`config.yml` / `config.yaml`（见 `read_openclaw_config_files`） |

## 2. YunTuAI 已实现模块

| 路径 | 职责 |
|------|------|
| `src/lib/openclaw/gateway-client.ts` | WebSocket、`connect` / `connect.challenge` 重试、`request()` 待处理表 |
| `src/lib/openclaw/connect.ts` | 构建 `connect` 请求体（operator、`minProtocol`/`maxProtocol`: 3） |
| `src/lib/openclaw/config.ts` | 解析 JSON/YAML 中的 `gateway.auth.token`、`gateway.port` 等 |
| `src/stores/gatewayStore.ts` | 连接状态、断线指数退避重连、`status`/`health` 探测摘要 |
| `src/stores/stepStore.ts` | 将 Gateway `event` 转为步骤列表（启发式，待与 `messageId` 绑定） |

## 3. 已使用的 RPC（可按版本调整）

| 方法 | 用途 |
|------|------|
| `connect` | 握手（见协议，首帧） |
| `status` | 连接成功后拉取摘要（失败忽略） |
| `health` | 健康快照（失败忽略） |
| `sessions.create` | 创建远程会话；参数当前发送 `label` + `displayTitle`（若与你本机 Gateway 不一致，请改 `gatewayCreateRemoteSession`） |
| `sessions.send` | 发送用户消息；参数 `key` + `message`（见 `buildSessionsSendParams`）；可选 `attachments`（上游处理因类型而异） |
| `agents.files.set` | 将文本写入**默认 agent 工作区**；`name` 只能是网关允许列表中的根文件名（如 `USER.md`），**不能**使用 `uploads/...` 等子路径。YunTuAI 将多附件合并前置写入 `USER.md`（先 `agents.files.get` 再合并 `set`） |
| `logs.tail` | 拉取网关文件日志片段（见 `src/lib/openclaw/logs-rpc.ts`，参数可按版本调整） |

## 4. 事件与任务步骤

常见事件族包括 `session.message`、`session.tool` 等。`stepStore` 目前按事件名与 payload 启发式展示；后续应对齐官方 schema，并把 `messageId` / `sessionKey` 写入 SQLite 以便回放。

## 5. 本地 SQLite

数据库路径（Rust）：`dirs::data_dir()/YunTuAI/yuntuai.db`（Windows 一般为 `%APPDATA%\YunTuAI\yuntuai.db`）。

表 `audit_log`：记录白名单 CLI 调用（category=`cli`）及 stdout/stderr 摘要，可在「日志 → 操作审计」查看并导出 JSON。

## 6. 本机 CLI（Tauri 白名单）

以下命令由 Rust `std::process::Command` 调用（非交互 shell），需在 PATH 中可用 `openclaw`：

- `openclaw gateway status --json`
- `openclaw gateway health --json`（可选 `--url`，与配置中 WebSocket URL 一致）
- `openclaw gateway start|stop|restart`
- `openclaw doctor`

UI 入口：**仪表盘**。

## 7. 验证清单

- [ ] 本机 `openclaw gateway` 已监听目标端口  
- [ ] `sessions.create` / `sessions.send` 的 params 与当前 OpenClaw 版本一致  
- [ ] 若握手失败，核对 token 与 Gateway 日志  
- [ ] 助手侧回复需 Gateway / 模型侧配置正确（本客户端只负责会话发送与事件展示）  

更新本文件时请注明 **OpenClaw 版本号** 与 **协议变更日期**。
