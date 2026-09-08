# 技术方案：将 Magic Context 面板接入 OpenChamber

> 状态：技术方案（设计评审稿）
> 范围：把独立 Magic Context dashboard（Tauri + Rust + SolidJS）的能力以服务端 TS + React 的方式迁入 OpenChamber（web / Electron 桌面优先），本方案基于对 OpenChamber 与 magic-context 两个仓库当前源码的分析给出，不是对 `docs/handover-magic-context-dashboard.md` 的照搬，两处关键偏差在 §2.4 说明。
> 语言：按维护者要求，正文使用简体中文；仓库内代码、注释、接口文档仍遵循英文约定。

---

## 1. 结论速览

| 问题 | 结论 |
|---|---|
| 是否值得迁入 | 值得。OpenChamber 的服务器天然常驻并保活一个 managed OpenCode 进程，与 MC 数据所在环境（同机、同用户）一致，是 dashboard 的合理宿主。 |
| 迁入本质 | 重写而不是搬运：SolidJS 面板 → `packages/ui` 的 React 面板；Rust/直读 DB 数据层 → OpenChamber 服务器里一个薄代理模块，**读取走插件自带的 loopback RPC**，不在 OpenChamber 里写任何 SQL。 |
| 与参考方案最大差异 | 参考方案主张"从插件抽一个只读 data-access 库 import 进 OpenChamber 服务器"；本方案改为"**扩展插件已有 RPC 方法族**，OpenChamber 作为 RPC 客户端消费"。理由见 §2.4。 |
| v1 边界 | 同机、同用户、managed OpenCode 在跑且装了 magic-context 插件（web + Electron）。VS Code / mobile / 外部 OpenCode / tunnel 远程场景在 UI 上表现为明确的"不可用"空态，不做假数据。 |
| 姿态 | 只读优先的检视面板；少量写入（笔记/记忆/配置）必须走插件语义。 |
| OpenChamber 新增依赖 | 无（不引入 SQLite 驱动、不引入跨仓库包）。 |

---

## 2. 现状分析（决定设计的事实基础）

### 2.1 源系统（magic-context 仓库）当前形态

独立 monorepo（`/workspace/magic-context`，pnpm），核心是插件 `@cortexkit/opencode-magic-context`（当前 v0.41.4）。与参考文档写作时相比，有三个变化直接改变最优设计：

1. **插件已经有运行时无关的 SQLite 层**（`shared/sqlite.ts`）：同一份产物在 Bun（当前 OpenCode 发行版）下用 `bun:sqlite`，在 Node/Electron（Pi、OpenCode Desktop）下用 `node:sqlite`，动态导入 + 运行时探测，无原生依赖。迁移、schema fence、版本拒开（"upstream migration lane 更新于本二进制"）都在插件内。
2. **插件已经有一个鉴权的 loopback RPC 服务器**（`shared/rpc-server.ts` + `rpc-client.ts` + `rpc-utils.ts`）：
   - 每个（storageDir, 项目目录）一个进程，端口文件写在 `storageDir/rpc/<projectHash>/port-<pid>.json`，内容是 `{ port, pid, started_at, token, kind, harness }`；
   - HTTP `/rpc`（带 bearer token，常量时间比较）+ WS `/ws`（5 秒鉴权超时，用于通知推送）；
   - 健康检查免鉴权，业务方法鉴权，避免"猜到端口就能驱动副作用方法"。
   - 当前已注册的方法（`plugin/rpc-handlers.ts`）面向 OpenCode TUI/伴随态：`sidebar-snapshot`、`status-detail`、`embed-detail`、`compartment-count`、`recomp`、`upgrade`、`dismiss-upgrade-reminder`、`toast-duration`、通知等。**尚不覆盖 dashboard 的检视查询面**，这是 v1 要在插件侧补的。
3. **插件区分 harness（opencode / pi / omp）**：`context.db` 是一台机器上的共享库，会话行带 `harness` 列，日志/临时目录按 harness 分置（`$TMPDIR/<harness>/magic-context/`）。

数据路径（`shared/data-path.ts`、`storage-db.ts`）：
- DB：`<XDG_DATA_HOME 或 ~/.local/share>/cortexkit/magic-context/context.db`（可被存储目录相关环境变量覆盖）；
- 项目配置：`<project>/.cortexkit/magic-context.jsonc`；用户配置在 `~/.config/cortexkit/` 下；
- 日志：`$MAGIC_CONTEXT_LOG_PATH` 或 `$TMPDIR/<harness>/magic-context/magic-context.log`。

### 2.2 目标系统（OpenChamber）当前形态（本方案依据）

- **五端共享一套 `packages/ui`**（React 19 + Tailwind，源码级被 web/Electron/VS Code/mobile 直接编译）。跨端共享契约是硬约束（见 `AGENTS.md`）；数据访问经 `RuntimeAPIs` / `runtimeFetch` / runtime 探测抽象（`packages/ui/src/lib/runtime-fetch.ts`、`runtime-switch.ts`），面板不得硬编码 `fetch`。
- **真正的后端在 `packages/web`**：`server/index.js` 是 Express 5 组合根（纯 ESM JS，无打包器），负责静态托管、OpenChamber 领域 API、到 OpenCode 的反向代理、WS/SSE 传输宿主、认证门卫、进程编排。
- **领域模块是工厂模式**：`server/lib/<domain>/{routes.js,runtime.js,…}`，导出 `registerXxxRoutes(app, options)`，在 `server/index.js` 挂载（现有挂载块约在 1083-1090、1900+ 行）。每个域配 `DOCUMENTATION.md`。域逻辑放独立模块、入口保持薄，是仓库硬性规则。
- **OpenChamber 专属路由前缀** `/api/openchamber/*`（如 `/api/openchamber/events`），走在既有 UI 认证门卫之下（session JWT / passkey / client token），WS 用 short-lived `oc_url_token` 走 upgrade。新路由组复用这套，不发明新 token 方案。
- **服务器保活 managed OpenCode**：以外部子进程方式 spawn（Unix 下 `detached`，自有进程组），记录 pid 于 managed-process registry，启动时 probe 端口、轮询 `/global/health` 就绪、心跳监控自动重启；开发态 HMR 用全局状态保活子进程。
- **无 SQLite 依赖**：服务器当前没有任何 SQLite 驱动；Node 引擎 `>=22.0.0`（`node:sqlite` 要到 22.13 才免 flag），开发/打包用 Bun 1.3.14。
- **约束**：除非明确要求否则不加依赖；`changelog/` 只读；改动最小化；不给仓库加 secret。

### 2.3 OpenChamber 与 MC 数据环境的契合点

- managed OpenCode 子进程继承 OpenChamber 服务器进程的 OS 用户环境 → 两者解析到同一 `XDG_DATA_HOME` / 同一 `context.db`（`OPENCHAMBER_DATA_DIR` 只影响 `~/.config/openchamber`，不干扰 MC 路径）。
- 服务器把 managed OpenCode **拉起即保活** → "MC 的 RPC 进程活着"几乎等价于"OpenChamber UI 可达"。这让"消费插件 RPC"成为可行主通道（对独立 Tauri 工具则不成立，那是它需要直读 DB 的根本原因）。
- 目录语义对齐：OpenChamber 的会话/工作树以目录为界，插件 RPC 端口文件也按（storageDir, 目录）落盘，天然一一对应。

### 2.4 与参考方案的差异（为什么不是照做）

| # | 参考方案 | 本方案 | 原因 |
|---|---|---|---|
| 1 | 从插件抽 `@magic-context/data-access` TS 库，OpenChamber 服务器 import 它直读 `context.db` | **复用并扩展插件已有 RPC**，OpenChamber 服务器做薄客户端 | 插件已实现"运行时无关 sqlite + 鉴权 RPC + schema fence"，等于现成且更安全的读取通道；跨仓库（pnpm vs bun workspace）、跨包名引入 TS 源码与发布/版本同步成本高，且撞上 OpenChamber"未经要求不加依赖"的硬约束；直读要求 OpenChamber 复制 schema fence / busy_timeout / 迁移拒开逻辑，违反"单一属主、零 SQL 复制"。 |
| 2 | OpenChamber 需新增 SQLite 驱动（node:sqlite vs better-sqlite3 决策） | **主通道不引入 SQLite**；离线直读仅作为 Phase 5 可选回退 | 依赖矩阵（Node>=22.0 的 flag 差异、Bun、Electron ABI）和原生模块成本全部消失。参考文档担心的驱动选型问题在本方案中不存在。 |
| 3 | 直接写库的少量写路径由 OpenChamber 侧背书 | 写入全部经插件 RPC 方法，由插件维护其写语义（幂等、epoch、config 注释保留） | 避免在仓库外另起"绕过插件记账的写路径"（参考文档 §7.4 自己也反对）。 |
| 4 | 假设 MC 数据读全面向"无进程在场"的历史检视 | 面向"OpenChamber 正在使用、managed OpenCode 常驻"的活数据检视 | 契合 OpenChamber 真实运行模型；崩溃/停机取证类诉求降级为 Phase 5 回退，不阻塞 v1。 |

其余沿用参考文档的合理部分：同机环境共享是正确性门槛（§2.2 已说明成立条件与例外）；面板惰性加载与分页纪律；gating 与空态；不重造 UI 组件与设计令牌；跨端共享契约内做，禁止 web-only 例外。

---

## 3. 目标架构

```text
┌────────────── packages/ui（React 19，跨端共享契约）──────────────┐
│  MC 面板（按面板逐个迁入，惰性加载）                                  │
│   projects / memories / sessions / cache / dreamer /                │
│   config / logs / workspaces / user-memories                        │
│   数据层：typed MC API client（走 runtimeFetch，runtime 可探测）     │
└──────────────┬──────────────────────────────────────────────────────┘
               │ HTTP(S)，既有 UI 认证
┌──────────────▼────────────── packages/web/server ──────────────────┐
│  lib/mc-dashboard/（新域，工厂模式）                                  │
│   routes.js  registerMcDashboardRoutes(app, options)                │
│    前缀 /api/openchamber/mc/*，复用 ui-auth 门卫                     │
│   runtime.js + rpc-client.js（发现端口文件 → 鉴权调用 → 请求成形）     │
│   probe.js（存在性探测，产出 Gating 状态，不读 schema）               │
└──────────────┬──────────────────────────────────────────────────────┘
               │ loopback HTTP，仅本机；bearer token 来自端口文件
┌──────────────▼────── managed OpenCode（OpenChamber 保活）──────────┐
│  magic-context 插件                                                  │
│   rpc-server（既有，鉴权）  ← 新增只读 viewer/* 方法族（复用内部查询） │
│   storage-db（schema fence / 迁移属主，全部查询留在插件内）           │
└──────────────┬──────────────────────────────────────────────────────┘
               │ bun:sqlite / node:sqlite（插件内部，运行时无关）
┌──────────────▼──────────────────────────────────────────────────────┐
│  ~/.local/share/cortexkit/magic-context/context.db                  │
│  + .cortexkit/magic-context.jsonc（项目）/ ~/.config/cortexkit/（用户）│
│  + $TMPDIR/<harness>/magic-context/*.log                            │
└─────────────────────────────────────────────────────────────────────┘
```

分层原则：**UI 只认识 OpenChamber 的 REST；OpenChamber 服务器只认识插件的 RPC；schema 与 SQL 只存在于插件。** 这与 OpenChamber 已经为 OpenCode 做的"薄代理 + 域路由"是同一种分层。

---

## 4. 数据通道设计

### 4.1 发现与鉴权（服务器 → 插件 RPC）

- 服务器已知 managed OpenCode 的工作目录与用户数据环境；解析 MC storage dir 的规则在插件 `data-path.ts`，OpenChamber 侧只做"同一套环境变量 + 同一目录算法"的最小子集（路径拼装），不读 DB 内容。
- 在每个（storageDir, 目录）的 `rpc/` 目录里发现**活着的** `port-*.pid.json`：文件内的 `pid` 存活 + `kind/harness` 匹配 opencode 才采用；多个候选取最新 `started_at`。
- 每次调用携带文件内的 `token`；端口失效或进程重启后，客户端重解析（参考插件自带 `rpc-client.ts` 的重试与重解析策略，重试上限与退避对齐 OpenChamber 的传输习惯）。
- 服务器同时维护一个小的进程存活缓存 + 失效即清，不做跨请求常驻长连接（除非实时面板需要，见 §4.4）。

### 4.2 插件侧要补的只读方法族

v1 方法 = 参考文档 §5 清单去掉"只能靠插件内部状态"的部分，映射为 RPC 方法名，全部复用插件已有查询函数，**不新写 SQL**：

- `viewer.ping`（免鉴权健康/存在性，返回插件版本 + schema 状态）
- `viewer.projects` / `viewer.projectDetail`
- `viewer.memories`（分页/状态/类别/搜索）、`viewer.memoryStats`、`viewer.primers`
- `viewer.sessions`（分页）、`viewer.sessionDetail`、`viewer.sessionMessages`（惰性分页，28MB 级载荷走页）、`viewer.sessionCacheEvents`（封顶）、`viewer.compartments` / `sessionFacts` / `sessionNotes` / `smartNotes`
- `viewer.cacheStats` / `viewer.cacheEvents`
- `viewer.dreamerState` / `viewer.dreamRuns` / `viewer.dreamRunMemoryChanges`
- `viewer.config`（用户/项目）、`viewer.logPaths`、`viewer.logEntries`（封顶、尾随）
- `viewer.workspaces`、`viewer.userMemories`
- 写入方法按语义逐个随插件评审加入（dismiss note、记忆状态批量、config 保存），**每个写方法都要插件维护者确认其记账语义**，否则 v1 只读。

所有会话/缓存类方法默认带 harness 过滤，UI 提供"只看 OpenCode / 全部历史"切换（读共享库时 Pi 等 harness 行仍可见，属设计内行为，不是泄漏）。

### 4.3 面板数据边界（防呆边界，来自 dashboard 血泪经验）

- sessions 列表分页；`sessionMessages` 必须惰性 + 分页，绝不整包拉取；
- cache events 上限（默认几千条封顶），带分页/过滤；
- log tail 封顶 + 跟随，不无界累积；
- 所有 list-first 交互，点开详情才拉重载荷。

### 4.4 实时

- log tail / cache 时间线如要实时：优先走插件 RPC 的 WS `/ws` 通知通道，由服务器转成 OpenChamber 的 SSE/WS 传输助手给 UI（对齐参考文档"复用传输助手，不各面板各自轮询"）。v1 允许先做"有界轮询"，但要从单个服务器的探测/轮询收敛为单通道，禁止每面板每标签页各自 busy-poll。

---

## 5. OpenChamber 服务器模块设计

新增域 `packages/web/server/lib/mc-dashboard/`（对齐仓库域结构）：

```
lib/mc-dashboard/
├── DOCUMENTATION.md     # 域职责、路由、正确性不变量、运行时可探测状态
├── routes.js            # registerMcDashboardRoutes(app, options)
├── runtime.js           # createMcRuntime({ env, paths, logger, resolveActiveDirectory, fetch }) 
├── rpc-client.js        # 端口文件发现 + bearer 调用 + 重解析/超时 + 进程存活缓存
├── probe.js             # 存在性探测（→ 门控状态），不做任何 DB 直读
└── *.test.js            # 针对发现/鉴权/超时/门控的单元测试
```

- 在 `server/index.js` 挂载点追加 `registerMcDashboardRoutes(...)`，传入 runtime 依赖；认证走既有 `/api` 门卫，路由前缀 `/api/openchamber/mc/*`（如 ui-auth 的路径白名单机制需要放行特定路径，则按现有 `/api/openchamber/events` 的做法追加）。
- `resolveActiveDirectory`：UI 请求携带会话目录（`activeDirectoryKey`），服务器据此选端口文件；目录缺省时用 managed OpenCode 当前工作目录。
- RPC 调用的失败语义遵循 OpenChamber 不变量：**fetch 失败不得伪装成权威空成功**；端口不存在/进程不在 → 明确的状态（Gating: unavailable），而不是返回空列表；超时/鉴权失败 → 明确报错，面板显示对应空态。

---

## 6. UI 面板设计（packages/ui）

- 数据层：在 `packages/ui/src/lib/` 下按既有模式新增 typed MC client（参照 `sessionKnowledgeApi.ts`、`agentMemoryApi.ts` 等既有 xxxApi 的形态），全部走 `runtimeFetch` + runtime 探测。**MC 通道只有"有服务器"的 runtime 才有**；VS Code（bridge、无本机服务器）与 mobile（远程服务器、无本机库）下探测返回"不支持"，入口隐藏或显示禁用态，绝不在这些 runtime 上假装有数据。
- 挂载点：作为顶级视图/工作区页签引入（面板量大、独立性高，不适合塞进 Settings 分节），复用 `layout/` 的 Sidebar / MainLayout 等既有原语。具体挂载位置（顶级导航项名称、是否需要项目上下文）留作 UI 阶段的产品决策，§10 开放问题列出。
- 面板逐个迁入，顺序建议：projects → memories → sessions（compartments/facts/notes）→ cache → dreamer → config → logs → workspaces/user-memories。每个面板落地时即遵守 §4.3 载荷边界 + 空态。
- 样式用既有设计令牌与组件，不复刻 dashboard 的 SolidJS CSS；图标、颜色、深浅色随主题系统。

---

## 7. Gating 与空态（对外可见行为）

统一入口门控的判定链（probe 输出，服务器在 `/api/openchamber/mc/meta` 返回，UI 渲染）：

1. 当前 runtime 无服务器通道 → MC 入口隐藏（VS Code / mobile）；
2. 服务器在，但 managed OpenCode 未在跑 / 插件未装未启用 → 显示"需要在当前 OpenCode 安装并启用 magic-context 插件"（附命令提示），不显示任何数据面板；
3. 插件在跑但 RPC 健康检查返回"schema 需要迁移 / 版本超 fence" → 显示"请在插件侧执行 doctor 迁移后重试"，**OpenChamber 绝不代跑迁移**；
4. 以上都通过 → 渲染面板。

每个域（无记忆、无 dreamer 运行等）是空态 UI，不是报错墙。Gating 状态必须来自 probe 的权威结果，不允许前端猜测。

---

## 8. 正确性不变量（迁移期间不可破坏）

- **同机同用户环境共享是门槛**：默认成立（子进程继承环境）；容器/自定义 env 注入/tunnel 远程/VS Code 内嵌异环境等例外，一律表现为"不可用"空态，不伪造数据。实现期在 DOCUMENTATION.md 里记录每类部署的验证方式。
- **零 SQL/零 schema 复制进 OpenChamber**：唯一例外是将来若加离线直读回退（§9 Phase 5），且该回退必须显式、可关、默认关。
- **不迁移、不写库、不 BEGIN IMMEDIATE**：写操作全部经插件 RPC 由其背书。
- **失败不伪装成功**；**面板空态 ≠ 数据为空**。
- **共享 UI 契约**：MC 面板在 web + Electron 至少可跑，其余 runtime 显式 gated，不做"web-only 侥幸成立"。
- **依赖纪律**：v1 不新增任何包依赖。
- **改动最小**；`changelog/` 只读（本方案文档不进 changelog）；无新增 secret。

---

## 9. 分阶段实施计划

### Phase 0 — 复勘与锁定（写代码前）
- 在 magic-context 仓库锁 RPC 协议细节：方法签名风格、错误结构、分页/封顶语义、harness 过滤、token 轮换时机、WS 通知 payload；产出 v1 方法清单（§4.2 逐条确认可实现性与性能量级）。
- 确认 OpenChamber 侧启动时序：服务器先 spawn managed OpenCode 再 serve UI → 面板首查时 RPC 已就绪；若 opencode 在 UI 首屏后才 ready，probe 需容忍短暂 pending 态。
- 敲定挂载点（§6）与 ui-auth 白名单改动范围。
- 验证环境共享假设在 dev 脚本与 Electron 打包两种跑法下都成立（写一个 probe 冒烟测试脚本）。

### Phase 1 — 插件侧（在 magic-context 仓库）
- 新增 §4.2 只读 `viewer/*` 方法族，复用内部查询；给 RPC 方法加版本字段或方法级 fence（与 DB schema fence 同思路），便于插件/服务器各自独立发版时优雅降级。
- 冒烟与负载测试：大会话消息、30k+ cache events 的分页读取基准，验证不拖垮插件主进程。
- 产出方法清单文档（该仓库 DOCUMENTATION 或 dashboard 同源）。

### Phase 2 — OpenChamber 服务器
- 落地 `lib/mc-dashboard/`（§5），实现发现/鉴权/超时/重解析/门控，逐路由映射 §4.2 方法。
- 测试：`bun test` 域内单测（发现、鉴权失败、超时、Gating 状态机）；跨仓库契约用真实 managed OpenCode + 装了插件的目录做一次手工联调清单。

### Phase 3 — UI 面板
- 数据层 client + probe 驱动的入口 gating 先行；然后按 §6 顺序逐面板迁入，每面板带空态与载荷边界。

### Phase 4 — 收尾
- 更新两侧 owning 文档；参考文档降级为背景资料并指向本文档；跑全套验证（§11）。

### Phase 5（可选，不进 v1）
- "无进程在场"的离线直读回退：仅在需要停机取证类场景时评估，且遵循：运行时探测 `node:sqlite`/`bun:sqlite`（复用插件 sqlite.ts 的思路）、只读打开、busy_timeout、版本 fence 只读校验，默认关闭、功能开关开启。

---

## 10. 风险与开放问题（实现前需维护者裁决）

1. **RPC 通道 = 需 managed OpenCode 在跑**。OpenChamber 保活模型下基本成立，但"用户手动关了 opencode / opencode 崩溃且心跳重启前"的窗口期面板显示什么（推荐：明确 unavailable 空态 + 重试），需要拍板。
2. **离线直读回退是否值得做**（Phase 5）——会引入 SQLite 与 schema fence 的维护面，与"零复制"不变量相抵触，建议 v1 不做，除非有真实的停机取证需求。
3. **挂载点**：顶级导航项 vs 项目级工作区页签 vs 会话侧栏扩展。
4. **独立 Tauri dashboard 的去留**：参考文档建议保留 Rust 层的退役计划，本方案视角一致：能力迁入后 Rust 数据层应退役；是否保留 Tauri 壳承载共享 UI 属产品决策。
5. **RPC 写方法（dismiss note、记忆状态、config 保存）的语义背书**由插件维护者逐条确认；v1 只读之外的写入范围要显式圈定。
6. **VS Code / mobile 是否值得后续做本机通道**：v1 为 gated 空态；若有强需求，VS Code 可走扩展宿主内嵌同一 RPC client（与服务器同逻辑），mobile 只能依赖远端服务器同机场景，大概率长期不可用。

---

## 11. 成功标准（验证清单）

- 在一台装有 magic-context 插件、OpenChamber 以 web 或 Electron 跑、managed OpenCode 存活的机器上：能浏览项目与记忆；打开会话看到 compartments / facts / notes；看 cache 命中时间线；看 dreamer 运行；读配置；尾随日志——全部走 MC 入口。
- 未装插件 / opencode 不在场 / schema 超版本三种情况下：UI 是明确的空态或引导态，不是报错墙，也不显示"看起来成功"的空数据。
- OpenChamber 仓库内搜不到任何针对 `context.db` 的手写 SQL/列名知识（唯一合法来源是插件 RPC 契约）。
- v1 无新增包依赖；`packages/ui` 的 MC 面板通过与既有 section 相同的运行时契约检查（web + Electron 手测），type-check、lint、相关单测全绿。
- 30k 级 cache events 与 28MB 级会话消息加载不卡 UI（分页生效，实测基准记录在案）。

---

*关联源码（本方案依据）：*
OpenChamber：`packages/web/server/index.js`、`packages/web/server/lib/opencode/`（lifecycle、managed-process-registry、feature-routes-runtime、openchamber-routes）、`packages/web/server/lib/ui-auth/`、`packages/ui/src/lib/runtime-fetch.ts`、`runtime-switch.ts`、`packages/ui/src/components/sections|layout/`。
magic-context：`packages/plugin/src/shared/{rpc-server.ts,rpc-client.ts,rpc-utils.ts,sqlite.ts,data-path.ts}`、`packages/plugin/src/plugin/rpc-handlers.ts`、`packages/plugin/src/features/magic-context/storage-db.ts`。
前身：`docs/handover-magic-context-dashboard.md`。
