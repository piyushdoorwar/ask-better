// History section: a local-only list of recent rewrites (original → optimized).
//
// Reads the `promptHistory` array written by the background worker (one entry per
// successful Optimize / Refine / Phrase Better result: { ts, original, optimized,
// preset, provider, model, mode }) and renders it newest-first with copy actions.
// No network — the data never leaves the browser.

(function () {
  const PROVIDER_LABELS = { gemini: "Gemini", openai: "OpenAI", anthropic: "Anthropic" };
  const MODE_LABELS = { ask_better: "Ask Better", phrase_better: "Phrase Better" };
  const PAGE_SIZE = 5;

  const els = {};
  function el(id) {
    if (!(id in els)) els[id] = document.getElementById(id);
    return els[id];
  }

  let entries = null;
  let currentPage = 1;
  let lastEmittedPage = null;

  function readPageFromHash() {
    const m = (location.hash || "").replace(/^#/, "").match(/^history-page-(\d+)$/i);
    return m ? Math.max(1, Number(m[1])) : null;
  }

  // Let options.js mirror the active page into the URL hash.
  function emitPageChange() {
    if (currentPage === lastEmittedPage) return;
    lastEmittedPage = currentPage;
    try {
      document.dispatchEvent(
        new CustomEvent("askbetter:history-page", { detail: { page: currentPage } })
      );
    } catch (_e) {
      // best-effort
    }
  }

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

  function formatRelativeWhen(ts) {
    const value = Number(ts) || 0;
    if (!value) return "";
    const diffMs = Date.now() - value;
    if (!Number.isFinite(diffMs)) return formatWhen(ts);
    const absMs = Math.abs(diffMs);
    const suffix = diffMs < 0 ? "from now" : "ago";
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (absMs < minute) return "Just now";
    if (absMs < hour) {
      const minutes = Math.round(absMs / minute);
      return `${minutes}m ${suffix}`;
    }
    if (absMs < day) {
      const hours = Math.round(absMs / hour);
      return `${hours}h ${suffix}`;
    }
    if (absMs < 2 * day && diffMs >= 0) return "Yesterday";
    return formatWhen(ts);
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
      const originalLabel = button.getAttribute("aria-label") || "Copy optimized version";
      button.classList.add("is-copied");
      button.setAttribute("aria-label", "Copied optimized version");
      window.clearTimeout(button._copyTimer);
      button._copyTimer = window.setTimeout(() => {
        button.classList.remove("is-copied");
        button.setAttribute("aria-label", originalLabel);
      }, 1200);
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
    const prov = providerLabel(entry.provider);
    if (prov) bits.push(prov);
    if (entry.model) bits.push(String(entry.model));
    if (bits.length) {
      const detail = document.createElement("span");
      detail.className = "history-item-detail";
      detail.textContent = bits.join(" · ");
      meta.appendChild(detail);
    }

    const when = formatRelativeWhen(entry.ts);
    if (when) {
      const time = document.createElement("span");
      time.className = "history-time";
      time.textContent = when;
      meta.appendChild(time);
    }
    item.appendChild(meta);

    item.appendChild(buildTextBlock("Original:", entry.original, true));
    item.appendChild(buildTextBlock("Optimized", entry.optimized, false));

    const copyOptimized = document.createElement("button");
    copyOptimized.type = "button";
    copyOptimized.className = "history-copy-btn";
    copyOptimized.setAttribute("aria-label", "Copy optimized version");
    copyOptimized.title = "Copy optimized version";
    copyOptimized.innerHTML = `
      <svg class="history-copy-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="9" y="9" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.8"></rect>
        <path d="M6 15H5.8C4.81 15 4 14.19 4 13.2V5.8C4 4.81 4.81 4 5.8 4H13.2C14.19 4 15 4.81 15 5.8V6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
      </svg>
      <svg class="history-check-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 12.5L9.2 16.5L19 7" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>`;
    copyOptimized.addEventListener("click", () => copyText(entry.optimized, copyOptimized));
    item.appendChild(copyOptimized);

    return item;
  }

  function renderPagination(totalItems) {
    const pagination = el("historyPagination");
    if (!pagination) return;

    const pageCount = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    currentPage = Math.min(Math.max(currentPage, 1), pageCount);
    pagination.textContent = "";
    pagination.hidden = totalItems <= PAGE_SIZE;
    if (pagination.hidden) return;

    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "history-page-btn";
    prev.textContent = "Previous";
    prev.disabled = currentPage === 1;
    prev.addEventListener("click", () => {
      if (currentPage > 1) {
        currentPage -= 1;
        render();
      }
    });

    const label = document.createElement("span");
    label.className = "history-page-status";
    label.textContent = `Page ${currentPage} of ${pageCount}`;

    const next = document.createElement("button");
    next.type = "button";
    next.className = "history-page-btn";
    next.textContent = "Next";
    next.disabled = currentPage === pageCount;
    next.addEventListener("click", () => {
      if (currentPage < pageCount) {
        currentPage += 1;
        render();
      }
    });

    pagination.appendChild(prev);
    pagination.appendChild(label);
    pagination.appendChild(next);
  }

  function render() {
    const list = el("historyList");
    const empty = el("historyEmpty");
    const count = el("historyCount");
    const clearBtn = el("clearHistoryBtn");
    if (!list) return;

    const items = Array.isArray(entries) ? entries : [];
    const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    currentPage = Math.min(Math.max(currentPage, 1), pageCount);
    const start = (currentPage - 1) * PAGE_SIZE;
    const visibleItems = items.slice(start, start + PAGE_SIZE);
    list.textContent = "";
    for (const entry of visibleItems) {
      list.appendChild(renderItem(entry));
    }

    const hasItems = items.length > 0;
    if (empty) empty.hidden = hasItems;
    if (clearBtn) clearBtn.hidden = !hasItems;
    if (count) {
      count.textContent = hasItems
        ? `Showing ${start + 1}-${start + visibleItems.length} of ${items.length} records`
        : "";
    }
    renderPagination(items.length);
    emitPageChange();
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
      currentPage = 1;
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

  async function goToPage(n) {
    currentPage = Math.max(1, Number(n) || 1);
    await refresh();
  }

  function getPage() {
    return currentPage;
  }

  window.AskBetterHistory = { goToPage, getPage, refresh };

  function init() {
    const hashPage = readPageFromHash();
    if (hashPage != null) currentPage = hashPage;
    bindClear();
    bindActivation();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
