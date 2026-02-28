# AskBetter (Chrome Extension, MV3)

AskBetter is a local-first prompt optimizer that uses Google Gemini and works on:

- ChatGPT (`chat.openai.com` and `chatgpt.com`)
- Google Gemini (`gemini.google.com`)

It injects a lightweight `Optimize` button near the prompt input. Clicking it rewrites the current prompt based on your selected preset and replaces the textbox content.

## Privacy and Security

- No backend server.
- Data is stored locally in `chrome.storage.local`.
- API key is read and used only by `background.js` (service worker).
- Content scripts never read or store the API key.
- Prompt text is never logged by the extension.
- If `Custom Prompt Additions` is set, it is sent only with optimize requests to your selected provider.
- No analytics or telemetry are collected in this version.
- Full privacy policy: `https://piyushdoorwar.github.io/policy/`

## Presets

- `Core Rewrite`
  - `Structured`: story-like 2-3 paragraph prompt with strong context and constraints.
  - `Concise`: shorter while preserving requirements.
  - `Fix grammar`: spelling/grammar fixes with minimal rewrite.
  - `Improve clarity`: clearer phrasing with the same meaning.
- `Communication Style`
  - `Persuasive`: more compelling and outcome-oriented.
  - `Executive brief`: concise, strategic, stakeholder-friendly.
  - `Coaching tone`: supportive, accountable, action-driven.
  - `Email rephrase/rewrite`: polished email-ready rewrite with clear structure and tone.
- `Critical Thinking`
  - `Devil's advocate`: challenge weak assumptions and blind spots.
  - `First principles`: decompose to fundamentals and core logic.
  - `Risk audit`: focus on risks, failure modes, and mitigations.
- `Build and Delivery`
  - `Technical spec`: precise requirements and acceptance criteria.
  - `Implementation plan`: ordered tasks, dependencies, and deliverables.

## Files

- `manifest.json` (MV3 config)
- `background.js` (secure API handling + Gemini API calls)
- `content/chatgpt.js` (ChatGPT injection)
- `content/gemini.js` (Gemini injection)
- `injected/styles.css` (button + toast styles)
- `ui/theme.css` (shared design tokens/base theme for popup and options)
- `ui/popup.html`, `ui/popup.js`, `ui/popup.css` (quick controls/status/model switch)
- `ui/options.html`, `ui/options.js`, `ui/options.css` (sectioned settings + auto-save)
- `assets/icons/ui/*.svg` (menu/section icons for models, presets, integrations, custom prompt, security)

## Install (Unpacked)

1. Open Chrome and go to `chrome://extensions`.
2. Enable `Developer mode` (top right).
3. Click `Load unpacked`.
4. Select this folder: `c:\Repos\prompt-optimizer-ask-better`.
5. Pin the AskBetter extension (optional, recommended).

## Configure

1. Click the AskBetter extension icon.
2. Click `Open settings`.
3. Use the left menu sections:
   - Models
   - Presets
   - Integrations
   - Custom Prompt Additions
   - Security
4. Set:
   - API key
   - Gemini model
   - Default preset
   - Keep user voice toggle (preserve tone/style during rewrites)
   - Toggles (Global AI, ChatGPT, Gemini)
5. Settings auto-save on change (no Save button required).
6. In Security, click `Test key` once. On success, the key is saved and locked.
7. Use `Clear stored key/data` to reset key setup.

## Use on ChatGPT/Gemini

1. Open ChatGPT or Gemini.
2. Type or paste a prompt.
3. Click `Optimize`.
4. AskBetter replaces the current prompt with the optimized version.

If AI is off or no key is set, AskBetter shows:

- `AI disabled or key missing`

## API Key Link

- Gemini key: `https://aistudio.google.com/apikey`

## Notes

- AskBetter currently uses Google Gemini only as the model provider.
- The Optimize button can appear on both ChatGPT and Gemini pages.

## Legal Notice

By installing, enabling, or using AskBetter, you acknowledge and agree that AskBetter is provided "as is" and
"as available," without warranties of any kind, to the maximum extent permitted by applicable law.

You are solely responsible for your prompts, outputs, key management, provider configuration, compliance with provider
terms, data handling obligations, and applicable laws in your jurisdiction.

To the maximum extent permitted by law, the developer is not liable for indirect, incidental, special, consequential,
exemplary, or punitive damages, or for loss of data, business, revenue, or reputation arising from use of, or
inability to use, AskBetter.

## Manual Test Checklist

- [ ] Works on ChatGPT (`chat.openai.com` or `chatgpt.com`).
- [ ] Works on Gemini (`gemini.google.com`).
- [ ] Missing key shows helpful toast (`AI disabled or key missing`).
- [ ] Optimize replaces textbox content.
- [ ] Gemini model switch persists and is used by optimization requests.
- [ ] Options page left menu switches sections correctly.
- [ ] Changes auto-save without clicking a Save button.
- [ ] Settings persist after extension/page reload.
