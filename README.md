# 云图AI · YunTuAI

![License](https://img.shields.io/badge/license-MIT-3DA639)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB)
![React](https://img.shields.io/badge/React-19-61DAFB)
![Rust](https://img.shields.io/badge/Rust-2021-000000)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey)

**一个面向 Windows / macOS 的 AI 桌面控制中心** — Tauri 2 + React 19 + Rust 实现，单窗口承载多 Agent 调度、技能（Skill）安装、本地会话持久化与网关守护。

> *A desktop control center for multi-agent AI workflows — Tauri 2 (Rust) + React 19 + TypeScript.*

![对话界面](screenshots/02-chat.png)

这是该产品的**展示版仓库**：保留了完整的应用源码（React 前端 + Rust 原生层），移除了随包分发的运行时二进制、安装包、内部运维脚本与发布流水线配置。

---

## 它能做什么

| | |
|---|---|
| **对话工作台** | 多模型切换（DeepSeek / 火山方舟 / 小米 MiMo 等），支持附件、长任务、语音输入 |
| **Agent 指挥中心** | 多 Agent 的创建、切换、状态总览；每个 Agent 独立会话数、技能数与沙箱开关 |
| **技能工坊** | 80+ 内置工具与技能，支持搜索安装、精选同步、`SKILL.md` 生成 |
| **知识库助手** | 本地 RAG 服务桥接，带健康探测与降级 |
| **文档处理** | 图片与表格走本地 OCR，PDF / Excel / Office 写入在本地完成，不上传原件 |
| **网关守护** | 本地 Gateway 的启动、健康检查、断线重连、静默恢复与升级 |
| **系统集成** | 托盘常驻、单实例单窗口、自动更新、Windows MSI / macOS 安装包 |

<table>
<tr>
<td width="50%"><img src="screenshots/03-agents.png" alt="Agent 指挥中心"></td>
<td width="50%"><img src="screenshots/04-tools.png" alt="技能与工具"></td>
</tr>
<tr>
<td align="center"><sub>Agent 指挥中心 · 多 Agent 调度与状态总览</sub></td>
<td align="center"><sub>技能工坊 · 80 个工具与一键安装的精选技能</sub></td>
</tr>
</table>

<details>
<summary>更多界面</summary>

<br>

<table>
<tr>
<td width="50%"><img src="screenshots/01-launch.png" alt="启动准备"></td>
<td width="50%"><img src="screenshots/05-model-switch.png" alt="模型切换"></td>
</tr>
<tr>
<td align="center"><sub>启动准备 · 网关就绪前保持遮罩，避免假就绪</sub></td>
<td align="center"><sub>模型切换 · 会话内即时生效</sub></td>
</tr>
</table>

</details>

## 架构

```
React 19 前端 ── 对话 / Agent 指挥中心 / 技能工坊 / 设置
   │            Zustand Store 统一状态，GSAP 负责动效
   │  Tauri IPC（invokeWithAuthRetry 自动续期）
   ▼
Rust 原生层（Tauri 2）
   │
   ├── ipc_auth_policy     每类调用的授权策略
   ├── gateway_supervisor  网关生命周期：establish → healthy → degraded → reconnect
   ├── db.rs               SQLite 会话与消息（含定时备份）
   ├── skill_studio        技能生成、安装、同步
   └── ocr / office_write / updater
   │
   │  WebSocket  127.0.0.1:18789
   ▼
本地 Gateway 进程 ── 模型调用、工具执行、会话编排
   │
   ▼
yuntuai.db（会话、消息、审计）
```

启动顺序是一致性设计的核心：**先起网关、过健康检查，主界面才解除遮罩**——避免用户进到一个"能点但后端还没就绪"的空壳界面。网关侧则用状态机管理 `establish → healthy → degraded → reconnect`，崩溃后自动拉起，不打断正在进行的会话。

## 技术栈

- **前端**：React 19、TypeScript、Zustand、GSAP、`@tanstack/react-virtual`（长列表虚拟化）、Vite
- **原生层**：Rust 2021、Tauri 2（tray / single-instance / updater）、`rusqlite`（bundled + backup）、`aes-gcm`、`bcrypt`、`sha2`、`pdf-extract`、`lopdf`、`ureq`
- **数据**：SQLite（本地会话与消息）、JSON 配置、加密凭据存储

## 工程上值得一看的地方

1. **启动门控**：`gateway_lifecycle.rs` + `gateway_supervisor.rs` 把"准备中 / 已连接 / 重连中"做成显式状态，UI 与后端共用同一套判定，杜绝竞态下的假就绪。
2. **IPC 鉴权**：`ipc_auth_policy.rs` 对每类调用定义授权策略，前端 token 失效时走 `invokeWithAuthRetry` 重试，避免整窗刷新。
3. **本地数据可靠性**：会话库定期备份（`rusqlite` backup API），升级前做一次快照，回滚路径可用。
4. **发布工程**：安装器资产准备、升级清单生成、发布前自检（`verify:release-startup`、`verify:release-manifest` 等一串校验脚本）。
5. **测试分层**：组件测试、集成测试、冒烟测试、Rust 单测（`cargo test`），另有网关压力脚本。

## 目录结构

```
src/                 React 前端（应用外壳、组件、store、hooks、业务逻辑）
src-tauri/src/       Rust 原生层（46 个模块，约 2.5 万行）
src-tauri/capabilities/  Tauri 权限声明
docs/                设计规范、用户手册、网关 API 文档
public/              静态资源
screenshots/         界面截图
```

## 本地开发

```bash
# 前端
npm install
npm run dev

# 桌面端（需要 Rust 工具链）
npm run tauri dev

# 校验
npm run typecheck && npm run lint && npm run test
npm run test:rust
```

环境要求：Node.js 20+、Rust stable、[Tauri 前置依赖](https://tauri.app/start/prerequisites/)。仓库不含随包分发的 Node 运行时与安装包产物，首次构建前需执行 `npm run prepare:openclaw` 准备运行时目录。

## 文档

- [设计规范](docs/YUNTUAI-DESIGN-SPEC-CN.md)
- [用户手册](docs/YUNTUAI-USER-MANUAL-CN.md)
- [网关 API](docs/GATEWAY_API.md)

## 版权与许可

本项目由作者独立设计与开发。著作权归 **深圳市浩瀚云图信息科技有限责任公司** 所有，经授权以 [MIT](LICENSE) 协议开源。

```
Copyright (c) 2026 Shenzhen Haohan Yuntu Information Technology Co., Ltd.
```
