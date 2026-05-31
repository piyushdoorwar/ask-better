(function () {
  const SITE = "chatgpt";
  const ENABLE_KEY = "enableChatGPT";
  const SELECTORS = [
    "textarea#prompt-textarea",
    "div#prompt-textarea[contenteditable='true']",
    "div#prompt-textarea.ProseMirror[contenteditable='true']",
    "div[data-testid='composer-input'][contenteditable='true']",
    "div[data-testid='prompt-textarea'][contenteditable='true']",
    "textarea[placeholder*='Ask']",
    "textarea[placeholder*='Message']",
    "textarea[aria-label*='Ask']",
    "textarea[aria-label*='Message']",
    "textarea[data-id='root']",
    "div[contenteditable='true'][role='textbox'][aria-label*='Ask']",
    "div[contenteditable='true'][role='textbox'][aria-label*='Message']",
    "div[contenteditable='true'][aria-label*='Ask']",
    "div[contenteditable='true'][aria-label*='Message']",
    "div[contenteditable='true'][role='textbox']"
  ];

  startAskBetter(SITE, ENABLE_KEY, SELECTORS);
})();
