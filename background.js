const DEFAULT_SETTINGS = {
  provider: "gemini",
  geminiApiKey: "",
  geminiModel: "gemini-3.5-flash",
  geminiKeyVerified: false,
  openaiApiKey: "",
  openaiModel: "gpt-5.5",
  openaiKeyVerified: false,
  anthropicApiKey: "",
  anthropicModel: "claude-sonnet-5-5",
  anthropicKeyVerified: false,
  defaultPreset: "structured",
  askBetterOptionCount: 1,
  enableChatGPT: true,
  enableGemini: true,
  enableClaude: true,
  enableAskBetterMode: true,
  enablePhraseBetterMode: true,
  phraseBetterOptionCount: 2,
  phraseBetterPreset: "fix_grammar",
  phraseBetterKeepVoice: false,
  phraseBetterPolish: false,
  phraseBetterWit: false,
  phraseBetterHumanize: false,
  phraseBetterNewLines: true,
  enableAI: true,
  keepUserVoice: false,
  keyVerified: false,
  customPromptAdditions: "",
  customPresets: []
};

const PHRASE_BETTER_CONTEXT_MENU_ID = "askbetter-phrase-better";
let phraseBetterMenuSyncToken = 0;

// Local-only usage log for the Reports section: one entry per successful
// request, kept for 30 days. Never leaves the browser.
const USAGE_LOG_KEY = "usageLog";
const USAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const USAGE_LOG_MAX = 5000;

// Local-only prompt history (original → optimized pairs) for the History section.
// Never leaves the browser; capped to the most recent HISTORY_MAX entries.
const HISTORY_KEY = "promptHistory";
const HISTORY_MAX = 100;
const HISTORY_TEXT_MAX = 4000;

// chrome.storage has no transactions, so two get→modify→set sequences that
// overlap (two tabs finishing at once) lose one write. Every read-modify-write
// of a shared key goes through this queue so they run one after another.
let storageQueue = Promise.resolve();

function enqueueStorageWrite(fn) {
  const run = storageQueue.then(fn, fn);
  storageQueue = run.catch(() => {});
  return run;
}

function recordUsage(entry) {
  return enqueueStorageWrite(() => recordUsageNow(entry));
}

async function recordUsageNow(entry) {
  try {
    const now = Date.now();
    const stored = await chrome.storage.local.get([USAGE_LOG_KEY]);
    const log = Array.isArray(stored[USAGE_LOG_KEY]) ? stored[USAGE_LOG_KEY] : [];
    const usage = entry && entry.usage ? entry.usage : null;
    log.push({
      ts: now,
      provider: String((entry && entry.provider) || ""),
      model: String((entry && entry.model) || ""),
      mode: entry && entry.mode === "phrase_better" ? "phrase_better" : "ask_better",
      inputTokens: usage ? Number(usage.inputTokens) || 0 : 0,
      outputTokens: usage ? Number(usage.outputTokens) || 0 : 0,
      costUsd: entry && typeof entry.costUsd === "number" ? entry.costUsd : null
    });
    const cutoff = now - USAGE_RETENTION_MS;
    let pruned = log.filter((e) => e && typeof e.ts === "number" && e.ts >= cutoff);
    if (pruned.length > USAGE_LOG_MAX) {
      pruned = pruned.slice(pruned.length - USAGE_LOG_MAX);
    }
    await chrome.storage.local.set({ [USAGE_LOG_KEY]: pruned });
  } catch (_e) {
    // Usage logging is best-effort and must never affect the user request.
  }
}

function recordHistory(entry) {
  return enqueueStorageWrite(() => recordHistoryNow(entry));
}

async function recordHistoryNow(entry) {
  try {
    const now = Date.now();
    const original = String((entry && entry.original) || "").slice(0, HISTORY_TEXT_MAX);
    const optimized = String((entry && entry.optimized) || "").slice(0, HISTORY_TEXT_MAX);
    if (!original || !optimized) {
      return;
    }
    const stored = await chrome.storage.local.get([HISTORY_KEY]);
    const log = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
    log.push({
      ts: now,
      original,
      optimized,
      preset: String((entry && entry.preset) || ""),
      provider: String((entry && entry.provider) || ""),
      model: String((entry && entry.model) || ""),
      mode: entry && entry.mode === "phrase_better" ? "phrase_better" : "ask_better"
    });
    const trimmed = log.length > HISTORY_MAX ? log.slice(log.length - HISTORY_MAX) : log;
    await chrome.storage.local.set({ [HISTORY_KEY]: trimmed });
  } catch (_e) {
    // History logging is best-effort and must never affect the user request.
  }
}

// Approximate provider pricing in USD per 1,000,000 tokens. Model catalogs change
// often, so we pattern-match model *families* (cheapest-specific first) and fall
// back to a mid-tier estimate. The UI always labels the resulting figure as
// approximate — it is a guide, not a bill.
const PRICING_PER_MTOK = {
  gemini: [
    { test: /flash-lite/, input: 0.10, output: 0.40 },
    { test: /flash/, input: 0.30, output: 2.50 },
    { test: /pro/, input: 1.25, output: 10.0 },
    { test: /./, input: 0.30, output: 2.50 }
  ],
  openai: [
    { test: /nano/, input: 0.05, output: 0.40 },
    { test: /mini|small/, input: 0.15, output: 0.60 },
    { test: /^o\d|(^|-)o-/, input: 1.10, output: 4.40 },
    { test: /./, input: 2.50, output: 10.0 }
  ],
  anthropic: [
    { test: /haiku/, input: 1.0, output: 5.0 },
    { test: /fable|mythos/, input: 10.0, output: 50.0 },
    { test: /opus-5-5/, input: 4.0, output: 20.0 },
    { test: /opus-(4-[5-9]|5)/, input: 5.0, output: 25.0 },
    { test: /opus/, input: 15.0, output: 75.0 },
    { test: /sonnet-5/, input: 2.0, output: 10.0 },
    { test: /sonnet/, input: 3.0, output: 15.0 },
    { test: /./, input: 3.0, output: 15.0 }
  ]
};

function estimateCostUsd(provider, model, inputTokens, outputTokens) {
  const table = PRICING_PER_MTOK[normalizeProvider(provider)];
  if (!table) {
    return null;
  }
  const id = String(model || "").toLowerCase();
  const row = table.find((r) => r.test.test(id));
  if (!row) {
    return null;
  }
  const inTok = Number(inputTokens) || 0;
  const outTok = Number(outputTokens) || 0;
  if (inTok <= 0 && outTok <= 0) {
    return null;
  }
  return (inTok / 1e6) * row.input + (outTok / 1e6) * row.output;
}

function mergeUsage(a, b) {
  if (!a) {
    return b || null;
  }
  if (!b) {
    return a;
  }
  return {
    inputTokens: (Number(a.inputTokens) || 0) + (Number(b.inputTokens) || 0),
    outputTokens: (Number(a.outputTokens) || 0) + (Number(b.outputTokens) || 0)
  };
}

// Shape the usage/cost figures returned to the content script for the preview footer.
function buildUsagePayload(provider, model, usage, costUsd) {
  const inTok = usage ? Number(usage.inputTokens) || 0 : 0;
  const outTok = usage ? Number(usage.outputTokens) || 0 : 0;
  if (!inTok && !outTok && typeof costUsd !== "number") {
    return null;
  }
  return {
    provider,
    model,
    inputTokens: inTok,
    outputTokens: outTok,
    totalTokens: inTok + outTok,
    costUsd: typeof costUsd === "number" ? costUsd : null
  };
}

const DEFAULT_UI_PREFS = {
  buttonOffsets: {
    chatgpt: { x: 0, y: 0 },
    gemini: { x: 0, y: 0 },
    claude: { x: 0, y: 0 }
  }
};

const PRESET_INSTRUCTIONS = {
  grammar: "Fix grammar and spelling with minimal rewrites. Preserve meaning.",
  clarity: "Improve clarity while preserving intent, requirements, and details.",
  concise: "Make it concise without losing requirements, constraints, or key context.",
  structured:
    "Rewrite into a clear, flowing, high-context prompt using natural narrative rather than section labels such as Context, Task, Constraints, Output Format, or Questions (unless the user explicitly asks for labeled sections). Scale the length to the substance of the input: keep short or vague inputs brief, and never expand a thin prompt into multiple padded paragraphs.",
  persuasive: "Rewrite to be more persuasive and outcomes-focused while preserving user intent and constraints.",
  executive: "Rewrite in executive style: clear, decisive, strategic, and optimized for quick stakeholder alignment.",
  coaching: "Rewrite in a supportive coaching style with motivation, accountability, and practical action steps.",
  email_rewrite: "Rewrite as a polished email draft with a clear subject line, concise body, and professional tone while preserving intent.",
  devils_advocate: "Rewrite with a devil's advocate lens: expose weak assumptions, gaps, and possible counterarguments.",
  first_principles: "Rewrite using first-principles thinking: break down assumptions and focus on core facts and logic.",
  risk_audit: "Rewrite to emphasize risks, edge cases, failure modes, and mitigation strategies.",
  technical_spec: "Rewrite as a precise technical spec with clear requirements, constraints, and acceptance criteria.",
  implementation_plan: "Rewrite as an implementation-ready plan with ordered tasks, dependencies, and deliverables."
};

// Phrase Better presets (the right-click rephrase). "fix_grammar" is the default
// and reproduces the original minimal-edit grammar-fix behavior.
const PHRASE_PRESET_INSTRUCTIONS = {
  fix_grammar:
    "Fix grammar, spelling, punctuation, and obvious wording issues, making the smallest number of edits needed for the text to read cleanly and correctly. Preserve the original meaning, tone, wording, sentence order, and formatting as much as possible.",
  rephrase:
    "Reword the text for clarity and natural flow while keeping the same meaning and intent. You may restructure sentences, but do not introduce new information.",
  casual:
    "Rewrite in a relaxed, friendly, conversational tone suitable for a casual chat or message, while keeping the same meaning.",
  formal:
    "Rewrite in a polished, professional, and respectful tone suitable for formal communication, while keeping the same meaning."
};

function normalizePhrasePreset(value) {
  const preset = String(value || "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(PHRASE_PRESET_INSTRUCTIONS, preset) ? preset : "fix_grammar";
}

// Optional on-top modifiers for Phrase Better; each stacks with the preset.
function getPhraseModifierClauses(settings) {
  const clauses = [];
  if (settings && settings.phraseBetterKeepVoice) {
    clauses.push(
      "Keep the user's voice: stay close to their original wording, tone, and cadence, and make the lightest change that still achieves the goal."
    );
  }
  if (settings && settings.phraseBetterPolish) {
    clauses.push(
      "Polish the wording: upgrade word choice and smooth any awkward phrasing for a more refined result."
    );
  }
  if (settings && settings.phraseBetterWit) {
    clauses.push(
      "Add a light, playful, slightly cheeky touch of wit while staying tasteful and respectful."
    );
  }
  if (settings && settings.phraseBetterHumanize) {
    clauses.push(
      "Make it sound like a real person wrote it, not an AI. Do not use em dashes (—); use commas, periods, or parentheses instead. Do not use emojis. Avoid robotic stock phrases and AI-tell wording such as 'delve', 'leverage', 'furthermore', 'moreover', 'it is important to note', 'in today's world', or 'in conclusion'. Prefer plain, everyday words and natural phrasing a typical person would actually use. Apply this without overriding the other goals above."
    );
  }
  return clauses;
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  await syncPhraseBetterContextMenu();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
  await syncPhraseBetterContextMenu();
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === "local" && changes.settings) {
    await syncPhraseBetterContextMenu();
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== PHRASE_BETTER_CONTEXT_MENU_ID) {
    return;
  }
  handlePhraseBetterContextMenu(info, tab).catch(() => {
    // Ignore context-menu runtime failures.
  });
});

if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener((command) => {
    if (command !== "optimize-prompt") {
      return;
    }
    triggerOptimizeInActiveTab().catch(() => {
      // Ignore command dispatch failures (e.g. no eligible tab).
    });
  });
}

async function triggerOptimizeInActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || typeof tab.id !== "number") {
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "ASKBETTER_TRIGGER_OPTIMIZE" });
  } catch (_error) {
    // The active tab has no AskBetter content script; nothing to trigger.
  }
}

// These two accept an arbitrary API key and make network calls with it, so only
// the extension's own pages (popup/options) may use them, never a content script.
const EXTENSION_PAGE_ONLY_MESSAGES = new Set(["ASKBETTER_TEST_KEY", "ASKBETTER_FETCH_MODELS"]);

function isExtensionPageSender(sender) {
  return !!sender
    && !sender.tab
    && typeof sender.url === "string"
    && sender.url.startsWith(chrome.runtime.getURL(""));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && EXTENSION_PAGE_ONLY_MESSAGES.has(message.type) && !isExtensionPageSender(sender)) {
    sendResponse({ ok: false, code: "FORBIDDEN", message: "Not allowed." });
    return false;
  }
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        code: "UNKNOWN_ERROR",
        message: error && error.message ? error.message : "Unexpected error."
      });
    });
  return true;
});

async function handleMessage(message) {
  if (!message || !message.type) {
    return { ok: false, code: "BAD_REQUEST", message: "Invalid request." };
  }

  if (message.type === "ASKBETTER_GET_PUBLIC_SETTINGS") {
    const settings = await readSettings();
    return { ok: true, settings: toPublicSettings(settings) };
  }

  if (message.type === "ASKBETTER_TEST_KEY") {
    return await testKey(message.payload || {});
  }

  if (message.type === "ASKBETTER_OPTIMIZE") {
    return await optimizePrompt(message);
  }

  if (message.type === "ASKBETTER_REFINE") {
    return await refineText(message);
  }

  if (message.type === "ASKBETTER_FETCH_MODELS") {
    return await fetchModelsForProvider(message.payload || {});
  }

  if (message.type === "ASKBETTER_GET_BUTTON_OFFSET") {
    const site = normalizeSite(message.site);
    const offset = await getButtonOffset(site);
    return { ok: true, site, offset };
  }

  if (message.type === "ASKBETTER_SAVE_BUTTON_OFFSET") {
    const site = normalizeSite(message.site);
    const offset = normalizeOffset(message.offset);
    const savedOffset = await saveButtonOffset(site, offset);
    return { ok: true, site, offset: savedOffset };
  }

  return { ok: false, code: "BAD_REQUEST", message: "Unknown request type." };
}

// The Optimize button / shortcut path is Ask Better only. Phrase Better has its
// own entry point (the context menu) and must never be reachable from here,
// where it would skip the per-site toggle and return the raw JSON envelope.
async function optimizePrompt(message) {
  const rawPrompt = typeof message.prompt === "string" ? message.prompt : "";
  const prompt = rawPrompt.trim();
  const settings = await readSettings();
  const preset = normalizePreset(message.preset, settings);
  const site = normalizeSite(message.site);
  return await rewriteText({ prompt, preset, site, settings, variantCount: settings.askBetterOptionCount });
}

async function rewriteText({ prompt, preset, site, settings, variantCount }) {
  const mode = "ask_better";
  const apiKey = getApiKeyForProvider(settings);
  const model = getModelForProvider(settings);
  const provider = normalizeProvider(settings.provider);
  const count = normalizeAskBetterOptionCount(variantCount);

  if (!prompt) {
    return { ok: false, code: "EMPTY_PROMPT", message: "Prompt is empty." };
  }

  if (!settings.enableAI || settings.enableAskBetterMode === false || !isSiteEnabled(settings, site) || !apiKey) {
    return {
      ok: false,
      code: "DISABLED_OR_MISSING_KEY",
      message: "AI disabled or key missing"
    };
  }

  let primary;
  try {
    primary = await callProvider({ provider, apiKey, model, prompt, preset, settings, mode, variantCount: count });
  } catch (error) {
    return mapProviderError(error);
  }
  let text = primary.text;
  let usage = primary.usage;

  // Retry only when the provider itself says the answer hit the token ceiling,
  // and only for a single rewrite (multi-variant JSON is repaired by the parser).
  // The retry is a bonus: if it fails, the primary answer still stands.
  if (count <= 1 && primary.truncated) {
    try {
      const retry = await callProvider({
        provider,
        apiKey,
        model,
        prompt,
        preset,
        settings,
        mode,
        completionPass: true
      });
      usage = mergeUsage(usage, retry && retry.usage);
      if (retry && retry.text && retry.text.trim() && !retry.truncated) {
        text = retry.text;
      }
    } catch (_error) {
      // Keep the primary text; its usage is still recorded below.
    }
  }

  // Every successful provider call was billed, so log it even when the output
  // turns out to be unusable.
  const costUsd = estimateCostUsd(provider, model, usage && usage.inputTokens, usage && usage.outputTokens);
  await recordUsage({ provider, model, mode, usage, costUsd });

  const expectJson = wantsJsonOutput({ settings, mode, variantCount: count });
  // preserveNewLines: a rewrite's own paragraphs must not be split into variants
  // when the plain-text fallback runs.
  let variants = count > 1 ? parsePhraseVariants(text, { count, preserveNewLines: true, expectJson }) : [];

  if (count > 1 && !variants.length && text && text.trim()) {
    if (looksLikeJsonOutput(stripCodeFences(text.trim()))) {
      return emptyOutputError(text);
    }
    variants = [text.trim()];
  }

  const primaryText = count > 1 ? String((variants[0] || "")).trim() : String(text || "").trim();
  if (!primaryText) {
    return emptyOutputError(text);
  }

  await recordHistory({ original: prompt, optimized: primaryText, preset, provider, model, mode });

  const result = {
    ok: true,
    optimizedPrompt: primaryText,
    usage: buildUsagePayload(provider, model, usage, costUsd)
  };
  if (count > 1 && variants.length > 1) {
    result.variants = variants;
  }
  return result;
}

// Follow-up refinement: apply a single requested change to already-generated text
// (the preview's "Refine" box). Chains, because each refine sends the latest text.
async function refineText(message) {
  const base = typeof message.base === "string" ? message.base.trim() : "";
  const instruction = typeof message.instruction === "string" ? message.instruction.trim() : "";
  const site = normalizeSite(message.site);
  const settings = await readSettings();
  const apiKey = getApiKeyForProvider(settings);
  const model = getModelForProvider(settings);
  const provider = normalizeProvider(settings.provider);

  if (!base) {
    return { ok: false, code: "EMPTY_PROMPT", message: "Nothing to refine." };
  }
  if (!instruction) {
    return { ok: false, code: "EMPTY_PROMPT", message: "Describe the change first." };
  }

  const askBetterEnabled = settings.enableAskBetterMode !== false;
  if (!settings.enableAI || !askBetterEnabled || !isSiteEnabled(settings, site) || !apiKey) {
    return { ok: false, code: "DISABLED_OR_MISSING_KEY", message: "AI disabled or key missing" };
  }

  try {
    const systemOverride = buildRefineInstruction();
    const userText = `Text to revise:\n${base}\n\nRequested change: ${instruction}`;
    const result = await callProvider({ provider, apiKey, model, prompt: userText, settings, mode: "ask_better", systemOverride });
    const refined = String(result.text || "").trim();
    if (!refined) {
      return { ok: false, code: "EMPTY_MODEL_OUTPUT", message: "Model returned an empty response." };
    }
    const costUsd = estimateCostUsd(provider, model, result.usage && result.usage.inputTokens, result.usage && result.usage.outputTokens);
    await recordUsage({ provider, model, mode: "ask_better", usage: result.usage, costUsd });
    await recordHistory({ original: base, optimized: refined, preset: "refine", provider, model, mode: "ask_better" });
    return { ok: true, optimizedPrompt: refined, usage: buildUsagePayload(provider, model, result.usage, costUsd) };
  } catch (error) {
    return mapProviderError(error);
  }
}

function buildRefineInstruction() {
  return [
    "You revise an existing piece of text according to a single change the user requests.",
    "Apply only the requested change and keep everything else as close to the original as possible.",
    "Do not invent concrete details the user did not provide.",
    "Return only the revised text as plain text.",
    "Do not include commentary, markdown fences, quotes, or explanations.",
    "Keep the result complete and end with a complete sentence."
  ].join(" ");
}

// Each callX returns { text, usage, truncated } where usage is
// { inputTokens, outputTokens } or null when the provider omits token counts,
// and truncated is true only when the provider itself reports the answer was
// cut off by the output-token ceiling (and some text came back). A caller may pass systemOverride
// to supply the system instruction directly (used by refineText).
// Generous ceiling: current models on all three providers spend "thinking" /
// reasoning tokens out of this same budget, so 3000 could be exhausted before
// any visible text was produced. Billing is per token actually generated, so a
// higher ceiling costs nothing on normal-length rewrites.
const MAX_OUTPUT_TOKENS = 8192;

// Mirrors the branch in buildSystemInstruction that asks for a JSON object, so
// the provider call can enforce that shape natively instead of hoping for it.
function wantsJsonOutput({ settings, mode, systemOverride, variantCount }) {
  if (systemOverride) {
    return false;
  }
  if (Number(variantCount) > 1) {
    return true;
  }
  return mode === "phrase_better" && (!settings || settings.phraseBetterNewLines !== false);
}

const VARIANTS_JSON_SCHEMA = {
  type: "object",
  properties: {
    variants: { type: "array", items: { type: "string" } }
  },
  required: ["variants"],
  additionalProperties: false
};

async function callProvider({ provider, apiKey, model, prompt, preset, settings, mode, completionPass, variantCount, systemOverride }) {
  if (provider === "openai") {
    return await callOpenAI({ apiKey, model, prompt, preset, settings, mode, completionPass, variantCount, systemOverride });
  }
  if (provider === "anthropic") {
    return await callAnthropic({ apiKey, model, prompt, preset, settings, mode, completionPass, variantCount, systemOverride });
  }
  return await callGemini({ apiKey, model, prompt, preset, settings, mode, completionPass, variantCount, systemOverride });
}

// Generation can legitimately take a while on a slow/thinking model; listing
// models and testing a key are cheap GETs and should fail fast.
const GENERATION_TIMEOUT_MS = 90 * 1000;
const LIGHT_REQUEST_TIMEOUT_MS = 20 * 1000;
// Chrome may stop an MV3 service worker that has been idle for 30s even while a
// fetch is pending, which silently drops the reply to the content script. Any
// extension API call resets that idle timer, so ping one while work is in flight.
const KEEPALIVE_INTERVAL_MS = 20 * 1000;
let inFlightProviderRequests = 0;
let keepAliveTimer = null;

function beginKeepAlive() {
  inFlightProviderRequests += 1;
  if (keepAliveTimer) {
    return;
  }
  keepAliveTimer = setInterval(() => {
    try {
      Promise.resolve(chrome.runtime.getPlatformInfo()).catch(() => {});
    } catch (_error) {
      // Keepalive is best effort.
    }
  }, KEEPALIVE_INTERVAL_MS);
}

function endKeepAlive() {
  inFlightProviderRequests = Math.max(0, inFlightProviderRequests - 1);
  if (inFlightProviderRequests === 0 && keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function providerTimeoutError() {
  const error = new Error("The provider took too long to respond. Try again or pick a faster model.");
  error.code = "TIMEOUT";
  return error;
}

// Runs `run(signal)` under a deadline and the SW keepalive. The callback owns
// both the fetch and the body read, so a provider that sends headers and then
// stalls mid-body is still cut off.
async function runProviderRequest(timeoutMs, run) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  beginKeepAlive();
  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw providerTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timer);
    endKeepAlive();
  }
}

async function postProviderJson(url, headers, body) {
  return await runProviderRequest(GENERATION_TIMEOUT_MS, async (signal) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal
    });
    if (!response.ok) {
      let details = "";
      try {
        details = readApiErrorMessage(await response.json());
      } catch (_error) {
        details = "";
      }
      if (signal.aborted) {
        throw providerTimeoutError();
      }
      const error = new Error(details || `Provider request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return await response.json();
  });
}

// GET used by the model list; resolves to the parsed JSON body.
async function getProviderJson(url, headers) {
  return await runProviderRequest(LIGHT_REQUEST_TIMEOUT_MS, async (signal) => {
    const response = await fetch(url, { method: "GET", headers, signal });
    if (!response.ok) {
      const error = new Error(`Provider request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return await response.json();
  });
}

// Key test: only the status matters, so the body is never read.
async function getProviderStatus(url, headers) {
  return await runProviderRequest(LIGHT_REQUEST_TIMEOUT_MS, async (signal) => {
    const response = await fetch(url, { method: "GET", headers, signal });
    return response.status;
  });
}

// Model catalogues move faster than this extension ships, so the per-model
// tuning below (thinking level, effort, structured output) is best effort. When
// a model rejects one of those optional fields with a 400 that names it, the
// request is retried once without the optional fields rather than failing.
function isOptionalParamRejection(error, pattern) {
  return Number(error && error.status) === 400 && pattern.test(String(error && error.message || ""));
}

function providerOutputError(code, message) {
  const error = new Error(message);
  error.status = 422;
  error.code = code;
  return error;
}

// ---- Gemini ----------------------------------------------------------------

// gemini-<major>.<minor>-<tier>; tier is pro / flash / flash-lite.
function parseGeminiVersion(model) {
  const match = /^gemini-(\d+)(?:\.(\d+))?-(pro|flash-lite|flash)\b/.exec(String(model || "").toLowerCase());
  if (!match) {
    return null;
  }
  return { major: Number(match[1]), minor: Number(match[2] || 0), tier: match[3] };
}

// Rewriting is a light task; keep thinking as low as each family allows so it
// stays fast and does not eat the output budget.
function geminiThinkingConfig(model) {
  const v = parseGeminiVersion(model);
  if (!v) {
    return null;
  }
  if (v.major >= 3) {
    return { thinkingLevel: "low" };
  }
  if (v.major === 2 && v.minor === 5) {
    // 2.5 Pro cannot turn thinking off and predates thinkingLevel, so ask for
    // its minimum budget; 2.5 Flash / Flash-Lite can switch thinking off.
    return v.tier === "pro" ? { thinkingBudget: 128 } : { thinkingBudget: 0 };
  }
  return null;
}

async function callGemini({ apiKey, model, prompt, preset, settings, mode, completionPass, variantCount, systemOverride }) {
  const systemText = systemOverride || buildSystemInstruction({ preset, settings, mode, completionPass, variantCount });
  const wantsJson = wantsJsonOutput({ settings, mode, systemOverride, variantCount });
  const normalizedModel = normalizeGeminiModel(model || DEFAULT_SETTINGS.geminiModel);
  const version = parseGeminiVersion(normalizedModel);

  const generationConfig = { maxOutputTokens: MAX_OUTPUT_TOKENS };
  // Gemini 3+ is tuned for its default temperature (1.0) and Google warns that
  // lowering it can cause looping; older models rewrite more faithfully at 0.1.
  if (!version || version.major < 3) {
    generationConfig.temperature = 0.1;
  }
  if (wantsJson) {
    // Constrained decoding: the model cannot emit malformed JSON at all.
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = {
      type: "OBJECT",
      properties: {
        variants: { type: "ARRAY", items: { type: "STRING" } }
      },
      required: ["variants"]
    };
  }
  const thinkingConfig = geminiThinkingConfig(normalizedModel);
  if (thinkingConfig) {
    generationConfig.thinkingConfig = thinkingConfig;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(normalizedModel)}:generateContent`;
  const headers = { "x-goog-api-key": apiKey };
  const buildBody = (config) => ({
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: config
  });

  let data;
  try {
    data = await postProviderJson(url, headers, buildBody(generationConfig));
  } catch (error) {
    if (!generationConfig.thinkingConfig || !isOptionalParamRejection(error, /think/i)) {
      throw error;
    }
    const { thinkingConfig: _dropped, ...fallbackConfig } = generationConfig;
    data = await postProviderJson(url, headers, buildBody(fallbackConfig));
  }

  const text = extractGeminiText(data).trim();
  const finishReason = data && Array.isArray(data.candidates) && data.candidates[0] && data.candidates[0].finishReason;
  if (!text) {
    const blockReason = data && data.promptFeedback && data.promptFeedback.blockReason;
    if (blockReason || finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT") {
      throw providerOutputError("MODEL_REFUSED", "Gemini declined to rewrite this text.");
    }
    if (finishReason === "MAX_TOKENS") {
      throw providerOutputError("OUTPUT_LIMIT", "The model ran out of output tokens before answering. Try a lighter model.");
    }
  }
  return { text, usage: extractGeminiUsage(data), truncated: !!text && finishReason === "MAX_TOKENS" };
}

// ---- OpenAI (Responses API) ------------------------------------------------

// GPT-5+ and the o-series are reasoning models: they reject `temperature` and
// bill hidden reasoning against max_output_tokens, so ask for the lightest
// effort every one of them accepts. Older GPT-4.x models reject `reasoning`.
function isOpenAIReasoningModel(model) {
  const s = String(model || "").toLowerCase();
  if (/^o\d/.test(s)) {
    return true;
  }
  const match = /^gpt-(\d+)/.exec(s);
  return !!match && Number(match[1]) >= 5;
}

async function callOpenAI({ apiKey, model, prompt, preset, settings, mode, completionPass, variantCount, systemOverride }) {
  const instructions = systemOverride || buildSystemInstruction({ preset, settings, mode, completionPass, variantCount });
  const normalizedModel = normalizeOpenAIModel(model || DEFAULT_SETTINGS.openaiModel);
  const payload = {
    model: normalizedModel,
    instructions,
    input: [{ role: "user", content: prompt }],
    max_output_tokens: MAX_OUTPUT_TOKENS,
    // Nothing here needs server-side conversation state; don't keep it.
    store: false
  };
  if (isOpenAIReasoningModel(normalizedModel)) {
    payload.reasoning = { effort: "low" };
  }
  if (wantsJsonOutput({ settings, mode, systemOverride, variantCount })) {
    payload.text = {
      format: {
        type: "json_schema",
        name: "rewrite_variants",
        strict: true,
        schema: VARIANTS_JSON_SCHEMA
      }
    };
  }

  const url = "https://api.openai.com/v1/responses";
  const headers = { Authorization: `Bearer ${apiKey}` };
  // Older models (gpt-4, gpt-4.1 snapshots) reject `reasoning` and/or the
  // json_schema text format. Drop only the field the 400 names and retry; the
  // system prompt still describes the JSON shape, and the parser repairs it.
  const optionalFields = [
    { key: "reasoning", pattern: /reasoning/i },
    { key: "text", pattern: /text\.format|json_schema|response_format|schema/i }
  ];
  let attemptPayload = payload;
  let data;
  for (;;) {
    try {
      data = await postProviderJson(url, headers, attemptPayload);
      break;
    } catch (error) {
      const rejected = optionalFields.find(
        (field) => attemptPayload[field.key] && isOptionalParamRejection(error, field.pattern)
      );
      if (!rejected) {
        throw error;
      }
      const { [rejected.key]: _dropped, ...fallback } = attemptPayload;
      attemptPayload = fallback;
    }
  }

  const text = extractOpenAIText(data).trim();
  if (!text) {
    if (hasOpenAIRefusal(data)) {
      throw providerOutputError("MODEL_REFUSED", "OpenAI declined to rewrite this text.");
    }
    if (data && data.status === "incomplete") {
      const reason = data.incomplete_details && data.incomplete_details.reason;
      if (reason === "content_filter") {
        throw providerOutputError("MODEL_REFUSED", "OpenAI declined to rewrite this text.");
      }
      throw providerOutputError("OUTPUT_LIMIT", "The model ran out of output tokens before answering. Try a lighter model.");
    }
  }
  const truncated = !!text && !!data && data.status === "incomplete"
    && !!data.incomplete_details && data.incomplete_details.reason === "max_output_tokens";
  return { text, usage: extractOpenAIUsage(data), truncated };
}

function hasOpenAIRefusal(data) {
  return !!(data && Array.isArray(data.output) && data.output.some((item) =>
    item && item.type === "message" && Array.isArray(item.content) && item.content.some((part) => part && part.type === "refusal")
  ));
}

// ---- Anthropic (Messages API) ----------------------------------------------

// Claude models from the 4.x generation onward support `output_config.effort`
// and/or structured outputs; claude-3.x supports neither. Haiku 4.5 and
// Sonnet 4.5 have structured outputs but reject `effort`.
function anthropicFeatures(model) {
  const s = String(model || "").toLowerCase();
  const match = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(s);
  if (!match) {
    return { structuredOutput: false, effort: false };
  }
  const family = match[1];
  const major = Number(match[2]);
  const minor = match[3] ? Number(match[3]) : 0;
  const version = major + minor / 10;
  const structuredOutput = version >= 4.5 || (family === "opus" && version >= 4.1);
  const effort = family !== "haiku" && (version >= 4.6 || (family === "opus" && version >= 4.5));
  return { structuredOutput, effort };
}

async function callAnthropic({ apiKey, model, prompt, preset, settings, mode, completionPass, variantCount, systemOverride }) {
  const system = systemOverride || buildSystemInstruction({ preset, settings, mode, completionPass, variantCount });
  const normalizedModel = normalizeAnthropicModel(model || DEFAULT_SETTINGS.anthropicModel);
  const features = anthropicFeatures(normalizedModel);
  const wantsJson = wantsJsonOutput({ settings, mode, systemOverride, variantCount });

  // Assistant-turn prefill (the old way to force JSON) is rejected by every
  // Claude model since the 4.6 generation ("This model does not support
  // assistant message prefill"), so JSON is requested via structured outputs
  // and the conversation always ends on the user turn.
  const outputConfig = {};
  if (features.effort) {
    // Thinking cannot be switched off on the newest models; low effort keeps
    // it short for a rewrite. Older models simply run without thinking.
    outputConfig.effort = "low";
  }
  if (wantsJson && features.structuredOutput) {
    outputConfig.format = { type: "json_schema", schema: VARIANTS_JSON_SCHEMA };
  }

  const payload = {
    model: normalizedModel,
    system,
    max_tokens: MAX_OUTPUT_TOKENS,
    messages: [{ role: "user", content: prompt }]
  };
  if (Object.keys(outputConfig).length) {
    payload.output_config = outputConfig;
  }

  const url = "https://api.anthropic.com/v1/messages";
  const headers = {
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
    "x-api-key": apiKey
  };
  let data;
  try {
    data = await postProviderJson(url, headers, payload);
  } catch (error) {
    if (!payload.output_config || !isOptionalParamRejection(error, /output_config|effort|format|schema|structured/i)) {
      throw error;
    }
    // The system prompt still describes the JSON shape and parsePhraseVariants
    // repairs loose output, so dropping the optional fields stays usable.
    const { output_config: _dropped, ...fallback } = payload;
    data = await postProviderJson(url, headers, fallback);
  }

  const text = extractAnthropicText(data).trim();
  if (data && data.stop_reason === "refusal") {
    throw providerOutputError("MODEL_REFUSED", "Claude declined to rewrite this text.");
  }
  if (!text && data && data.stop_reason === "max_tokens") {
    throw providerOutputError("OUTPUT_LIMIT", "The model ran out of output tokens before answering. Try a lighter model.");
  }
  return { text, usage: extractAnthropicUsage(data), truncated: !!text && !!data && data.stop_reason === "max_tokens" };
}

async function fetchModelsForProvider(payload) {
  const settings = await readSettings();
  const provider = normalizeProvider(payload.provider || settings.provider);
  const apiKey = String(
    payload.apiKey
    || (
      provider === "openai"
        ? settings.openaiApiKey
        : provider === "anthropic"
          ? settings.anthropicApiKey
          : settings.geminiApiKey
    )
    || ""
  ).trim();

  if (!apiKey) {
    return { ok: false, code: "MISSING_KEY", message: "API key is missing." };
  }
  try {
    if (provider === "openai") {
      return await fetchOpenAIModels(apiKey);
    }
    if (provider === "anthropic") {
      return await fetchAnthropicModels(apiKey);
    }
    return await fetchGeminiModels(apiKey);
  } catch (error) {
    return mapProviderError(error);
  }
}

// Provider /v1/models endpoints return everything they host — embeddings,
// audio/TTS, vision, image/video, experimental builds, and dated snapshots.
// These predicates keep the live list to the "main" general-purpose chat models
// so the dropdown stays clean (and small) as providers keep adding SKUs, without
// needing a code change each time a new flagship lands.
const MODEL_FETCH_LIMIT = 12;

// Allow-lists, not block-lists: providers keep adding non-chat SKUs (robotics,
// computer-use, image, TTS, live audio...) whose names we can't predict, and
// those 400 on a plain text request. Only the shapes below are text chat models.
//   gemini-3.5-flash, gemini-3.1-pro-preview, gemini-2.5-flash-lite
const GEMINI_CHAT_MODEL = /^gemini-\d+(\.\d+)?-(pro|flash|flash-lite)(-preview)?$/;
// OpenAI suffixes are words (mini / nano / sol / luna ...); block the
// specialised ones that the Responses text call can't serve or that are tuned
// for something else (codex, deep-research, pro = minutes-long high reasoning).
const OPENAI_NON_CHAT = /(audio|realtime|transcribe|tts|search|image|embedding|moderation|instruct|vision|codex|deep-research|computer|oss|pro|turbo|chat-latest|-\d+k)/;

function isMainGeminiModel(id) {
  return GEMINI_CHAT_MODEL.test(String(id || "").toLowerCase());
}

function isMainOpenAIModel(id) {
  const s = String(id || "").toLowerCase();
  if (!/^gpt-\d+(\.\d+)?o?(-[a-z]+)*$/.test(s) && !/^o\d+(-[a-z]+)*$/.test(s)) return false;
  if (OPENAI_NON_CHAT.test(s)) return false;
  return true;
}

// Gemini's list has no timestamps; order by version, then pro > flash > lite,
// stable before preview, so the newest flagship lands on top.
function compareGeminiModels(a, b) {
  const va = parseGeminiVersion(a);
  const vb = parseGeminiVersion(b);
  if (!va || !vb) return String(b).localeCompare(String(a));
  if (va.major !== vb.major) return vb.major - va.major;
  if (va.minor !== vb.minor) return vb.minor - va.minor;
  const tierRank = { pro: 0, flash: 1, "flash-lite": 2 };
  if (va.tier !== vb.tier) return tierRank[va.tier] - tierRank[vb.tier];
  return Number(/-preview$/.test(a)) - Number(/-preview$/.test(b));
}

async function fetchGeminiModels(apiKey) {
  const data = await getProviderJson("https://generativelanguage.googleapis.com/v1beta/models", { "x-goog-api-key": apiKey });
  const all = Array.isArray(data.models) ? data.models : [];
  const ids = all
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
    .map((m) => String(m.name || "").replace(/^models\//, ""))
    .filter(isMainGeminiModel)
    .sort(compareGeminiModels)
    .slice(0, MODEL_FETCH_LIMIT);
  return { ok: true, models: ids };
}

async function fetchOpenAIModels(apiKey) {
  const data = await getProviderJson("https://api.openai.com/v1/models", { Authorization: `Bearer ${apiKey}` });
  const items = Array.isArray(data.data) ? data.data : [];
  // Sort newest first by the API's `created` timestamp so flagships order
  // correctly (gpt-5.8 over gpt-5.2) without a version list to maintain.
  const ids = items
    .filter((m) => isMainOpenAIModel(m && m.id))
    .sort((a, b) => (Number(b.created) || 0) - (Number(a.created) || 0))
    .map((m) => String(m.id || ""))
    .filter(Boolean)
    .slice(0, MODEL_FETCH_LIMIT);
  return { ok: true, models: ids };
}

async function fetchAnthropicModels(apiKey) {
  const data = await getProviderJson("https://api.anthropic.com/v1/models", {
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
    "x-api-key": apiKey
  });
  const items = Array.isArray(data.data) ? data.data : [];
  // Anthropic's list is already only Claude chat models — sort newest first by
  // created_at (string IDs don't order opus/sonnet/haiku correctly).
  const ids = items
    .filter((m) => String(m.id || "").toLowerCase().startsWith("claude-"))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .map((m) => String(m.id || ""))
    .filter(Boolean)
    .slice(0, MODEL_FETCH_LIMIT);
  return { ok: true, models: ids };
}

async function testKey(payload) {
  const settings = await readSettings();
  const provider = normalizeProvider(payload.provider || settings.provider);
  const apiKey = String(
    payload.apiKey
    || (
      provider === "openai"
        ? settings.openaiApiKey
        : provider === "anthropic"
          ? settings.anthropicApiKey
          : settings.geminiApiKey
    )
    || ""
  ).trim();

  if (!apiKey) {
    return { ok: false, code: "MISSING_KEY", message: "API key is missing." };
  }
  if (provider === "openai") {
    return await testOpenAIKey(apiKey);
  }
  if (provider === "anthropic") {
    return await testAnthropicKey(apiKey);
  }
  return await testGeminiKey(apiKey);
}

async function testGeminiKey(apiKey) {
  return await testKeyAt("https://generativelanguage.googleapis.com/v1beta/models", {
    "x-goog-api-key": apiKey
  });
}

async function testOpenAIKey(apiKey) {
  return await testKeyAt("https://api.openai.com/v1/models", {
    Authorization: `Bearer ${apiKey}`
  });
}

async function testAnthropicKey(apiKey) {
  return await testKeyAt("https://api.anthropic.com/v1/models", {
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
    "x-api-key": apiKey
  });
}

async function testKeyAt(url, headers) {
  let status;
  try {
    status = await getProviderStatus(url, headers);
  } catch (error) {
    if (error && error.code === "TIMEOUT") {
      return mapProviderError(error);
    }
    return { ok: false, code: "NETWORK_ERROR", message: "Network error while testing key." };
  }
  if (status >= 200 && status < 300) {
    return { ok: true, message: "API key is valid." };
  }
  if (status === 401 || status === 403) {
    return { ok: false, code: "UNAUTHORIZED", message: `Invalid API key (${status}).` };
  }
  if (status === 429) {
    return { ok: false, code: "RATE_LIMIT", message: "Rate limit reached (429)." };
  }
  return {
    ok: false,
    code: "PROVIDER_ERROR",
    message: `Provider error (${status}).`
  };
}

function extractGeminiText(data) {
  if (!data || !Array.isArray(data.candidates) || data.candidates.length === 0) {
    return "";
  }
  const candidate = data.candidates[0];
  if (!candidate || !candidate.content || !Array.isArray(candidate.content.parts)) {
    return "";
  }
  // Parts are contiguous slices of one answer — joining with "\n" injected line
  // breaks that were never in the output and broke JSON strings.
  return candidate.content.parts
    .filter((part) => part && part.thought !== true)
    .map((part) => (part && typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

function extractOpenAIText(data) {
  if (data && typeof data.output_text === "string") {
    return data.output_text;
  }
  if (!data || !Array.isArray(data.output)) {
    return "";
  }
  // Skip reasoning items; only message content carries the answer.
  return data.output
    .filter((item) => item && item.type === "message")
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .filter((item) => item && item.type !== "refusal")
    .map((item) => (item && typeof item.text === "string" ? item.text : ""))
    .join("")
    .trim();
}

function extractAnthropicText(data) {
  if (!data || !Array.isArray(data.content)) {
    return "";
  }
  return data.content
    .map((item) => (item && item.type === "text" && typeof item.text === "string" ? item.text : ""))
    .join("")
    .trim();
}

function extractGeminiUsage(data) {
  const u = data && data.usageMetadata;
  if (!u) {
    return null;
  }
  // Thinking tokens are reported separately from the answer but billed as output.
  return {
    inputTokens: Number(u.promptTokenCount) || 0,
    outputTokens: (Number(u.candidatesTokenCount) || 0) + (Number(u.thoughtsTokenCount) || 0)
  };
}

function extractOpenAIUsage(data) {
  const u = data && data.usage;
  if (!u) {
    return null;
  }
  return { inputTokens: Number(u.input_tokens) || 0, outputTokens: Number(u.output_tokens) || 0 };
}

function extractAnthropicUsage(data) {
  const u = data && data.usage;
  if (!u) {
    return null;
  }
  return { inputTokens: Number(u.input_tokens) || 0, outputTokens: Number(u.output_tokens) || 0 };
}

function readApiErrorMessage(body) {
  if (!body || typeof body !== "object") {
    return "";
  }
  if (body.error && typeof body.error.message === "string") {
    return body.error.message;
  }
  return "";
}

function buildSystemInstruction({ preset, settings, mode, completionPass, variantCount }) {
  if (mode === "phrase_better") {
    const count = Number(variantCount) > 1 ? Math.min(Math.round(Number(variantCount)), 3) : 1;
    const useNewLines = !settings || settings.phraseBetterNewLines !== false;
    const presetClause =
      PHRASE_PRESET_INSTRUCTIONS[normalizePhrasePreset(settings && settings.phraseBetterPreset)] ||
      PHRASE_PRESET_INSTRUCTIONS.fix_grammar;
    const modifierClauses = getPhraseModifierClauses(settings);
    const jsonShape = JSON.stringify({
      variants: Array.from({ length: count }, (_value, index) => `rewrite ${index + 1}`)
    });
    // Multi-option asks for JSON below even when newlines are off, so the
    // provider-level JSON mode never contradicts what the instruction requests.
    const newLineClauses = useNewLines
      ? [
        "Preserve all meaningful line and paragraph breaks from the original text.",
        "You may add natural line breaks where they improve readability, such as between a greeting and the message, before a sign-off, or between distinct concepts in a longer message. Do not add breaks arbitrarily or change meaning, tone, voice, details, or emphasis to create them.",
        `Return valid JSON only in exactly this shape: ${jsonShape}. Encode each line break inside a JSON string as \\n. Do not wrap the JSON in markdown fences.`
      ]
      : [];

    if (count > 1) {
      const parts = [
        `You transform the user-selected text and provide ${count} alternative versions.`,
        presetClause,
        "Each variant must preserve the original meaning and intent, and must not add new claims, examples, or instructions that were not present in the original.",
        ...modifierClauses,
        ...newLineClauses,
        `Return exactly ${count} variants and nothing else.`,
        "Make the variants meaningfully distinct from each other in phrasing."
      ];
      if (!useNewLines) {
        parts.push(
          `Return valid JSON only in exactly this shape: ${jsonShape}. Do not wrap the JSON in markdown fences.`,
          "Do not add any other commentary, labels, markdown, bullets, headings, or explanations."
        );
      }
      return parts.join(" ");
    }

    const parts = [
      "You transform the user-selected text.",
      presetClause,
      "Preserve the original meaning and intent.",
      "Do not add new claims, examples, or instructions that were not present in the original.",
      ...modifierClauses,
      ...newLineClauses
    ];

    if (!useNewLines) {
      parts.push(
        "Return only the rewritten text as plain text.",
        "Do not add commentary, labels, markdown, bullets, or explanations."
      );
    }

    if (completionPass) {
      parts.push("Previous output looked incomplete. Return the full rewritten text from the original selection.");
    }

    return parts.join(" ");
  }

  const instruction = getPresetInstruction(preset, settings);
  const customGuidance = String(settings && settings.customPromptAdditions ? settings.customPromptAdditions : "").trim();
  const keepUserVoice = !!(settings && settings.keepUserVoice);
  const count = Number(variantCount) > 1 ? Math.min(Math.round(Number(variantCount)), 3) : 1;
  const parts = [
    "You rewrite prompts for end users.",
    count > 1
      ? `Return exactly ${count} alternative rewritten prompts and nothing else.`
      : "Return only one rewritten prompt as plain text.",
    "Do not include commentary, markdown fences, or explanations.",
    "Preserve all critical requirements and constraints from the original prompt.",
    "Do not invent concrete details the user did not provide — no specific facts, names, numbers, dates, audiences, tools, or domain requirements. When a detail is missing, keep it general instead of fabricating it.",
    "Keep the rewrite proportional to the input: a short, simple, or vague prompt must produce a short rewrite. Never pad length for its own sake.",
    "The rewritten prompt must be complete and end with a complete sentence.",
    `Preset behavior: ${instruction}`
  ];

  if (count > 1) {
    parts.push(
      `Make the ${count} rewrites meaningfully distinct in approach or emphasis while all honoring the preset and the original intent.`
    );
    // JSON rather than "1. / 2." lines: a rewrite that itself contains a
    // numbered list is indistinguishable from a variant boundary in that format.
    parts.push(
      `Return valid JSON only in exactly this shape: ${JSON.stringify({
        variants: Array.from({ length: count }, (_value, index) => `rewrite ${index + 1}`)
      })}. Encode any line break inside a JSON string as \\n. Do not wrap the JSON in markdown fences.`
    );
  }

  if (preset === "structured") {
    parts.push(
      "For the structured preset, write in cohesive, flowing narrative (not bullet lists). You may add light, generic framing to make the request well-formed, but only generic scaffolding — never concrete specifics the user did not give. For short or vague inputs, keep it to one short paragraph or a couple of sentences; reserve multiple paragraphs for inputs that already contain substantial detail."
    );
  }

  if (keepUserVoice) {
    parts.push(
      "Preserve the user's voice: keep their tone, cadence, and phrasing style where possible while improving quality."
    );
  }

  if (customGuidance) {
    parts.push("Additional user guidance is provided below and should take priority over default preset style when they conflict.");
    parts.push(`Additional user guidance: ${customGuidance}`);
  }

  if (completionPass) {
    parts.push(
      "Previous rewrite appeared incomplete. Regenerate the full prompt from scratch and ensure no sentence is cut off."
    );
  }

  return parts.join(" ");
}

function mapProviderError(error) {
  const status = Number(error && error.status);
  if (error && error.code) {
    return { ok: false, code: error.code, message: error.message || "Provider returned no usable output." };
  }
  if (status === 401 || status === 403) {
    return { ok: false, code: "UNAUTHORIZED", message: `Invalid API key (${status}).` };
  }
  if (status === 429) {
    return { ok: false, code: "RATE_LIMIT", message: "Rate limit reached (429)." };
  }
  if (status >= 500 && status < 600) {
    return { ok: false, code: "PROVIDER_DOWN", message: "Provider is temporarily unavailable." };
  }
  if (status >= 400 && status < 500) {
    return {
      ok: false,
      code: "BAD_REQUEST",
      message: error && error.message ? error.message : "Provider rejected the request."
    };
  }
  return {
    ok: false,
    code: "NETWORK_ERROR",
    message: error && error.message ? error.message : "Network or unknown error."
  };
}

function toPublicSettings(settings) {
  const hasApiKey = !!getApiKeyForProvider(settings);
  return {
    provider: normalizeProvider(settings.provider),
    geminiModel: settings.geminiModel,
    openaiModel: settings.openaiModel,
    anthropicModel: settings.anthropicModel,
    activeModel: getModelForProvider(settings),
    defaultPreset: normalizePreset(settings.defaultPreset, settings),
    askBetterOptionCount: normalizeAskBetterOptionCount(settings.askBetterOptionCount),
    enableChatGPT: !!settings.enableChatGPT,
    enableGemini: !!settings.enableGemini,
    enableClaude: !!settings.enableClaude,
    enableAskBetterMode: settings.enableAskBetterMode !== false,
    enablePhraseBetterMode: settings.enablePhraseBetterMode !== false,
    phraseBetterOptionCount: normalizePhraseBetterOptionCount(settings.phraseBetterOptionCount),
    phraseBetterNewLines: settings.phraseBetterNewLines !== false,
    enableAI: !!settings.enableAI,
    keepUserVoice: !!settings.keepUserVoice,
    customPresets: settings.customPresets.map((preset) => ({ id: preset.id, name: preset.name })),
    hasApiKey
  };
}

function normalizePreset(value, settings) {
  const preset = String(value || "").toLowerCase();
  if (Object.prototype.hasOwnProperty.call(PRESET_INSTRUCTIONS, preset)) {
    return preset;
  }
  const customPresets = settings && Array.isArray(settings.customPresets) ? settings.customPresets : [];
  if (customPresets.some((item) => item.id === String(value || ""))) {
    return String(value || "");
  }
  return DEFAULT_SETTINGS.defaultPreset;
}

function getPresetInstruction(preset, settings) {
  if (Object.prototype.hasOwnProperty.call(PRESET_INSTRUCTIONS, preset)) {
    return PRESET_INSTRUCTIONS[preset];
  }
  const customPresets = settings && Array.isArray(settings.customPresets) ? settings.customPresets : [];
  const match = customPresets.find((item) => item.id === preset);
  if (match && match.instruction) {
    return match.instruction;
  }
  return PRESET_INSTRUCTIONS.structured;
}

function normalizeCustomPresets(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const result = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const id = String(raw.id || "").trim();
    const name = String(raw.name || "").replace(/\s+/g, " ").trim();
    const instruction = String(raw.instruction || "").trim();
    if (!id || !name || !instruction || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push({ id, name, instruction });
  }
  return result;
}

function normalizeGeminiModel(model) {
  const raw = String(model || "").trim();
  if (!raw) {
    return DEFAULT_SETTINGS.geminiModel;
  }
  return raw.startsWith("models/") ? raw.slice(7) : raw;
}

function normalizeOpenAIModel(model) {
  const raw = String(model || "").trim();
  return raw || DEFAULT_SETTINGS.openaiModel;
}

function normalizeAnthropicModel(model) {
  const raw = String(model || "").trim();
  return raw || DEFAULT_SETTINGS.anthropicModel;
}

function normalizeProvider(value) {
  const provider = String(value || "").toLowerCase();
  if (provider === "openai" || provider === "anthropic") {
    return provider;
  }
  return "gemini";
}

function getApiKeyForProvider(settings) {
  const provider = normalizeProvider(settings.provider);
  if (provider === "openai") {
    return String(settings.openaiApiKey || "").trim();
  }
  if (provider === "anthropic") {
    return String(settings.anthropicApiKey || "").trim();
  }
  return String(settings.geminiApiKey || "").trim();
}

function getModelForProvider(settings) {
  const provider = normalizeProvider(settings.provider);
  if (provider === "openai") {
    return normalizeOpenAIModel(settings.openaiModel || DEFAULT_SETTINGS.openaiModel);
  }
  if (provider === "anthropic") {
    return normalizeAnthropicModel(settings.anthropicModel || DEFAULT_SETTINGS.anthropicModel);
  }
  return normalizeGeminiModel(settings.geminiModel || DEFAULT_SETTINGS.geminiModel);
}

function isSiteEnabled(settings, site) {
  if (site === "gemini") {
    return !!settings.enableGemini;
  }
  if (site === "claude") {
    return !!settings.enableClaude;
  }
  return !!settings.enableChatGPT;
}

async function ensureDefaults() {
  const settings = await readSettings();
  const uiPrefs = await readUiPrefs();
  await chrome.storage.local.set({ settings, uiPrefs });
}

async function readSettings() {
  const stored = await chrome.storage.local.get(["settings"]);
  const raw = stored.settings || {};
  const customPresets = normalizeCustomPresets(raw.customPresets);
  return {
    provider: normalizeProvider(raw.provider),
    geminiApiKey: String(raw.geminiApiKey || ""),
    geminiModel: normalizeGeminiModel(raw.geminiModel || DEFAULT_SETTINGS.geminiModel),
    geminiKeyVerified: !!raw.geminiKeyVerified,
    openaiApiKey: String(raw.openaiApiKey || ""),
    openaiModel: normalizeOpenAIModel(raw.openaiModel || DEFAULT_SETTINGS.openaiModel),
    openaiKeyVerified: !!raw.openaiKeyVerified,
    anthropicApiKey: String(raw.anthropicApiKey || ""),
    anthropicModel: normalizeAnthropicModel(raw.anthropicModel || DEFAULT_SETTINGS.anthropicModel),
    anthropicKeyVerified: !!raw.anthropicKeyVerified,
    defaultPreset: normalizePreset(raw.defaultPreset, { customPresets }),
    askBetterOptionCount: normalizeAskBetterOptionCount(raw.askBetterOptionCount),
    enableChatGPT: raw.enableChatGPT !== false,
    enableGemini: raw.enableGemini !== false,
    enableClaude: raw.enableClaude !== false,
    enableAskBetterMode: raw.enableAskBetterMode !== false,
    enablePhraseBetterMode: raw.enablePhraseBetterMode !== false,
    phraseBetterOptionCount: normalizePhraseBetterOptionCount(raw.phraseBetterOptionCount),
    phraseBetterPreset: normalizePhrasePreset(raw.phraseBetterPreset),
    phraseBetterKeepVoice: !!raw.phraseBetterKeepVoice,
    phraseBetterPolish: !!raw.phraseBetterPolish,
    phraseBetterWit: !!raw.phraseBetterWit,
    phraseBetterHumanize: !!raw.phraseBetterHumanize,
    phraseBetterNewLines: raw.phraseBetterNewLines !== false,
    enableAI: raw.enableAI !== false,
    keepUserVoice: !!raw.keepUserVoice,
    keyVerified: !!raw.keyVerified,
    customPromptAdditions: String(raw.customPromptAdditions || ""),
    customPresets
  };
}

function normalizePhraseBetterOptionCount(value) {
  const count = Math.round(Number(value));
  if (!Number.isFinite(count) || count < 1) {
    return DEFAULT_SETTINGS.phraseBetterOptionCount;
  }
  if (count > 3) {
    return 3;
  }
  return count;
}

function normalizeAskBetterOptionCount(value) {
  const count = Math.round(Number(value));
  if (!Number.isFinite(count) || count < 1) {
    return DEFAULT_SETTINGS.askBetterOptionCount;
  }
  if (count > 3) {
    return 3;
  }
  return count;
}

async function syncPhraseBetterContextMenu() {
  const token = ++phraseBetterMenuSyncToken;
  const settings = await readSettings();
  await chrome.contextMenus.removeAll();

  if (token !== phraseBetterMenuSyncToken) {
    return;
  }

  if (!settings.enableAI || !settings.enablePhraseBetterMode) {
    return;
  }

  chrome.contextMenus.create({
    id: PHRASE_BETTER_CONTEXT_MENU_ID,
    title: "Re-phrase with AskBetter",
    contexts: ["selection"]
  });
}

async function handlePhraseBetterContextMenu(info, tab) {
  const selectedText = String(info.selectionText || "").trim();
  if (!selectedText || !tab || typeof tab.id !== "number") {
    return;
  }

  const settings = await readSettings();
  const count = normalizePhraseBetterOptionCount(settings.phraseBetterOptionCount);

  // Capture WHERE/WHAT was selected up front, before the async request can let the
  // selection get lost (focus change, typing). The chooser later applies to this
  // stored location, so the user does not have to keep the text selected while it processes.
  // Ties this request's captured selection, busy pill, and chooser together so
  // a second right-click while this one is in flight cannot cross the wires.
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const captured = await capturePhraseBetterSelectionInTab(tab.id, info.frameId, nonce);
  if (!captured) {
    await showPageToastInTab(tab.id, info.frameId, "Phrase Better works in editable text fields.");
    return;
  }

  await showPageBusyIndicatorInTab(tab.id, info.frameId, "Phrase Better is working…", nonce);
  let response;
  try {
    response = await generatePhraseBetterOptions({ prompt: selectedText, settings, count });
  } finally {
    await hidePageBusyIndicatorInTab(tab.id, info.frameId, nonce);
  }

  if (!response || !response.ok) {
    const message = response && response.code === "DISABLED_OR_MISSING_KEY"
      ? "Phrase Better is off or the selected provider key is missing."
      : (response && response.message) || "Phrase Better failed.";
    await showPageToastInTab(tab.id, info.frameId, message);
    return;
  }

  const tokenCount = response.usage && Number(response.usage.totalTokens) > 0 ? Number(response.usage.totalTokens) : 0;
  const shown = await showPhraseBetterChooserInTab(tab.id, info.frameId, response.options, tokenCount, nonce);
  if (!shown) {
    await showPageToastInTab(tab.id, info.frameId, "Phrase Better works in editable text fields.");
  }
}

async function capturePhraseBetterSelectionInTab(tabId, frameId, nonce) {
  try {
    const results = await chrome.scripting.executeScript({
      target: {
        tabId,
        frameIds: typeof frameId === "number" ? [frameId] : undefined
      },
      func: capturePhraseBetterSelectionOnPage,
      args: [String(nonce || "")]
    });
    return !!(results && results[0] && results[0].result && results[0].result.ok);
  } catch (_error) {
    return false;
  }
}

async function generatePhraseBetterOptions({ prompt, settings, count }) {
  const apiKey = getApiKeyForProvider(settings);
  const model = getModelForProvider(settings);
  const provider = normalizeProvider(settings.provider);
  const variantCount = normalizePhraseBetterOptionCount(count);

  if (!prompt) {
    return { ok: false, code: "EMPTY_PROMPT", message: "Prompt is empty." };
  }

  if (!settings.enableAI || settings.enablePhraseBetterMode === false || !apiKey) {
    return { ok: false, code: "DISABLED_OR_MISSING_KEY", message: "AI disabled or key missing" };
  }

  try {
    const mode = "phrase_better";
    const raw = await callProvider({ provider, apiKey, model, prompt, preset: "grammar", settings, mode, variantCount });
    // Billed regardless of whether the output parses.
    const costUsd = estimateCostUsd(provider, model, raw.usage && raw.usage.inputTokens, raw.usage && raw.usage.outputTokens);
    await recordUsage({ provider, model, mode, usage: raw.usage, costUsd });
    const options = parsePhraseVariants(raw.text, {
      count: variantCount,
      preserveNewLines: settings.phraseBetterNewLines !== false,
      expectJson: wantsJsonOutput({ settings, mode, variantCount })
    });
    if (!options.length) {
      return emptyOutputError(raw.text);
    }
    await recordHistory({ original: prompt, optimized: options[0], preset: "phrase", provider, model, mode });
    return { ok: true, options, usage: buildUsagePayload(provider, model, raw.usage, costUsd) };
  } catch (error) {
    return mapProviderError(error);
  }
}

// expectJson must mirror wantsJsonOutput for the request that produced `raw`:
// when JSON was not asked for, a rewrite that happens to start with "[" or "{"
// is real text and must not be fed through the JSON repair chain.
function parsePhraseVariants(raw, { count = 1, preserveNewLines = false, expectJson = false } = {}) {
  let text = String(raw || "").trim();
  if (!text) {
    return [];
  }

  if (expectJson) {
    text = stripCodeFences(text);
  } else {
    // Plain text may legitimately contain a fenced code block; only unwrap a
    // fence that encloses the entire response.
    const whole = text.match(/^```[\w-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/);
    if (whole && whole[1].trim()) {
      text = whole[1].trim();
    }
  }

  let candidates = [];
  let parsedJson = false;
  // Models drift off the requested JSON shape in predictable ways: prose around
  // the object, raw newlines inside strings, trailing commas, or a response cut
  // off mid-array. Slice out the JSON, repair it, and only then give up.
  if (expectJson && looksLikeJsonOutput(text)) {
    const slice = extractJsonSlice(text);
    if (slice) {
      candidates = variantsFromJsonValue(parseJsonLoose(slice));
      if (!candidates.length) {
        candidates = salvageJsonStrings(slice);
      }
      parsedJson = candidates.length > 0;
      if (!parsedJson) {
        // Never hand raw JSON scaffolding back to the user as if it were a
        // rewrite; an explicit failure is better than pasting `{"variants":...`.
        return [];
      }
    }
  }

  if (!candidates.length) {
    // Only split on numbered markers when more than one variant was asked for.
    // A single rewrite may legitimately BE a numbered list, and splitting it
    // used to discard everything after item 1.
    const markers = Number(count) > 1 ? findVariantMarkers(text) : [];
    if (markers.length) {
      candidates = markers.map((marker, index) => {
        const start = marker.index + marker[0].length;
        const end = index + 1 < markers.length ? markers[index + 1].index : text.length;
        return text.slice(start, end);
      });
    } else if (Number(count) <= 1 || preserveNewLines) {
      candidates = [text];
    } else {
      candidates = text.split(/\r?\n+/);
    }
  }

  const seen = new Set();
  const result = [];
  for (let candidate of candidates) {
    candidate = coerceVariantText(candidate);
    if (!candidate) {
      continue;
    }
    candidate = candidate.replace(/\r\n?/g, "\n").trim();
    if (preserveNewLines && !parsedJson && !candidate.includes("\n")) {
      candidate = candidate.replace(/\\r\\n|\\n|\\r/g, "\n");
    }
    const key = candidate.toLowerCase();
    if (candidate && !seen.has(key)) {
      seen.add(key);
      result.push(candidate);
    }
  }
  return result.slice(0, count);
}

// Accepts "1." / "2." line prefixes only while they run in order from 1, so a
// numbered list *inside* one variant does not shatter it into fragments.
function findVariantMarkers(text) {
  const markers = [];
  let expected = 1;
  for (const match of text.matchAll(/(?:^|\n)[ \t]*\(?(\d+)[.)][ \t]+/g)) {
    if (Number(match[1]) === expected) {
      markers.push(match);
      expected += 1;
    }
  }
  return markers;
}

// Distinguishes "the model said nothing" from "the model answered but broke the
// requested format", so the user is told to retry instead of seeing raw JSON.
function emptyOutputError(rawText) {
  const value = String(rawText || "").trim();
  if (value && looksLikeJsonOutput(stripCodeFences(value))) {
    return {
      ok: false,
      code: "UNPARSABLE_MODEL_OUTPUT",
      message: "Model returned malformed output. Try again."
    };
  }
  return { ok: false, code: "EMPTY_MODEL_OUTPUT", message: "Model returned an empty response." };
}

// Drops markdown fences, including an unterminated opening fence left behind by
// a truncated response.
function stripCodeFences(text) {
  const closed = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (closed && closed[1].trim()) {
    return closed[1].trim();
  }
  const open = text.match(/^```(?:json)?\s*([\s\S]*)$/i);
  if (open && open[1].trim()) {
    return open[1].trim();
  }
  return text;
}

function looksLikeJsonOutput(text) {
  return /^[{[]/.test(text) || /"variants"\s*:/.test(text);
}

// Returns the outermost {...} / [...] span, tolerating a missing closing
// bracket when the model output was cut off mid-structure.
function extractJsonSlice(text) {
  const start = text.search(/[{[]/);
  if (start < 0) {
    return "";
  }
  const openChar = text[start];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
    } else if (ch === openChar) {
      depth += 1;
    } else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return text.slice(start);
}

function parseJsonLoose(slice) {
  const attempts = [slice, repairJson(slice)];
  for (const attempt of attempts) {
    if (!attempt) {
      continue;
    }
    try {
      return JSON.parse(attempt);
    } catch (_error) {
      // Try the next candidate.
    }
  }
  return null;
}

// Rewrites the two failures we actually see from models: literal control
// characters inside strings (a real line break instead of \n), and structures
// left unterminated because the response hit the token ceiling.
function repairJson(slice) {
  let out = "";
  let inString = false;
  let escaped = false;
  const stack = [];
  for (let i = 0; i < slice.length; i += 1) {
    const ch = slice[i];
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
      } else if (ch === "\\") {
        out += ch;
        escaped = true;
      } else if (ch === "\"") {
        out += ch;
        inString = false;
      } else if (ch === "\n") {
        out += "\\n";
      } else if (ch === "\r") {
        out += "\\r";
      } else if (ch === "\t") {
        out += "\\t";
      } else if (ch >= " ") {
        out += ch;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      out += ch;
    } else if (ch === "{" || ch === "[") {
      stack.push(ch === "{" ? "}" : "]");
      out += ch;
    } else if (ch === "}" || ch === "]") {
      if (stack[stack.length - 1] === ch) {
        stack.pop();
      }
      out += ch;
    } else {
      out += ch;
    }
  }
  if (escaped) {
    out = out.slice(0, -1);
  }
  if (inString) {
    out += "\"";
  }
  while (stack.length) {
    out = out.replace(/,\s*$/, "");
    out += stack.pop();
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function variantsFromJsonValue(parsed) {
  if (typeof parsed === "string") {
    return [parsed];
  }
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (!parsed || typeof parsed !== "object") {
    return [];
  }
  for (const key of ["variants", "options", "rewrites", "results", "text"]) {
    if (Array.isArray(parsed[key])) {
      return parsed[key];
    }
    if (typeof parsed[key] === "string" && parsed[key].trim()) {
      return [parsed[key]];
    }
  }
  const values = Object.values(parsed);
  if (values.length === 1 && typeof values[0] === "string") {
    return [values[0]];
  }
  return [];
}

// Last resort when even the repaired JSON will not parse: pull the string
// literals out of the variants array directly.
function salvageJsonStrings(slice) {
  const body = slice.replace(/^[\s\S]*?"(?:variants|options|rewrites|results)"\s*:\s*\[/, "");
  if (body === slice && !/^\[/.test(slice)) {
    return [];
  }
  const tokens = body.match(/"(?:\\.|[^"\\])*"/g) || [];
  return tokens
    .map((token) => {
      try {
        return JSON.parse(token);
      } catch (_error) {
        return "";
      }
    })
    .filter((value) => typeof value === "string" && value.trim());
}

function coerceVariantText(candidate) {
  if (typeof candidate === "string") {
    return candidate;
  }
  if (candidate && typeof candidate === "object") {
    for (const key of ["text", "variant", "value", "rewrite", "content"]) {
      if (typeof candidate[key] === "string" && candidate[key].trim()) {
        return candidate[key];
      }
    }
  }
  return "";
}

async function showPhraseBetterChooserInTab(tabId, frameId, options, tokenCount, nonce) {
  try {
    const results = await chrome.scripting.executeScript({
      target: {
        tabId,
        frameIds: typeof frameId === "number" ? [frameId] : undefined
      },
      func: showPhraseBetterChooserOnPage,
      args: [
        Array.isArray(options) ? options.map((option) => String(option || "")) : [],
        Number(tokenCount) > 0 ? Number(tokenCount) : 0,
        String(nonce || "")
      ]
    });
    return !!(results && results[0] && results[0].result && results[0].result.ok);
  } catch (_error) {
    return false;
  }
}

async function showPageToastInTab(tabId, frameId, message) {
  try {
    await chrome.scripting.executeScript({
      target: {
        tabId,
        frameIds: typeof frameId === "number" ? [frameId] : undefined
      },
      func: showPageToastOnPage,
      args: [String(message || "")]
    });
  } catch (_error) {
    // Ignore toast injection errors on unsupported pages.
  }
}

async function showPageBusyIndicatorInTab(tabId, frameId, message, nonce) {
  try {
    await chrome.scripting.executeScript({
      target: {
        tabId,
        frameIds: typeof frameId === "number" ? [frameId] : undefined
      },
      func: showPageBusyIndicatorOnPage,
      args: [String(message || ""), String(nonce || "")]
    });
  } catch (_error) {
    // Ignore busy indicator injection errors on unsupported pages.
  }
}

async function hidePageBusyIndicatorInTab(tabId, frameId, nonce) {
  try {
    await chrome.scripting.executeScript({
      target: {
        tabId,
        frameIds: typeof frameId === "number" ? [frameId] : undefined
      },
      func: hidePageBusyIndicatorOnPage,
      args: [String(nonce || "")]
    });
  } catch (_error) {
    // Ignore busy indicator cleanup errors on unsupported pages.
  }
}

function capturePhraseBetterSelectionOnPage(nonce) {
  // Store the current selection (location + live DOM references) on the page's
  // isolated-world global so a later executeScript call can apply to it, even if the
  // live selection is gone by then. The captured object keeps real DOM references; this
  // is fine because both executeScript calls share the same isolated world for the tab.
  // Entries are keyed per request so overlapping right-clicks each keep their own target.
  const selections = window.__askBetterPhraseSelections || (window.__askBetterPhraseSelections = {});
  // A request that failed before showing its chooser never cleans up; drop
  // anything old enough that its request must have finished.
  const staleBefore = Date.now() - 10 * 60 * 1000;
  for (const key of Object.keys(selections)) {
    if (!selections[key] || !(selections[key].ts >= staleBefore)) {
      delete selections[key];
    }
  }
  let captured = null;
  const active = document.activeElement;
  const isTextInput = active instanceof HTMLTextAreaElement
    || (active instanceof HTMLInputElement && /^(text|search|url|email|tel|password)$/i.test(active.type || "text"));

  if (isTextInput && typeof active.selectionStart === "number" && typeof active.selectionEnd === "number" && active.selectionEnd > active.selectionStart) {
    captured = { type: "input", el: active, start: active.selectionStart, end: active.selectionEnd };
  } else {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      const range = selection.getRangeAt(0);
      const anchorNode = range.commonAncestorContainer && range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer && range.commonAncestorContainer.parentElement;
      const editableRoot = anchorNode && anchorNode.closest
        ? anchorNode.closest("[contenteditable='true'], [contenteditable='plaintext-only']")
        : null;
      if (editableRoot) {
        captured = { type: "contenteditable", range: range.cloneRange(), editableRoot };
      }
    }
  }

  if (captured) {
    captured.ts = Date.now();
    selections[String(nonce || "")] = captured;
  }
  return { ok: !!captured };
}

function showPhraseBetterChooserOnPage(options, tokenCount, nonce) {
  const chooserId = "askbetter-phrase-chooser";
  const selectionKey = String(nonce || "");
  const selections = window.__askBetterPhraseSelections || (window.__askBetterPhraseSelections = {});
  const forgetSelection = () => {
    delete selections[selectionKey];
  };
  // Only one chooser is shown at a time. Run the previous one's cleanup rather
  // than just removing its node, so its document listeners and stored
  // selection do not leak.
  if (typeof window.__askBetterPhraseChooserCleanup === "function") {
    try {
      window.__askBetterPhraseChooserCleanup();
    } catch (_error) {
      // Ignore stale cleanup failures.
    }
  }
  const existing = document.getElementById(chooserId);
  if (existing) {
    existing.remove();
  }

  // Load the bundled DM Sans font into the page (once) so injected overlays
  // match the extension UI. Font is web-accessible; resolved via runtime URL.
  try {
    const fontStyleId = "askbetter-dm-sans-font";
    if (!document.getElementById(fontStyleId)) {
      const fontUrl = (weight) => chrome.runtime.getURL("ui/fonts/dm-sans-" + weight + ".woff2");
      const fontStyle = document.createElement("style");
      fontStyle.id = fontStyleId;
      fontStyle.textContent =
        [400, 500, 600, 700]
          .map((weight) => "@font-face{font-family:'DM Sans';font-style:normal;font-weight:" + weight +
            ";font-display:swap;src:url('" + fontUrl(weight) + "') format('woff2');}")
          .join("");
      (document.head || document.documentElement).appendChild(fontStyle);
    }
  } catch (_fontError) {
    /* font is a progressive enhancement; ignore failures */
  }

  const variants = Array.isArray(options) ? options.filter((option) => String(option || "").trim()) : [];
  if (!variants.length) {
    forgetSelection();
    return { ok: false, reason: "NO_OPTIONS" };
  }

  // Prefer the selection this request captured at context-menu time (keyed by
  // its nonce, so a second right-click cannot redirect it); fall back to the
  // live selection if it is still present and the stored one is gone.
  let captured = null;
  let anchorRect = null;

  const stored = selections[selectionKey] || null;
  if (stored && stored.type === "input" && stored.el && stored.el.isConnected) {
    captured = stored;
    anchorRect = stored.el.getBoundingClientRect();
  } else if (stored && stored.type === "contenteditable" && stored.range && stored.editableRoot && stored.editableRoot.isConnected) {
    captured = stored;
    try {
      anchorRect = stored.range.getBoundingClientRect();
    } catch (_error) {
      anchorRect = null;
    }
  }

  if (!captured) {
    const active = document.activeElement;
    const isTextInput = active instanceof HTMLTextAreaElement
      || (active instanceof HTMLInputElement && /^(text|search|url|email|tel|password)$/i.test(active.type || "text"));

    if (isTextInput && typeof active.selectionStart === "number" && typeof active.selectionEnd === "number" && active.selectionEnd > active.selectionStart) {
      captured = { type: "input", el: active, start: active.selectionStart, end: active.selectionEnd };
      anchorRect = active.getBoundingClientRect();
    } else {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
        const range = selection.getRangeAt(0);
        const anchorNode = range.commonAncestorContainer && range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
          ? range.commonAncestorContainer
          : range.commonAncestorContainer && range.commonAncestorContainer.parentElement;
        const editableRoot = anchorNode && anchorNode.closest
          ? anchorNode.closest("[contenteditable='true'], [contenteditable='plaintext-only']")
          : null;
        if (editableRoot) {
          captured = { type: "contenteditable", range: range.cloneRange(), editableRoot };
          anchorRect = range.getBoundingClientRect();
        }
      }
    }
  }

  if (!captured) {
    forgetSelection();
    return { ok: false, reason: "UNEDITABLE_SELECTION" };
  }

  const dispatch = (target, type) => {
    if (!target) {
      return;
    }
    try {
      target.dispatchEvent(new Event(type, { bubbles: true }));
    } catch (_error) {
      // Ignore event dispatch failures.
    }
  };

  const applyText = (nextText) => {
    if (captured.type === "input") {
      const el = captured.el;
      // Single-line inputs cannot represent newlines; keep word boundaries intact
      // instead of letting the browser's value sanitizer concatenate the lines.
      const replacementText = el instanceof HTMLTextAreaElement
        ? nextText
        : String(nextText).replace(/[ \t]*\n+[ \t]*/g, " ");
      try {
        el.focus({ preventScroll: true });
      } catch (_error) {
        // Ignore focus failures.
      }
      try {
        el.setRangeText(replacementText, captured.start, captured.end, "end");
      } catch (_error) {
        const value = String(el.value || "");
        el.value = value.slice(0, captured.start) + replacementText + value.slice(captured.end);
      }
      dispatch(el, "input");
      dispatch(el, "change");
      return true;
    }

    try {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(captured.range);
      captured.range.deleteContents();
      const fragment = document.createDocumentFragment();
      const lines = String(nextText).split("\n");
      let lastInsertedNode = null;
      lines.forEach((line, index) => {
        if (index > 0) {
          const breakNode = document.createElement("br");
          fragment.appendChild(breakNode);
          lastInsertedNode = breakNode;
        }
        if (line) {
          const textNode = document.createTextNode(line);
          fragment.appendChild(textNode);
          lastInsertedNode = textNode;
        }
      });
      captured.range.insertNode(fragment);
      selection.removeAllRanges();
      const after = document.createRange();
      after.setStartAfter(lastInsertedNode);
      after.collapse(true);
      selection.addRange(after);
      dispatch(captured.editableRoot, "input");
      dispatch(captured.editableRoot, "change");
      return true;
    } catch (_error) {
      return false;
    }
  };

  const FONT = '500 13px/1.4 "DM Sans", "Google Sans Text", "Google Sans", "Segoe UI", Arial, sans-serif';
  const card = document.createElement("div");
  card.id = chooserId;
  card.style.position = "fixed";
  card.style.zIndex = "2147483003";
  card.style.boxSizing = "border-box";
  card.style.width = "min(440px, calc(100vw - 24px))";
  card.style.maxHeight = "min(60vh, 460px)";
  card.style.display = "flex";
  card.style.flexDirection = "column";
  card.style.gap = "10px";
  card.style.padding = "14px";
  card.style.borderRadius = "10px";
  card.style.border = "1px solid #3a3128";
  card.style.background = "rgba(22, 19, 16, 0.98)";
  card.style.color = "#f4f0eb";
  card.style.font = FONT;
  card.style.boxShadow = "0 1px 2px rgba(0, 0, 0, 0.3), 0 16px 40px -16px rgba(0, 0, 0, 0.7)";

  const head = document.createElement("div");
  head.style.display = "flex";
  head.style.alignItems = "center";
  head.style.justifyContent = "space-between";
  head.style.gap = "8px";

  const title = document.createElement("span");
  title.innerHTML =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 20l4-1L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4z"></path></svg>' +
    "<span>" + (variants.length > 1 ? "Re-phrase — choose one" : "Re-phrase") + "</span>";
  title.style.display = "inline-flex";
  title.style.alignItems = "center";
  title.style.gap = "7px";
  title.style.fontWeight = "700";
  title.style.fontSize = "12px";
  title.style.color = "#f5ae3a";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true" focusable="false" style="display:block"><path d="M6 6L18 18" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path><path d="M18 6L6 18" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path></svg>';
  closeBtn.setAttribute("aria-label", "Discard");
  closeBtn.style.fontFamily = "inherit";
  closeBtn.style.cursor = "pointer";
  closeBtn.style.border = "none";
  closeBtn.style.background = "transparent";
  closeBtn.style.color = "#9a8f83";
  closeBtn.style.display = "inline-flex";
  closeBtn.style.alignItems = "center";
  closeBtn.style.justifyContent = "center";
  closeBtn.style.padding = "4px";
  closeBtn.style.borderRadius = "8px";

  head.appendChild(title);
  head.appendChild(closeBtn);
  card.appendChild(head);

  const list = document.createElement("div");
  list.style.display = "flex";
  list.style.flexDirection = "column";
  list.style.gap = "6px";
  list.style.overflowY = "auto";
  card.appendChild(list);

  const tokens = Number(tokenCount) > 0 ? Number(tokenCount) : 0;
  if (tokens > 0) {
    const foot = document.createElement("div");
    foot.textContent = `This request: ≈ ${tokens.toLocaleString()} tokens`;
    foot.style.color = "#9a8f83";
    foot.style.fontSize = "11px";
    foot.style.fontWeight = "500";
    card.appendChild(foot);
  }

  let closed = false;
  const cleanup = () => {
    if (closed) {
      return;
    }
    closed = true;
    forgetSelection();
    if (window.__askBetterPhraseChooserCleanup === cleanup) {
      window.__askBetterPhraseChooserCleanup = null;
    }
    document.removeEventListener("keydown", onKeydown, true);
    document.removeEventListener("pointerdown", onOutside, true);
    card.remove();
  };

  const onKeydown = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      cleanup();
    }
  };
  const onOutside = (event) => {
    if (!card.contains(event.target)) {
      cleanup();
    }
  };

  const confirmApplied = () => {
    // Collapse the full-width chooser into a small, sleek "Applied" pill that sits
    // right where the chooser was (near the selected text), rather than a big card.
    card.textContent = "";
    card.style.width = "auto";
    card.style.maxWidth = "min(240px, calc(100vw - 24px))";
    card.style.maxHeight = "none";
    card.style.padding = "7px 12px";
    card.style.gap = "6px";
    const done = document.createElement("div");
    done.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true" focusable="false" style="display:block"><path d="M5 12.5L10 17L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg><span>Applied</span>';
    done.style.display = "inline-flex";
    done.style.alignItems = "center";
    done.style.gap = "6px";
    done.style.color = "#7ee0a1";
    done.style.fontWeight = "600";
    done.style.fontSize = "12px";
    card.appendChild(done);

    // Re-clamp the shrunken pill so it stays on-screen next to the anchor.
    const rect = card.getBoundingClientRect();
    const pillWidth = Math.max(90, Math.round(rect.width || 120));
    if (anchorRect) {
      card.style.left = `${Math.min(Math.max(anchorRect.left, 8), Math.max(8, window.innerWidth - pillWidth - 8))}px`;
    }

    window.setTimeout(cleanup, 700);
  };

  variants.forEach((variant, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.alignItems = "flex-start";
    row.style.textAlign = "left";
    row.style.width = "100%";
    row.style.cursor = "pointer";
    row.style.padding = "12px 13px";
    row.style.borderRadius = "8px";
    row.style.border = "1px solid rgba(255, 255, 255, 0.10)";
    row.style.background = "rgba(255, 255, 255, 0.04)";
    row.style.color = "#f4f0eb";
    row.style.lineHeight = "1.6";
    row.style.font = FONT;
    row.addEventListener("mouseenter", () => {
      row.style.background = "rgba(232, 153, 30, 0.16)";
      row.style.borderColor = "rgba(232, 153, 30, 0.6)";
    });
    row.addEventListener("mouseleave", () => {
      row.style.background = "rgba(255, 255, 255, 0.04)";
      row.style.borderColor = "rgba(255, 255, 255, 0.10)";
    });

    if (variants.length > 1) {
      const badge = document.createElement("span");
      badge.textContent = String(index + 1);
      badge.style.flex = "0 0 auto";
      badge.style.minWidth = "18px";
      badge.style.height = "18px";
      badge.style.display = "inline-flex";
      badge.style.alignItems = "center";
      badge.style.justifyContent = "center";
      badge.style.borderRadius = "5px";
      badge.style.background = "rgba(232, 153, 30, 0.16)";
      badge.style.color = "#f5ae3a";
      badge.style.fontSize = "11px";
      badge.style.fontWeight = "700";
      row.appendChild(badge);
    }

    const text = document.createElement("span");
    text.textContent = variant;
    text.style.whiteSpace = "pre-wrap";
    text.style.wordBreak = "break-word";
    row.appendChild(text);

    row.addEventListener("click", () => {
      if (applyText(variant)) {
        confirmApplied();
      } else {
        cleanup();
      }
    });

    list.appendChild(row);
  });

  closeBtn.addEventListener("click", cleanup);
  window.__askBetterPhraseChooserCleanup = cleanup;

  document.documentElement.appendChild(card);

  // Position near the captured selection, clamped to the viewport.
  const cardRect = card.getBoundingClientRect();
  const width = Math.max(280, Math.round(cardRect.width || 360));
  const height = Math.max(120, Math.round(cardRect.height || 200));
  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

  let top;
  if (anchorRect && (anchorRect.width > 0 || anchorRect.height > 0)) {
    const above = anchorRect.top - height - 10;
    top = above >= 8 ? above : clamp(anchorRect.bottom + 10, 8, window.innerHeight - height - 8);
  } else {
    top = clamp(window.innerHeight - height - 24, 8, window.innerHeight - height - 8);
  }
  const left = anchorRect
    ? clamp(anchorRect.left, 8, window.innerWidth - width - 8)
    : clamp(window.innerWidth - width - 24, 8, window.innerWidth - width - 8);

  card.style.top = `${top}px`;
  card.style.left = `${left}px`;

  window.setTimeout(() => {
    document.addEventListener("keydown", onKeydown, true);
    document.addEventListener("pointerdown", onOutside, true);
  }, 0);

  return { ok: true };
}

function showPageToastOnPage(message) {
  const toastId = "askbetter-page-toast";
  const existing = document.getElementById(toastId);
  if (existing) {
    existing.remove();
  }

  try {
    const fontStyleId = "askbetter-dm-sans-font";
    if (!document.getElementById(fontStyleId)) {
      const fontUrl = (weight) => chrome.runtime.getURL("ui/fonts/dm-sans-" + weight + ".woff2");
      const fontStyle = document.createElement("style");
      fontStyle.id = fontStyleId;
      fontStyle.textContent =
        [400, 500, 600, 700]
          .map((weight) => "@font-face{font-family:'DM Sans';font-style:normal;font-weight:" + weight +
            ";font-display:swap;src:url('" + fontUrl(weight) + "') format('woff2');}")
          .join("");
      (document.head || document.documentElement).appendChild(fontStyle);
    }
  } catch (_fontError) {
    /* ignore */
  }

  const toast = document.createElement("div");
  toast.id = toastId;
  toast.textContent = String(message || "");
  toast.style.position = "fixed";
  toast.style.left = "50%";
  toast.style.bottom = "24px";
  toast.style.transform = "translateX(-50%)";
  toast.style.zIndex = "2147483647";
  toast.style.padding = "10px 14px";
  toast.style.borderRadius = "12px";
  toast.style.border = "1px solid rgba(255, 255, 255, 0.12)";
  toast.style.background = "rgba(30, 30, 30, 0.96)";
  toast.style.color = "#ffffff";
  toast.style.font = '500 12px/1.3 "DM Sans", "Google Sans Text", "Google Sans", "Segoe UI", Arial, sans-serif';
  toast.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.35)";
  toast.style.pointerEvents = "none";
  toast.style.opacity = "0";
  toast.style.transition = "opacity 120ms ease, transform 120ms ease";

  document.documentElement.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateX(-50%) translateY(0)";
  });

  window.setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(8px)";
    window.setTimeout(() => toast.remove(), 180);
  }, 1800);
}

function showPageBusyIndicatorOnPage(message, nonce) {
  // Per-request id, so an overlapping request's hide call cannot remove this pill.
  const indicatorId = "askbetter-page-busy-" + String(nonce || "");

  try {
    const fontStyleId = "askbetter-dm-sans-font";
    if (!document.getElementById(fontStyleId)) {
      const fontUrl = (weight) => chrome.runtime.getURL("ui/fonts/dm-sans-" + weight + ".woff2");
      const fontStyle = document.createElement("style");
      fontStyle.id = fontStyleId;
      fontStyle.textContent =
        [400, 500, 600, 700]
          .map((weight) => "@font-face{font-family:'DM Sans';font-style:normal;font-weight:" + weight +
            ";font-display:swap;src:url('" + fontUrl(weight) + "') format('woff2');}")
          .join("");
      (document.head || document.documentElement).appendChild(fontStyle);
    }
  } catch (_fontError) {
    /* ignore */
  }

  let indicator = document.getElementById(indicatorId);
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.id = indicatorId;
    indicator.style.position = "fixed";
    indicator.style.zIndex = "2147483647";
    indicator.style.display = "inline-flex";
    indicator.style.alignItems = "center";
    indicator.style.gap = "6px";
    indicator.style.minHeight = "26px";
    indicator.style.padding = "5px 11px";
    indicator.style.borderRadius = "999px";
    indicator.style.border = "1px solid rgba(255, 255, 255, 0.12)";
    indicator.style.background = "rgba(20, 20, 20, 0.96)";
    indicator.style.color = "#ffffff";
    indicator.style.font = '500 12.5px/1.2 "DM Sans", "Google Sans Text", "Google Sans", "Segoe UI", Arial, sans-serif';
    indicator.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.32)";
    indicator.style.pointerEvents = "none";
    indicator.innerHTML = `
      <span style="width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" style="width:14px;height:14px;display:block;animation:askbetter-page-busy-spin 900ms linear infinite;">
          <circle cx="12" cy="12" r="8.5" fill="none" stroke="rgba(245,245,245,0.22)" stroke-width="3" stroke-linecap="round" stroke-dasharray="20 34"></circle>
          <circle cx="12" cy="3.5" r="2" fill="#ff6a1a"></circle>
          <circle cx="20.5" cy="12" r="2" fill="#ff6a1a" opacity="0.92"></circle>
          <circle cx="12" cy="20.5" r="2" fill="#ff6a1a" opacity="0.72"></circle>
          <circle cx="3.5" cy="12" r="2" fill="#ff6a1a" opacity="0.48"></circle>
        </svg>
      </span>
      <span data-askbetter-busy-text></span>
    `;
    document.documentElement.appendChild(indicator);
  }

  let styleTag = document.getElementById("askbetter-page-busy-style");
  if (!styleTag) {
    styleTag = document.createElement("style");
    styleTag.id = "askbetter-page-busy-style";
    styleTag.textContent = "@keyframes askbetter-page-busy-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }";
    document.documentElement.appendChild(styleTag);
  }

  const textEl = indicator.querySelector("[data-askbetter-busy-text]");
  if (textEl) {
    textEl.textContent = String(message || "Working…");
  }

  const placement = (() => {
    const active = document.activeElement;
    const isTextInput = active instanceof HTMLTextAreaElement
      || (active instanceof HTMLInputElement && /^(text|search|url|email|tel|password)$/i.test(active.type || "text"));
    if (isTextInput) {
      return active.getBoundingClientRect();
    }

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect && (rect.width > 0 || rect.height > 0)) {
        return rect;
      }
    }
    return null;
  })();

  const indicatorRect = indicator.getBoundingClientRect();
  const width = Math.max(170, Math.round(indicatorRect.width || 184));
  const height = Math.max(30, Math.round(indicatorRect.height || 34));
  const top = placement
    ? Math.min(Math.max(placement.top - height - 10, 8), Math.max(8, window.innerHeight - height - 8))
    : 24;
  const left = placement
    ? Math.min(Math.max(placement.left, 8), Math.max(8, window.innerWidth - width - 8))
    : Math.max(8, window.innerWidth - width - 24);

  indicator.style.top = `${top}px`;
  indicator.style.left = `${left}px`;
}

function hidePageBusyIndicatorOnPage(nonce) {
  // Only remove this request's pill; a concurrent Phrase Better run owns its own.
  const indicator = document.getElementById("askbetter-page-busy-" + String(nonce || ""));
  if (indicator) {
    indicator.remove();
  }
}

async function readUiPrefs() {
  const stored = await chrome.storage.local.get(["uiPrefs"]);
  const raw = stored.uiPrefs || {};
  const buttonOffsets = raw.buttonOffsets || {};
  return {
    buttonOffsets: {
      chatgpt: normalizeOffset(buttonOffsets.chatgpt),
      gemini: normalizeOffset(buttonOffsets.gemini),
      claude: normalizeOffset(buttonOffsets.claude)
    }
  };
}

async function getButtonOffset(site) {
  const uiPrefs = await readUiPrefs();
  return uiPrefs.buttonOffsets[site] || { x: 0, y: 0 };
}

async function saveButtonOffset(site, offset) {
  return await enqueueStorageWrite(async () => {
    const uiPrefs = await readUiPrefs();
    uiPrefs.buttonOffsets[site] = normalizeOffset(offset);
    await chrome.storage.local.set({ uiPrefs });
    return uiPrefs.buttonOffsets[site];
  });
}

function normalizeSite(value) {
  const site = String(value || "").toLowerCase();
  if (site === "gemini" || site === "claude") {
    return site;
  }
  return "chatgpt";
}

function normalizeOffset(rawOffset) {
  const x = Number(rawOffset && rawOffset.x);
  const y = Number(rawOffset && rawOffset.y);
  return {
    x: clampOffsetNumber(x),
    y: clampOffsetNumber(y)
  };
}

function clampOffsetNumber(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value > 900) {
    return 900;
  }
  if (value < -900) {
    return -900;
  }
  return Math.round(value);
}
