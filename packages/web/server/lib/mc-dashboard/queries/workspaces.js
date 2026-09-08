// Read-only queries authored from the pinned plugin source
// magic-context v0.41.4 (storage-db.ts workspaces/workspace_members DDL).
// Update together when MC_TARGET_VERSION advances.
export const listWorkspaces = (db, { limit = 100, offset = 0 } = {}) => {
  const effectiveLimit = Math.min(Math.max(limit, 1), 500);
  const effectiveOffset = Math.max(offset, 0);
  const totalRow = db.prepare('SELECT COUNT(*) AS total FROM workspaces').get();
  const total = totalRow && Number.isFinite(Number(totalRow.total)) ? Number(totalRow.total) : 0;
  const rows = db
    .prepare(`
      SELECT w.id, w.name, w.created_at, w.updated_at, w.share_categories,
             COUNT(wm.project_path) AS member_count
      FROM workspaces w
      LEFT JOIN workspace_members wm ON wm.workspace_id = w.id
      GROUP BY w.id
      ORDER BY w.updated_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(effectiveLimit, effectiveOffset);
  return {
    total,
    limit: effectiveLimit,
    offset: effectiveOffset,
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      shareCategories: row.share_categories,
      memberCount: Number.isFinite(Number(row.member_count)) ? Number(row.member_count) : 0,
    })),
  };
};
