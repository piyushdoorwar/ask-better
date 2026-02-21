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

const providerEl = document.getElementById("provider");
const openaiModelEl = document.getElementById("openaiModel");
const apiKeyEl = document.getElementById("apiKey");
const defaultPresetEl = document.getElementById("defaultPreset");
const enableAIEl = document.getElementById("enableAI");
const enableChatGPTEl = document.getElementById("enableChatGPT");
const enableGeminiEl = document.getElementById("enableGemini");
const analyticsOptInEl = document.getElementById("analyticsOptIn");
const customPromptAdditionsEl = document.getElementById("customPromptAdditions");
const testKeyBtn = document.getElementById("testKeyBtn");
const clearDataBtn = document.getElementById("clearDataBtn");
const statusMsg = document.getElementById("statusMsg");
const testKeyStatus = document.getElementById("testKeyStatus");
const generateKeyLinkEl = document.getElementById("generateKeyLink");
const keyLockedBannerEl = document.getElementById("keyLockedBanner");
const apiKeyEditorEl = document.getElementById("apiKeyEditor");
const navButtons = Array.from(document.querySelectorAll(".nav-btn"));
const sections = Array.from(document.querySelectorAll(".settings-section"));

let keyLocked = false;
let customSaveTimer = 0;
let statusResetTimer = 0;

init().catch(() => {
  setStatus("Unable to load settings.", "warn");
});

async function init() {
  bindNavigation();
  const settings = await readSettings();
  keyLocked = !!(settings.keyVerified && settings.openaiApiKey && settings.openaiApiKey.trim());
  fillForm(settings);
  applyKeyLockState();
  updateMissingKeyLinkVisibility();
  bindAutoSave();
  bindSecurityActions();
  setStatus("Auto-save enabled");
}

function bindNavigation() {
  for (const button of navButtons) {
    button.addEventListener("click", () => {
      const target = button.getAttribute("data-section");
      if (target) {
        activateSection(target);
      }
    });
  }
}

function activateSection(targetId) {
  for (const section of sections) {
    section.classList.toggle("active", section.id === targetId);
  }
  for (const button of navButtons) {
    button.classList.toggle("active", button.getAttribute("data-section") === targetId);
  }
}

function bindAutoSave() {
  providerEl.addEventListener("change", async () => {
    await savePartial({ provider: providerEl.value || DEFAULT_SETTINGS.provider });
    updateMissingKeyLinkVisibility();
  });

  openaiModelEl.addEventListener("change", async () => {
    await savePartial({ openaiModel: normalizeModel(openaiModelEl.value) });
  });

  defaultPresetEl.addEventListener("change", async () => {
    await savePartial({ defaultPreset: normalizePreset(defaultPresetEl.value) });
  });

  enableAIEl.addEventListener("change", async () => {
    await savePartial({ enableAI: !!enableAIEl.checked });
  });

  enableChatGPTEl.addEventListener("change", async () => {
    await savePartial({ enableChatGPT: !!enableChatGPTEl.checked });
  });

  enableGeminiEl.addEventListener("change", async () => {
    await savePartial({ enableGemini: !!enableGeminiEl.checked });
  });

  analyticsOptInEl.addEventListener("change", async () => {
    await savePartial({ analyticsOptIn: !!analyticsOptInEl.checked });
  });

  customPromptAdditionsEl.addEventListener("input", () => {
    window.clearTimeout(customSaveTimer);
    setStatus("Saving...");
    customSaveTimer = window.setTimeout(async () => {
      await savePartial({ customPromptAdditions: customPromptAdditionsEl.value.trim() });
    }, 350);
  });
}

function bindSecurityActions() {
  apiKeyEl.addEventListener("input", () => {
    if (keyLocked) {
      return;
    }
    if (testKeyStatus.textContent) {
      testKeyStatus.textContent = "";
      testKeyStatus.className = "";
    }
    updateMissingKeyLinkVisibility();
  });

  testKeyBtn.addEventListener("click", async () => {
    if (keyLocked) {
      return;
    }

    const apiKey = apiKeyEl.value.trim();
    if (!apiKey) {
      testKeyStatus.textContent = "API key is missing.";
      testKeyStatus.className = "warn";
      updateMissingKeyLinkVisibility();
      return;
    }

    testKeyStatus.textContent = "Testing...";
    testKeyStatus.className = "";

    const payload = {
      provider: providerEl.value,
      apiKey,
      openaiModel: normalizeModel(openaiModelEl.value)
    };

    const response = await sendMessage({ type: "PROMPTFORGE_TEST_KEY", payload });
    if (response && response.ok) {
      await savePartial(
        {
          provider: providerEl.value || DEFAULT_SETTINGS.provider,
          openaiModel: normalizeModel(openaiModelEl.value),
          openaiApiKey: apiKey,
          keyVerified: true
        },
        { silentStatus: true }
      );
      keyLocked = true;
      applyKeyLockState();
      updateMissingKeyLinkVisibility();
      testKeyStatus.textContent = "Valid key.";
      testKeyStatus.className = "ok";
      setStatus("API key verified and saved.", "ok");
      return;
    }

    testKeyStatus.textContent = (response && response.message) || "Test failed.";
    testKeyStatus.className = "warn";
    setStatus("Key verification failed.", "warn");
  });

  clearDataBtn.addEventListener("click", async () => {
    const confirmed = window.confirm("Clear all stored PromptForge settings and local usage data?");
    if (!confirmed) {
      return;
    }
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS } });
    keyLocked = false;
    fillForm(DEFAULT_SETTINGS);
    applyKeyLockState();
    testKeyStatus.textContent = "";
    testKeyStatus.className = "";
    updateMissingKeyLinkVisibility();
    setStatus("Stored key/data cleared.", "ok");
  });
}

async function savePartial(partial, options) {
  const opts = options || {};
  const current = await readSettings();
  const next = {
    ...current,
    ...partial
  };

  if (keyLocked && !Object.prototype.hasOwnProperty.call(partial, "openaiApiKey")) {
    next.keyVerified = true;
  }

  await chrome.storage.local.set({ settings: next });
  if (!opts.silentStatus) {
    setStatus("All changes saved.", "ok", true);
  }
}

function fillForm(settings) {
  providerEl.value = settings.provider || DEFAULT_SETTINGS.provider;
  applyModelValue(settings.openaiModel || DEFAULT_SETTINGS.openaiModel);
  apiKeyEl.value = keyLocked ? "" : (settings.openaiApiKey || "");
  apiKeyEl.placeholder = keyLocked ? "Saved securely" : "sk-...";
  defaultPresetEl.value = normalizePreset(settings.defaultPreset);
  enableAIEl.checked = !!settings.enableAI;
  enableChatGPTEl.checked = !!settings.enableChatGPT;
  enableGeminiEl.checked = !!settings.enableGemini;
  analyticsOptInEl.checked = !!settings.analyticsOptIn;
  customPromptAdditionsEl.value = settings.customPromptAdditions || "";

  if (generateKeyLinkEl) {
    generateKeyLinkEl.href = OPENAI_KEY_URL;
  }
}

function applyKeyLockState() {
  if (apiKeyEl) {
    apiKeyEl.disabled = keyLocked;
  }
  if (testKeyBtn) {
    testKeyBtn.hidden = keyLocked;
  }
  if (keyLockedBannerEl) {
    keyLockedBannerEl.hidden = !keyLocked;
  }
  if (apiKeyEditorEl) {
    apiKeyEditorEl.hidden = keyLocked;
  }
}

function updateMissingKeyLinkVisibility() {
  if (!generateKeyLinkEl) {
    return;
  }
  const provider = providerEl.value || DEFAULT_SETTINGS.provider;
  const isMissingKey = !apiKeyEl.value.trim();
  generateKeyLinkEl.hidden = keyLocked || provider !== "openai" || !isMissingKey;
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

function setStatus(message, tone, resetToReady) {
  statusMsg.textContent = message;
  statusMsg.classList.remove("ok", "warn");
  if (tone === "ok" || tone === "warn") {
    statusMsg.classList.add(tone);
  }
  window.clearTimeout(statusResetTimer);
  if (resetToReady) {
    statusResetTimer = window.setTimeout(() => {
      statusMsg.textContent = "Auto-save ready";
      statusMsg.classList.remove("ok", "warn");
    }, 1400);
  }
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
