(function () {
  const SITE = "gemini";
  const ENABLE_KEY = "enableGemini";
  const SELECTORS = [
    "div[contenteditable='true'][role='textbox'][aria-label*='Enter a prompt']",
    "div[contenteditable='true'][role='textbox'][aria-label*='prompt']",
    "div[contenteditable='true'][role='textbox']",
    "textarea[aria-label*='prompt']",
    "textarea"
  ];

  startAskBetter(SITE, ENABLE_KEY, SELECTORS);
})();
