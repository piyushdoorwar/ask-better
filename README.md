# AskBetter

**One-click prompt optimizer for ChatGPT, Google Gemini, and Claude.**

Get better AI responses without rewriting your prompts from scratch. AskBetter adds an Optimize button directly inside ChatGPT, Gemini, and Claude — click it (or press `Ctrl/Cmd+Shift+O`), review the rewrite in a non-destructive preview, and accept it. Powered by your choice of Gemini, OpenAI, or Claude. Runs entirely in your browser. No backend, no tracking.

🌐 **[askbetter.piyushdoorwar.com](https://askbetter.piyushdoorwar.com/)**
🔒 **[Privacy Policy](https://askbetter.piyushdoorwar.com/policy/)**

---

## What it does

- **Ask Better** — an Optimize button appears in the ChatGPT, Gemini, and Claude prompt box (or trigger it with `Ctrl/Cmd+Shift+O`). Type your rough idea, optimize it, and review the result in a **non-destructive preview** — Accept, Regenerate, or Discard. Nothing replaces your text until you accept it.
- **Phrase Better** — right-click any selected text anywhere on the web to clean it up: grammar, spelling, and punctuation fixed with minimal rewording. It shows **1–3 suggestions in a chooser** (configurable) so you pick before it replaces your text. A default-on **Natural line breaks** setting preserves existing structure and can add paragraph breaks at greetings, sign-offs, and concept shifts.
- **Custom presets** — beyond the built-ins, define your own reusable rewrite styles (name + instruction) in Settings; they show up in the preset picker.
- **Proportional, no fabrication** — rewrites match the length and specificity of your input and never invent requirements, facts, or details you didn't provide.

## Presets

**Core Rewrite**
| Preset | What it does |
|---|---|
| Structured | Clear, flowing, high-context prompt — scaled to the substance of your input |
| Concise | Shorter while preserving all requirements |
| Fix Grammar | Spelling and grammar fixes with minimal rewrite |
| Improve Clarity | Clearer phrasing, same meaning |

**Communication Style**
| Preset | What it does |
|---|---|
| Persuasive | More compelling and outcome-oriented |
| Executive Brief | Concise, strategic, stakeholder-ready |
| Coaching Tone | Supportive, accountable, action-driven |
| Email Rephrase | Polished email-ready rewrite with clear structure and tone |

**Critical Thinking**
| Preset | What it does |
|---|---|
| Devil's Advocate | Challenge weak assumptions and blind spots |
| First Principles | Decompose to fundamentals and core logic |
| Risk Audit | Surface risks, failure modes, and mitigations |

**Build & Delivery**
| Preset | What it does |
|---|---|
| Technical Spec | Precise requirements and acceptance criteria |
| Implementation Plan | Ordered tasks, dependencies, and deliverables |

Plus **Custom presets** — add your own `{ name, instruction }` styles in Settings → Ask Better → **Presets**; they appear in the preset picker alongside the built-ins.

## Privacy

- No backend server — your prompts go directly from your browser to the AI provider you choose.
- Settings, API keys, prompt history (last 100 rewrites) and a 30-day usage log are stored locally in `chrome.storage.local`. Never synced to the cloud. Clear them from History or Models → API key → **Clear stored key & data**.
- API keys are read only by the extension's settings page and background worker — the scripts on ChatGPT, Claude and Gemini, and web pages, never see them.
- The extension has no analytics or telemetry. (The website uses cookie-free Cloudflare Web Analytics.) Full details in the [privacy policy](https://askbetter.piyushdoorwar.com/policy/).

## Install from the Chrome Web Store

**[Add AskBetter to Chrome](https://chromewebstore.google.com/detail/askbetter/eelecokniegejkbbklgdpnhmhgfkfpif)**

## Quick setup

1. Click the AskBetter icon → **Open settings**.
2. In **Models**, choose your provider (Gemini, OpenAI, or Anthropic Claude).
3. Click **Add API key** next to the provider, paste your key and click **Verify key**. It saves on success and unlocks the model list.
4. Pick a default preset. Done.

Then open ChatGPT, Gemini, or Claude and click the **Optimize** button (or press `Ctrl/Cmd+Shift+O`). The shortcut can be rebound at `chrome://extensions/shortcuts`.

**Get an API key:**
- Gemini: [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
- OpenAI: [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- Anthropic: [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)

## License

Source code is publicly viewable. Personal, non-commercial use is permitted. Copying, redistribution, modification for distribution, and commercial use are **not** permitted without explicit written permission.

See [LICENSE](./LICENSE) for full terms.

## Legal

AskBetter is provided "as is" without warranties of any kind. You are solely responsible for your prompts, outputs, API key management, and compliance with your AI provider's terms of service. The developer is not liable for any damages arising from use of this software.

## Contributing

Found a bug or want to suggest a preset? Open an issue or submit a pull request. Contributions become part of this project and are subject to the same license terms.

## Manual test checklist

- [ ] Optimize button appears on ChatGPT, Gemini, and Claude
- [ ] `Ctrl/Cmd+Shift+O` triggers Optimize on the active prompt box
- [ ] Optimize shows a preview; Accept writes the text, Discard/Regenerate work, nothing replaces until Accept
- [ ] Short/vague prompts stay short (no invented requirements)
- [ ] Phrase Better right-click shows the configured number of suggestions (1–3) and applies the chosen one
- [ ] Phrase Better applies even if you click away while it processes (selection captured up front)
- [ ] Custom presets can be added/removed and appear in the preset picker
- [ ] Missing key shows helpful toast (AI disabled or key missing)
- [ ] Provider and model switch persists across page reloads
- [ ] Settings auto-save on change (no Save button required)
- [ ] Options page left menu switches sections correctly
