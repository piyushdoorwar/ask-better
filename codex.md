# Codex Project Guide

## What This Project Is
AskBetter is a Manifest V3 browser extension for rewriting prompts and selected text with Google Gemini or OpenAI.

It currently has two user-facing modes:
- `Ask Better`: the existing in-page Optimize button for ChatGPT and Gemini prompt boxes.
- `Phrase Better`: a right-click rewrite action for selected text that behaves like a light Grammarly-style cleanup.

The extension is local-first:
- settings are stored in `chrome.storage.local`
- Provider API calls are made directly from the background service worker
- there is no backend server in this repo

## Core Product Behavior
### Ask Better
- Appears as a draggable `✨ Optimize` button on supported sites.
- Currently supported sites:
  - ChatGPT
  - Gemini
- Reads the prompt input, sends it to the background worker, rewrites it with the active preset, then writes the rewritten prompt back into the same input.

### Phrase Better
- Appears as a browser context-menu item: `Re-phrase with AskBetter`.
- Works on selected text in editable browser fields where replacement is possible.
- Uses a minimal-edit instruction:
  - fix grammar
  - fix spelling
  - fix punctuation
  - preserve wording, tone, meaning, and formatting as much as possible

## Architecture
### `manifest.json`
- MV3 extension manifest.
- Declares:
  - background service worker
  - popup
  - options page
  - content scripts for ChatGPT and Gemini
  - permissions like `storage`, `contextMenus`, `scripting`, `activeTab`

### `background.js`
- Main control plane for the extension.
- Responsibilities:
  - read/migrate default settings
  - expose public settings to content scripts
- call Gemini or OpenAI APIs
  - build system instructions
  - handle context menu creation and clicks
  - run Phrase Better replacement logic through `chrome.scripting.executeScript`
  - save/load draggable button offsets

Important message types:
- `ASKBETTER_GET_PUBLIC_SETTINGS`
- `ASKBETTER_TEST_KEY`
- `ASKBETTER_OPTIMIZE`
- `ASKBETTER_GET_BUTTON_OFFSET`
- `ASKBETTER_SAVE_BUTTON_OFFSET`

### `content/chatgpt.js`
- Injects the Ask Better button into ChatGPT pages.
- Finds the active prompt composer through a selector list.
- Reads prompt text from the page, sends it to the background worker, and writes back the optimized text.
- Honors:
  - global AI toggle
  - ChatGPT integration toggle
  - Ask Better mode toggle

### `content/gemini.js`
- Same pattern as ChatGPT integration, but tuned for Gemini selectors and page behavior.

### `ui/options.html`, `ui/options.css`, `ui/options.js`
- Full settings page.
- Sidebar navigation with sections.
- Current sections:
  - Models
  - Mode
  - Presets
  - Integrations
  - Custom Prompt Additions
  - Security

### `ui/popup.html`, `ui/popup.css`, `ui/popup.js`
- Lightweight popup for quick access to common controls.
- Good for small setting tweaks.
- Full configuration still lives on the options page.

### `injected/styles.css`
- Styles for the in-page Optimize button and toast.

## Current Settings Model
Settings are stored under `chrome.storage.local.settings`.

Important keys:
- `provider`
- `geminiApiKey`
- `geminiModel`
- `openaiApiKey`
- `openaiModel`
- `geminiKeyVerified`
- `openaiKeyVerified`
- `defaultPreset`
- `enableAI`
- `enableChatGPT`
- `enableGemini`
- `enableAskBetterMode`
- `enablePhraseBetterMode`
- `keepUserVoice`
- `customPromptAdditions`

UI preferences are stored separately under `chrome.storage.local.uiPrefs`.

Important UI pref:
- draggable Ask Better button offsets per site

## Rewrite Pipeline
### Ask Better path
1. Content script detects a supported input.
2. User clicks `✨ Optimize`.
3. Content script reads public settings from the background worker.
4. Content script sends the current prompt to `ASKBETTER_OPTIMIZE`.
5. Background worker builds the rewrite instruction from:
   - selected preset
   - keep-user-voice toggle
   - custom prompt additions
6. The selected provider returns rewritten text.
7. Content script replaces the original prompt content.

### Phrase Better path
1. User selects text in a browser page.
2. User right-clicks and chooses `Re-phrase with AskBetter`.
3. Background worker reads the selected text from the context-menu event.
4. Background worker calls Gemini with a minimal-edit instruction.
5. Background worker injects a small function into the page to replace the selection if the selection is inside:
   - `textarea`
   - text-like `input`
   - `contenteditable`
6. A small toast is shown in-page for success/failure.

## Presets
Presets currently include:
- `structured`
- `concise`
- `grammar`
- `clarity`
- `persuasive`
- `executive`
- `coaching`
- `email_rewrite`
- `devils_advocate`
- `first_principles`
- `risk_audit`
- `technical_spec`
- `implementation_plan`

For Phrase Better, the effective behavior is intentionally closer to `grammar`, but even stricter about preserving the original phrasing.

## Design And UX Patterns To Preserve
- Dark, polished UI with gold/purple accents.
- Settings page uses section-based navigation, not a long uncontrolled form.
- Popup should stay compact and quick.
- Ask Better button is draggable and should remain lightweight.
- Extension messaging should stay friendly and low-friction.
- Rewrites should return only plain text, with no explanation wrappers.

## Important Constraints
- Keep this an MV3 extension unless explicitly asked to change architecture.
- Prefer direct browser APIs over adding build tooling or frameworks.
- Do not introduce a backend dependency unless the user explicitly wants one.
- Preserve the current local-storage model and migration behavior.
- The repo now supports Gemini and OpenAI; when changing provider behavior, update settings, popup, and background together.
- When changing site integrations, update both content script logic and any related settings copy.
- When changing settings shape, update all three places together:
  - `background.js`
  - `ui/options.js`
  - `ui/popup.js`

## Known Limitations
- Ask Better is only injected on ChatGPT and Gemini right now.
- Phrase Better is broader, but only works inside editable browser fields.
- Phrase Better does not work in native desktop apps outside the browser.
- Some complex custom editors may not preserve selection cleanly during replacement.
- The popup does not currently expose every setting that exists in the full settings page.
- Provider selection now supports Gemini and OpenAI.

## Good Starting Assumptions For Future Requests
- This repo is a browser extension, not a web app.
- `background.js` is the main source of truth for runtime behavior.
- Content scripts should stay thin and defer model work to the background worker.
- If a request touches prompts or rewrite style, check `buildSystemInstruction`.
- If a request touches settings, check storage migration and UI sync in both options and popup.
- If a request touches right-click behavior, check context menu setup plus `chrome.scripting` injection flow.

## Good Prompt Examples For Future Codex Work
- "Add Phrase Better support for another editable surface while preserving the current architecture."
- "Add a new settings toggle and wire it through popup, options, storage migration, and background logic."
- "Improve the Phrase Better instruction so it preserves formatting more reliably."
- "Add a second AI provider without breaking the existing Gemini path."
- "Make Ask Better available on another site by adding a new content script and selectors."

## Current Working Context
Recent work already added:
- `Mode` section in settings
- `enableAskBetterMode`
- `enablePhraseBetterMode`
- right-click `Re-phrase with AskBetter`

If a future request mentions these features, assume they already exist unless the code has changed since this file was written.
