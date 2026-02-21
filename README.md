# PromptForge (Chrome Extension, MV3)

PromptForge is a local-first prompt optimizer for:

- ChatGPT (`chat.openai.com` and `chatgpt.com`)
- Google Gemini (`gemini.google.com`)

It injects a lightweight `Optimize` button near the prompt input. Clicking it rewrites the current prompt based on your selected preset and replaces the textbox content.

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
- `background.js` (secure API handling + provider API calls)
- `content/chatgpt.js` (ChatGPT injection)
- `content/gemini.js` (Gemini injection)
- `injected/styles.css` (button + toast styles)
- `ui/popup.html`, `ui/popup.js`, `ui/popup.css` (quick controls/status/model switch)
- `ui/options.html`, `ui/options.js`, `ui/options.css` (sectioned settings + auto-save)

## Install (Unpacked)

1. Open Chrome and go to `chrome://extensions`.
2. Enable `Developer mode` (top right).
3. Click `Load unpacked`.
4. Select this folder: `c:\Repos\prompt-optimizer-ask-better`.
5. Pin the PromptForge extension (optional, recommended).

## Configure

1. Click the PromptForge extension icon.
2. Click `Open settings`.
3. Use the left menu sections:
   - Models
   - Presets
   - Integrations
   - Custom Prompt Additions
   - Security
4. Set:
   - Provider: `OpenAI` or `Google Gemini`
   - API key
   - Model
   - Default preset
   - Toggles (Global AI, ChatGPT, Gemini)
5. Settings auto-save on change (no Save button required).
6. In Security, click `Test key` once. On success, the key is saved and locked.
7. Use `Clear stored key/data` to reset key setup.

## Use on ChatGPT/Gemini

1. Open ChatGPT or Gemini.
2. Type or paste a prompt.
3. Click `Optimize`.
4. PromptForge replaces the current prompt with the optimized version.

If AI is off or no key is set, PromptForge shows:

- `AI disabled or key missing`

## API Key Links

- OpenAI key: `https://platform.openai.com/api-keys`
- Gemini key: `https://aistudio.google.com/apikey`

## Notes

- Provider support includes OpenAI and Google Gemini.
- Anthropic remains TODO in settings.
- Keep User Voice toggle is marked TODO for a future version.

## Manual Test Checklist

- [ ] Works on ChatGPT (`chat.openai.com` or `chatgpt.com`).
- [ ] Works on Gemini (`gemini.google.com`).
- [ ] Missing key shows helpful toast (`AI disabled or key missing`).
- [ ] Optimize replaces textbox content.
- [ ] OpenAI model switch persists and is used by optimization requests.
- [ ] Options page left menu switches sections correctly.
- [ ] Changes auto-save without clicking a Save button.
- [ ] Settings persist after extension/page reload.
