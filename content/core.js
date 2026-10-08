// options.acceptInput(node) — optional site-specific predicate; a candidate
// prompt input is used only when it returns true (keeps this engine generic).
function startAskBetter(site, siteToggleKey, selectors, options) {
  const acceptInput = options && typeof options.acceptInput === "function" ? options.acceptInput : null;
  const OPTIMIZE_TEXT = "Optimize";
  const BUSY_TEXT = "Optimizing…";
  const SPARKLE_SVG = '<svg viewBox="0 0 36 36" width="14" height="14" aria-hidden="true" focusable="false" style="display:block;fill:currentColor"><path d="M34.347 16.893l-8.899-3.294l-3.323-10.891a1 1 0 0 0-1.912 0l-3.322 10.891l-8.9 3.294a1 1 0 0 0 0 1.876l8.895 3.293l3.324 11.223a1 1 0 0 0 1.918-.001l3.324-11.223l8.896-3.293a.998.998 0 0 0-.001-1.875z"></path><path d="M14.347 27.894l-2.314-.856l-.9-3.3a.998.998 0 0 0-1.929-.001l-.9 3.3l-2.313.856a1 1 0 0 0 0 1.876l2.301.853l.907 3.622a1 1 0 0 0 1.94-.001l.907-3.622l2.301-.853a.997.997 0 0 0 0-1.874z"></path><path d="M10.009 6.231l-2.364-.875l-.876-2.365a.999.999 0 0 0-1.876 0l-.875 2.365l-2.365.875a1 1 0 0 0 0 1.876l2.365.875l.875 2.365a1 1 0 0 0 1.876 0l.875-2.365l2.365-.875a1 1 0 0 0 0-1.876z"></path></svg>';
  const BUTTON_INNER = `<span class="pf-optimize-icon" aria-hidden="true">${SPARKLE_SVG}</span><span class="pf-optimize-label">${OPTIMIZE_TEXT}</span>`;
  const DEFAULT_OFFSET = { x: 0, y: 0 };
  // Every node this script injects into the page, for mutation self-filtering.
  const OWN_UI_SELECTOR = ".pf-optimize-btn, .pf-preview-card, .pf-busy-indicator, #pf-toast";

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
  let settingsPromise = null;
  // Monotonic tokens for in-flight background requests, one per busy flag:
  // optimizeSeq guards the button's busy state (Optimize), previewSeq guards the
  // card's busy state (Regenerate / Refine). Keeping them separate means a
  // superseded request never leaves the *other* busy flag stuck on. A stale
  // reply is still dropped — and preview replies additionally require the same
  // previewState object, so they can never land in a newer card.
  let optimizeSeq = 0;
  let previewSeq = 0;
  let suppressClickTimer = 0;
  let tornDown = false;

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
        onShortcutTrigger();
      }
      return false;
    });
  }

  observer = new MutationObserver(onDocumentMutated);
  observer.observe(document.documentElement || document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    // Only attributes that can change whether the composer is present, visible,
    // or sized. Observing every attribute on a page like ChatGPT is very noisy.
    attributeFilter: ["class", "style", "hidden", "contenteditable", "disabled", "aria-hidden"]
  });

  // Every sync repositions our own injected nodes, which mutates them, which
  // would schedule another sync — a self-sustaining per-frame loop. Ignore
  // records that originate entirely from our own UI.
  function onDocumentMutated(records) {
    if (tornDown) {
      return;
    }
    for (const record of records) {
      if (!isOwnMutation(record)) {
        scheduleSync();
        return;
      }
    }
  }

  function isOwnElement(node) {
    if (!node || node.nodeType !== 1 || typeof node.closest !== "function") {
      return false;
    }
    return !!node.closest(OWN_UI_SELECTOR);
  }

  function isOwnMutation(record) {
    const target = record.target;
    if (isOwnElement(target && target.nodeType === 1 ? target : (target && target.parentElement))) {
      return true;
    }
    if (record.type === "childList") {
      // Our roots are appended to document.body, so the record target is the
      // body — decide from the nodes that were actually added or removed.
      const touched = [...record.addedNodes, ...record.removedNodes];
      return touched.length > 0 && touched.every((node) => isOwnElement(node) || isOwnElement(node && node.parentElement));
    }
    return false;
  }

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
    button.addEventListener("click", onButtonClick);
    document.body.appendChild(button);
  }

  function scheduleSync() {
    if (rafToken || tornDown) {
      return;
    }
    if (!isExtensionContextValid()) {
      teardown();
      return;
    }
    rafToken = window.requestAnimationFrame(async () => {
      rafToken = 0;
      await syncButton();
    });
  }

  async function syncButton() {
    const settings = await getPublicSettings(false);
    if (tornDown) {
      return;
    }
    if (!settings || !settings.enableAI || !settings.enableAskBetterMode || !settings[siteToggleKey]) {
      hideButton();
      return;
    }

    const input = (activeInput && activeInput.isConnected && isUsableInput(activeInput))
      ? activeInput
      : findPromptInput(selectors, acceptInput);
    if (!input) {
      hideButton();
      return;
    }

    await ensureOffsetLoaded();
    if (tornDown) {
      return;
    }
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
    // The composer is gone (chat switched, site disabled…): a floating card
    // would now belong to nothing. Don't pull focus back to the old composer.
    closePreview(false);
    activeInput = null;
  }

  function isUsableInput(node) {
    return isEligiblePromptInput(node) && (!acceptInput || acceptInput(node));
  }

  // After the extension is reloaded/updated, this orphaned script can no longer
  // reach the background worker. Stop observing and remove our button so it
  // doesn't keep running (or offer a button that can only fail). An open
  // preview is left alone: Accept / Discard work without the runtime.
  function teardown() {
    if (tornDown) {
      return;
    }
    tornDown = true;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (rafToken) {
      window.cancelAnimationFrame(rafToken);
      rafToken = 0;
    }
    window.removeEventListener("resize", scheduleSync);
    window.removeEventListener("scroll", scheduleSync);
    window.removeEventListener("focus", scheduleSync);
    window.clearTimeout(offsetSaveTimer);
    if (button) {
      button.remove();
      button = null;
    }
    if (busyIndicator) {
      busyIndicator.remove();
      busyIndicator = null;
    }
    isBusy = false;
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

  function onButtonClick() {
    if (suppressNextClick) {
      suppressNextClick = false;
      window.clearTimeout(suppressClickTimer);
      return;
    }
    void runOptimize(false);
  }

  // Keyboard shortcut. The background worker messages every frame of the tab,
  // so only the frame that actually holds focus handles it: document.hasFocus()
  // is also true for a parent whose focused element is a child frame, so defer
  // to that child in that case. Never routed through suppressNextClick.
  function onShortcutTrigger() {
    if (tornDown || !document.hasFocus()) {
      return;
    }
    const focused = document.activeElement;
    if (focused && (focused.tagName === "IFRAME" || focused.tagName === "FRAME")) {
      return;
    }
    void runOptimize(true);
  }

  async function runOptimize(fromShortcut) {
    if (isBusy || tornDown) {
      return;
    }

    const targetInput = activeInput && activeInput.isConnected ? activeInput : findPromptInput(selectors, acceptInput);
    if (!targetInput) {
      if (fromShortcut) {
        showToast("Click in the prompt box first.");
      }
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
    const token = ++optimizeSeq;
    setBusy(true, targetInput);
    const response = await sendMessage({
      type: "ASKBETTER_OPTIMIZE",
      prompt,
      preset,
      site
    });
    // A newer optimize is already in flight and still owns the busy state.
    if (token !== optimizeSeq) {
      return;
    }
    setBusy(false, targetInput);
    if (response && response.code === "EXTENSION_CONTEXT_INVALIDATED") {
      teardown();
    }

    if (!response || !response.ok) {
      const message = response && response.code === "DISABLED_OR_MISSING_KEY"
        ? "AI disabled or key missing"
        : (response && response.message) || "Optimization failed";
      showToast(message);
      return;
    }

    const variants = Array.isArray(response.variants) && response.variants.length > 1
      ? response.variants.map((variant) => String(variant || ""))
      : [String(response.optimizedPrompt || "")];
    previewState = {
      input: targetInput,
      prompt,
      preset,
      variants,
      activeIndex: 0,
      diffMode: false,
      usage: response.usage || null
    };
    showPreview(targetInput);
  }

  function ensurePreviewCard() {
    if (previewCard && previewCard.isConnected) {
      return;
    }
    previewCard = document.createElement("div");
    previewCard.className = "pf-preview-card";
    previewCard.setAttribute("role", "dialog");
    previewCard.setAttribute("aria-label", "AskBetter preview");
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
      <div class="pf-preview-variants" role="group" aria-label="Optimized options" hidden></div>
      <textarea class="pf-preview-text" spellcheck="false" aria-label="Optimized prompt"></textarea>
      <div class="pf-preview-diff" aria-live="polite" hidden></div>
      <div class="pf-preview-refine">
        <input type="text" class="pf-preview-refine-input" spellcheck="false" placeholder="Refine — e.g. make it shorter, more formal…" aria-label="Describe a follow-up change" />
        <button type="button" class="pf-preview-btn pf-preview-refine-btn" data-action="refine">Refine</button>
      </div>
      <div class="pf-preview-cost" aria-live="polite" hidden></div>
      <div class="pf-preview-actions">
        <button type="button" class="pf-preview-btn pf-preview-diff-toggle" data-action="diff" aria-pressed="false">Diff</button>
        <button type="button" class="pf-preview-btn pf-preview-regenerate" data-action="regenerate">Regenerate</button>
        <span class="pf-preview-spacer"></span>
        <button type="button" class="pf-preview-btn pf-preview-discard" data-action="discard">Discard</button>
        <button type="button" class="pf-preview-btn pf-preview-accept" data-action="accept">Accept</button>
      </div>
    `;

    previewCard.addEventListener("pointerdown", (event) => event.stopPropagation());
    previewCard.addEventListener("click", (event) => {
      const variantBtn = event.target instanceof Element ? event.target.closest("[data-variant-index]") : null;
      if (variantBtn) {
        selectVariant(Number(variantBtn.getAttribute("data-variant-index")));
        return;
      }
      const trigger = event.target instanceof Element ? event.target.closest("[data-action]") : null;
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
      } else if (action === "diff") {
        toggleDiff();
      } else if (action === "refine") {
        void refinePreview();
      }
    });

    const textarea = previewCard.querySelector(".pf-preview-text");
    if (textarea) {
      // Keep the active variant's edits so switching tabs / diffing doesn't lose them.
      textarea.addEventListener("input", () => {
        if (previewState && Array.isArray(previewState.variants)) {
          previewState.variants[previewState.activeIndex] = textarea.value;
        }
        updateAcceptState();
      });
    }

    const refineInput = previewCard.querySelector(".pf-preview-refine-input");
    if (refineInput) {
      refineInput.addEventListener("keydown", (event) => {
        // Enter that commits an IME composition is not a submit.
        if (event.key === "Enter" && !isImeEvent(event)) {
          event.preventDefault();
          void refinePreview();
        }
        event.stopPropagation();
      });
    }

    document.body.appendChild(previewCard);
  }

  function showPreview(input) {
    ensurePreviewCard();
    if (previewState) {
      previewState.diffMode = false;
    }
    renderVariants();
    const textarea = previewCard.querySelector(".pf-preview-text");
    if (textarea) {
      textarea.value = getActiveText();
    }
    renderDiffMode();
    updateCostFooter();
    setPreviewBusy(false);
    updateAcceptState();
    const refineInput = previewCard.querySelector(".pf-preview-refine-input");
    if (refineInput) {
      refineInput.value = "";
    }
    previewCard.style.display = "flex";
    placePreviewNearInput(input);
    if (textarea) {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
  }

  function getActiveText() {
    if (!previewState || !Array.isArray(previewState.variants)) {
      return "";
    }
    return String(previewState.variants[previewState.activeIndex] || "");
  }

  function setActiveText(text) {
    if (previewState && Array.isArray(previewState.variants)) {
      previewState.variants[previewState.activeIndex] = String(text || "");
    }
    const textarea = previewCard && previewCard.querySelector(".pf-preview-text");
    if (textarea) {
      textarea.value = String(text || "");
    }
    if (previewState && previewState.diffMode) {
      renderDiff();
    }
    updateAcceptState();
  }

  // Accept would wipe the prompt box with nothing, so it needs real text.
  function updateAcceptState() {
    const accept = previewCard && previewCard.querySelector(".pf-preview-accept");
    if (!accept) {
      return;
    }
    const busy = previewCard.classList.contains("pf-preview-is-busy");
    accept.disabled = busy || !getActiveText().trim();
  }

  // Render the variant switcher when Ask Better returned more than one rewrite.
  function renderVariants() {
    const wrap = previewCard && previewCard.querySelector(".pf-preview-variants");
    if (!wrap) {
      return;
    }
    const variants = previewState && Array.isArray(previewState.variants) ? previewState.variants : [];
    if (variants.length <= 1) {
      wrap.hidden = true;
      wrap.textContent = "";
      return;
    }
    wrap.hidden = false;
    wrap.textContent = "";
    variants.forEach((_variant, index) => {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "pf-preview-variant" + (index === previewState.activeIndex ? " pf-is-active" : "");
      pill.setAttribute("data-variant-index", String(index));
      pill.setAttribute("aria-pressed", String(index === previewState.activeIndex));
      pill.textContent = `Option ${index + 1}`;
      wrap.appendChild(pill);
    });
  }

  function selectVariant(index) {
    if (!previewState || !Array.isArray(previewState.variants)) {
      return;
    }
    if (!Number.isInteger(index) || index < 0 || index >= previewState.variants.length) {
      return;
    }
    // Persist current edits before switching away.
    const textarea = previewCard.querySelector(".pf-preview-text");
    if (textarea) {
      previewState.variants[previewState.activeIndex] = textarea.value;
    }
    previewState.activeIndex = index;
    renderVariants();
    if (textarea) {
      textarea.value = getActiveText();
    }
    updateAcceptState();
    if (previewState.diffMode) {
      renderDiff();
    } else if (textarea) {
      textarea.focus();
    }
  }

  function toggleDiff() {
    if (!previewState) {
      return;
    }
    previewState.diffMode = !previewState.diffMode;
    renderDiffMode();
  }

  function renderDiffMode() {
    const textarea = previewCard.querySelector(".pf-preview-text");
    const diffBox = previewCard.querySelector(".pf-preview-diff");
    const toggle = previewCard.querySelector(".pf-preview-diff-toggle");
    const diffOn = !!(previewState && previewState.diffMode);
    if (toggle) {
      toggle.classList.toggle("pf-is-active", diffOn);
      toggle.setAttribute("aria-pressed", String(diffOn));
    }
    if (textarea) {
      textarea.hidden = diffOn;
    }
    if (diffBox) {
      diffBox.hidden = !diffOn;
    }
    if (diffOn) {
      renderDiff();
    }
  }

  function renderDiff() {
    const diffBox = previewCard && previewCard.querySelector(".pf-preview-diff");
    if (!diffBox || !previewState) {
      return;
    }
    diffBox.textContent = "";
    diffBox.appendChild(buildDiffFragment(previewState.prompt, getActiveText()));
  }

  function updateCostFooter() {
    const costEl = previewCard && previewCard.querySelector(".pf-preview-cost");
    if (!costEl) {
      return;
    }
    const label = formatUsage(previewState && previewState.usage);
    costEl.textContent = label;
    costEl.hidden = !label;
  }

  function isPreviewBusy() {
    return !!(previewCard && previewCard.classList.contains("pf-preview-is-busy"));
  }

  async function refinePreview() {
    // Enter in the refine box isn't blocked by the disabled buttons.
    if (!previewState || !previewCard || isPreviewBusy()) {
      return;
    }
    const refineInput = previewCard.querySelector(".pf-preview-refine-input");
    const instruction = refineInput ? refineInput.value.trim() : "";
    if (!instruction) {
      showToast("Describe the change first");
      if (refineInput) {
        refineInput.focus();
      }
      return;
    }
    const base = getActiveText().trim();
    if (!base) {
      return;
    }
    const state = previewState;
    const token = ++previewSeq;
    setPreviewBusy(true);
    const response = await sendMessage({
      type: "ASKBETTER_REFINE",
      base,
      instruction,
      site
    });
    // Drop the result if it was superseded, or if this card was discarded —
    // previewState identity changes when a new preview opens, so a stale
    // response can never land in a card it was not requested from. In every
    // drop case someone else already reset the card's busy state: a newer
    // preview op owns it, or closePreview / showPreview cleared it.
    if (token !== previewSeq || previewState !== state || !isPreviewOpen()) {
      return;
    }
    setPreviewBusy(false);
    if (!response || !response.ok) {
      const message = response && response.code === "DISABLED_OR_MISSING_KEY"
        ? "AI disabled or key missing"
        : (response && response.message) || "Refine failed";
      showToast(message);
      return;
    }
    if (response.usage) {
      previewState.usage = response.usage;
      updateCostFooter();
    }
    setActiveText(response.optimizedPrompt);
    if (refineInput) {
      refineInput.value = "";
    }
    const textarea = previewCard.querySelector(".pf-preview-text");
    if (textarea && !previewState.diffMode) {
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
    if (!busy) {
      updateAcceptState();
    }
  }

  function acceptPreview() {
    if (!previewState || !previewCard) {
      closePreview();
      return;
    }
    const textarea = previewCard.querySelector(".pf-preview-text");
    // In diff mode the textarea is hidden, so read from the persisted variant.
    const nextText = previewState.diffMode ? getActiveText() : (textarea ? textarea.value : getActiveText());
    if (!nextText.trim()) {
      return;
    }
    // Never re-target: if the composer this rewrite came from is gone (e.g. the
    // user switched chats), pasting into whatever box exists now would put one
    // conversation's prompt into another.
    const input = previewState.input;
    if (!input || !input.isConnected) {
      closePreview(false);
      showToast("The prompt box changed — optimize again.");
      return;
    }
    closePreview(false);
    writePromptText(input, nextText);
    showToast("Prompt optimized", "success");
  }

  async function regeneratePreview() {
    if (!previewState || !previewCard) {
      return;
    }
    if (isPreviewBusy()) {
      return;
    }
    if (!previewState.input || !previewState.input.isConnected) {
      closePreview(false);
      showToast("The prompt box changed — optimize again.");
      return;
    }
    const state = previewState;
    const token = ++previewSeq;
    setPreviewBusy(true);
    const response = await sendMessage({
      type: "ASKBETTER_OPTIMIZE",
      prompt: previewState.prompt,
      preset: previewState.preset,
      site
    });
    if (token !== previewSeq || previewState !== state || !isPreviewOpen()) {
      return;
    }
    setPreviewBusy(false);
    if (!response || !response.ok) {
      showToast((response && response.message) || "Optimization failed");
      return;
    }
    previewState.variants = Array.isArray(response.variants) && response.variants.length > 1
      ? response.variants.map((variant) => String(variant || ""))
      : [String(response.optimizedPrompt || "")];
    previewState.activeIndex = 0;
    previewState.usage = response.usage || null;
    renderVariants();
    const textarea = previewCard.querySelector(".pf-preview-text");
    if (textarea) {
      textarea.value = getActiveText();
    }
    updateCostFooter();
    updateAcceptState();
    if (previewState.diffMode) {
      renderDiff();
    } else if (textarea) {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
  }

  // restoreFocus (default true): hand focus back to the composer, but only when
  // focus was inside the card — never steal it from wherever the user went.
  function closePreview(restoreFocus) {
    const input = previewState && previewState.input;
    previewState = null;
    if (previewCard && previewCard.isConnected) {
      const focused = document.activeElement;
      const hadFocus = !!focused && (focused === document.body || previewCard.contains(focused));
      previewCard.style.display = "none";
      setPreviewBusy(false);
      if (restoreFocus !== false && hadFocus && input && input.isConnected && typeof input.focus === "function") {
        input.focus();
      }
    }
  }

  function onGlobalKeydown(event) {
    if (event.key === "Escape" && !isImeEvent(event) && isPreviewOpen()) {
      event.stopPropagation();
      closePreview();
    }
  }

  function getPublicSettings(forceRefresh) {
    const now = Date.now();
    if (!forceRefresh && settingsCache && now - settingsLoadedAt < 5000) {
      return Promise.resolve(settingsCache);
    }
    // Overlapping syncs after the cache expires share one request.
    if (!forceRefresh && settingsPromise) {
      return settingsPromise;
    }
    const pending = sendMessage({ type: "ASKBETTER_GET_PUBLIC_SETTINGS" }).then((response) => {
      if (response && response.ok && response.settings) {
        settingsCache = response.settings;
        settingsLoadedAt = Date.now();
      } else if (response && response.code === "EXTENSION_CONTEXT_INVALIDATED") {
        teardown();
      }
      return settingsCache;
    });
    settingsPromise = pending;
    pending.then(() => {
      if (settingsPromise === pending) {
        settingsPromise = null;
      }
    });
    return pending;
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
      // A drag released with pointerup is followed by a click that must not
      // optimize. pointercancel is never followed by one, so setting the flag
      // there would swallow the user's next real click. The timer clears it
      // in case the browser doesn't deliver that click at all.
      if (event.type === "pointerup") {
        suppressNextClick = true;
        window.clearTimeout(suppressClickTimer);
        suppressClickTimer = window.setTimeout(() => {
          suppressNextClick = false;
        }, 300);
      }
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
      <span class="pf-busy-text">Ask Better is working…</span>
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

function isImeEvent(event) {
  return !!event && (event.isComposing || event.keyCode === 229);
}

function isExtensionContextValid() {
  try {
    return typeof chrome !== "undefined" && !!chrome.runtime && !!chrome.runtime.id;
  } catch (_error) {
    return false;
  }
}

// The deep (shadow-piercing) scan walks every element, and syncs run on most
// DOM mutations while no composer exists — so run it at most once a second.
// `var`, not `const`: a top-level lexical redeclaration would throw if this
// file were ever evaluated twice in the same isolated world.
var DEEP_SCAN_INTERVAL_MS = 1000;
var deepScanCache = { at: 0, selectors: null, result: null };

function findPromptInput(selectors, acceptInput) {
  const accepts = (node) => isEligiblePromptInput(node) && (!acceptInput || acceptInput(node));
  for (const selector of selectors) {
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      if (accepts(node)) {
        return node;
      }
    }
  }
  // Fallback: some sites render the composer inside a shadow root, which
  // document.querySelectorAll cannot reach. Pierce open shadow roots.
  const now = Date.now();
  if (deepScanCache.selectors === selectors && now - deepScanCache.at < DEEP_SCAN_INTERVAL_MS) {
    const cached = deepScanCache.result;
    return cached && cached.isConnected && accepts(cached) ? cached : null;
  }
  const result = findPromptInputDeep(document, selectors, accepts);
  deepScanCache.at = now;
  deepScanCache.selectors = selectors;
  deepScanCache.result = result;
  return result;
}

function findPromptInputDeep(root, selectors, accepts) {
  const isMatch = typeof accepts === "function" ? accepts : isEligiblePromptInput;
  const hosts = root.querySelectorAll("*");
  for (const host of hosts) {
    const shadow = host.shadowRoot;
    if (!shadow) {
      continue;
    }
    for (const selector of selectors) {
      const nodes = shadow.querySelectorAll(selector);
      for (const node of nodes) {
        if (isMatch(node)) {
          return node;
        }
      }
    }
    const nested = findPromptInputDeep(shadow, selectors, isMatch);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function isEligiblePromptInput(node) {
  if (!(node instanceof HTMLElement)) {
    return false;
  }
  const rect = node.getBoundingClientRect();
  const minHeight = node.isContentEditable ? 16 : 24;
  if (!rect || rect.width < 160 || rect.height < minHeight) {
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
    // insertText goes through the browser's editing pipeline, so it stays on
    // the undo stack and fires a real input event for frameworks like React.
    try {
      node.focus();
      node.select();
      document.execCommand("insertText", false, value);
    } catch (_error) {
      // fall through to the value setter
    }
    if (node.value === value) {
      return;
    }
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
    // ChatGPT and Claude use ProseMirror, Gemini uses Quill. Both keep their
    // own document model, so assigning textContent only repainted the DOM: the
    // editor's state (and what Send actually submits) could stay stale, and
    // line breaks collapsed into one text node. Go through the editor instead:
    // select everything and replace it with insertText (synchronous, so the
    // result can be checked), then a synthetic paste, and only then fall back
    // to the raw DOM write.
    node.focus();
    selectAllContent(node);
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, value);
    } catch (_error) {
      inserted = false;
    }
    if (inserted && contentMatches(node, value)) {
      return;
    }
    selectAllContent(node);
    // A consumed paste means the editor owns the insert, possibly in a
    // deferred handler — writing textContent too would duplicate it.
    if (tryPasteText(node, value)) {
      return;
    }
    node.textContent = value;
    node.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
  }
}

function selectAllContent(node) {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
}

// Returns true only when the editor consumed the paste (called preventDefault);
// an unhandled synthetic paste inserts nothing.
function tryPasteText(node, value) {
  try {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
    node.dispatchEvent(event);
    return event.defaultPrevented;
  } catch (_error) {
    return false;
  }
}

function normalizeEditorText(text) {
  return String(text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function contentMatches(node, value) {
  return normalizeEditorText(readPromptText(node)) === normalizeEditorText(value);
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

function showToast(message, variant) {
  let toast = document.getElementById("pf-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "pf-toast";
    toast.className = "pf-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.innerHTML = '<span class="pf-toast-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M5 12.5L10 17L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg></span><span class="pf-toast-text"></span>';
    document.body.appendChild(toast);
  }
  toast.classList.toggle("pf-toast-success", variant === "success");
  const textEl = toast.querySelector(".pf-toast-text");
  if (textEl) {
    textEl.textContent = message;
  } else {
    toast.textContent = message;
  }
  toast.classList.add("pf-toast-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("pf-toast-visible");
  }, 1800);
}

// Split text into word + whitespace tokens (both preserved) for a word-level diff.
function tokenizeForDiff(text) {
  return String(text || "").match(/\s+|[^\s]+/g) || [];
}

// Upper bound on LCS table cells (Uint32 → ~8MB). Beyond it the changed middle
// is shown as one removed block + one added block instead of a word diff.
var DIFF_MAX_CELLS = 2000000;

// Build a word-level diff (original → revised) as DOM nodes: unchanged text plain,
// removed words struck, added words highlighted. Whitespace is never flagged so the
// result reads naturally. Common leading/trailing tokens are emitted as-is; an LCS
// table runs only over the changed middle, and only when it fits DIFF_MAX_CELLS.
function buildDiffFragment(original, revised) {
  const allA = tokenizeForDiff(original);
  const allB = tokenizeForDiff(revised);
  let prefix = 0;
  while (prefix < allA.length && prefix < allB.length && allA[prefix] === allB[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < allA.length - prefix &&
    suffix < allB.length - prefix &&
    allA[allA.length - 1 - suffix] === allB[allB.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const a = allA.slice(prefix, allA.length - suffix);
  const b = allB.slice(prefix, allB.length - suffix);
  const n = a.length;
  const m = b.length;

  const frag = document.createDocumentFragment();
  const push = (cls, text) => {
    if (!text) {
      return;
    }
    const useClass = cls && !/^\s+$/.test(text) ? cls : "";
    const span = document.createElement("span");
    if (useClass) {
      span.className = useClass;
    }
    span.textContent = text;
    frag.appendChild(span);
  };

  push("", allA.slice(0, prefix).join(""));
  if (n * m > DIFF_MAX_CELLS) {
    push("pf-diff-del", a.join(""));
    push("pf-diff-add", b.join(""));
    push("", allA.slice(allA.length - suffix).join(""));
    return frag;
  }

  const dp = [];
  for (let i = 0; i <= n; i += 1) {
    dp.push(new Uint32Array(m + 1));
  }
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("", a[i]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("pf-diff-del", a[i]);
      i += 1;
    } else {
      push("pf-diff-add", b[j]);
      j += 1;
    }
  }
  while (i < n) {
    push("pf-diff-del", a[i]);
    i += 1;
  }
  while (j < m) {
    push("pf-diff-add", b[j]);
    j += 1;
  }
  push("", allA.slice(allA.length - suffix).join(""));
  return frag;
}

// Format the per-request token/cost estimate for the preview footer. Both figures
// are approximate — pricing is a rough per-family estimate maintained in background.js.
function formatUsage(usage) {
  if (!usage) {
    return "";
  }
  const tokens = Number(usage.totalTokens) || 0;
  const parts = [];
  if (tokens > 0) {
    parts.push(`≈ ${tokens.toLocaleString()} tokens`);
  }
  if (typeof usage.costUsd === "number" && usage.costUsd >= 0) {
    const cost = usage.costUsd > 0 && usage.costUsd < 0.01
      ? "<$0.01"
      : `$${usage.costUsd.toFixed(usage.costUsd < 1 ? 4 : 2)}`;
    parts.push(`≈ ${cost}`);
  }
  return parts.length ? `This request: ${parts.join(" · ")}` : "";
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
