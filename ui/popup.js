const DEFAULT_SETTINGS = {
  provider: "gemini",
  geminiApiKey: "",
  geminiModel: "gemini-3-flash-preview",
  geminiKeyVerified: false,
  openaiApiKey: "",
  openaiModel: "gpt-5.2",
  openaiKeyVerified: false,
  anthropicApiKey: "",
  anthropicModel: "claude-sonnet-4-20250514",
  anthropicKeyVerified: false,
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
const OPENAI_KEY_URL = "https://platform.openai.com/api-keys";
const ANTHROPIC_KEY_URL = "https://console.anthropic.com/settings/keys";
const GEMINI_MODELS = [
  "gemini-3-flash-preview",
  "gemini-3-pro-preview",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash"
];
const OPENAI_MODELS = ["gpt-5.2", "gpt-5-mini", "gpt-4.1"];
const ANTHROPIC_MODELS = [
  "claude-sonnet-4-20250514",
  "claude-opus-4-1-20250805",
  "claude-3-7-sonnet-latest",
  "claude-3-5-haiku-latest"
];

const statusBox = document.getElementById("statusBox");
const statusText = document.getElementById("statusText");
const defaultPresetEl = document.getElementById("defaultPreset");
const keepUserVoiceEl = document.getElementById("keepUserVoice");
const providerSelectEl = document.getElementById("providerSelect");
const modelLabelEl = document.getElementById("modelLabel");
const modelSelectEl = document.getElementById("modelSelect");
const openSettingsBtn = document.getElementById("openSettingsBtn");

init().catch(() => {
  statusText.textContent = "Unable to load settings.";
  statusText.className = "status-warn";
});

async function init() {
  const settings = await readSettings();
  renderStatus(settings);
  defaultPresetEl.value = normalizePreset(settings.defaultPreset);
  providerSelectEl.value = normalizeProvider(settings.provider);
  const model = getProviderModel(settings);
  renderModelOptions(model);
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
  const meta = getProviderMeta(providerSelectEl.value);
  if (modelLabelEl) {
    modelLabelEl.textContent = meta.modelLabel;
  }
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
      modelField: "openaiModel",
      defaultModel: DEFAULT_SETTINGS.openaiModel,
      models: OPENAI_MODELS,
      keyUrl: OPENAI_KEY_URL,
      modelLabel: "OpenAI model"
    };
  }
  if (normalized === "anthropic") {
    return {
      providerName: "Anthropic",
      keyField: "anthropicApiKey",
      modelField: "anthropicModel",
      defaultModel: DEFAULT_SETTINGS.anthropicModel,
      models: ANTHROPIC_MODELS,
      keyUrl: ANTHROPIC_KEY_URL,
      modelLabel: "Claude model"
    };
  }
  return {
    providerName: "Gemini",
    keyField: "geminiApiKey",
    modelField: "geminiModel",
    defaultModel: DEFAULT_SETTINGS.geminiModel,
    models: GEMINI_MODELS,
    keyUrl: GEMINI_KEY_URL,
    modelLabel: "Gemini model"
  };
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

  trigger.addEventListener('click', e => {
    e.stopPropagation();
    panel.hidden ? open() : close();
  });

  document.addEventListener('click', e => {
    if (!shell.contains(e.target)) close();
  });

  buildOptions();
  syncSelected();

  // Expose for external rebuild (e.g. after renderModelOptions repopulates options)
  shell._rebuildCustomSelect = () => {
    buildOptions();
    syncSelected();
  };
}
