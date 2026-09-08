import fs from 'node:fs';
import path from 'node:path';

const envValue = (env, key) => {
  const raw = env[key];
  return raw === undefined || raw === null ? '' : String(raw).trim();
};

export const resolveUserConfigPath = ({ env, homedir }) => {
  const xdgConfigHome = envValue(env, 'XDG_CONFIG_HOME');
  const root = xdgConfigHome || path.join(homedir(), '.config');
  return path.join(root, 'cortexkit', 'magic-context.jsonc');
};

export const resolveMagicContextLogPath = ({ env, tmpdir }) => {
  const override = envValue(env, 'MAGIC_CONTEXT_LOG_PATH');
  if (override) {
    return override;
  }
  return path.join(tmpdir(), 'opencode', 'magic-context', 'magic-context.log');
};

export const readFilePreview = (filePath, maxBytes = 256 * 1024) => {
  let stat;
  try {
    stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return { exists: false, path: filePath, sizeBytes: 0, content: '' };
    }
  } catch {
    return { exists: false, path: filePath, sizeBytes: 0, content: '' };
  }
  const size = stat.size;
  const start = Math.max(0, size - maxBytes);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    let content = buffer.toString('utf8');
    if (start > 0) {
      const firstNewline = content.indexOf('\n');
      if (firstNewline !== -1) {
        content = content.slice(firstNewline + 1);
      }
    }
    return { exists: true, path: filePath, sizeBytes: size, content };
  } finally {
    fs.closeSync(fd);
  }
};
