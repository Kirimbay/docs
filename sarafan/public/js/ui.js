let timer = null;

export function toast(text, ms = 2600) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.hidden = false;
  el.textContent = text;
  clearTimeout(timer);
  timer = setTimeout(() => {
    el.hidden = true;
  }, ms);
}

export function showError(el, text) {
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = text;
}

export function bindTap(el, handler) {
  if (!el || el.dataset.tapBound === "1") return;
  el.dataset.tapBound = "1";
  let x = 0;
  let y = 0;
  let moved = false;
  let touchedAt = 0;
  el.addEventListener(
    "touchstart",
    (e) => {
      const t = e.changedTouches?.[0];
      if (!t) return;
      x = t.clientX;
      y = t.clientY;
      moved = false;
    },
    { passive: true }
  );
  el.addEventListener(
    "touchmove",
    (e) => {
      const t = e.changedTouches?.[0];
      if (!t) return;
      if (Math.abs(t.clientX - x) > 12 || Math.abs(t.clientY - y) > 12) moved = true;
    },
    { passive: true }
  );
  el.addEventListener(
    "touchend",
    (e) => {
      if (moved) return;
      touchedAt = Date.now();
      if (e.cancelable) e.preventDefault();
      handler(e);
    },
    { passive: false }
  );
  el.addEventListener("click", (e) => {
    if (Date.now() - touchedAt < 700) return;
    handler(e);
  });
}

/** Long-press helper (ms). */
export function bindLongPress(el, handler, ms = 800) {
  if (!el) return;
  let timer = null;
  let startX = 0;
  let startY = 0;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const start = (clientX, clientY) => {
    clear();
    startX = clientX;
    startY = clientY;
    timer = setTimeout(() => {
      timer = null;
      handler();
    }, ms);
  };
  el.addEventListener("pointerdown", (e) => {
    if (e.button != null && e.button !== 0) return;
    start(e.clientX, e.clientY);
  });
  el.addEventListener("pointermove", (e) => {
    if (!timer) return;
    if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) clear();
  });
  el.addEventListener("pointerup", clear);
  el.addEventListener("pointercancel", clear);
  el.addEventListener("pointerleave", clear);
}

export function syncViewport() {
  const vv = window.visualViewport;
  const h = Math.round(vv?.height || window.innerHeight || 0);
  document.documentElement.style.setProperty("--vvh", `${Math.max(240, h)}px`);
}

export function layoutHub(dialog) {
  if (!dialog?.open) return;
  syncViewport();
  const vv = window.visualViewport;
  const top = vv ? Math.round(vv.offsetTop || 0) : 0;
  const height = Math.max(240, Math.round(vv?.height || window.innerHeight || 0));
  const narrow = window.matchMedia("(max-width: 640px)").matches;
  dialog.style.position = "fixed";
  dialog.style.top = `${top}px`;
  dialog.style.bottom = "auto";
  dialog.style.height = `${height}px`;
  dialog.style.maxHeight = `${height}px`;
  dialog.style.margin = "0";
  if (narrow) {
    dialog.style.left = "0";
    dialog.style.right = "0";
    dialog.style.width = "100%";
    dialog.style.transform = "none";
  } else {
    dialog.style.left = "50%";
    dialog.style.right = "auto";
    dialog.style.width = "min(760px, 100%)";
    dialog.style.transform = "translateX(-50%)";
  }
  const active = document.activeElement;
  if (active && dialog.contains(active) && typeof active.scrollIntoView === "function") {
    try {
      active.scrollIntoView({ block: "nearest" });
    } catch {
      /* ignore */
    }
  }
}
