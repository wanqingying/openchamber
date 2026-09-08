// Read-only assistant-message cache analysis from the OpenCode database.
// Parses message.data.tokens on assistant messages (verified against a real
// opencode.db: tokens.{total,input,output,cache:{read,write}} at top level)
// and classifies retention like the dashboard: stable / warning / bust /
// full-bust / info(first) / unknown. Schema is OpenCode-owned; the classifier
// tolerates missing fields by falling back to info.

const SCAN_CAP = 1000;
const EVENT_CAP = 200;

const isObject = (value) => value !== null && value !== undefined && Object.prototype.toString.call(value) === '[object Object]';

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const parseMessage = (row) => {
  let data;
  try {
    data = JSON.parse(row.data);
  } catch {
    return null;
  }
  if (!isObject(data)) {
    return null;
  }
  const tokens = data.tokens;
  if (data.role !== 'assistant' || !isObject(tokens)) {
    return null;
  }
  const total = toNumber(tokens.total);
  if (total <= 0) {
    return null;
  }
  const cache = isObject(tokens.cache) ? tokens.cache : null;
  return {
    messageId: String(row.id),
    time: toNumber(row.time_created),
    inputTokens: toNumber(tokens.input),
    outputTokens: toNumber(tokens.output),
    cacheRead: cache ? toNumber(cache.read) : 0,
    cacheWrite: cache ? toNumber(cache.write) : 0,
    totalTokens: total,
  };
};

const classify = (event, previous) => {
  if (!previous) {
    return 'info';
  }
  if (event.cacheRead === 0) {
    return 'full-bust';
  }
  const expected = previous.cacheWrite > 0 ? previous.cacheWrite : previous.inputTokens + previous.outputTokens;
  if (expected <= 0) {
    return 'unknown';
  }
  const retention = event.cacheRead / expected;
  if (retention >= 0.95) {
    return 'stable';
  }
  if (retention >= 0.8) {
    return 'warning';
  }
  return 'bust';
};

export const sessionCacheEvents = (db, sessionId) => {
  const rows = db
    .prepare('SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created ASC LIMIT ?')
    .all(sessionId, SCAN_CAP);
  const events = [];
  for (const row of rows) {
    const event = parseMessage(row);
    if (event) {
      events.push(event);
    }
  }
  let previous = null;
  const classified = [];
  for (const event of events) {
    classified.push({
      ...event,
      severity: classify(event, previous),
    });
    previous = event;
  }
  const tail = classified.slice(-EVENT_CAP);
  const countSeverity = (severity) => tail.filter((event) => event.severity === severity).length;
  return {
    sessionId,
    scanned: rows.length,
    events: tail,
    summary: {
      stable: countSeverity('stable'),
      warning: countSeverity('warning'),
      bust: countSeverity('bust'),
      fullBust: countSeverity('full-bust'),
      info: countSeverity('info'),
      unknown: countSeverity('unknown'),
    },
  };
};
