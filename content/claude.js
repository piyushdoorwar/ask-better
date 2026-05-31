(function () {
  const SITE = "claude";
  const ENABLE_KEY = "enableClaude";
  const SELECTORS = [
    "div[contenteditable='true'].ProseMirror[aria-label*='prompt']",
    "div[contenteditable='true'].ProseMirror[role='textbox']",
    "div[contenteditable='true'].ProseMirror",
    "div[contenteditable='true'][role='textbox'][aria-label*='Talk to Claude']",
    "div[contenteditable='true'][role='textbox'][aria-label*='Claude']",
    "div[contenteditable='true'][role='textbox']",
    "div[contenteditable='true'][enterkeyhint]"
  ];

  startAskBetter(SITE, ENABLE_KEY, SELECTORS);
})();
