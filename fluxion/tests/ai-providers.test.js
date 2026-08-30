"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DisabledEmbeddingProvider,
  GeckoEmbeddingProvider,
  createAIProvider,
  endpoint,
  normaliseConfig,
} = require("../chrome/core/ai-providers.js");

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

test("provider endpoints allow loopback HTTP and require HTTPS remotely", () => {
  assert.equal(endpoint("http://localhost:11434/", "ollama"), "http://localhost:11434");
  assert.equal(endpoint("https://models.example/v1/", "openai-compatible"), "https://models.example/v1");
  assert.throws(() => endpoint("http://models.example/v1", "openai-compatible"), /must use HTTPS/);
  assert.throws(() => endpoint("https://key:secret@models.example/v1", "openai-compatible"), /cannot contain credentials/);
  assert.throws(() => endpoint("file:///tmp/model", "ollama"), /must use HTTPS/);
});

test("disabled configuration contains no endpoint and needs no fetch", async () => {
  const config = normaliseConfig({ provider: "disabled", endpoint: "https://ignored.example", model: "ignored" });
  assert.deepEqual(config, { provider: "disabled", endpoint: "", model: "", remote: false });
  const provider = createAIProvider(config);
  assert.deepEqual(await provider.test(), { ok: true, detail: "AI is disabled." });
  await assert.rejects(provider.ask({}), /disabled/);
});

test("Ollama sends bounded chat schema to the configured local endpoint", async () => {
  let captured;
  const provider = createAIProvider({
    provider: "ollama", endpoint: "http://127.0.0.1:11434", model: "qwen-test",
  }, {
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return response({ message: { content: "Grounded answer" } });
    },
  });
  const answer = await provider.ask({ system: "System", question: "Question", context: "Context" });
  assert.equal(captured.url, "http://127.0.0.1:11434/api/chat");
  assert.equal(captured.options.credentials, "omit");
  assert.equal(captured.options.cache, "no-store");
  assert.equal(captured.options.redirect, "error");
  const body = JSON.parse(captured.options.body);
  assert.equal(body.stream, false);
  assert.equal(body.messages[0].role, "system");
  assert.match(body.messages[1].content, /<page-context>\nContext/);
  assert.deepEqual(answer, { text: "Grounded answer", provider: "Ollama", model: "qwen-test" });
});

test("OpenAI-compatible provider keeps API keys in request headers only", async () => {
  let captured;
  const provider = createAIProvider({
    provider: "openai-compatible", endpoint: "https://models.example/v1", model: "test-model",
  }, {
    secret: "test-secret",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return response({ choices: [{ message: { content: "Source answer" } }] });
    },
  });
  const answer = await provider.ask({ system: "System", question: "Question", context: "Context" });
  assert.equal(captured.url, "https://models.example/v1/chat/completions");
  assert.equal(captured.options.credentials, "omit");
  assert.equal(captured.options.headers.Authorization, "Bearer test-secret");
  assert.doesNotMatch(captured.options.body, /test-secret/);
  assert.equal(answer.text, "Source answer");
});

test("embedding providers remain independent from chat providers", async () => {
  await assert.rejects(new DisabledEmbeddingProvider().embed("text"), /disabled/);
  const provider = new GeckoEmbeddingProvider({ embed: async text => [`vector:${text}`] });
  assert.deepEqual(await provider.embed("page"), ["vector:page"]);
});
