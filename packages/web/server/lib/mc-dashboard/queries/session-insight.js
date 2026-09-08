// Read-only queries authored from the pinned plugin source
// magic-context v0.41.4 (storage-db.ts). Update together when MC_TARGET_VERSION advances.
const CAP = 200;

const mapNotes = (rows) => rows.map((row) => ({
  id: row.id,
  type: row.type,
  status: row.status,
  content: row.content,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  readyAt: row.ready_at ?? null,
}));

export const sessionInsight = (db, sessionId) => {
  const metaRow = db
    .prepare(`
      SELECT last_response_time, last_input_tokens, system_prompt_tokens,
             total_input_tokens, cached_m0_bytes, memory_block_count,
             memory_block_cache, conversation_tokens, tool_call_tokens,
             last_usage_context_limit, last_context_percentage, is_subagent,
             harness
      FROM session_meta WHERE session_id = ?
    `)
    .get(sessionId);
  const facts = db
    .prepare('SELECT id, category, content, created_at, updated_at FROM session_facts WHERE session_id = ? ORDER BY category, created_at DESC LIMIT ?')
    .all(sessionId, CAP);
  const notes = db
    .prepare("SELECT id, type, status, content, created_at, updated_at, ready_at FROM notes WHERE session_id = ? AND type = 'session' AND status = 'active' ORDER BY created_at DESC LIMIT ?")
    .all(sessionId, CAP);
  const smartNotes = db
    .prepare("SELECT id, type, status, content, created_at, updated_at, ready_at FROM notes WHERE session_id = ? AND type = 'smart' AND status != 'dismissed' ORDER BY created_at ASC LIMIT ?")
    .all(sessionId, CAP);
  const compartments = db
    .prepare('SELECT sequence, created_at FROM compartments WHERE session_id = ? ORDER BY sequence ASC LIMIT ?')
    .all(sessionId, CAP);

  const toNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
  return {
    sessionId,
    meta: metaRow
      ? {
          harness: metaRow.harness ?? null,
          isSubagent: toNumber(metaRow.is_subagent) === 1,
          lastResponseTime: toNumber(metaRow.last_response_time),
          lastInputTokens: toNumber(metaRow.last_input_tokens),
          systemPromptTokens: toNumber(metaRow.system_prompt_tokens),
          totalInputTokens: toNumber(metaRow.total_input_tokens),
          cachedM0Bytes: toNumber(metaRow.cached_m0_bytes),
          memoryBlockCount: toNumber(metaRow.memory_block_count),
          memoryBlockCache: toNumber(metaRow.memory_block_cache),
          conversationTokens: toNumber(metaRow.conversation_tokens),
          toolCallTokens: toNumber(metaRow.tool_call_tokens),
          lastUsageContextLimit: toNumber(metaRow.last_usage_context_limit),
          lastContextPercentage: toNumber(metaRow.last_context_percentage),
        }
      : null,
    factCount: facts.length,
    facts,
    noteCount: notes.length,
    notes: mapNotes(notes),
    smartNoteCount: smartNotes.length,
    smartNotes: mapNotes(smartNotes),
    compartmentCount: compartments.length,
    compartments: compartments.map((row) => ({
      sequence: row.sequence,
      createdAt: row.created_at,
    })),
  };
};
