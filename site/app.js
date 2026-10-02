// Opt in to the hidden-until-revealed styling only now that this script is
// running. If it never loads, the CSS leaves the content visible.
document.documentElement.classList.add("js-reveal");

const PREFERS_REDUCED_MOTION =
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ── Mobile nav ────────────────────────────────────────────────────────────
(function () {
  const topbar = document.querySelector(".topbar");
  const toggle = topbar && topbar.querySelector(".nav-toggle");
  if (!toggle) return;

  const setOpen = (open) => {
    topbar.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  };

  toggle.addEventListener("click", () => setOpen(!topbar.classList.contains("open")));
  topbar.querySelectorAll(".nav a").forEach((link) => link.addEventListener("click", () => setOpen(false)));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && topbar.classList.contains("open")) {
      setOpen(false);
      toggle.focus();
    }
  });
})();

// ── Scroll reveal ─────────────────────────────────────────────────────────
(function () {
  const targets = document.querySelectorAll("[data-reveal]");
  const revealAll = () => targets.forEach((el) => el.classList.add("revealed"));

  if (!("IntersectionObserver" in window) || PREFERS_REDUCED_MOTION) {
    revealAll();
    return;
  }

  const obs = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          obs.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  targets.forEach((el) => obs.observe(el));
})();

// ── Hero mock: type a rough prompt, optimize, preview, accept ─────────────
(function () {
  const mock = document.getElementById("mock");
  const prompt = document.getElementById("mockPrompt");
  const optBtn = document.getElementById("mockOpt");
  if (!mock || !prompt || !optBtn) return;

  const ROUGH = "write me an email about the q2 project status update for stakeholders";
  const OPTIMIZED =
    "Draft a concise Q2 project status email for stakeholders. Cover the key milestones reached, current blockers, and next steps. Keep the tone clear and professional.";

  // The loop never ends, so under reduced motion hold the preview open
  // instead: the mock still makes its point, it just stays still.
  if (PREFERS_REDUCED_MOTION) {
    prompt.textContent = ROUGH;
    mock.classList.add("previewing");
    return;
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function type(text, delay) {
    prompt.classList.add("typing");
    for (let i = 1; i <= text.length; i++) {
      prompt.textContent = text.slice(0, i);
      await wait(delay + Math.random() * 24 - 12);
    }
    prompt.classList.remove("typing");
  }

  async function loop() {
    for (;;) {
      prompt.textContent = "";
      await wait(700);
      await type(ROUGH, 46);
      await wait(700);

      optBtn.classList.add("press");
      await wait(220);
      optBtn.classList.remove("press");
      await wait(500);

      mock.classList.add("previewing");
      await wait(3200);

      // Accept: the preview closes and the rewrite lands in the prompt box.
      mock.classList.remove("previewing");
      prompt.textContent = OPTIMIZED;
      await wait(2800);
    }
  }

  // Only animate while the hero is on screen.
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    loop();
  };
  if ("IntersectionObserver" in window) {
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        obs.disconnect();
        start();
      }
    });
    obs.observe(mock);
  } else {
    start();
  }
})();

// ── Support modal ─────────────────────────────────────────────────────────
(function () {
  const openBtn = document.getElementById("footerSupportBtn");
  const modal = document.getElementById("supportModal");
  const closeBtn = document.getElementById("closeSupportModal");
  if (!openBtn || !modal) return;

  const close = () => {
    modal.hidden = true;
    document.body.style.overflow = "";
    openBtn.focus();
  };

  openBtn.addEventListener("click", () => {
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    if (closeBtn) closeBtn.focus();
  });
  if (closeBtn) closeBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) close();
  });
})();
