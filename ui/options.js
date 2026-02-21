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
const SECTION_INFO_CONTENT = {
  models: {
    title: "Models",
    description: "This section controls which provider and model PromptForge calls when you press Optimize.",
    points: [
      "OpenAI and Google Gemini are supported right now.",
      "Faster/lighter models usually respond quicker and cost less; larger models can improve rewrite quality.",
      "Your key is stored locally and is only used by the background worker for direct provider calls."
    ]
  },
  presets: {
    title: "Presets",
    description: "Presets define your default rewrite style for the Optimize button.",
    points: [
      "Structured: rewrites into clear sections (Context, Task, Constraints, Output Format, Questions).",
      "Concise: shortens wording while preserving intent and requirements.",
      "Fix grammar: corrects grammar/spelling with minimal rewrite.",
      "Improve clarity: keeps meaning while making wording clearer."
    ]
  },
  integrations: {
    title: "Integrations",
    description: "Integrations decide where PromptForge appears and whether optimization is enabled at all.",
    points: [
      "Enable AI (global) turns optimization on/off everywhere.",
      "Enable on ChatGPT and Enable on Gemini control injection per site.",
      "If AI is off or key is missing, clicking Optimize shows a friendly message and does nothing."
    ]
  },
  custom: {
    title: "Custom Prompt Additions",
    description: "Use this for reusable instruction snippets you want available for future optimization behavior.",
    points: [
      "Keep additions short and reusable (tone, constraints, output preferences).",
      "These values are stored locally in your browser profile.",
      "Current version saves this content now and is designed for deeper use in future iterations."
    ]
  },
  security: {
    title: "Security",
    description: "This section is for key setup, verification, and reset controls.",
    points: [
      "Test key checks the currently selected provider key before locking it.",
      "After successful verification, key editing is locked for safety.",
      "Use Clear stored key/data to reset local settings and unlock key setup again."
    ]
  }
};

const providerEl = document.getElementById("provider");
const modelLabelEl = document.getElementById("modelLabel");
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
const sectionInfoButtons = Array.from(document.querySelectorAll(".section-info-btn"));
const sectionInfoModalEl = document.getElementById("sectionInfoModal");
const sectionInfoTitleEl = document.getElementById("sectionInfoTitle");
const sectionInfoBodyEl = document.getElementById("sectionInfoBody");
const sectionInfoCloseEl = document.getElementById("sectionInfoClose");

let currentSettings = null;
let keyLocked = false;
let customSaveTimer = 0;
let statusResetTimer = 0;
let lastInfoTriggerEl = null;

init().catch(() => {
  setStatus("Unable to load settings.", "warn");
});

async function init() {
  bindNavigation();
  bindSectionInfo();
  currentSettings = await readSettings();
  fillForm(currentSettings);
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

function bindSectionInfo() {
  if (!sectionInfoModalEl || !sectionInfoTitleEl || !sectionInfoBodyEl || !sectionInfoCloseEl) {
    return;
  }

  for (const button of sectionInfoButtons) {
    button.addEventListener("click", () => {
      const key = String(button.getAttribute("data-info-section") || "").trim();
      if (!key) {
        return;
      }
      lastInfoTriggerEl = button;
      openSectionInfoModal(key);
    });
  }

  sectionInfoCloseEl.addEventListener("click", closeSectionInfoModal);
  sectionInfoModalEl.addEventListener("click", (event) => {
    if (event.target === sectionInfoModalEl) {
      closeSectionInfoModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !sectionInfoModalEl.hidden) {
      closeSectionInfoModal();
    }
  });
}

function openSectionInfoModal(sectionKey) {
  const info = SECTION_INFO_CONTENT[sectionKey];
  if (!info) {
    return;
  }

  sectionInfoTitleEl.textContent = info.title;
  sectionInfoBodyEl.textContent = "";

  const paragraph = document.createElement("p");
  paragraph.textContent = info.description;
  sectionInfoBodyEl.appendChild(paragraph);

  if (Array.isArray(info.points) && info.points.length) {
    const list = document.createElement("ul");
    list.className = "info-modal-list";
    for (const point of info.points) {
      const item = document.createElement("li");
      item.textContent = point;
      list.appendChild(item);
    }
    sectionInfoBodyEl.appendChild(list);
  }

  sectionInfoModalEl.hidden = false;
  sectionInfoCloseEl.focus({ preventScroll: true });
}

function closeSectionInfoModal() {
  if (!sectionInfoModalEl || sectionInfoModalEl.hidden) {
    return;
  }
  sectionInfoModalEl.hidden = true;
  if (lastInfoTriggerEl && typeof lastInfoTriggerEl.focus === "function") {
    lastInfoTriggerEl.focus({ preventScroll: true });
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
    const provider = normalizeProvider(providerEl.value);
    await savePartial({ provider });
    applyProviderUI();
    testKeyStatus.textContent = "";
    testKeyStatus.className = "";
  });

  openaiModelEl.addEventListener("change", async () => {
    const provider = getActiveProvider();
    const meta = getProviderMeta(provider);
    await savePartial({ [meta.modelField]: normalizeModel(openaiModelEl.value, meta.defaultModel) });
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

    const provider = getActiveProvider();
    const meta = getProviderMeta(provider);
    const apiKey = apiKeyEl.value.trim();

    if (!apiKey) {
      testKeyStatus.textContent = "API key is missing.";
      testKeyStatus.className = "warn";
      updateMissingKeyLinkVisibility();
      return;
    }

    testKeyStatus.textContent = "Testing...";
    testKeyStatus.className = "";

    const response = await sendMessage({
      type: "PROMPTFORGE_TEST_KEY",
      payload: {
        provider,
        apiKey,
        model: openaiModelEl.value
      }
    });

    if (response && response.ok) {
      await savePartial(
        {
          [meta.keyField]: apiKey,
          [meta.verifiedField]: true
        },
        { silentStatus: true }
      );
      keyLocked = true;
      applyKeyLockState();
      updateMissingKeyLinkVisibility();
      testKeyStatus.textContent = "Valid key.";
      testKeyStatus.className = "ok";
      setStatus(`${meta.providerName} key verified and saved.`, "ok");
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
    const defaults = { ...DEFAULT_SETTINGS };
    await chrome.storage.local.set({ settings: defaults });
    currentSettings = defaults;
    fillForm(currentSettings);
    testKeyStatus.textContent = "";
    testKeyStatus.className = "";
    setStatus("Stored key/data cleared.", "ok");
  });
}

async function savePartial(partial, options) {
  const opts = options || {};
  const current = currentSettings || await readSettings();
  const next = {
    ...current,
    ...partial
  };
  await chrome.storage.local.set({ settings: next });
  currentSettings = next;
  if (!opts.silentStatus) {
    setStatus("All changes saved.", "ok", true);
  }
  return next;
}

function fillForm(settings) {
  const normalized = migrateSettings(settings);
  currentSettings = normalized;
  providerEl.value = normalizeProvider(normalized.provider);
  defaultPresetEl.value = normalizePreset(normalized.defaultPreset);
  enableAIEl.checked = !!normalized.enableAI;
  enableChatGPTEl.checked = !!normalized.enableChatGPT;
  enableGeminiEl.checked = !!normalized.enableGemini;
  analyticsOptInEl.checked = !!normalized.analyticsOptIn;
  customPromptAdditionsEl.value = normalized.customPromptAdditions || "";
  applyProviderUI();
}

function applyProviderUI() {
  const provider = getActiveProvider();
  const meta = getProviderMeta(provider);
  const modelValue = String(currentSettings[meta.modelField] || meta.defaultModel).trim() || meta.defaultModel;
  renderModelOptions(meta.models, modelValue);
  if (modelLabelEl) {
    modelLabelEl.textContent = meta.modelLabel;
  }

  const storedKey = String(currentSettings[meta.keyField] || "").trim();
  const verified = !!currentSettings[meta.verifiedField];
  keyLocked = verified && !!storedKey;

  apiKeyEl.value = keyLocked ? "" : storedKey;
  apiKeyEl.placeholder = keyLocked ? "Saved securely" : meta.keyPlaceholder;
  generateKeyLinkEl.href = meta.keyUrl;
  applyKeyLockState();
  updateMissingKeyLinkVisibility();
}

function applyKeyLockState() {
  apiKeyEl.disabled = keyLocked;
  testKeyBtn.hidden = keyLocked;
  keyLockedBannerEl.hidden = !keyLocked;
  apiKeyEditorEl.hidden = keyLocked;
}

function updateMissingKeyLinkVisibility() {
  if (!generateKeyLinkEl) {
    return;
  }
  const provider = getActiveProvider();
  const meta = getProviderMeta(provider);
  generateKeyLinkEl.href = meta.keyUrl;
  const isMissingKey = !apiKeyEl.value.trim();
  generateKeyLinkEl.hidden = keyLocked || !isMissingKey;
}

function renderModelOptions(models, selected) {
  openaiModelEl.textContent = "";
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    openaiModelEl.appendChild(option);
  }
  if (!models.includes(selected)) {
    const customOption = document.createElement("option");
    customOption.value = selected;
    customOption.textContent = `${selected} (custom)`;
    openaiModelEl.appendChild(customOption);
  }
  openaiModelEl.value = selected;
}

function getActiveProvider() {
  return normalizeProvider(providerEl.value);
}

function getProviderMeta(provider) {
  if (provider === "gemini") {
    return {
      providerName: "Gemini",
      keyField: "geminiApiKey",
      verifiedField: "geminiKeyVerified",
      modelField: "geminiModel",
      defaultModel: DEFAULT_SETTINGS.geminiModel,
      models: GEMINI_MODELS,
      keyUrl: GEMINI_KEY_URL,
      keyPlaceholder: "AIza...",
      modelLabel: "Gemini model"
    };
  }
  return {
    providerName: "OpenAI",
    keyField: "openaiApiKey",
    verifiedField: "openaiKeyVerified",
    modelField: "openaiModel",
    defaultModel: DEFAULT_SETTINGS.openaiModel,
    models: OPENAI_MODELS,
    keyUrl: OPENAI_KEY_URL,
    keyPlaceholder: "sk-...",
    modelLabel: "OpenAI model"
  };
}

async function readSettings() {
  const stored = await chrome.storage.local.get(["settings"]);
  return migrateSettings(stored.settings || {});
}

function migrateSettings(rawSettings) {
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(rawSettings || {})
  };

  const provider = normalizeProvider(settings.provider);
  settings.provider = provider;

  if (!settings.openaiKeyVerified && settings.keyVerified && String(settings.openaiApiKey || "").trim()) {
    settings.openaiKeyVerified = true;
  }

  settings.openaiModel = normalizeModel(settings.openaiModel, DEFAULT_SETTINGS.openaiModel);
  settings.geminiModel = normalizeModel(settings.geminiModel, DEFAULT_SETTINGS.geminiModel);
  settings.customPromptAdditions = String(settings.customPromptAdditions || "");
  return settings;
}

function normalizeProvider(value) {
  return String(value || "").toLowerCase() === "gemini" ? "gemini" : "openai";
}

function normalizePreset(value) {
  const preset = String(value || "").toLowerCase();
  if (preset === "structured" || preset === "concise" || preset === "grammar" || preset === "clarity") {
    return preset;
  }
  return DEFAULT_SETTINGS.defaultPreset;
}

function normalizeModel(model, fallback) {
  const value = String(model || "").trim();
  return value || fallback;
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
