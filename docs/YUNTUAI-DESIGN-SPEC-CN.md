# 云图AI桌面端控制系统（YunTuAI）软件设计说明书

**版本：V1.3.7**

**著作权人：深圳市浩瀚云图信息科技有限责任公司**

**开发完成日期：2026年06月30日**

---

## 修订记录

| 版本 | 日期 | 修订内容 |
|------|------|---------|
| V1.0 | 2026-03-15 | 初始版本，M0-M2 阶段设计 |
| V1.3 | 2026-06-22 | 补充网关监管、安全模块、数据设计 |
| V1.3.7 | 2026-06-30 | 发布版本，补充全部模块与流程设计，增加操作指南与界面说明 |

---

## 第一章 引言

### 1.1 编写目的

本文档是云图AI桌面端控制系统（YunTuAI）的软件设计说明书，旨在描述本软件的系统架构、模块划分、接口设计、数据设计、安全设计和操作流程，作为软件开发、维护和计算机软件著作权登记的参考依据。

### 1.2 软件名称与版本

- **软件全称**：云图AI桌面端控制系统
- **软件简称**：YunTuAI
- **版本号**：V1.3.7
- **软件类型**：桌面应用软件

### 1.3 开发完成日期

2026年06月30日

### 1.4 著作权人与开发单位

- **著作权人**：深圳市浩瀚云图信息科技有限责任公司
- **开发单位**：深圳市浩瀚云图信息科技有限责任公司
- **开发方式**：自主开发（原始取得）
- **开发周期**：2026年3月至2026年6月

### 1.5 软件定位

云图AI是一款面向本地AI代理网关架构的桌面控制中心软件。用户可在本地设备上安装运行，通过图形化界面管理AI代理网关的启停、会话、技能配置与工作流，将AI代理能力与桌面操作环境深度整合。

本软件的核心价值在于：
1. 提供本地化的AI代理管理体验，所有数据存于用户设备
2. 通过独占式进程监管确保网关服务的高可用性
3. 内置技能工坊系统，支持用户自定义和社区共享AI工作能力
4. 完善的用户认证、设备授权和操作审计机制

### 1.6 适用范围

- **运行平台**：Windows 10/11（x86_64）、macOS 12+
- **目标用户**：需要本地化AI代理管理能力的个人用户与企业用户
- **应用场景**：AI辅助办公、自动化任务编排、技能管理与分发、本地知识库管理
- **部署方式**：MSI安装包（Windows）/ DMG安装包（macOS），单实例运行

---

## 第二章 总体设计

### 2.1 设计目标

1. **本地优先**：所有数据与配置存储于本地设备，不依赖云端服务
2. **桌面原生**：基于Tauri 2框架构建，提供原生窗口、系统托盘和安装包
3. **全程守护**：对本地AI网关进程实施独占监管，提供健康检测与故障自愈
4. **安全可控**：内置用户认证、设备授权、操作审计和Owner权限分级
5. **可扩展**：支持技能工坊、社区技能安装、模块化配置

### 2.2 技术架构概览

本软件采用Tauri 2桌面框架，结合Rust后端与React前端混合架构：

- **原生层（Rust）**：负责进程管理、文件I/O、系统调用、SQLite持久化、授权验证和IPC命令处理。共35个模块，约14500行代码。
- **前端层（TypeScript/React）**：负责用户界面渲染、状态管理（Zustand）和用户交互。共约230个文件，约35000行代码。
- **通信层（Tauri IPC）**：前后端通过Tauri内置的invoke机制进行异步命令调用，前端经统一封装层调用后端命令。共注册90余个IPC命令。

### 2.3 系统分层

本软件按功能分为以下六个层次：

| 层次 | 技术实现 | 职责 | 关键文件/包 |
|------|---------|------|-----------|
| 表现层 | React 19 + TypeScript + Tailwind CSS 4 + GSAP | 用户界面渲染与交互 | src/components/（约70个组件） |
| 状态层 | Zustand（共12个Store） | 全局状态管理与跨组件共享 | src/stores/ |
| 业务逻辑层 | TypeScript（src/lib/，约50个文件） | 网关客户端、会话管理、技能发现 | src/lib/openclaw/, src/lib/chat/, src/lib/skills/ |
| IPC通信层 | Tauri invoke + Event System | 前端与Rust后端异步通信 | src/lib/tauri-invoke.ts |
| 后端服务层 | Rust（35个模块） | 进程监管、数据库、认证、授权 | src-tauri/src/*.rs |
| 持久化层 | SQLite + 文件系统 | 会话数据、配置、技能包存储 | src-tauri/src/db.rs, openclaw-data/ |

### 2.4 技术选型详解

| 技术 | 版本 | 用途 | 选型理由 |
|------|------|------|---------|
| Tauri | 2.x | 桌面应用框架 | 原生性能、小体积安装包、Rust生态 |
| Rust | 2021 edition | 后端原生逻辑 | 内存安全、高性能、适合系统级编程 |
| React | 19.1 | 前端UI框架 | 生态成熟、组件化开发 |
| TypeScript | 5.8 | 前端类型安全 | 编译期类型检查，降低运行时错误 |
| Vite | 7.0 | 前端构建工具 | 极速HMR、高效打包 |
| Tailwind CSS | 4.2 | 样式框架 | 原子化CSS、可定制设计系统 |
| Zustand | 5.0 | 前端状态管理 | 轻量、无boilerplate、支持TypeScript |
| GSAP | 3.15 | 动画引擎 | 高性能、跨浏览器兼容 |
| SQLite（rusqlite） | 0.32 | 本地数据库 | 嵌入式、零配置、bundled编译 |
| Vitest | 4.1 | 前端单元测试 | Vite原生集成、快速执行 |

### 2.6 部署形态

- **Windows**：MSI安装包（含WebView2运行时引导安装），支持静默安装
- **macOS**：DMG安装包
- **运行模式**：单实例桌面应用（Tauri single-instance插件），通过系统托盘驻留后台
- **安装包大小**：约200MB（含内置Node.js运行时 + 精选技能包）

### 2.7 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      用户界面层（React）                       │
│  ┌──────┐ ┌──────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐  │
│  │ 登录  │ │ 聊天  │ │  仪表盘   │ │ 技能工坊  │ │  设置   │  │
│  └──────┘ └──────┘ └──────────┘ └──────────┘ └─────────┘  │
├─────────────────────────────────────────────────────────────┤
│                  Zustand 状态管理（12个Store）                  │
│  sessionStore  taskStore  gatewayStore  modelStore           │
│  licenseStore  authStore  uiStore      agentStore           │
│  execApprovalStore  ownerStore  stepStore  workspaceStore    │
├─────────────────────────────────────────────────────────────┤
│                   业务逻辑层（src/lib/）                        │
│  ┌──────────┐ ┌───────────┐ ┌──────────────────────────┐   │
│  │ 网关客户端 │ │ 会话管理   │ │ 技能发现/认证/授权/审计   │   │
│  │WebSocket │ │RPC/去重/  │ │skill-discovery/catalog/  │   │
│  │connect/  │ │sync/send  │ │auth-policy/license-bridge │   │
│  │reconnect │ │           │ │                          │   │
│  └──────────┘ └───────────┘ └──────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                  Tauri IPC 通信层                             │
│  invoke("cmd", {args}) ──────> Result<T, String>            │
│  app.emit("event", payload) <────── Rust emit                │
├─────────────────────────────────────────────────────────────┤
│                  Rust 后端服务层（35个模块）                    │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌─────────────────┐  │
│  │ auth │ │license│ │owner │ │  db  │ │gateway_supervisor│  │
│  │认证  │ │授权  │ │管理员│ │数据库│ │   网关监管        │  │
│  └──────┘ └──────┘ └──────┘ └──────┘ └─────────────────┘  │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────────────┐  │
│  │openclaw_ctrl │ │skill_studio  │ │openclaw_provision  │  │
│  │ 配置接管     │ │  技能工坊    │ │   首次配置         │  │
│  └──────────────┘ └──────────────┘ └────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│              数据持久化层（SQLite + 文件系统）                  │
│  yuntuai.db  ── 用户/会话/消息/任务/审计                       │
│  openclaw-data/ ── 配置/密钥/技能/工作区                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 第三章 模块设计

### 3.1 前端模块

前端代码位于src/目录，按功能分为以下模块组：

#### 3.1.1 组件层（src/components/）

| 模块目录 | 功能描述 | 核心组件 | 文件数 |
|---------|---------|---------|--------|
| auth/ | 登录、注册、修改密码、授权激活 | LoginScreen, LicenseScreen | 2 |
| chat/ | 会话聊天面板、消息列表、消息输入、Markdown渲染 | ChatPanel, ChatComposerBar, ChatStreamingBubble, ChatMessageList, ModelSelector, ThinkingBlock | 10 |
| dashboard/ | 仪表盘面板，网关状态总览 | DashboardPanel, AgentDashboard | 2 |
| console/ | 网关控制台，实时日志与命令输出，审计查看 | OpenClawConsolePanel, AdvancedConsolePanel, ConsoleSections | 4 |
| settings/ | 软件设置面板（外观、账户、服务、授权、API密钥） | SettingsSectionFrame, AccountPasswordSection, SoftwareAppearancePanel, GatewaySettings, ApiKeySettingsPanel, LicenseStatusPanel | 10 |
| owner/ | Owner管理面板（用户管理、授权签发、网关配置接管） | OwnerGate, OwnerUnlockPanel, OwnerUserManagement, LicenseIssuerPanel | 4 |
| skills/ | 技能工坊界面（岗位技能生成、社区技能浏览与安装） | SkillStudioPanel, SkillRoleRecommendations, CommunitySkillPackPanel | 4 |
| imageStudio/ | 图像生成工作台（文生图配置与管理） | ImageStudioPanel, image-studio-ui | 2 |
| ui/ | 通用UI组件（骨架屏、错误边界、确认弹窗、Toast） | Skeleton, ErrorBoundary, ConfirmDialog, ToastHost | 4 |
| motion/ | 动画组件（GSAP动效） | ChatEmptyHeroMotion, AppShellEntrance, ComposerDockMotion | 3 |
| layout/ | 应用布局框架（侧边栏、顶栏、工作区、右键面板） | AppShell, AppFrame, Sidebar, SessionSidebarPanel, CenterWorkspace, TaskRightPanel, WindowTitleBar | 10 |
| openclaw/ | 网关专用界面（连接就绪、API密钥设置、服务控制） | ServiceReadinessScreen, ApiKeySetupScreen, GatewayServiceControls | 3 |
| workspace/ | 工作区面板（工具、制品） | ToolsPanel, SessionArtifactsPanel | 2 |
| steps/ | 任务步骤流水线 | TaskStepPipeline | 1 |

#### 3.1.2 状态管理（src/stores/，共12个Store）

| Store文件 | 管理内容 | 关键状态 |
|-----------|---------|---------|
| authStore | 用户认证状态，token持久化，登录/注册/登出 | user, token, gateStatus |
| sessionStore | 会话列表、当前会话、消息流、消息发送/接收 | sessions, currentSessionId, messages |
| taskStore | 任务状态与审批流程 | tasks, activeTaskPerSession |
| gatewayStore | 网关连接状态、健康信息、WebSocket生命周期 | connected, healthOk, port |
| modelStore | 模型选择与可用模型列表 | currentModel, availableModels |
| licenseStore | 设备授权状态、到期提醒 | licensed, expiresAt, renewSoon |
| execApprovalStore | 命令执行审批状态 | pendingApprovals |
| uiStore | UI状态（配色方案、侧边栏、toast栈、导航意图） | colorScheme, sidebarExpanded, toasts |
| agentStore | 代理注册表（从网关加载代理列表） | agents, activeAgentId |
| ownerStore | Owner解锁会话状态（12小时有效期） | unlocked, sessionExpiry |
| stepStore | 任务步骤流水线（从网关事件流解析步骤） | pipelineSteps |
| workspaceArtifactStore | 会话级工作区制品（文件、图像） | artifacts |

#### 3.1.3 业务逻辑层（src/lib/）

| 子目录 | 核心文件数 | 功能概述 |
|--------|----------|---------|
| openclaw/ | 36 | 网关WebSocket客户端、RPC协议、消息去重、断线恢复、会话历史同步、任务分发、控制台通信、环境桥接 |
| chat/ | 6 | 消息排版、中文混排美化、语音输入、会话自动标题、视觉附件处理 |
| skills/ | 5 | 技能目录、社区技能发现、技能工坊提示模板、角色推荐、精选技能定义 |
| auth/ | 2 | 密码策略（按发行档分支）、token管理与加密切换 |
| models/ | 3 | 模型目录与解析、视觉能力检测、模型API通信 |
| image-gen/ | 1 | 图像生成API桥接 |

### 3.2 后端模块（Rust，共35个模块）

#### 3.2.1 核心框架（3个模块）

| 文件 | 代码行数 | 功能 |
|------|---------|------|
| main.rs | 15 | 程序入口，Windows子系统配置（隐藏控制台），WebView2调试端口配置 |
| lib.rs | 600 | Tauri应用初始化、窗口管理、系统托盘、全部90+个IPC命令注册、启动流程编排 |
| paths.rs | 50 | 统一路径解析：安装目录、数据目录、可执行文件目录 |

#### 3.2.2 用户认证与权限（2个模块）

| 文件 | 代码行数 | 功能 |
|------|---------|------|
| auth.rs | 700 | 用户注册/登录/登出，bcrypt密码哈希（cost=12），session token生成与验证，token与机器指纹XOR加密存储，5次失败锁定，角色管理（admin/user），孤儿会话迁移 |
| owner.rs | 150 | Owner管理员登录/登出，bcrypt门控（编译期嵌入/环境变量/调试fallback），12小时会话+锁定保护，紧急代登机制 |

#### 3.2.3 设备授权（3个模块）

| 文件 | 代码行数 | 功能 |
|------|---------|------|
| license.rs | 800 | CPU指纹采集（CPUID+品牌+核心数+主机名->SHA-256），license.dat JSON签名离线验证，到期管理（提前3天续期提示），激活密钥三级获取（编译期>环境变量>安装目录文件） |
| install_seal.rs | 100 | 安装封印：首次注册后写入HMAC封印文件，阻止数据库清空后劫持账户 |
| distribution_policy.rs | 100 | 发行档策略控制：中转站（8位数字密码）/直连（字母+数字密码），token过期时间，模型目录，API密钥环境变量 |

#### 3.2.4 网关监管（11个模块，约4000行）

| 文件 | 代码行数 | 功能 |
|------|---------|------|
| gateway_supervisor.rs | 1200 | 子进程独占监管（单飞锁防并发），TCP端口探活（200ms/轮×25轮=5s），健康看门狗（10s周期，800ms超时，连续3次失败判定死亡），自动恢复（kill残留+重spawn），状态报告推送（120s间隔） |
| openclaw_control.rs | 1500 | 配置接管（adopt发现→repair修复→apply写入→enforce实施→seal加密的完整pipeline），绝对控制权建立（启动时阻塞等待），SHA-256配置漂移追踪，AI访问开关，传统目录迁移 |
| openclaw_exec.rs | 300 | 子进程启停（前台命令构建+try_wait轮询+5s强制kill），端口占用清理（wmic/netstat），孤儿进程查杀，监督PID追踪 |
| openclaw_bootstrap.rs | 200 | 首次启动：解压内置便携OpenClaw运行时ZIP，填充openclaw-data默认配置 |
| openclaw_provision.rs | 400 | 运行时自动下载/解压（300s超时+进度回调），npm安装（MAX_RETRIES=2+npmmirror镜像），首次配置pipeline（下载→解压→安装→技能→工作区→验证） |
| openclaw_migrate.rs | 350 | 从传统~/.openclaw到受管目录的数据迁移：备份重命名→目录复制→JSON深度合并→配置策略写入 |
| openclaw_platform.rs | 150 | 平台相关的启动器名称（openclaw.cmd/sh）、内置Node.js可执行文件路径 |
| openclaw_runtime.rs | 200 | 运行时偏好管理：内置vs全局OpenClaw选择，版本追踪，网关Node.js内存限制 |
| openclaw_env.rs | 300 | .env API密钥检测与写入（用户可编辑，排除在配置漂移回滚外），模型列表API，发行档profile |
| openclaw_data_roots.rs | 100 | 多openclaw-data目录扫描（遍历安装目录），原子切换，候选根列表 |
| openclaw_relay_waf_patch.rs | 50 | 内置OpenClaw分发包补丁：替换User-Agent为YunTuAI/<version>，绕过中继API WAF拦截 |

#### 3.2.5 会话与数据（2个模块，约800行）

| 文件 | 代码行数 | 功能 |
|------|---------|------|
| db.rs | 500 | SQLite数据库层：连接管理（WAL模式），7张表自动建表/迁移，CRUD（会话/消息/任务/审计），自动备份（>=6h间隔，保留3份），完整性检查，孤儿会话迁移 |
| chat_files.rs | 250 | 聊天附件：输出目录管理，拖放路径检查，文件上传保存，Base64/文本预览，OS文件打开 |

#### 3.2.6 功能模块（7个模块）

| 文件 | 代码行数 | 功能 |
|------|---------|------|
| image_gen.rs | 300 | AI图像生成：OpenAI兼容images/generations API（火山引擎Seedream、WCode），配置管理，引用图像选择，本地存储 |
| module_manager.rs | 250 | 第三方MCP模块注册表：Python/Node/二进制模块安装/卸载/启停，独立于OpenClaw配置 |
| skill_studio.rs | 400 | 技能工坊后端：用户草稿SKILL.md安装，社区技能包列表/bundled管理，网关配置注册 |
| updater.rs | 150 | MSI覆盖更新：拉取latest.json，SHA-256校验，msiexec /passive执行 |
| openclaw_skill_bootstrap.rs | 100 | 精选技能首次安装（bilingual-pdf-translation, paper-to-patent, scipilot-writing等） |
| openclaw_workspace_bootstrap.rs | 100 | 工作区初始化：SOUL.md人格文件，.agents配置，HEARTBEAT.md自审+IMPROVEMENTS.md改进记录，版本化模板升级 |
| task_utils.rs | 50 | 工具函数：超时包装的阻塞闭包+进度事件推送到前端 |

#### 3.2.7 辅助模块（3个模块）

| 文件 | 代码行数 | 功能 |
|------|---------|------|
| app_launch.rs | 80 | 自启动注册（Tauri autostart插件），系统托盘后台启动（--tray参数），窗口显示/隐藏 |
| app_shutdown.rs | 80 | 全局原子关闭信号，后台线程（gateway report emitter, health watch, establish）clean join |
| cli.rs | 100 | 网关CLI命令白名单封装：health/start/stop/restart HTTP调用，外部网关抑制 |
| agnes_dev.rs | 50 | Debug构建专用：Agnes AI提供商模型（apihub.agnes-ai.com），Release构建排除 |

---

## 第四章 接口设计

### 4.1 前后端通信机制

本软件使用Tauri IPC（Inter-Process Communication）作为前后端通信机制：

1. **前端调用**：通过invoke("command_name", { args })调用Rust端注册的Tauri命令，返回Promise<Result<T, String>>
2. **后端响应**：Rust函数返回Result<T, String>，Tauri框架自动序列化为JSON回传前端
3. **事件推送**：Rust端通过app.emit("event_name", payload)向前端主动推送事件
4. **安全封装层**：前端统一使用以下三种封装避免手写invoke：
   - invokeWithAuthRetry()：核心业务调用，自动附带认证token，token过期自动重试
   - invokeAuthed()：UI/bridge层调用，可返回null，用于非关键数据获取
   - requireAuthToken()：仅用于特殊场景（如auth_logout），获取当前token

### 4.2 IPC命令分类详情（共90+个命令）

#### 4.2.1 用户认证（15个命令）

| 命令 | 参数 | 返回值 | 权限 |
|------|------|--------|------|
| auth_gate_status | - | {hasUsers, installSealed, registrationAllowed} | 无需登录 |
| auth_has_users | - | bool | 无需登录 |
| auth_register | username, password | token | 无需登录 |
| auth_login | username, password | token | 无需登录 |
| auth_owner_emergency_login | username | token | 无需登录 |
| auth_logout | token | - | 需登录 |
| auth_resume_session | token | userInfo | 需登录 |
| auth_change_password | token, oldPw, newPw | - | 需登录 |
| auth_admin_reset_password | token, userId, newPw | - | Owner |
| auth_delete_user | token, userId | - | Owner |
| auth_set_user_role | token, userId, role | - | Owner |
| auth_cleanup_expired_tokens | - | count | Owner |
| auth_list_users | token | User[] | Owner |
| owner_login | password | sessionToken | - |
| owner_logout | - | - | - |

#### 4.2.2 网关监管（9个命令）

| 命令 | 功能 | 权限 |
|------|------|------|
| gateway_supervisor_status | 获取网关监管状态 | 需登录 |
| gateway_supervisor_ensure | 确保网关运行 | 需登录 |
| gateway_supervisor_stop | 停止网关 | 需登录 |
| gateway_supervisor_restart | 重启网关 | 需登录 |
| gateway_supervisor_reclaim | 回收孤儿网关 | 需登录 |
| openclaw_exclusive_report | 独占监管状态报告 | 需登录 |
| openclaw_gateway_health_json | HTTP健康检查 | 需登录 |
| openclaw_gateway_start/stop/restart | 网关CLI启停 | 需登录 |
| openclaw_stop_all_gateways | 停止所有网关 | 需登录 |

#### 4.2.3 网关控制（5个命令）

| 命令 | 功能 | 权限 |
|------|------|------|
| openclaw_control_discover | 发现本地OpenClaw环境 | Owner |
| openclaw_control_adopt | 采纳数据目录 | Owner |
| openclaw_control_read_config/write_config | 读/写网关配置 | Owner |
| openclaw_control_enforce | 实施控制策略 | Owner |
| openclaw_establish_absolute_control | 建立绝对控制权 | Owner |

#### 4.2.4 会话与数据（20个命令）

| 命令 | 功能 | 权限 |
|------|------|------|
| db_list_sessions/create/delete | 会话CRUD | 需登录 |
| db_append_message/delete/list/clear | 消息CRUD | 需登录 |
| db_set_remote_session_key/agent | 会话关联 | 需登录 |
| db_update_session_title | 更新标题 | 需登录 |
| db_create_task/list/update/get | 任务管理 | 需登录 |
| db_check_integrity/maintenance/autobackup | 数据库维护 | 需登录 |
| audit_list/append/export_json | 审计日志 | Owner（export/list） |

#### 4.2.5 其余命令（约40个）

涵盖：环境配置（model/env/keys）、配置管理（provision/runtime）、技能工坊（install/list）、文件操作（upload/read/reveal）、图像生成（config/create/list/delete）、更新（check/install）、模块管理（install/uninstall/config）、数据根切换（scan/switch）。

### 4.3 事件推送详情

| 事件名 | 推送方向 | 触发条件 | 载荷内容 |
|--------|---------|---------|---------|
| gateway-exclusive-report | 后端→前端 | 定时120s + ensure完成后立即 | {running, health_ok, port, pid, data_dir, bundled, ...} |
| gateway-supervisor-unhealthy | 后端→前端 | 健康看门狗连续3次TCP不可达 | {port, consecutive_failures} |

### 4.4 内部模块间接口

#### 4.4.1 Rust模块间调用关系

```
lib.rs (启动编排)
  ├── db::init_db() → DbState
  ├── auth::* (注册/登录)
  ├── license::check_license()
  ├── openclaw_bootstrap::bootstrap_openclaw_on_startup()
  ├── gateway_supervisor::start_exclusive_report_emitter()
  ├── gateway_supervisor::start_supervisor_health_watch()
  ├── openclaw_control::establish_absolute_control()
  └── openclaw_runtime::reconcile_runtime_preference()
```

#### 4.4.2 前端Store间数据流

```
authStore.login() → gatewayStore.connect() → sessionStore.loadSessions()
                                                │
                                         agentStore.loadAgents()
                                                │
                                         modelStore.syncModel()
```

---

## 第五章 数据设计

### 5.1 数据存储方案概述

本软件使用两种存储方式：

1. **SQLite数据库（yuntuai.db）**：存储结构化数据。使用rusqlite bundled模式编译，启用WAL模式（Write-Ahead Logging），支持并发读。数据库文件位于openclaw-data/data/目录，大小约2-10MB。
2. **文件系统（openclaw-data/）**：存储配置文件、环境变量、API密钥、技能包（SKILL.md文件）、工作区文件、代理配置、记忆存储、插件目录。

### 5.2 SQLite数据库ER关系图

```
users (1) ──────< auth_tokens (N)
  │
  ├──< local_sessions (N) ──────< local_messages (N)
  │
  └──< local_tasks (N)

audit_log (独立表，定期清理)
login_attempts (独立表，按用户关联)
```

### 5.3 数据库表结构详解

#### users表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PRIMARY KEY | UUID v4 |
| username | TEXT | NOT NULL UNIQUE | 用户名 |
| password_hash | TEXT | NOT NULL | bcrypt(cost=12)哈希 |
| lock_until | INTEGER | | 毫秒epoch，5次失败后锁定 |
| failed_attempts | INTEGER | NOT NULL DEFAULT 0 | 连续登录失败计数 |
| created_at | TEXT | NOT NULL | ISO 8601时间戳 |

#### auth_tokens表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PRIMARY KEY | UUID v4 |
| user_id | TEXT | NOT NULL, FK→users(id) CASCADE | 关联用户 |
| token | TEXT | NOT NULL UNIQUE | 会话token（XOR加密存储） |
| user_agent | TEXT | | 客户端标识 |
| ip_hint | TEXT | | IP提示 |
| created_at | TEXT | NOT NULL | 创建时间 |
| last_used_at | TEXT | | 最后使用时间 |

索引：idx_auth_tokens_token ON auth_tokens(token)

#### local_sessions表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PRIMARY KEY | UUID v4 |
| title | TEXT | NOT NULL | 会话标题（自动生成或用户编辑） |
| remote_session_key | TEXT | | 网关侧会话标识（用于对账） |
| agent_id | TEXT | | 关联代理ID（迁移添加） |
| user_id | TEXT | FK→users(id) CASCADE | 所属用户（迁移添加） |
| created_at | TEXT | NOT NULL | 创建时间 |
| updated_at | TEXT | NOT NULL | 更新时间 |

索引：idx_local_sessions_user_updated ON local_sessions(user_id, updated_at DESC)

#### local_messages表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PRIMARY KEY | UUID v4 |
| session_id | TEXT | NOT NULL, FK→local_sessions(id) CASCADE | 所属会话 |
| role | TEXT | NOT NULL | user/assistant/system/tool |
| content | TEXT | NOT NULL | 消息内容（最大4MB） |
| created_at | TEXT | NOT NULL | 创建时间 |

索引：idx_messages_session ON local_messages(session_id, created_at)

#### local_tasks表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PRIMARY KEY | UUID v4 |
| user_id | TEXT | NOT NULL, FK→users(id) CASCADE | 所属用户 |
| session_id | TEXT | FK→local_sessions(id) SET NULL | 关联会话 |
| title | TEXT | NOT NULL | 任务标题 |
| status | TEXT | NOT NULL DEFAULT 'pending' | pending/running/completed/failed |
| template_id | TEXT | | 模板ID |
| capability_snapshot | TEXT | | 能力快照 |
| outcome | TEXT | | 结果摘要 |
| created_at | TEXT | NOT NULL | 创建时间 |
| updated_at | TEXT | NOT NULL | 更新时间 |
| completed_at | TEXT | | 完成时间 |

#### audit_log表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PRIMARY KEY | UUID v4 |
| created_at | TEXT | NOT NULL | 操作时间 |
| category | TEXT | NOT NULL | 操作类别 |
| action | TEXT | NOT NULL | 操作动作 |
| detail | TEXT | NOT NULL | 操作详情 |

索引：idx_audit_created ON audit_log(created_at DESC)
自动清理策略：超过90天或超过50000条时自动清除最旧记录

#### login_attempts表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PRIMARY KEY | UUID v4 |
| username | TEXT | NOT NULL | 尝试登录的用户名 |
| success | INTEGER | NOT NULL DEFAULT 0 | 是否成功（0/1） |
| ip_hint | TEXT | | IP提示 |
| created_at | TEXT | NOT NULL | 尝试时间 |

索引：idx_login_attempts_user ON login_attempts(username, created_at DESC)

### 5.4 数据库维护策略

| 策略 | 说明 |
|------|------|
| 自动备份 | 每次启动检查上次备份时间，>=6小时则自动备份，保留3份备份文件（yuntuai-backup-*.db.bak） |
| WAL模式 | 启用Write-Ahead Logging，支持并发读操作，提升性能 |
| WAL检查点 | 每次数据库打开时执行checkpoint |
| 完整性检查 | 通过db_check_integrity IPC命令支持手动/自动校验 |
| 消息限制 | 单条消息内容最大4MB，防止数据库膨胀 |
| 审计清理 | 自动清除90天以上或超过50000条的审计记录 |

### 5.5 文件系统组织

```
安装目录/
├── yuntuai.exe                    # 应用程序主程序（Rust编译，约15MB）
├── openclaw-data/                 # 运行时数据目录
│   ├── data/
│   │   └── yuntuai.db             # SQLite数据库（约2-10MB）
│   │   └── yuntuai-backup-*.bak   # 自动备份文件
│   ├── .env                       # 环境变量（API密钥等，用户可编辑）
│   ├── openclaw.json              # 网关主配置文件（JSON格式）
│   ├── agent.json                 # 代理配置文件
│   ├── workspace/                 # 工作区目录
│   │   ├── .agents/
│   │   │   └── skills/            # 已安装的技能（每个技能一个子目录）
│   │   │       ├── scipilot-writing/
│   │   │       │   └── SKILL.md
│   │   │       ├── paper-to-patent/
│   │   │       │   └── SKILL.md
│   │   │       └── ...
│   │   ├── SOUL.md                # 人格文件
│   │   ├── HEARTBEAT.md           # 循环自审文件
│   │   └── IMPROVEMENTS.md        # 改进记录文件
│   ├── agents/                    # 代理配置目录
│   ├── memory/                    # 记忆存储目录
│   ├── identity/                  # 身份配置目录
│   └── plugins/                   # 插件目录
├── openclaw-portable/             # 内置便携Node.js + OpenClaw运行时
├── license.dat                    # 设备授权文件（JSON签名格式）
└── activation.secret              # 激活密钥文件（非必须）
```

---

## 第六章 流程设计

### 6.1 应用启动流程（完整时序）

```
应用程序启动
  │
  ├── [Rust main.rs] 设置Windows子系统（Release隐藏控制台）
  │      └── 设置WebView2调试端口:9222（仅Debug构建）
  │
  ├── [Rust lib.rs::run()] 启动流程编排
  │   │
  │   ├── Phase 1: 基础设施初始化
  │   │   ├── 创建Tauri应用实例（窗口1280x800，无边框，最小1024x640）
  │   │   ├── 注册全局invoke_handler（90+个IPC命令）
  │   │   ├── 创建系统托盘（显示/退出）
  │   │   └── 设置单实例检测（Tauri single-instance插件）
  │   │
  │   ├── Phase 2: 数据层初始化
  │   │   ├── init_db() → 打开/创建SQLite数据库
  │   │   │   ├── 启动WAL模式
  │   │   │   ├── 执行WAL checkpoint
  │   │   │   ├── 自动建表/迁移（7张表）
  │   │   │   └── 检查是否需要自动备份（>=6小时）
  │   │   └── 写入启动阶段日志到yuntuai-startup.log
  │   │
  │   ├── Phase 3: 安全验证
  │   │   ├── install_seal检查（验证安装封印HMAC）
  │   │   ├── license_enforcement判断（Release默认开启）
  │   │   │   ├── 启用：读取license.dat → 采集机器指纹 → SHA-256匹配 → 签名验证
  │   │   │   │   ├── 未授权 → 前端显示LicenseScreen，阻止进入
  │   │   │   │   └── 已授权 → 检查到期时间，<=3天提示续期
  │   │   │   └── 未启用 → 跳过授权
  │   │   └── 首次启动检测（auth_has_users → 是否需要注册页）
  │   │
  │   ├── Phase 4: 网关环境准备
  │   │   ├── bootstrap_openclaw_on_startup() → 解压内置OpenClaw
  │   │   ├── reconcile_runtime_preference() → 确定运行时来源
  │   │   └── ensure_default_runtime_pref() → 无偏好时默认内置
  │   │
  │   ├── Phase 5: 后台线程启动
  │   │   ├── establish_absolute_control(true) [独立线程，catch_unwind保护]
  │   │   │   ├── 发现本地OpenClaw环境
  │   │   │   ├── 采纳最优数据目录
  │   │   │   ├── 修复openclaw.json兼容性
  │   │   │   ├── 写入模型默认值（deepseek-v4-flash + compaction）
  │   │   │   ├── 引导循环工程（HEARTBEAT.md）
  │   │   │   ├── 应用YunTuAI安全策略（allowedOrigins等）
  │   │   │   ├── 加密secrets vault
  │   │   │   └── 标记ESTABLISH_COMPLETE（网关spawn等待此信号）
  │   │   ├── start_exclusive_report_emitter() [守护线程]
  │   │   │   ├── 首轮延迟1.5s
  │   │   │   └── 每120s推送gateway-exclusive-report事件
  │   │   └── start_supervisor_health_watch() [守护线程]
  │   │       ├── 每10s执行TCP端口探活（800ms超时）
  │   │       └── 连续3次失败 → 推送unhealthy事件 + 触发自动恢复
  │   │
  │   └── Phase 6: 前端渲染
  │       ├── 加载React根组件AppShell
  │       ├── 显示SplashScreen（启动动画）
  │       ├── BootScreen（许可检查→网关配置→运行时设置）
  │       ├── LicenseScreen/AuthGate（授权/认证门控）
  │       └── 进入主界面（AppFrame + Sidebar + CenterWorkspace）
  │
  └── [前端] 主界面就绪
      ├── 监听gateway-exclusive-report事件
      ├── 建立WebSocket连接至127.0.0.1:18789
      ├── 加载会话列表（从SQLite）
      ├── 加载代理列表（从网关RPC）
      └── 恢复上次活跃会话
```

### 6.2 网关生命周期状态机

```
                    ┌─────────────────────────────────┐
                    │           STOPPED                │
                    │  (网关未运行，等待启动指令)        │
                    └──────┬──────────────────▲────────┘
                           │                  │
              [gateway_supervisor_ensure]     │
              [用户点击启动]                   │
                           │                  │
                    ┌──────▼──────────────────┴────────┐
                    │           STARTING               │
                    │  (spawn子进程，等待端口就绪)       │
                    │  TCP探活：25轮 × 200ms = 5秒      │
                    └──────┬───────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
        [端口可达]                  [端口不可达]
              │                    [SPAWN_MAX_RETRIES=3]
              │                    [3次均失败 → STOPPED]
              │                         │
     ┌────────▼────────┐                │
     │   HEALTH_CHECK  │                │
     │ (HTTP /health)  │                │
     └────────┬────────┘                │
              │                         │
    ┌─────────┴─────────┐               │
    │                   │               │
[健康OK]           [健康失败]            │
    │                   │               │
┌───▼────────┐  ┌───────▼────────┐      │
│  RUNNING   │  │   UNHEALTHY    │      │
│ (正常运行) │  │ (运行但不健康)  │      │
└───┬────────┘  └───────┬────────┘      │
    │                   │               │
    └──[健康看门狗 10s周期]──┘           │
                │                       │
    [连续3次TCP不可达 判定死亡]          │
                │                       │
         ┌──────▼───────────────────────┴──┐
         │  自动恢复：kill残留 + 重spawn    │
         │  → STARTING                     │
         └─────────────────────────────────┘

gateway_supervisor_stop → 任何状态 → STOPPED (优雅关闭)
gateway_supervisor_restart → STOPPED → STARTING
```

### 6.3 用户会话完整流程

```
[用户登录]
    │
    ├── auth_login(username, password)
    │   ├── bcrypt验证密码哈希
    │   ├── 检查账户锁定状态（5次失败→锁定）
    │   ├── 生成session token（UUID v4）
    │   ├── token与机器指纹XOR加密后存入auth_tokens表
    │   └── 返回token给前端（仅内存，不持久化）
    │
    ├── [前端] authStore存储token
    │
    ├── [用户点击"新建会话"]
    │   │
    │   ├── db_create_session() → SQLite插入local_sessions记录
    │   ├── gatewayStore.ensureConnected()
    │   │   ├── WebSocket连接至127.0.0.1:18789
    │   │   ├── 发送connect握手帧
    │   │   └── 接收hello响应（含网关能力列表）
    │   ├── 发送sessions.create RPC请求
    │   │   └── 接收remote_session_key → 存入SQLite（db_set_remote_session_key）
    │   │
    │   ├── [用户输入消息并发送]
    │   │   │
    │   │   ├── 前端本地存储消息（db_append_message, role=user）
    │   │   ├── 发送sessions.send RPC请求（含消息内容和模型选择）
    │   │   ├── 前端UI立即显示用户消息
    │   │   │
    │   │   └── [接收AI响应流]
    │   │       ├── 聊天事件队列按序入队（chat-event-queue）
    │   │       ├── 消息去重检查（chat-message-dedup）
    │   │       ├── UI流式渲染：
    │   │       │   ├── ThinkingBlock（AI推理过程，可折叠）
    │   │       │   └── ChatStreamingBubble（最终回复，实时Markdown）
    │   │       ├── 每个事件批量写入SQLite
    │   │       ├── 任务步骤事件 → stepStore管道更新
    │   │       ├── 工作区制品事件 → workspaceArtifactStore更新
    │   │       └── 工具调用审批事件 → execApprovalStore入队
    │   │
    │   └── [会话结束/切换]
    │       ├── 最终事件（assistant/tool_result）写入SQLite
    │       ├── 自动生成会话标题（session-auto-title）
    │       └── 任务完成时调用task-delivery归档结果
    │
    └── [恢复历史会话]
        ├── SQLite加载消息列表（db_list_messages）
        ├── 与网关侧session_key匹配（session-key-match）
        ├── 必要时从网关拉取增量消息（chat-history-sync）
        └── UI恢复完整消息列表
```

### 6.4 首次安装与配置流程

```
[用户下载MSI安装包]
    │
    ├── 双击MSI执行安装
    │   ├── Windows Installer引导
    │   ├── 检测WebView2运行时 → 缺失则自动安装
    │   ├── 释放文件至安装目录
    │   ├── 释放内置OpenClaw便携ZIP
    │   ├── 创建桌面快捷方式
    │   └── 注册卸载信息
    │
    ├── [首次启动应用程序]
    │   │
    │   ├── 1. 运行环境检测
    │   │   ├── 检测Node.js（查找内置便携版 + 全局PATH）
    │   │   └── 未找到 → 解压内置Node.js ZIP → 配置PATH
    │   │
    │   ├── 2. 首次配置流程（Provision Pipeline）
    │   │   ├── Phase "download": 下载OpenClaw运行时（如需要）
    │   │   │   └── 300s超时 + 进度回调
    │   │   ├── Phase "extract": 解压运行时
    │   │   ├── Phase "install": npm install
    │   │   │   ├── registry: https://registry.npmmirror.com
    │   │   │   ├── MAX_RETRIES = 2
    │   │   │   └── 完成后验证版本（node openclaw.mjs --version）
    │   │   ├── Phase "verify": 验证服务可用性
    │   │   │   └── TCP端口 + HTTP /health探针
    │   │   ├── Phase "skills": 安装精选技能
    │   │   │   ├── bilingual-pdf-translation（双语PDF翻译）
    │   │   │   ├── paper-to-patent（论文转专利）
    │   │   │   ├── scipilot-writing（学术写作）
    │   │   │   └── 其他精选技能
    │   │   ├── Phase "workspace": 初始化工作区
    │   │   │   ├── 写入SOUL.md（默认人格）
    │   │   │   ├── 写入HEARTBEAT.md（循环自审模板）
    │   │   │   └── 写入IMPROVEMENTS.md（改进记录模板）
    │   │   └── Phase "finalize": 写入默认模型 + compaction保护配置
    │   │
    │   ├── 3. 注册管理员账户
    │   │   └── 首个注册用户自动获得admin角色
    │   │
    │   ├── 4. API密钥设置
    │   │   └── 用户在应用中输入DEEPSEEK_API_KEY
    │   │
    │   └── 5. 启动网关
    │       └── 点击"启动网关" → supervisor接管进程生命周期
    │
    └── [进入主界面，开始使用]
```

### 6.5 断线恢复流程

```
[WebSocket连接异常断开]
    │
    ├── [前端 gatewayStore 检测断开]
    │   │
    │   ├── Step 1: 获取恢复锁
    │   │   ├── tryBeginGatewayRecovery()
    │   │   │   ├── recoveryInFlight=true → 已有恢复进行中，等待
    │   │   │   └── recoveryInFlight=false → 获取锁，进入恢复
    │   │   └── 清理stale状态：
    │   │       ├── 清空ingestQueue（事件队列）
    │   │       ├── 清除重连timer
    │   │       └── 标记连接状态为disconnected
    │   │
    │   ├── Step 2: 指数退避重连
    │   │   ├── 第1次：1s后重试
    │   │   ├── 第2次：2s后重试
    │   │   ├── 第3次：4s后重试
    │   │   ├── ...
    │   │   └── 最大间隔：120s（safety net防死循环）
    │   │
    │   └── Step 3: 重连成功
    │       ├── WebSocket重新握手（connect帧）
    │       ├── 重新订阅会话索引
    │       ├── 对账消息历史（session-key-match + history-backfill）
    │       └── 释放恢复锁（endGatewayRecovery）
    │
    ├── [后端健康看门狗 并行运行]
    │   │
    │   ├── 每10s: TCP端口探活（800ms超时）
    │   ├── 连续失败计数：1 → 2 → 3
    │   │   └── 达到3次 → 判定网关死亡
    │   ├── 推送gateway-supervisor-unhealthy事件
    │   │
    │   └── [自动恢复流程]
    │       ├── force_kill_port_owner(port) → 强杀端口占用进程
    │       ├── kill_orphan_openclaw_processes() → 清理孤儿
    │       ├── wait_for_establish_ready() → 等待配置策略就绪
    │       ├── 重新spawn网关子进程
    │       └── 等待STARTUP_WAIT + HEALTH_POLL → TCP端口就绪
    │
    └── [前后端恢复完成，前端重连成功]
        └── 用户无感知继续使用（可能看到短暂loading状态）
```

---

## 第七章 安全设计

### 7.1 安全设计总览

本软件实施纵深防御策略，在多个层次设置安全控制：

| 安全层次 | 控制措施 |
|---------|---------|
| 编译期 | LTO+strip反编译保护，敏感密钥编译期嵌入 |
| 安装期 | 安装封印HMAC，防止数据库清空后账户劫持 |
| 启动期 | 设备授权验证（CPU指纹+签名），首次注册门控 |
| 认证期 | bcrypt密码哈希，5次失败锁定，token与机器指纹XOR |
| 运行期 | IPC认证拦截，Owner二次验证，CSP策略收紧 |
| 数据层 | 本地存储，API密钥环境变量隔离，secrets vault加密 |
| 审计层 | CLI/敏感操作自动审计落库，90天保留，JSON导出 |
| 更新期 | latest.json SHA-256校验，HTTPS分发 |

### 7.2 用户认证详细设计

- **密码策略**：distribution_policy.rs根据发行档控制
  - 中转站版本：恰好8位纯数字
  - 直连版本：至少8位，同时含英文字母与数字
- **密码哈希**：bcrypt（cost=12），每次登录验证
- **失败锁定**：5次连续失败后锁定账户（lock_until字段），需管理员解锁
- **Token生成**：UUID v4，登录时生成
- **Token存储**：前端仅内存保存；持久化时经机器指纹XOR加密存入auth_tokens表
- **Token过期**：可配置过期时间（按发行档），auth_cleanup_expired_tokens定期清理
- **登录记录**：每次登录尝试（成功/失败）记录到login_attempts表

### 7.3 权限分级控制

| 权限级别 | 可执行操作 | 实现方式 |
|---------|-----------|---------|
| 未登录 | 查看登录/注册界面，检查授权状态 | auth_gate_status，check_license |
| 已登录（普通用户） | 网关操作、会话管理、技能安装、设置修改 | invokeWithAuthRetry自动附带token |
| Owner | 上述全部 + 用户管理、网关配置接管、审计导出、授权签发 | OwnerGate（前端）+ assert_owner（后端） |

### 7.4 设备授权机制

- **指纹采集**：CPU ID（CPUID指令）+ CPU品牌字符串 + 逻辑核心数 + 主机名
- **指纹哈希**：SHA-256（输出64字符hex）
- **授权文件**：license.dat（JSON格式）
  ```json
  {
    "fingerprint": "sha256-hex",
    "signature": "hmac-sha256-signature",
    "issued_at": "2026-06-30T00:00:00Z",
    "expires_at": "2027-06-30T00:00:00Z",
    "note": "optional"
  }
  ```
- **验证流程**：采集当前机器指纹 → 匹配license.dat中的fingerprint → HMAC-SHA256验证signature → 检查expires_at
- **续期提醒**：到期前3天起，前端显示续期提示

### 7.5 通信安全

- **CSP策略**（Content Security Policy）：
  - default-src: 'self' ipc:
  - connect-src: 仅允许localhost/127.0.0.1的ws/wss/http/https
  - script-src: 'self' 'wasm-unsafe-eval'
  - frame-ancestors: 'none'
  - object-src: 'none'
- **IPC安全**：Tauri框架内置序列化，不暴露外部网络端口
- **WebSocket**：仅连接本地127.0.0.1，不涉及跨网络通信

### 7.6 构建安全（Release）

- **Rust编译优化**：
  - lto = true（链接时优化）
  - opt-level = "s"（体积优化）
  - strip = "symbols"（剥离符号表）
  - codegen-units = 1（单一编译单元）
  - panic = "unwind"（不abort，保持catch_unwind可用）
- **前端构建**：
  - Vite sourcemap: false
  - minify: true
- **禁止打包内容**：.env、API Key、Owner明文密码、dev-activation.secret

### 7.7 操作审计

- **自动记录**：以下操作触发audit_insert自动落库
  - CLI命令执行（网关start/stop/restart）
  - 敏感UI操作（Absolute Control、配置写入、授权签发）
- **审计字段**：category（模块）、action（动作）、detail（详情JSON）、created_at
- **查询与导出**：audit_list（分页查询）、audit_export_json（完整导出），均需Owner权限
- **自动清理**：超过90天或超过50000条记录时自动清除最旧记录

---

## 第八章 界面说明

### 8.1 主界面布局

本软件主界面采用经典的IDE三栏布局：

```
┌──────────────────────────────────────────────────────────┐
│ WindowTitleBar（自定义标题栏，支持拖拽、最小化/最大化/关闭） │
├────────┬───────────────────────────────────┬─────────────┤
│Sidebar │                                   │ TaskRight   │
│        │                                   │ Panel       │
│ ┌────┐ │        CenterWorkspace            │             │
│ │会话│ │  ┌─────────────────────────────┐  │ 步骤流水线  │
│ │列表│ │  │ ChatPanel（聊天面板）        │  │             │
│ │    │ │  │                             │  │ 工具调用    │
│ │    │ │  │ 消息列表（虚拟滚动）          │  │             │
│ │    │ │  │                             │  │ 工作区制品  │
│ │    │ │  ├─────────────────────────────┤  │             │
│ │    │ │  │ ChatComposerBar（输入栏）    │  │             │
│ │    │ │  └─────────────────────────────┘  │             │
│ └────┘ │                                   │             │
├────────┴───────────────────────────────────┴─────────────┤
│ StatusBar（网关状态、模型名称、连接指示灯）                  │
└──────────────────────────────────────────────────────────┘
```

### 8.2 主要功能模块界面

#### 8.2.1 登录界面

- 软件名称与LOGO展示
- 用户名/密码输入框
- 登录按钮
- 注册切换（首次使用时）
- 密码策略提示（8位数字 / 字母+数字混合）
- [截图占位：登录界面]

#### 8.2.2 聊天主界面

- 左侧会话列表：支持搜索、新建、删除、重命名
- 中央聊天面板：消息气泡（用户/助手）、Markdown渲染、思考过程折叠
- 底部输入栏：文本输入 + 发送按钮 + 语音输入 + 文件上传 + 模型选择器
- 右侧任务面板：当前任务的步骤流水线、工具调用记录
- 顶部模型选择器：快速切换AI模型
- [截图占位：聊天主界面]

#### 8.2.3 设置面板

- Tab切换：外观 / 账户 / 服务 / API密钥 / 授权 / 高级
- 外观设置：亮色/暗色/自动配色方案、字体大小
- 账户设置：修改密码、用户管理（Owner可见）
- 服务设置：网关启停、健康状态、端口、内存限制
- API密钥设置：按发行档配置密钥
- 授权状态：设备指纹、授权有效期、续期操作
- [截图占位：设置面板]

#### 8.2.4 技能工坊

- 岗位技能生成：选择使用场景，AI辅助生成SKILL.md
- 技能草稿编辑：编辑后一键安装到工作区
- 社区技能浏览：浏览已打包的社区技能列表
- 安装管理：已安装技能列表，支持查看和删除
- [截图占位：技能工坊界面]

#### 8.2.5 控制台

- 网关CLI输出实时查看
- 原始RPC请求/响应调试工具
- 审计日志查看与JSON导出（Owner）
- 网关能力列表与开关
- [截图占位：控制台界面]

---

## 第九章 关键技术实现

### 9.1 独占式进程监管

本软件实现了对本地AI网关进程的独占式生命周期管理：

1. **单飞锁**：使用Mutex确保同一时刻只有一个ensure操作在执行，防止并发spawn导致多实例
2. **子进程追踪**：spawn时记录Child handle，通过try_wait()非阻塞轮询子进程状态
3. **端口探活**：通过TCP连接检测端口是否处于监听状态，比HTTP健康检查更轻量（800ms超时）
4. **分级判断**：
   - TCP不可达 → 进程可能已死
   - TCP可达但HTTP /health失败 → 进程存活但功能异常
5. **自动恢复**：连续3次TCP不可达后，强制kill端口占用进程，清理孤儿，重新spawn

### 9.2 配置接管机制

通过establish_absolute_control实现网关配置的完整接管：

1. **Adopt**：发现本机OpenClaw环境，选择最优数据目录
2. **Repair**：修复openclaw.json兼容性问题（openclaw_compat字段）
3. **Defaults**：写入模型默认值（deepseek-v4-flash）和compaction保护
4. **Policy**：写入YunTuAI安全策略（allowedOrigins限制为localhost）
5. **Enforce**：应用配置并验证
6. **Seal**：加密secrets目录
7. **Mark**：设置ESTABLISH_COMPLETE标志，允许网关spawn

整个pipeline由catch_unwind保护，即使某步失败也不会阻止应用启动。

### 9.3 消息去重机制

由于WebSocket事件可能重复投递（重连时），前端实施多层去重：

1. **序列号去重**：每个事件携带递增序列号，已处理的序列号不再重复处理
2. **内容哈希去重**：计算消息内容的哈希值，相同哈希的消息跳过
3. **最终事件去重**：assistant/tool_result最终事件去重，确保每个会话只保留一份最终结果

### 9.4 断线恢复单飞

使用全局单飞锁防止并发的恢复操作互相干扰：

- **tryBeginGatewayRecovery()**：检查recoveryInFlight标志，false时设置为true并返回成功
- **endGatewayRecovery()**：恢复完成后释放锁
- **isGatewayRecoveryInFlight()**：其他代码路径检查是否正在恢复中
- **安全网超时**：120秒强制超时，防止死锁

---

## 第十章 测试与质量

### 10.1 测试体系

| 测试类型 | 工具 | 覆盖范围 |
|---------|------|---------|
| 前端单元测试 | Vitest | Store、工具函数、IPC封装、消息去重 |
| Rust单元测试 | cargo test | 数据库、认证、授权签名 |
| 类型检查 | tsc --noEmit | 全量TypeScript类型安全 |
| 代码检查 | cargo clippy -D warnings | Rust代码质量 |
| 端到端检查 | check:desktop:full | 构建+测试+Gateway探针 |
| 运行时模拟 | simulate:runtime | 多轮连接稳定性 |

### 10.2 构建质量门禁

```bash
npm run check        # typecheck + test + build
npm run check:full   # check + cargo clippy
npm run test:app     # typecheck + vitest + cargo test
```

---

## 第十一章 运行环境

### 11.1 硬件要求

| 项目 | 最低要求 | 推荐配置 |
|------|---------|---------|
| CPU | x86_64双核 | x86_64四核及以上 |
| 内存 | 4 GB | 8 GB及以上 |
| 硬盘 | 2 GB可用空间 | 10 GB可用空间 |
| 网络 | 首次安装需联网 | 持续联网（使用在线API时） |

### 11.2 软件要求

| 依赖 | 要求 | 说明 |
|------|------|------|
| Windows | 10/11（64位） | 主要运行平台 |
| macOS | 12.0+ | 辅助运行平台 |
| WebView2 | 自动引导安装 | Windows平台Web视图运行时 |
| Node.js | 20+（安装包内置便携版） | 网关运行时依赖 |

### 11.3 开发环境

| 工具 | 版本要求 | 说明 |
|------|---------|------|
| Node.js | >=20 LTS | 前端开发与构建 |
| Rust | 最新stable | 后端开发与编译 |
| pnpm/npm | 最新版 | 包管理 |
| Git | 最新版 | 版本控制 |

---

## 附录A：源代码组织结构

### Rust源码（src-tauri/src/，35个文件，约14500行）

```
main.rs                         # 程序入口
lib.rs                          # Tauri初始化 + 90+ IPC注册
auth.rs                         # 用户认证（bcrypt密码、session token）
owner.rs                        # Owner管理员
license.rs                      # 设备授权（CPU指纹+离线签名）
install_seal.rs                 # 安装封印HMAC
db.rs                           # SQLite数据库（7张表CRUD+备份）
gateway_supervisor.rs           # 网关进程独占监管+健康看门狗
openclaw_control.rs             # 网关配置接管pipeline
openclaw_exec.rs                # 子进程启停+孤儿清理
openclaw_bootstrap.rs           # 首次启动解压运行时
openclaw_provision.rs           # 首次配置运行流程
openclaw_migrate.rs             # 传统目录→受管目录迁移
openclaw_platform.rs            # 平台相关路径探测
openclaw_runtime.rs             # 运行时偏好管理
openclaw_env.rs                 # 环境变量/API密钥管理
openclaw_data_roots.rs          # 多数据根扫描与切换
openclaw_relay_waf_patch.rs     # 中继API WAF User-Agent补丁
openclaw_skill_bootstrap.rs     # 精选技能首次安装
openclaw_workspace_bootstrap.rs # 工作区初始化（SOUL.md等）
openclaw.rs                     # 网关路径探测+凭证读取
chat_files.rs                   # 聊天附件管理
cli.rs                          # 网关CLI命令封装
module_manager.rs               # MCP模块管理
updater.rs                      # 应用更新检查
image_gen.rs                    # AI图像生成
skill_studio.rs                 # 技能工坊后端
paths.rs                        # 路径工具
app_launch.rs                   # 自启动+窗口管理
app_shutdown.rs                 # 关闭清理
task_utils.rs                   # 任务工具函数
distribution_policy.rs          # 发行档策略
agnes_dev.rs                    # 调试用AI模型（仅debug）
```

### TypeScript源码（src/，约230个文件，约35000行）

```
src/
├── main.tsx                    # React应用入口
├── App.tsx                     # 根组件
├── index.css                   # 全局样式（Apple风格CSS变量）
├── components/                 # UI组件
│   ├── auth/                   # 登录/注册/授权界面
│   ├── chat/                   # 聊天面板（消息列表/输入/Markdown渲染）
│   ├── console/                # 控制台（CLI输出/RPC调试/审计查看）
│   ├── dashboard/              # 仪表盘（网关状态/代理管理）
│   ├── imageStudio/            # 图像生成工作台
│   ├── layout/                 # 应用布局（侧边栏/顶栏/工作区）
│   ├── motion/                 # GSAP动画组件
│   ├── openclaw/               # 网关专用界面（启动门控/配置进度）
│   ├── owner/                  # Owner管理面板
│   ├── settings/               # 设置面板（外观/账户/服务/API/授权）
│   ├── skills/                 # 技能工坊界面
│   ├── steps/                  # 任务步骤流水线
│   ├── ui/                     # 通用UI组件
│   └── workspace/              # 工作区面板
├── stores/                     # Zustand状态管理（12个Store）
├── lib/                        # 业务逻辑库
│   ├── openclaw/               # 网关客户端/WebSocket/RPC（36个文件）
│   ├── chat/                   # 会话管理/消息处理（6个文件）
│   ├── skills/                 # 技能发现/目录（5个文件）
│   ├── auth/                   # 认证/密码策略（2个文件）
│   ├── models/                 # 模型选择与目录（3个文件）
│   └── image-gen/              # 图像生成（1个文件）
├── hooks/                      # React Hooks
└── types/                      # TypeScript类型定义
```

### 代码规模统计

| 语言 | 文件数 | 代码行数 | 占比 |
|------|--------|---------|------|
| Rust | 35 | ~14,500 | 29% |
| TypeScript/TSX | ~230 | ~35,000 | 71% |
| **合计** | **~265** | **~49,500** | **100%** |

---

> **文档结束**
>
> 软件名称：云图AI桌面端控制系统（YunTuAI）
> 版本：V1.3.7
> 著作权人：深圳市浩瀚云图信息科技有限责任公司
> 开发完成日期：2026年06月30日
>
> 本文档为计算机软件著作权登记申请材料之《软件设计说明书》。
