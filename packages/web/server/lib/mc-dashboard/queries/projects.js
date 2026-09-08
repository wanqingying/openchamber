// Read-only per-project memory statistics authored from the pinned plugin
// source magic-context v0.41.4 (memories DDL). Update with MC_TARGET_VERSION.
export const projectMemoryStats = (db, { limit = 100 } = {}) => {
  const effectiveLimit = Math.min(Math.max(limit, 1), 500);
  const rows = db
    .prepare(`
      SELECT project_path, status, category, COUNT(*) AS count, MAX(updated_at) AS last_updated
      FROM memories
      GROUP BY project_path, status, category
    `)
    .all();
  const byProject = new Map();
  for (const row of rows) {
    let entry = byProject.get(row.project_path);
    if (!entry) {
      entry = {
        projectPath: row.project_path,
        totalMemories: 0,
        active: 0,
        permanent: 0,
        archived: 0,
        lastUpdatedAt: null,
        categories: new Map(),
      };
      byProject.set(row.project_path, entry);
    }
    const count = Number.isFinite(Number(row.count)) ? Number(row.count) : 0;
    entry.totalMemories += count;
    if (row.status === 'active') {
      entry.active += count;
    } else if (row.status === 'permanent') {
      entry.permanent += count;
    } else if (row.status === 'archived') {
      entry.archived += count;
    }
    entry.categories.set(row.category, (entry.categories.get(row.category) ?? 0) + count);
    const lastUpdated = Number.isFinite(Number(row.last_updated)) ? Number(row.last_updated) : 0;
    if (entry.lastUpdatedAt === null || lastUpdated > entry.lastUpdatedAt) {
      entry.lastUpdatedAt = lastUpdated;
    }
  }
  const items = [...byProject.values()]
    .map((entry) => ({
      projectPath: entry.projectPath,
      totalMemories: entry.totalMemories,
      active: entry.active,
      permanent: entry.permanent,
      archived: entry.archived,
      lastUpdatedAt: entry.lastUpdatedAt,
      categories: [...entry.categories.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => (b.lastUpdatedAt ?? 0) - (a.lastUpdatedAt ?? 0));
  return {
    total: items.length,
    limit: effectiveLimit,
    offset: 0,
    items: items.slice(0, effectiveLimit),
  };
};
