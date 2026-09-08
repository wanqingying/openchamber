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

  it('returns the gating payload when the database is missing', async () => {
    const storageDir = makeTempDir();
    const runtime = createMcDashboardRuntime({
      env: { MAGIC_CONTEXT_STORAGE_DIR: storageDir },
      homedir: () => '/home/tester',
    });
    const result = await runtime.overview();
    expect(result.ok).toBeUndefined();
    expect(result.available).toBe(false);
    expect(result.reason).toBe(MC_UNAVAILABLE_MISSING_DB);
  });
});
