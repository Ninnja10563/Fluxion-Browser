/* global globalThis */
(function exposeAIProviders(scope) {
  "use strict";

  const PROVIDERS = Object.freeze(["disabled", "ollama", "openai-compatible"]);
  const DEFAULTS = Object.freeze({
    disabled: { endpoint: "", model: "" },
    ollama: { endpoint: "http://127.0.0.1:11434", model: "llama3.2" },
    "openai-compatible": { endpoint: "http://127.0.0.1:1234/v1", model: "local-model" },
  });

  function providerId(value) {
    return PROVIDERS.includes(value) ? value : "disabled";
  }

  function isLoopback(hostname) {
    const host = String(hostname || "").toLocaleLowerCase().replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "::1" || host === "127.0.0.1" || host.startsWith("127.");
  }

  function endpoint(value, provider = "disabled") {
    const id = providerId(provider);
    if (id === "disabled") return "";
    const candidate = String(value || DEFAULTS[id].endpoint).trim().slice(0, 2048);
    let url;
    try { url = new URL(candidate); }
    catch (_) { throw new Error("Enter a valid provider endpoint."); }
    if (url.username || url.password || url.search || url.hash) {
      throw new Error("Provider endpoints cannot contain credentials, queries, or fragments.");
    }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
      throw new Error("Remote AI endpoints must use HTTPS; HTTP is allowed only on this device.");
    }
    return url.href.replace(/\/$/, "");
  }

  function model(value, provider = "disabled") {
    const id = providerId(provider);
    if (id === "disabled") return "";
    const candidate = String(value || DEFAULTS[id].model).trim().replace(/[\r\n]/g, "");
    if (!candidate) throw new Error("Choose a model name.");
    return candidate.slice(0, 200);
  }

  function normaliseConfig(value = {}) {
    const provider = providerId(value.provider);
    const resolvedEndpoint = endpoint(value.endpoint, provider);
    return Object.freeze({
      provider,
      endpoint: resolvedEndpoint,
      model: model(value.model, provider),
      remote: provider !== "disabled" && !isLoopback(new URL(resolvedEndpoint).hostname),
    });
  }

  function join(base, path) {
    return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  }

  class AIProvider {
    constructor(config, options = {}) {
      this.config = normaliseConfig(config);
      this.secret = String(options.secret || "");
      this.fetch = options.fetchImpl;
      if (typeof this.fetch !== "function" && this.config.provider !== "disabled") {
        throw new Error("A privileged fetch implementation is required.");
      }
    }
    async ask() { throw new Error("This AI provider is not implemented."); }
    async test() { throw new Error("This AI provider is not implemented."); }
  }

  class DisabledProvider extends AIProvider {
    async ask() { throw new Error("AI is disabled in Fluxion Settings."); }
    async test() { return { ok: true, detail: "AI is disabled." }; }
  }

  class OllamaProvider extends AIProvider {
    async ask({ system, question, context, signal }) {
      const response = await this.fetch(join(this.config.endpoint, "api/chat"), {
        method: "POST", signal, credentials: "omit", cache: "no-store", redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          stream: false,
          messages: [
            { role: "system", content: system },
            { role: "user", content: `${question}\n\n<page-context>\n${context}\n</page-context>` },
          ],
          options: { temperature: 0.1 },
        }),
      });
      if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
      const data = await response.json();
      const text = String(data?.message?.content || "").trim();
      if (!text) throw new Error("Ollama returned an empty answer.");
      return { text: text.slice(0, 12000), provider: "Ollama", model: this.config.model };
    }
    async test({ signal } = {}) {
      const response = await this.fetch(join(this.config.endpoint, "api/tags"), {
        signal, credentials: "omit", cache: "no-store", redirect: "error",
      });
      if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
      const data = await response.json();
      return { ok: true, detail: `${Array.isArray(data.models) ? data.models.length : 0} local models available.` };
    }
  }

  class OpenAICompatibleProvider extends AIProvider {
    headers() {
      const headers = { "Content-Type": "application/json" };
      if (this.secret) headers.Authorization = `Bearer ${this.secret}`;
      return headers;
    }
    async ask({ system, question, context, signal }) {
      const response = await this.fetch(join(this.config.endpoint, "chat/completions"), {
        method: "POST", signal, credentials: "omit", cache: "no-store", redirect: "error",
        headers: this.headers(),
        body: JSON.stringify({
          model: this.config.model, stream: false, temperature: 0.1, max_tokens: 700,
          messages: [
            { role: "system", content: system },
            { role: "user", content: `${question}\n\n<page-context>\n${context}\n</page-context>` },
          ],
        }),
      });
      if (!response.ok) throw new Error(`The AI endpoint returned HTTP ${response.status}.`);
      const data = await response.json();
      const text = String(data?.choices?.[0]?.message?.content || "").trim();
      if (!text) throw new Error("The AI endpoint returned an empty answer.");
      return { text: text.slice(0, 12000), provider: "OpenAI-compatible", model: this.config.model };
    }
    async test({ signal } = {}) {
      const response = await this.fetch(join(this.config.endpoint, "models"), {
        signal, credentials: "omit", cache: "no-store", redirect: "error", headers: this.headers(),
      });
      if (!response.ok) throw new Error(`The AI endpoint returned HTTP ${response.status}.`);
      const data = await response.json();
      return { ok: true, detail: `${Array.isArray(data.data) ? data.data.length : 0} models available.` };
    }
  }

  class EmbeddingProvider {
    async embed() { throw new Error("This embedding provider is not implemented."); }
  }
  class DisabledEmbeddingProvider extends EmbeddingProvider {
    async embed() { throw new Error("Embeddings are disabled."); }
  }
  class GeckoEmbeddingProvider extends EmbeddingProvider {
    constructor(embedder) { super(); this.embedder = embedder; }
    async embed(text) { return this.embedder.embed(text); }
  }

  function createAIProvider(config, options = {}) {
    const id = providerId(config?.provider);
    if (id === "ollama") return new OllamaProvider(config, options);
    if (id === "openai-compatible") return new OpenAICompatibleProvider(config, options);
    return new DisabledProvider({ provider: "disabled" }, options);
  }

  const api = Object.freeze({
    AIProvider, DEFAULTS, DisabledEmbeddingProvider, DisabledProvider,
    EmbeddingProvider, GeckoEmbeddingProvider, OllamaProvider,
    OpenAICompatibleProvider, PROVIDERS, createAIProvider, endpoint,
    isLoopback, model, normaliseConfig, providerId,
  });
  scope.FluxionAIProviders = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
