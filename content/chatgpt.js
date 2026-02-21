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
  const BUTTON_LABEL = "\u2728 Optimize";
  const DEFAULT_OFFSET = { x: 0, y: 0 };

  let button = null;
  let activeInput = null;
  let settingsCache = null;
  let settingsLoadedAt = 0;
  let rafToken = 0;
  let observer = null;
  let buttonOffset = { ...DEFAULT_OFFSET };
  let offsetLoaded = false;
  let offsetSaveTimer = 0;
  let dragState = null;
  let suppressNextClick = false;

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
    button.textContent = BUTTON_LABEL;
    button.style.display = "none";
    button.addEventListener("pointerdown", onPointerDown);
    button.addEventListener("pointermove", onPointerMove);
    button.addEventListener("pointerup", onPointerUp);
    button.addEventListener("pointercancel", onPointerUp);
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

    await ensureOffsetLoaded();
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
    if (!button) {
      return;
    }

    const rect = input.getBoundingClientRect();
    const btnRect = button.getBoundingClientRect();
    const buttonWidth = Math.max(96, Math.round(btnRect.width || 116));
    const buttonHeight = Math.max(30, Math.round(btnRect.height || 32));

    const baseTop = rect.top - buttonHeight - 6;
    const baseLeft = rect.right - buttonWidth - 6;

    const top = clamp(baseTop + buttonOffset.y, 8, Math.max(8, window.innerHeight - buttonHeight - 8));
    const left = clamp(baseLeft + buttonOffset.x, 8, Math.max(8, window.innerWidth - buttonWidth - 8));

    button.style.top = `${top}px`;
    button.style.left = `${left}px`;
  }

  async function onOptimizeClick() {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }

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

  async function ensureOffsetLoaded() {
    if (offsetLoaded) {
      return;
    }
    offsetLoaded = true;
    const response = await sendMessage({ type: "ASKBETTER_GET_BUTTON_OFFSET", site });
    if (response && response.ok && response.offset) {
      buttonOffset = normalizeOffset(response.offset);
    }
  }

  function onPointerDown(event) {
    if (!button || button.disabled || event.button !== 0) {
      return;
    }

    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: buttonOffset.x,
      startOffsetY: buttonOffset.y,
      moved: false
    };

    button.classList.add("pf-is-dragging");
    if (typeof button.setPointerCapture === "function") {
      button.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!dragState || !button || event.pointerId !== dragState.pointerId) {
      return;
    }

    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;

    if (!dragState.moved && Math.abs(dx) + Math.abs(dy) < 3) {
      return;
    }

    dragState.moved = true;
    buttonOffset = normalizeOffset({
      x: dragState.startOffsetX + dx,
      y: dragState.startOffsetY + dy
    });

    if (activeInput) {
      placeButtonNearInput(activeInput);
    }

    scheduleOffsetSave(false);
  }

  function onPointerUp(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    const didMove = dragState.moved;
    dragState = null;

    if (button) {
      button.classList.remove("pf-is-dragging");
      if (typeof button.releasePointerCapture === "function") {
        try {
          button.releasePointerCapture(event.pointerId);
        } catch (_error) {
          // ignore release errors
        }
      }
    }

    if (didMove) {
      suppressNextClick = true;
      scheduleOffsetSave(true);
    }
  }

  function scheduleOffsetSave(forceNow) {
    window.clearTimeout(offsetSaveTimer);
    const delay = forceNow ? 0 : 180;
    offsetSaveTimer = window.setTimeout(() => {
      void sendMessage({
        type: "ASKBETTER_SAVE_BUTTON_OFFSET",
        site,
        offset: buttonOffset
      });
    }, delay);
  }

  function setBusy(isBusy) {
    if (!button) {
      return;
    }
    button.disabled = !!isBusy;
    button.classList.toggle("pf-is-busy", !!isBusy);
    button.textContent = isBusy ? "Optimizing..." : BUTTON_LABEL;
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
    try {
      if (
        typeof chrome === "undefined" ||
        !chrome.runtime ||
        !chrome.runtime.id ||
        typeof chrome.runtime.sendMessage !== "function"
      ) {
        resolve({ ok: false, message: "Extension runtime unavailable." });
        return;
      }

      chrome.runtime.sendMessage(payload, (response) => {
        try {
          const runtimeError = chrome.runtime && chrome.runtime.lastError;
          if (runtimeError) {
            const rawMessage = String(runtimeError.message || "");
            const invalidated = /extension context invalidated/i.test(rawMessage);
            resolve({
              ok: false,
              code: invalidated ? "EXTENSION_CONTEXT_INVALIDATED" : "RUNTIME_ERROR",
              message: invalidated
                ? "Extension was reloaded. Refresh this tab."
                : "Background worker unavailable."
            });
            return;
          }
          resolve(response);
        } catch (_error) {
          resolve({ ok: false, message: "Extension runtime unavailable." });
        }
      });
    } catch (error) {
      const rawMessage = String((error && error.message) || "");
      const invalidated = /extension context invalidated/i.test(rawMessage);
      resolve({
        ok: false,
        code: invalidated ? "EXTENSION_CONTEXT_INVALIDATED" : "RUNTIME_ERROR",
        message: invalidated
          ? "Extension was reloaded. Refresh this tab."
          : "Extension runtime unavailable."
      });
    }
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

function normalizeOffset(rawOffset) {
  return {
    x: clamp(Number(rawOffset && rawOffset.x) || 0, -900, 900),
    y: clamp(Number(rawOffset && rawOffset.y) || 0, -900, 900)
  };
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
