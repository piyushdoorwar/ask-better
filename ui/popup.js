const DEFAULT_SETTINGS = {
  provider: "gemini",
  geminiApiKey: "",
  geminiModel: "gemini-3-flash-preview",
  geminiKeyVerified: false,
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

const GEMINI_KEY_URL = "https://aistudio.google.com/apikey";
const GEMINI_MODELS = [
  "gemini-3-flash-preview",
  "gemini-3-pro-preview",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash"
];

const statusBox = document.getElementById("statusBox");
const statusText = document.getElementById("statusText");
const defaultPresetEl = document.getElementById("defaultPreset");
const keepUserVoiceEl = document.getElementById("keepUserVoice");
const modelSelectEl = document.getElementById("modelSelect");
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
  const model = getProviderModel(settings);
  renderModelOptions(model);
  keepUserVoiceEl.checked = !!settings.keepUserVoice;
  enableChatGPTEl.checked = !!settings.enableChatGPT;
  enableGeminiEl.checked = !!settings.enableGemini;

  defaultPresetEl.addEventListener("change", async () => {
    await updateSettings({ defaultPreset: normalizePreset(defaultPresetEl.value) });
  });

  keepUserVoiceEl.addEventListener("change", async () => {
    await updateSettings({ keepUserVoice: !!keepUserVoiceEl.checked });
  });

  enableChatGPTEl.addEventListener("change", async () => {
    await updateSettings({ enableChatGPT: !!enableChatGPTEl.checked });
  });

  enableGeminiEl.addEventListener("change", async () => {
    await updateSettings({ enableGemini: !!enableGeminiEl.checked });
  });

  modelSelectEl.addEventListener("change", async () => {
    const meta = getProviderMeta();
    await updateSettings({ [meta.modelField]: normalizeModel(modelSelectEl.value, meta.defaultModel) });
  });

  openSettingsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

function renderStatus(settings) {
  const meta = getProviderMeta();
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
  const raw = stored.settings || {};
  return {
    provider: "gemini",
    geminiApiKey: String(raw.geminiApiKey || ""),
    geminiModel: normalizeModel(raw.geminiModel, DEFAULT_SETTINGS.geminiModel),
    geminiKeyVerified: !!raw.geminiKeyVerified,
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

function renderModelOptions(selectedModel) {
  const meta = getProviderMeta();
  modelSelectEl.textContent = "";
  for (const model of meta.models) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    modelSelectEl.appendChild(option);
  }
  if (!meta.models.includes(selectedModel)) {
    const option = document.createElement("option");
    option.value = selectedModel;
    option.textContent = `${selectedModel} (custom)`;
    modelSelectEl.appendChild(option);
  }
  modelSelectEl.value = selectedModel;
}

function getProviderMeta() {
  return {
    providerName: "Gemini",
    keyField: "geminiApiKey",
    modelField: "geminiModel",
    defaultModel: DEFAULT_SETTINGS.geminiModel,
    models: GEMINI_MODELS,
    keyUrl: GEMINI_KEY_URL
  };
}

function getProviderModel(settings) {
  const meta = getProviderMeta();
  return normalizeModel(settings[meta.modelField], meta.defaultModel);
}

function normalizeModel(value, fallback) {
  const model = String(value || "").trim();
  return model || fallback;
}
