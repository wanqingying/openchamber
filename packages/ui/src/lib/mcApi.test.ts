import { afterEach, describe, expect, test } from 'bun:test';

import { createMcApi, type McFetcher, type McHttpResponse } from './mcApi';

const textResponse = (status: number, body: string): McHttpResponse => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});

const malformedTextResponse: McHttpResponse = {
  ok: true,
  status: 200,
  text: async () => '{not json',
};

describe('mcApi', () => {
  let calls: string[] = [];
  let responses: Array<Promise<McHttpResponse>> = [];

  const createStub = (): McFetcher => {
    calls = [];
    responses = [];
    return (path: string) => {
      calls.push(path);
      const next = responses.shift();
      if (!next) {
        throw new Error('no stub response configured');
      }
      return next;
    };
  };

  const stubResponses = (queue: Array<Promise<McHttpResponse>>) => {
    responses = queue;
  };

  afterEach(() => {
    calls = [];
    responses = [];
  });

  test('parses an available meta payload', async () => {
    const api = createMcApi(createStub());
    stubResponses([Promise.resolve(textResponse(200, JSON.stringify({
      available: true,
      schemaVersion: 50,
      targetMcVersion: '0.41.4',
      maxSupportedSchema: 84,
    })))]);
    const result = await api.fetchMeta();
    expect(result).toEqual({
      gated: false,
      schemaVersion: 50,
      targetMcVersion: '0.41.4',
      maxSupportedSchema: 84,
    });
    expect(calls).toEqual(['/api/openchamber/mc/meta']);
  });

  test('parses gating payloads as valid states', async () => {
    const api = createMcApi(createStub());
    stubResponses([Promise.resolve(textResponse(200, JSON.stringify({
      available: false,
      reason: 'missing-db',
    })))]);
    const result = await api.fetchMeta();
    expect(result.gated).toBe(true);
    if (result.gated) {
      expect(result.reason).toBe('missing-db');
    }
  });

  test('carries the schema version of a schema-too-new gating state', async () => {
    const api = createMcApi(createStub());
    stubResponses([Promise.resolve(textResponse(200, JSON.stringify({
      available: false,
      reason: 'schema-too-new',
      schemaVersion: 85,
    })))]);
    const result = await api.fetchMeta();
    if (result.gated) {
      expect(result.reason).toBe('schema-too-new');
      expect(result.schemaVersion).toBe(85);
    }
  });

  test('throws on http errors, malformed payloads and network failures', async () => {
    const api = createMcApi(createStub());
    stubResponses([Promise.resolve(textResponse(500, JSON.stringify({ error: 'boom' })))]);
    await expect(api.fetchMeta()).rejects.toThrow('boom');

    stubResponses([Promise.resolve(textResponse(200, JSON.stringify({ available: true })))]);
    await expect(api.fetchMeta()).rejects.toThrow('Invalid');

    stubResponses([Promise.reject(new Error('network down'))]);
    await expect(api.fetchMeta()).rejects.toThrow('network down');
  });

  test('parses an available memories page and rejects malformed pages', async () => {
    const api = createMcApi(createStub());
    stubResponses([Promise.resolve(textResponse(200, JSON.stringify({
      total: 2,
      limit: 50,
      offset: 0,
      items: [
        { id: 1, projectPath: '/p', category: 'work', contentExcerpt: 'hi', createdAt: 3, updatedAt: 3 },
        { id: 2, projectPath: '/q', category: 'life', contentExcerpt: 'yo', createdAt: 2, updatedAt: 2 },
      ],
    })))]);
    const result = await api.fetchMemories({});
    expect('gated' in result).toBe(false);
    if (!('gated' in result)) {
      expect(result.total).toBe(2);
      expect(result.items.map((item) => item.contentExcerpt)).toEqual(['hi', 'yo']);
    }

    stubResponses([Promise.resolve(textResponse(200, JSON.stringify({ total: 1 })))]);
    await expect(api.fetchMemories({})).rejects.toThrow('Invalid');
  });

  test('returns the gating payload for memories when the db is gated', async () => {
    const api = createMcApi(createStub());
    stubResponses([Promise.resolve(textResponse(200, JSON.stringify({
      available: false,
      reason: 'schema-too-new',
    })))]);
    const result = await api.fetchMemories({});
    expect('gated' in result).toBe(true);
    if ('gated' in result) {
      expect(result.gated).toBe(true);
      expect(result.reason).toBe('schema-too-new');
    }
  });

  test('builds the query string from options', async () => {
    const api = createMcApi(createStub());
    stubResponses([Promise.resolve(textResponse(200, JSON.stringify({ total: 0, limit: 50, offset: 0, items: [] })))]);
    await api.fetchMemories({ projectPath: '/p', category: 'work', limit: 25 });
    expect(calls).toEqual(['/api/openchamber/mc/memories?project=%2Fp&category=work&limit=25']);
  });

  test('treats an unparseable body as a fetch-level failure', async () => {
    const api = createMcApi(createStub());
    stubResponses([Promise.resolve(malformedTextResponse)]);
    await expect(api.fetchMeta()).rejects.toThrow('Invalid');
  });
});
