# OpenChamber Architecture

A top-down map of the codebase. Read this first, then follow the module docs it
points to. Written against v1.22.2 (September 2026). The authoritative guide to
commands and packaging is `CONTRIBUTING.md`; repository rules and skill routing
live in `AGENTS.md`.

## What OpenChamber is

OpenChamber is an open-source workspace for running and reviewing AI coding work
on desktop, web/PWA, VS Code, iOS, and Android. It does not run coding agents
itself. It uses [OpenCode](https://opencode.ai) for that and owns everything
around it: the UI, session lifecycle, review tooling, scheduling, and remote
access.

The product story shows up as concrete features: session goals that keep an
agent working toward a finish line, multi-run (same task on up to five models,
optionally in separate worktrees) with fusion, an AI-guided changes walkthrough,
an in-app browser and preview mode, GitHub issue-to-PR sessions, scheduled
tasks, worktrees, and one-time QR pairing through an end-to-end encrypted relay.

Architecturally the important consequence is that OpenCode is the upstream
agent engine and OpenChamber is a client and operator of it. All OpenCode API
calls flow through one reverse-proxied HTTP boundary, which keeps the SDK
integration in one place. See "The OpenCode boundary" below.

## Repository layout

A Bun workspace monorepo. Root `package.json` declares workspaces
`packages/*`, pins `bun@1.3.14` (`packageManager`) and requires Node >= 22
(`engines`). `bun.lock` is the lockfile. `../opencode` is a separate repository
and must never be edited from here. `packages/docs` is product documentation
(Astro) and deliberately has no `package.json`, so it is not a workspace member.

```
packages/
├── ui        shared React UI, state, sync, runtime contracts (source-level lib)
├── web       OpenChamber server, web/PWA surfaces, and the openchamber CLI
├── electron  native desktop shell; starts the web server in-process
├── vscode    extension host, webview, and runtime bridge
├── mobile    Capacitor iOS/Android shell; bundles the mobile web surface
└── docs      product documentation (not a Bun workspace)

scripts/      workspace scripts: dev launchers, changelog, perf tooling
tools/        oxlint anti-slop plugin (vendored)
docs/         repo docs: this file, CUSTOM_THEMES.md, REVERSE_PROXY.md
changelog/    one release file per version; written only on request
```

Inside `packages/ui/src`, the shared code is organized as `apps/` (per-host
React roots and their `render*` helpers), `components/` (chat, code, terminal,
layout, settings sections, and more), `contexts/`, `hooks/`, `lib/` (api,
opencode, relay, settings, theme, i18n, ...), `stores/` (Zustand), `sync/`
(session event pipeline), and `styles/`.

The web server domain logic lives under `packages/web/server/lib/<module>/`
with a routing layer and an owning `DOCUMENTATION.md`; the CLI lives under
`packages/web/bin/lib/`. See the web deep dive below.

## Runtime model

One shared UI, five hosts. `packages/ui` is a source-level workspace package:
consumers compile its `src/` directly through the `@openchamber/ui` alias
(`packages/web/vite.config.ts`, `packages/vscode/vite.config.ts`). There is no
published artifact and no README; the canonical entry is
`@openchamber/ui/lib/api/types.ts`.

Each host boots the same React tree and hands it a `RuntimeAPIs` object
(`registerRuntimeAPIs`, registry in
`packages/ui/src/contexts/runtimeAPIRegistry.ts`). The descriptor carries
`platform: 'web' | 'desktop' | 'vscode'` and a capability set: `runtime,
terminal, git, files, settings, permissions, notifications, tools`, plus
optional `github/linear/push/diagnostics/clientAuth/editor/vscode`. Hosts are:

- Web/PWA. The OpenChamber server serves `packages/web/dist`. `index.html`
  mounts the hosted app shell, `mobile.html` the hosted mobile surface,
  `mini-chat.html` the Electron mini chat. A service worker provides PWA
  install and background notifications.
- Desktop. Electron starts the OpenChamber backend in its own main process
  (never a sidecar), loads HMR UI from loopback in development or staged assets
  over `openchamber-ui://` in packaged builds, and keeps the loopback server as
  the API backend. `preload.mjs` exposes desktop-only APIs as
  `window.__OPENCHAMBER_DESKTOP__`; privileged commands are checked in
  `main.mjs`, not only in the UI.
- VS Code. The extension host spawns or attaches to OpenCode and exposes it
  over a message bridge to one of three webview hosts (sidebar, editor panel,
  agent manager), all rendering `VSCodeApp`. No OpenChamber server runs here.
- iOS/Android. Capacitor bundles the mobile web build, forced onto the
  `MobileApp` root, and connects to an existing OpenChamber server (connection
  QR, saved instances, client tokens).

Runtime detection uses injected globals: `__OPENCHAMBER_ELECTRON__`,
`__VSCODE_CONFIG__`, `window.Capacitor`, and the URL protocol
(`lib/platform.ts`, `lib/desktop.ts`). Surface (mobile vs desktop layout) is a
separate stamped decision in `lib/runtimeSurface.ts`.

All OpenChamber-owned HTTP calls (the `/api`, `/auth`, `/health`, fs, git,
terminal, project routes) go through `runtimeFetch` (`lib/runtime-fetch.ts`),
which rewrites runtime paths onto the active base URL, attaches runtime auth and
proxy headers, coalesces concurrent idempotent GETs, and rides the E2EE tunnel
when the active runtime is a private relay. Hosts also install a `window.fetch`
bridge so plain `fetch` calls take the same path.

## The OpenCode boundary

The web server owns the OpenCode connection and exposes it to the whole app.

- Managed mode (default). The server spawns `opencode serve --hostname <h>
  --port <p>` as a child process. The binary is resolved from settings, then
  env (`OPENCODE_BINARY`), then the desktop-bundled CLI, then PATH
  (`packages/web/server/lib/opencode/env-runtime.js`). The port is
  pre-allocated with a probe listener and the real URL is parsed from the
  child's stdout (`lifecycle.js`).
- External mode. With `OPENCODE_HOST`/`OPENCODE_PORT` and
  `OPENCODE_SKIP_START=true`, the server probes but never spawns, and restart
  only re-probes.
- The connection is an HTTP reverse proxy on loopback. OpenChamber never talks
  the OpenCode SDK directly: `registerOpenCodeProxy` mounts
  `http-proxy-middleware` toward the child (`proxy.js`), authenticated with a
  Basic header from a generated and rotated `OPENCODE_SERVER_PASSWORD`
  (`auth-state-runtime.js`). Readiness is polling `GET /global/health`, with a
  periodic health monitor and auto-restart.
- The shared UI talks to that boundary through `@opencode-ai/sdk/v2`
  `createOpencodeClient`, a singleton in `packages/ui/src/lib/opencode/client.ts`
  whose fetches route through `runtimeFetch`. Clients are per-directory scoped
  and carry the directory header.

This is why an SDK version bump or a new upstream API touches one client module
and one proxy, not every surface.

## packages/ui in depth

- `sync/` owns session state delivery. It consumes OpenCode's global event
  stream (SSE), reduces events to targeted store fields, flushes each
  directory's events in order as one transaction batch per store, and keeps a
  shared paginated message loader plus reconnect recovery, optimistic updates,
  and generation guards so stale commits never win. Core invariants are
  documented in `src/sync/DOCUMENTATION.md`: authoritative state beats
  heuristics, live activity comes from live channels only, a fetch failure is
  never an empty success, and `unknown` is never `idle`.
- `stores/` holds the Zustand stores that the components read: feature caches
  (git, GitHub PR status), UI state, session/project coordination, per-project
  config mirrors (agents, commands, skills, MCP), and terminal state. See
  `src/stores/DOCUMENTATION.md`.
- `lib/api/` is the runtime contract shared by every host. `lib/settings/`
  owns the settings registry and the generated registry snapshot that gates
  writes. `lib/theme/` owns the theme engine and the OpenCode theme port.
- Rendering heavy paths are isolated for performance: markdown rendering runs
  syntax highlighting in a Web Worker with detached-DOM caching, the composer
  editor is CodeMirror, and long timelines virtualize. There are dedicated
  performance and regression tests next to these modules.

## The web package (deep dive)

`packages/web` contains two things: the OpenChamber server (`server/`) and the
`openchamber` CLI (`bin/`). It also builds and serves the web UI (`index.html`,
`src/`, `public/`). Package exports: `main` is `./server/index.js`, `bin`
maps `openchamber` to `./bin/cli.js`.

### Server composition root

`packages/web/server/index.js` is the composition root. `main(options)` is
exported as `startWebUiServer` and has three consumers:

1. The CLI daemon, which imports it in-process for `--foreground` or spawns
   `server/index.js` for the default daemon mode.
2. Electron, which dynamic-imports `@openchamber/web/server/index.js` and calls
   `startWebUiServer(...)` with desktop config. Electron sets
   `OPENCHAMBER_RUNTIME=desktop` and `OPENCHAMBER_DIST_DIR` before first import.
3. Tests, against the `WebUiServerController` contract.

Boot order inside `main`: Express app with CORS for the
`openchamber-ui://`/`capacitor://`/localhost origins, compression (SSE
excluded), the HTTP listener, base routes (ui-auth, `/health`, request
middleware), the Electron-only realtime proxy, tunnel wiring, the relay
service, feature route families, then the startup pipeline that builds the
terminal/dictation/message-stream WebSocket runtimes, calls `setupProxy` for
the OpenCode proxy, serves static assets (or api-only mode), binds the
listener, and fires `bootstrapOpenCodeAtStartup` asynchronously. Signal
handlers install cleanup.

Because the module tree reloads under Vite HMR, the opencode pid, port, and
password live on `globalThis.__openchamberHmrState`; a reload reuses a healthy
child and reaps orphans from earlier runs.

### The dependency-injection pattern

Server modules follow one shape. `create*Runtime(dependencies)` returns an API
object; `register*Routes(app, dependencies)` registers Express handlers. The
~60 runtime objects are assembled once at module scope of `index.js` and handed
to three orchestration points: `bootstrap-runtime.js` (base routes),
`feature-routes-runtime.js` (feature families), and `startup-pipeline-runtime.js`
(WebSocket runtimes and proxy). Route modules stay dependency-free; they get
everything they need through the `dependencies` argument. This is how the same
backend serves web, desktop, and tests without runtime branches in route code.

### Route families

- System: `/health`, `/api/version`, `/api/system/{shutdown,info,free-port}`,
  `/api/config/reload`.
- Browser auth: `/auth/session`, passkeys, `/api/auth/reset`; the global gate
  `app.use('/api', requireApiAuth)`.
- Client auth and pairing: remote client tokens, pairing sessions with a
  one-time link/QR redeem.
- OpenCode proxy passthrough: `/api/event` and `/api/global/event` SSE
  forwarders with heartbeats and an upstream-stall watchdog, `/api/session`,
  the generic `/api/*` forwarder, and oauth/MCP interactive callbacks.
- Config: settings, opencode resolution, upgrade, providers, agents, commands,
  MCP, snippets, plugins, skills.
- OpenChamber: update check/install, models metadata, Zen models,
  `/api/openchamber/events` (scheduled tasks), `/api/openchamber/relay/*`,
  openchamber sessions, and the `/api/openchamber/control` action service
  (`openchamber-control`, `openchamber-sessions`).
- Feature modules: quota, small-model, walkthrough, goals, git/github/linear,
  dev servers, magic prompts, project context and projects, agent memory,
  session knowledge and folders, fs, notifications.

### Realtime

SSE is used for the OpenCode event forwarders, notifications, and scheduled
task events. WebSocket is used for the message stream, terminal, and dictation,
all as `noServer` `ws` servers mounted on the HTTP `upgrade` event. Because WS
handshakes cannot send headers, ui-auth mints a short-lived `oc_url_token` query
token and each upgrade handler validates it plus the origin. The relay is an
outbound end-to-end encrypted tunnel used for NAT'd pairing; it is a separate
transport from the local loopback proxy.

### Auth layers

- UI password: scrypt with a timing-safe compare, an HS256 session cookie
  (`oc_ui_session`), rate-limited login, optional passkeys (WebAuthn), and
  global sign-out by rotating the JWT secret.
- Client bearer tokens for paired apps (mobile, second desktop).
- Pairing: one-time link/QR redeem that issues a client token.
- OpenCode upstream: Basic auth from the generated server password.
- Tunnel sessions and reverse-proxy trust (`trust proxy` set) with per-request
  origin checks. LAN binding without a password refuses to start.

### The CLI

`bin/cli.js` is a thin entrypoint; domain logic lives in `bin/lib/`.
Subcommands: `serve` (the default), `stop`, `restart`, `status`, `schedule`,
`session`, `models`, `projects`, `control`, `tunnel`, `startup`, `logs`,
`connect-url`, and `update`. `session` and `schedule` map options onto control
service actions rather than implementing behavior twice.

`serve` resolves the host and port (default 3000, auto-picks a free port),
warns on unsafe browser ports, discovers any instance already on the port and
rejects desktop occupants, locates the OpenCode binary, rotates the log file,
and resolves the UI password. In foreground mode it imports the server
in-process; in the default daemon mode it spawns the server detached with env
carrying the port, host, and password, waits up to 30 s for the `openchamber:ready`
IPC message, and writes pid and instance files. Output is mode-aware:
`--json` emits JSON only, `--quiet` prints one concise line
(`<port>` or `<port> pass:<pw>`), and human mode uses clack prompts and status
lines. Prompts only run in a TTY.

The CLI locates and verifies the OpenCode binary but never installs it. The
server decides whether to start it (`OPENCODE_SKIP_START`). `update` upgrades
the `@openchamber/web` npm package itself and restarts instances around it.

## Electron desktop

`packages/electron/main.mjs` imports the web server and calls
`startWebUiServer` in the main process. On top of that it adds windows and
menus, deep links, native notifications, a tray, an updater with per-channel
feeds, SSH host management and tunnels, and the packaged `openchamber-ui://`
asset scheme. The preload bridge is the privilege boundary; native helpers
(SSH, terminal, browser panel, Windows file replacement) stay in `.mjs` modules
with tests, and the web UI only ever reaches them through `window.__OPENCHAMBER_DESKTOP__`.
See `packages/electron/README.md`.

## VS Code extension

`packages/vscode` has an extension host and a webview that renders the shared
UI. `OpenCodeManager` (`src/opencode.ts`) owns the managed OpenCode process and
its upgrade lifecycle; `bridge.ts` is a thin orchestrator that delegates each
message family to a `bridge-*-runtime.ts` module. SSE uses a dedicated proxy
with an upstream-stall watchdog, and the webview allocates stream IDs before
requesting streams so replay events cannot race the bridge. Session message
ordering is owned by the shared sync layer, not duplicated here. Worktree and
git operations run against VS Code Git with explicit bootstrap phases so the UI
never sees stale `ready` state. See `packages/vscode/src/DOCUMENTATION.md`.

## Mobile

`packages/mobile` is a Capacitor shell. The native app bundles the mobile UI
only; it embeds neither the OpenChamber server nor OpenCode. On first launch it
shows a connection screen for an existing server, stores connections with their
client tokens, and switches the runtime endpoint on connect. The terminal runs
its PTY on the server over the shared authenticated transport, never a local
shell. See `packages/mobile/README.md` for the simulator toolchain.

## Cross-cutting design rules

Code that is shared across runtimes is held to invariants that show up
repeatedly in module docs:

- Prefer authoritative state over heuristics, and derive live activity from
  live channels, not persisted history.
- A fetch failure must never look like an authoritative empty success.
- Make partial results, rollback, cleanup, and stale-data behavior explicit.
- One failed entity must not erase or block unrelated complete entities.
- Runtime-specific differences must be intentional and visible in code.
- Credentials stay in the owning runtime; they are never put in URLs or logged.

## Where to look next

- Sync internals: `packages/ui/src/sync/DOCUMENTATION.md`
- Stores: `packages/ui/src/stores/DOCUMENTATION.md`
- Server module contracts: `DOCUMENTATION.md` files under
  `packages/web/server/lib/**`
- CLI contracts: `packages/web/bin/lib/DOCUMENTATION.md`
- Desktop: `packages/electron/README.md`; VS Code:
  `packages/vscode/src/DOCUMENTATION.md`; Mobile: `packages/mobile/README.md`
- Run, build, and package commands: `CONTRIBUTING.md`
