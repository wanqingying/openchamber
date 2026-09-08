import fs from 'node:fs';
import path from 'node:path';

const envValue = (env, key) => {
  const raw = env[key];
  return raw === undefined || raw === null ? '' : String(raw).trim();
};

export const resolveOpencodeDataDir = ({ env, homedir }) => {
  const xdgDataHome = envValue(env, 'XDG_DATA_HOME');
  return xdgDataHome ? path.join(xdgDataHome, 'opencode') : path.join(homedir(), '.local', 'share', 'opencode');
};

export const resolveOpencodeDbPath = ({ env, homedir }) => {
  const explicit = envValue(env, 'OPENCODE_DB');
  if (explicit) {
    try {
      if (fs.statSync(explicit).isFile()) {
        return explicit;
      }
    } catch {
      return null;
    }
    return null;
  }
  const dataDir = resolveOpencodeDataDir({ env, homedir });
  let entries = [];
  try {
    entries = fs.readdirSync(dataDir);
  } catch {
    return null;
  }
  let best = null;
  for (const entry of entries) {
    if (!/^opencode(?:-[A-Za-z0-9._-]+)?\.db$/.test(entry)) {
      continue;
    }
    const candidate = path.join(dataDir, entry);
    let mtime = 0;
    try {
      mtime = fs.statSync(candidate).mtimeMs;
    } catch {
      continue;
    }
    if (best === null || mtime > best.mtime) {
      best = { path: candidate, mtime };
    }
  }
  return best ? best.path : null;
};

const selectSessionColumns = `
  SELECT s.id AS id,
         COALESCE(s.title, '') AS title,
         COALESCE(p.name, '') AS project_name,
         COALESCE(p.worktree, '') AS worktree,
         COALESCE(s.directory, '') AS directory,
         s.time_updated AS last_activity
  FROM session s
  LEFT JOIN project p ON p.id = s.project_id
`;

export const listOpencodeSessions = (db, { limit = 50, offset = 0 } = {}) => {
  const effectiveLimit = Math.min(Math.max(limit, 1), 200);
  const effectiveOffset = Math.max(offset, 0);
  const totalRow = db
    .prepare('SELECT COUNT(*) AS total FROM session WHERE time_archived IS NULL')
    .get();
  const total = totalRow && Number.isFinite(Number(totalRow.total)) ? Number(totalRow.total) : 0;
  const rows = db
    .prepare(`${selectSessionColumns} WHERE s.time_archived IS NULL ORDER BY s.time_updated DESC LIMIT ? OFFSET ?`)
    .all(effectiveLimit, effectiveOffset);
  return {
    total,
    limit: effectiveLimit,
    offset: effectiveOffset,
    items: rows.map((row) => ({
      id: String(row.id),
      title: row.title,
      projectName: row.project_name,
      worktree: row.worktree,
      directory: row.directory,
      lastActivity: Number.isFinite(Number(row.last_activity)) ? Number(row.last_activity) : 0,
    })),
  };
};
