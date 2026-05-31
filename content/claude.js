(function () {
  const SITE = "claude";
  const ENABLE_KEY = "enableClaude";
  const SELECTORS = [
    "div.ProseMirror[contenteditable='true']",
    "div[contenteditable='true'][aria-label*='Claude' i]",
    "div[contenteditable='true'][aria-label*='prompt' i]",
    "div[contenteditable='true'][role='textbox']",
    "div[contenteditable='true'][enterkeyhint]",
    "div[contenteditable='true'][translate='no']",
    "[contenteditable='true']"
  ];

  startAskBetter(SITE, ENABLE_KEY, SELECTORS);
})();
