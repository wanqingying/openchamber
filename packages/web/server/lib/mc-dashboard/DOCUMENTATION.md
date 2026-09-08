# mc-dashboard (Magic Context read-only bridge)

## Purpose

Gives the OpenChamber UI read-only diagnostics and inspection of the Magic
Context plugin data of the managed OpenCode process. This fork does not modify
or fork the magic-context plugin: it opens the plugin's `context.db` read-only,
pinned to plugin `0.41.4` (schema `<= 83`). When the on-disk schema exceeds the
pinned ceiling, the server reports `schema-too-new` and the UI shows a version
hint instead of reading incompatible state.

## Route group

| Route | Behavior |
|---|---|---|
| `GET /api/openchamber/mc/version` | Build marker: `{ "version": 5 }`. Bump `MC_DASHBOARD_BUILD` in `runtime.js` on every meaningful dashboard code change; curl this before reporting stale behavior. |
| `GET /api/openchamber/mc/meta` | Gating state for the MC feature. `available: true` carries `schemaVersion`, `targetMcVersion` and `maxSupportedSchema`; `available: false` carries a `reason`: `missing-db`, `schema-too-new`, `sqlite-unavailable`, `open-failed`, or `storage-dir-unavailable`. The UI renders copy per state. |
| `GET /api/openchamber/mc/memories` | Read-only paged memory list from the plugin `memories` table, newest first. Query params: `project`, `category`, `status`, `limit` (1-500), `offset`. Every row carries a bounded `contentExcerpt`, never full content. Gate failures return the same gating payload as `meta`; bad params return 400. |
| `GET /api/openchamber/mc/overview` | Read-only memory aggregates: `totalMemories`, `currentMemories` (`status IN ('active','permanent')`), `projects`, `categories`. Gate failures return the same gating payload as `meta`. |
| `GET /api/openchamber/mc/workspaces` | Read-only workspace list from the plugin `workspaces` table, newest-updated first, with member counts. Query params: `limit`, `offset`. Gate failures return the same gating payload as `meta`. |
| `GET /api/openchamber/mc/sessions` | Read-only session list from the OpenCode database (`opencode.db`), newest-activity first. Query params: `limit`, `offset`. Missing `opencode.db` reports `missing-opencode-db`. |
| `GET /api/openchamber/mc/sessions/:id` | Read-only per-session insight from `context.db`: `session_meta` token/cache summary, facts, session notes, smart notes and compartments (bounded lists). |
| `GET /api/openchamber/mc/dreamer/runs` | Read-only dreamer run list from `dream_runs`, newest-finished first. Query params: `project`, `limit`, `offset`. |
| `GET /api/openchamber/mc/primers` | Read-only primer list (`active` first, then by last observation). Query params: `project`, `limit`, `offset`. |
| `GET /api/openchamber/mc/user-memories` | Read-only user memories. Query params: `status` (`active` default, `dismissed`), `limit`, `offset`. |
| `GET /api/openchamber/mc/config` | Read-only preview of the user `magic-context.jsonc` (capped bytes). `exists:false` when absent. |
| `GET /api/openchamber/mc/logs` | Read-only preview of the harness `magic-context.log` (capped bytes). `exists:false` when absent. |

## Correctness invariants

- **Same environment, same data.** The db path is resolved from the server
  process environment exactly like the plugin resolves it
  (`MAGIC_CONTEXT_STORAGE_DIR` absolute override, then `XDG_DATA_HOME`, then
  `~/.local/share/cortexkit/magic-context`). Deployments that isolate the
  managed OpenCode environment (containers with separate homes, tunnel, custom
  env) report a clear unavailable state, never fabricated data.
- **OpenCode database caveat.** Session listing resolves `opencode.db` from
  `OPENCODE_DB` when set, otherwise the newest `opencode*.db` under the default
  OpenCode data dir. If the managed OpenCode runs with a non-default data dir,
  point the server env at the same `OPENCODE_DB` or accept that the list may
  target another instance; a missing db reports `missing-opencode-db`.
- **Read-only, no migrations.** The db opens with a read-only flag and a busy
  timeout; the server never writes, never runs migrations, and never opens
  `BEGIN IMMEDIATE`. Schema version is read the same way the plugin reads it
  (`MAX(version) WHERE version < 10000` from `schema_migrations`, 0 when the
  table is absent).
- **Pinned compatibility fence.** `MC_MAX_SUPPORTED_SCHEMA = 83` matches the released plugin
  `0.41.4`. A newer database reports `schema-too-new`; the UI shows copy that
  tells the user which plugin version to install.
- **Failure is never empty success.** A missing database, a corrupt file, or an
  unsupported SQLite runtime maps to an explicit state, never an empty list.
- **No secrets.** The bridge only reads plugin data; nothing is written back and
  nothing sensitive is exposed beyond what the db contains.

## Layout

- `paths.js` — storage dir / db path resolution (env precedence mirrors the plugin).
- `sqlite.js` — runtime SQLite selector (`bun:sqlite` under Bun,
  `node:sqlite` otherwise) plus read-only open and the write open used by
  tests/fixtures.
- `runtime.js` — probe state machine and the pinned version constants.
- `routes.js` — route registration.
- `queries/` — read-only queries authored from the pinned plugin source
  (`memories.js`, `overview.js`; sessions list needs the OpenCode database, not
  `context.db`, so it is deferred). Each file carries a source anchor comment.

## Wiring

`createMcDashboardRuntime({ env, homedir })` is built in `server/index.js` and
handed to `feature-routes-runtime.js`, which calls
`registerMcDashboardRoutes(app, { runtime: mcDashboardRuntime })`.
