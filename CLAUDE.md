# AskBetter — Agent Reference

> **Usage**: At the start of every session, read this file first. It provides a complete picture of the solution — structure, architecture, features, UI components, and conventions — so you don't need to crawl the codebase from scratch.
> After completing any feature work, update the relevant section(s) of this file.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Solution Structure](#3-solution-structure)
4. [Architecture](#4-architecture)
5. [Key Source Files](#5-key-source-files)
6. [Features](#6-features)
7. [Content Scripts & Injection](#7-content-scripts--injection)
8. [State & Persistence](#8-state--persistence)
9. [UI Components](#9-ui-components)
10. [Site / Landing Page](#10-site--landing-page)
11. [Build & Deployment](#11-build--deployment)
12. [Development Setup](#12-development-setup)
13. [Conventions & Patterns](#13-conventions--patterns)

---

## 1. Project Overview

**AskBetter** is a Chrome extension (Manifest V3) that rewrites prompts in one click using AI providers of your choice (Gemini, OpenAI, or Claude). The extension injects an **Optimize** button directly into ChatGPT, Google Gemini, and Claude.ai interfaces, runs locally in the browser, and requires no backend server. Optimized prompts are shown in a **non-destructive preview** (Accept / Regenerate / Discard) before they replace the input, and a keyboard shortcut (`Ctrl/Cmd+Shift+O`) triggers optimization without reaching for the button.

- **Repo**: `piyushdoorwar/prompt-optimizer-ask-better`
- **Owner/Author**: Piyush Doorwar
- **Type**: Chrome Extension (MV3)
- **Brand**: AskBetter (orange/yellow accent color: `#e8991e`)
- **License**: Not specified
- **Current version base**: `0.x`
- **Website**: deployed to GitHub Pages from `/site/`

Design philosophy: minimal, non-intrusive UI; local-first (no telemetry); instant one-click optimization of any prompt.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Extension API | Chrome Extensions API (Manifest V3) |
| Background Script | JavaScript (Service Worker) |
| Content Scripts | JavaScript (injected into ChatGPT & Gemini pages) |
| UI / Popup | HTML, CSS (custom styling, yellow accent color) |
| AI Providers | OpenAI, Google Gemini, Anthropic Claude (via API keys) |
| Storage | `chrome.storage.local` (API keys, settings, presets) |
| Packaging | Manifest v3 (Chrome Web Store submission) |
| Site | Static HTML/CSS/JS (GitHub Pages) |
| Build System | Manual packaging (manifest.json, file structure) |
| Deployment | Chrome Web Store (pending) + GitHub Pages (site) |

**No backend server.** All API calls originate from the client's browser. API keys are stored locally, never sent to external servers except the chosen AI provider.

---

## 3. Solution Structure

```
prompt-optimizer-ask-better/
├── manifest.json              # Extension manifest (v3)
├── background.js              # Service Worker — background logic, API calls
├── README.md                  # Project overview
├── LICENSE                    # License file
├── codex.md                   # Internal documentation
│
├── content/                   # Content scripts injected into pages
│   ├── core.js              # Shared injection engine (startAskBetter + preview + helpers)
│   ├── chatgpt.js           # ChatGPT config (selectors) → startAskBetter
│   ├── gemini.js            # Google Gemini config → startAskBetter
│   ├── claude.js            # Claude.ai config → startAskBetter
│
├── injected/                  # Styles for injected components
│   └── styles.css            # Styling for the Optimize button & overlays
│
├── ui/                        # Extension popup & options UI
│   ├── popup.html            # Popup interface (main UI)
│   ├── popup.css             # Popup styling
│   ├── popup.js              # Popup event handling & state management
│   ├── options.html          # Settings/options page
│   ├── options.css           # Options styling
│   ├── options.js            # Options page logic
│   ├── models.js             # Model dropdown source: live /v1/models fetch + 24h cache + self-healing selection, no hardcoded lists (loaded before popup.js/options.js)
│   ├── reports.js            # Reports section (Chart.js usage dashboard, reads usageLog)
│   ├── history.js            # History section (reads promptHistory, copy/clear)
│   ├── theme.css             # Global theme (variables, dark mode, redesign tokens, Manrope @font-face)
│   ├── fonts/                # Vendored Manrope variable woff2 (manrope-variable.woff2) — local-first, no remote fetch
│
├── site/                      # Landing page & documentation (GitHub Pages)
│   ├── fonts/                # Vendored Manrope (same file as ui/fonts)
│   ├── index.html            # Homepage
│   ├── styles.css            # Site styling
│   ├── app.js                # Site scripts
│   ├── icon.svg              # Brand icon
│   ├── assets/icons/         # Icon SVGs for features, presets, privacy
│   ├── policy/
│   │   └── index.html        # Privacy policy page
│
├── assets/                    # Extension assets
│   └── icons/
│       └── ui/               # UI icon files (unused in current build)
│
└── .github/
    └── CLAUDE.md             # THIS FILE (agent reference)
```

---

## 4. Architecture

Pattern: **Message-based communication** between background script, content scripts, and popup UI.

```
┌──────────────────────────────────────────┐
│  ChatGPT / Google Gemini pages           │
│  ┌──────────────────────────────────────┐│
│  │ Content Scripts                      ││
│  │ ├─ chatgpt.js (ChatGPT injection)    ││
│  │ └─ gemini.js (Gemini injection)      ││
│  │ ┌──────────────────────────────────┐ ││
│  │ │ Optimize Button (injected)       │ ││
│  │ │ - Listen for clicks              │ ││
│  │ │ - Extract prompt text            │ ││
│  │ │ - Send to background via message │ ││
│  │ └──────────────────────────────────┘ ││
│  └──────────────────────────────────────┘│
│              │ postMessage               │
└──────────────┼──────────────────────────┘
               │
    ┌──────────▼──────────────┐
    │  Background Script      │
    │  (Service Worker)       │
    │                         │
    │  background.js:         │
    │  ├─ Listen for messages │
    │  ├─ Fetch AI providers  │
    │  ├─ Build prompt        │
    │  ├─ Call OpenAI/Gemini/ │
    │  │   Claude APIs        │
    │  └─ Return result       │
    └──────────┬──────────────┘
               │ sendResponse
┌──────────────▼──────────────┐
│  Popup & Options UI         │
│  ├─ popup.html / .js        │
│  ├─ options.html / .js      │
│  ├─ API key configuration   │
│  ├─ Preset selection        │
│  └─ Settings storage        │
└─────────────────────────────┘
```

### Message Flow

1. **User clicks Optimize button** in ChatGPT or Gemini
   - Content script extracts selected/current prompt text
   - Sends message to background: `{ type: "ASKBETTER_OPTIMIZE", prompt: "...", site: "chatgpt|gemini|claude", preset: "..." }`

2. **Background script receives request**
   - Looks up user's API provider & key from `chrome.storage.local`
   - Builds optimized prompt using the selected preset
   - Calls appropriate AI API (OpenAI, Gemini, or Claude)
   - Returns `{ ok, optimizedPrompt, variants?, usage? }` to the content script (`variants` when `askBetterOptionCount` > 1; `usage` is the token/cost estimate)

3. **Content script receives response**
   - Shows the result in the non-destructive preview card (variants / diff / refine / cost); Accept writes into the prompt input box

4. **User can review, refine, & submit** the optimized prompt to the AI

**Other message types:** `ASKBETTER_REFINE` `{ base, instruction, site }` → follow-up refinement of preview text; `ASKBETTER_GET_PUBLIC_SETTINGS`, `ASKBETTER_TEST_KEY`, `ASKBETTER_FETCH_MODELS`, `ASKBETTER_GET/SAVE_BUTTON_OFFSET`, and the `ASKBETTER_TRIGGER_OPTIMIZE` shortcut dispatch.

### State Management

- **Settings stored in `chrome.storage.local`**:
  - `apiProvider` — "openai" | "gemini" | "claude"
  - `apiKey` — user's API key (never sent to backend)
  - `selectedPreset` — active prompt preset ("optimize", "fix-grammar", etc.)
  - `lastUsedProvider` — remembers user's choice

---

## 5. Key Source Files

| File | Role |
|---|---|
| `manifest.json` | Extension manifest — defines permissions, scripts, icons, browser action |
| `background.js` | Service Worker — main extension logic, API orchestration, keyboard command dispatch |
| `content/core.js` | Shared injection engine — `startAskBetter()`, Optimize button, preview card, busy/toast UI, all DOM helpers. Loaded before each site config script. |
| `content/chatgpt.js` | ChatGPT config — defines selectors + calls `startAskBetter("chatgpt", …)` |
| `content/gemini.js` | Google Gemini config — calls `startAskBetter("gemini", …)` |
| `content/claude.js` | Claude.ai config — calls `startAskBetter("claude", …)` |
| `injected/styles.css` | Styling for injected UI elements (button, overlays) |
| `ui/popup.html` | Popup UI template |
| `ui/popup.js` | Popup event handlers & state management |
| `ui/models.js` | Model dropdown source — live `/v1/models` fetch (no hardcoded lists), 24h cache, and `chooseModel()` self-healing. Loaded before `popup.js`/`options.js`; both share its `getProviderModels()` / `refreshProviderModels()` / `chooseModel()` helpers. |
| `ui/history.js` | History section — reads local `promptHistory`, renders original→optimized pairs newest-first with copy/clear (loaded in `options.html`). |
| `ui/options.html` | Settings page template |
| `ui/options.js` | Settings page logic (API key config, preset selection) |
| `ui/theme.css` | Global CSS variables (colors, fonts, dark mode) |
| `site/index.html` | Landing page |
| `site/app.js` | Site scripts (e.g., install button handlers) |

---

## 6. Features

### One-Click Optimize

- **Where**: ChatGPT, Google Gemini, and Claude.ai prompt inputs
- **How**: Injected "Optimize" button (sparkle icon, draggable) appears near the prompt input. Also triggerable via the `Ctrl/Cmd+Shift+O` keyboard shortcut (defined in `manifest.json` `commands`, dispatched by the background worker to the active tab via `ASKBETTER_TRIGGER_OPTIMIZE`).
- **Action**: User triggers → prompt extracted → sent to background → optimized → shown in preview card.

### Non-Destructive Preview

- After optimization, the result is shown in a floating **preview card** anchored near the input — it does **not** overwrite the prompt automatically.
- Actions: **Accept** (write into the input), **Regenerate** (re-run the same prompt/preset), **Discard** (close, original untouched). `Esc` discards.
- The preview text is editable, so users can tweak before accepting.
- Implemented entirely in `content/core.js` (`showPreview` / `acceptPreview` / `regeneratePreview` / `closePreview`); styles are `pf-preview-*` in `injected/styles.css`.
- The card also hosts four newer features (all in `content/core.js`, styles `pf-preview-*` / `pf-diff-*`):
  - **Multi-variant switcher** — when Ask Better returns more than one rewrite (`askBetterOptionCount` > 1), variant pills ("Option 1/2/3") let the user switch between rewrites; per-variant edits are preserved via `selectVariant` / `getActiveText` / `setActiveText` and the textarea `input` listener.
  - **Diff view** — a **Diff** toggle renders a word-level diff (original → current text) via the top-level `buildDiffFragment` (LCS over word/whitespace tokens; `pf-diff-add` / `pf-diff-del`, whitespace never flagged). `toggleDiff` / `renderDiffMode` / `renderDiff`.
  - **Follow-up / chain refinement** — a "Refine" input sends `ASKBETTER_REFINE` with the current text + a change instruction; the result replaces the active variant and chains (each refine operates on the latest text). `refinePreview`.
  - **Token/cost footer** — `formatUsage` shows the per-request `≈ N tokens · ≈ $X` estimate from the response's `usage` payload (see Token & Cost Estimates).

### Prompt History (local, last 100)

- A **History** panel (Common group, `section-history`) lists recent rewrites (**original → optimized**) newest-first, each with provider/model/mode and **Copy optimized** / **Copy original** buttons, plus **Clear history**.
- Source data is the local `promptHistory` array — `recordHistory()` in `background.js` appends one entry per successful Ask Better optimize, **Refine**, and Phrase Better result; capped to the most recent 100, texts truncated to 4000 chars. Never sent anywhere.
- Rendered by `ui/history.js` (reads `chrome.storage.local` directly, copy via `navigator.clipboard` with an `execCommand` fallback, lazy render on section open).

### Multi-variant Optimize

- `askBetterOptionCount` (1–3, **default 1** so out-of-box behavior and cost are unchanged) controls how many rewrites the Optimize preview offers. Set in **Options → AskBetter → Suggestions** (`section-askbetter-suggestions`), mirroring Phrase Better's Suggestions.
- When > 1, the ask-better branch of `buildSystemInstruction` requests N numbered single-line variants; `rewriteText` parses them with the shared `parsePhraseVariants` and returns a `variants` array (and `optimizedPrompt` = variants[0] for back-compat). The single-shot completion-retry only runs for the 1-variant case.

### Follow-up Refinement

- `ASKBETTER_REFINE` → `refineText` in `background.js` applies a single requested change to already-generated text using `buildRefineInstruction()` (a `systemOverride` passed through `callProvider`). Records usage + history like a normal optimize. Ask Better only (Phrase Better has no preview).

### Token & Cost Estimates

- Each provider call now returns `{ text, usage }`; `usage` is `{ inputTokens, outputTokens }` extracted from `usageMetadata` (Gemini), `usage` (OpenAI Responses / Anthropic), or `null`.
- `estimateCostUsd(provider, model, in, out)` uses `PRICING_PER_MTOK` — an **approximate** per-family price table (USD per 1M tokens, pattern-matched cheapest-specific-first with a mid-tier fallback). It is a guide, not a bill; the UI always labels it "approx".
- The optimize/refine response carries a `usage` payload (`buildUsagePayload`) shown in the preview footer. Token counts + `costUsd` are also written into `usageLog`, and the Reports panel sums them into an **Est. cost (approx)** stat (`statCost`).

### Custom User Presets

- Beyond the built-in presets, users can define their own `{ id, name, instruction }` presets in **Options → AskBetter → Presets & Additions → Custom presets**.
- Stored in `chrome.storage.local` under `settings.customPresets`; ids are namespaced `custom_*`.
- Custom presets appear as a **Custom** group in the options Default-preset chips (via a hidden-select `optgroup[data-custom]`, see Ask Better presets note in §9) and in the popup's Default-preset dropdown.
- The background worker resolves the instruction in `getPresetInstruction(preset, settings)`; `normalizePreset(value, settings)` validates custom ids against the stored list.

### 15+ Presets

Four categories:

1. **Core Rewrite**
   - Structured, Concise, Fix Grammar, Improve Clarity

2. **Communication Style**
   - Persuasive, Executive Brief, Coaching Tone, Email Rephrase

3. **Critical Thinking**
   - Devil's Advocate, First Principles, Risk Audit

4. **Build & Delivery**
   - Technical Spec, Implementation Plan

Presets are stored as `{ name, systemPrompt, description }` in `chrome.storage.local`.

### Rewrite Rules (Ask Better prompt construction)

The Ask Better system instruction (`buildSystemInstruction` in `background.js`, the non–phrase-better branch) enforces two cross-preset rules so rewrites don't balloon or hallucinate:

- **Proportionality** — the rewrite is scaled to the input; a short/vague prompt yields a short rewrite, never padded for its own sake.
- **No fabrication** — the model must not invent concrete details the user didn't provide (facts, names, numbers, dates, audiences, tools, domain requirements).
- **`structured`** is narrative/flowing and may add *generic* framing to be well-formed, but must not fabricate specifics and must stay short for thin inputs — it no longer forces "2–3 paragraphs".
- Custom-preset instructions are resolved by `getPresetInstruction(preset, settings)`; user `customPromptAdditions` are appended and take priority over default preset style on conflict.

### Three AI Providers

- **OpenAI** (GPT-4, GPT-3.5, etc.) — API key required (`api.openai.com`)
- **Google Gemini** — API key required (`generativelanguage.googleapis.com`)
- **Anthropic Claude** — API key required (`api.anthropic.com`)

User selects provider & enters API key in the extension options page. Selection is remembered.

### Dynamic Model Lists (self-updating dropdowns)

- **No hardcoded model lists.** Dropdowns are populated purely from each provider's **live** catalogue, so new flagship models appear and retired ones disappear with no code edit.
- On opening the popup/options (and on provider switch or key verify), the page calls `refreshProviderModels(provider)` (`ui/models.js`) → background `ASKBETTER_FETCH_MODELS` → `fetchModelsForProvider` hits `GET /v1/models` (Gemini `…/v1beta/models`, OpenAI, Anthropic). Results are **regex-filtered to main chat models** (`isMainGeminiModel` / `isMainOpenAIModel` in `background.js` drop embeddings, audio/TTS, vision, image/video, experimental builds, and dated snapshots; Anthropic keeps `claude-*`) and **cached 24h** in `chrome.storage.local.modelCache` — at most one network call per provider per day.
- **Sorted newest-first by the API's own timestamps** (OpenAI `created`, Anthropic `created_at`; Gemini by name, no timestamp field) so the top entry is the latest flagship — no version list to maintain.
- The background worker resolves the stored key itself and short-circuits with `MISSING_KEY` (no network) when none exists. Offline / before a key, the dropdown just shows the stored model (rendered plainly, no `(custom)` tag).
- **Self-healing default:** `chooseModel()` keeps the stored selection when the live list still offers it; otherwise it snaps to the newest live model and persists it (`savePartial` / `updateSettings`). So a deprecated default never strands the user.
- **Dropdown gating:** the model `<select>` is disabled (and a `.model-hint` is shown) until the active provider's key is saved & verified — `applyModelAvailability()` in both `ui/options.js` and `ui/popup.js`. The custom-select wrapper mirrors the native `disabled` via `shell._syncCustomSelectDisabled()` / the `csel--disabled` class. In options the dropdown re-enables immediately on a successful key test.
- The only per-provider model constant left is the single **seed** in each `DEFAULT_SETTINGS` (`*Model`, kept in sync across `background.js`, `ui/options.js`, `ui/popup.js`) — a bootstrap value used before the first fetch; it self-heals once a live list loads. To tune what passes the noise filter, edit the `isMain*Model` predicates in `background.js`.

### "Phrase Better" (Right-Click Context Menu)

- User right-clicks any selected text on a webpage → "Re-phrase with AskBetter".
- Runs entirely in the background worker (`handlePhraseBetterContextMenu`); works on **any** page, including those where `injected/styles.css` is not loaded.
- Generates **1–3 distinct suggestions** in a single API call (configurable via `phraseBetterOptionCount`, default 2). Multi-variant output is requested via `buildSystemInstruction({ mode:"phrase_better", variantCount })` and parsed by `parsePhraseVariants`.
- **Presets + adjustments** (parallel to Ask Better's presets): `phraseBetterPreset` picks the goal — `fix_grammar` (**default**, the original minimal-edit grammar fix), `rephrase`, `casual`, `formal` — resolved from `PHRASE_PRESET_INSTRUCTIONS` in `background.js`. Four optional, stackable modifier toggles (`phraseBetterKeepVoice`, `phraseBetterPolish`, `phraseBetterWit`, `phraseBetterHumanize`) append extra clauses via `getPhraseModifierClauses(settings)`; all default off, so the out-of-box behavior is unchanged. `phraseBetterHumanize` strips AI tells (no em dashes, emojis, or robotic stock phrasing) and is written to apply without overriding the preset or other modifiers. The `phrase_better` branch of `buildSystemInstruction` reads these from `settings` (the passed `preset` arg is unused for this mode).
- Shows a **non-destructive chooser overlay** injected into the page (`showPhraseBetterChooserOnPage`, fully inline-styled): the user clicks a suggestion to apply it (flashes an "Applied" check), or dismisses via the close button / click-outside / `Esc`. It never auto-replaces the selection.
- The selection context (text-input offsets or a cloned contenteditable `Range`) is captured **at context-menu time** by `capturePhraseBetterSelectionOnPage` and stored on the page's isolated-world global `window.__askBetterPhraseSelection`, so the rephrase can be applied to the original location even after the async request — the user doesn't have to keep the text selected. The chooser falls back to the live selection if the stored one is gone.

### Usage Reports (local, 30-day)

- A **Reports** panel (Common group, `section-reports`) shows a rolling 30-day usage dashboard: total requests, an Ask Better / Phrase Better split, and a stacked bar chart of daily request counts.
- The chart is **Chart.js v4** (`ui/vendor/chart.umd.min.js`, vendored — MV3 blocks remote scripts), driven by `ui/reports.js`, laid out inside a bordered `.report-chart-card` with an HTML header (`.report-chart-title` + a **custom** `.report-legend`; Chart.js's built-in legend is disabled). A segmented toggle re-stacks the bars by **provider** or **app/mode**.
- **Single-hue amber palette** (`PROVIDER_GRAD` / `MODE_GRAD` + `*_SOLID` in `reports.js`) — every series is a shade of amber (no multi-colour), rendered as a vertical top→bottom **gradient** per bar via a scriptable `backgroundColor` + `makeGradient()`; legend dots use the flat `*_SOLID` colour. Bars have `borderRadius: 5` / `borderSkipped:"bottom"` (rounded tops), and both axes are visually hidden (grid/border/ticks off; y ticks off, x keeps subtle auto-skipped date ticks) for the clean card look.
- Source data is the local `usageLog` (see State & Persistence) — `recordUsage()` in `background.js` appends one entry per successful Optimize / Phrase Better request; nothing is sent anywhere. `reports.js` reads it directly from `chrome.storage.local`, filters to 30 days, and renders lazily when the section is first opened (the canvas must be visible for Chart.js to size correctly).
- **Deep-link / refresh safety:** `reports.js` exposes `window.AskBetterReports.render()`; `applyHashRoute()` in `options.js` calls it (next animation frame) when `#reports` is opened on refresh, since the section only becomes active *after* reports.js's own load-time check. `drawChart` also destroys any orphan `Chart.getChart(canvas)` before creating a new one to avoid the "Canvas is already in use" error on re-render.

### Local-First Storage

- **API keys**: stored in `chrome.storage.local`, never sent to external servers
- **Settings**: preset choice, provider, last used settings
- **No telemetry**: no analytics, no usage tracking, no crash reporting

### Privacy & Transparency

- All API calls are direct from browser to the AI provider
- Extension code is visible on GitHub
- Source available, non-commercial use

---

## 7. Content Scripts & Injection

> **Shared engine**: All injection logic lives in `content/core.js`, which exposes the top-level `startAskBetter(site, siteToggleKey, selectors)` plus DOM helpers (`findPromptInput`, `readPromptText`, `writePromptText`, `sendMessage`, `showToast`). Each site script (`chatgpt.js`, `gemini.js`, `claude.js`) is a thin IIFE that defines its selectors and calls `startAskBetter`. The manifest loads `core.js` **before** the site script for each surface; content scripts of the same extension share one isolated-world global, so the site scripts can call into `core.js`. `core.js` also registers a `chrome.runtime.onMessage` listener for `ASKBETTER_TRIGGER_OPTIMIZE` (the keyboard shortcut path), and `findPromptInput` includes a shadow-DOM-piercing fallback (`findPromptInputDeep`).

> **Claude runs in an iframe**: Claude isolates its composer in a **separate-subdomain iframe** (`https://a.claude.ai/isolated-segment.html`), not in the top `claude.ai` document. So the Claude content-script entry uses `matches: ["https://claude.ai/*", "https://*.claude.ai/*"]`, `"all_frames": true`, and iframe fallback flags (`match_about_blank`, `match_origin_as_fallback`) — without these, the script can miss the composer frame. The button is created inside that iframe (its `position: fixed` is relative to the iframe viewport, which overlays the composer). Claude's editor may expose `contenteditable="true"` or `contenteditable="plaintext-only"`, and the shared eligibility check allows single-line contenteditable editors as short as 16px high. ChatGPT and Gemini keep their composer in the top frame and don't need these Claude-specific frame flags.

### ChatGPT Integration (`content/chatgpt.js`)

1. **Page Detection**: Monitors `window.location` for `chat.openai.com`
2. **DOM Observation**: Watches for prompt input element (target textarea or contenteditable div)
3. **Button Injection**: Creates & injects the yellow "Optimize" button next to the input
4. **Event Handling**: 
   - On button click → extract prompt text from the input element
   - Send message to background with preset choice
   - Receive optimized text
   - Insert back into the input element

### Gemini Integration (`content/gemini.js`)

- Similar logic to ChatGPT, but targets Google Gemini's UI elements
- Detects `gemini.google.com`
- Injects button in the appropriate location in the Gemini interface

### Styling (`injected/styles.css`)

- Button styling: yellow background (`#e8991e`), rounded, with hover states
- Overlay styling for "Phrase Better" context menu
- Animations for smooth transitions

---

## 8. State & Persistence

### In-Memory State (Popup & Background)

```javascript
{
  apiProvider: "openai" | "gemini" | "claude",
  apiKey: "...",  // Never logged; only read from storage
  selectedPreset: "optimize",
  presets: [
    { name: "Optimize", category: "improve", system_prompt: "..." },
    { name: "Fix Grammar", category: "core", system_prompt: "..." },
    // ... 15+ more
  ],
  isConverting: false,  // True while awaiting API response
  lastError: null       // Error message, if any
}
```

### Persistent Storage (`chrome.storage.local`)

- **`apiProvider`**: User's chosen AI provider
- **`apiKey`**: Encrypted or plaintext (depends on implementation; currently plaintext)
- **`defaultPreset`**: Currently selected preset id (built-in or `custom_*`)
- **`customPresets`**: User-defined presets, array of `{ id, name, instruction }`
- **`enableChatGPT` / `enableGemini` / `enableClaude`**: Per-surface injection toggles
- **`uiPrefs.buttonOffsets`**: Draggable button offset per surface (`chatgpt`/`gemini`/`claude`)
- **`modelCache`**: Live model lists per provider, `{ [provider]: { models: string[], ts } }`, refreshed at most every 24h (see Dynamic Model Lists). Stored at the top level, **not** inside `settings`.
- **`usageLog`**: Local-only usage history for the Reports section — an array of `{ ts, provider, model, mode, inputTokens, outputTokens, costUsd }`, one entry per successful request, appended by `recordUsage()` in `background.js`. Pruned to the last 30 days (and capped at 5000) on every write; the Reports view also re-filters to 30 days on read and sums `costUsd` into the Est. cost stat. Never sent anywhere. Top-level key, not inside `settings`.
- **`promptHistory`**: Local-only rewrite history for the History section — an array of `{ ts, original, optimized, preset, provider, model, mode }`, one entry per successful optimize/refine/phrase result, appended by `recordHistory()` in `background.js`. Capped to the most recent 100 (texts truncated to 4000 chars). Never sent anywhere. Top-level key, not inside `settings`.
- **`settings.askBetterOptionCount`**: 1–3 (default 1) — number of rewrites the Optimize preview offers (Multi-variant Optimize).

---

## 9. UI Components

### Popup Interface (`ui/popup.html`)

The popup is shown when the user clicks the extension icon in the Chrome toolbar.

```
┌────────────────────────────────────┐
│  AskBetter Settings                │  ← Header with brand
├────────────────────────────────────┤
│                                    │
│  API Provider                      │
│  [ OpenAI ▾ ]  [ Gemini ]  [ ... ] │  ← Provider selector
│                                    │
│  API Key                           │
│  [ •••••••••••• ]  [ Show ]        │  ← Password-style input
│                                    │
│  Preset Category                   │
│  [ Core Rewrite ▾ ]                │  ← Preset category selector
│                                    │
│  [ Settings ]  [ About ]           │  ← Navigation buttons
│                                    │
└────────────────────────────────────┘
```

### Options Page (`ui/options.html`)

Full settings page accessible from the popup or extension management UI.

**Sidebar menu is grouped by app**, each group wrapped in a `<div class="menu-group" data-group="...">` (tab-style: one `.settings-section` shown at a time, switched by `activateSection` via each nav button's `data-section`). Group headers use `.menu-title` / `.menu-title--group`:

- **Common** — `section-models` (provider, model, and the global **Enable AI** toggle), `section-mode` (**both** Ask Better + Phrase Better on/off), `section-reports` (local usage dashboard), `section-history` (local rewrite history), `section-security` (API key verify + clear data)
- **AskBetter** — `section-integrations` (Enable on ChatGPT/Gemini/Claude), `section-presets` (**Presets & Additions** — merged panel: default-preset chips + Keep-user-voice, **Custom presets**, and **Custom prompt additions**/quick tags; the old standalone `section-custom` was folded in here), `section-askbetter-suggestions` (**how many rewrite options** the preview offers, `askBetterOptionCount`)
- **PhraseBetter** — `section-phrasebetter-presets` (**preset** + on-top **adjustment toggles**), `section-phrasebetter-suggestions` (how many options to show)

**Deep-linkable sections (URL hash):** each section maps to a friendly hash slug via `SECTION_SLUGS` in `ui/options.js` (e.g. `#phrase-better-presets`, `#ask-better-suggestions`, `#history`). `activateSection(id, writeUrl=true)` writes the slug with `history.replaceState` (which never fires `hashchange`, so no routing loop); `applyHashRoute()` (called on load + `hashchange`) opens the section the hash points at, skipping any section whose `.menu-group` is hidden. History is special-cased as `#history-page-N`: `ui/history.js` exposes `window.AskBetterHistory` (`goToPage` / `getPage` / `refresh`), reads the initial page from the hash at init, and dispatches an `askbetter:history-page` CustomEvent on page change that `bindHashRouting()` mirrors back into the URL — so a refresh returns to the exact section **and** history page.

**Ask Better presets (chips + merged panel):** `section-presets` is the merged **Presets & Additions** panel. The Default preset is rendered as category-grouped **chips** (`.preset-chips` / `.preset-chip`, selected chip gets `.is-selected` + `--accent-gradient` amber styling) by `renderPresetChips()` in `ui/options.js`, backed by the hidden `#defaultPreset` `<select>` (still the source of truth for save + popup). Chips are built from the select's `<optgroup>`s, so custom presets (added as `optgroup[data-custom]` by `renderCustomPresetOptions()`) automatically appear as a **Custom** chip group. `syncPresetChipSelection()` mirrors the active chip on change. Below the chips: the **Keep user voice** toggle, the **Custom presets** editor (`.custom-presets-block`), and the folded-in **Custom prompt additions** block (`.merged-additions` — quick tags + reusable additions). Thin `border-top` dividers separate the three blocks.

**Phrase Better presets (card grid):** `section-phrasebetter-presets` renders the four presets as a 2×2 `.preset-card-grid` of `.preset-card` buttons (selected card gets `.is-selected` + `--accent-glow`) backed by a hidden `#phraseBetterPreset` `<select>` (still the source of truth). `phraseBetterPresetCards` + `syncPhrasePresetCards()` in `ui/options.js` keep cards and select in sync; the optional adjustments are the same four toggles in a 2×2 `.toggle-grid` (no longer full-width rows).

**Hide-when-off:** `applyGroupVisibility()` toggles `hidden` on the `askbetter` / `phrasebetter` `.menu-group` based on `enableAskBetterMode` / `enablePhraseBetterMode`; if the active section is in a group that just hid, it falls back to `section-models`. Called on load (end of `fillForm`) and from the two mode-toggle handlers. Mode lives in **Common** so the toggles are always reachable. Section info-modal copy lives in `SECTION_INFO_CONTENT` keyed by `data-info-section` (`modes`, `phrasebetter_presets`, `phrasebetter_suggestions`, …). All toggles/fields keep stable IDs, so moving them between panels doesn't touch the JS bindings.

```
┌────────────────────────────────────────┐
│  AskBetter Options                     │
├────────────────────────────────────────┤
│                                        │
│  API Provider Configuration            │
│  ┌────────────────────────────────────┐│
│  │ Provider: [ OpenAI ▾ ]             ││
│  │ API Key:  [ •••••••••••• ]         ││
│  │ Status:   ✓ Connected              ││
│  └────────────────────────────────────┘│
│                                        │
│  Presets                               │
│  ┌────────────────────────────────────┐│
│  │ □ Optimize       □ Fix Grammar     ││
│  │ □ Concise        □ Structured      ││
│  │ □ Persuasive     □ Technical Spec  ││
│  │ ... (all 15+ presets)              ││
│  └────────────────────────────────────┘│
│                                        │
│  [ Reset to Defaults ]  [ Save ]       │
│                                        │
└────────────────────────────────────────┘
```

### Visual Theme (`ui/theme.css`)

- **Colors**: 
  - Accent (yellow): `#e8991e`, hover: `#f5ae3a`
  - Background (dark): `#0f0d0b`
  - Panel (darker): `#161310`
  - Text (light): `#f4f0eb`
  - Muted: `#9a8f83`

- **Typography**: Manrope everywhere, falling back to Cantarell, Ubuntu, Inter, Segoe UI, sans-serif. Manrope is **vendored locally** as a single variable woff2 (`ui/fonts/manrope-variable.woff2`, weights 400–800) and declared via `@font-face` in `ui/theme.css` — no remote Google-Fonts fetch, preserving the local-first promise. The landing site vendors the same file at `site/fonts/manrope-variable.woff2`.
  - **Extension pages** (popup/options): `ui/theme.css` sets `--font-ui` (Manrope-first) on `body` **and** a global `button, input, select, textarea, optgroup { font-family: var(--font-ui) }` reset — form controls don't inherit `font-family` by default, so without this reset buttons/inputs silently fell back to the system font.
  - **Injected content-script UI** (`injected/styles.css`: Optimize button, preview card): declares its own `@font-face` for Manrope (`src: url("../ui/fonts/manrope-variable.woff2")`) and `--pf-font-ui` is now Manrope-first. Every interactive element sets `font: … var(--pf-font-ui)` explicitly.
  - **Inline-styled overlays injected on any page** (`showPhraseBetterChooserOnPage` / `showPageToastOnPage` / `showPageBusyIndicatorOnPage` in `background.js`): each injects a shared `<style id="askbetter-manrope-font">` `@font-face` (once) via `chrome.runtime.getURL("ui/fonts/manrope-variable.woff2")` and uses a Manrope-first `FONT` string; chooser `<button>`s set `fontFamily = "inherit"` since they don't inherit the card font.
  - The font is exposed to page origins via `manifest.json` `web_accessible_resources` (`ui/fonts/manrope-variable.woff2`, `matches: ["<all_urls>"]`) so both the injected CSS and the runtime-URL overlays can load it on any site.

- **Components**: Buttons (primary/secondary), inputs, dropdowns, checkboxes

---

## 10. Site / Landing Page

- Located at `/site/` in the repo
- Static HTML/CSS/JS site
- Deployed automatically to GitHub Pages on every push to `main`
- URL: `https://piyushdoorwar.github.io/prompt-optimizer-ask-better/`
- Contains: landing page, feature highlights, preset showcase, privacy statement

### Landing Page (`/site/index.html`)

- **Hero section**: "Ask Better" tagline, one-line value prop ("One-click prompt optimizer for ChatGPT, Google Gemini, and Claude")
- **Feature highlights**: 6 key features (One-click optimize, 15+ presets, Three AI providers, Phrase Better, Works where you work, Draggable & unobtrusive) with SVG icons
- **Preset showcase**: 4 preset categories (Core Rewrite, Communication Style, Critical Thinking, Build & Delivery) with descriptions
- **Privacy section**: 4 privacy features (No backend server, Local storage only, Key isolation, Zero telemetry)
- **Install section**: "Add to Chrome" button + GitHub link

### Icon System (`/site/assets/icons/`)

All icons are **SVG files** with `color: currentColor` to inherit yellow accent color:

- `sparkle.svg` — Optimize feature
- `sliders.svg` — Presets
- `robot.svg` — AI providers
- `cursor.svg` — Phrase Better
- `globe.svg` — Works where you work
- `lock.svg` — Unobtrusive
- `pen.svg` — Core Rewrite preset
- `chat.svg` — Communication Style preset
- `brain.svg` — Critical Thinking preset
- `gear.svg` — Build & Delivery preset
- `house.svg` — No backend server
- `storage.svg` — Local storage only
- `key.svg` — Key isolation
- `signal.svg` — Zero telemetry

### Site Styling (`/site/styles.css`)

- Dark theme matching extension (Lumyn palette)
- Responsive grid layouts for features, presets, privacy cards
- Smooth animations & transitions
- Mobile-first design

### Site Scripts (`/site/app.js`)

Currently minimal. Can be extended for:
- Dynamic Chrome Web Store button
- Install success redirect
- Analytics (if needed in future)

### Privacy Policy Page (`/site/policy/`)

- Standard privacy policy document
- Explains no telemetry, local-only storage, no backend
- Links to open-source code on GitHub

---

## 11. Build & Deployment

### Local Development

1. **Load extension locally**:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the repo directory

2. **Test on ChatGPT**:
   - Visit `chat.openai.com`
   - Set your API key in the extension options
   - Try the Optimize button in a prompt

3. **Test on Google Gemini**:
   - Visit `gemini.google.com`
   - Verify the button injects correctly

### Chrome Web Store Submission

- Package the extension as a `.zip` file (entire repo directory or just the essential files)
- Upload to Chrome Web Store developer console
- Follow submission guidelines (privacy policy, permissions justification, screenshots)
- Await review & approval

### GitHub Pages Deployment

- `/site/` is automatically deployed to GitHub Pages via GitHub Actions (or manual push)
- URL: `https://piyushdoorwar.github.io/prompt-optimizer-ask-better/`

---

## 12. Development Setup

### Prerequisites

- Chrome browser (v90+)
- A text editor or IDE (VSCode, etc.)
- Git

### Steps

1. **Clone the repo**:
   ```bash
   git clone https://github.com/piyushdoorwar/prompt-optimizer-ask-better.git
   cd prompt-optimizer-ask-better
   ```

2. **Load in Chrome**:
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Choose the repo root directory

3. **Configure API keys**:
   - Click the extension icon in Chrome toolbar
   - Go to Options / Settings
   - Enter your OpenAI, Gemini, or Claude API key

4. **Test**:
   - Open ChatGPT or Google Gemini in a new tab
   - The "Optimize" button should appear in the prompt input area
   - Click it and verify optimization works

---

## 13. Conventions & Patterns

### Naming

- **Files**: lowercase with hyphens (`chatgpt.js`, `popup.html`)
- **Classes/Objects**: camelCase or PascalCase as appropriate
- **Constants**: SCREAMING_SNAKE_CASE (rare; prefer module-level constants)
- **CSS classes**: kebab-case (`.optimize-button`, `.preset-card`)

### Colors

- **Primary accent**: `#e8991e` (yellow/orange)
- **Accent hover**: `#f5ae3a` (lighter)
- **Background**: `#0f0d0b` (near-black)
- **Panel**: `#161310` (dark gray)
- **Text**: `#f4f0eb` (light)
- **Muted**: `#9a8f83` (gray)

All color values are stored in `ui/theme.css` as CSS variables for easy theming.

**Single source of truth**: the palette is one warm amber theme kept in sync with `site/styles.css` — there is no purple. The popup/options reference `ui/theme.css` variables. The **injected** UI can't read those variables (content scripts load standalone), so `injected/styles.css` and the inline-styled overlays (`showPhraseBetterChooserOnPage` in `background.js`) use the same amber **literals** (`#e8991e` / `#f5ae3a`). When changing brand color, update `site/styles.css`, `ui/theme.css`, and those injected literals together.

**Redesign tokens** (in `ui/theme.css`): the visual language uses Manrope, larger radii (`--radius: 11px`, `--radius-card: 13px`, `--radius-lg: 16px`, `--radius-xl: 18px`, `--radius-pill`), gradient panel surfaces (`--panel-gradient`, `--panel-gradient-2`), glossy deep shadows (`--card-shadow`, `--card-shadow-lg`), a warm accent-gradient button (`--accent-btn` + `--accent-btn-glow`), and an icon-tile treatment (`--tile-bg` / `--tile-border`). A shared `@keyframes ab-pulse` drives the "connected" status dot. Popup + options consume these; the injected overlays mirror the equivalent literals (16px card radius, `linear-gradient(135deg,#f7b84a,#e8991e)` accept/optimize buttons, `0 24px 60px -18px rgba(0,0,0,.75)` card shadow).

**Popup "Keep my voice" toggle**: the popup exposes the existing `keepUserVoice` setting via a toggle (`#keepUserVoiceToggle`, `ui/popup.js`), the same setting the options **Presets** section shows ("Keep user voice") and that `buildSystemInstruction` in `background.js` applies to Ask Better rewrites. The popup also renders a static, platform-aware `Ctrl/⌘ ⇧ O` shortcut hint (`#shortcutMod` set in `popup.js`).

**Icons are SVG, never emoji** — all visible UI glyphs (Optimize button sparkle, preview/chooser close & check) are inline SVGs using `fill`/`stroke: currentColor`, mirroring `site/assets/icons/`.

### JavaScript Patterns

- **Message passing**: Use structured objects with `action` field to identify message type
- **Storage**: Always use `chrome.storage.local` for persistence; avoid `localStorage` (unreliable for extensions)
- **Error handling**: Try-catch around API calls; user-friendly error messages in UI
- **Async/await**: Preferred over callbacks for clarity

### CSS Patterns

- **Mobile-first**: Define mobile styles first, then breakpoints for larger screens
- **BEM lite**: Use simple kebab-case classes; avoid deeply nested selectors
- **Flexbox/Grid**: Use modern layouts; avoid floats
- **Dark mode**: Default dark theme in all stylesheets; light mode via media query if needed

### Documentation

- **Code comments**: Explain *why*, not *what* (code is self-documenting)
- **README.md**: Project overview, quick start, contribution guidelines
- **codex.md**: Internal reference for complex logic
- **This file (agents.md)**: Architecture, file structure, features, conventions
