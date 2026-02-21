# PromptForge (Chrome Extension, MV3)

PromptForge is a local-first prompt optimizer for:

- ChatGPT (`chat.openai.com` and `chatgpt.com`)
- Google Gemini (`gemini.google.com`)

It injects a lightweight `✨ Optimize` button near the prompt input. Clicking it rewrites the current prompt based on your selected preset and replaces the textbox content.

## Privacy and Security

- No backend server.
- Data is stored locally in `chrome.storage.local`.
- API key is read and used only by `background.js` (service worker).
- Content scripts never read or store the API key.
- Prompt text is never logged by the extension.
- Analytics is opt-in and local-only in this v0 (no prompt text sent anywhere).

## Presets

- `Fix grammar`: spelling/grammar fixes, minimal rewrites.
- `Improve clarity`: clearer phrasing, same meaning.
- `Concise`: shorter while preserving requirements.
- `Structured`: rewrites as:
  - `Context`
  - `Task`
  - `Constraints`
  - `Output Format`
  - `Questions (if any)`

## Files

- `manifest.json` (MV3 config)
- `background.js` (secure API handling + OpenAI calls)
- `content/chatgpt.js` (ChatGPT injection)
- `content/gemini.js` (Gemini injection)
- `injected/styles.css` (button + toast styles)
- `popup.html`, `popup.js` (quick controls/status)
- `options.html`, `options.js` (full settings)

## Install (Unpacked)

1. Open Chrome and go to `chrome://extensions`.
2. Enable `Developer mode` (top right).
3. Click `Load unpacked`.
4. Select this folder: `c:\Repos\prompt-optimizer-ask-better`.
5. Pin the PromptForge extension (optional, recommended).

## Configure

1. Click the PromptForge extension icon.
2. Click `Open settings`.
3. Set:
   - Provider: `OpenAI`
   - API key
   - Model (default `gpt-4.1-mini`)
   - Default preset
   - Toggles (Global AI, ChatGPT, Gemini)
4. Click `Save settings`.
5. Optional: click `Test key`.

## Use on ChatGPT/Gemini

1. Open ChatGPT or Gemini.
2. Type or paste a prompt.
3. Click `✨ Optimize`.
4. PromptForge replaces the current prompt with the optimized version.

If AI is off or no key is set, PromptForge shows:

- `AI disabled or key missing`

## Notes

- Provider support starts with OpenAI only.
- Anthropic is listed as TODO in settings.
- Keep User Voice toggle is marked TODO for a future version.

## Manual Test Checklist

- [ ] Works on ChatGPT (`chat.openai.com` or `chatgpt.com`).
- [ ] Works on Gemini (`gemini.google.com`).
- [ ] Missing key shows helpful toast (`AI disabled or key missing`).
- [ ] Optimize replaces textbox content.
- [ ] Settings persist after extension/page reload.
