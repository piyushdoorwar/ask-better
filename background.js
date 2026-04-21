const DEFAULT_SETTINGS = {
  provider: "gemini",
  geminiApiKey: "",
  geminiModel: "gemini-3-flash-preview",
  geminiKeyVerified: false,
  openaiApiKey: "",
  openaiModel: "gpt-5.2",
  openaiKeyVerified: false,
  anthropicApiKey: "",
  anthropicModel: "claude-sonnet-4-20250514",
  anthropicKeyVerified: false,
  defaultPreset: "structured",
  enableChatGPT: true,
  enableGemini: true,
  enableAskBetterMode: true,
  enablePhraseBetterMode: true,
  enableAI: true,
  keepUserVoice: false,
  keyVerified: false,
  customPromptAdditions: ""
};

const PHRASE_BETTER_CONTEXT_MENU_ID = "askbetter-phrase-better";
let phraseBetterMenuSyncToken = 0;

const DEFAULT_UI_PREFS = {
  buttonOffsets: {
    chatgpt: { x: 0, y: 0 },
    gemini: { x: 0, y: 0 }
  }
};

const PRESET_INSTRUCTIONS = {
  grammar: "Fix grammar and spelling with minimal rewrites. Preserve meaning.",
  clarity: "Improve clarity while preserving intent, requirements, and details.",
  concise: "Make it concise without losing requirements, constraints, or key context.",
  structured:
    "Rewrite into a story-like, high-context prompt in 2-3 strong paragraphs. Keep all requirements and constraints, but never use section labels such as Context, Task, Constraints, Output Format, or Questions unless the user explicitly asks for labeled sections.",
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
  const preset = mode === "phrase_better" ? "grammar" : normalizePreset(message.preset);
  const site = normalizeSite(message.site);
  const settings = await readSettings();
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

    return { ok: true, optimizedPrompt };
  } catch (error) {
    return mapProviderError(error);
  }
}

async function callProvider({ provider, apiKey, model, prompt, preset, settings, mode, completionPass }) {
  if (provider === "openai") {
    return await callOpenAI({ apiKey, model, prompt, preset, settings, mode, completionPass });
  }
  if (provider === "anthropic") {
    return await callAnthropic({ apiKey, model, prompt, preset, settings, mode, completionPass });
  }
  return await callGemini({ apiKey, model, prompt, preset, settings, mode, completionPass });
}

async function callGemini({ apiKey, model, prompt, preset, settings, mode, completionPass }) {
  const systemText = buildSystemInstruction({ preset, settings, mode, completionPass });

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

async function callOpenAI({ apiKey, model, prompt, preset, settings, mode, completionPass }) {
  const instructions = buildSystemInstruction({ preset, settings, mode, completionPass });
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

async function callAnthropic({ apiKey, model, prompt, preset, settings, mode, completionPass }) {
  const system = buildSystemInstruction({ preset, settings, mode, completionPass });
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
    .filter(Boolean)
    .sort()
    .reverse();
  return { ok: true, models: ids.length ? ids : DEFAULT_SETTINGS.geminiModel ? [DEFAULT_SETTINGS.geminiModel] : [] };
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
  const ids = items
    .map((m) => String(m.id || ""))
    .filter((id) => /^gpt-/i.test(id))
    .sort()
    .reverse();
  return { ok: true, models: ids.length ? ids : DEFAULT_SETTINGS.openaiModel ? [DEFAULT_SETTINGS.openaiModel] : [] };
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
  const ids = items
    .map((m) => String(m.id || ""))
    .filter(Boolean)
    .sort()
    .reverse();
  return { ok: true, models: ids.length ? ids : DEFAULT_SETTINGS.anthropicModel ? [DEFAULT_SETTINGS.anthropicModel] : [] };
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

function buildSystemInstruction({ preset, settings, mode, completionPass }) {
  if (mode === "phrase_better") {
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

  const instruction = PRESET_INSTRUCTIONS[preset] || PRESET_INSTRUCTIONS.structured;
  const customGuidance = String(settings && settings.customPromptAdditions ? settings.customPromptAdditions : "").trim();
  const keepUserVoice = !!(settings && settings.keepUserVoice);
  const parts = [
    "You rewrite prompts for end users.",
    "Return only one rewritten prompt as plain text.",
    "Do not include commentary, markdown fences, or explanations.",
    "Preserve all critical requirements and constraints from the original prompt.",
    "The rewritten prompt must be complete and end with a complete sentence.",
    `Preset behavior: ${instruction}`
  ];

  if (preset === "structured") {
    parts.push(
      "For structured preset, write in 2-3 cohesive narrative paragraphs with natural flow, not bullet lists."
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
  return true;
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
    defaultPreset: normalizePreset(settings.defaultPreset),
    enableChatGPT: !!settings.enableChatGPT,
    enableGemini: !!settings.enableGemini,
    enableAskBetterMode: settings.enableAskBetterMode !== false,
    enablePhraseBetterMode: settings.enablePhraseBetterMode !== false,
    enableAI: !!settings.enableAI,
    keepUserVoice: !!settings.keepUserVoice,
    hasApiKey
  };
}

function normalizePreset(value) {
  const preset = String(value || "").toLowerCase();
  if (Object.prototype.hasOwnProperty.call(PRESET_INSTRUCTIONS, preset)) {
    return preset;
  }
  return DEFAULT_SETTINGS.defaultPreset;
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
    defaultPreset: normalizePreset(raw.defaultPreset),
    enableChatGPT: raw.enableChatGPT !== false,
    enableGemini: raw.enableGemini !== false,
    enableAskBetterMode: raw.enableAskBetterMode !== false,
    enablePhraseBetterMode: raw.enablePhraseBetterMode !== false,
    enableAI: raw.enableAI !== false,
    keepUserVoice: !!raw.keepUserVoice,
    keyVerified: !!raw.keyVerified,
    customPromptAdditions: String(raw.customPromptAdditions || "")
  };
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
  await showPageBusyIndicatorInTab(tab.id, info.frameId);
  let response;
  try {
    response = await rewriteText({
      prompt: selectedText,
      preset: "grammar",
      site: "chatgpt",
      settings,
      mode: "phrase_better"
    });
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

  const replaced = await replaceSelectedTextInTab(tab.id, info.frameId, response.optimizedPrompt);
  if (!replaced) {
    await showPageToastInTab(tab.id, info.frameId, "Phrase Better works in editable text fields.");
    return;
  }

  await showPageToastInTab(tab.id, info.frameId, "Phrase Better applied");
}

async function replaceSelectedTextInTab(tabId, frameId, nextText) {
  try {
    const results = await chrome.scripting.executeScript({
      target: {
        tabId,
        frameIds: typeof frameId === "number" ? [frameId] : undefined
      },
      func: replaceSelectedTextOnPage,
      args: [String(nextText || "")]
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

function replaceSelectedTextOnPage(nextText) {
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

  const active = document.activeElement;
  const isTextInput = active instanceof HTMLTextAreaElement
    || (active instanceof HTMLInputElement && /^(text|search|url|email|tel|password)$/i.test(active.type || "text"));

  if (isTextInput && typeof active.selectionStart === "number" && typeof active.selectionEnd === "number") {
    const start = active.selectionStart;
    const end = active.selectionEnd;
    if (end > start) {
      active.setRangeText(nextText, start, end, "end");
      dispatch(active, "input");
      dispatch(active, "change");
      return { ok: true, method: "input" };
    }
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return { ok: false, reason: "NO_SELECTION" };
  }

  const range = selection.getRangeAt(0);
  const anchorNode = range.commonAncestorContainer && range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer && range.commonAncestorContainer.parentElement;
  const editableRoot = anchorNode && anchorNode.closest
    ? anchorNode.closest("[contenteditable='true'], [contenteditable='plaintext-only']")
    : null;

  if (!editableRoot) {
    return { ok: false, reason: "UNEDITABLE_SELECTION" };
  }

  range.deleteContents();
  const textNode = document.createTextNode(nextText);
  range.insertNode(textNode);

  selection.removeAllRanges();
  const nextRange = document.createRange();
  nextRange.setStartAfter(textNode);
  nextRange.collapse(true);
  selection.addRange(nextRange);

  dispatch(editableRoot, "input");
  dispatch(editableRoot, "change");
  return { ok: true, method: "contenteditable" };
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
      gemini: normalizeOffset(buttonOffsets.gemini)
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
  return String(value || "").toLowerCase() === "gemini" ? "gemini" : "chatgpt";
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
