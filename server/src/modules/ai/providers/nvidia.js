import { AIProviderAdapter, ProviderError } from './base.js';
import { resolveEndpoint } from '../endpoints.js';

/**
 * NVIDIA NIM adapter.
 *
 * NIM exposes several distinct REST surfaces rather than one, so this adapter
 * resolves an endpoint per call from the model document (see ../endpoints.js):
 *
 *   chat models    -> POST {base}/chat/completions
 *   embeddings     -> POST {base}/embeddings
 *   rerank models  -> POST {base}/ranking        (NeMo Retriever payload)
 *
 * API keys stay server-side only; nothing here is ever serialised to a client.
 */
export class NvidiaProvider extends AIProviderAdapter {
  /**
   * @param {object} options
   * @param {string} options.apiKey        global key (fallback for every model)
   * @param {string} options.baseUrl       global base URL
   * @param {number} [options.timeoutMs]
   * @param {object} [options.models]      map of modelId -> ai_models document.
   *                                       Lets each model carry its own key,
   *                                       host and path.
   * @param {object} [options.runtime]     full runtime config, used as the
   *                                       fallback layer during resolution.
   */
  constructor({ apiKey, baseUrl, timeoutMs = 60000, models = {}, runtime = null }) {
    super('nvidia');
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.runtime = runtime || { apiKey, baseUrl: this.baseUrl, timeoutMs, credentialSource: apiKey ? 'environment' : 'none' };
    this.models = models || {};
  }

  /** Public view of a model's endpoint, used by the admin panel. */
  describe(modelId) {
    const model = this.models[modelId] || {};
    const ep = resolveEndpoint(this.runtime, { ...model, modelId });
    return {
      modelId,
      category: ep.category,
      url: ep.url,
      path: ep.path,
      baseUrl: ep.baseUrl,
      method: ep.method,
      apiKeySource: ep.apiKeySource,
      hasOwnCredentials: ep.hasOwnCredentials,
    };
  }

  async #request(pathOrUrl, { method = 'POST', body, timeoutMs, signal, apiKey, baseUrl } = {}) {
    const key = apiKey || this.apiKey;
    if (!key) {
      throw new ProviderError('NVIDIA API key is not configured', { provider: 'nvidia', status: 401 });
    }
    // Accept either a full URL (per-model host) or a bare path.
    const url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${baseUrl || this.baseUrl}${pathOrUrl}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || this.timeoutMs);
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const startedAt = Date.now();
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text };
      }
      if (!res.ok) {
        throw new ProviderError(
          json?.error?.message || json?.detail || `NVIDIA request failed (${res.status}) on ${new URL(url, 'https://x').pathname}`,
          {
            provider: 'nvidia',
            status: res.status,
            retryable: res.status === 429 || res.status >= 500,
            body: json,
          },
        );
      }
      return { json, latencyMs: Date.now() - startedAt, url };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (err.name === 'AbortError') {
        throw new ProviderError('NVIDIA request timed out', { provider: 'nvidia', status: 408, retryable: true });
      }
      throw new ProviderError(`NVIDIA network error: ${err.message}`, { provider: 'nvidia', retryable: true });
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener?.('abort', onAbort);
    }
  }

  async chat({ model, messages, temperature = 0.4, topP = 0.95, maxTokens = 1200, jsonMode = false, timeoutMs, signal }) {
    const ep = resolveEndpoint(this.runtime, { ...(this.models[model] || {}), modelId: model });
    const body = {
      model,
      messages,
      temperature,
      top_p: topP,
      max_tokens: maxTokens,
      stream: false,
    };
    if (jsonMode) body.response_format = { type: 'json_object' };
    const { json, latencyMs, url } = await this.#request(ep.path, {
      body,
      timeoutMs: timeoutMs || ep.timeoutMs,
      signal,
      apiKey: ep.apiKey,
      baseUrl: ep.baseUrl,
    });
    const choice = json?.choices?.[0];
    const text = choice?.message?.content ?? '';
    return {
      text,
      finishReason: choice?.finish_reason || 'stop',
      usage: {
        inputTokens: json?.usage?.prompt_tokens ?? estimateTokens(messages.map((m) => m.content).join(' ')),
        outputTokens: json?.usage?.completion_tokens ?? estimateTokens(text),
      },
      latencyMs,
      model: json?.model || model,
      provider: 'nvidia',
      endpoint: url,
    };
  }

  async embed({ model, input, timeoutMs }) {
    const ep = resolveEndpoint(this.runtime, { ...(this.models[model] || {}), modelId: model, category: this.models[model]?.category || 'embedding' });
    const { json, latencyMs, url } = await this.#request(ep.path, {
      body: { model, input: Array.isArray(input) ? input : [input], input_type: 'query' },
      timeoutMs: timeoutMs || ep.timeoutMs,
      apiKey: ep.apiKey,
      baseUrl: ep.baseUrl,
    });
    const vectors = (json?.data || []).map((d) => d.embedding || []);
    return {
      vectors,
      usage: { inputTokens: json?.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(input)), outputTokens: 0 },
      latencyMs,
      model,
      endpoint: url,
    };
  }

  async rerank({ model, query, documents, timeoutMs }) {
    const ep = resolveEndpoint(this.runtime, { ...(this.models[model] || {}), modelId: model, category: this.models[model]?.category || 'rerank' });
    const { json, latencyMs, url } = await this.#request(ep.path, {
      body: { model, query: { text: query }, passages: documents.map((d) => ({ text: d })), truncate: 'END' },
      timeoutMs: timeoutMs || ep.timeoutMs,
      apiKey: ep.apiKey,
      baseUrl: ep.baseUrl,
    });
    const rankings = json?.rankings || json?.data || [];
    const results = rankings.map((r, i) => ({ index: r.index ?? i, score: r.logit ?? r.score ?? r.relevance_score ?? 0 }));
    return {
      results: results.sort((a, b) => b.score - a.score),
      usage: { inputTokens: estimateTokens(query + documents.join(' ')), outputTokens: 0 },
      latencyMs,
      model,
      endpoint: url,
    };
  }

  async listModels() {
    const { json } = await this.#request('/models', { method: 'GET' });
    return (json?.data || []).map((m) => m.id);
  }

  async healthCheck() {
    const started = Date.now();
    try {
      if (!this.apiKey) return { ok: false, latencyMs: 0, detail: 'No API key configured' };
      const models = await this.listModels();
      return { ok: true, latencyMs: Date.now() - started, detail: `${models.length} models visible` };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, detail: err.message };
    }
  }
}

export function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(String(text).length / 4));
}
