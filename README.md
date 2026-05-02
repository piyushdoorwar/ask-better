# AskBetter

**One-click prompt optimizer for ChatGPT and Google Gemini.**

Get better AI responses without rewriting your prompts from scratch. AskBetter adds an ✨ Optimize button directly inside ChatGPT and Gemini — click it, and your rough draft becomes a sharp, structured prompt. Powered by your choice of Gemini, OpenAI, or Claude. Runs entirely in your browser. No backend, no tracking.

🌐 **[piyushdoorwar.github.io/ask-better](https://piyushdoorwar.github.io/ask-better/)**
🔒 **[Privacy Policy](https://piyushdoorwar.github.io/ask-better/policy/)**

---

## What it does

- **Ask Better** — an Optimize button appears in the ChatGPT and Gemini prompt box. Type your rough idea, click Optimize, and AskBetter rewrites it with your chosen preset before you send.
- **Phrase Better** — right-click any selected text anywhere on the web to clean it up: grammar, spelling, and punctuation fixed with minimal rewording.

## Presets

**Core Rewrite**
| Preset | What it does |
|---|---|
| Structured | Story-like 2–3 paragraph prompt with strong context and constraints |
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

## Privacy

- No backend server — API calls go directly from your browser to your chosen AI provider.
- Settings and API keys are stored locally in `chrome.storage.local`. Never synced to the cloud.
- API keys are only readable by the background service worker — web pages never see them.
- No analytics. No telemetry. Not in this version, not ever.

## Install from the Chrome Web Store

**[Add AskBetter to Chrome](https://chromewebstore.google.com/detail/askbetter/eelecokniegejkbbklgdpnhmhgfkfpif)**

## Quick setup

1. Click the AskBetter icon → **Open settings**.
2. Choose your provider (Gemini, OpenAI, or Anthropic Claude).
3. Paste your API key and click **Test key**. It saves automatically on success.
4. Pick a default preset. Done.

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

- [ ] Optimize button appears on ChatGPT and Gemini
- [ ] Clicking Optimize rewrites and replaces the prompt input
- [ ] Phrase Better right-click option appears on selected text
- [ ] Missing key shows helpful toast (AI disabled or key missing)
- [ ] Provider and model switch persists across page reloads
- [ ] Settings auto-save on change (no Save button required)
- [ ] Options page left menu switches sections correctly
