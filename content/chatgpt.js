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

    activeInput = input;
    await ensureOffsetLoaded();
    positionButton(input);
    button.style.display = "inline-flex";
  }

  function findPromptInput(candidates) {
    for (const selector of candidates) {
      const elements = Array.from(document.querySelectorAll(selector));
      for (const element of elements) {
        if (isUsableInput(element)) {
          return element;
        }
      }
    }
    return null;
  }

  function isUsableInput(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 24) {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") {
      return false;
    }
    return true;
  }

  function positionButton(input) {
    if (!button) {
      return;
    }
    const rect = input.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const top = window.scrollY + rect.bottom - buttonRect.height - 10 + buttonOffset.y;
    const left = window.scrollX + rect.right - buttonRect.width - 10 + buttonOffset.x;
    button.style.top = `${Math.max(8, top)}px`;
    button.style.left = `${Math.max(8, left)}px`;
  }

  function hideButton() {
    activeInput = null;
    if (button) {
      button.style.display = "none";
    }
  }

  async function onOptimizeClick(event) {
    if (suppressNextClick) {
      suppressNextClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!activeInput || !button) {
      return;
    }

    const prompt = readInputValue(activeInput);
    if (!prompt.trim()) {
      showToast("Prompt is empty.");
      return;
    }

    const settings = await getPublicSettings(true);
    const preset = settings && settings.defaultPreset ? settings.defaultPreset : "structured";

    setBusy(true);
    const response = await sendMessage({
      type: "ASKBETTER_OPTIMIZE",
      prompt,
      preset,
      site
    });
    setBusy(false);

    if (!response || !response.ok) {
      showToast((response && response.message) || "Unable to optimize.");
      return;
    }

    writeInputValue(activeInput, response.optimizedPrompt || "");
    showToast("Prompt optimized.");
  }

  function setBusy(busy) {
    if (!button) {
      return;
    }
    button.disabled = !!busy;
    button.classList.toggle("is-busy", !!busy);
    button.textContent = busy ? "Optimizing..." : BUTTON_LABEL;
  }

  function onPointerDown(event) {
    if (!button || event.button !== 0) {
      return;
    }
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: buttonOffset.x,
      originY: buttonOffset.y,
      moved: false
    };
    button.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!dragState || !button || dragState.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    if (!dragState.moved && Math.abs(deltaX) + Math.abs(deltaY) < 6) {
      return;
    }
    dragState.moved = true;
    buttonOffset = {
      x: clampOffset(dragState.originX + deltaX),
      y: clampOffset(dragState.originY + deltaY)
    };
    if (activeInput) {
      positionButton(activeInput);
    }
  }

  function onPointerUp(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }
    if (button && button.hasPointerCapture(event.pointerId)) {
      button.releasePointerCapture(event.pointerId);
    }
    suppressNextClick = dragState.moved;
    if (dragState.moved) {
      scheduleOffsetSave();
    }
    dragState = null;
  }

  function scheduleOffsetSave() {
    window.clearTimeout(offsetSaveTimer);
    offsetSaveTimer = window.setTimeout(async () => {
      await sendMessage({
        type: "ASKBETTER_SAVE_BUTTON_OFFSET",
        site,
        offset: buttonOffset
      });
    }, 180);
  }

  async function ensureOffsetLoaded() {
    if (offsetLoaded) {
      return;
    }
    offsetLoaded = true;
    const response = await sendMessage({
      type: "ASKBETTER_GET_BUTTON_OFFSET",
      site
    });
    if (response && response.ok && response.offset) {
      buttonOffset = {
        x: clampOffset(response.offset.x),
        y: clampOffset(response.offset.y)
      };
    }
  }

  async function getPublicSettings(force) {
    const now = Date.now();
    if (!force && settingsCache && now - settingsLoadedAt < 1500) {
      return settingsCache;
    }
    const response = await sendMessage({ type: "ASKBETTER_GET_PUBLIC_SETTINGS" });
    settingsCache = response && response.ok ? response.settings : null;
    settingsLoadedAt = now;
    return settingsCache;
  }

  function readInputValue(input) {
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      return input.value || "";
    }
    return input.textContent || "";
  }

  function writeInputValue(input, value) {
    const text = String(value || "");
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      input.focus();
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    input.focus();
    input.textContent = text;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
  }

  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "pf-optimize-toast";
    toast.textContent = String(message || "");
    document.body.appendChild(toast);
    window.setTimeout(() => {
      toast.classList.add("is-visible");
    }, 10);
    window.setTimeout(() => {
      toast.classList.remove("is-visible");
      window.setTimeout(() => toast.remove(), 180);
    }, 2200);
  }

  function clampOffset(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return 0;
    }
    return Math.max(-900, Math.min(900, Math.round(number)));
  }

  function sendMessage(payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, message: "Extension unavailable." });
          return;
        }
        resolve(response);
      });
    });
  }
}
