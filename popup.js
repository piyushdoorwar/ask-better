const DEFAULT_SETTINGS = {
  provider: "openai",
  openaiApiKey: "",
  openaiModel: "gpt-4.1-mini",
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
const OPENAI_MODELS = ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"];

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
  applyModelValue(settings.openaiModel || DEFAULT_SETTINGS.openaiModel);
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
    await updateSettings({ openaiModel: normalizeModel(openaiModelEl.value) });
  });

  openSettingsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

function renderStatus(settings) {
  const hasKey = !!(settings.openaiApiKey && settings.openaiApiKey.trim());
  if (missingKeyLinkEl) {
    missingKeyLinkEl.href = OPENAI_KEY_URL;
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
    statusText.textContent = "API key: Connected";
    statusText.className = "status-ok";
    if (statusBox) {
      statusBox.classList.add("state-ok");
    }
  } else {
    statusText.textContent = "API key: Missing";
    statusText.className = "status-warn";
    if (statusBox) {
      statusBox.classList.add("state-warn");
    }
    if (missingKeyLinkEl) {
      missingKeyLinkEl.hidden = false;
    }
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
  if (preset === "structured" || preset === "concise" || preset === "grammar" || preset === "clarity") {
    return preset;
  }
  return DEFAULT_SETTINGS.defaultPreset;
}

function applyModelValue(model) {
  const normalized = normalizeModel(model);
  if (!hasModelOption(normalized)) {
    const option = document.createElement("option");
    option.value = normalized;
    option.textContent = `${normalized} (custom)`;
    openaiModelEl.appendChild(option);
  }
  openaiModelEl.value = normalized;
}

function hasModelOption(model) {
  for (const option of openaiModelEl.options) {
    if (option.value === model) {
      return true;
    }
  }
  return false;
}

function normalizeModel(model) {
  const value = String(model || "").trim();
  if (!value) {
    return DEFAULT_SETTINGS.openaiModel;
  }
  if (OPENAI_MODELS.includes(value)) {
    return value;
  }
  return value;
}
