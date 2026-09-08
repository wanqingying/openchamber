const MAX_LIMIT = 500;
const MAX_OFFSET = 100000;

const readSingleQueryValue = (value) => {
  if (value === undefined) {
    return undefined;
  }
  const raw = Array.isArray(value) ? value[0] : value;
  const text = raw === undefined || raw === null ? '' : String(raw).trim();
  return text === '' ? undefined : text;
};

const readNonNegativeInt = (value) => {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return { ok: false };
  }
  return { ok: true, value: parsed };
};

const parseLimitOffset = (req, maxLimit = MAX_LIMIT) => {
  const limit = readNonNegativeInt(readSingleQueryValue(req.query.limit));
  if (!limit.ok || (limit.value !== undefined && (limit.value < 1 || limit.value > maxLimit))) {
    return { ok: false, error: `limit must be an integer between 1 and ${maxLimit}` };
  }
  const offset = readNonNegativeInt(readSingleQueryValue(req.query.offset));
  if (!offset.ok || (offset.value !== undefined && offset.value > MAX_OFFSET)) {
    return { ok: false, error: `offset must be an integer between 0 and ${MAX_OFFSET}` };
  }
  return { ok: true, options: applyPagination({}, limit, offset) };
};

const applyPagination = (options, limit, offset) => {
  if (limit.value !== undefined) {
    options.limit = limit.value;
  }
  if (offset.value !== undefined) {
    options.offset = offset.value;
  }
  return options;
};

const respondResult = (res, result) => {
  if (!result.ok) {
    res.json(result.payload ?? result);
    return;
  }
  res.json(result.data);
};

const respondError = (res, error, fallback) => {
  res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
};

export const registerMcDashboardRoutes = (app, { runtime } = {}) => {
  if (!runtime) {
    return;
  }
  app.get('/api/openchamber/mc/meta', async (_req, res) => {
    try {
      res.json(await runtime.getMeta());
    } catch (error) {
      respondError(res, error);
    }
  });
  app.get('/api/openchamber/mc/memories', async (req, res) => {
    const parsed = parseLimitOffset(req);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    parsed.options.projectPath = readSingleQueryValue(req.query.project);
    parsed.options.category = readSingleQueryValue(req.query.category);
    parsed.options.status = readSingleQueryValue(req.query.status);
    parsed.options.search = readSingleQueryValue(req.query.search);
    try {
      respondResult(res, await runtime.listMemories(parsed.options));
    } catch (error) {
      respondError(res, error);
    }
  });
  app.get('/api/openchamber/mc/overview', async (_req, res) => {
    try {
      respondResult(res, await runtime.overview());
    } catch (error) {
      respondError(res, error);
    }
  });
  app.get('/api/openchamber/mc/workspaces', async (req, res) => {
    const parsed = parseLimitOffset(req);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    try {
      respondResult(res, await runtime.listWorkspaces(parsed.options));
    } catch (error) {
      respondError(res, error);
    }
  });
  app.get('/api/openchamber/mc/sessions', async (req, res) => {
    const parsed = parseLimitOffset(req, 200);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    try {
      respondResult(res, await runtime.listSessions(parsed.options));
    } catch (error) {
      respondError(res, error);
    }
  });
  app.get('/api/openchamber/mc/sessions/:id', async (req, res) => {
    const rawSessionId = req.params.id === undefined || req.params.id === null ? '' : String(req.params.id);
    const sessionId = rawSessionId.trim();
    if (!sessionId) {
      res.status(400).json({ error: 'session id is required' });
      return;
    }
    try {
      respondResult(res, await runtime.getSessionInsight(sessionId));
    } catch (error) {
      respondError(res, error);
    }
  });
  app.get('/api/openchamber/mc/dreamer/runs', async (req, res) => {
    const parsed = parseLimitOffset(req);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    parsed.options.projectPath = readSingleQueryValue(req.query.project);
    try {
      respondResult(res, await runtime.listDreamRuns(parsed.options));
    } catch (error) {
      respondError(res, error);
    }
  });
  app.get('/api/openchamber/mc/primers', async (req, res) => {
    const parsed = parseLimitOffset(req);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    parsed.options.projectPath = readSingleQueryValue(req.query.project);
    try {
      respondResult(res, await runtime.listPrimers(parsed.options));
    } catch (error) {
      respondError(res, error);
    }
  });
  app.get('/api/openchamber/mc/user-memories', async (req, res) => {
    const parsed = parseLimitOffset(req);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const status = readSingleQueryValue(req.query.status);
    if (status !== undefined && status !== 'active' && status !== 'dismissed') {
      res.status(400).json({ error: 'status must be active or dismissed' });
      return;
    }
    parsed.options.status = status ?? 'active';
    try {
      respondResult(res, await runtime.listUserMemories(parsed.options));
    } catch (error) {
      respondError(res, error);
    }
  });
  app.get('/api/openchamber/mc/config', async (_req, res) => {
    try {
      respondResult(res, await runtime.readConfig());
    } catch (error) {
      respondError(res, error);
    }
  });
  app.get('/api/openchamber/mc/logs', async (_req, res) => {
    try {
      respondResult(res, await runtime.readLogs());
    } catch (error) {
      respondError(res, error);
    }
  });
};
