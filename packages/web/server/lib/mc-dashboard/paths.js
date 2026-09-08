import fs from 'node:fs';
import path from 'node:path';

export const MC_STORAGE_APP_DIR = 'cortexkit/magic-context';
export const MC_DB_FILE = 'context.db';

const envValue = (env, key) => {
  const raw = env[key];
  return raw === undefined || raw === null ? '' : String(raw).trim();
};

export const resolveMagicContextStorageDir = ({ env, homedir }) => {
  const explicit = envValue(env, 'MAGIC_CONTEXT_STORAGE_DIR');
  if (explicit) {
    if (!path.isAbsolute(explicit)) {
      throw new Error('MAGIC_CONTEXT_STORAGE_DIR must be an absolute path');
    }
    return explicit;
  }
  const xdgDataHome = envValue(env, 'XDG_DATA_HOME');
  if (xdgDataHome) {
    return path.join(xdgDataHome, MC_STORAGE_APP_DIR);
  }
  return path.join(homedir(), '.local', 'share', MC_STORAGE_APP_DIR);
};

export const resolveMagicContextDbPath = ({ env, homedir }) => {
  const storageDir = resolveMagicContextStorageDir({ env, homedir });
  return path.join(storageDir, MC_DB_FILE);
};

export const dbFileExists = (dbPath) => {
  try {
    return fs.statSync(dbPath).isFile();
  } catch {
    return false;
  }
};
