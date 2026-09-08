import { dbFileExists, resolveMagicContextDbPath } from './paths.js';
import { openMagicContextDatabase } from './sqlite.js';
import { listMemories } from './queries/memories.js';

export const MC_TARGET_VERSION = '0.41.4';
export const MC_MAX_SUPPORTED_SCHEMA = 84;
export const MC_FORK_VERSION_FLOOR = 10000;

export const MC_UNAVAILABLE_MISSING_DB = 'missing-db';
export const MC_UNAVAILABLE_SCHEMA_TOO_NEW = 'schema-too-new';
export const MC_UNAVAILABLE_SQLITE = 'sqlite-unavailable';
export const MC_UNAVAILABLE_OPEN_FAILED = 'open-failed';
export const MC_UNAVAILABLE_STORAGE = 'storage-dir-unavailable';

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

export const createMcDashboardRuntime = ({ env, homedir }) => {
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

  const listMemoriesRoute = async (options) => {
    const opened = await openCheckedMagicContextDatabase({ env, homedir });
    if (!opened.ok) {
      return opened.payload;
    }
    try {
      return { ok: true, data: listMemories(opened.db, options) };
    } finally {
      opened.db.close();
    }
  };

  return { getMeta, listMemories: listMemoriesRoute };
};
