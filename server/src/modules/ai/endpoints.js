/**
 * Per-model endpoint resolution.
 *
 * NVIDIA NIM is *not* a single endpoint. Each model family is served by its own
 * route, and the route differs by capability, not by vendor:
 *
 *   chat / completions  POST {base}/chat/completions     (OpenAI-compatible)
 *   embeddings          POST {base}/embeddings
 *   reranking           POST {base}/ranking              (NeMo Retriever shape —
 *                                                        NOT the OpenAI shape)
 *
 * Sending a rerank model to /chat/completions returns 404, and sending a chat
 * model to /ranking returns 404. So the endpoint path has to be derived from the
 * model's category, and an administrator must be able to override both the path
 * and the base URL per model (a model can be self-hosted on its own NIM
 * container with its own key and its own host).
 *
 * Resolution order for every field — most specific wins:
 *
 *   1. the model document in `ai_models` (admin panel, no restart needed)
 *   2. the global provider config (one key + base URL for everything)
 *   3. the compiled-in default in the catalogue
 */

/** Canonical endpoint path for each model category. */
export const DEFAULT_PATHS = {
  chat: '/chat/completions',
  reasoning: '/chat/completions',
  coding: '/chat/completions',
  safety: '/chat/completions',
  parse: '/chat/completions',
  embedding: '/embeddings',
  rerank: '/ranking',
};

/** Which adapter method a category needs. */
export const CATEGORY_CALL = {
  chat: 'chat',
  reasoning: 'chat',
  coding: 'chat',
  safety: 'chat',
  parse: 'chat',
  embedding: 'embed',
  rerank: 'rerank',
};

/** Categories whose upstream payload is not OpenAI-shaped. */
const NATIVE_PAYLOAD = { rerank: 'nemo-rerank' };

export function defaultPathFor(category) {
  return DEFAULT_PATHS[category] || '/chat/completions';
}

export function callMethodFor(category) {
  return CATEGORY_CALL[category] || 'chat';
}

/**
 * Overlay a model document onto the global runtime config.
 *
 * @param {object} runtime  result of getRuntimeConfig()
 * @param {object} model    ai_models document (may be sparse)
 * @returns {{baseUrl:string, path:string, apiKey:string, apiKeySource:string,
 *            timeoutMs:number, payloadStyle:string|null, method:string, category:string}}
 */
export function resolveEndpoint(runtime, model = {}) {
  const category = model.category || 'chat';
  const baseUrl = String(model.endpointBaseUrl || model.baseUrl || runtime.baseUrl || '')
    .trim()
    .replace(/\/+$/, '');

  const path = normalisePath(model.endpointPath || defaultPathFor(category));
  // A model's own key wins over the shared provider key. `credentialSource` on
  // the model document says which of the two it was, so callers can show either
  // "own key" or "global key" rather than guessing from the presence of a value.
  const modelKey = model.apiKeyCipher || model.apiKey || '';
  const apiKey = modelKey || runtime.apiKey || '';
  const apiKeySource = modelKey
    ? model.credentialSource === 'model-env'
      ? 'model-env'
      : 'model'
    : runtime.credentialSource || (apiKey ? 'environment' : 'none');

  return {
    category,
    // A model can opt out of the /v1 prefix when self-hosted behind a proxy.
    baseUrl: baseUrl || 'https://integrate.api.nvidia.com/v1',
    path,
    url: `${baseUrl}${path}`,
    apiKey,
    apiKeySource,
    timeoutMs: Number(model.params?.timeoutMs) || runtime.timeoutMs || 60000,
    payloadStyle: model.payloadStyle || NATIVE_PAYLOAD[category] || null,
    method: callMethodFor(category),
    // True when this model has its own credentials rather than the global key.
    hasOwnCredentials: Boolean(modelKey || model.endpointBaseUrl),
  };
}

/** Accept "ranking", "/ranking", "/v1/ranking" and normalise to "/ranking". */
export function normalisePath(raw) {
  let path = String(raw || '').trim();
  if (!path) return '/chat/completions';
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/^\/v1(?=\/)/i, '');
  return path.replace(/\/{2,}/g, '/');
}

/**
 * Validate an admin-supplied endpoint. Rejects anything that is not an absolute
 * http(s) URL so a typo cannot silently send prompts somewhere unintended.
 */
export function validateBaseUrl(raw) {
  if (!raw) return '';
  const value = String(raw).trim();
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Endpoint base URL must be a valid absolute URL (e.g. https://integrate.api.nvidia.com/v1)');
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error('Endpoint base URL must use http or https');
  }
  return value.replace(/\/+$/, '');
}
