(function () {
  const SITE = "chatgpt";
  const ENABLE_KEY = "enableChatGPT";
  const SELECTORS = [
    "textarea#prompt-textarea",
    "div#prompt-textarea[contenteditable='true']",
    "div#prompt-textarea.ProseMirror[contenteditable='true']",
    "div[data-testid='composer-input'][contenteditable='true']",
    "div[data-testid='prompt-textarea'][contenteditable='true']",
    "textarea[placeholder*='Ask']",
    "textarea[placeholder*='Message']",
    "textarea[aria-label*='Ask']",
    "textarea[aria-label*='Message']",
    "textarea[data-id='root']",
    "div[contenteditable='true'][role='textbox'][aria-label*='Ask']",
    "div[contenteditable='true'][role='textbox'][aria-label*='Message']",
    "div[contenteditable='true'][aria-label*='Ask']",
    "div[contenteditable='true'][aria-label*='Message']",
    "div[contenteditable='true'][role='textbox']"
  ];

  startAskBetter(SITE, ENABLE_KEY, SELECTORS);
})();

function startAskBetter(site, siteToggleKey, selectors) {
  let button = null;
  let activeInput = null;
  let settingsCache = null;
  let settingsLoadedAt = 0;
  let rafToken = 0;
  let observer = null;

  ensureButton();
  scheduleSync();
  window.addEventListener("resize", scheduleSync, { passive: true });
  window.addEventListener("scroll", scheduleSync, { passive: true });
  window.addEventListener("focus", scheduleSync);

  observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement || document.body, {
    subtree: true,
    childList: true,
    attributes: true
  });

  function ensureButton() {
    if (button) {
      return;
    }
    button = document.createElement("button");
    button.type = "button";
    button.className = "pf-optimize-btn";
    button.textContent = "✨ Optimize";
    button.style.display = "none";
    button.addEventListener("click", onOptimizeClick);
    document.body.appendChild(button);
  }

  function scheduleSync() {
    if (rafToken) {
      return;
    }
    rafToken = window.requestAnimationFrame(async () => {
      rafToken = 0;
      await syncButton();
    });
  }

  async function syncButton() {
    const settings = await getPublicSettings(false);
    if (!settings || !settings.enableAI || !settings[siteToggleKey]) {
      hideButton();
      return;
    }

    const input = findPromptInput(selectors);
    if (!input) {
      hideButton();
      return;
    }

    activeInput = input;
    placeButtonNearInput(input);
    button.style.display = "inline-flex";
  }

  function hideButton() {
    if (button) {
      button.style.display = "none";
    }
    activeInput = null;
  }

  function placeButtonNearInput(input) {
    const rect = input.getBoundingClientRect();
    const top = Math.max(8, rect.top - 36);
    const left = Math.max(8, Math.min(window.innerWidth - 132, rect.right - 128));
    button.style.top = `${top}px`;
    button.style.left = `${left}px`;
  }

  async function onOptimizeClick() {
    const targetInput = activeInput && document.contains(activeInput) ? activeInput : findPromptInput(selectors);
    if (!targetInput) {
      return;
    }

    const settings = await getPublicSettings(true);
    if (!settings || !settings.enableAI || !settings.hasApiKey || !settings[siteToggleKey]) {
      showToast("AI disabled or key missing");
      return;
    }

    const prompt = readPromptText(targetInput).trim();
    if (!prompt) {
      showToast("Type a prompt first");
      return;
    }

    setBusy(true);
    const response = await sendMessage({
      type: "ASKBETTER_OPTIMIZE",
      prompt,
      preset: settings.defaultPreset,
      site
    });
    setBusy(false);

    if (!response || !response.ok) {
      const message = response && response.code === "DISABLED_OR_MISSING_KEY"
        ? "AI disabled or key missing"
        : (response && response.message) || "Optimization failed";
      showToast(message);
      return;
    }

    writePromptText(targetInput, response.optimizedPrompt);
    showToast("Prompt optimized");
  }

  async function getPublicSettings(forceRefresh) {
    const now = Date.now();
    if (!forceRefresh && settingsCache && now - settingsLoadedAt < 5000) {
      return settingsCache;
    }
    const response = await sendMessage({ type: "ASKBETTER_GET_PUBLIC_SETTINGS" });
    if (response && response.ok && response.settings) {
      settingsCache = response.settings;
      settingsLoadedAt = now;
      return settingsCache;
    }
    return settingsCache;
  }

  function setBusy(isBusy) {
    if (!button) {
      return;
    }
    button.disabled = !!isBusy;
    button.classList.toggle("pf-is-busy", !!isBusy);
    button.textContent = isBusy ? "Optimizing..." : "✨ Optimize";
  }
}

function findPromptInput(selectors) {
  for (const selector of selectors) {
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      if (isEligiblePromptInput(node)) {
        return node;
      }
    }
  }

  const active = document.activeElement;
  if (isEligiblePromptInput(active)) {
    return active;
  }

  const fallbackSelectors = [
    "form div[contenteditable='true']",
    "main div[contenteditable='true']",
    "form textarea",
    "main textarea"
  ];
  for (const selector of fallbackSelectors) {
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      if (isEligiblePromptInput(node)) {
        return node;
      }
    }
  }

  return null;
}

function isEligiblePromptInput(node) {
  if (!(node instanceof HTMLElement)) {
    return false;
  }
  const rect = node.getBoundingClientRect();
  if (!rect || rect.width < 160 || rect.height < 24) {
    return false;
  }
  if (rect.bottom < 0 || rect.top > window.innerHeight) {
    return false;
  }
  if (node instanceof HTMLInputElement) {
    return node.type === "text" && !node.disabled && !node.readOnly;
  }
  if (node instanceof HTMLTextAreaElement) {
    return !node.disabled && !node.readOnly;
  }
  return node.isContentEditable;
}

function readPromptText(node) {
  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
    return node.value || "";
  }
  if (node.isContentEditable) {
    return node.innerText || "";
  }
  return "";
}

function writePromptText(node, value) {
  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
    const prototype = Object.getPrototypeOf(node);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(node, value);
    } else {
      node.value = value;
    }
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  if (node.isContentEditable) {
    node.focus();
    node.textContent = value;
    node.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
  }
}

function sendMessage(payload) {
  return new Promise((resolve) => {
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      resolve({ ok: false, message: "Extension runtime unavailable." });
      return;
    }
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, message: "Background worker unavailable." });
        return;
      }
      resolve(response);
    });
  });
}

function showToast(message) {
  let toast = document.getElementById("pf-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "pf-toast";
    toast.className = "pf-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("pf-toast-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("pf-toast-visible");
  }, 1800);
}
