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
const SECTION_INFO_CONTENT = {
  models: {
    title: "Models",
    description: "This section controls which Gemini model AskBetter calls when you press Optimize.",
    points: [
      "AskBetter currently runs only with Google Gemini.",
      "Faster/lighter models usually respond quicker and cost less; larger models can improve rewrite quality.",
      "Your key is stored locally and is only used by the background worker for direct Gemini API calls."
    ]
  },
  modes: {
    title: "Mode",
    description: "Modes control which AskBetter experiences are available across supported surfaces.",
    points: [
      "Ask Better powers the existing Optimize button on ChatGPT and Gemini.",
      "Phrase Better adds a right-click action for selected text in editable fields.",
      "Phrase Better focuses on grammar, spelling, and small wording fixes while preserving the original phrasing as much as possible.",
      "Both modes are enabled by default and can be turned off independently."
    ]
  },
  presets: {
    title: "Presets",
    description: "Presets define your default rewrite style for the Optimize button.",
    points: [
      "Core Rewrite presets: Story structured, Concise, Fix grammar, Improve clarity.",
      "Communication Style presets: Persuasive, Executive brief, Coaching tone, Email rephrase/rewrite.",
      "Critical Thinking presets: Devil's advocate, First principles, Risk audit.",
      "Build and Delivery presets: Technical spec, Implementation plan.",
      "Keep user voice preserves your writing tone and voice while applying the selected preset."
    ]
  },
  integrations: {
    title: "Integrations",
    description: "Integrations decide where AskBetter appears and whether optimization is enabled at all.",
    points: [
      "Enable AI (global) turns optimization on/off everywhere.",
      "Enable on ChatGPT and Enable on Gemini control where the Optimize button appears.",
      "If AI is off or key is missing, clicking Optimize shows a friendly message and does nothing."
    ]
  },
  custom: {
    title: "Custom Prompt Additions",
    description: "Use this for reusable instruction snippets that are appended as extra guidance during optimization.",
    points: [
      "Use quick tags to add or remove common instruction snippets with one click.",
      "Selected additions appear as removable chips, and you can add your own custom attributes.",
      "Keep additions short and reusable (tone, constraints, output preferences).",
      "These values are stored locally in your browser profile.",
      "When you click Optimize, these additions are sent only to the Gemini API along with the prompt."
    ]
  },
  security: {
    title: "Security",
    description: "This section is for key setup, verification, and reset controls.",
    points: [
      "Test key checks your Gemini key before locking it.",
      "After successful verification, key editing is locked for safety.",
      "Use Clear stored key/data to reset local settings and unlock key setup again."
    ]
  }
};

const modelLabelEl = document.getElementById("modelLabel");
const modelSelectEl = document.getElementById("modelSelect");
const apiKeyEl = document.getElementById("apiKey");
const defaultPresetEl = document.getElementById("defaultPreset");
const keepUserVoiceEl = document.getElementById("keepUserVoice");
const enableAIEl = document.getElementById("enableAI");
const enableChatGPTEl = document.getElementById("enableChatGPT");
const enableGeminiEl = document.getElementById("enableGemini");
const enableAskBetterModeEl = document.getElementById("enableAskBetterMode");
const enablePhraseBetterModeEl = document.getElementById("enablePhraseBetterMode");
const customPromptAdditionsEl = document.getElementById("customPromptAdditions");
const customAdditionsListEl = document.getElementById("customAdditionsList");
const customAdditionsEmptyEl = document.getElementById("customAdditionsEmpty");
const customAdditionInputEl = document.getElementById("customAdditionInput");
const addCustomAdditionBtnEl = document.getElementById("addCustomAdditionBtn");
const quickTagButtons = Array.from(document.querySelectorAll(".quick-tag"));
const testKeyBtn = document.getElementById("testKeyBtn");
const clearDataBtn = document.getElementById("clearDataBtn");
const statusMsg = document.getElementById("statusMsg");
const statusMsgText = document.getElementById("statusMsgText");
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
const privacyInfoBtnEl = document.getElementById("privacyInfoBtn");
const privacyInfoModalEl = document.getElementById("privacyInfoModal");
const privacyInfoCloseEl = document.getElementById("privacyInfoClose");

let currentSettings = null;
let keyLocked = false;
let customSaveTimer = 0;
let statusResetTimer = 0;
let lastInfoTriggerEl = null;
let lastPrivacyTriggerEl = null;
let customAdditions = [];

init().catch(() => {
  setStatus("Unable to load settings.", "warn");
});

async function init() {
  bindNavigation();
  bindSectionInfo();
  bindPrivacyInfo();
  bindQuickAdditions();
  bindCustomAdditionsEditor();
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
    if (event.key === "Escape" && privacyInfoModalEl && !privacyInfoModalEl.hidden) {
      closePrivacyInfoModal();
      return;
    }
    if (event.key === "Escape" && !sectionInfoModalEl.hidden) {
      closeSectionInfoModal();
    }
  });
}

function bindPrivacyInfo() {
  if (!privacyInfoBtnEl || !privacyInfoModalEl || !privacyInfoCloseEl) {
    return;
  }

  privacyInfoBtnEl.addEventListener("click", () => {
    lastPrivacyTriggerEl = privacyInfoBtnEl;
    openPrivacyInfoModal();
  });

  privacyInfoCloseEl.addEventListener("click", closePrivacyInfoModal);
  privacyInfoModalEl.addEventListener("click", (event) => {
    if (event.target === privacyInfoModalEl) {
      closePrivacyInfoModal();
    }
  });
}

function openPrivacyInfoModal() {
  if (!privacyInfoModalEl || !privacyInfoCloseEl) {
    return;
  }
  privacyInfoModalEl.hidden = false;
  privacyInfoCloseEl.focus({ preventScroll: true });
}

function closePrivacyInfoModal() {
  if (!privacyInfoModalEl || privacyInfoModalEl.hidden) {
    return;
  }
  privacyInfoModalEl.hidden = true;
  if (lastPrivacyTriggerEl && typeof lastPrivacyTriggerEl.focus === "function") {
    lastPrivacyTriggerEl.focus({ preventScroll: true });
  }
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
  modelSelectEl.addEventListener("change", async () => {
    const meta = getProviderMeta();
    await savePartial({ [meta.modelField]: normalizeModel(modelSelectEl.value, meta.defaultModel) });
  });

  defaultPresetEl.addEventListener("change", async () => {
    await savePartial({ defaultPreset: normalizePreset(defaultPresetEl.value) });
  });

  keepUserVoiceEl.addEventListener("change", async () => {
    await savePartial({ keepUserVoice: !!keepUserVoiceEl.checked });
  });

  enableAIEl.addEventListener("change", async () => {
    await savePartial({ enableAI: !!enableAIEl.checked });
  });

  enableAskBetterModeEl.addEventListener("change", async () => {
    await savePartial({ enableAskBetterMode: !!enableAskBetterModeEl.checked });
  });

  enablePhraseBetterModeEl.addEventListener("change", async () => {
    await savePartial({ enablePhraseBetterMode: !!enablePhraseBetterModeEl.checked });
  });

  enableChatGPTEl.addEventListener("change", async () => {
    await savePartial({ enableChatGPT: !!enableChatGPTEl.checked });
  });

  enableGeminiEl.addEventListener("change", async () => {
    await savePartial({ enableGemini: !!enableGeminiEl.checked });
  });
}

function bindQuickAdditions() {
  if (!quickTagButtons.length) {
    return;
  }
  for (const button of quickTagButtons) {
    button.addEventListener("click", () => {
      const snippet = String(button.getAttribute("data-snippet") || "").trim();
      if (!snippet) {
        return;
      }
      toggleSnippetInCustomAdditions(snippet);
    });
  }
}

function bindCustomAdditionsEditor() {
  if (!customAdditionsListEl || !customAdditionInputEl || !addCustomAdditionBtnEl) {
    return;
  }

  addCustomAdditionBtnEl.addEventListener("click", () => {
    addCustomAdditionFromInput();
  });

  customAdditionInputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addCustomAdditionFromInput();
    }
  });

  customAdditionsListEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const removeButton = target.closest(".custom-chip-remove");
    if (!removeButton) {
      return;
    }
    const index = Number(removeButton.getAttribute("data-index"));
    if (!Number.isInteger(index) || index < 0 || index >= customAdditions.length) {
      return;
    }
    customAdditions.splice(index, 1);
    persistCustomAdditions();
    setStatus("Addition removed", "ok", true);
  });
}

function addCustomAdditionFromInput() {
  if (!customAdditionInputEl) {
    return;
  }
  const snippet = normalizeAddition(customAdditionInputEl.value);
  if (!snippet) {
    return;
  }
  const exists = customAdditions.some((item) => item.toLowerCase() === snippet.toLowerCase());
  if (exists) {
    setStatus("Addition already exists", "ok", true);
    customAdditionInputEl.select();
    return;
  }
  customAdditions.push(snippet);
  customAdditionInputEl.value = "";
  persistCustomAdditions();
  setStatus("Addition added", "ok", true);
}

function toggleSnippetInCustomAdditions(snippet) {
  const normalized = normalizeAddition(snippet);
  if (!normalized) {
    return;
  }

  const index = customAdditions.findIndex((item) => item.toLowerCase() === normalized.toLowerCase());
  if (index >= 0) {
    customAdditions.splice(index, 1);
    persistCustomAdditions();
    setStatus("Tag removed", "ok", true);
    return;
  }

  customAdditions.push(normalized);
  persistCustomAdditions();
  setStatus("Tag added", "ok", true);
}

function persistCustomAdditions() {
  customPromptAdditionsEl.value = customAdditions.join("\n");
  renderCustomAdditions();
  syncQuickTagState();

  window.clearTimeout(customSaveTimer);
  setStatus("Saving...");
  customSaveTimer = window.setTimeout(async () => {
    await savePartial({ customPromptAdditions: customPromptAdditionsEl.value.trim() });
  }, 350);
}

function splitAdditionsLines(text) {
  return String(text || "")
    .split(/\r?\n+/)
    .map((line) => normalizeAddition(line))
    .filter(Boolean);
}

function normalizeAddition(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function syncQuickTagState() {
  if (!quickTagButtons.length) {
    return;
  }
  const lines = customAdditions.map((line) => line.toLowerCase());
  for (const button of quickTagButtons) {
    const snippet = String(button.getAttribute("data-snippet") || "").trim().toLowerCase();
    const selected = !!snippet && lines.includes(snippet);
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  }
}

function renderCustomAdditions() {
  if (!customAdditionsListEl || !customAdditionsEmptyEl) {
    return;
  }

  customAdditionsListEl.textContent = "";
  for (let i = 0; i < customAdditions.length; i += 1) {
    const item = customAdditions[i];

    const chip = document.createElement("div");
    chip.className = "custom-chip";

    const label = document.createElement("span");
    label.className = "custom-chip-text";
    label.textContent = item;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "custom-chip-remove";
    removeButton.setAttribute("data-index", String(i));
    removeButton.setAttribute("aria-label", `Remove addition: ${item}`);
    removeButton.textContent = "x";

    chip.appendChild(label);
    chip.appendChild(removeButton);
    customAdditionsListEl.appendChild(chip);
  }

  customAdditionsEmptyEl.hidden = customAdditions.length > 0;
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

    const meta = getProviderMeta();
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
      type: "ASKBETTER_TEST_KEY",
      payload: {
        apiKey,
        model: modelSelectEl.value
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
    const confirmed = window.confirm("Clear all stored AskBetter settings and local data?");
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
  defaultPresetEl.value = normalizePreset(normalized.defaultPreset);
  keepUserVoiceEl.checked = !!normalized.keepUserVoice;
  enableAIEl.checked = !!normalized.enableAI;
  enableAskBetterModeEl.checked = normalized.enableAskBetterMode !== false;
  enablePhraseBetterModeEl.checked = normalized.enablePhraseBetterMode !== false;
  enableChatGPTEl.checked = !!normalized.enableChatGPT;
  enableGeminiEl.checked = !!normalized.enableGemini;
  customAdditions = splitAdditionsLines(normalized.customPromptAdditions || "");
  customPromptAdditionsEl.value = customAdditions.join("\n");
  if (customAdditionInputEl) {
    customAdditionInputEl.value = "";
  }
  renderCustomAdditions();
  syncQuickTagState();
  applyProviderUI();
}

function applyProviderUI() {
  const meta = getProviderMeta();
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
  const meta = getProviderMeta();
  generateKeyLinkEl.href = meta.keyUrl;
  const isMissingKey = !apiKeyEl.value.trim();
  generateKeyLinkEl.hidden = keyLocked || !isMissingKey;
}

function renderModelOptions(models, selected) {
  modelSelectEl.textContent = "";
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    modelSelectEl.appendChild(option);
  }
  if (!models.includes(selected)) {
    const customOption = document.createElement("option");
    customOption.value = selected;
    customOption.textContent = `${selected} (custom)`;
    modelSelectEl.appendChild(customOption);
  }
  modelSelectEl.value = selected;
}

function getProviderMeta() {
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

async function readSettings() {
  const stored = await chrome.storage.local.get(["settings"]);
  return migrateSettings(stored.settings || {});
}

function migrateSettings(rawSettings) {
  const raw = rawSettings || {};
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

function normalizeModel(model, fallback) {
  const value = String(model || "").trim();
  return value || fallback;
}

function setStatus(message, tone, resetToReady) {
  const label = statusMsgText || statusMsg;
  label.textContent = message;
  statusMsg.title = message;
  statusMsg.classList.remove("ok", "warn");
  if (tone === "ok" || tone === "warn") {
    statusMsg.classList.add(tone);
  }
  window.clearTimeout(statusResetTimer);
  if (resetToReady) {
    statusResetTimer = window.setTimeout(() => {
      label.textContent = "Auto-save";
      statusMsg.title = "Auto-save enabled";
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
