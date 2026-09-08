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

const parseMemoriesQuery = (req) => {
  const limit = readNonNegativeInt(readSingleQueryValue(req.query.limit));
  if (!limit.ok || (limit.value !== undefined && limit.value < 1)) {
    return { ok: false, error: 'limit must be an integer between 1 and 500' };
  }
  const offset = readNonNegativeInt(readSingleQueryValue(req.query.offset));
  if (!offset.ok || (offset.value !== undefined && offset.value > MAX_OFFSET)) {
    return { ok: false, error: `offset must be an integer between 0 and ${MAX_OFFSET}` };
  }
  return {
    ok: true,
    options: applyPagination(
      {
        projectPath: readSingleQueryValue(req.query.project),
        category: readSingleQueryValue(req.query.category),
        status: readSingleQueryValue(req.query.status),
      },
      limit,
      offset,
    ),
  };
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

export const registerMcDashboardRoutes = (app, { runtime } = {}) => {
  if (!runtime) {
    return;
  }
  app.get('/api/openchamber/mc/meta', async (_req, res) => {
    try {
      res.json(await runtime.getMeta());
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  app.get('/api/openchamber/mc/memories', async (req, res) => {
    const parsed = parseMemoriesQuery(req);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    try {
      const result = await runtime.listMemories(parsed.options);
      if (!result.ok) {
        res.json(result.payload ?? result);
        return;
      }
      res.json(result.data);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  app.get('/api/openchamber/mc/overview', async (_req, res) => {
    try {
      const result = await runtime.overview();
      if (!result.ok) {
        res.json(result.payload ?? result);
        return;
      }
      res.json(result.data);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
};
