// Read-only aggregate queries authored from the pinned plugin source
// magic-context v0.41.4 (packages/plugin/src/features/magic-context/storage-db.ts,
// migrations.ts). Update these together when MC_TARGET_VERSION advances.
export const memoryOverview = (db) => {
  const read = (sql) => {
    const row = db.prepare(sql).get();
    return row && Number.isFinite(Number(row.count)) ? Number(row.count) : 0;
  };
  return {
    totalMemories: read('SELECT COUNT(*) AS count FROM memories'),
    currentMemories: read("SELECT COUNT(*) AS count FROM memories WHERE status IN ('active', 'permanent')"),
    projects: read('SELECT COUNT(DISTINCT project_path) AS count FROM memories'),
    categories: read('SELECT COUNT(DISTINCT category) AS count FROM memories'),
  };
};
