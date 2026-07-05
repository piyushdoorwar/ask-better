// Reports section: a local-only usage dashboard for the last 30 days.
//
// Reads the `usageLog` written by the background worker (one entry per
// successful request: { ts, provider, model, mode }), keeps only the last
// 30 days, and renders a stacked bar chart (Chart.js, vendored locally) plus a
// few summary stats. No network — the data never leaves the browser.

(function () {
  const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
  const DAYS = 30;

  // Single-hue amber palette — shades of yellow only, no multi-colour series.
  // Each series is a [topStop, bottomStop] pair for a vertical bar gradient;
  // the matching *_SOLID entry is the flat colour used in the legend dots.
  const PROVIDER_GRAD = {
    gemini: ["#ffd27a", "#f0b24a"],
    openai: ["#f6b545", "#e2901a"],
    anthropic: ["#cf8a24", "#b0710f"],
    other: ["#9c7326", "#6f4f10"]
  };
  const PROVIDER_SOLID = { gemini: "#f0b24a", openai: "#e2901a", anthropic: "#b0710f", other: "#6f4f10" };
  const PROVIDER_LABELS = { gemini: "Gemini", openai: "OpenAI", anthropic: "Anthropic", other: "Other" };
  const PROVIDER_ORDER = ["gemini", "openai", "anthropic", "other"];

  const MODE_GRAD = {
    ask_better: ["#f9c05a", "#e8991e"],
    phrase_better: ["#a5710f", "#734d08"]
  };
  const MODE_SOLID = { ask_better: "#e8991e", phrase_better: "#8a5c0d" };
  const MODE_LABELS = { ask_better: "Ask Better", phrase_better: "Phrase Better" };
  const MODE_ORDER = ["ask_better", "phrase_better"];

  // Build a vertical gradient (top → bottom) for a bar dataset; falls back to the
  // flat bottom colour until the chart area exists (first paint / hidden canvas).
  function makeGradient(chartObj, pair) {
    const area = chartObj && chartObj.chartArea;
    const ctx = chartObj && chartObj.ctx;
    if (!area || !ctx) return pair[1];
    const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, pair[0]);
    g.addColorStop(1, pair[1]);
    return g;
  }

  const TEXT = "#f4f0eb";
  const MUTED = "rgba(244, 240, 235, 0.55)";

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
    let cost = 0;
    let tokens = 0;
    for (const e of entries) {
      if (e.mode === "phrase_better") phrase++;
      else ask++;
      if (typeof e.costUsd === "number" && e.costUsd > 0) cost += e.costUsd;
      if (typeof e.inputTokens === "number" && e.inputTokens > 0) tokens += e.inputTokens;
      if (typeof e.outputTokens === "number" && e.outputTokens > 0) tokens += e.outputTokens;
    }
    if (el("statTotal")) el("statTotal").textContent = String(total);
    if (el("statAskBetter")) el("statAskBetter").textContent = String(ask);
    if (el("statPhraseBetter")) el("statPhraseBetter").textContent = String(phrase);
    if (el("statTokens")) el("statTokens").textContent = formatTokens(tokens);
    if (el("statCost")) el("statCost").textContent = formatCost(cost);
  }

  // Compact token count for the "approx" stat (e.g., 12.3K, 1.2M).
  function formatTokens(n) {
    if (!(n > 0)) return "0";
    if (n >= 1e6) return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}K`;
    return String(n);
  }

  function formatCost(cost) {
    if (!(cost > 0)) return "$0.00";
    if (cost < 0.01) return "<$0.01";
    return `$${cost.toFixed(cost < 1 ? 3 : 2)}`;
  }

  function updateRange(win) {
    const range = el("reportRange");
    if (!range) return;
    const opts = { month: "short", day: "numeric" };
    const startStr = win.start.toLocaleDateString(undefined, opts);
    const endStr = win.end.toLocaleDateString(undefined, { ...opts, year: "numeric" });
    range.textContent = `${startStr} – ${endStr}`;
  }

  // Turn the cached entries into stacked-bar datasets + legend for the grouping.
  function buildDatasets(win) {
    const dayIndex = new Map();
    win.keys.forEach((k, i) => dayIndex.set(k, i));

    const isProvider = group === "provider";
    const gradMap = isProvider ? PROVIDER_GRAD : MODE_GRAD;
    const solidMap = isProvider ? PROVIDER_SOLID : MODE_SOLID;
    const labelsMap = isProvider ? PROVIDER_LABELS : MODE_LABELS;
    const order = isProvider ? PROVIDER_ORDER : MODE_ORDER;
    const fallbackPair = isProvider ? PROVIDER_GRAD.other : MODE_GRAD.phrase_better;

    const buckets = new Map(); // seriesKey -> number[DAYS]
    for (const e of entries) {
      const key = isProvider ? normProvider(e.provider) : (e.mode === "phrase_better" ? "phrase_better" : "ask_better");
      const di = dayIndex.get(dayKey(new Date(e.ts)));
      if (di == null) continue;
      if (!buckets.has(key)) buckets.set(key, new Array(DAYS).fill(0));
      buckets.get(key)[di]++;
    }

    // Keep known series in a stable order; drop empty ones to reduce legend noise.
    const present = order.filter((key) => buckets.has(key));
    const datasets = present.map((key) => {
      const pair = gradMap[key] || fallbackPair;
      return {
        label: labelsMap[key] || key,
        data: buckets.get(key),
        backgroundColor: (context) => makeGradient(context.chart, pair),
        borderWidth: 0,
        borderRadius: 5,
        borderSkipped: "bottom",
        maxBarThickness: 22,
        stack: "usage"
      };
    });
    const legend = present.map((key) => ({
      label: labelsMap[key] || key,
      color: solidMap[key] || fallbackPair[1]
    }));
    return { datasets, legend };
  }

  // Custom legend (top-right of the chart card) — colored dot + label.
  function renderLegend(legend) {
    const box = el("reportLegend");
    if (!box) return;
    box.textContent = "";
    for (const item of legend) {
      const el2 = document.createElement("span");
      el2.className = "report-legend-item";
      const dot = document.createElement("span");
      dot.className = "report-legend-dot";
      dot.style.background = item.color;
      const label = document.createElement("span");
      label.textContent = item.label;
      el2.appendChild(dot);
      el2.appendChild(label);
      box.appendChild(el2);
    }
  }

  function destroyChart() {
    if (chart) { chart.destroy(); chart = null; }
    // Defensive: clear any orphan Chart bound to the canvas (prevents the
    // "Canvas is already in use" error when the section is re-rendered).
    const canvas = el("reportChart");
    if (canvas && typeof Chart !== "undefined" && typeof Chart.getChart === "function") {
      const orphan = Chart.getChart(canvas);
      if (orphan) orphan.destroy();
    }
  }

  function drawChart(win) {
    const canvas = el("reportChart");
    const empty = el("reportEmpty");
    if (!canvas) return;

    const hasData = entries.length > 0 && typeof Chart !== "undefined";
    if (empty) empty.hidden = hasData;
    canvas.style.visibility = hasData ? "visible" : "hidden";
    if (!hasData) {
      destroyChart();
      renderLegend([]);
      return;
    }

    const { datasets, legend } = buildDatasets(win);
    renderLegend(legend);
    destroyChart();

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
            border: { display: false },
            ticks: { color: MUTED, maxRotation: 0, autoSkip: true, autoSkipPadding: 14, font: { size: 10 } }
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: { display: false },
            border: { display: false },
            ticks: { display: false }
          }
        },
        plugins: {
          legend: { display: false },
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

  // Exposed so options.js can render Reports when it's reached via a URL hash
  // (#reports) on refresh — the section only becomes active after this script's
  // own load-time check has already run.
  window.AskBetterReports = { render };

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
