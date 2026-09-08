// Read-only queries authored from the pinned plugin source
// magic-context v0.41.4 (storage-db.ts primers DDL + dashboard db.rs). Update with MC_TARGET_VERSION.
export const listPrimers = (db, { projectPath, limit = 50, offset = 0 } = {}) => {
  const effectiveLimit = Math.min(Math.max(limit, 1), 200);
  const effectiveOffset = Math.max(offset, 0);
  const where = [];
  const bind = [];
  if (projectPath !== undefined) {
    where.push('project_path = ?');
    bind.push(projectPath);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM primers ${clause}`).get();
  const total = totalRow && Number.isFinite(Number(totalRow.total)) ? Number(totalRow.total) : 0;
  const rows = db
    .prepare(`
      SELECT id, project_path, question, answer, status, total_support, last_observed_at,
             created_at, updated_at
      FROM primers
      ${clause}
      ORDER BY status ASC, COALESCE(last_observed_at, created_at) DESC, id ASC
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
      question: row.question,
      answer: row.answer ?? null,
      status: row.status,
      totalSupport: toNumber(row.total_support),
      lastObservedAt: toNumber(row.last_observed_at),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
};

export const listPrimerCandidates = (db, { limit = 50, offset = 0 } = {}) => {
  const effectiveLimit = Math.min(Math.max(limit, 1), 200);
  const effectiveOffset = Math.max(offset, 0);
  const totalRow = db.prepare('SELECT COUNT(*) AS total FROM primer_candidates').get();
  const total = totalRow && Number.isFinite(Number(totalRow.total)) ? Number(totalRow.total) : 0;
  const rows = db
    .prepare(`
      SELECT id, project_path, harness, session_id, question, source_message_time, created_at
      FROM primer_candidates
      ORDER BY source_message_time DESC, id DESC
      LIMIT ? OFFSET ?
    `)
    .all(effectiveLimit, effectiveOffset);
  const toNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
  return {
    total,
    limit: effectiveLimit,
    offset: effectiveOffset,
    items: rows.map((row) => ({
      id: row.id,
      projectPath: row.project_path,
      harness: row.harness ?? null,
      sessionId: row.session_id ?? null,
      question: row.question,
      sourceMessageTime: toNumber(row.source_message_time),
      createdAt: toNumber(row.created_at),
    })),
  };
};

export const listUserMemoryCandidates = (db, { limit = 50, offset = 0 } = {}) => {
  const effectiveLimit = Math.min(Math.max(limit, 1), 200);
  const effectiveOffset = Math.max(offset, 0);
  const totalRow = db.prepare('SELECT COUNT(*) AS total FROM user_memory_candidates').get();
  const total = totalRow && Number.isFinite(Number(totalRow.total)) ? Number(totalRow.total) : 0;
  const rows = db
    .prepare(`
      SELECT id, content, session_id, created_at
      FROM user_memory_candidates
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `)
    .all(effectiveLimit, effectiveOffset);
  const toNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
  return {
    total,
    limit: effectiveLimit,
    offset: effectiveOffset,
    items: rows.map((row) => ({
      id: row.id,
      content: row.content,
      sessionId: row.session_id ?? null,
      createdAt: toNumber(row.created_at),
    })),
  };
};

export const listMuralManifests = (db, { projectPath, limit = 50, offset = 0 } = {}) => {
  const effectiveLimit = Math.min(Math.max(limit, 1), 200);
  const effectiveOffset = Math.max(offset, 0);
  const where = [];
  const bind = [];
  if (projectPath !== undefined) {
    where.push('project_path = ?');
    bind.push(projectPath);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM mural_manifest ${clause}`).get();
  const total = totalRow && Number.isFinite(Number(totalRow.total)) ? Number(totalRow.total) : 0;
  const rows = db
    .prepare(`
      SELECT project_path, rendered_at, width, height, content_hash, model
      FROM mural_manifest
      ${clause}
      ORDER BY rendered_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(...bind, effectiveLimit, effectiveOffset);
  const toNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
  return {
    total,
    limit: effectiveLimit,
    offset: effectiveOffset,
    items: rows.map((row) => ({
      projectPath: row.project_path,
      renderedAt: toNumber(row.rendered_at),
      width: toNumber(row.width),
      height: toNumber(row.height),
      contentHash: row.content_hash ?? null,
      model: row.model ?? null,
    })),
  };
};
export const listUserMemories = (db, { status = 'active', limit = 50, offset = 0 } = {}) => {
  const effectiveLimit = Math.min(Math.max(limit, 1), 200);
  const effectiveOffset = Math.max(offset, 0);
  const where = ['status = ?'];
  const bind = [status];
  const clause = `WHERE ${where.join(' AND ')}`;
  const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM user_memories ${clause}`).get(status);
  const total = totalRow && Number.isFinite(Number(totalRow.total)) ? Number(totalRow.total) : 0;
  const rows = db
    .prepare(`
      SELECT id, content, status, promoted_at, created_at, updated_at
      FROM user_memories
      ${clause}
      ORDER BY promoted_at ASC, id ASC
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
      content: row.content,
      status: row.status,
      promotedAt: toNumber(row.promoted_at),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
};
