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

const form = document.getElementById("settingsForm");
const providerEl = document.getElementById("provider");
const openaiModelEl = document.getElementById("openaiModel");
const apiKeyEl = document.getElementById("apiKey");
const defaultPresetEl = document.getElementById("defaultPreset");
const enableAIEl = document.getElementById("enableAI");
const enableChatGPTEl = document.getElementById("enableChatGPT");
const enableGeminiEl = document.getElementById("enableGemini");
const analyticsOptInEl = document.getElementById("analyticsOptIn");
const testKeyBtn = document.getElementById("testKeyBtn");
const clearDataBtn = document.getElementById("clearDataBtn");
const statusMsg = document.getElementById("statusMsg");
const testKeyStatus = document.getElementById("testKeyStatus");

init().catch(() => {
  setStatus("Unable to load settings.", "warn");
});

async function init() {
  const settings = await readSettings();
  fillForm(settings);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const next = readForm();
    await chrome.storage.local.set({ settings: next });
    setStatus("Settings saved.", "ok");
  });

  testKeyBtn.addEventListener("click", async () => {
    testKeyStatus.textContent = "Testing...";
    const payload = {
      provider: providerEl.value,
      apiKey: apiKeyEl.value.trim(),
      openaiModel: openaiModelEl.value.trim()
    };
    const response = await sendMessage({ type: "PROMPTFORGE_TEST_KEY", payload });
    if (response && response.ok) {
      testKeyStatus.textContent = "Valid key.";
      testKeyStatus.className = "ok";
      return;
    }
    testKeyStatus.textContent = (response && response.message) || "Test failed.";
    testKeyStatus.className = "warn";
  });

  clearDataBtn.addEventListener("click", async () => {
    const confirmed = window.confirm("Clear all stored PromptForge settings and local usage data?");
    if (!confirmed) {
      return;
    }
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS } });
    fillForm(DEFAULT_SETTINGS);
    testKeyStatus.textContent = "";
    setStatus("Stored data cleared.", "ok");
  });
}

function readForm() {
  return {
    provider: providerEl.value || DEFAULT_SETTINGS.provider,
    openaiApiKey: apiKeyEl.value.trim(),
    openaiModel: openaiModelEl.value.trim() || DEFAULT_SETTINGS.openaiModel,
    defaultPreset: normalizePreset(defaultPresetEl.value),
    enableChatGPT: !!enableChatGPTEl.checked,
    enableGemini: !!enableGeminiEl.checked,
    enableAI: !!enableAIEl.checked,
    analyticsOptIn: !!analyticsOptInEl.checked,
    keepUserVoice: false
  };
}

function fillForm(settings) {
  providerEl.value = settings.provider || DEFAULT_SETTINGS.provider;
  openaiModelEl.value = settings.openaiModel || DEFAULT_SETTINGS.openaiModel;
  apiKeyEl.value = settings.openaiApiKey || "";
  defaultPresetEl.value = normalizePreset(settings.defaultPreset);
  enableAIEl.checked = !!settings.enableAI;
  enableChatGPTEl.checked = !!settings.enableChatGPT;
  enableGeminiEl.checked = !!settings.enableGemini;
  analyticsOptInEl.checked = !!settings.analyticsOptIn;
}

async function readSettings() {
  const stored = await chrome.storage.local.get(["settings"]);
  return {
    ...DEFAULT_SETTINGS,
    ...(stored.settings || {})
  };
}

function normalizePreset(value) {
  const preset = String(value || "").toLowerCase();
  if (preset === "structured" || preset === "concise" || preset === "grammar" || preset === "clarity") {
    return preset;
  }
  return DEFAULT_SETTINGS.defaultPreset;
}

function setStatus(message, tone) {
  statusMsg.textContent = message;
  statusMsg.className = tone === "ok" ? "ok" : "warn";
}

function sendMessage(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, message: "Background worker unavailable." });
        return;
      }
      resolve(response);
    });
  });
}
