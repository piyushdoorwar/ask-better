const DEFAULT_SETTINGS = {
  provider: "openai",
  openaiApiKey: "",
  openaiModel: "gpt-4.1-mini",
  defaultPreset: "structured",
  enableChatGPT: true,
  enableGemini: true,
  enableAI: true,
  analyticsOptIn: false,
  keepUserVoice: false
};

const statusBox = document.getElementById("statusBox");
const statusText = document.getElementById("statusText");
const defaultPresetEl = document.getElementById("defaultPreset");
const enableChatGPTEl = document.getElementById("enableChatGPT");
const enableGeminiEl = document.getElementById("enableGemini");
const openSettingsBtn = document.getElementById("openSettingsBtn");

init().catch(() => {
  statusText.textContent = "Unable to load settings.";
  statusText.className = "status-warn";
});

async function init() {
  const settings = await readSettings();
  renderStatus(settings);
  defaultPresetEl.value = normalizePreset(settings.defaultPreset);
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

  openSettingsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

function renderStatus(settings) {
  const hasKey = !!(settings.openaiApiKey && settings.openaiApiKey.trim());
  if (!settings.enableAI) {
    statusText.textContent = "AI disabled";
    statusText.className = "status-warn";
    statusBox.className = "status";
    return;
  }
  if (hasKey) {
    statusText.textContent = "API key: Connected";
    statusText.className = "status-ok";
  } else {
    statusText.textContent = "API key: Missing";
    statusText.className = "status-warn";
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
