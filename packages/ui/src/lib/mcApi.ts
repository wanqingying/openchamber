import { z } from 'zod';

const BASE_PATH = '/api/openchamber/mc';

export type McGateReason =
  | 'missing-db'
  | 'schema-too-new'
  | 'sqlite-unavailable'
  | 'open-failed'
  | 'storage-dir-unavailable'
  | 'missing-opencode-db';

export interface McGated {
  gated: true;
  reason: McGateReason;
  schemaVersion?: number;
  maxSupportedSchema?: number;
  targetMcVersion?: string;
  detail?: string | null;
}

export interface McMeta {
  gated: false;
  schemaVersion: number;
  targetMcVersion: string;
  maxSupportedSchema: number;
}

export interface McMemoryItem {
  id: number;
  projectPath: string;
  category: string;
  status: string;
  importance: number | null;
  scope: string;
  sourceType: string | null;
  contentExcerpt: string | null;
  createdAt: number;
  updatedAt: number;
  lastRetrievedAt: number | null;
  expiresAt: number | null;
}

export interface McMemoriesPage {
  total: number;
  limit: number;
  offset: number;
  items: McMemoryItem[];
}

export interface McOverview {
  totalMemories: number;
  currentMemories: number;
  projects: number;
  categories: number;
}

export interface McSession {
  id: string;
  title: string;
  projectName: string;
  worktree: string;
  directory: string;
  lastActivity: number;
}

export interface McDreamRun {
  id: number;
  projectPath: string;
  startedAt: number | null;
  finishedAt: number | null;
  tasksSucceeded: number | null;
  tasksFailed: number | null;
  smartNotesSurfaced: number | null;
  smartNotesPending: number | null;
}

export interface McPrimer {
  id: number;
  projectPath: string;
  question: string;
  answer: string | null;
  status: string;
  totalSupport: number | null;
  lastObservedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface McUserMemory {
  id: number;
  content: string;
  status: string;
  promotedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface McWorkspace {
  id: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  shareCategories: string;
  memberCount: number;
}

export interface McProjectCategory {
  category: string;
  count: number;
}

export interface McProjectStat {
  projectPath: string;
  totalMemories: number;
  active: number;
  permanent: number;
  archived: number;
  lastUpdatedAt: number | null;
  categories: McProjectCategory[];
}

export interface McPage<T> {
  total: number;
  limit: number;
  offset: number;
  items: T[];
}

export interface McCacheSession {
  sessionId: string;
  harness: string | null;
  cachedM0Bytes: number | null;
  memoryBlockCount: number | null;
  compartmentCount: number;
}

export type McCacheSeverity = 'stable' | 'warning' | 'bust' | 'full-bust' | 'info' | 'unknown';

export interface McCacheEvent {
  messageId: string;
  time: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  severity: McCacheSeverity;
}

export interface McCacheTimeline {
  sessionId: string;
  scanned: number;
  events: McCacheEvent[];
  summary: Record<McCacheSeverity, number>;
}

export interface McPrimerCandidate {
  id: number;
  projectPath: string;
  question: string;
  sourceMessageTime: number | null;
}

export interface McUserMemoryCandidate {
  id: number;
  content: string;
}

export interface McMural {
  projectPath: string;
  renderedAt: number | null;
  width: number | null;
  height: number | null;
  model: string | null;
  contentHash: string | null;
}

export interface McFilePreview {
  exists: boolean;
  path: string;
  sizeBytes: number;
  content: string;
}

export interface McMemoriesOptions {
  projectPath?: string;
  category?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

/** The only HTTP surface this client needs from the runtime fetch layer. */
export interface McHttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export interface McFetcher {
  (path: string, init?: { cache?: RequestCache; signal?: AbortSignal }): Promise<McHttpResponse>;
}

const gateReasonSchema = z.enum([
  'missing-db',
  'schema-too-new',
  'sqlite-unavailable',
  'open-failed',
  'storage-dir-unavailable',
  'missing-opencode-db',
]);

const gatedSchema = z.object({
  available: z.literal(false),
  reason: gateReasonSchema,
  schemaVersion: z.number().finite().optional(),
  maxSupportedSchema: z.number().finite().optional(),
  targetMcVersion: z.string().optional(),
  detail: z.string().nullish(),
});

const metaOkSchema = z.object({
  available: z.literal(true),
  schemaVersion: z.number().finite(),
  targetMcVersion: z.string().min(1),
  maxSupportedSchema: z.number().finite(),
});

const memoryItemSchema = z.object({
  id: z.number().int().nonnegative(),
  projectPath: z.string().min(1),
  category: z.string().min(1),
  status: z.string().default('active'),
  importance: z.number().finite().nullish(),
  scope: z.string().default('project'),
  sourceType: z.string().nullish(),
  contentExcerpt: z.string().nullish(),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  lastRetrievedAt: z.number().finite().nullish(),
  expiresAt: z.number().finite().nullish(),
}).transform((raw) => ({
  id: raw.id,
  projectPath: raw.projectPath,
  category: raw.category,
  status: raw.status,
  importance: raw.importance ?? null,
  scope: raw.scope,
  sourceType: raw.sourceType ?? null,
  contentExcerpt: raw.contentExcerpt ?? null,
  createdAt: raw.createdAt,
  updatedAt: raw.updatedAt,
  lastRetrievedAt: raw.lastRetrievedAt ?? null,
  expiresAt: raw.expiresAt ?? null,
}));

const memoriesPageSchema = z.object({
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(500),
  offset: z.number().int().nonnegative(),
  items: z.array(memoryItemSchema),
});

const overviewSchema = z.object({
  totalMemories: z.number().int().nonnegative(),
  currentMemories: z.number().int().nonnegative(),
  projects: z.number().int().nonnegative(),
  categories: z.number().int().nonnegative(),
});

const pageSchema = <T extends z.ZodTypeAny>(itemSchema: T) => z.object({
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(500),
  offset: z.number().int().nonnegative(),
  items: z.array(itemSchema),
});

const nullableInt = () => z.number().int().nonnegative().nullish().transform((value) => value ?? null);

const sessionItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  projectName: z.string(),
  worktree: z.string().optional().default(''),
  directory: z.string().optional().default(''),
  lastActivity: z.number().finite(),
});

const dreamRunItemSchema = z.object({
  id: z.number().int(),
  projectPath: z.string(),
  startedAt: nullableInt(),
  finishedAt: nullableInt(),
  tasksSucceeded: nullableInt(),
  tasksFailed: nullableInt(),
  smartNotesSurfaced: nullableInt(),
  smartNotesPending: nullableInt(),
});

const primerItemSchema = z.object({
  id: z.number().int(),
  projectPath: z.string(),
  question: z.string(),
  answer: z.string().nullish().transform((value) => value ?? null),
  status: z.string(),
  totalSupport: nullableInt(),
  lastObservedAt: nullableInt(),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
});

const userMemoryItemSchema = z.object({
  id: z.number().int(),
  content: z.string(),
  status: z.string(),
  promotedAt: nullableInt(),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
});

const workspaceItemSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  shareCategories: z.string(),
  memberCount: z.number().int().nonnegative(),
});

const projectCategorySchema = z.object({
  category: z.string(),
  count: z.number().int().nonnegative(),
});

const projectItemSchema = z.object({
  projectPath: z.string(),
  totalMemories: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  permanent: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
  lastUpdatedAt: z.number().finite().nullish().transform((value) => value ?? null),
  categories: z.array(projectCategorySchema),
});

const cacheSessionItemSchema = z.object({
  sessionId: z.string(),
  harness: z.string().nullish().transform((value) => value ?? null),
  cachedM0Bytes: nullableInt(),
  memoryBlockCount: nullableInt(),
  compartmentCount: z.number().int().nonnegative(),
});

const cacheSeveritySchema = z.enum(['stable', 'warning', 'bust', 'full-bust', 'info', 'unknown']);

const cacheEventSchema = z.object({
  messageId: z.string(),
  time: z.number().finite(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheWrite: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  severity: cacheSeveritySchema,
});

const cacheTimelineSchema = z.object({
  sessionId: z.string(),
  scanned: z.number().int().nonnegative(),
  events: z.array(cacheEventSchema),
  summary: z.record(cacheSeveritySchema, z.number().int().nonnegative()),
});

const primerCandidateItemSchema = z.object({
  id: z.number().int(),
  projectPath: z.string(),
  question: z.string(),
  sourceMessageTime: nullableInt(),
});

const userMemoryCandidateItemSchema = z.object({
  id: z.number().int(),
  content: z.string(),
});

const muralItemSchema = z.object({
  projectPath: z.string(),
  renderedAt: nullableInt(),
  width: nullableInt(),
  height: nullableInt(),
  model: z.string().nullish().transform((value) => value ?? null),
  contentHash: z.string().nullish().transform((value) => value ?? null),
});

const filePreviewSchema = z.object({
  exists: z.boolean(),
  path: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  content: z.string(),
});

const errorPayloadSchema = z.object({
  error: z.string().optional(),
});

const metaResponseSchema = z.union([metaOkSchema, gatedSchema]);
const memoriesResponseSchema = z.union([memoriesPageSchema, gatedSchema]);
const overviewResponseSchema = z.union([overviewSchema, gatedSchema]);

const buildGated = (value: z.infer<typeof gatedSchema>): McGated => {
  const result: McGated = { gated: true, reason: value.reason };
  if (value.schemaVersion !== undefined) {
    result.schemaVersion = value.schemaVersion;
  }
  if (value.maxSupportedSchema !== undefined) {
    result.maxSupportedSchema = value.maxSupportedSchema;
  }
  if (value.targetMcVersion !== undefined) {
    result.targetMcVersion = value.targetMcVersion;
  }
  if (value.detail !== undefined) {
    result.detail = value.detail;
  }
  return result;
};

const parseBody = <S extends z.ZodTypeAny>(schema: S, text: string, message: string): z.infer<S> => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(message);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(message);
  }
  return parsed.data;
};

const readErrorText = async (response: McHttpResponse): Promise<string> => {
  try {
    const parsed = errorPayloadSchema.safeParse(JSON.parse(await response.text()));
    if (parsed.success && parsed.data.error) {
      return parsed.data.error;
    }
  } catch {
    // Fall through to the generic message.
  }
  return '';
};

export const createMcApi = (fetcher: McFetcher) => {
  const requestText = async (path: string, message: string): Promise<string> => {
    const response = await fetcher(path, { cache: 'no-store' });
    if (!response.ok) {
      const detail = await readErrorText(response);
      throw new Error(detail || `Magic Context request failed (${response.status})`);
    }
    return response.text();
  };

  const readList = async <T>(path: string, itemSchema: z.ZodType<T>, message: string): Promise<McPage<T> | McGated> => {
    const data = parseBody(z.union([pageSchema(itemSchema), gatedSchema]), await requestText(path, message), message);
    if ('total' in data) {
      return data;
    }
    return buildGated(data);
  };

  const listQuery = (options: McMemoriesOptions): string => {
    const query = new URLSearchParams();
    const entries: ReadonlyArray<readonly [string, string | number | undefined]> = [
      ['project', options.projectPath],
      ['category', options.category],
      ['status', options.status],
      ['limit', options.limit],
      ['offset', options.offset],
    ];
    for (const [key, value] of entries) {
      if (value !== undefined) {
        query.set(key, String(value));
      }
    }
    return query.size > 0 ? `?${query.toString()}` : '';
  };

  const fetchMeta = async (options: { signal?: AbortSignal } = {}): Promise<McMeta | McGated> => {
    const response = await fetcher(`${BASE_PATH}/meta`, { cache: 'no-store', signal: options.signal });
    if (!response.ok) {
      const detail = await readErrorText(response);
      throw new Error(detail || `Magic Context request failed (${response.status})`);
    }
    const data = parseBody(metaResponseSchema, await response.text(), 'Invalid Magic Context meta payload');
    if (data.available === false) {
      return buildGated(data);
    }
    return {
      gated: false,
      schemaVersion: data.schemaVersion,
      targetMcVersion: data.targetMcVersion,
      maxSupportedSchema: data.maxSupportedSchema,
    };
  };
  const fetchMemories = async (
    options: McMemoriesOptions = {},
    requestOptions: { signal?: AbortSignal } = {},
  ): Promise<McMemoriesPage | McGated> => {
    const query = new URLSearchParams();
    const entries: ReadonlyArray<readonly [string, string | number | undefined]> = [
      ['project', options.projectPath],
      ['category', options.category],
      ['status', options.status],
      ['search', options.search],
      ['limit', options.limit],
      ['offset', options.offset],
    ];
    for (const [key, value] of entries) {
      if (value !== undefined) {
        query.set(key, String(value));
      }
    }
    const queryString = query.size > 0 ? `?${query.toString()}` : '';
    const response = await fetcher(`${BASE_PATH}/memories${queryString}`, {
      cache: 'no-store',
      signal: requestOptions.signal,
    });
    if (!response.ok) {
      const detail = await readErrorText(response);
      throw new Error(detail || `Magic Context request failed (${response.status})`);
    }
    const data = parseBody(
      memoriesResponseSchema,
      await response.text(),
      'Invalid Magic Context memories payload',
    );
    if ('total' in data) {
      return data;
    }
    return buildGated(data);
  };

  const fetchOverview = async (
    options: { signal?: AbortSignal } = {},
  ): Promise<McOverview | McGated> => {
    const response = await fetcher(`${BASE_PATH}/overview`, { cache: 'no-store', signal: options.signal });
    if (!response.ok) {
      const detail = await readErrorText(response);
      throw new Error(detail || `Magic Context request failed (${response.status})`);
    }
    const data = parseBody(
      overviewResponseSchema,
      await response.text(),
      'Invalid Magic Context overview payload',
    );
    if ('totalMemories' in data) {
      return data;
    }
    return buildGated(data);
  };

  const fetchSessions = (options: { limit?: number; offset?: number } = {}) =>
    readList(`${BASE_PATH}/sessions${listQuery(options)}`, sessionItemSchema, 'Invalid Magic Context sessions payload');

  const fetchDreamRuns = (options: McMemoriesOptions = {}) =>
    readList(`${BASE_PATH}/dreamer/runs${listQuery(options)}`, dreamRunItemSchema, 'Invalid Magic Context dreamer payload');

  const fetchPrimers = (options: McMemoriesOptions = {}) =>
    readList(`${BASE_PATH}/primers${listQuery(options)}`, primerItemSchema, 'Invalid Magic Context primers payload');

  const fetchUserMemories = (options: McMemoriesOptions = {}) =>
    readList(`${BASE_PATH}/user-memories${listQuery(options)}`, userMemoryItemSchema, 'Invalid Magic Context user memories payload');

  const fetchWorkspaces = (options: { limit?: number; offset?: number } = {}) =>
    readList(`${BASE_PATH}/workspaces${listQuery(options)}`, workspaceItemSchema, 'Invalid Magic Context workspaces payload');

  const fetchProjects = (options: { limit?: number } = {}) =>
    readList(`${BASE_PATH}/projects${listQuery(options)}`, projectItemSchema, 'Invalid Magic Context projects payload');

  const fetchCacheSessions = (options: { limit?: number; offset?: number } = {}) =>
    readList(`${BASE_PATH}/cache/sessions${listQuery(options)}`, cacheSessionItemSchema, 'Invalid Magic Context cache payload');

  const fetchCacheTimeline = async (sessionId: string): Promise<McCacheTimeline | McGated> => {
    const data = parseBody(
      z.union([cacheTimelineSchema, gatedSchema]),
      await requestText(`${BASE_PATH}/sessions/${encodeURIComponent(sessionId)}/cache-events`, 'Invalid Magic Context cache timeline payload'),
      'Invalid Magic Context cache timeline payload',
    );
    if ('events' in data) {
      return data;
    }
    return buildGated(data);
  };

  const fetchPrimerCandidates = (options: { limit?: number; offset?: number } = {}) =>
    readList(`${BASE_PATH}/primer-candidates${listQuery(options)}`, primerCandidateItemSchema, 'Invalid Magic Context primer candidates payload');

  const fetchUserMemoryCandidates = (options: { limit?: number; offset?: number } = {}) =>
    readList(`${BASE_PATH}/user-memory-candidates${listQuery(options)}`, userMemoryCandidateItemSchema, 'Invalid Magic Context user memory candidates payload');

  const fetchMuralManifests = (options: { limit?: number; offset?: number } = {}) =>
    readList(`${BASE_PATH}/mural${listQuery(options)}`, muralItemSchema, 'Invalid Magic Context mural payload');

  const fetchConfig = async (): Promise<McFilePreview> => {
    const data = parseBody(filePreviewSchema, await requestText(`${BASE_PATH}/config`, 'Invalid Magic Context config payload'), 'Invalid Magic Context config payload');
    return data;
  };

  const fetchLogs = async (): Promise<McFilePreview> => {
    const data = parseBody(filePreviewSchema, await requestText(`${BASE_PATH}/logs`, 'Invalid Magic Context logs payload'), 'Invalid Magic Context logs payload');
    return data;
  };

  return {
    fetchMeta,
    fetchMemories,
    fetchOverview,
    fetchSessions,
    fetchDreamRuns,
    fetchPrimers,
    fetchUserMemories,
    fetchWorkspaces,
    fetchProjects,
    fetchCacheSessions,
    fetchCacheTimeline,
    fetchPrimerCandidates,
    fetchUserMemoryCandidates,
    fetchMuralManifests,
    fetchConfig,
    fetchLogs,
  };
};

export type McApi = ReturnType<typeof createMcApi>;
