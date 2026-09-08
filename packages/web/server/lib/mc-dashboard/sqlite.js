const BUSY_TIMEOUT_MS = 5000;

export const SQLITE_UNAVAILABLE = 'sqlite-unavailable';
export const SQLITE_OPEN_FAILED = 'open-failed';

const bunRuntime = () => Boolean(process.versions && process.versions.bun);

const loadDriver = async () => {
  if (bunRuntime()) {
    const { Database } = await import('bun:sqlite');
    return { Database, kind: 'bun', readOnlyOption: 'readonly' };
  }
  const { DatabaseSync } = await import('node:sqlite');
  return { Database: DatabaseSync, kind: 'node', readOnlyOption: 'readOnly' };
};

export const openMagicContextDatabase = async ({ dbPath }) => {
  let driver;
  try {
    driver = await loadDriver();
  } catch {
    return { ok: false, code: SQLITE_UNAVAILABLE };
  }
  const { Database, readOnlyOption } = driver;
  const options = {};
  options[readOnlyOption] = true;
  let db;
  try {
    db = new Database(dbPath, options);
    db.exec(`PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, code: SQLITE_OPEN_FAILED, detail };
  }
  return { ok: true, db };
};

export const openMagicContextDatabaseForWrite = async ({ dbPath }) => {
  let driver;
  try {
    driver = await loadDriver();
  } catch {
    return { ok: false, code: SQLITE_UNAVAILABLE };
  }
  const { Database } = driver;
  try {
    const db = new Database(dbPath);
    db.exec(`PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}`);
    return { ok: true, db };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, code: SQLITE_OPEN_FAILED, detail };
  }
};
