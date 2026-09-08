import { z } from 'zod';

const BASE_PATH = '/api/openchamber/mc';

export type McGateReason =
  | 'missing-db'
  | 'schema-too-new'
  | 'sqlite-unavailable'
  | 'open-failed'
  | 'storage-dir-unavailable';

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

export interface McMemoriesOptions {
  projectPath?: string;
  category?: string;
  status?: string;
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
]);

const gatedSchema = z.object({
  available: z.literal(false),
  reason: gateReasonSchema,
  schemaVersion: z.number().finite().optional(),
  maxSupportedSchema: z.number().finite().optional(),
  targetMcVersion: z.string().optional(),
  detail: z.string().optional(),
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

const errorPayloadSchema = z.object({
  error: z.string().optional(),
});

const metaResponseSchema = z.union([metaOkSchema, gatedSchema]);
const memoriesResponseSchema = z.union([memoriesPageSchema, gatedSchema]);

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

  return { fetchMeta, fetchMemories };
};

export type McApi = ReturnType<typeof createMcApi>;
