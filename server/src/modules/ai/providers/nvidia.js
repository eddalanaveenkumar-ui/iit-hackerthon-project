import { AIProviderAdapter, ProviderError } from './base.js';

/**
 * NVIDIA NIM adapter — OpenAI-compatible REST surface.
 * API keys stay server-side only; nothing here is ever serialised to a client.
 */
export class NvidiaProvider extends AIProviderAdapter {
  constructor({ apiKey, baseUrl, timeoutMs = 60000 }) {
    super('nvidia');
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  async #request(path, { method = 'POST', body, timeoutMs, signal } = {}) {
    if (!this.apiKey) {
      throw new ProviderError('NVIDIA API key is not configured', { provider: 'nvidia', status: 401 });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || this.timeoutMs);
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const startedAt = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
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
          json?.error?.message || json?.detail || `NVIDIA request failed (${res.status})`,
          {
            provider: 'nvidia',
            status: res.status,
            retryable: res.status === 429 || res.status >= 500,
            body: json,
          },
        );
      }
      return { json, latencyMs: Date.now() - startedAt };
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
    const body = {
      model,
      messages,
      temperature,
      top_p: topP,
      max_tokens: maxTokens,
      stream: false,
    };
    if (jsonMode) body.response_format = { type: 'json_object' };
    const { json, latencyMs } = await this.#request('/chat/completions', { body, timeoutMs, signal });
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
    };
  }

  async embed({ model, input, timeoutMs }) {
    const { json, latencyMs } = await this.#request('/embeddings', {
      body: { model, input: Array.isArray(input) ? input : [input], input_type: 'query' },
      timeoutMs,
    });
    const vectors = (json?.data || []).map((d) => d.embedding || []);
    return {
      vectors,
      usage: { inputTokens: json?.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(input)), outputTokens: 0 },
      latencyMs,
      model,
    };
  }

  async rerank({ model, query, documents, timeoutMs }) {
    const { json, latencyMs } = await this.#request('/ranking', {
      body: { model, query: { text: query }, passages: documents.map((d) => ({ text: d })), truncate: 'END' },
      timeoutMs,
    });
    const rankings = json?.rankings || json?.data || [];
    const results = rankings.map((r, i) => ({ index: r.index ?? i, score: r.logit ?? r.score ?? r.relevance_score ?? 0 }));
    return {
      results: results.sort((a, b) => b.score - a.score),
      usage: { inputTokens: estimateTokens(query + documents.join(' ')), outputTokens: 0 },
      latencyMs,
      model,
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
