# Handover: Embed the Magic Context Dashboard into OpenChamber

Status: **Design direction — execution starts in the OpenChamber repo**.
Scope: re-home the Magic Context dashboard (currently a standalone Tauri + Rust
+ SolidJS desktop app in the `magic-context` monorepo at
`/workspace/magic-context/packages/dashboard`) as a TS-server-backed feature set
inside OpenChamber's web UI.

This document is written for an agent or maintainer picking the work up here,
in the OpenChamber repo. It records the evaluation conclusions, the target
architecture, a phased execution plan, the panel inventory to port, and the
constraints/invariants that must not be violated while doing it.

---

## 1. Decision summary

| Question | Answer |
|---|---|
| Is embedding into OpenChamber reasonable? | Yes — it converges on the ideal architecture. The dashboard's Rust data layer duplicates schema the plugin already owns in TypeScript; OpenChamber is already a TS server + React UI that operates OpenCode in the same environment, so it is the natural home. |
| What the migration actually is | A **rewrite**, not a transplant: SolidJS panels → React in `packages/ui`; Rust read layer → TS server routes backed by a **shared read-only data library extracted from the magic-context plugin** (single source of truth, never a 3rd hand-written query layer). |
| Primary cost | Porting ~8 dashboard panels into React + the plugin refactor that exposes an importable data-access surface. |
| First-version boundary | Self-hosted, same-machine only (server + managed OpenCode share `HOME`/`XDG`). Remote/mobile/relay/tunnel scenarios are out of scope for v1. |
| Overall posture | Read-first diagnostics; minimal, careful writes (same as the dashboard does today). |

---

## 2. Background

### 2.1 Source system (what we are migrating)

The Magic Context dashboard lives in the magic-context monorepo:

- `packages/dashboard/` — Tauri 2 desktop app.
  - **Frontend**: SolidJS 1.9 + Vite 6, hand-rolled dark design system
    (`src/components/`, `src/App.tsx`). Single-page section switching with
    `<Show>`, no router.
  - **Backend**: Rust (`src-tauri/src/`). `commands.rs` (~1,857 LOC) declares
    ~60 `#[tauri::command]` handlers; `db.rs` (~9,800 LOC) is a hand-written
    `rusqlite` read/write layer over the plugin's SQLite database; plus
    `config.rs` (JSONC editor), `log_parser.rs` (log tail + cache-event
    extraction), `workspaces.rs`, `pi_sessions.rs`, `external_cache_sessions.rs`,
    `embedding_probe.rs`, and an optional `serve` mode (`axum` + `rust-embed`,
    loopback HTTP with bearer token) that is conceptually what OpenChamber
    already does natively.
  - **Data contract bridge**: `src/lib/api.ts` (all invoke calls) +
    `src/lib/types.ts` (hand-maintained mirror of the Rust serde structs).
- The **plugin** (the thing that actually owns the data) is pure TypeScript:
  `packages/plugin/` — storage/migrations (`migrations.ts` v1–v82), data paths
  (`src/shared/data-path.ts`), config schema + JSONC parsing, log format, and
  type definitions all live there. This is the single source of truth the
  dashboard currently duplicates in Rust.

### 2.2 Destination system (OpenChamber)

- `packages/ui` — shared React UI/state/sync used by web, desktop (Electron),
  VS Code, hosted-mobile, and native-mobile runtimes. One shared contract across
  all runtimes is a hard invariant (`AGENTS.md`). UI: React 19, Tailwind v4,
  Radix/Base UI; layout primitives in `packages/ui/src/components/layout/`
  (`Sidebar.tsx`, `MainLayout.tsx`, `ContextPanel.tsx`, right-sidebar tabs).
  View sections live under `packages/ui/src/components/sections/`.
- `packages/web` — web surfaces + the OpenChamber **server**
  (`packages/web/server/index.js`, Express 5) + CLI. The server manages the
  OpenCode lifecycle (`server/lib/opencode/lifecycle.js`), spawns OpenCode
  processes, proxies its APIs via `@opencode-ai/sdk/v2`, and already holds
  filesystem-level trust (see `server/lib/fs/`, `server/lib/browser-control/`).
- **Route registration pattern**: each domain is a factory module, e.g.
  `server/lib/fs/routes.js` exporting `registerXxxRoutes(app, options)`, mounted
  in `server/index.js` (see the `registerServerStatusRoutes`,
  `registerBrowserControlRoutes`, ... block around lines 1083–1090 and 1900+).
  Domain modules pair a `routes.js` + a runtime/`service.js` + a
  `DOCUMENTATION.md`.
- **Auth**: server-level UI auth (`server/lib/ui-auth/`) — reuse for any new
  route group.
- Node `engines: >=22`; `packageManager: bun`. **No SQLite driver is currently
  used** in the server — this is a gap the plan must fill.

### 2.3 Why the Rust data layer should not be "ported again"

The magic-context schema/query knowledge already exists twice (plugin TS
migrations + dashboard Rust `db.rs`) and a third time in Rust
(`crates/mc-store/`). Writing a TS query layer inside OpenChamber would create a
fourth copy of the same column/schema knowledge with no shared types. The
non-negotiable design rule is therefore:

> **Extract one read-only data-access library from the magic-context plugin and
> import it from the OpenChamber server.** Do not hand-write SQL against
> `context.db` in the OpenChamber codebase beyond a thin adapter.

---

## 3. Target architecture

```text
┌───────────────────────── OpenChamber web app ─────────────────────────┐
│                                                                        │
│  packages/ui  (React 19, Tailwind, shared runtime contract)           │
│    ├── mc panels: memories / sessions / cache / dreamer / config /     │
│    │             logs / workspaces / user-memories                     │
│    └── data layer: typed API client + runtimeFetch                     │
│                              │ HTTP (existing UI auth / session)       │
│  packages/web (server, Express 5)                                      │
│    └── NEW  mc/* route group  ── registerMcRoutes(app, options)        │
│            │ thin adapter only: arg validation + response shaping      │
│            ▼                                                           │
│  @magic-context/data-access  (NEW npm surface, TS, READ-ONLY)          │
│    ├── resolves db/log/config paths (port of data-path.ts logic)       │
│    ├── opens context.db read-only: WAL, busy_timeout, NO migrations    │
│    ├── typed queries mirroring today's Tauri commands (see §5)         │
│    └── shares types + schema knowledge with the plugin (single source) │
│            │ node:sqlite (see §7.2 driver decision)                    │
│            ▼                                                           │
│  context.db  (~/.local/share/cortexkit/magic-context/context.db)       │
│  + magic-context.jsonc (user + project) + magic-context*.log           │
└────────────────────────────────────────────────────────────────────────┘
```

Notes:

- The **same environment** requirement is what makes this safe: the OpenChamber
  server resolves the exact same `context.db` / config / log paths the managed
  OpenCode processes write to. Verify this per deployment (see §7.1).
- Keep the read/write split honest: reads go through the shared data-access
  library; the few write operations (memory edits, config saves, note/fact
  edits, workspace CRUD) mirror what the dashboard does today — direct,
  guarded DB writes — but must never run migrations and must tolerate a live
  plugin process (WAL + busy_timeout).
- If the DB is absent or the plugin is not installed, the whole MC section is
  hidden behind a presence probe (see §6, gating).

---

## 4. Execution plan (phases)

### Phase 0 — Recon & decisions (before writing code)
- Confirm environment sharing for the target deployment: OpenChamber server and
  the OpenCode(s) it manages must resolve the same
  `XDG_DATA_HOME`/`MAGIC_CONTEXT_STORAGE_DIR` and same log/config paths. Record
  where this does **not** hold (per-worktree env isolation, docker-compose
  overrides, remote/tunnel/mobile) — those are explicitly out of scope.
- Lock the SQLite driver decision (§7.2): `node:sqlite` built-in vs a
  `better-sqlite3` dependency. Decide whether the monorepo standardizes on
  Node >= 22.13 (where `node:sqlite` is unflagged).
- In the magic-context repo: identify the importable seam for the data-access
  library. Candidate exports today are bundled into the plugin entry
  (`src/index.ts`); confirm which storage/query modules can be lifted
  (`storage-db.ts`, `storage-tags.ts`, `storage-meta-*.ts`, memory storage,
  `search.ts`, `migrations.ts`, `data-path.ts`) without pulling the plugin
  runtime (`hooks/`, `plugin/`, tool registries). Produce the library's public
  surface list (function + type exports) as a Phase 0 artifact.
- Inventory today's ~60 Tauri commands against the desired v1 route set (§5)
  and mark each read/write.

### Phase 1 — Magic-context side: publish `@magic-context/data-access`
- Extract a read-only TS library from `packages/plugin` with:
  - path resolution (db / logs / user+project config) honoring
    `MAGIC_CONTEXT_STORAGE_DIR` / `XDG_DATA_HOME`;
  - read-only DB open (WAL, `busy_timeout`, schema-fence read — never run
    migrations, never `BEGIN IMMEDIATE`);
  - typed query functions + exported types for every §5 row;
  - JSONC config read and **comment-preserving** write (the dashboard uses
    `comment-json`; adopt the same approach — do not round-trip config through a
    formatter that drops comments);
  - log-file read/tail primitive (dual grammar: fleet structured prefix +
    legacy bracketed, keyed by level — port `log_parser.rs`/plugin
    `log-lines.ts` semantics).
- Publish under a workspace path-dependency first; versioning/release is a
  later decision.

### Phase 2 — OpenChamber server: `mc/*` route group
- Add `packages/web/server/lib/mc-dashboard/` following the repo's
  `routes.js` + runtime + `DOCUMENTATION.md` pattern; mount
  `registerMcDashboardRoutes(app, options)` from `server/index.js`.
- Wire the data-access library behind thin adapters (validation + shaping).
- Auth: reuse the existing UI auth/session; do not mint a new token scheme.
- Real-time surfaces (log tail, cache timeline) via the existing
  SSE/WebSocket transport helpers rather than bespoke polling, if cheap; a
  simple bounded poll is an acceptable v1 fallback.

### Phase 3 — React UI panels (port per panel, keep working)
Port the dashboard's SolidJS panels into `packages/ui` as an MC section domain,
one at a time, each landing as a slice of the MC feature:

| # | Dashboard source (magic-context) | Target (OpenChamber) |
|---|---|---|
| 1 | `ProjectsGrid` / `ProjectDetail` | `sections/projects` integration or MC project list |
| 2 | `MemoryBrowser` / `MemoryDetail` | `sections/mc/memories` |
| 3 | `SessionViewer` | `sections/mc/sessions` (compartments, facts, notes) |
| 4 | `CacheDiagnostics` | `sections/mc/cache` |
| 5 | `DreamerPanel` | `sections/mc/dreamer` |
| 6 | `ConfigEditor` | `sections/mc/config` |
| 7 | `LogViewer` | `sections/mc/logs` |
| 8 | `WorkspacesPanel`, `UserMemories`, `Primers` | `sections/mc/*` |

Each panel must:
- read the **shared runtime contract** (the `ui-api-decoupling` skill's
  `RuntimeAPIs`/`runtimeFetch` pattern) so it behaves across web/desktop/VS Code
  instead of hard-wiring `fetch`;
- reuse existing design tokens/components (no re-importing the SolidJS CSS);
- keep the dashboard's **lazy-load discipline**: big payloads (session messages
  can be ~28 MB IPC, cache events 30k+ rows) must be paginated/lazy or the MC
  panels will stall the UI (the dashboard's `api.ts` comments document where
  these land);
- be gated so an absent DB shows an empty-state, never an error wall.

### Phase 4 — Gating, cleanup, docs
- Presence probe: DB exists + plugin configured → show MC nav section; else hide.
- Magic-context side: retire the Rust data layer of `packages/dashboard`
  (keep or drop the Tauri shell per product decision — see §8, open questions).
- Update owning docs on both sides; this handover document becomes the
  architecture note for the MC feature domain.

---

## 5. Command/panel inventory (data contract to port)

Source of truth for types: `packages/dashboard/src/lib/types.ts` +
`api.ts` in the magic-context repo. Read this list as "the route group must
serve these shapes":

- **Projects**: `get_projects`, `enumerate_projects`, `get_project_cards`,
  `enumerate_memory_projects`, `get_project_configs` + `save_project_config`.
- **Memories**: `get_memories` (project/workspace/status/category/search/limit/
  offset), `get_memory_stats`, `get_primers`, `get_primer_candidates`,
  `get_mural`, mutations (`update_memory_*`, `delete_memory`,
  `bulk_update_memory_status`, `bulk_delete_memory`).
- **Sessions**: `get_sessions`, `list_sessions`, `list_sessions_paged`,
  `get_session_detail`, `get_session_messages` (lazy), `get_subagent_*`,
  `get_session_cache_events` (+ `_by_turns`), `get_compartments`,
  `get_session_facts`/`notes`/`meta`, `get_context_token_breakdown`,
  `get_smart_notes`, note/fact mutations + `dismiss_note`.
- **Cache diagnostics**: `get_session_cache_stats(_from_db)`,
  `get_cache_events(_from_db)`, `get_session_cache_events_by_turns`.
- **Dreamer**: `get_task_schedule_state`, `get_dream_state`,
  `get_dreamer_projects`, `get_dream_runs`, `get_dream_run_memory_changes`.
- **Config**: `get_config`/`save_config` (user + project + multi-harness
  opencode/pi/omp), `read_pi_config`/`write_pi_config`, model catalogs,
  `get_opencode_install_state`, `test_embedding_endpoint`.
- **Logs**: `get_log_paths`, `get_log_entries`.
- **Workspaces**: `workspace_schema_ready`, `list_workspaces`,
  `list_workspace_summaries`, create/rename/delete, `apply_workspace_changes`.
- **User memories**: `get_user_memories`, `get_user_memory_candidates`,
  dismiss/delete/update/promote.
- **Health**: `get_db_health`.

Harness discriminator: `context.db` is shared across OpenCode/Pi/OMP; session
rows carry a `harness` column. All session/cache surfaces must keep the harness
filter the dashboard already threads through (`SessionFilter`).

---

## 6. Gating and absent-data behavior

- Feature is visible only when the probe succeeds: resolved DB path exists AND
  opens read-only AND the schema version is within the fence the data-access
  library understands.
- Never surface a stale/migrating DB: if a live plugin holds the DB mid-open or
  a migration is pending, show "plugin is starting / migrate via the plugin
  doctor" rather than reading inconsistent state.
- Empty per-domain states (no memories, no dreamer runs) render empty-state UI,
  not errors.

---

## 7. Technical considerations and constraints

### 7.1 Environment sharing (correctness gate)
- Data paths resolve from `XDG_DATA_HOME` (default `~/.local/share`) +
  `MAGIC_CONTEXT_STORAGE_DIR` override; config from
  `~/.config/cortexkit/magic-context.jsonc` + `<project>/.cortexkit/magic-context.jsonc`;
  logs from `$MAGIC_CONTEXT_LOG_PATH` (default under `$TMPDIR/opencode/...`,
  `pi/` for Pi).
- v1 assumption: the server and the OpenCode(s) it operates resolve the same
  paths. If an OpenChamber deployment isolates per-worktree or containerized
  environments, the MC data of a session may not be reachable — the panel must
  not pretend otherwise.

### 7.2 SQLite driver decision
- Prefer `node:sqlite` (`DatabaseSync`) when the runtime guarantees Node >=
  22.13 / Bun; otherwise standardize on `better-sqlite3` as the single DB
  dependency. Whichever is chosen, open **read-only** for reads, set
  `busy_timeout`, and use WAL-safe concurrent reads. Never open read-write for
  pure reads; the plugin may hold writer connections in another process.

### 7.3 Never migrate, never fight the plugin
- The dashboard never runs migrations today; neither must the OpenChamber
  server. Schema drift is handled by the data-access library's fence and the
  plugin's own doctor. Do not `BEGIN IMMEDIATE`, do not create tables, do not
  clear session rows.

### 7.4 Writes are careful, minimal
- Memory/note/fact/config/workspace edits are the only writes. Follow the
  plugin's semantics where they exist (e.g. memory writes are idempotent;
  config writes must preserve comments and per-harness structure). Do not
  invent new write paths that bypass plugin bookkeeping (e.g. don't bump
  epochs the plugin owns).

### 7.5 Performance / payload discipline
- Reuse dashboard-learned bounds: paginate sessions, cap cache events, lazy-load
  full messages, cap log tails. Keep list-first UIs (no auto-loading 28 MB
  payloads). Real-time channels: prefer the transport helpers; never busy-poll
  from many tabs.

### 7.6 OpenChamber invariants that bind this work
- `packages/ui` is a single shared contract across all runtimes — MC panels must
  not be web-only by accident (respect `ui-api-decoupling`).
- Server domain logic lives in `packages/web/server/lib/<domain>/`, entrypoints
  stay thin.
- Docs in English; code/comments in English. Minimal changes; don't touch
  unrelated worktrees. `changelog/` is read-only unless the maintainer asks.
- No new secrets/tokens; reuse the server's existing auth.

---

## 8. Open questions for the maintainer (resolve before Phase 4)

1. **Standalone desktop dashboard retirement**: after the embed lands, does the
   Tauri desktop app ship a final version and retire, or stay as a thin shell
   around the same shared UI? (Recommended: retire the Rust data layer; keep a
   web-served build of the shared UI for MC users who don't run OpenChamber.)
2. **Package home**: is the shared data-access library published from the
   magic-context monorepo (recommended) and consumed as a path/version
   dependency here, or vendored?
3. **Product scope**: should MC panels appear only when the managed OpenCode
   actually has the magic-context plugin configured (recommended), or also in
   "external OpenCode" and remote-instance modes?
4. **Write path for memory/config mutations**: direct guarded DB writes (today's
   dashboard approach) vs going through plugin bookkeeping. Confirm the shared
   library owns the direct-write semantics.

---

## 9. Success criteria

- An OpenChamber web session on a machine where OpenCode runs with the
  magic-context plugin can: list projects/memories, open a session and see
  compartments/facts/notes, view the cache-hit timeline, see dreamer runs,
  read config, and tail logs — all from the MC section, with an empty-state when
  the DB is absent.
- No SQL/schema knowledge is hand-duplicated inside the OpenChamber repo (all
  queries come from the shared data-access library).
- MC panels pass the same runtime contract checks as other sections (web +
  desktop at minimum), type-check, lint, and the repo test suite stays green.
- The magic-context Rust data layer of `packages/dashboard` is deleted or
  decommissioned (per open question 1).

---

*Related source references (magic-context repo):*
`packages/dashboard/README.md`, `packages/dashboard/src/lib/api.ts`,
`packages/dashboard/src/lib/types.ts`, `packages/dashboard/src-tauri/src/`
(`commands.rs`, `db.rs`, `config.rs`, `log_parser.rs`, `serve/`),
`packages/plugin/src/features/magic-context/migrations.ts`,
`packages/plugin/src/shared/data-path.ts`.
