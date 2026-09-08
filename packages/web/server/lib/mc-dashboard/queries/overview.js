export const memoryOverview = (db) => {
  const read = (sql) => {
    const row = db.prepare(sql).get();
    return row && Number.isFinite(Number(row.count)) ? Number(row.count) : 0;
  };
  return {
    totalMemories: read('SELECT COUNT(*) AS count FROM memories'),
    activeMemories: read("SELECT COUNT(*) AS count FROM memories WHERE status = 'active'"),
    projects: read('SELECT COUNT(DISTINCT project_path) AS count FROM memories'),
    categories: read('SELECT COUNT(DISTINCT category) AS count FROM memories'),
  };
};
