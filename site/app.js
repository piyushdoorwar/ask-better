// ── Scroll reveal ─────────────────────────────────────────────────────────
(function () {
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
  document.querySelectorAll("[data-reveal]").forEach((el) => obs.observe(el));
})();

// ── Browser mockup: typing animation ─────────────────────────────────────
(function () {
  const typedEl  = document.getElementById("bmTyped");
  const cursorEl = document.getElementById("bmCursor");
  const optBtn   = document.getElementById("bmOptBtn");
  if (!typedEl || !optBtn) return;

  const ROUGH     = "write me an email about the q2 project status update for stakeholders";
  const OPTIMIZED = "Draft a concise Q2 project status email for stakeholders. Cover key milestones reached, current blockers, and next steps. Keep the tone clear and professional.";

  const TYPE_DELAY   = 52;   // ms per char (rough)
  const OPT_DELAY    = 30;   // ms per char (optimized — feels faster / AI-generated)
  const JITTER       = 28;   // ± random jitter
  const DEL_DELAY    = 18;   // ms per char when clearing
  const PAUSE_ROUGH  = 900;  // ms pause before optimize
  const PAUSE_OPT    = 2800; // ms pause after optimized text fully appears
  const LOOP_PAUSE   = 1400; // ms gap before next loop

  let phase = "typing-rough";
  let pos   = 0;
  let timer = null;

  function sched(fn, delay) {
    timer = setTimeout(fn, delay);
  }

  function setText(str) {
    typedEl.textContent = str;
  }

  function tick() {
    switch (phase) {

      case "typing-rough":
        if (pos < ROUGH.length) {
          setText(ROUGH.slice(0, ++pos));
          sched(tick, TYPE_DELAY + (Math.random() * JITTER - JITTER / 2));
        } else {
          phase = "pause-rough";
          sched(tick, PAUSE_ROUGH);
        }
        break;

      case "pause-rough":
        // Signal the Optimize button
        optBtn.classList.add("pulsing");
        phase = "pre-click";
        sched(tick, 700);
        break;

      case "pre-click":
        optBtn.classList.remove("pulsing");
        optBtn.classList.add("clicked");
        phase = "clearing";
        sched(tick, 320);
        break;

      case "clearing": {
        const current = typedEl.textContent;
        if (current.length > 0) {
          // Delete 2-3 chars at a time for a "fast erase" feel
          setText(current.slice(0, Math.max(0, current.length - 3)));
          sched(tick, DEL_DELAY);
        } else {
          optBtn.classList.remove("clicked");
          phase = "typing-optimized";
          pos = 0;
          sched(tick, 200);
        }
        break;
      }

      case "typing-optimized":
        if (pos < OPTIMIZED.length) {
          setText(OPTIMIZED.slice(0, ++pos));
          sched(tick, OPT_DELAY + (Math.random() * JITTER - JITTER / 2));
        } else {
          phase = "pause-optimized";
          sched(tick, PAUSE_OPT);
        }
        break;

      case "pause-optimized":
        setText("");
        pos = 0;
        phase = "loop-gap";
        sched(tick, LOOP_PAUSE);
        break;

      case "loop-gap":
        phase = "typing-rough";
        sched(tick, 0);
        break;
    }
  }

  // Start after a short initial delay so the page settles first
  sched(tick, 800);
})();
