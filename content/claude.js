(function () {
  const SITE = "claude";
  const ENABLE_KEY = "enableClaude";
  // Claude's composer lives in an isolated iframe on a.claude.ai. about:blank /
  // srcdoc children of that frame inherit its origin, so check origin too.
  const COMPOSER_ORIGIN = "https://a.claude.ai";
  const IN_COMPOSER_FRAME = location.hostname === "a.claude.ai" || self.origin === COMPOSER_ORIGIN;
  const SPECIFIC_SELECTORS = [
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
    "div[contenteditable='true'][translate='no']"
  ];
  // Generic fallbacks would also match settings, project-instruction and dialog
  // fields, so they are only safe inside the composer frame.
  const GENERIC_SELECTORS = [
    "[contenteditable='plaintext-only']",
    "[contenteditable='true']",
    "[contenteditable]",
    "textarea"
  ];
  const SELECTORS = IN_COMPOSER_FRAME ? SPECIFIC_SELECTORS.concat(GENERIC_SELECTORS) : SPECIFIC_SELECTORS;

  // claude.ai is a SPA, so the path is checked per candidate, not once.
  function acceptInput(node) {
    if (IN_COMPOSER_FRAME) {
      return true;
    }
    if (/^\/settings(\/|$)/.test(location.pathname)) {
      return false;
    }
    return !node.closest("[role='dialog'], [role='alertdialog'], [aria-modal='true']");
  }

  startAskBetter(SITE, ENABLE_KEY, SELECTORS, { acceptInput });
})();
