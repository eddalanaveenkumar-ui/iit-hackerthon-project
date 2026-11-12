/**
 * Provider adapter interface.
 *
 * Every AI provider implements:
 *   chat({ model, messages, temperature, topP, maxTokens, jsonMode, timeoutMs, signal }) -> { text, raw, usage }
 *   embed({ model, input }) -> { vectors, usage }
 *   rerank({ model, query, documents }) -> { results: [{ index, score }], usage }
 *   listModels() -> [modelId]
 *   healthCheck() -> { ok, latencyMs, detail }
 *
 * Business logic never imports a concrete provider; it always goes through the
 * orchestration service in modules/ai/orchestrator.js.
 */
export class AIProviderAdapter {
  constructor(name) {
    this.name = name;
  }

  async chat() {
    throw new Error(`${this.name}: chat() not implemented`);
  }

  async embed() {
    throw new Error(`${this.name}: embed() not implemented`);
  }

  async rerank() {
    throw new Error(`${this.name}: rerank() not implemented`);
  }

  async listModels() {
    return [];
  }

  async healthCheck() {
    return { ok: false, latencyMs: 0, detail: 'not implemented' };
  }
}

export class ProviderError extends Error {
  constructor(message, { status = 0, retryable = false, provider = 'unknown', body = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.retryable = retryable;
    this.provider = provider;
    this.body = body;
  }
}
