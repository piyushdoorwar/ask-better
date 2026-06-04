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

let customPresets = [];

const GEMINI_KEY_URL = "https://aistudio.google.com/apikey";
const OPENAI_KEY_URL = "https://platform.openai.com/api-keys";
const ANTHROPIC_KEY_URL = "https://console.anthropic.com/settings/keys";
// Curated model lists (GEMINI_MODELS / OPENAI_MODELS / ANTHROPIC_MODELS) and the
// live-fetch/merge/cache helpers live in models.js, loaded before this script.

const statusBox = document.getElementById("statusBox");
const statusText = document.getElementById("statusText");
const defaultPresetEl = document.getElementById("defaultPreset");
const keepUserVoiceEl = document.getElementById("keepUserVoice");
const providerSelectEl = document.getElementById("providerSelect");
const modelLabelEl = document.getElementById("modelLabel");
const modelSelectEl = document.getElementById("modelSelect");
const modelHintEl = document.getElementById("modelHint");
const openSettingsBtn = document.getElementById("openSettingsBtn");

init().catch(() => {
  statusText.textContent = "Unable to load settings.";
  statusText.className = "status-warn";
});

async function init() {
  const settings = await readSettings();
  customPresets = settings.customPresets.slice();
  renderStatus(settings);
  renderCustomPresetOptions();
  defaultPresetEl.value = normalizePreset(settings.defaultPreset);
  providerSelectEl.value = normalizeProvider(settings.provider);
  const model = getProviderModel(settings);
  renderModelOptions(model);
  applyModelAvailability(settings);
  void refreshModelDropdown(normalizeProvider(settings.provider));
  keepUserVoiceEl.checked = !!settings.keepUserVoice;

  initCustomSelects();

  defaultPresetEl.addEventListener("change", async () => {
    await updateSettings({ defaultPreset: normalizePreset(defaultPresetEl.value) });
  });

  keepUserVoiceEl.addEventListener("change", async () => {
    await updateSettings({ keepUserVoice: !!keepUserVoiceEl.checked });
  });

  providerSelectEl.addEventListener("change", async () => {
    const provider = normalizeProvider(providerSelectEl.value);
    const current = await readSettings();
    const meta = getProviderMeta(provider);
    await updateSettings({
      provider,
      [meta.modelField]: normalizeModel(current[meta.modelField], meta.defaultModel)
    });
    const nextSettings = await readSettings();
    renderStatus(nextSettings);
    renderModelOptions(getProviderModel(nextSettings));
    applyModelAvailability(nextSettings);
    void refreshModelDropdown(provider);
  });

  modelSelectEl.addEventListener("change", async () => {
    const meta = getProviderMeta(providerSelectEl.value);
    await updateSettings({ [meta.modelField]: normalizeModel(modelSelectEl.value, meta.defaultModel) });
  });

  openSettingsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

function renderStatus(settings) {
  const meta = getProviderMeta(settings.provider);
  const hasKey = !!String(settings[meta.keyField] || "").trim();

  
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
  
}

async function readSettings() {
  const stored = await chrome.storage.local.get(["settings"]);
  const raw = stored.settings || {};
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

async function updateSettings(partial) {
  const current = await readSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ settings: next });
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

// Pull the provider's live model list (cached 24h) and re-render the dropdown,
// self-healing the selection to the newest model if the stored one is gone.
async function refreshModelDropdown(provider) {
  const models = await refreshProviderModels(provider);
  if (normalizeProvider(providerSelectEl.value) !== normalizeProvider(provider)) {
    return;
  }
  const meta = getProviderMeta(provider);
  const current = await readSettings();
  const stored = normalizeModel(current[meta.modelField], meta.defaultModel);
  const selected = chooseModel(models, stored);
  if (selected && selected !== stored) {
    await updateSettings({ [meta.modelField]: selected });
  }
  renderModelOptions(selected);
}

function renderModelOptions(selectedModel) {
  const meta = getProviderMeta(providerSelectEl.value);
  if (modelLabelEl) {
    modelLabelEl.textContent = meta.modelLabel;
  }
  modelSelectEl.textContent = "";
  const list = Array.isArray(meta.models) ? meta.models : [];
  for (const model of list) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    modelSelectEl.appendChild(option);
  }
  if (selectedModel && !list.includes(selectedModel)) {
    // No live list yet (no key / offline) → show the stored model plainly;
    // otherwise it's a genuine off-list choice → mark it custom.
    const option = document.createElement("option");
    option.value = selectedModel;
    option.textContent = list.length ? `${selectedModel} (custom)` : selectedModel;
    modelSelectEl.appendChild(option);
  }
  modelSelectEl.value = selectedModel;
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
    modelLabel: "Gemini model"
  };
}

// The model dropdown is only usable once the active provider's key is saved &
// verified; otherwise it's disabled and a hint points the user to settings.
function applyModelAvailability(settings) {
  const meta = getProviderMeta(settings.provider);
  const available = !!settings[meta.verifiedField] && !!String(settings[meta.keyField] || "").trim();
  modelSelectEl.disabled = !available;
  if (modelHintEl) {
    modelHintEl.hidden = available;
  }
  const modelShell = modelSelectEl.closest('.csel');
  if (modelShell && modelShell._syncCustomSelectDisabled) {
    modelShell._syncCustomSelectDisabled();
  }
}

function getProviderModel(settings) {
  const meta = getProviderMeta(settings.provider);
  return normalizeModel(settings[meta.modelField], meta.defaultModel);
}

function normalizeProvider(value) {
  const provider = String(value || "").toLowerCase();
  if (provider === "openai" || provider === "anthropic") {
    return provider;
  }
  return "gemini";
}

function normalizeModel(value, fallback) {
  const model = String(value || "").trim();
  return model || fallback;
}

function initCustomSelects() {
  document.querySelectorAll('.csel').forEach(shell => buildCustomSelect(shell));
}

function buildCustomSelect(shell) {
  const select = shell.querySelector('select');
  if (!select) return;

  // Remove any previously injected UI
  shell.querySelectorAll('.csel-trigger, .csel-panel').forEach(el => el.remove());

  // Trigger button
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

  // Panel
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

  // Expose for external rebuild (e.g. after renderModelOptions repopulates options)
  shell._rebuildCustomSelect = () => {
    buildOptions();
    syncSelected();
    syncDisabled();
  };
  shell._syncCustomSelectDisabled = syncDisabled;
}
