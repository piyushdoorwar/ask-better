// Reports section: a local-only usage dashboard for the last 30 days.
//
// Reads the `usageLog` written by the background worker (one entry per
// successful request: { ts, provider, model, mode }), keeps only the last
// 30 days, and renders a stacked bar chart (Chart.js, vendored locally) plus a
// few summary stats. No network — the data never leaves the browser.

(function () {
  const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
  const DAYS = 30;

  // Palette tuned for the dark amber theme; one colour per series.
  const PROVIDER_COLORS = {
    gemini: "#6aa9ff",
    openai: "#19c37d",
    anthropic: "#e8991e",
    other: "#9a8f83"
  };
  const PROVIDER_LABELS = { gemini: "Gemini", openai: "OpenAI", anthropic: "Anthropic", other: "Other" };
  const PROVIDER_ORDER = ["gemini", "openai", "anthropic", "other"];

  const MODE_COLORS = { ask_better: "#e8991e", phrase_better: "#6aa9ff" };
  const MODE_LABELS = { ask_better: "Ask Better", phrase_better: "Phrase Better" };
  const MODE_ORDER = ["ask_better", "phrase_better"];

  const TEXT = "#f4f0eb";
  const MUTED = "rgba(244, 240, 235, 0.55)";
  const GRID = "rgba(244, 240, 235, 0.08)";

  let entries = null; // cached last-30-day entries
  let chart = null;
  let group = "provider"; // "provider" | "mode"

  const els = {};
  function el(id) {
    if (!(id in els)) els[id] = document.getElementById(id);
    return els[id];
  }

  function normProvider(p) {
    const v = String(p || "").toLowerCase();
    return v === "gemini" || v === "openai" || v === "anthropic" ? v : "other";
  }

  function dayKey(d) {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  // Build the rolling 30-day window (oldest → today) as keys + display labels.
  function buildWindow() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const keys = [];
    const labels = [];
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      keys.push(dayKey(d));
      labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
    }
    const start = new Date(today);
    start.setDate(today.getDate() - (DAYS - 1));
    return { keys, labels, start, end: today };
  }

  async function loadUsage() {
    try {
      const stored = await chrome.storage.local.get(["usageLog"]);
      const log = Array.isArray(stored.usageLog) ? stored.usageLog : [];
      const cutoff = Date.now() - RETENTION_MS;
      entries = log.filter((e) => e && typeof e.ts === "number" && e.ts >= cutoff);
    } catch (_e) {
      entries = [];
    }
  }

  function updateStats() {
    const total = entries.length;
    let ask = 0;
    let phrase = 0;
    for (const e of entries) {
      if (e.mode === "phrase_better") phrase++;
      else ask++;
    }
    if (el("statTotal")) el("statTotal").textContent = String(total);
    if (el("statAskBetter")) el("statAskBetter").textContent = String(ask);
    if (el("statPhraseBetter")) el("statPhraseBetter").textContent = String(phrase);
  }

  function updateRange(win) {
    const range = el("reportRange");
    if (!range) return;
    const opts = { month: "short", day: "numeric" };
    const startStr = win.start.toLocaleDateString(undefined, opts);
    const endStr = win.end.toLocaleDateString(undefined, { ...opts, year: "numeric" });
    range.textContent = `${startStr} – ${endStr}`;
  }

  // Turn the cached entries into stacked-bar datasets for the active grouping.
  function buildDatasets(win) {
    const dayIndex = new Map();
    win.keys.forEach((k, i) => dayIndex.set(k, i));

    const isProvider = group === "provider";
    const colors = isProvider ? PROVIDER_COLORS : MODE_COLORS;
    const labelsMap = isProvider ? PROVIDER_LABELS : MODE_LABELS;
    const order = isProvider ? PROVIDER_ORDER : MODE_ORDER;

    const buckets = new Map(); // seriesKey -> number[DAYS]
    for (const e of entries) {
      const key = isProvider ? normProvider(e.provider) : (e.mode === "phrase_better" ? "phrase_better" : "ask_better");
      const di = dayIndex.get(dayKey(new Date(e.ts)));
      if (di == null) continue;
      if (!buckets.has(key)) buckets.set(key, new Array(DAYS).fill(0));
      buckets.get(key)[di]++;
    }

    // Keep known series in a stable order; drop empty ones to reduce legend noise.
    return order
      .filter((key) => buckets.has(key))
      .map((key) => ({
        label: labelsMap[key] || key,
        data: buckets.get(key),
        backgroundColor: colors[key] || PROVIDER_COLORS.other,
        borderWidth: 0,
        borderRadius: 3,
        maxBarThickness: 16,
        stack: "usage"
      }));
  }

  function drawChart(win) {
    const canvas = el("reportChart");
    const empty = el("reportEmpty");
    if (!canvas) return;

    const hasData = entries.length > 0 && typeof Chart !== "undefined";
    if (empty) empty.hidden = hasData;
    canvas.style.visibility = hasData ? "visible" : "hidden";
    if (!hasData) {
      if (chart) { chart.destroy(); chart = null; }
      return;
    }

    const datasets = buildDatasets(win);
    if (chart) { chart.destroy(); chart = null; }

    chart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: { labels: win.labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 220 },
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { color: MUTED, maxRotation: 0, autoSkip: true, autoSkipPadding: 12, font: { size: 10 } }
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: { color: GRID },
            ticks: { color: MUTED, precision: 0, font: { size: 10 } }
          }
        },
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: TEXT, usePointStyle: true, pointStyle: "circle", boxWidth: 8, padding: 14, font: { size: 11 } }
          },
          tooltip: {
            backgroundColor: "#161310",
            borderColor: "rgba(244,240,235,0.14)",
            borderWidth: 1,
            titleColor: TEXT,
            bodyColor: TEXT,
            padding: 10
          }
        }
      }
    });
  }

  async function render() {
    await loadUsage();
    const win = buildWindow();
    updateRange(win);
    updateStats();
    drawChart(win);
  }

  function bindToggle() {
    const toggle = el("reportGroupToggle");
    if (!toggle) return;
    toggle.addEventListener("click", (event) => {
      const btn = event.target.closest(".seg-btn");
      if (!btn) return;
      const next = btn.getAttribute("data-group") === "mode" ? "mode" : "provider";
      if (next === group) return;
      group = next;
      for (const b of toggle.querySelectorAll(".seg-btn")) {
        const active = b === btn;
        b.classList.toggle("active", active);
        b.setAttribute("aria-selected", String(active));
      }
      drawChart(buildWindow()); // entries already loaded; just re-bucket
    });
  }

  function bindActivation() {
    const navBtn = document.querySelector('.nav-btn[data-section="section-reports"]');
    if (navBtn) {
      navBtn.addEventListener("click", () => {
        // Let options.js flip the section to display:block first, then size the chart.
        requestAnimationFrame(() => { void render(); });
      });
    }
    // In case Reports is already the active section on load.
    const section = document.getElementById("section-reports");
    if (section && section.classList.contains("active")) {
      requestAnimationFrame(() => { void render(); });
    }
  }

  function init() {
    bindToggle();
    bindActivation();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
