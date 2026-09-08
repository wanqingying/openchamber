import { runtimeFetch } from './runtime-fetch';
import { createMcApi, type McHttpResponse } from './mcApi';

const toHttpLike = async (response: Response): Promise<McHttpResponse> => ({
  ok: response.ok,
  status: response.status,
  text: () => response.text(),
});

export const mcApi = createMcApi((path, init) => runtimeFetch(path, init).then(toHttpLike));
