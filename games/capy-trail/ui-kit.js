/* UI kit starter (Game Standard v2). Copy into games/<slug>/ next to ui-kit.css and load it as a classic script
   before the game's own scripts (games also run from file://, where ES modules don't load).
   It exposes window.UIKit; nothing here runs until the game calls it, and nothing talks to the network.

   UIKit.store(slug)                       localStorage wrapper that never throws, keys prefixed with the slug
   UIKit.applyTheme(theme)                 window.THEME -> CSS custom properties and [data-theme-text] copy
   UIKit.loadImageSlots(theme)             theme.images -> Promise of { slot: HTMLImageElement | null }
   UIKit.showScreen(id)                    fade/slide between .uk-screen elements, focus the first button
   UIKit.howTo(dialog, { onClose })        step-through how-to sheet (<dialog class="uk-sheet">)
   UIKit.firstRun(store, key)              true exactly once per player (drives the first-run demo)
   UIKit.bindToggle(input, store, key, fallback, onChange)   a settings toggle that persists
   UIKit.reduceMotion()                    the effective reduced-motion choice (game toggle, else the OS)
   UIKit.celebrate(options)                confetti burst for a win or a new best; calm glow under reduced motion
   UIKit.toast(text, ms)                   short message at the top of the screen
   UIKit.dailySeed(date) / UIKit.rng(seed) seeded daily challenge: same numbers for everyone on the same day */
(function (root, factory) {
  const kit = factory();
  if (typeof module === "object" && module.exports) module.exports = kit;
  else root.UIKit = kit;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- storage ----------

  function store(slug) {
    const prefix = slug + ":";
    const memory = new Map(); // used when localStorage is blocked, so the session still works
    function backend() {
      try {
        return typeof localStorage !== "undefined" ? localStorage : null;
      } catch (e) {
        return null;
      }
    }
    return {
      get(key, fallback) {
        let raw = null;
        try {
          const ls = backend();
          raw = ls ? ls.getItem(prefix + key) : null;
        } catch (e) {
          raw = null;
        }
        if (raw === null) raw = memory.has(key) ? memory.get(key) : null;
        if (raw === null) return fallback;
        try {
          return JSON.parse(raw);
        } catch (e) {
          return fallback;
        }
      },
      set(key, value) {
        const raw = JSON.stringify(value);
        memory.set(key, raw);
        try {
          const ls = backend();
          if (ls) ls.setItem(prefix + key, raw);
        } catch (e) {
          /* storage full or blocked: the in-memory copy keeps this session working */
        }
      },
    };
  }

  function firstRun(st, key) {
    const k = key || "seenIntro";
    if (st.get(k, false)) return false;
    st.set(k, true);
    return true;
  }

  // ---------- theme ----------

  function lookup(theme, path) {
    return path.split(".").reduce((obj, part) => (obj && obj[part] !== undefined ? obj[part] : undefined), theme);
  }

  // Applies theme.colors as custom properties on :root and fills every [data-theme-text="path"] element, for
  // example data-theme-text="title", "tagline", "dedication", "text.win" or "names.hero". Returns the theme.
  function applyTheme(theme) {
    const t = theme || {};
    const docEl = document.documentElement;
    for (const [name, value] of Object.entries(t.colors || {})) {
      if (/^--[\w-]+$/.test(name) && typeof value === "string") docEl.style.setProperty(name, value);
    }
    for (const el of document.querySelectorAll("[data-theme-text]")) {
      const value = lookup(t, el.getAttribute("data-theme-text"));
      if (typeof value === "string") el.textContent = value;
    }
    if (typeof t.title === "string" && t.title) document.title = t.title;
    return t;
  }

  // Resolves each image slot to a loaded image, or null to keep the built-in drawn art. A slot that fails to
  // load also falls back to null, so a bad path can never break the game.
  function loadImageSlots(theme) {
    const slots = (theme && theme.images) || {};
    const entries = Object.entries(slots).map(
      ([slot, src]) =>
        new Promise((resolve) => {
          if (!src) return resolve([slot, null]);
          const img = new Image();
          img.onload = () => resolve([slot, img]);
          img.onerror = () => resolve([slot, null]);
          img.src = src;
        })
    );
    return Promise.all(entries).then((pairs) => Object.fromEntries(pairs));
  }

  // ---------- motion preference ----------

  function reduceMotion() {
    const forced = document.documentElement.getAttribute("data-reduce-motion");
    if (forced === "true") return true;
    if (forced === "false") return false;
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // ---------- screens ----------

  function showScreen(id) {
    const screens = document.querySelectorAll(".uk-screen");
    let target = null;
    for (const s of screens) {
      const on = s.id === id;
      s.classList.toggle("is-active", on);
      s.setAttribute("aria-hidden", on ? "false" : "true");
      if (on) target = s;
    }
    if (target) {
      const focusable = target.querySelector("[autofocus], .uk-btn, button");
      if (focusable) focusable.focus({ preventScroll: true });
    }
    return target;
  }

  // ---------- how-to sheet ----------

  // Markup: <dialog class="uk-sheet"> with .uk-steps > .uk-step children, a .uk-dots container, and buttons
  // [data-howto="prev"], [data-howto="next"], [data-howto="close"]. The last step's "next" closes it.
  function howTo(dialog, options) {
    const opts = options || {};
    const steps = Array.from(dialog.querySelectorAll(".uk-step"));
    const dots = dialog.querySelector(".uk-dots");
    const prev = dialog.querySelector('[data-howto="prev"]');
    const next = dialog.querySelector('[data-howto="next"]');
    let index = 0;

    if (dots && !dots.children.length) {
      steps.forEach(() => {
        const d = document.createElement("span");
        d.className = "uk-dot";
        dots.appendChild(d);
      });
    }

    function render() {
      steps.forEach((s, i) => {
        s.style.transform = `translateX(${-index * 100}%)`;
        s.setAttribute("aria-hidden", i === index ? "false" : "true");
      });
      if (dots) Array.from(dots.children).forEach((d, i) => d.classList.toggle("is-current", i === index));
      if (prev) prev.disabled = index === 0;
      if (next) next.textContent = index === steps.length - 1 ? next.dataset.done || "Let's play!" : next.dataset.next || "Next";
    }
    function close() {
      if (dialog.open) dialog.close();
    }
    function go(delta) {
      if (index + delta >= steps.length) return close();
      index = Math.max(0, Math.min(steps.length - 1, index + delta));
      render();
    }

    if (prev) prev.addEventListener("click", () => go(-1));
    if (next) next.addEventListener("click", () => go(1));
    for (const b of dialog.querySelectorAll('[data-howto="close"]')) b.addEventListener("click", close);
    dialog.addEventListener("close", () => opts.onClose && opts.onClose());

    // Swipe between steps on touch.
    let startX = null;
    dialog.addEventListener("pointerdown", (e) => (startX = e.clientX));
    dialog.addEventListener("pointerup", (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX;
      startX = null;
      if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    });

    return {
      open() {
        index = 0;
        render();
        if (!dialog.open) dialog.showModal();
        if (next) next.focus(); // the natural next action, not the close button, gets the first focus
      },
      close,
    };
  }

  // ---------- settings ----------

  function bindToggle(input, st, key, fallback, onChange) {
    input.checked = Boolean(st.get(key, fallback));
    const apply = () => onChange && onChange(input.checked);
    input.addEventListener("change", () => {
      st.set(key, input.checked);
      apply();
    });
    apply();
    return input;
  }

  // ---------- toast ----------

  let toastEl = null;
  let toastTimer = 0;
  function toast(text, ms) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "uk-toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    // Force a reflow so re-showing the same toast animates again.
    toastEl.classList.remove("is-shown");
    void toastEl.offsetWidth;
    toastEl.classList.add("is-shown");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-shown"), ms || 1600);
  }

  // ---------- celebration ----------

  function tokenColor(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // options: { x, y } origin in CSS px (default: centre, a third down), count, duration (ms), colors (token names).
  // Under reduced motion it draws a single soft glow instead of flying particles. Returns a Promise that
  // resolves when the layer is gone.
  function celebrate(options) {
    const o = options || {};
    const colors = (o.colors || ["--color-primary", "--color-accent", "--color-danger", "--color-text"])
      .map(tokenColor)
      .filter(Boolean);
    const w = innerWidth;
    const h = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const canvas = document.createElement("canvas");
    canvas.className = "uk-celebrate-layer";
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const ox = o.x !== undefined ? o.x : w / 2;
    const oy = o.y !== undefined ? o.y : h / 3;
    const calm = reduceMotion();
    const duration = o.duration || (calm ? 700 : 1800);
    const rand = rng(o.seed !== undefined ? o.seed : (Date.now() >>> 0));

    const parts = [];
    if (!calm) {
      const count = o.count || Math.round(Math.min(160, (w * h) / 6000));
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (rand() - 0.5) * Math.PI * 1.1;
        const speed = 380 + rand() * 520;
        parts.push({
          x: ox,
          y: oy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 6 + rand() * 7,
          spin: (rand() - 0.5) * 14,
          rot: rand() * Math.PI,
          shape: rand() < 0.3 ? "dot" : "strip",
          color: colors[i % colors.length],
        });
      }
    }

    return new Promise((resolve) => {
      let last = performance.now();
      const start = last;
      function frame(now) {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const t = (now - start) / duration;
        ctx.clearRect(0, 0, w, h);
        if (calm) {
          const r = Math.max(w, h) * 0.45;
          const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, r);
          g.addColorStop(0, colors[1] || colors[0]);
          g.addColorStop(1, "transparent");
          ctx.globalAlpha = 0.35 * Math.sin(Math.min(1, t) * Math.PI);
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
        } else {
          ctx.globalAlpha = t > 0.7 ? Math.max(0, (1 - t) / 0.3) : 1;
          for (const p of parts) {
            p.vy += 900 * dt; // gravity
            p.vx *= 1 - 1.2 * dt; // air drag
            p.vy *= 1 - 0.6 * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.rot += p.spin * dt;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillStyle = p.color;
            if (p.shape === "dot") {
              ctx.beginPath();
              ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
              ctx.fill();
            } else {
              // A flat strip that "flips" as it spins, like paper confetti.
              ctx.fillRect(-p.size / 2, (-p.size / 4) * Math.abs(Math.cos(p.rot * 1.7)), p.size, p.size / 2);
            }
            ctx.restore();
          }
        }
        if (t < 1) requestAnimationFrame(frame);
        else {
          canvas.remove();
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  // ---------- seeded daily challenge ----------

  // The local calendar date as YYYY-MM-DD: players share a puzzle by their own day, like Wordle.
  function dateKey(date) {
    const d = date || new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // FNV-1a hash of the date key (plus an optional salt, e.g. the game slug, so two games' dailies differ).
  function dailySeed(date, salt) {
    const text = dateKey(date) + (salt ? ":" + salt : "");
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  // mulberry32: a small, fast seeded RNG returning floats in [0, 1).
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  return {
    store,
    firstRun,
    applyTheme,
    loadImageSlots,
    reduceMotion,
    showScreen,
    howTo,
    bindToggle,
    toast,
    celebrate,
    dateKey,
    dailySeed,
    rng,
  };
});
