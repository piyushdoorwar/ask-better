const DEFAULT_SETTINGS = {
  provider: "openai",
  openaiApiKey: "",
  geminiApiKey: "",
  openaiModel: "gpt-4.1-mini",
  geminiModel: "gemini-2.5-flash",
  openaiKeyVerified: false,
  geminiKeyVerified: false,
  defaultPreset: "structured",
  enableChatGPT: true,
  enableGemini: true,
  enableAI: true,
  analyticsOptIn: false,
  keepUserVoice: false,
  keyVerified: false,
  customPromptAdditions: ""
};

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
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
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
  const preset = normalizePreset(message.preset);
  const site = message.site === "gemini" ? "gemini" : "chatgpt";
  const settings = await readSettings();
  const provider = normalizeProvider(settings.provider);
  const apiKey = getApiKeyForProvider(settings, provider);
  const model = getModelForProvider(settings, provider);

  if (!prompt) {
    return { ok: false, code: "EMPTY_PROMPT", message: "Prompt is empty." };
  }

  if (!settings.enableAI || !isSiteEnabled(settings, site) || !apiKey) {
    return {
      ok: false,
      code: "DISABLED_OR_MISSING_KEY",
      message: "AI disabled or key missing"
    };
  }

  try {
    let optimizedPrompt = provider === "gemini"
      ? await callGemini({ apiKey, model, prompt, preset, settings })
      : await callOpenAI({ apiKey, model, prompt, preset, settings });

    if (isLikelyIncompleteOutput(optimizedPrompt)) {
      const retry = provider === "gemini"
        ? await callGemini({
          apiKey,
          model,
          prompt,
          preset,
          settings,
          completionPass: true
        })
        : await callOpenAI({
          apiKey,
          model,
          prompt,
          preset,
          settings,
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

    await maybeTrackUsage(settings);
    return { ok: true, optimizedPrompt };
  } catch (error) {
    return mapProviderError(error);
  }
}

async function callOpenAI({ apiKey, model, prompt, preset, settings, completionPass }) {
  const systemText = buildSystemInstruction({ preset, settings, completionPass });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || DEFAULT_SETTINGS.openaiModel,
      temperature: 0.1,
      max_output_tokens: 1200,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemText }]
        },
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }]
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
  return extractOpenAIText(data).trim();
}

async function callGemini({ apiKey, model, prompt, preset, settings, completionPass }) {
  const systemText = buildSystemInstruction({ preset, settings, completionPass });

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

async function testKey(payload) {
  const settings = await readSettings();
  const provider = normalizeProvider(payload.provider || settings.provider);
  const apiKey = String(payload.apiKey || getApiKeyForProvider(settings, provider) || "").trim();

  if (!apiKey) {
    return { ok: false, code: "MISSING_KEY", message: "API key is missing." };
  }

  if (provider === "gemini") {
    return await testGeminiKey(apiKey);
  }
  return await testOpenAIKey(apiKey);
}

async function testOpenAIKey(apiKey) {
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` }
    });

    if (response.ok) {
      return { ok: true, message: "API key is valid." };
    }
    if (response.status === 401) {
      return { ok: false, code: "UNAUTHORIZED", message: "Invalid API key (401)." };
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

function extractOpenAIText(data) {
  if (!data) {
    return "";
  }

  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  if (Array.isArray(data.output)) {
    const parts = [];
    for (const item of data.output) {
      if (!item || !Array.isArray(item.content)) {
        continue;
      }
      for (const contentItem of item.content) {
        if (!contentItem) {
          continue;
        }
        if (typeof contentItem.text === "string") {
          parts.push(contentItem.text);
        } else if (typeof contentItem.output_text === "string") {
          parts.push(contentItem.output_text);
        }
      }
    }
    return parts.join("\n").trim();
  }

  return "";
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

function readApiErrorMessage(body) {
  if (!body || typeof body !== "object") {
    return "";
  }
  if (body.error && typeof body.error.message === "string") {
    return body.error.message;
  }
  return "";
}

function buildSystemInstruction({ preset, settings, completionPass }) {
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

async function maybeTrackUsage(settings) {
  if (!settings.analyticsOptIn) {
    return;
  }
  const stored = await chrome.storage.local.get(["usageStats"]);
  const usage = stored.usageStats || {};
  const optimizeCount = Number(usage.optimizeCount || 0) + 1;
  await chrome.storage.local.set({
    usageStats: {
      optimizeCount,
      lastUsedAt: Date.now()
    }
  });
}

function toPublicSettings(settings) {
  const provider = normalizeProvider(settings.provider);
  const hasApiKey = !!getApiKeyForProvider(settings, provider);
  return {
    provider,
    openaiModel: settings.openaiModel,
    geminiModel: settings.geminiModel,
    activeModel: getModelForProvider(settings, provider),
    defaultPreset: normalizePreset(settings.defaultPreset),
    enableChatGPT: !!settings.enableChatGPT,
    enableGemini: !!settings.enableGemini,
    enableAI: !!settings.enableAI,
    keepUserVoice: !!settings.keepUserVoice,
    analyticsOptIn: !!settings.analyticsOptIn,
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

function normalizeProvider(value) {
  return String(value || "").toLowerCase() === "gemini" ? "gemini" : "openai";
}

function normalizeGeminiModel(model) {
  const raw = String(model || "").trim();
  if (!raw) {
    return DEFAULT_SETTINGS.geminiModel;
  }
  return raw.startsWith("models/") ? raw.slice(7) : raw;
}

function getApiKeyForProvider(settings, provider) {
  if (provider === "gemini") {
    return String(settings.geminiApiKey || "").trim();
  }
  return String(settings.openaiApiKey || "").trim();
}

function getModelForProvider(settings, provider) {
  if (provider === "gemini") {
    return normalizeGeminiModel(settings.geminiModel || DEFAULT_SETTINGS.geminiModel);
  }
  return String(settings.openaiModel || DEFAULT_SETTINGS.openaiModel).trim() || DEFAULT_SETTINGS.openaiModel;
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
    ...DEFAULT_SETTINGS,
    ...raw
  };
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
