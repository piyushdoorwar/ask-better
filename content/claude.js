(function () {
  const SITE = "claude";
  const ENABLE_KEY = "enableClaude";
  const SELECTORS = [
    "div.ProseMirror[contenteditable='true']",
    "div.ProseMirror[contenteditable='plaintext-only']",
    "div[contenteditable='plaintext-only'][aria-label*='Claude' i]",
    "div[contenteditable='plaintext-only'][aria-label*='prompt' i]",
    "div[contenteditable='plaintext-only'][role='textbox']",
    "div[contenteditable='plaintext-only'][enterkeyhint]",
    "div[contenteditable='plaintext-only'][translate='no']",
    "div[contenteditable='true'][aria-label*='Claude' i]",
    "div[contenteditable='true'][aria-label*='prompt' i]",
    "div[contenteditable='true'][role='textbox']",
    "div[contenteditable='true'][enterkeyhint]",
    "div[contenteditable='true'][translate='no']",
    "[contenteditable='plaintext-only']",
    "[contenteditable='true']",
    "[contenteditable]",
    "textarea"
  ];

  startAskBetter(SITE, ENABLE_KEY, SELECTORS);
})();
