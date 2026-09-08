const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const EXCERPT_LENGTH = 240;

const selectColumns = [
  'id',
  'project_path',
  'category',
  'status',
  'importance',
  'scope',
  'source_type',
  'first_seen_at',
  'created_at',
  'updated_at',
  'last_seen_at',
  'last_retrieved_at',
  'expires_at',
  'verification_status',
];

const toCamel = (row) => ({
  id: row.id,
  projectPath: row.project_path,
  category: row.category,
  status: row.status,
  importance: row.importance ?? null,
  scope: row.scope,
  sourceType: row.source_type ?? null,
  contentExcerpt: row.content_excerpt ?? null,
  firstSeenAt: row.first_seen_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastSeenAt: row.last_seen_at,
  lastRetrievedAt: row.last_retrieved_at ?? null,
  expiresAt: row.expires_at ?? null,
  verificationStatus: row.verification_status ?? null,
});

export const listMemories = (db, { projectPath, category, status, limit = DEFAULT_LIMIT, offset = 0 } = {}) => {
  const where = [];
  const bind = [];
  if (projectPath !== undefined) {
    where.push('project_path = ?');
    bind.push(projectPath);
  }
  if (category !== undefined) {
    where.push('category = ?');
    bind.push(category);
  }
  if (status !== undefined) {
    where.push('status = ?');
    bind.push(status);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS total FROM memories ${clause}`)
    .get(...bind);
  const total = totalRow && Number.isFinite(Number(totalRow.total)) ? Number(totalRow.total) : 0;

  const effectiveLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);
  const effectiveOffset = Math.max(offset, 0);
  const sql = `
    SELECT ${selectColumns.join(', ')},
           substr(content, 1, ${EXCERPT_LENGTH}) AS content_excerpt
    FROM memories
    ${clause}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `;
  const rows = db.prepare(sql).all(...bind, effectiveLimit, effectiveOffset);
  return { total, limit: effectiveLimit, offset: effectiveOffset, items: rows.map(toCamel) };
};
