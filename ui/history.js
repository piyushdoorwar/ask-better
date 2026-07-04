// History section: a local-only list of recent rewrites (original → optimized).
//
// Reads the `promptHistory` array written by the background worker (one entry per
// successful Optimize / Refine / Phrase Better result: { ts, original, optimized,
// preset, provider, model, mode }) and renders it newest-first with copy actions.
// No network — the data never leaves the browser.

(function () {
  const PROVIDER_LABELS = { gemini: "Gemini", openai: "OpenAI", anthropic: "Anthropic" };
  const MODE_LABELS = { ask_better: "Ask Better", phrase_better: "Phrase Better" };

  const els = {};
  function el(id) {
    if (!(id in els)) els[id] = document.getElementById(id);
    return els[id];
  }

  let entries = null;

  function providerLabel(p) {
    const v = String(p || "").toLowerCase();
    return PROVIDER_LABELS[v] || (v ? v : "");
  }

  function formatWhen(ts) {
    const d = new Date(Number(ts) || 0);
    if (!Number.isFinite(d.getTime()) || !ts) return "";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  async function loadHistory() {
    try {
      const stored = await chrome.storage.local.get(["promptHistory"]);
      const log = Array.isArray(stored.promptHistory) ? stored.promptHistory : [];
      // Newest first.
      entries = log
        .filter((e) => e && typeof e.ts === "number" && (e.original || e.optimized))
        .slice()
        .sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
    } catch (_e) {
      entries = [];
    }
  }

  async function copyText(text, button) {
    const value = String(text || "");
    try {
      await navigator.clipboard.writeText(value);
    } catch (_e) {
      // Fallback for environments where the async clipboard API is blocked.
      try {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      } catch (_err) {
        return;
      }
    }
    if (button) {
      const original = button.textContent;
      button.textContent = "Copied";
      window.clearTimeout(button._copyTimer);
      button._copyTimer = window.setTimeout(() => { button.textContent = original; }, 1200);
    }
  }

  function buildTextBlock(labelText, value, isOriginal) {
    const block = document.createElement("div");
    block.className = "history-item-block";

    const label = document.createElement("span");
    label.className = "history-item-label";
    label.textContent = labelText;

    const text = document.createElement("div");
    text.className = "history-item-text" + (isOriginal ? " is-original" : "");
    text.textContent = String(value || "");

    block.appendChild(label);
    block.appendChild(text);
    return block;
  }

  function renderItem(entry) {
    const item = document.createElement("div");
    item.className = "history-item";

    const meta = document.createElement("div");
    meta.className = "history-item-meta";

    const tag = document.createElement("span");
    tag.className = "history-tag";
    tag.textContent = MODE_LABELS[entry.mode] || "Ask Better";
    meta.appendChild(tag);

    const bits = [];
    const when = formatWhen(entry.ts);
    if (when) bits.push(when);
    const prov = providerLabel(entry.provider);
    if (prov) bits.push(prov);
    if (entry.model) bits.push(String(entry.model));
    if (bits.length) {
      const detail = document.createElement("span");
      detail.textContent = bits.join(" · ");
      meta.appendChild(detail);
    }
    item.appendChild(meta);

    item.appendChild(buildTextBlock("Original", entry.original, true));
    item.appendChild(buildTextBlock("Optimized", entry.optimized, false));

    const actions = document.createElement("div");
    actions.className = "history-item-actions";

    const copyOptimized = document.createElement("button");
    copyOptimized.type = "button";
    copyOptimized.className = "history-action-btn";
    copyOptimized.textContent = "Copy optimized";
    copyOptimized.addEventListener("click", () => copyText(entry.optimized, copyOptimized));

    const copyOriginal = document.createElement("button");
    copyOriginal.type = "button";
    copyOriginal.className = "history-action-btn";
    copyOriginal.textContent = "Copy original";
    copyOriginal.addEventListener("click", () => copyText(entry.original, copyOriginal));

    actions.appendChild(copyOptimized);
    actions.appendChild(copyOriginal);
    item.appendChild(actions);

    return item;
  }

  function render() {
    const list = el("historyList");
    const empty = el("historyEmpty");
    const count = el("historyCount");
    const clearBtn = el("clearHistoryBtn");
    if (!list) return;

    const items = Array.isArray(entries) ? entries : [];
    list.textContent = "";
    for (const entry of items) {
      list.appendChild(renderItem(entry));
    }

    const hasItems = items.length > 0;
    if (empty) empty.hidden = hasItems;
    if (clearBtn) clearBtn.hidden = !hasItems;
    if (count) {
      count.textContent = hasItems
        ? `${items.length} ${items.length === 1 ? "entry" : "entries"} (most recent first)`
        : "";
    }
  }

  async function refresh() {
    await loadHistory();
    render();
  }

  function bindClear() {
    const clearBtn = el("clearHistoryBtn");
    if (!clearBtn) return;
    clearBtn.addEventListener("click", async () => {
      const confirmed = window.confirm("Clear all locally stored prompt history?");
      if (!confirmed) return;
      try {
        await chrome.storage.local.set({ promptHistory: [] });
      } catch (_e) {
        // best-effort
      }
      entries = [];
      render();
    });
  }

  function bindActivation() {
    const navBtn = document.querySelector('.nav-btn[data-section="section-history"]');
    if (navBtn) {
      navBtn.addEventListener("click", () => {
        void refresh();
      });
    }
    const section = document.getElementById("section-history");
    if (section && section.classList.contains("active")) {
      void refresh();
    }
  }

  function init() {
    bindClear();
    bindActivation();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
