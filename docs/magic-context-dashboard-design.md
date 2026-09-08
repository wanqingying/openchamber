# 技术方案：将 Magic Context 面板接入 OpenChamber

> 状态：设计已按维护者约束修订（见下），实现进行中
> 范围：把 Magic Context dashboard 的能力以"只读 Web 面板"形式迁入 OpenChamber，为无法运行 Tauri 桌面 dashboard 的容器/无头环境提供同一份数据检视入口
> 语言：按维护者要求正文用简体中文；仓库内代码、注释、接口文档仍用英文

## 0. 维护者补充的硬约束（2026-09，本文档据此修订）

1. **两个项目都保持开源、直接使用**。magic-context **不 fork、不改其代码**，一律用开源发行版；之前"给插件加 RPC viewer 方法""抽 data-access 库 import"等需要改 magic-context 的路线**全部作废**。
2. 引入 dashboard 的动机是：原版 Tauri dashboard 在**容器/无头环境用不了**，需要一个能在浏览器里复刻它检视能力的办法。
3. OpenChamber 是维护者**个人 fork**，把 dashboard 面板放进 OpenChamber UI 是本次定制的目的。
4. OpenChamber fork 侧**锁死一个 magic-context 版本**（当前基准 0.41.4，schema 上限 84）。之后升级插件由维护者在 OpenChamber 侧显式跟进。
5. **版本对不上就用页面提示文案兜底**，不崩、不假数据。

结论：数据通道回到"**OpenChamber 直接只读 `context.db`**"——这正是原版 dashboard（Rust `db.rs` 直读）被验证过的做法；schema 漂移风险靠"锁版本 + schema 版本门控 + 提示文案"控制。

## 1. 决策速览

| 问题 | 结论 |
|---|---|
| 是否值得迁入 | 值得。OpenChamber 服务器与它管理的 OpenCode 同容器/同用户，天然能解析到同一份 `context.db`；web 端可访问即 dashboard 可访问，恰好补上容器场景。 |
| 数据通道 | OpenChamber 服务器**只读打开 `context.db`**（内置 SQLite，WAL 并发读，绝不写、绝不跑迁移）。 |
| 是否改 magic-context | **不改**。schema/SQL 知识按锁定的 0.41.4 源码在 OpenChamber fork 内实现并随版本跟进。 |
| 版本一致性 | 只读读库内 `schema_migrations` 的持久化版本，> 84 则页面显示"插件版本过新"提示；库缺失显示引导空态。 |
| v1 边界 | web（含容器）+ Electron 桌面可检视；VS Code / mobile 无本机库 → 入口隐藏或不可用态。 |
| 写入 | v1 零写入。面板只读；未来如需写，先评估"绕过插件记账"的风险（参考 dashboard 既有写语义）再单独立项。 |
| 新增依赖 | 无。运行时内置 SQLite（Bun `bun:sqlite` / Node ≥22.13、Electron ≥43 `node:sqlite`）。 |

## 2. 现状分析

### 2.1 源系统（magic-context 0.41.4，本方案依据源码）

- DB 路径：`<XDG_DATA_HOME 或 ~/.local/share>/cortexkit/magic-context/context.db`（`MAGIC_CONTEXT_STORAGE_DIR` 绝对路径可整体覆盖）。
- 迁移登记表 `schema_migrations`（version/description/applied_at）。上游迁移 version < 10000，fork 本地迁移 ≥ 10000。**持久化 schema 版本 = `MAX(version) WHERE version < 10000`**；0.41.4 的 `LATEST_SUPPORTED_VERSION = 84`。插件自身用 `<=84` 做打开门槛，本 fork 复刻同一读法做兼容门槛。
- WAL 模式 + 多 harness（opencode/pi/omp）共享同一库；会话行带 harness 列。
- dashboard（Tauri+Rust）即"另一进程直读同库"的先例：读多写少、从不跑迁移。

### 2.2 目标系统（OpenChamber fork）

- 五端共享 `packages/ui`；真正的后端是 `packages/web/server`（Express 5 组合根 + 工厂式领域模块 `registerXxxRoutes(app, deps)`），本模块遵循该模式。
- 服务器把 managed OpenCode 拉起并保活 → 同容器场景下 opencode 的插件进程与服务器解析到同一 `context.db`（环境共享成立条件见 §4.1）。
- 运行时 SQLite 可用性已核实：web 生产 `node bin/cli.js serve`（Node ≥22.13 有 `node:sqlite`）、开发 Bun（`bun:sqlite`）、Electron 43（内嵌 Node ≥24，`node:sqlite` 可用）。运行时不支持的旧 Node 会得到明确提示，不崩。
- 仓库约束：除非明确要求否则不加依赖；`changelog/` 只读；改动最小化；不给仓库加 secret。

### 2.3 被否掉的路线（历史，勿重启）

- **改插件加 viewer RPC 方法**：需 fork/改 magic-context → 违反约束 1。
- **import 插件数据层 / 抽 `@magic-context/data-access` 包**：需在 magic-context 产出新包 → 同样违反约束 1。
- 直读曾被视为"第四份 schema 复制"而否决（早期方案），在约束 1 + 锁版本前提下，该代价可控且是唯一合规通道。

## 3. 目标架构

```text
┌────────────── packages/ui（React 19，跨端共享契约）───────────────┐
│  MC 面板（惰性加载）：projects / memories / sessions / cache /      │
│   dreamer / config / logs / workspaces / user-memories             │
│  数据层：typed MC API client（走 runtimeFetch）                     │
└──────────────┬─────────────────────────────────────────────────────┘
               │ HTTP(S)，既有 UI 认证
┌──────────────▼──────── packages/web/server ───────────────────────┐
│  lib/mc-dashboard/（工厂模式，只读，无 RPC）                        │
│   paths.js     路径/DB 解析（env 优先序同插件）                      │
│   sqlite.js    运行时 SQLite 选择器（bun/node）+ 只读打开 + busy     │
│   runtime.js   探测/门控状态机 + schema 版本门槛（≤84）             │
│   queries/*.js 按 0.41.4 语义的只读查询（M2 起逐面板增加）            │
│   routes.js    GET /api/openchamber/mc/*（meta + 数据路由）          │
└──────────────┬─────────────────────────────────────────────────────┘
               │ 只读打开（WAL 并发读，busy_timeout，绝不写/迁移）
┌──────────────▼─────────────────────────────────────────────────────┐
│  <XDG_DATA_HOME>/cortexkit/magic-context/context.db（0.41.4，schema≤84）│
└────────────────────────────────────────────────────────────────────┘
```

## 4. 数据访问与正确性

### 4.1 环境共享（成立条件与例外）

服务器进程与 managed OpenCode 子进程同用户同容器时共享 HOME/XDG，解析到同一 DB。容器部署保持单容器内联 opencode 即成立；docker 各自隔离、远程/tunnel、VS Code 内嵌异环境的部署读不到库 → 明确"不可用"，不伪造。

### 4.2 只读纪律

- 只读打开（`readonly`/`readOnly` 按运行时），`PRAGMA busy_timeout`；连读带查单次短开短关。
- 绝不 `CREATE`/`INSERT`/`UPDATE`、绝不触发迁移、不 `BEGIN IMMEDIATE`。
- 损坏/非法库在首次读取时报错 → 归类为 `open-failed`，页面给提示。

### 4.3 版本门槛与提示文案（约束 5 的载体）

`meta` 返回四态（UI 按状态渲染）：
| 状态 | 含义 | 建议文案（示意） |
|---|---|---|
| `available` | schema ≤ 84 | 正常渲染面板，附 `schemaVersion`/`targetMcVersion` |
| `missing-db` | 无库（插件未启用/无数据） | "未检测到 magic-context 数据，请确认当前 OpenCode 已安装启用插件并产生过会话" |
| `schema-too-new` | 库 schema > 84 | "检测到 magic-context 数据 schema v{实际}，当前 OpenChamber 兼容 ≤ v84（目标插件 ≤ 0.41.4），请降级插件或升级 OpenChamber" |
| `sqlite-unavailable`/`open-failed`/`storage-dir-unavailable` | 运行时不支持 / 库损坏 / 目录配置非法 | 对应一句话提示，不渲染面板 |

状态判定在服务器权威完成；前端只消费状态，不自行猜。

### 4.4 失败不伪装成功

- 缺库 = 明确的 `missing-db`，不是空列表。
- 查询阶段的 RPC 超时类问题在本设计中不存在（无 RPC）；SQLite 只读打开/查询失败一律映射为错误态或 5xx，绝不返回"看起来成功"的空数据。

## 5. 查询语义与锁定

- 所有 SQL 与列名知识**只以 0.41.4 源码为准**（`features/magic-context/` 下的 migrations 建表语句与 dashboard `db.rs`/插件 storage 查询为双重参考）。
- 集中放在 `queries/` 一个目录，便于以后换 mc 版本时一次改齐；每份查询带来源注释锚点（文件+版本）。
- 面板清单沿用原 dashboard（见旧版本文档 §5 移交清单）：projects / memories / sessions / compartments/facts/notes / cache / dreamer / config / logs / workspaces / user-memories，全只读。

## 6. UI 设计要点（packages/ui）

- typed MC client 走 `runtimeFetch` + runtime 探测；无服务器 runtime（VS Code bridge）与无本机库 runtime（mobile 远程）→ 入口隐藏或不可用。
- 挂载（M3 落地形态）：**Settings 新页**，slug `magic-context`（group general），复用 `SettingsPageLayout`/`SettingsSection` 原语；导航/搜索经 `metadata.ts` slug 与 `search.ts` 注册进入。完整独立顶级视图留作后续可选演进。
- 文案遵循 locale-ui-patterns：9 条可见文案已同步进全部 12 语言字典（含真实翻译），由 `messages.test.ts` 保证键集一致。
- 载荷纪律沿用 dashboard 教训：sessions 分页、会话消息惰性、cache 事件封顶、log 有界尾随。
- 面板惰性加载；空态 ≠ 错误墙。

## 7. 分阶段实施

- **M1（完成）**：`lib/mc-dashboard/` 只读底座 + `meta` 门控（paths / sqlite / runtime / routes / DOCUMENTATION）+ 接线 `index.js`+`feature-routes-runtime.js`；vitest 全绿、oxlint 干净。
- **M2（完成）**：`queries/` 首个数据面。实现中确认会话列表读的是 OpenCode 自身库（`~/.local/share/opencode/opencode.db`）而非 `context.db`，故首条数据链改为 context.db 属主的 **memories 列表**（分页/过滤/摘要，只读）；`GET /api/openchamber/mc/memories` 已通。会话检视面（含 compartments/facts/notes）需要另外解析 OpenCode 库路径，单独立项（M2b）。
- **M3（完成）**：UI typed client（zod 边界 + DI）+ Settings 新页 `magic-context`（meta 门控态渲染 + memories 只读列表 + 全部 12 语言文案）。余下面板在 M4 逐个扩展。
- **M4**：剩余面板逐个 + 容器内联验证 + 文档收尾。
- 后续维护：mc 升版本 = 改 `runtime.js` 里 `MC_TARGET_VERSION`/`MC_MAX_SUPPORTED_SCHEMA` 并在 `queries/` 对照新源码差量更新 → 旧库与新阈值仍由门控兜底。

## 8. 开放问题（不阻塞 v1）

1. **后续是否要写操作**（dismiss note、记忆状态等）。v1 明确零写入；若要，需逐条评估插件记账语义（epoch、config 注释保留），倾向走插件自己的机制而非 OpenChamber 直写。
2. 面板目录选择与入口文案（M3 UI 阶段产品决策）。
3. 是否在面板暴露 harness 维度（默认只看 opencode，可切"全部历史"）。

## 9. 成功标准

- 容器内跑 OpenChamber（web），managed OpenCode 装 0.41.4 插件并产生数据后，浏览器可从 MC 入口浏览项目/记忆/会话/cache/dreamer/config/logs。
- 库缺失 / schema >84 / 库损坏三种情况页面分别给引导/提示/错误文案，不渲染假数据，不崩。
- 本 fork 不写一行 magic-context 代码；零新增包依赖；`meta` 门控与 queries 测试全绿；面板过运行时契约检查（web + Electron）。
