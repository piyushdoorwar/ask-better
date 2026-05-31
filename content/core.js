function startAskBetter(site, siteToggleKey, selectors) {
  const OPTIMIZE_TEXT = "Optimize";
  const BUSY_TEXT = "Optimizing…";
  const SPARKLE_SVG = '<svg viewBox="0 0 36 36" width="14" height="14" aria-hidden="true" focusable="false" style="display:block;fill:currentColor"><path d="M34.347 16.893l-8.899-3.294l-3.323-10.891a1 1 0 0 0-1.912 0l-3.322 10.891l-8.9 3.294a1 1 0 0 0 0 1.876l8.895 3.293l3.324 11.223a1 1 0 0 0 1.918-.001l3.324-11.223l8.896-3.293a.998.998 0 0 0-.001-1.875z"></path><path d="M14.347 27.894l-2.314-.856l-.9-3.3a.998.998 0 0 0-1.929-.001l-.9 3.3l-2.313.856a1 1 0 0 0 0 1.876l2.301.853l.907 3.622a1 1 0 0 0 1.94-.001l.907-3.622l2.301-.853a.997.997 0 0 0 0-1.874z"></path><path d="M10.009 6.231l-2.364-.875l-.876-2.365a.999.999 0 0 0-1.876 0l-.875 2.365l-2.365.875a1 1 0 0 0 0 1.876l2.365.875l.875 2.365a1 1 0 0 0 1.876 0l.875-2.365l2.365-.875a1 1 0 0 0 0-1.876z"></path></svg>';
  const BUTTON_INNER = `<span class="pf-optimize-icon" aria-hidden="true">${SPARKLE_SVG}</span><span class="pf-optimize-label">${OPTIMIZE_TEXT}</span>`;
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
  let isBusy = false;
  let busyIndicator = null;
  let previewCard = null;
  let previewState = null;

  scheduleSync();
  window.addEventListener("resize", scheduleSync, { passive: true });
  window.addEventListener("scroll", scheduleSync, { passive: true });
  window.addEventListener("focus", scheduleSync);
  document.addEventListener("keydown", onGlobalKeydown, true);

  if (
    typeof chrome !== "undefined" &&
    chrome.runtime &&
    chrome.runtime.onMessage &&
    typeof chrome.runtime.onMessage.addListener === "function"
  ) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.type === "ASKBETTER_TRIGGER_OPTIMIZE") {
        void onOptimizeClick();
      }
      return false;
    });
  }

  observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement || document.body, {
    subtree: true,
    childList: true,
    attributes: true
  });

  function ensureButton() {
    if (button && button.isConnected) {
      return;
    }
    button = document.createElement("button");
    button.type = "button";
    button.className = "pf-optimize-btn";
    button.innerHTML = BUTTON_INNER;
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
    if (!settings || !settings.enableAI || !settings.enableAskBetterMode || !settings[siteToggleKey]) {
      hideButton();
      return;
    }

    const input = findPromptInput(selectors);
    if (!input) {
      hideButton();
      return;
    }

    await ensureOffsetLoaded();
    ensureButton();
    activeInput = input;
    placeButtonNearInput(input);
    if (isBusy) {
      placeBusyIndicatorNearInput(input);
    }
    if (isPreviewOpen()) {
      placePreviewNearInput(input);
    }
    button.style.display = "inline-flex";
  }

  function hideButton() {
    if (button && button.isConnected) {
      button.style.display = "none";
    }
    hideBusyIndicator();
    activeInput = null;
  }

  function placeButtonNearInput(input) {
    if (!button || !button.isConnected) {
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
    if (!settings || !settings.enableAI || !settings.enableAskBetterMode || !settings.hasApiKey || !settings[siteToggleKey]) {
      showToast("AI disabled or key missing");
      return;
    }

    const prompt = readPromptText(targetInput).trim();
    if (!prompt) {
      showToast("Type a prompt first");
      return;
    }

    await requestOptimization(targetInput, prompt, settings.defaultPreset);
  }

  async function requestOptimization(targetInput, prompt, preset) {
    setBusy(true, targetInput);
    const response = await sendMessage({
      type: "ASKBETTER_OPTIMIZE",
      prompt,
      preset,
      site
    });
    setBusy(false, targetInput);

    if (!response || !response.ok) {
      const message = response && response.code === "DISABLED_OR_MISSING_KEY"
        ? "AI disabled or key missing"
        : (response && response.message) || "Optimization failed";
      showToast(message);
      return;
    }

    previewState = { input: targetInput, prompt, preset };
    showPreview(targetInput, response.optimizedPrompt);
  }

  function ensurePreviewCard() {
    if (previewCard && previewCard.isConnected) {
      return;
    }
    previewCard = document.createElement("div");
    previewCard.className = "pf-preview-card";
    previewCard.style.display = "none";
    previewCard.innerHTML = `
      <div class="pf-preview-head">
        <span class="pf-preview-title"><span class="pf-preview-icon" aria-hidden="true">${SPARKLE_SVG}</span>Optimize preview</span>
        <button type="button" class="pf-preview-close" data-action="discard" aria-label="Discard">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
            <path d="M6 6L18 18" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path>
            <path d="M18 6L6 18" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path>
          </svg>
        </button>
      </div>
      <textarea class="pf-preview-text" spellcheck="false"></textarea>
      <div class="pf-preview-actions">
        <button type="button" class="pf-preview-btn pf-preview-regenerate" data-action="regenerate">Regenerate</button>
        <span class="pf-preview-spacer"></span>
        <button type="button" class="pf-preview-btn pf-preview-discard" data-action="discard">Discard</button>
        <button type="button" class="pf-preview-btn pf-preview-accept" data-action="accept">Accept</button>
      </div>
    `;

    previewCard.addEventListener("pointerdown", (event) => event.stopPropagation());
    previewCard.addEventListener("click", (event) => {
      const trigger = event.target instanceof HTMLElement ? event.target.closest("[data-action]") : null;
      if (!trigger) {
        return;
      }
      const action = trigger.getAttribute("data-action");
      if (action === "accept") {
        acceptPreview();
      } else if (action === "discard") {
        closePreview();
      } else if (action === "regenerate") {
        regeneratePreview();
      }
    });

    document.body.appendChild(previewCard);
  }

  function showPreview(input, optimizedText) {
    ensurePreviewCard();
    const textarea = previewCard.querySelector(".pf-preview-text");
    if (textarea) {
      textarea.value = String(optimizedText || "");
    }
    setPreviewBusy(false);
    previewCard.style.display = "flex";
    placePreviewNearInput(input);
    if (textarea) {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
  }

  function isPreviewOpen() {
    return !!(previewCard && previewCard.isConnected && previewCard.style.display !== "none");
  }

  function placePreviewNearInput(input) {
    if (!previewCard || !previewCard.isConnected || !input) {
      return;
    }
    const rect = input.getBoundingClientRect();
    const cardRect = previewCard.getBoundingClientRect();
    const width = Math.max(280, Math.round(cardRect.width || 360));
    const height = Math.max(160, Math.round(cardRect.height || 220));

    let top = rect.top - height - 10;
    if (top < 8) {
      top = clamp(rect.bottom + 10, 8, Math.max(8, window.innerHeight - height - 8));
    }
    const left = clamp(rect.left, 8, Math.max(8, window.innerWidth - width - 8));

    previewCard.style.top = `${top}px`;
    previewCard.style.left = `${left}px`;
  }

  function setPreviewBusy(busy) {
    if (!previewCard) {
      return;
    }
    previewCard.classList.toggle("pf-preview-is-busy", !!busy);
    previewCard.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.disabled = !!busy;
    });
    const regenerate = previewCard.querySelector(".pf-preview-regenerate");
    if (regenerate) {
      regenerate.textContent = busy ? "Regenerating..." : "Regenerate";
    }
  }

  function acceptPreview() {
    if (!previewState || !previewCard) {
      closePreview();
      return;
    }
    const textarea = previewCard.querySelector(".pf-preview-text");
    const nextText = textarea ? textarea.value : "";
    const input = previewState.input && document.contains(previewState.input)
      ? previewState.input
      : findPromptInput(selectors);
    closePreview();
    if (!input) {
      showToast("Prompt box not found");
      return;
    }
    writePromptText(input, nextText);
    showToast("Prompt optimized");
  }

  async function regeneratePreview() {
    if (!previewState || !previewCard) {
      return;
    }
    const input = previewState.input && document.contains(previewState.input)
      ? previewState.input
      : findPromptInput(selectors);
    if (!input) {
      showToast("Prompt box not found");
      return;
    }
    setPreviewBusy(true);
    const response = await sendMessage({
      type: "ASKBETTER_OPTIMIZE",
      prompt: previewState.prompt,
      preset: previewState.preset,
      site
    });
    if (!isPreviewOpen()) {
      return;
    }
    setPreviewBusy(false);
    if (!response || !response.ok) {
      showToast((response && response.message) || "Optimization failed");
      return;
    }
    const textarea = previewCard.querySelector(".pf-preview-text");
    if (textarea) {
      textarea.value = String(response.optimizedPrompt || "");
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
  }

  function closePreview() {
    previewState = null;
    if (previewCard && previewCard.isConnected) {
      previewCard.style.display = "none";
      setPreviewBusy(false);
    }
  }

  function onGlobalKeydown(event) {
    if (event.key === "Escape" && isPreviewOpen()) {
      event.stopPropagation();
      closePreview();
    }
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

  function ensureBusyIndicator() {
    if (busyIndicator && busyIndicator.isConnected) {
      return;
    }
    busyIndicator = document.createElement("div");
    busyIndicator.id = "pf-busy-indicator";
    busyIndicator.className = "pf-busy-indicator";
    busyIndicator.innerHTML = `
      <span class="pf-busy-spinner" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <circle class="pf-busy-track" cx="12" cy="12" r="8.5"></circle>
          <circle class="pf-busy-head pf-busy-head-top" cx="12" cy="3.5" r="2"></circle>
          <circle class="pf-busy-head pf-busy-head-right" cx="20.5" cy="12" r="2"></circle>
          <circle class="pf-busy-head pf-busy-head-bottom" cx="12" cy="20.5" r="2"></circle>
          <circle class="pf-busy-head pf-busy-head-left" cx="3.5" cy="12" r="2"></circle>
        </svg>
      </span>
      <span class="pf-busy-text">AskBetter is working…</span>
    `;
    busyIndicator.style.display = "none";
    document.body.appendChild(busyIndicator);
  }

  function placeBusyIndicatorNearInput(input) {
    if (!busyIndicator || !busyIndicator.isConnected || !input) {
      return;
    }
    const rect = input.getBoundingClientRect();
    const indicatorRect = busyIndicator.getBoundingClientRect();
    const width = Math.max(160, Math.round(indicatorRect.width || 176));
    const height = Math.max(30, Math.round(indicatorRect.height || 34));
    const top = clamp(rect.top - height - 10, 8, Math.max(8, window.innerHeight - height - 8));
    const left = clamp(rect.left, 8, Math.max(8, window.innerWidth - width - 8));
    busyIndicator.style.top = `${top}px`;
    busyIndicator.style.left = `${left}px`;
  }

  function showBusyIndicator(input) {
    ensureBusyIndicator();
    placeBusyIndicatorNearInput(input);
    busyIndicator.style.display = "inline-flex";
  }

  function hideBusyIndicator() {
    if (busyIndicator && busyIndicator.isConnected) {
      busyIndicator.style.display = "none";
    }
  }

  function setBusy(nextBusy, input) {
    isBusy = !!nextBusy;
    if (button && button.isConnected) {
      button.disabled = isBusy;
      button.classList.toggle("pf-is-busy", isBusy);
      const label = button.querySelector(".pf-optimize-label");
      if (label) {
        label.textContent = isBusy ? BUSY_TEXT : OPTIMIZE_TEXT;
      }
    }
    if (isBusy) {
      showBusyIndicator(input || activeInput);
    } else {
      hideBusyIndicator();
    }
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
