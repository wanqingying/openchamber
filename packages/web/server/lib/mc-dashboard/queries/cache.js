// Read-only queries authored from the pinned plugin source
// magic-context v0.41.4 (storage-db.ts session_meta DDL). Update with MC_TARGET_VERSION.
export const cacheSessionSummary = (db, { limit = 20, offset = 0 } = {}) => {
  const effectiveLimit = Math.min(Math.max(limit, 1), 200);
  const effectiveOffset = Math.max(offset, 0);
  const totalRow = db.prepare('SELECT COUNT(*) AS total FROM session_meta').get();
  const total = totalRow && Number.isFinite(Number(totalRow.total)) ? Number(totalRow.total) : 0;
  const rows = db
    .prepare(`
      SELECT sm.session_id, sm.harness, sm.last_response_time, sm.cache_ttl,
             sm.cached_m0_bytes, sm.memory_block_cache, sm.memory_block_count,
             sm.conversation_tokens, sm.total_input_tokens, sm.system_prompt_tokens,
             (SELECT COUNT(*) FROM compartments c WHERE c.session_id = sm.session_id) AS compartment_count
      FROM session_meta sm
      WHERE sm.last_input_tokens IS NOT NULL OR sm.cached_m0_bytes IS NOT NULL
      ORDER BY COALESCE(sm.last_response_time, 0) DESC
      LIMIT ? OFFSET ?
    `)
    .all(effectiveLimit, effectiveOffset);
  const toNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
  return {
    total,
    limit: effectiveLimit,
    offset: effectiveOffset,
    items: rows.map((row) => ({
      sessionId: row.session_id,
      harness: row.harness ?? null,
      lastResponseTime: toNumber(row.last_response_time),
      cacheTtl: toNumber(row.cache_ttl),
      cachedM0Bytes: toNumber(row.cached_m0_bytes),
      memoryBlockCache: toNumber(row.memory_block_cache),
      memoryBlockCount: toNumber(row.memory_block_count),
      conversationTokens: toNumber(row.conversation_tokens),
      totalInputTokens: toNumber(row.total_input_tokens),
      systemPromptTokens: toNumber(row.system_prompt_tokens),
      compartmentCount: toNumber(row.compartment_count) ?? 0,
    })),
  };
};
