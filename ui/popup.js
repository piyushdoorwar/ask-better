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

const OPENAI_KEY_URL = "https://platform.openai.com/api-keys";
const GEMINI_KEY_URL = "https://aistudio.google.com/apikey";
const OPENAI_MODELS = ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"];
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"];

const statusBox = document.getElementById("statusBox");
const statusText = document.getElementById("statusText");
const defaultPresetEl = document.getElementById("defaultPreset");
const openaiModelEl = document.getElementById("openaiModel");
const enableChatGPTEl = document.getElementById("enableChatGPT");
const enableGeminiEl = document.getElementById("enableGemini");
const openSettingsBtn = document.getElementById("openSettingsBtn");
const missingKeyLinkEl = document.getElementById("missingKeyLink");

init().catch(() => {
  statusText.textContent = "Unable to load settings.";
  statusText.className = "status-warn";
});

async function init() {
  const settings = await readSettings();
  renderStatus(settings);
  defaultPresetEl.value = normalizePreset(settings.defaultPreset);
  const provider = normalizeProvider(settings.provider);
  const model = getProviderModel(settings, provider);
  renderModelOptions(provider, model);
  enableChatGPTEl.checked = !!settings.enableChatGPT;
  enableGeminiEl.checked = !!settings.enableGemini;

  defaultPresetEl.addEventListener("change", async () => {
    await updateSettings({ defaultPreset: normalizePreset(defaultPresetEl.value) });
  });

  enableChatGPTEl.addEventListener("change", async () => {
    await updateSettings({ enableChatGPT: !!enableChatGPTEl.checked });
  });

  enableGeminiEl.addEventListener("change", async () => {
    await updateSettings({ enableGemini: !!enableGeminiEl.checked });
  });

  openaiModelEl.addEventListener("change", async () => {
    const current = await readSettings();
    const currentProvider = normalizeProvider(current.provider);
    const meta = getProviderMeta(currentProvider);
    await updateSettings({ [meta.modelField]: normalizeModel(openaiModelEl.value, meta.defaultModel) });
  });

  openSettingsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

function renderStatus(settings) {
  const provider = normalizeProvider(settings.provider);
  const meta = getProviderMeta(provider);
  const hasKey = !!String(settings[meta.keyField] || "").trim();

  if (missingKeyLinkEl) {
    missingKeyLinkEl.href = meta.keyUrl;
    missingKeyLinkEl.hidden = true;
  }
  if (statusBox) {
    statusBox.classList.remove("state-ok", "state-warn");
  }

  if (!settings.enableAI) {
    statusText.textContent = "AI disabled";
    statusText.className = "status-warn";
    if (statusBox) {
      statusBox.classList.add("state-warn");
    }
    return;
  }

  if (hasKey) {
    statusText.textContent = `${meta.providerName} key: Connected`;
    statusText.className = "status-ok";
    if (statusBox) {
      statusBox.classList.add("state-ok");
    }
    return;
  }

  statusText.textContent = `${meta.providerName} key: Missing`;
  statusText.className = "status-warn";
  if (statusBox) {
    statusBox.classList.add("state-warn");
  }
  if (missingKeyLinkEl) {
    missingKeyLinkEl.hidden = false;
  }
}

async function readSettings() {
  const stored = await chrome.storage.local.get(["settings"]);
  return {
    ...DEFAULT_SETTINGS,
    ...(stored.settings || {})
  };
}

async function updateSettings(partial) {
  const current = await readSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ settings: next });
}

function normalizePreset(value) {
  const preset = String(value || "").toLowerCase();
  const validPresets = new Set([
    "structured",
    "concise",
    "grammar",
    "clarity",
    "persuasive",
    "executive",
    "coaching",
    "email_rewrite",
    "devils_advocate",
    "first_principles",
    "risk_audit",
    "technical_spec",
    "implementation_plan"
  ]);
  if (validPresets.has(preset)) {
    return preset;
  }
  return DEFAULT_SETTINGS.defaultPreset;
}

function renderModelOptions(provider, selectedModel) {
  const meta = getProviderMeta(provider);
  openaiModelEl.textContent = "";
  for (const model of meta.models) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    openaiModelEl.appendChild(option);
  }
  if (!meta.models.includes(selectedModel)) {
    const option = document.createElement("option");
    option.value = selectedModel;
    option.textContent = `${selectedModel} (custom)`;
    openaiModelEl.appendChild(option);
  }
  openaiModelEl.value = selectedModel;
}

function getProviderMeta(provider) {
  if (provider === "gemini") {
    return {
      providerName: "Gemini",
      keyField: "geminiApiKey",
      modelField: "geminiModel",
      defaultModel: DEFAULT_SETTINGS.geminiModel,
      models: GEMINI_MODELS,
      keyUrl: GEMINI_KEY_URL
    };
  }
  return {
    providerName: "OpenAI",
    keyField: "openaiApiKey",
    modelField: "openaiModel",
    defaultModel: DEFAULT_SETTINGS.openaiModel,
    models: OPENAI_MODELS,
    keyUrl: OPENAI_KEY_URL
  };
}

function getProviderModel(settings, provider) {
  const meta = getProviderMeta(provider);
  return normalizeModel(settings[meta.modelField], meta.defaultModel);
}

function normalizeProvider(value) {
  return String(value || "").toLowerCase() === "gemini" ? "gemini" : "openai";
}

function normalizeModel(value, fallback) {
  const model = String(value || "").trim();
  return model || fallback;
}
