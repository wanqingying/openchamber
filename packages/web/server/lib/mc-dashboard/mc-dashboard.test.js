import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createMcDashboardRuntime,
  readPersistedSchemaVersion,
  MC_MAX_SUPPORTED_SCHEMA,
  MC_FORK_VERSION_FLOOR,
  MC_UNAVAILABLE_MISSING_DB,
  MC_UNAVAILABLE_SCHEMA_TOO_NEW,
  MC_UNAVAILABLE_OPEN_FAILED,
} from './runtime.js';
import { registerMcDashboardRoutes } from './routes.js';
import { resolveMagicContextDbPath, resolveMagicContextStorageDir } from './paths.js';
import { openMagicContextDatabase, openMagicContextDatabaseForWrite } from './sqlite.js';

const tempDirs = [];

const makeTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-dashboard-test-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const seedDatabase = async ({ storageDir, upstreamVersion = 0, forkVersion = null }) => {
  const dbPath = path.join(storageDir, 'context.db');
  const opened = await openMagicContextDatabaseForWrite({ dbPath });
  expect(opened.ok).toBe(true);
  const db = opened.db;
  try {
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `);
    if (upstreamVersion > 0) {
      const insert = db.prepare('INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)');
      for (let v = 1; v <= upstreamVersion; v += 1) {
        insert.run(v, `migration ${v}`, 0);
      }
    }
    if (forkVersion !== null) {
      db.prepare('INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)').run(
        forkVersion,
        'fork migration',
        0,
      );
    }
  } finally {
    db.close();
  }
  return dbPath;
};

describe('paths', () => {
  it('resolves storage dir and db path by precedence', () => {
    const homedir = () => '/home/tester';
    expect(resolveMagicContextStorageDir({ env: {}, homedir })).toBe(
      '/home/tester/.local/share/cortexkit/magic-context',
    );
    expect(resolveMagicContextDbPath({ env: {}, homedir })).toBe(
      '/home/tester/.local/share/cortexkit/magic-context/context.db',
    );
    expect(
      resolveMagicContextStorageDir({ env: { XDG_DATA_HOME: '/xdg' }, homedir }),
    ).toBe('/xdg/cortexkit/magic-context');
    expect(
      resolveMagicContextStorageDir({
        env: { MAGIC_CONTEXT_STORAGE_DIR: '/explicit' },
        homedir,
      }),
    ).toBe('/explicit');
    expect(() =>
      resolveMagicContextStorageDir({ env: { MAGIC_CONTEXT_STORAGE_DIR: 'relative' }, homedir }),
    ).toThrow();
  });
});

describe('sqlite chokepoint', () => {
  it('opens a seeded db read-only and reads the persisted schema version', async () => {
    const storageDir = makeTempDir();
    fs.mkdirSync(storageDir, { recursive: true });
    await seedDatabase({ storageDir, upstreamVersion: 42, forkVersion: MC_FORK_VERSION_FLOOR + 5 });

    const opened = await openMagicContextDatabase({ dbPath: path.join(storageDir, 'context.db') });
    expect(opened.ok).toBe(true);
    try {
      expect(readPersistedSchemaVersion(opened.db)).toBe(42);
    } finally {
      opened.db.close();
    }
  });

  it('returns 0 for a db without the migrations table', async () => {
    const storageDir = makeTempDir();
    const dbPath = path.join(storageDir, 'context.db');
    const opened = await openMagicContextDatabaseForWrite({ dbPath });
    expect(opened.ok).toBe(true);
    opened.db.close();
    const reopened = await openMagicContextDatabase({ dbPath });
    expect(reopened.ok).toBe(true);
    try {
      expect(readPersistedSchemaVersion(reopened.db)).toBe(0);
    } finally {
      reopened.db.close();
    }
  });

  it('surfaces corrupt files on first read', async () => {
    const storageDir = makeTempDir();
    const dbPath = path.join(storageDir, 'context.db');
    fs.writeFileSync(dbPath, 'this is not a sqlite database');
    const opened = await openMagicContextDatabase({ dbPath });
    expect(opened.ok).toBe(true);
    try {
      expect(() => readPersistedSchemaVersion(opened.db)).toThrow();
    } finally {
      opened.db.close();
    }
  });
});

describe('runtime meta', () => {
  const createRuntime = (storageDir) =>
    createMcDashboardRuntime({
      env: { MAGIC_CONTEXT_STORAGE_DIR: storageDir },
      homedir: () => '/home/tester',
    });

  it('reports storage-dir-unavailable when the env override is invalid', async () => {
    const runtime = createMcDashboardRuntime({
      env: { MAGIC_CONTEXT_STORAGE_DIR: 'relative' },
      homedir: () => '/home/tester',
    });
    const meta = await runtime.getMeta();
    expect(meta.available).toBe(false);
    expect(meta.reason).toBe('storage-dir-unavailable');
  });

  it('reports missing-db when the plugin database does not exist', async () => {
    const storageDir = makeTempDir();
    const meta = await createRuntime(storageDir).getMeta();
    expect(meta.available).toBe(false);
    expect(meta.reason).toBe(MC_UNAVAILABLE_MISSING_DB);
    expect(meta.targetMcVersion).toBe('0.41.4');
  });

  it('reports schema-too-new when the db schema exceeds the pinned max', async () => {
    const storageDir = makeTempDir();
    fs.mkdirSync(storageDir, { recursive: true });
    await seedDatabase({ storageDir, upstreamVersion: MC_MAX_SUPPORTED_SCHEMA + 1 });
    const meta = await createRuntime(storageDir).getMeta();
    expect(meta.available).toBe(false);
    expect(meta.reason).toBe(MC_UNAVAILABLE_SCHEMA_TOO_NEW);
    expect(meta.schemaVersion).toBe(MC_MAX_SUPPORTED_SCHEMA + 1);
    expect(meta.maxSupportedSchema).toBe(MC_MAX_SUPPORTED_SCHEMA);
  });

  it('reports open-failed on a corrupt file', async () => {
    const storageDir = makeTempDir();
    const dbPath = path.join(storageDir, 'context.db');
    fs.writeFileSync(dbPath, 'not a database');
    const meta = await createRuntime(storageDir).getMeta();
    expect(meta.available).toBe(false);
    expect([MC_UNAVAILABLE_OPEN_FAILED, 'open-failed']).toContain(meta.reason);
  });

  it('reports available when the schema is within the pinned range', async () => {
    const storageDir = makeTempDir();
    fs.mkdirSync(storageDir, { recursive: true });
    await seedDatabase({ storageDir, upstreamVersion: 50 });
    const meta = await createRuntime(storageDir).getMeta();
    expect(meta.available).toBe(true);
    expect(meta.schemaVersion).toBe(50);
    expect(meta.maxSupportedSchema).toBe(MC_MAX_SUPPORTED_SCHEMA);
  });

  it('registers the meta route and responds through the runtime', async () => {
    const routes = new Map();
    const app = {
      get(routePath, handler) {
        routes.set(`GET ${routePath}`, handler);
      },
    };
    const storageDir = makeTempDir();
    fs.mkdirSync(storageDir, { recursive: true });
    await seedDatabase({ storageDir, upstreamVersion: 50 });
    registerMcDashboardRoutes(app, { runtime: createRuntime(storageDir) });

    const handler = routes.get('GET /api/openchamber/mc/meta');
    expect(handler).toBeTypeOf('function');

    const body = await new Promise((resolve, reject) => {
      const res = {
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          resolve({ status: this.statusCode, payload });
        },
      };
      handler({}, res).catch(reject);
    });
    expect(body.status).toBeUndefined();
    expect(body.payload.available).toBe(true);
    expect(body.payload.schemaVersion).toBe(50);
  });
});

describe('memories', () => {
  const createMemoriesTable = (db) => {
    db.exec(`
      CREATE TABLE memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_path TEXT NOT NULL,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        normalized_hash TEXT NOT NULL,
        importance INTEGER,
        scope TEXT NOT NULL DEFAULT 'project',
        source_type TEXT DEFAULT 'historian',
        status TEXT DEFAULT 'active',
        first_seen_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        last_retrieved_at INTEGER,
        expires_at INTEGER,
        verification_status TEXT DEFAULT 'unverified'
      );
    `);
  };

  const insertMemories = async (db, rows) => {
    const insert = db.prepare(`
      INSERT INTO memories (
        project_path, category, content, normalized_hash, importance, scope,
        source_type, status, first_seen_at, created_at, updated_at, last_seen_at,
        last_retrieved_at, expires_at, verification_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of rows) {
      insert.run(
        row.projectPath,
        row.category,
        row.content,
        row.hash ?? `hash-${row.createdAt}`,
        row.importance ?? null,
        row.scope ?? 'project',
        row.sourceType ?? 'historian',
        row.status ?? 'active',
        row.firstSeenAt ?? row.createdAt,
        row.createdAt,
        row.updatedAt ?? row.createdAt,
        row.lastSeenAt ?? row.createdAt,
        row.lastRetrievedAt ?? null,
        row.expiresAt ?? null,
        row.verificationStatus ?? 'unverified',
      );
    }
  };

  const seedStorage = async (rows) => {
    const storageDir = makeTempDir();
    const dbPath = path.join(storageDir, 'context.db');
    const opened = await openMagicContextDatabaseForWrite({ dbPath });
    expect(opened.ok).toBe(true);
    try {
      createMemoriesTable(opened.db);
      await insertMemories(opened.db, rows);
    } finally {
      opened.db.close();
    }
    return storageDir;
  };

  const makeRuntime = (storageDir) =>
    createMcDashboardRuntime({
      env: { MAGIC_CONTEXT_STORAGE_DIR: storageDir },
      homedir: () => '/home/tester',
    });

  it('lists memories newest first and reports the total', async () => {
    const storageDir = await seedStorage([
      { projectPath: '/p', category: 'work', content: 'oldest', createdAt: 100 },
      { projectPath: '/p', category: 'work', content: 'middle', createdAt: 200 },
      { projectPath: '/q', category: 'personal', content: 'newest', createdAt: 300 },
    ]);
    const result = await makeRuntime(storageDir).listMemories({});
    expect(result.ok).toBe(true);
    expect(result.data.total).toBe(3);
    expect(result.data.items.map((item) => item.contentExcerpt)).toEqual(['newest', 'middle', 'oldest']);
    expect(result.data.items[0].projectPath).toBe('/q');
  });

  it('filters by project, category and status', async () => {
    const storageDir = await seedStorage([
      { projectPath: '/p', category: 'work', content: 'a', createdAt: 100 },
      { projectPath: '/p', category: 'work', content: 'b', createdAt: 200, status: 'archived' },
      { projectPath: '/p', category: 'personal', content: 'c', createdAt: 300 },
    ]);
    const result = await makeRuntime(storageDir).listMemories({ projectPath: '/p', status: 'active' });
    expect(result.data.total).toBe(2);
    expect(result.data.items.map((item) => item.contentExcerpt).sort()).toEqual(['a', 'c']);
  });

  it('filters memories by a search term', async () => {
    const storageDir = await seedStorage([
      { projectPath: '/p', category: 'work', content: 'sqlite query details here', createdAt: 100 },
      { projectPath: '/p', category: 'work', content: 'unrelated note', createdAt: 200 },
    ]);
    const result = await makeRuntime(storageDir).listMemories({ search: 'sqlite' });
    expect(result.data.total).toBe(1);
    expect(result.data.items[0].contentExcerpt).toBe('sqlite query details here');
  });

  it('pages with limit and offset', async () => {
    const storageDir = await seedStorage([
      { projectPath: '/p', category: 'work', content: 'c1', createdAt: 100 },
      { projectPath: '/p', category: 'work', content: 'c2', createdAt: 200 },
      { projectPath: '/p', category: 'work', content: 'c3', createdAt: 300 },
    ]);
    const result = await makeRuntime(storageDir).listMemories({ limit: 2, offset: 1 });
    expect(result.data.total).toBe(3);
    expect(result.data.items.map((item) => item.contentExcerpt)).toEqual(['c2', 'c1']);
  });

  it('returns the gating payload when the database is missing', async () => {
    const storageDir = makeTempDir();
    const result = await makeRuntime(storageDir).listMemories({});
    expect(result.ok).toBeUndefined();
    expect(result.available).toBe(false);
    expect(result.reason).toBe(MC_UNAVAILABLE_MISSING_DB);
  });

  it('validates route query parameters and responds through the runtime', async () => {
    const storageDir = await seedStorage([
      { projectPath: '/p', category: 'work', content: 'only', createdAt: 100 },
    ]);
    const routes = new Map();
    const app = {
      get(routePath, handler) {
        routes.set(`GET ${routePath}`, handler);
      },
    };
    registerMcDashboardRoutes(app, { runtime: makeRuntime(storageDir) });

    const handler = routes.get('GET /api/openchamber/mc/memories');
    expect(handler).toBeTypeOf('function');

    const invoke = async (query) => new Promise((resolve, reject) => {
      const res = {
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          resolve({ status: this.statusCode, payload });
        },
      };
      handler({ query }, res).catch(reject);
    });

    const bad = await invoke({ limit: 'abc' });
    expect(bad.status).toBe(400);
    expect(bad.payload.error).toContain('limit');

    const good = await invoke({});
    expect(good.status).toBeUndefined();
    expect(good.payload.total).toBe(1);
    expect(good.payload.items[0].contentExcerpt).toBe('only');
  });
});

describe('overview', () => {
  it('aggregates memory counts from the plugin table', async () => {
    const storageDir = makeTempDir();
    const dbPath = path.join(storageDir, 'context.db');
    const opened = await openMagicContextDatabaseForWrite({ dbPath });
    expect(opened.ok).toBe(true);
    try {
      const db = opened.db;
      db.exec(`
        CREATE TABLE memories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_path TEXT NOT NULL,
          category TEXT NOT NULL,
          content TEXT NOT NULL,
          status TEXT DEFAULT 'active'
        );
      `);
      const insert = db.prepare('INSERT INTO memories (project_path, category, content, status) VALUES (?, ?, ?, ?)');
      insert.run('/p1', 'work', 'a', 'active');
      insert.run('/p1', 'work', 'b', 'permanent');
      insert.run('/p2', 'personal', 'c', 'archived');
    } finally {
      opened.db.close();
    }
    const runtime = createMcDashboardRuntime({
      env: { MAGIC_CONTEXT_STORAGE_DIR: storageDir },
      homedir: () => '/home/tester',
    });
    const result = await runtime.overview();
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      totalMemories: 3,
      currentMemories: 2,
      projects: 2,
      categories: 2,
    });
  });
});

describe('extended surfaces', () => {
  const createRuntimeFor = (env) =>
    createMcDashboardRuntime({
      env,
      homedir: () => '/home/tester',
      tmpdir: () => '/tmp',
    });

  const seedContextWith = async (storageDir, setup) => {
    const dbPath = path.join(storageDir, 'context.db');
    const opened = await openMagicContextDatabaseForWrite({ dbPath });
    expect(opened.ok).toBe(true);
    try {
      setup(opened.db);
    } finally {
      opened.db.close();
    }
  };

  const seedOpencodeDb = async (xdgHome) => {
    const dir = path.join(xdgHome, 'opencode');
    fs.mkdirSync(dir, { recursive: true });
    const dbPath = path.join(dir, 'opencode.db');
    const opened = await openMagicContextDatabaseForWrite({ dbPath });
    expect(opened.ok).toBe(true);
    try {
      const db = opened.db;
      db.exec(`
        CREATE TABLE project (id TEXT PRIMARY KEY, name TEXT NOT NULL, worktree TEXT);
        CREATE TABLE session (
          id TEXT PRIMARY KEY,
          title TEXT,
          directory TEXT,
          time_updated INTEGER NOT NULL,
          time_archived INTEGER,
          project_id TEXT
        );
      `);
      db.prepare('INSERT INTO project (id, name, worktree) VALUES (?, ?, ?)').run('p1', 'Demo', 'main');
      db.prepare('INSERT INTO session (id, title, directory, time_updated, time_archived, project_id) VALUES (?, ?, ?, ?, ?, ?)').run('s1', 'Chat about sqlite', '/p1', 300, null, 'p1');
      db.prepare('INSERT INTO session (id, title, directory, time_updated, time_archived, project_id) VALUES (?, ?, ?, ?, ?, ?)').run('s2', 'Archived one', '/p2', 100, 1, null);
    } finally {
      opened.db.close();
    }
  };

  it('lists sessions from the opencode database', async () => {
    const xdgHome = makeTempDir();
    await seedOpencodeDb(xdgHome);
    const runtime = createRuntimeFor({ XDG_DATA_HOME: xdgHome });
    const result = await runtime.listSessions({});
    expect(result.ok).toBe(true);
    expect(result.data.total).toBe(1);
    expect(result.data.items[0]).toMatchObject({
      id: 's1',
      title: 'Chat about sqlite',
      projectName: 'Demo',
      directory: '/p1',
      lastActivity: 300,
    });
  });

  it('reports missing-opencode-db when the opencode database is absent', async () => {
    const runtime = createRuntimeFor({ XDG_DATA_HOME: makeTempDir() });
    const result = await runtime.listSessions({});
    expect(result.ok).toBeUndefined();
    expect(result.available).toBe(false);
    expect(result.reason).toBe('missing-opencode-db');
  });

  it('reads session insight, dream runs, primers and user memories from context.db', async () => {
    const storageDir = makeTempDir();
    await seedContextWith(storageDir, (db) => {
      db.exec(`
        CREATE TABLE session_meta (
          session_id TEXT PRIMARY KEY, harness TEXT, is_subagent INTEGER,
          last_response_time INTEGER, last_input_tokens INTEGER,
          system_prompt_tokens INTEGER, total_input_tokens INTEGER,
          cached_m0_bytes INTEGER, memory_block_count INTEGER,
          memory_block_cache INTEGER, conversation_tokens INTEGER,
          tool_call_tokens INTEGER, last_usage_context_limit INTEGER,
          last_context_percentage INTEGER
        );
        CREATE TABLE session_facts (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, category TEXT, content TEXT NOT NULL, created_at INTEGER, updated_at INTEGER);
        CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT DEFAULT 'session', status TEXT DEFAULT 'active', content TEXT, session_id TEXT, project_path TEXT, created_at INTEGER, updated_at INTEGER, ready_at INTEGER);
        CREATE TABLE compartments (session_id TEXT NOT NULL, sequence INTEGER NOT NULL, created_at INTEGER);
        CREATE TABLE dream_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_path TEXT NOT NULL, started_at INTEGER, finished_at INTEGER, tasks_succeeded INTEGER, tasks_failed INTEGER, smart_notes_surfaced INTEGER, smart_notes_pending INTEGER, parent_session_id TEXT, memory_changes_json TEXT);
        CREATE TABLE primers (id INTEGER PRIMARY KEY AUTOINCREMENT, project_path TEXT NOT NULL, question TEXT NOT NULL, answer TEXT, status TEXT DEFAULT 'active', total_support INTEGER, last_observed_at INTEGER, created_at INTEGER, updated_at INTEGER);
        CREATE TABLE user_memories (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, status TEXT DEFAULT 'active', promoted_at INTEGER, created_at INTEGER, updated_at INTEGER);
      `);
      db.prepare('INSERT INTO session_meta (session_id, harness, last_input_tokens, is_subagent, last_response_time) VALUES (?, ?, ?, ?, ?)').run('s1', 'opencode', 1200, 0, 500);      db.prepare('INSERT INTO session_facts (session_id, category, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('s1', 'CONFIG_VALUES', 'fact one', 1, 1);
      db.prepare('INSERT INTO notes (session_id, type, status, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('s1', 'session', 'active', 'note one', 2, 2);
      db.prepare('INSERT INTO compartments (session_id, sequence, created_at) VALUES (?, ?, ?)').run('s1', 1, 3);
      db.prepare('INSERT INTO dream_runs (project_path, started_at, finished_at, tasks_succeeded, tasks_failed, smart_notes_surfaced, smart_notes_pending) VALUES (?, ?, ?, ?, ?, ?, ?)').run('/p1', 10, 20, 3, 1, 2, 0);
      db.prepare('INSERT INTO primers (project_path, question, answer, status, total_support, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('/p1', 'q?', 'a', 'active', 5, 1, 2);
      db.prepare('INSERT INTO user_memories (content, status, promoted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('keep this', 'active', 5, 4, 4);
    });
    const runtime = createRuntimeFor({ MAGIC_CONTEXT_STORAGE_DIR: storageDir });

    const insight = await runtime.getSessionInsight('s1');
    expect(insight.ok).toBe(true);
    expect(insight.data.meta.harness).toBe('opencode');
    expect(insight.data.meta.lastInputTokens).toBe(1200);
    expect(insight.data.factCount).toBe(1);
    expect(insight.data.noteCount).toBe(1);
    expect(insight.data.compartmentCount).toBe(1);
    expect(insight.data.compartments[0].sequence).toBe(1);

    const runs = await runtime.listDreamRuns({});
    expect(runs.data.total).toBe(1);
    expect(runs.data.items[0].tasksSucceeded).toBe(3);

    const primers = await runtime.listPrimers({});
    expect(primers.data.items[0].question).toBe('q?');

    const memories = await runtime.listUserMemories({});
    expect(memories.data.items[0].content).toBe('keep this');
  });

  it('classifies assistant cache events from opencode messages', async () => {
    const xdgHome = makeTempDir();
    const dir = path.join(xdgHome, 'opencode');
    fs.mkdirSync(dir, { recursive: true });
    const dbPath = path.join(dir, 'opencode.db');
    const opened = await openMagicContextDatabaseForWrite({ dbPath });
    expect(opened.ok).toBe(true);
    try {
      const db = opened.db;
      db.exec('CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER, data TEXT NOT NULL)');
      const insert = db.prepare('INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)');
      insert.run('m1', 's1', 100, JSON.stringify({ role: 'user', tokens: null }));
      insert.run('m2', 's1', 200, JSON.stringify({ role: 'assistant', tokens: { total: 100, input: 100, output: 0, cache: { read: 0, write: 50 } } }));
      insert.run('m3', 's1', 300, JSON.stringify({ role: 'assistant', tokens: { total: 60, input: 10, output: 2, cache: { read: 49, write: 0 } } }));
      insert.run('m4', 's1', 400, JSON.stringify({ role: 'assistant', tokens: { total: 60, input: 10, output: 2, cache: { read: 0, write: 60 } } }));
    } finally {
      opened.db.close();
    }
    const runtime = createRuntimeFor({ XDG_DATA_HOME: xdgHome });
    const result = await runtime.getSessionCacheEvents('s1');
    expect(result.ok).toBe(true);
    expect(result.data.events.map((event) => event.severity)).toEqual(['info', 'stable', 'full-bust']);
    expect(result.data.summary).toMatchObject({ info: 1, stable: 1, 'full-bust': 1, bust: 0 });
  });

  it('reads config and log file previews', async () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'cortexkit'), { recursive: true });
    fs.mkdirSync(path.join(root, 'opencode', 'magic-context'), { recursive: true });
    fs.writeFileSync(path.join(root, 'cortexkit', 'magic-context.jsonc'), '// config\n{"enabled": true}');
    fs.writeFileSync(path.join(root, 'opencode', 'magic-context', 'magic-context.log'), 'line one\nline two');

    const env = {
      XDG_CONFIG_HOME: path.join(root, 'cfg'),
      MAGIC_CONTEXT_LOG_PATH: path.join(root, 'opencode', 'magic-context', 'magic-context.log'),
    };
    const configDir = path.join(env.XDG_CONFIG_HOME, 'cortexkit');
    fs.mkdirSync(configDir, { recursive: true });
    fs.copyFileSync(path.join(root, 'cortexkit', 'magic-context.jsonc'), path.join(configDir, 'magic-context.jsonc'));

    const runtime = createRuntimeFor(env);
    const config = await runtime.readConfig();
    expect(config.data.exists).toBe(true);
    expect(config.data.content).toContain('"enabled": true');
    const logs = await runtime.readLogs();
    expect(logs.data.exists).toBe(true);
    expect(logs.data.content).toContain('line two');
  });
});

describe('workspaces', () => {
  const seedWorkspaces = async () => {
    const storageDir = makeTempDir();
    const dbPath = path.join(storageDir, 'context.db');
    const opened = await openMagicContextDatabaseForWrite({ dbPath });
    expect(opened.ok).toBe(true);
    try {
      const db = opened.db;
      db.exec(`
        CREATE TABLE workspaces (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          share_categories TEXT NOT NULL DEFAULT '["CONSTRAINTS"]'
        );
        CREATE TABLE workspace_members (
          workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          project_path TEXT NOT NULL,
          display_name TEXT NOT NULL
        );
      `);
      db.prepare('INSERT INTO workspaces (id, name, created_at, updated_at, share_categories) VALUES (1, ?, 100, 300, ?)').run('ws-a', '["CONSTRAINTS","ARCHITECTURE"]');
      db.prepare('INSERT INTO workspaces (id, name, created_at, updated_at, share_categories) VALUES (2, ?, 200, 200, ?)').run('ws-b', '["CONSTRAINTS"]');
      db.prepare('INSERT INTO workspace_members (workspace_id, project_path, display_name) VALUES (1, ?1, ?1)').run('/p1');
      db.prepare('INSERT INTO workspace_members (workspace_id, project_path, display_name) VALUES (1, ?1, ?1)').run('/p2');
    } finally {
      opened.db.close();
    }
    return storageDir;
  };

  it('lists workspaces newest-updated first with member counts', async () => {
    const storageDir = await seedWorkspaces();
    const runtime = createMcDashboardRuntime({
      env: { MAGIC_CONTEXT_STORAGE_DIR: storageDir },
      homedir: () => '/home/tester',
    });
    const result = await runtime.listWorkspaces({});
    expect(result.ok).toBe(true);
    expect(result.data.total).toBe(2);
    expect(result.data.items.map((item) => item.name)).toEqual(['ws-a', 'ws-b']);
    expect(result.data.items[0].memberCount).toBe(2);
    expect(result.data.items[1].memberCount).toBe(0);
    expect(result.data.items[0].shareCategories).toBe('["CONSTRAINTS","ARCHITECTURE"]');
  });
});
