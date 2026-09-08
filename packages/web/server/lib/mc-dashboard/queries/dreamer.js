// Read-only queries authored from the pinned plugin source
// magic-context v0.41.4 (storage-db.ts dream_runs DDL + dashboard db.rs). Update with MC_TARGET_VERSION.
export const listDreamRuns = (db, { projectPath, limit = 50, offset = 0 } = {}) => {
  const effectiveLimit = Math.min(Math.max(limit, 1), 200);
  const effectiveOffset = Math.max(offset, 0);
  const where = [];
  const bind = [];
  if (projectPath !== undefined) {
    where.push('project_path = ?');
    bind.push(projectPath);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM dream_runs ${clause}`).get();
  const total = totalRow && Number.isFinite(Number(totalRow.total)) ? Number(totalRow.total) : 0;
  const rows = db
    .prepare(`
      SELECT id, project_path, started_at, finished_at, tasks_succeeded, tasks_failed,
             smart_notes_surfaced, smart_notes_pending, parent_session_id
      FROM dream_runs
      ${clause}
      ORDER BY finished_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(...bind, effectiveLimit, effectiveOffset);
  const toNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
  return {
    total,
    limit: effectiveLimit,
    offset: effectiveOffset,
    items: rows.map((row) => ({
      id: row.id,
      projectPath: row.project_path,
      startedAt: toNumber(row.started_at),
      finishedAt: toNumber(row.finished_at),
      tasksSucceeded: toNumber(row.tasks_succeeded),
      tasksFailed: toNumber(row.tasks_failed),
      smartNotesSurfaced: toNumber(row.smart_notes_surfaced),
      smartNotesPending: toNumber(row.smart_notes_pending),
      parentSessionId: row.parent_session_id ?? null,
    })),
  };
};
