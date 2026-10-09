"use strict";
// Unit tests for background.js (the service worker). Provider HTTP calls are
// exercised against a scripted `fetch`, so request shapes and fallbacks are
// checked without a network or API keys.

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadScripts } = require("./helpers/load");
const MODELS = require("./fixtures/models");

const EXPOSE = [
  "parsePhraseVariants", "wantsJsonOutput", "buildSystemInstruction", "emptyOutputError",
  "repairJson", "extractJsonSlice", "salvageJsonStrings", "stripCodeFences",
  "isMainGeminiModel", "isMainOpenAIModel", "compareGeminiModels", "parseGeminiVersion",
  "geminiThinkingConfig", "anthropicFeatures", "isOpenAIReasoningModel", "estimateCostUsd",
  "extractGeminiUsage", "extractOpenAIUsage", "extractAnthropicUsage", "extractAnthropicText",
  "mapProviderError", "isExtensionPageSender", "recordHistory", "recordUsage", "readSettings",
  "callAnthropic", "callOpenAI", "callGemini", "rewriteText", "runProviderRequest",
  "DEFAULT_SETTINGS"
];

function load() {
  const { context, exports } = loadScripts(["background.js"], { expose: EXPOSE });
  context.chrome.runtime.getURL = (p = "") => `chrome-extension://askbetter/${p}`;
  context.chrome.runtime.id = "askbetter";
  return { context, bg: exports };
}

const { context, bg } = load();

// Scripted fetch: each call shifts the next handler, which gets (url, init) and
// returns { status, body }. Every request body is recorded for assertions.
function scriptFetch(ctx, handlers) {
  const calls = [];
  ctx.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body, headers: init.headers });
    const handler = handlers.shift();
    if (!handler) throw new Error(`unexpected fetch ${url}`);
    const { status = 200, json } = await handler(url, body);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
      text: async () => JSON.stringify(json)
    };
  };
  return calls;
}

async function defaults(overrides = {}) {
  context.chrome.__store.settings = { ...overrides };
  return await bg.readSettings();
}

// ---------------------------------------------------------------------------
// Parsing model output

test("parsePhraseVariants: clean JSON variants", () => {
  const out = bg.parsePhraseVariants('{"variants":["One.","Two."]}', { count: 2, expectJson: true });
  assert.deepEqual(out, ["One.", "Two."]);
});

test("parsePhraseVariants: fenced, truncated and raw-newline JSON are repaired", () => {
  assert.deepEqual(
    bg.parsePhraseVariants('```json\n{"variants":["A","B"]}\n```', { count: 2, expectJson: true }),
    ["A", "B"]
  );
  const truncated = bg.parsePhraseVariants('{"variants":["First full rewrite.","Second cut o', { count: 2, expectJson: true });
  assert.equal(truncated[0], "First full rewrite.");
  const rawNewline = bg.parsePhraseVariants('{"variants":["Hi Sam,\nThanks."]}', { count: 1, preserveNewLines: true, expectJson: true });
  assert.equal(rawNewline[0], "Hi Sam,\nThanks.");
});

test("parsePhraseVariants: unparsable JSON scaffolding is never returned as a rewrite", () => {
  assert.deepEqual(bg.parsePhraseVariants('{"variants": [', { count: 2, expectJson: true }), []);
  assert.equal(bg.emptyOutputError('{"variants": [').code, "UNPARSABLE_MODEL_OUTPUT");
  assert.equal(bg.emptyOutputError("").code, "EMPTY_MODEL_OUTPUT");
});

test("parsePhraseVariants: plain text that starts with [ or { stays text when JSON wasn't requested", () => {
  const text = "[Note] The meeting moved to Friday.";
  assert.deepEqual(bg.parsePhraseVariants(text, { count: 1, expectJson: false }), [text]);
  const braces = '{"name": "x"} is the payload you send.';
  assert.deepEqual(bg.parsePhraseVariants(braces, { count: 1, expectJson: false }), [braces]);
});

test("parsePhraseVariants: a numbered list inside one rewrite is not split", () => {
  const text = "Plan the launch:\n1. Draft the post\n2. Review it\n3. Publish";
  const out = bg.parsePhraseVariants(text, { count: 1, preserveNewLines: true, expectJson: false });
  assert.equal(out.length, 1);
  assert.match(out[0], /3\. Publish/);
});

test("parsePhraseVariants: multi-variant plain-text fallback keeps paragraphs together", () => {
  const text = "First paragraph of the only rewrite.\n\nSecond paragraph of it.";
  const out = bg.parsePhraseVariants(text, { count: 2, preserveNewLines: true, expectJson: false });
  assert.equal(out.length, 1);
  assert.match(out[0], /Second paragraph/);
});

test("parsePhraseVariants: sequential numbered markers split variants when count > 1", () => {
  const out = bg.parsePhraseVariants("1. Alpha version.\n2. Beta version.", { count: 2, expectJson: false });
  assert.deepEqual(out, ["Alpha version.", "Beta version."]);
});

test("JSON helpers", () => {
  assert.equal(bg.stripCodeFences("```json\n{}\n```"), "{}");
  assert.equal(bg.extractJsonSlice('Sure! {"variants":["a"]} hope that helps'), '{"variants":["a"]}');
  assert.doesNotThrow(() => JSON.parse(bg.repairJson('{"variants":["a\nb", "c"')));
  assert.deepEqual(bg.salvageJsonStrings('{"variants":["one","two"'), ["one", "two"]);
});

// ---------------------------------------------------------------------------
// Prompt and transport must agree on JSON

test("wantsJsonOutput matches whether the system prompt asks for the variants JSON", async () => {
  for (const mode of ["ask_better", "phrase_better"]) {
    for (const variantCount of [1, 2, 3]) {
      for (const phraseBetterNewLines of [true, false]) {
        const settings = await defaults({ phraseBetterNewLines, phraseBetterOptionCount: variantCount });
        const wants = bg.wantsJsonOutput({ settings, mode, variantCount });
        const prompt = bg.buildSystemInstruction({ preset: "structured", settings, mode, variantCount });
        assert.equal(/"variants"/.test(prompt), wants, `mode=${mode} count=${variantCount} newLines=${phraseBetterNewLines}`);
      }
    }
  }
  assert.equal(bg.wantsJsonOutput({ settings: {}, mode: "ask_better", variantCount: 3, systemOverride: "x" }), false, "refine never asks for JSON");
});

// ---------------------------------------------------------------------------
// Model lists and per-model tuning

test("model filters keep only chat models", () => {
  for (const [id, chat] of MODELS.gemini) assert.equal(bg.isMainGeminiModel(id), chat, id);
  for (const [id, chat] of MODELS.openai) assert.equal(bg.isMainOpenAIModel(id), chat, id);
});

test("Gemini models sort newest version first, pro > flash > lite, stable before preview", () => {
  const ids = ["gemini-2.5-flash", "gemini-3.1-pro-preview", "gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-2.5-pro", "gemini-3.8-flash"];
  assert.deepEqual(ids.slice().sort(bg.compareGeminiModels), [
    "gemini-3.8-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-pro-preview", "gemini-2.5-pro", "gemini-2.5-flash"
  ]);
});

test("per-model request tuning", () => {
  assert.deepEqual({ ...bg.geminiThinkingConfig("gemini-3.5-flash") }, { thinkingLevel: "low" });
  assert.deepEqual({ ...bg.geminiThinkingConfig("gemini-2.5-pro") }, { thinkingBudget: 128 });
  assert.deepEqual({ ...bg.geminiThinkingConfig("gemini-2.5-flash-lite") }, { thinkingBudget: 0 });
  assert.equal(bg.geminiThinkingConfig("gemini-2.0-flash"), null);

  assert.equal(bg.isOpenAIReasoningModel("gpt-5.5"), true);
  assert.equal(bg.isOpenAIReasoningModel("gpt-6.1-sol"), true);
  assert.equal(bg.isOpenAIReasoningModel("o4-mini"), true);
  assert.equal(bg.isOpenAIReasoningModel("gpt-4o"), false);

  const f = (m) => ({ ...bg.anthropicFeatures(m) });
  assert.deepEqual(f("claude-opus-5-5"), { structuredOutput: true, effort: true });
  assert.deepEqual(f("claude-sonnet-4-6"), { structuredOutput: true, effort: true });
  assert.deepEqual(f("claude-haiku-4-5-20251001"), { structuredOutput: true, effort: false });
  assert.deepEqual(f("claude-sonnet-4-20250514"), { structuredOutput: false, effort: false });
  assert.deepEqual(f("claude-3-5-haiku-20241022"), { structuredOutput: false, effort: false });
});

test("estimateCostUsd picks the right price row", () => {
  const per = (provider, model) => bg.estimateCostUsd(provider, model, 1e6, 0);
  assert.equal(per("anthropic", "claude-opus-5-5"), 4);
  assert.equal(per("anthropic", "claude-opus-4-8"), 5);
  assert.equal(per("anthropic", "claude-opus-4-1"), 15);
  assert.equal(per("anthropic", "claude-sonnet-5-5"), 2);
  assert.equal(per("anthropic", "claude-sonnet-4-6"), 3);
  assert.equal(per("anthropic", "claude-haiku-4-5"), 1);
  assert.equal(per("anthropic", "claude-fable-5-1"), 10);
  assert.equal(bg.estimateCostUsd("gemini", "gemini-3.5-flash", 0, 0), null);
});

test("usage extraction counts Gemini thinking tokens as output", () => {
  assert.deepEqual({ ...bg.extractGeminiUsage({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 5 } }) }, { inputTokens: 10, outputTokens: 25 });
  assert.deepEqual({ ...bg.extractOpenAIUsage({ usage: { input_tokens: 3, output_tokens: 4 } }) }, { inputTokens: 3, outputTokens: 4 });
  assert.equal(bg.extractAnthropicUsage({}), null);
  assert.equal(bg.extractAnthropicText({ content: [{ type: "thinking", thinking: "" }, { type: "text", text: "hi" }] }), "hi");
});

test("mapProviderError", () => {
  const code = (e) => bg.mapProviderError(e).code;
  assert.equal(code({ status: 401 }), "UNAUTHORIZED");
  assert.equal(code({ status: 429 }), "RATE_LIMIT");
  assert.equal(code({ status: 503 }), "PROVIDER_DOWN");
  assert.equal(code({ status: 400, message: "bad" }), "BAD_REQUEST");
  assert.equal(code({ code: "TIMEOUT", message: "slow" }), "TIMEOUT");
  assert.equal(code(new Error("offline")), "NETWORK_ERROR");
});

// ---------------------------------------------------------------------------
// Messaging and storage

test("only extension pages may test keys or list models", () => {
  const ours = "chrome-extension://askbetter/ui/options.html";
  // Popup: no tab.
  assert.equal(bg.isExtensionPageSender({ id: "askbetter", url: ours }), true);
  // options_page opens in a regular tab, so its messages carry sender.tab.
  assert.equal(bg.isExtensionPageSender({ id: "askbetter", tab: { id: 7, url: ours }, url: ours }), true);
  // Content script: same extension id, but the URL is the host page.
  assert.equal(bg.isExtensionPageSender({ id: "askbetter", tab: { id: 1 }, url: "https://chatgpt.com/" }), false);
  assert.equal(bg.isExtensionPageSender({ id: "askbetter", url: "https://evil.example/" }), false);
  assert.equal(bg.isExtensionPageSender({ id: "other", url: ours }), false);
  assert.equal(bg.isExtensionPageSender(undefined), false);
});

test("concurrent history and usage writes are all kept", async () => {
  delete context.chrome.__store.promptHistory;
  delete context.chrome.__store.usageLog;
  await Promise.all(Array.from({ length: 10 }, (_v, i) => Promise.all([
    bg.recordHistory({ original: `o${i}`, optimized: `n${i}`, provider: "gemini", model: "m", mode: "ask_better" }),
    bg.recordUsage({ provider: "gemini", model: "m", mode: "ask_better", usage: { inputTokens: 1, outputTokens: 1 } })
  ])));
  assert.equal(context.chrome.__store.promptHistory.length, 10);
  assert.equal(context.chrome.__store.usageLog.length, 10);
});

test("a request that outlives its timeout fails with TIMEOUT", async () => {
  const never = (signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  await assert.rejects(bg.runProviderRequest(20, never), (error) => error.code === "TIMEOUT");
});

// ---------------------------------------------------------------------------
// Provider request shapes and fallbacks

const anthropicReply = (text, extra = {}) => ({
  json: { content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 7 }, ...extra }
});

test("Anthropic: no assistant prefill; JSON via output_config; low effort", async () => {
  const settings = await defaults();
  const calls = scriptFetch(context, [() => anthropicReply('{"variants":["a","b"]}')]);
  const result = await bg.callAnthropic({ apiKey: "k", model: "claude-opus-5-5", prompt: "hi", preset: "structured", settings, mode: "ask_better", variantCount: 2 });
  const body = calls[0].body;
  assert.equal(body.messages.at(-1).role, "user", "conversation must end on the user turn");
  assert.equal(body.output_config.format.type, "json_schema");
  assert.equal(body.output_config.effort, "low");
  assert.equal(body.thinking, undefined);
  assert.equal(result.text, '{"variants":["a","b"]}');
});

test("Anthropic: retries once without output_config when a model rejects it", async () => {
  const settings = await defaults();
  const calls = scriptFetch(context, [
    () => ({ status: 400, json: { error: { message: "output_config: Extra inputs are not permitted" } } }),
    () => anthropicReply("plain")
  ]);
  const result = await bg.callAnthropic({ apiKey: "k", model: "claude-opus-5-5", prompt: "hi", preset: "structured", settings, mode: "ask_better", variantCount: 2 });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.output_config, undefined);
  assert.equal(result.text, "plain");
});

test("Anthropic: refusal is reported, not returned as text", async () => {
  const settings = await defaults();
  scriptFetch(context, [() => anthropicReply("", { stop_reason: "refusal" })]);
  await assert.rejects(
    bg.callAnthropic({ apiKey: "k", model: "claude-opus-5-5", prompt: "hi", preset: "structured", settings, mode: "ask_better" }),
    (error) => error.code === "MODEL_REFUSED"
  );
});

test("OpenAI: reasoning effort for reasoning models; drops a rejected json_schema format", async () => {
  const settings = await defaults();
  const calls = scriptFetch(context, [
    () => ({ status: 400, json: { error: { message: "Invalid parameter: 'text.format' of type 'json_schema' is not supported with this model." } } }),
    () => ({ json: { output_text: "ok", status: "completed", usage: { input_tokens: 1, output_tokens: 1 } } })
  ]);
  await bg.callOpenAI({ apiKey: "k", model: "gpt-5.5", prompt: "hi", preset: "structured", settings, mode: "ask_better", variantCount: 2 });
  assert.deepEqual({ ...calls[0].body.reasoning }, { effort: "low" });
  assert.equal(calls[0].body.store, false);
  assert.ok(calls[0].body.text, "first attempt asks for structured output");
  assert.equal(calls[1].body.text, undefined, "retry drops the rejected format");
});

test("Gemini: Gemini 3 omits temperature and uses thinkingLevel", async () => {
  const settings = await defaults();
  const calls = scriptFetch(context, [() => ({ json: { candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] } })]);
  await bg.callGemini({ apiKey: "k", model: "gemini-3.5-flash", prompt: "hi", preset: "structured", settings, mode: "ask_better" });
  const config = calls[0].body.generationConfig;
  assert.equal(config.temperature, undefined);
  assert.deepEqual({ ...config.thinkingConfig }, { thinkingLevel: "low" });
});

test("rewriteText: a truncated reply is retried, and a failed retry keeps the first text", async () => {
  const settings = await defaults({ provider: "anthropic", anthropicApiKey: "k", anthropicKeyVerified: true, anthropicModel: "claude-sonnet-5-5", enableAI: true });
  delete context.chrome.__store.usageLog;
  scriptFetch(context, [
    () => anthropicReply("A long rewrite that was cut", { stop_reason: "max_tokens" }),
    () => ({ status: 503, json: { error: { message: "overloaded" } } })
  ]);
  const result = await bg.rewriteText({ prompt: "write a thing", preset: "structured", site: "chatgpt", settings, variantCount: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.optimizedPrompt, "A long rewrite that was cut");
  assert.equal(context.chrome.__store.usageLog.length, 1, "the billed first call is still logged");
});

test("rewriteText: an untruncated reply ending in ':' is not retried", async () => {
  const settings = await defaults({ provider: "anthropic", anthropicApiKey: "k", anthropicKeyVerified: true, enableAI: true });
  const calls = scriptFetch(context, [() => anthropicReply("Use this format:")]);
  const result = await bg.rewriteText({ prompt: "x", preset: "structured", site: "chatgpt", settings, variantCount: 1 });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
});
