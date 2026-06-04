const DEFAULT_SETTINGS = {
  provider: "gemini",
  geminiApiKey: "",
  geminiModel: "gemini-3-flash-preview",
  geminiKeyVerified: false,
  openaiApiKey: "",
  openaiModel: "gpt-5.2",
  openaiKeyVerified: false,
  anthropicApiKey: "",
  anthropicModel: "claude-sonnet-4-6",
  anthropicKeyVerified: false,
  defaultPreset: "structured",
  enableChatGPT: true,
  enableGemini: true,
  enableClaude: true,
  enableAskBetterMode: true,
  enablePhraseBetterMode: true,
  phraseBetterOptionCount: 2,
  enableAI: true,
  keepUserVoice: false,
  keyVerified: false,
  customPromptAdditions: "",
  customPresets: []
};

const GEMINI_KEY_URL = "https://aistudio.google.com/apikey";
const OPENAI_KEY_URL = "https://platform.openai.com/api-keys";
const ANTHROPIC_KEY_URL = "https://console.anthropic.com/settings/keys";
// Curated model lists (GEMINI_MODELS / OPENAI_MODELS / ANTHROPIC_MODELS) and the
// live-fetch/merge/cache helpers live in models.js, loaded before this script.
const SECTION_INFO_CONTENT = {
  models: {
    title: "Models",
    description: "This section controls which provider and model AskBetter calls when you press Optimize.",
    points: [
      "AskBetter supports Google Gemini, OpenAI, and Anthropic Claude.",
      "Faster/lighter models usually respond quicker and cost less; larger models can improve rewrite quality.",
      "Your API keys are stored locally and used only by the background worker for direct provider API calls."
    ]
  },
  modes: {
    title: "Mode",
    description: "Modes control which AskBetter experiences are available across supported surfaces.",
    points: [
      "Ask Better powers the existing Optimize button on ChatGPT, Gemini, and Claude.",
      "Phrase Better adds a right-click action for selected text in editable fields.",
      "Phrase Better focuses on grammar, spelling, and small wording fixes while preserving the original phrasing as much as possible.",
      "Phrase Better suggestions lets you show 1, 2, or 3 rephrase options in a chooser, so you accept or reject before your text is replaced.",
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
      "When you click Optimize, these additions are sent only to the selected provider API along with the prompt."
    ]
  },
  security: {
    title: "Security",
    description: "This section is for key setup, verification, and reset controls.",
    points: [
      "Test key checks the selected provider key before locking it.",
      "After successful verification, key editing is locked for safety.",
      "Use Clear stored key/data to reset local settings and unlock key setup again."
    ]
  }
};

const modelLabelEl = document.getElementById("modelLabel");
const modelSelectEl = document.getElementById("modelSelect");
const modelHintEl = document.getElementById("modelHint");
const providerSelectEl = document.getElementById("providerSelect");
const apiKeyEl = document.getElementById("apiKey");
const defaultPresetEl = document.getElementById("defaultPreset");
const keepUserVoiceEl = document.getElementById("keepUserVoice");
const enableAIEl = document.getElementById("enableAI");
const enableChatGPTEl = document.getElementById("enableChatGPT");
const enableGeminiEl = document.getElementById("enableGemini");
const enableClaudeEl = document.getElementById("enableClaude");
const enableAskBetterModeEl = document.getElementById("enableAskBetterMode");
const enablePhraseBetterModeEl = document.getElementById("enablePhraseBetterMode");
const phraseBetterOptionCountEl = document.getElementById("phraseBetterOptionCount");
const customPromptAdditionsEl = document.getElementById("customPromptAdditions");
const customAdditionsListEl = document.getElementById("customAdditionsList");
const customAdditionsEmptyEl = document.getElementById("customAdditionsEmpty");
const customAdditionInputEl = document.getElementById("customAdditionInput");
const addCustomAdditionBtnEl = document.getElementById("addCustomAdditionBtn");
const customPresetsListEl = document.getElementById("customPresetsList");
const customPresetsEmptyEl = document.getElementById("customPresetsEmpty");
const customPresetNameEl = document.getElementById("customPresetName");
const customPresetInstructionEl = document.getElementById("customPresetInstruction");
const addCustomPresetBtnEl = document.getElementById("addCustomPresetBtn");
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
const providerInfoEl = document.getElementById("providerInfo");

const PROVIDER_INFO = {
  gemini: {
    free: true,
    rows: [
      { label: "Free API tier", value: "Available (rate-limited)", ok: true },
      { label: "Requires billing", value: "No — free tier works out of the box", ok: true },
      { label: "Rate limits", value: "15 req/min · 1 500 req/day on free tier" },
      { label: "Paid usage", value: "Pay-as-you-go via Google AI Studio" },
    ],
    note: "Best starting point — no credit card needed.",
  },
  openai: {
    free: false,
    rows: [
      { label: "Free API tier", value: "Not available", warn: true },
      { label: "Requires billing", value: "Yes — prepaid credits required", warn: true },
      { label: "Rate limits", value: "Tier-based; increases with usage history" },
      { label: "Paid usage", value: "Credits purchased via platform.openai.com" },
    ],
    note: "Add credits at platform.openai.com before use.",
  },
  anthropic: {
    free: false,
    rows: [
      { label: "Free API tier", value: "Not available", warn: true },
      { label: "Requires billing", value: "Yes — prepaid credits required", warn: true },
      { label: "Rate limits", value: "Tier-based; increases with usage history" },
      { label: "Paid usage", value: "Credits purchased via console.anthropic.com" },
    ],
    note: "Add credits at console.anthropic.com before use.",
  },
};

let currentSettings = null;
let keyLocked = false;
let customSaveTimer = 0;
let statusResetTimer = 0;
let lastInfoTriggerEl = null;
let lastPrivacyTriggerEl = null;
let customAdditions = [];
let customPresets = [];

init().catch(() => {
  setStatus("Unable to load settings.", "warn");
});

async function init() {
  bindNavigation();
  bindSectionInfo();
  bindPrivacyInfo();
  bindQuickAdditions();
  bindCustomAdditionsEditor();
  bindCustomPresets();
  const stored = await chrome.storage.local.get(["settings"]);
  currentSettings = migrateSettings(stored.settings || {});
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
  providerSelectEl.addEventListener("change", async () => {
    const provider = normalizeProvider(providerSelectEl.value);
    const current = currentSettings || await readSettings();
    const meta = getProviderMeta(provider);
    await savePartial({
      provider,
      [meta.modelField]: normalizeModel(current[meta.modelField], meta.defaultModel)
    });
    applyProviderUI();
    renderStatusSummary();
  });

  modelSelectEl.addEventListener("change", async () => {
    const meta = getProviderMeta(providerSelectEl.value);
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

  phraseBetterOptionCountEl.addEventListener("change", async () => {
    await savePartial({ phraseBetterOptionCount: normalizePhraseBetterOptionCount(phraseBetterOptionCountEl.value) });
  });

  enableChatGPTEl.addEventListener("change", async () => {
    await savePartial({ enableChatGPT: !!enableChatGPTEl.checked });
  });

  enableGeminiEl.addEventListener("change", async () => {
    await savePartial({ enableGemini: !!enableGeminiEl.checked });
  });

  enableClaudeEl.addEventListener("change", async () => {
    await savePartial({ enableClaude: !!enableClaudeEl.checked });
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

function bindCustomPresets() {
  if (!addCustomPresetBtnEl || !customPresetsListEl) {
    return;
  }

  addCustomPresetBtnEl.addEventListener("click", () => {
    addCustomPreset();
  });

  if (customPresetInstructionEl) {
    customPresetInstructionEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        addCustomPreset();
      }
    });
  }

  customPresetsListEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const removeButton = target.closest(".custom-chip-remove");
    if (!removeButton) {
      return;
    }
    const id = removeButton.getAttribute("data-id");
    const index = customPresets.findIndex((item) => item.id === id);
    if (index < 0) {
      return;
    }
    customPresets.splice(index, 1);
    persistCustomPresets();
    setStatus("Custom preset removed", "ok", true);
  });
}

function addCustomPreset() {
  const name = normalizeAddition(customPresetNameEl ? customPresetNameEl.value : "");
  const instruction = String(customPresetInstructionEl ? customPresetInstructionEl.value : "").trim();
  if (!name || !instruction) {
    setStatus("Add a preset name and instruction.", "warn", true);
    return;
  }
  if (customPresets.length >= 20) {
    setStatus("Custom preset limit reached (20).", "warn", true);
    return;
  }
  const exists = customPresets.some((item) => item.name.toLowerCase() === name.toLowerCase());
  if (exists) {
    setStatus("A preset with that name already exists.", "warn", true);
    return;
  }
  const id = `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  customPresets.push({ id, name, instruction });
  if (customPresetNameEl) {
    customPresetNameEl.value = "";
  }
  if (customPresetInstructionEl) {
    customPresetInstructionEl.value = "";
  }
  persistCustomPresets();
  setStatus("Custom preset added", "ok", true);
}

function persistCustomPresets() {
  renderCustomPresets();
  renderCustomPresetOptions();

  const current = currentSettings || {};
  const normalizedDefault = normalizePreset(current.defaultPreset || defaultPresetEl.value);
  defaultPresetEl.value = normalizedDefault;
  const shell = defaultPresetEl.closest(".csel");
  if (shell && shell._rebuildCustomSelect) {
    shell._rebuildCustomSelect();
  }

  window.clearTimeout(customSaveTimer);
  setStatus("Saving...");
  customSaveTimer = window.setTimeout(async () => {
    await savePartial({ customPresets: customPresets.slice(), defaultPreset: normalizedDefault });
  }, 250);
}

function renderCustomPresets() {
  if (!customPresetsListEl || !customPresetsEmptyEl) {
    return;
  }

  customPresetsListEl.textContent = "";
  for (const preset of customPresets) {
    const item = document.createElement("div");
    item.className = "custom-preset-item";

    const info = document.createElement("div");
    info.className = "custom-preset-info";

    const name = document.createElement("span");
    name.className = "custom-preset-name";
    name.textContent = preset.name;

    const desc = document.createElement("span");
    desc.className = "custom-preset-desc";
    desc.textContent = preset.instruction;

    info.appendChild(name);
    info.appendChild(desc);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "custom-chip-remove";
    removeButton.setAttribute("data-id", preset.id);
    removeButton.setAttribute("aria-label", `Remove preset: ${preset.name}`);
    removeButton.textContent = "x";

    item.appendChild(info);
    item.appendChild(removeButton);
    customPresetsListEl.appendChild(item);
  }

  customPresetsEmptyEl.hidden = customPresets.length > 0;
}

function renderCustomPresetOptions() {
  const existing = defaultPresetEl.querySelector('optgroup[data-custom="1"]');
  if (existing) {
    existing.remove();
  }
  if (!customPresets.length) {
    return;
  }
  const group = document.createElement("optgroup");
  group.label = "Custom";
  group.setAttribute("data-custom", "1");
  for (const preset of customPresets) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    group.appendChild(option);
  }
  defaultPresetEl.appendChild(group);
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

    const provider = normalizeProvider((currentSettings && currentSettings.provider) || providerSelectEl.value);
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
      type: "ASKBETTER_TEST_KEY",
      payload: {
        provider,
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
      applyModelAvailability();
      updateMissingKeyLinkVisibility();
      void refreshModelDropdown(provider);
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
  customPresets = normalized.customPresets.slice();
  providerSelectEl.value = normalizeProvider(normalized.provider);
  renderCustomPresetOptions();
  renderCustomPresets();
  defaultPresetEl.value = normalizePreset(normalized.defaultPreset);
  keepUserVoiceEl.checked = !!normalized.keepUserVoice;
  enableAIEl.checked = !!normalized.enableAI;
  enableAskBetterModeEl.checked = normalized.enableAskBetterMode !== false;
  enablePhraseBetterModeEl.checked = normalized.enablePhraseBetterMode !== false;
  phraseBetterOptionCountEl.value = String(normalized.phraseBetterOptionCount);
  enableChatGPTEl.checked = !!normalized.enableChatGPT;
  enableGeminiEl.checked = !!normalized.enableGemini;
  enableClaudeEl.checked = normalized.enableClaude !== false;
  customAdditions = splitAdditionsLines(normalized.customPromptAdditions || "");
  customPromptAdditionsEl.value = customAdditions.join("\n");
  if (customAdditionInputEl) {
    customAdditionInputEl.value = "";
  }
  renderCustomAdditions();
  syncQuickTagState();
  applyProviderUI();
  initCustomSelects();
  renderStatusSummary();
}

function applyProviderUI() {
  const provider = normalizeProvider((currentSettings && currentSettings.provider) || providerSelectEl.value);
  providerSelectEl.value = provider;
  const meta = getProviderMeta(provider);
  const modelValue = String(currentSettings[meta.modelField] || meta.defaultModel).trim() || meta.defaultModel;
  renderModelOptions(meta.models, modelValue);
  if (modelLabelEl) {
    modelLabelEl.textContent = meta.modelLabel;
  }
  void refreshModelDropdown(provider);

  const storedKey = String(currentSettings[meta.keyField] || "").trim();
  const verified = !!currentSettings[meta.verifiedField];
  keyLocked = verified && !!storedKey;

  apiKeyEl.value = keyLocked ? "" : storedKey;
  apiKeyEl.placeholder = keyLocked ? "Saved securely" : meta.keyPlaceholder;
  generateKeyLinkEl.href = meta.keyUrl;
  applyKeyLockState();
  applyModelAvailability();
  updateMissingKeyLinkVisibility();
  renderProviderInfo(provider);
}

// The model dropdown is only usable once the active provider's key is saved &
// verified (the live list can't load without a working key); otherwise it's
// disabled and a hint points the user at the key field.
function applyModelAvailability() {
  const available = keyLocked;
  modelSelectEl.disabled = !available;
  if (modelHintEl) {
    modelHintEl.hidden = available;
  }
  const modelShell = modelSelectEl.closest('.csel');
  if (modelShell && modelShell._syncCustomSelectDisabled) {
    modelShell._syncCustomSelectDisabled();
  }
}

function renderProviderInfo(provider) {
  if (!providerInfoEl) return;
  const info = PROVIDER_INFO[provider];
  if (!info) { providerInfoEl.innerHTML = ""; return; }
  const rows = info.rows.map(r =>
    `<div class="pi-row">` +
    `<span class="pi-label">${r.label}</span>` +
    `<span class="pi-val${r.ok ? " pi-ok" : r.warn ? " pi-warn" : ""}">${r.value}</span>` +
    `</div>`
  ).join("");
  providerInfoEl.innerHTML =
    `<div class="pi-rows">${rows}</div>` +
    `<p class="pi-note">${info.note}</p>`;
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
  const meta = getProviderMeta((currentSettings && currentSettings.provider) || providerSelectEl.value);
  generateKeyLinkEl.href = meta.keyUrl;
  const isMissingKey = !apiKeyEl.value.trim();
  generateKeyLinkEl.hidden = keyLocked || !isMissingKey;
}

function renderStatusSummary() {
  const meta = getProviderMeta((currentSettings && currentSettings.provider) || providerSelectEl.value);
  const hasKey = !!String(currentSettings && currentSettings[meta.keyField] || "").trim();
  if (!hasKey) {
    setStatus(`${meta.providerName} key missing.`, "warn");
    return;
  }
  setStatus(`${meta.providerName} ready.`, "ok", true);
}

// Pull the provider's live model list (cached 24h) and re-render the dropdown,
// self-healing the selection to the newest model if the stored one is gone.
async function refreshModelDropdown(provider) {
  const models = await refreshProviderModels(provider);
  const active = normalizeProvider((currentSettings && currentSettings.provider) || providerSelectEl.value);
  if (active !== normalizeProvider(provider)) {
    return;
  }
  const meta = getProviderMeta(active);
  const stored = String(currentSettings[meta.modelField] || meta.defaultModel).trim() || meta.defaultModel;
  const selected = chooseModel(models, stored);
  if (selected && selected !== stored) {
    await savePartial({ [meta.modelField]: selected }, { silentStatus: true });
  }
  renderModelOptions(models, selected);
}

function renderModelOptions(models, selected) {
  modelSelectEl.textContent = "";
  const list = Array.isArray(models) ? models : [];
  for (const model of list) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    modelSelectEl.appendChild(option);
  }
  if (selected && !list.includes(selected)) {
    // No live list yet (no key / offline) → show the stored model plainly;
    // otherwise it's a genuine off-list choice → mark it custom.
    const customOption = document.createElement("option");
    customOption.value = selected;
    customOption.textContent = list.length ? `${selected} (custom)` : selected;
    modelSelectEl.appendChild(customOption);
  }
  modelSelectEl.value = selected;
  const modelShell = modelSelectEl.closest('.csel');
  if (modelShell && modelShell._rebuildCustomSelect) {
    modelShell._rebuildCustomSelect();
  }
}

function getProviderMeta(provider) {
  const normalized = normalizeProvider(provider);
  if (normalized === "openai") {
    return {
      providerName: "OpenAI",
      keyField: "openaiApiKey",
      verifiedField: "openaiKeyVerified",
      modelField: "openaiModel",
      defaultModel: DEFAULT_SETTINGS.openaiModel,
      models: getProviderModels("openai"),
      keyUrl: OPENAI_KEY_URL,
      keyPlaceholder: "sk-...",
      modelLabel: "OpenAI model"
    };
  }
  if (normalized === "anthropic") {
    return {
      providerName: "Anthropic",
      keyField: "anthropicApiKey",
      verifiedField: "anthropicKeyVerified",
      modelField: "anthropicModel",
      defaultModel: DEFAULT_SETTINGS.anthropicModel,
      models: getProviderModels("anthropic"),
      keyUrl: ANTHROPIC_KEY_URL,
      keyPlaceholder: "sk-ant-...",
      modelLabel: "Claude model"
    };
  }
  return {
    providerName: "Gemini",
    keyField: "geminiApiKey",
    verifiedField: "geminiKeyVerified",
    modelField: "geminiModel",
    defaultModel: DEFAULT_SETTINGS.geminiModel,
    models: getProviderModels("gemini"),
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
    provider: normalizeProvider(raw.provider),
    geminiApiKey: String(raw.geminiApiKey || ""),
    geminiModel: normalizeModel(raw.geminiModel, DEFAULT_SETTINGS.geminiModel),
    geminiKeyVerified: !!raw.geminiKeyVerified,
    openaiApiKey: String(raw.openaiApiKey || ""),
    openaiModel: normalizeModel(raw.openaiModel, DEFAULT_SETTINGS.openaiModel),
    openaiKeyVerified: !!raw.openaiKeyVerified,
    anthropicApiKey: String(raw.anthropicApiKey || ""),
    anthropicModel: normalizeModel(raw.anthropicModel, DEFAULT_SETTINGS.anthropicModel),
    anthropicKeyVerified: !!raw.anthropicKeyVerified,
    defaultPreset: normalizePreset(raw.defaultPreset, normalizeCustomPresets(raw.customPresets)),
    enableChatGPT: raw.enableChatGPT !== false,
    enableGemini: raw.enableGemini !== false,
    enableClaude: raw.enableClaude !== false,
    enableAskBetterMode: raw.enableAskBetterMode !== false,
    enablePhraseBetterMode: raw.enablePhraseBetterMode !== false,
    phraseBetterOptionCount: normalizePhraseBetterOptionCount(raw.phraseBetterOptionCount),
    enableAI: raw.enableAI !== false,
    keepUserVoice: !!raw.keepUserVoice,
    keyVerified: !!raw.keyVerified,
    customPromptAdditions: String(raw.customPromptAdditions || ""),
    customPresets: normalizeCustomPresets(raw.customPresets)
  };
}

function normalizePhraseBetterOptionCount(value) {
  const count = Math.round(Number(value));
  if (!Number.isFinite(count) || count < 1) {
    return DEFAULT_SETTINGS.phraseBetterOptionCount;
  }
  if (count > 3) {
    return 3;
  }
  return count;
}

function normalizePreset(value, presetList) {
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
  const list = Array.isArray(presetList) ? presetList : customPresets;
  if (list.some((item) => item.id === String(value || ""))) {
    return String(value || "");
  }
  return DEFAULT_SETTINGS.defaultPreset;
}

function normalizeCustomPresets(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const result = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const id = String(raw.id || "").trim();
    const name = String(raw.name || "").replace(/\s+/g, " ").trim();
    const instruction = String(raw.instruction || "").trim();
    if (!id || !name || !instruction || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push({ id, name, instruction });
  }
  return result;
}

function normalizeModel(model, fallback) {
  const value = String(model || "").trim();
  return value || fallback;
}

function normalizeProvider(value) {
  const provider = String(value || "").toLowerCase();
  if (provider === "openai" || provider === "anthropic") {
    return provider;
  }
  return "gemini";
}

function initCustomSelects() {
  document.querySelectorAll('.csel').forEach(shell => buildCustomSelect(shell));
}

function buildCustomSelect(shell) {
  const select = shell.querySelector('select');
  if (!select) return;

  shell.querySelectorAll('.csel-trigger, .csel-panel').forEach(el => el.remove());

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'csel-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML =
    '<span class="csel-val"></span>' +
    '<span class="csel-chevron-sep"></span>' +
    '<svg class="csel-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
    '<path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  const panel = document.createElement('div');
  panel.className = 'csel-panel';
  panel.setAttribute('role', 'listbox');
  panel.hidden = true;

  shell.insertBefore(trigger, select);
  shell.insertBefore(panel, select);

  function buildOptions() {
    panel.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const child of select.children) {
      if (child.tagName === 'OPTGROUP') {
        const grp = document.createElement('div');
        grp.className = 'csel-group';
        grp.textContent = child.label;
        frag.appendChild(grp);
        for (const opt of child.children) frag.appendChild(makeItem(opt));
      } else if (child.tagName === 'OPTION') {
        frag.appendChild(makeItem(child));
      }
    }
    panel.appendChild(frag);
  }

  function makeItem(opt) {
    const item = document.createElement('div');
    item.className = 'csel-item';
    item.dataset.value = opt.value;
    item.setAttribute('role', 'option');
    if (opt.dataset.icon) {
      const img = document.createElement('img');
      img.className = 'csel-icon';
      img.src = opt.dataset.icon;
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      const sep = document.createElement('span');
      sep.className = 'csel-sep';
      const txt = document.createElement('span');
      txt.textContent = opt.textContent;
      item.appendChild(img);
      item.appendChild(sep);
      item.appendChild(txt);
    } else {
      item.textContent = opt.textContent;
    }
    item.addEventListener('click', () => {
      select.value = opt.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      syncSelected();
      close();
    });
    return item;
  }

  function syncSelected() {
    const val = select.value;
    const selOpt = select.options[select.selectedIndex];
    trigger.querySelector('.csel-val').textContent = selOpt ? selOpt.textContent : '';
    // Update icon + sep in trigger
    trigger.querySelectorAll('.csel-icon, .csel-sep').forEach(el => el.remove());
    if (selOpt && selOpt.dataset.icon) {
      const sep = document.createElement('span');
      sep.className = 'csel-sep';
      const img = document.createElement('img');
      img.className = 'csel-icon';
      img.src = selOpt.dataset.icon;
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      trigger.prepend(sep);
      trigger.prepend(img);
    }
    panel.querySelectorAll('.csel-item').forEach(item => {
      const active = item.dataset.value === val;
      item.classList.toggle('is-selected', active);
      item.setAttribute('aria-selected', String(active));
    });
  }

  function open() {
    if (select.disabled) return;
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    shell.classList.add('is-open');
    const sel = panel.querySelector('.csel-item.is-selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function close() {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    shell.classList.remove('is-open');
  }

  // Mirror the native <select>'s disabled state onto the custom UI.
  function syncDisabled() {
    const disabled = !!select.disabled;
    trigger.disabled = disabled;
    shell.classList.toggle('csel--disabled', disabled);
    if (disabled) close();
  }

  trigger.addEventListener('click', e => {
    e.stopPropagation();
    panel.hidden ? open() : close();
  });

  document.addEventListener('click', e => {
    if (!shell.contains(e.target)) close();
  });

  buildOptions();
  syncSelected();
  syncDisabled();

  shell._rebuildCustomSelect = () => {
    buildOptions();
    syncSelected();
    syncDisabled();
  };
  shell._syncCustomSelectDisabled = syncDisabled;
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
