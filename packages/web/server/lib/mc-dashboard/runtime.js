import { dbFileExists, resolveMagicContextDbPath } from './paths.js';
import { openMagicContextDatabase } from './sqlite.js';
import { listMemories } from './queries/memories.js';
import { memoryOverview } from './queries/overview.js';
import { listWorkspaces } from './queries/workspaces.js';
import { listOpencodeSessions, resolveOpencodeDbPath } from './queries/opencode.js';
import { sessionInsight } from './queries/session-insight.js';
import { listDreamRuns } from './queries/dreamer.js';
import { listPrimers, listUserMemories } from './queries/primers.js';
import { readFilePreview, resolveMagicContextLogPath, resolveUserConfigPath } from './queries/files.js';

export const MC_TARGET_VERSION = '0.41.4';
export const MC_MAX_SUPPORTED_SCHEMA = 84;
export const MC_FORK_VERSION_FLOOR = 10000;

export const MC_UNAVAILABLE_MISSING_DB = 'missing-db';
export const MC_UNAVAILABLE_SCHEMA_TOO_NEW = 'schema-too-new';
export const MC_UNAVAILABLE_SQLITE = 'sqlite-unavailable';
export const MC_UNAVAILABLE_OPEN_FAILED = 'open-failed';
export const MC_UNAVAILABLE_STORAGE = 'storage-dir-unavailable';
export const MC_UNAVAILABLE_NO_OPENCODE = 'missing-opencode-db';

export const readPersistedSchemaVersion = (db) => {
  const table = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  if (!table) {
    return 0;
  }
  const row = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations WHERE version < ?')
    .get(MC_FORK_VERSION_FLOOR);
  return row && Number.isFinite(Number(row.version)) ? Number(row.version) : 0;
};

const identityMeta = () => ({
  targetMcVersion: MC_TARGET_VERSION,
  maxSupportedSchema: MC_MAX_SUPPORTED_SCHEMA,
});

export const openCheckedMagicContextDatabase = async ({ env, homedir }) => {
  const meta = identityMeta();
  let dbPath;
  try {
    dbPath = resolveMagicContextDbPath({ env, homedir });
  } catch {
    return { ok: false, payload: { available: false, reason: MC_UNAVAILABLE_STORAGE, ...meta } };
  }
  if (!dbFileExists(dbPath)) {
    return { ok: false, payload: { available: false, reason: MC_UNAVAILABLE_MISSING_DB, ...meta } };
  }
  const opened = await openMagicContextDatabase({ dbPath });
  if (!opened.ok) {
    return {
      ok: false,
      payload: {
        available: false,
        reason: opened.code,
        detail: opened.detail ?? null,
        ...meta,
      },
    };
  }
  let schemaVersion;
  try {
    schemaVersion = readPersistedSchemaVersion(opened.db);
  } catch (error) {
    opened.db.close();
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      payload: { available: false, reason: MC_UNAVAILABLE_OPEN_FAILED, detail, ...meta },
    };
  }
  if (schemaVersion > MC_MAX_SUPPORTED_SCHEMA) {
    opened.db.close();
    return {
      ok: false,
      payload: {
        available: false,
        reason: MC_UNAVAILABLE_SCHEMA_TOO_NEW,
        schemaVersion,
        ...meta,
      },
    };
  }
  return { ok: true, db: opened.db, dbPath, schemaVersion, ...meta };
};

const openSqlite = async (dbPath) => {
  if (!dbPath) {
    return { ok: false, code: MC_UNAVAILABLE_MISSING_DB };
  }
  if (!dbFileExists(dbPath)) {
    return { ok: false, code: MC_UNAVAILABLE_MISSING_DB };
  }
  return openMagicContextDatabase({ dbPath });
};

const openOpencodeDb = async ({ env, homedir }) => {
  const meta = identityMeta();
  const dbPath = resolveOpencodeDbPath({ env, homedir });
  if (!dbPath) {
    return { ok: false, payload: { available: false, reason: MC_UNAVAILABLE_NO_OPENCODE, ...meta } };
  }
  const opened = await openSqlite(dbPath);
  if (!opened.ok) {
    return {
      ok: false,
      payload: {
        available: false,
        reason: opened.code === MC_UNAVAILABLE_SQLITE ? opened.code : opened.code === MC_UNAVAILABLE_MISSING_DB ? MC_UNAVAILABLE_NO_OPENCODE : MC_UNAVAILABLE_OPEN_FAILED,
        detail: opened.detail ?? null,
        ...meta,
      },
    };
  }
  return { ok: true, db: opened.db, dbPath };
};

const queryWithClose = async (handle, query) => {
  try {
    return { ok: true, data: query(handle.db) };
  } finally {
    handle.db.close();
  }
};

export const createMcDashboardRuntime = ({ env, homedir, tmpdir = () => '/tmp' }) => {
  const run = async (query) => {
    const opened = await openCheckedMagicContextDatabase({ env, homedir });
    if (!opened.ok) {
      return opened.payload;
    }
    return queryWithClose(opened, query);
  };

  const listFromContext = (queryFn) => async (options) => {
    const result = await run((db) => queryFn(db, options));
    if (!result.ok) {
      return result;
    }
    return { ok: true, data: result.data };
  };

  const getMeta = async () => {
    const opened = await openCheckedMagicContextDatabase({ env, homedir });
    if (!opened.ok) {
      return opened.payload;
    }
    try {
      return {
        available: true,
        schemaVersion: opened.schemaVersion,
        targetMcVersion: MC_TARGET_VERSION,
        maxSupportedSchema: MC_MAX_SUPPORTED_SCHEMA,
      };
    } finally {
      opened.db.close();
    }
  };

  const listSessions = async (options) => {
    const opened = await openOpencodeDb({ env, homedir });
    if (!opened.ok) {
      return opened.payload;
    }
    return queryWithClose(opened, (db) => listOpencodeSessions(db, options));
  };

  const getSessionInsight = async (sessionId) => {
    const result = await run((db) => sessionInsight(db, sessionId));
    if (!result.ok) {
      return result;
    }
    return { ok: true, data: result.data };
  };

  const readConfig = async () => {
    const filePath = resolveUserConfigPath({ env, homedir });
    return { ok: true, data: readFilePreview(filePath) };
  };

  const readLogs = async () => {
    const filePath = resolveMagicContextLogPath({ env, tmpdir });
    return { ok: true, data: readFilePreview(filePath) };
  };

  return {
    getMeta,
    listMemories: listFromContext(listMemories),
    overview: listFromContext((db) => memoryOverview(db)),
    listWorkspaces: listFromContext(listWorkspaces),
    listDreamRuns: listFromContext(listDreamRuns),
    listPrimers: listFromContext(listPrimers),
    listUserMemories: listFromContext(listUserMemories),
    listSessions,
    getSessionInsight,
    readConfig,
    readLogs,
  };
};
