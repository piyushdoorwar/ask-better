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

**AskBetter** is a Chrome extension (Manifest V3) that rewrites prompts in one click using AI providers of your choice (Gemini, OpenAI, or Claude). The extension injects an **Optimize** button directly into ChatGPT and Google Gemini interfaces, runs locally in the browser, and requires no backend server.

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
│   ├── chatgpt.js            # ChatGPT prompt optimization logic
│   ├── gemini.js             # Google Gemini prompt optimization logic
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
│   ├── theme.css             # Global theme (variables, dark mode)
│
├── site/                      # Landing page & documentation (GitHub Pages)
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
    └── agents.md             # THIS FILE
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
   - Sends message to background: `{ action: "optimize", text: "...", site: "chatgpt|gemini", preset: "..." }`

2. **Background script receives request**
   - Looks up user's API provider & key from `chrome.storage.local`
   - Builds optimized prompt using the selected preset
   - Calls appropriate AI API (OpenAI, Gemini, or Claude)
   - Returns optimized text to content script

3. **Content script receives response**
   - Inserts optimized text into the prompt input box
   - Shows brief confirmation UI

4. **User can review & submit** the optimized prompt to the AI

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
| `background.js` | Service Worker — main extension logic, API orchestration |
| `content/chatgpt.js` | ChatGPT page integration — injects button, extracts text |
| `content/gemini.js` | Google Gemini page integration — similar to ChatGPT logic |
| `injected/styles.css` | Styling for injected UI elements (button, overlays) |
| `ui/popup.html` | Popup UI template |
| `ui/popup.js` | Popup event handlers & state management |
| `ui/options.html` | Settings page template |
| `ui/options.js` | Settings page logic (API key config, preset selection) |
| `ui/theme.css` | Global CSS variables (colors, fonts, dark mode) |
| `site/index.html` | Landing page |
| `site/app.js` | Site scripts (e.g., install button handlers) |

---

## 6. Features

### One-Click Optimize

- **Where**: ChatGPT prompt box & Google Gemini conversation input
- **How**: Injected "Optimize" button (yellow sparkle icon) appears near the prompt input
- **Action**: User clicks → prompt extracted → sent to background → optimized → inserted back into prompt box

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

### Three AI Providers

- **OpenAI** (GPT-4, GPT-3.5, etc.) — API key required (`api.openai.com`)
- **Google Gemini** — API key required (`generativelanguage.googleapis.com`)
- **Anthropic Claude** — API key required (`api.anthropic.com`)

User selects provider & enters API key in the extension options page. Selection is remembered.

### "Phrase Better" (Right-Click Context Menu)

- User right-clicks any selected text on a webpage
- Context menu shows "Rephrase with AskBetter"
- Opens a small overlay with the rephrased version
- User can copy or close

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
- **`selectedPreset`**: Currently selected preset name
- **`presets`**: Full preset list with descriptions
- **`lastUsedProvider`**: Auto-selects on extension open

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

- **Typography**: Cantarell, Ubuntu, Inter, Segoe UI, sans-serif

- **Components**: Buttons (primary/secondary), inputs, dropdowns, checkboxes

---

## 10. Site / Landing Page

- Located at `/site/` in the repo
- Static HTML/CSS/JS site
- Deployed automatically to GitHub Pages on every push to `main`
- URL: `https://piyushdoorwar.github.io/prompt-optimizer-ask-better/`
- Contains: landing page, feature highlights, preset showcase, privacy statement

### Landing Page (`/site/index.html`)

- **Hero section**: "Ask Better" tagline, one-line value prop ("One-click prompt optimizer for ChatGPT and Google Gemini")
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
