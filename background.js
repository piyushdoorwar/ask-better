const DEFAULT_SETTINGS = {
  provider: "gemini",
  geminiApiKey: "",
  geminiModel: "gemini-3-flash-preview",
  geminiKeyVerified: false,
  openaiApiKey: "",
  openaiModel: "gpt-5.2",
  openaiKeyVerified: false,
  anthropicApiKey: "",
  anthropicModel: "claude-sonnet-4-6",
  anthropicKeyVerified: false,
  defaultPreset: "structured",
  enableChatGPT: true,
  enableGemini: true,
  enableClaude: true,
  enableAskBetterMode: true,
  enablePhraseBetterMode: true,
  phraseBetterOptionCount: 2,
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

async function recordUsage(entry) {
  try {
    const now = Date.now();
    const stored = await chrome.storage.local.get([USAGE_LOG_KEY]);
    const log = Array.isArray(stored[USAGE_LOG_KEY]) ? stored[USAGE_LOG_KEY] : [];
    log.push({
      ts: now,
      provider: String((entry && entry.provider) || ""),
      model: String((entry && entry.model) || ""),
      mode: entry && entry.mode === "phrase_better" ? "phrase_better" : "ask_better"
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

async function optimizePrompt(message) {
  const rawPrompt = typeof message.prompt === "string" ? message.prompt : "";
  const prompt = rawPrompt.trim();
  const mode = normalizeOptimizationMode(message.mode);
  const settings = await readSettings();
  const preset = mode === "phrase_better" ? "grammar" : normalizePreset(message.preset, settings);
  const site = normalizeSite(message.site);
  return await rewriteText({ prompt, preset, site, settings, mode });
}

async function rewriteText({ prompt, preset, site, settings, mode }) {
  const apiKey = getApiKeyForProvider(settings);
  const model = getModelForProvider(settings);
  const provider = normalizeProvider(settings.provider);

  if (!prompt) {
    return { ok: false, code: "EMPTY_PROMPT", message: "Prompt is empty." };
  }

  const askBetterEnabled = settings.enableAskBetterMode !== false;
  const phraseBetterEnabled = settings.enablePhraseBetterMode !== false;
  const isModeEnabled = mode === "phrase_better" ? phraseBetterEnabled : askBetterEnabled;
  const isAllowedOnSurface = mode === "phrase_better" ? true : isSiteEnabled(settings, site);

  if (!settings.enableAI || !isModeEnabled || !isAllowedOnSurface || !apiKey) {
    return {
      ok: false,
      code: "DISABLED_OR_MISSING_KEY",
      message: "AI disabled or key missing"
    };
  }

  try {
    let optimizedPrompt = await callProvider({ provider, apiKey, model, prompt, preset, settings, mode });

    if (isLikelyIncompleteOutput(optimizedPrompt)) {
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
      if (retry && retry.trim()) {
        optimizedPrompt = retry;
      }
    }

    if (!optimizedPrompt) {
      return {
        ok: false,
        code: "EMPTY_MODEL_OUTPUT",
        message: "Model returned an empty response."
      };
    }

    await recordUsage({ provider, model, mode });
    return { ok: true, optimizedPrompt };
  } catch (error) {
    return mapProviderError(error);
  }
}

async function callProvider({ provider, apiKey, model, prompt, preset, settings, mode, completionPass, variantCount }) {
  if (provider === "openai") {
    return await callOpenAI({ apiKey, model, prompt, preset, settings, mode, completionPass, variantCount });
  }
  if (provider === "anthropic") {
    return await callAnthropic({ apiKey, model, prompt, preset, settings, mode, completionPass, variantCount });
  }
  return await callGemini({ apiKey, model, prompt, preset, settings, mode, completionPass, variantCount });
}

async function callGemini({ apiKey, model, prompt, preset, settings, mode, completionPass, variantCount }) {
  const systemText = buildSystemInstruction({ preset, settings, mode, completionPass, variantCount });

  const normalizedModel = normalizeGeminiModel(model || DEFAULT_SETTINGS.geminiModel);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(normalizedModel)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemText }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1200
        }
      })
    }
  );

  if (!response.ok) {
    let details = "";
    try {
      const body = await response.json();
      details = readApiErrorMessage(body);
    } catch (_error) {
      details = "";
    }
    const error = new Error(details || `Provider request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return extractGeminiText(data).trim();
}

async function callOpenAI({ apiKey, model, prompt, preset, settings, mode, completionPass, variantCount }) {
  const instructions = buildSystemInstruction({ preset, settings, mode, completionPass, variantCount });
  const normalizedModel = normalizeOpenAIModel(model || DEFAULT_SETTINGS.openaiModel);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: normalizedModel,
      input: prompt,
      instructions,
      max_output_tokens: 1200
    })
  });

  if (!response.ok) {
    let details = "";
    try {
      const body = await response.json();
      details = readApiErrorMessage(body);
    } catch (_error) {
      details = "";
    }
    const error = new Error(details || `Provider request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return extractOpenAIText(data).trim();
}

async function callAnthropic({ apiKey, model, prompt, preset, settings, mode, completionPass, variantCount }) {
  const system = buildSystemInstruction({ preset, settings, mode, completionPass, variantCount });
  const normalizedModel = normalizeAnthropicModel(model || DEFAULT_SETTINGS.anthropicModel);
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "x-api-key": apiKey
    },
    body: JSON.stringify({
      model: normalizedModel,
      system,
      max_tokens: 1200,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    let details = "";
    try {
      const body = await response.json();
      details = readApiErrorMessage(body);
    } catch (_error) {
      details = "";
    }
    const error = new Error(details || `Provider request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return extractAnthropicText(data).trim();
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
const MODEL_DATED_SNAPSHOT = /-\d{4}(-\d{2}-\d{2})?$/; // gpt-4o-2024-08-06, gpt-4-0613
const GEMINI_DATED_PREVIEW = /-\d{2}-\d{2}$/; // gemini-2.5-flash-preview-05-20
const MODEL_FETCH_LIMIT = 12;

function isMainGeminiModel(id) {
  const s = String(id || "").toLowerCase();
  if (!s.startsWith("gemini-")) return false; // drop gemma / learnlm / imagen / veo / aqa
  if (/(embedding|aqa|imagen|veo|vision|tuning|thinking)/.test(s)) return false;
  if (/(^|-)exp(-|$)/.test(s)) return false;
  if (GEMINI_DATED_PREVIEW.test(s)) return false;
  return true;
}

function isMainOpenAIModel(id) {
  const s = String(id || "").toLowerCase();
  if (!/^gpt-/.test(s) && !/^o\d/.test(s)) return false;
  if (/(audio|realtime|transcribe|tts|search|image|embedding|moderation|instruct|vision|-16k|chat-latest)/.test(s)) return false;
  if (MODEL_DATED_SNAPSHOT.test(s)) return false;
  return true;
}

async function fetchGeminiModels(apiKey) {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
    method: "GET",
    headers: { "x-goog-api-key": apiKey }
  });
  if (!response.ok) {
    const error = new Error(`Provider request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  const all = Array.isArray(data.models) ? data.models : [];
  const ids = all
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
    .map((m) => String(m.name || "").replace(/^models\//, ""))
    .filter(isMainGeminiModel)
    .sort()
    .reverse()
    .slice(0, MODEL_FETCH_LIMIT);
  return { ok: true, models: ids };
}

async function fetchOpenAIModels(apiKey) {
  const response = await fetch("https://api.openai.com/v1/models", {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  if (!response.ok) {
    const error = new Error(`Provider request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
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
  const response = await fetch("https://api.anthropic.com/v1/models", {
    method: "GET",
    headers: {
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "x-api-key": apiKey
    }
  });
  if (!response.ok) {
    const error = new Error(`Provider request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
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
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
      method: "GET",
      headers: {
        "x-goog-api-key": apiKey
      }
    });

    if (response.ok) {
      return { ok: true, message: "API key is valid." };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, code: "UNAUTHORIZED", message: `Invalid API key (${response.status}).` };
    }
    if (response.status === 429) {
      return { ok: false, code: "RATE_LIMIT", message: "Rate limit reached (429)." };
    }
    return {
      ok: false,
      code: "PROVIDER_ERROR",
      message: `Provider error (${response.status}).`
    };
  } catch (_error) {
    return { ok: false, code: "NETWORK_ERROR", message: "Network error while testing key." };
  }
}

async function testOpenAIKey(apiKey) {
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    if (response.ok) {
      return { ok: true, message: "API key is valid." };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, code: "UNAUTHORIZED", message: `Invalid API key (${response.status}).` };
    }
    if (response.status === 429) {
      return { ok: false, code: "RATE_LIMIT", message: "Rate limit reached (429)." };
    }
    return {
      ok: false,
      code: "PROVIDER_ERROR",
      message: `Provider error (${response.status}).`
    };
  } catch (_error) {
    return { ok: false, code: "NETWORK_ERROR", message: "Network error while testing key." };
  }
}

async function testAnthropicKey(apiKey) {
  try {
    const response = await fetch("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: {
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "x-api-key": apiKey
      }
    });

    if (response.ok) {
      return { ok: true, message: "API key is valid." };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, code: "UNAUTHORIZED", message: `Invalid API key (${response.status}).` };
    }
    if (response.status === 429) {
      return { ok: false, code: "RATE_LIMIT", message: "Rate limit reached (429)." };
    }
    return {
      ok: false,
      code: "PROVIDER_ERROR",
      message: `Provider error (${response.status}).`
    };
  } catch (_error) {
    return { ok: false, code: "NETWORK_ERROR", message: "Network error while testing key." };
  }
}

function extractGeminiText(data) {
  if (!data || !Array.isArray(data.candidates) || data.candidates.length === 0) {
    return "";
  }
  const candidate = data.candidates[0];
  if (!candidate || !candidate.content || !Array.isArray(candidate.content.parts)) {
    return "";
  }
  return candidate.content.parts
    .map((part) => (part && typeof part.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
}

function extractOpenAIText(data) {
  if (data && typeof data.output_text === "string") {
    return data.output_text;
  }
  if (!data || !Array.isArray(data.output)) {
    return "";
  }
  return data.output
    .flatMap((item) => Array.isArray(item && item.content) ? item.content : [])
    .map((item) => (item && typeof item.text === "string" ? item.text : ""))
    .join("\n")
    .trim();
}

function extractAnthropicText(data) {
  if (!data || !Array.isArray(data.content)) {
    return "";
  }
  return data.content
    .map((item) => (item && item.type === "text" && typeof item.text === "string" ? item.text : ""))
    .join("\n")
    .trim();
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

    if (count > 1) {
      return [
        `You improve user-selected text with minimal edits and provide ${count} alternative corrected versions.`,
        `Return exactly ${count} variants and nothing else.`,
        "Put each variant on its own line, prefixed with its number and a period, like '1. ', '2. '.",
        "Do not add any other commentary, labels, markdown, bullets, headings, or explanations.",
        "Each variant must fix grammar, spelling, punctuation, and obvious wording issues.",
        "Each variant must preserve the original meaning and tone and stay close to the original length.",
        "Make the variants meaningfully distinct from each other in phrasing.",
        "Do not add new claims, examples, or instructions that were not present in the original."
      ].join(" ");
    }

    const parts = [
      "You improve user-selected text with minimal edits.",
      "Return only the corrected text as plain text.",
      "Do not add commentary, labels, markdown, bullets, or explanations.",
      "Fix grammar, spelling, punctuation, and obvious wording issues.",
      "Preserve the original meaning, tone, wording, sentence order, and formatting as much as possible.",
      "Make the smallest number of edits needed for the text to read cleanly and correctly.",
      "Do not add new claims, examples, or instructions that were not present in the original."
    ];

    if (completionPass) {
      parts.push("Previous output looked incomplete. Return the full corrected text from the original selection.");
    }

    return parts.join(" ");
  }

  const instruction = getPresetInstruction(preset, settings);
  const customGuidance = String(settings && settings.customPromptAdditions ? settings.customPromptAdditions : "").trim();
  const keepUserVoice = !!(settings && settings.keepUserVoice);
  const parts = [
    "You rewrite prompts for end users.",
    "Return only one rewritten prompt as plain text.",
    "Do not include commentary, markdown fences, or explanations.",
    "Preserve all critical requirements and constraints from the original prompt.",
    "Do not invent concrete details the user did not provide — no specific facts, names, numbers, dates, audiences, tools, or domain requirements. When a detail is missing, keep it general instead of fabricating it.",
    "Keep the rewrite proportional to the input: a short, simple, or vague prompt must produce a short rewrite. Never pad length for its own sake.",
    "The rewritten prompt must be complete and end with a complete sentence.",
    `Preset behavior: ${instruction}`
  ];

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

function isLikelyIncompleteOutput(text) {
  const value = String(text || "").trim();
  if (!value) {
    return true;
  }
  if (value.length < 60) {
    return false;
  }
  if (/[.!?]["')\]]?$/.test(value)) {
    return false;
  }
  if (/[,;:\-–—]$/.test(value)) {
    return true;
  }
  const lastWord = value.split(/\s+/).pop().toLowerCase();
  const danglingWords = new Set([
    "and",
    "or",
    "to",
    "for",
    "with",
    "that",
    "which",
    "because",
    "while",
    "when",
    "if",
    "of",
    "in",
    "on",
    "at",
    "by",
    "from",
    "as",
    "than",
    "then",
    "about"
  ]);
  if (danglingWords.has(lastWord)) {
    return true;
  }
  return false;
}

function mapProviderError(error) {
  const status = Number(error && error.status);
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
    enableChatGPT: !!settings.enableChatGPT,
    enableGemini: !!settings.enableGemini,
    enableClaude: !!settings.enableClaude,
    enableAskBetterMode: settings.enableAskBetterMode !== false,
    enablePhraseBetterMode: settings.enablePhraseBetterMode !== false,
    phraseBetterOptionCount: normalizePhraseBetterOptionCount(settings.phraseBetterOptionCount),
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

function normalizeOptimizationMode(value) {
  return String(value || "").toLowerCase() === "phrase_better" ? "phrase_better" : "ask_better";
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
    enableChatGPT: raw.enableChatGPT !== false,
    enableGemini: raw.enableGemini !== false,
    enableClaude: raw.enableClaude !== false,
    enableAskBetterMode: raw.enableAskBetterMode !== false,
    enablePhraseBetterMode: raw.enablePhraseBetterMode !== false,
    phraseBetterOptionCount: normalizePhraseBetterOptionCount(raw.phraseBetterOptionCount),
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
  const captured = await capturePhraseBetterSelectionInTab(tab.id, info.frameId);
  if (!captured) {
    await showPageToastInTab(tab.id, info.frameId, "Phrase Better works in editable text fields.");
    return;
  }

  await showPageBusyIndicatorInTab(tab.id, info.frameId);
  let response;
  try {
    response = await generatePhraseBetterOptions({ prompt: selectedText, settings, count });
  } finally {
    await hidePageBusyIndicatorInTab(tab.id, info.frameId);
  }

  if (!response || !response.ok) {
    const message = response && response.code === "DISABLED_OR_MISSING_KEY"
      ? "Phrase Better is off or the selected provider key is missing."
      : (response && response.message) || "Phrase Better failed.";
    await showPageToastInTab(tab.id, info.frameId, message);
    return;
  }

  const shown = await showPhraseBetterChooserInTab(tab.id, info.frameId, response.options);
  if (!shown) {
    await showPageToastInTab(tab.id, info.frameId, "Phrase Better works in editable text fields.");
  }
}

async function capturePhraseBetterSelectionInTab(tabId, frameId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: {
        tabId,
        frameIds: typeof frameId === "number" ? [frameId] : undefined
      },
      func: capturePhraseBetterSelectionOnPage
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
    if (variantCount <= 1) {
      const text = await callProvider({ provider, apiKey, model, prompt, preset: "grammar", settings, mode: "phrase_better" });
      const cleaned = String(text || "").trim();
      if (!cleaned) {
        return { ok: false, code: "EMPTY_MODEL_OUTPUT", message: "Model returned an empty response." };
      }
      await recordUsage({ provider, model, mode: "phrase_better" });
      return { ok: true, options: [cleaned] };
    }

    const raw = await callProvider({
      provider,
      apiKey,
      model,
      prompt,
      preset: "grammar",
      settings,
      mode: "phrase_better",
      variantCount
    });
    const options = parsePhraseVariants(raw, variantCount);
    if (!options.length) {
      return { ok: false, code: "EMPTY_MODEL_OUTPUT", message: "Model returned an empty response." };
    }
    await recordUsage({ provider, model, mode: "phrase_better" });
    return { ok: true, options };
  } catch (error) {
    return mapProviderError(error);
  }
}

function parsePhraseVariants(raw, count) {
  const text = String(raw || "").trim();
  if (!text) {
    return [];
  }
  const lines = text.split(/\r?\n+/).map((line) => line.trim()).filter(Boolean);
  const numbered = [];
  for (const line of lines) {
    const match = line.match(/^\(?\d+[.)]\s*(.+)$/);
    if (match && match[1].trim()) {
      numbered.push(match[1].trim());
    }
  }
  const candidates = numbered.length ? numbered : lines;

  const seen = new Set();
  const result = [];
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (candidate && !seen.has(key)) {
      seen.add(key);
      result.push(candidate);
    }
  }
  return result.slice(0, count);
}

async function showPhraseBetterChooserInTab(tabId, frameId, options) {
  try {
    const results = await chrome.scripting.executeScript({
      target: {
        tabId,
        frameIds: typeof frameId === "number" ? [frameId] : undefined
      },
      func: showPhraseBetterChooserOnPage,
      args: [Array.isArray(options) ? options.map((option) => String(option || "")) : []]
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

async function showPageBusyIndicatorInTab(tabId, frameId, message) {
  try {
    await chrome.scripting.executeScript({
      target: {
        tabId,
        frameIds: typeof frameId === "number" ? [frameId] : undefined
      },
      func: showPageBusyIndicatorOnPage,
      args: [String(message || "")]
    });
  } catch (_error) {
    // Ignore busy indicator injection errors on unsupported pages.
  }
}

async function hidePageBusyIndicatorInTab(tabId, frameId) {
  try {
    await chrome.scripting.executeScript({
      target: {
        tabId,
        frameIds: typeof frameId === "number" ? [frameId] : undefined
      },
      func: hidePageBusyIndicatorOnPage
    });
  } catch (_error) {
    // Ignore busy indicator cleanup errors on unsupported pages.
  }
}

function capturePhraseBetterSelectionOnPage() {
  // Store the current selection (location + live DOM references) on the page's
  // isolated-world global so a later executeScript call can apply to it, even if the
  // live selection is gone by then. The captured object keeps real DOM references; this
  // is fine because both executeScript calls share the same isolated world for the tab.
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

  window.__askBetterPhraseSelection = captured;
  return { ok: !!captured };
}

function showPhraseBetterChooserOnPage(options) {
  const chooserId = "askbetter-phrase-chooser";
  const existing = document.getElementById(chooserId);
  if (existing) {
    existing.remove();
  }

  const variants = Array.isArray(options) ? options.filter((option) => String(option || "").trim()) : [];
  if (!variants.length) {
    return { ok: false, reason: "NO_OPTIONS" };
  }

  // Prefer the selection captured at context-menu time (stored on the page global);
  // fall back to the live selection if it is still present and the stored one is gone.
  let captured = null;
  let anchorRect = null;

  const stored = window.__askBetterPhraseSelection || null;
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
    window.__askBetterPhraseSelection = null;
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
      try {
        el.focus({ preventScroll: true });
      } catch (_error) {
        // Ignore focus failures.
      }
      try {
        el.setRangeText(nextText, captured.start, captured.end, "end");
      } catch (_error) {
        const value = String(el.value || "");
        el.value = value.slice(0, captured.start) + nextText + value.slice(captured.end);
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
      const textNode = document.createTextNode(nextText);
      captured.range.insertNode(textNode);
      selection.removeAllRanges();
      const after = document.createRange();
      after.setStartAfter(textNode);
      after.collapse(true);
      selection.addRange(after);
      dispatch(captured.editableRoot, "input");
      dispatch(captured.editableRoot, "change");
      return true;
    } catch (_error) {
      return false;
    }
  };

  const FONT = '500 13px/1.4 "Google Sans Text", "Google Sans", "Segoe UI", Arial, sans-serif';
  const card = document.createElement("div");
  card.id = chooserId;
  card.style.position = "fixed";
  card.style.zIndex = "2147483003";
  card.style.boxSizing = "border-box";
  card.style.width = "min(420px, calc(100vw - 24px))";
  card.style.maxHeight = "min(60vh, 460px)";
  card.style.display = "flex";
  card.style.flexDirection = "column";
  card.style.gap = "8px";
  card.style.padding = "12px";
  card.style.borderRadius = "14px";
  card.style.border = "1px solid rgba(232, 153, 30, 0.5)";
  card.style.background = "rgba(22, 19, 16, 0.98)";
  card.style.color = "#f4f0eb";
  card.style.font = FONT;
  card.style.boxShadow = "0 18px 48px rgba(0, 0, 0, 0.55)";

  const head = document.createElement("div");
  head.style.display = "flex";
  head.style.alignItems = "center";
  head.style.justifyContent = "space-between";
  head.style.gap = "8px";

  const title = document.createElement("span");
  title.textContent = variants.length > 1 ? "Phrase Better — choose one" : "Phrase Better suggestion";
  title.style.fontWeight = "700";
  title.style.fontSize = "12px";
  title.style.color = "#f5ae3a";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true" focusable="false" style="display:block"><path d="M6 6L18 18" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path><path d="M18 6L6 18" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path></svg>';
  closeBtn.setAttribute("aria-label", "Discard");
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

  let closed = false;
  const cleanup = () => {
    if (closed) {
      return;
    }
    closed = true;
    window.__askBetterPhraseSelection = null;
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
    list.remove();
    head.remove();
    const done = document.createElement("div");
    done.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true" focusable="false" style="display:block"><path d="M5 12.5L10 17L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg><span>Applied</span>';
    done.style.display = "inline-flex";
    done.style.alignItems = "center";
    done.style.gap = "6px";
    done.style.padding = "4px 2px";
    done.style.color = "#7ee0a1";
    done.style.fontWeight = "600";
    card.appendChild(done);
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
    row.style.padding = "9px 10px";
    row.style.borderRadius = "10px";
    row.style.border = "1px solid rgba(255, 255, 255, 0.14)";
    row.style.background = "rgba(255, 255, 255, 0.05)";
    row.style.color = "#f4f0eb";
    row.style.font = FONT;
    row.addEventListener("mouseenter", () => {
      row.style.background = "rgba(232, 153, 30, 0.18)";
      row.style.borderColor = "rgba(232, 153, 30, 0.7)";
    });
    row.addEventListener("mouseleave", () => {
      row.style.background = "rgba(255, 255, 255, 0.05)";
      row.style.borderColor = "rgba(255, 255, 255, 0.14)";
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
      badge.style.borderRadius = "999px";
      badge.style.background = "rgba(232, 153, 30, 0.85)";
      badge.style.color = "#1a1100";
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
  toast.style.font = '500 12px/1.3 "Google Sans Text", "Google Sans", "Segoe UI", Arial, sans-serif';
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

function showPageBusyIndicatorOnPage(message) {
  const indicatorId = "askbetter-page-busy";
  let indicator = document.getElementById(indicatorId);
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.id = indicatorId;
    indicator.style.position = "fixed";
    indicator.style.zIndex = "2147483647";
    indicator.style.display = "inline-flex";
    indicator.style.alignItems = "center";
    indicator.style.gap = "8px";
    indicator.style.minHeight = "32px";
    indicator.style.padding = "7px 10px";
    indicator.style.borderRadius = "999px";
    indicator.style.border = "1px solid rgba(255, 255, 255, 0.12)";
    indicator.style.background = "rgba(20, 20, 20, 0.96)";
    indicator.style.color = "#ffffff";
    indicator.style.font = '500 12px/1.2 "Google Sans Text", "Google Sans", "Segoe UI", Arial, sans-serif';
    indicator.style.boxShadow = "0 10px 30px rgba(0, 0, 0, 0.36)";
    indicator.style.pointerEvents = "none";
    indicator.innerHTML = `
      <span style="width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" style="width:16px;height:16px;display:block;animation:askbetter-page-busy-spin 900ms linear infinite;">
          <circle cx="12" cy="12" r="8.5" fill="none" stroke="rgba(245,245,245,0.22)" stroke-width="3" stroke-linecap="round" stroke-dasharray="20 34"></circle>
          <circle cx="12" cy="3.5" r="2" fill="#ff6a1a"></circle>
          <circle cx="20.5" cy="12" r="2" fill="#ff6a1a" opacity="0.92"></circle>
          <circle cx="12" cy="20.5" r="2" fill="#ff6a1a" opacity="0.72"></circle>
          <circle cx="3.5" cy="12" r="2" fill="#ff6a1a" opacity="0.48"></circle>
        </svg>
      </span>
      <span id="askbetter-page-busy-text"></span>
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

  const textEl = indicator.querySelector("#askbetter-page-busy-text");
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

function hidePageBusyIndicatorOnPage() {
  const indicator = document.getElementById("askbetter-page-busy");
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
  const uiPrefs = await readUiPrefs();
  uiPrefs.buttonOffsets[site] = normalizeOffset(offset);
  await chrome.storage.local.set({ uiPrefs });
  return uiPrefs.buttonOffsets[site];
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
