(() => {
  const rateEl = document.getElementById("rate-value");
  const deltaEl = document.getElementById("rate-delta");
  const metaEl = document.getElementById("rate-meta");
  if (!rateEl) return;

  const fmt = (n) => n.toFixed(2).replace(".", ",");
  const fmtDelta = (n) => `${n > 0 ? "+" : ""}${n.toFixed(2)}`.replace(".", ",");

  async function refresh() {
    try {
      const res = await fetch("/api/rate", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      rateEl.textContent = data.display || fmt(data.value);
      rateEl.dataset.value = String(data.value);
      if (deltaEl) {
        deltaEl.classList.remove("up", "down");
        if (data.delta > 0) deltaEl.classList.add("up");
        if (data.delta < 0) deltaEl.classList.add("down");
        const arrow = data.delta > 0 ? "▲" : data.delta < 0 ? "▼" : "●";
        deltaEl.textContent = `${arrow} ${data.delta_display || fmtDelta(data.delta)} ₽ к предыдущему`;
      }
      if (metaEl) metaEl.textContent = `ЦБ РФ · курс на ${data.date}`;
    } catch {
      /* keep last good value */
    }
  }

  window.setInterval(refresh, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });
})();
