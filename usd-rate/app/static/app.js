(() => {
  const board = document.getElementById("rates-board");
  if (!board) return;

  const withSpaces = (intPart) =>
    String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

  const fmt = (n, digits = 2) => {
    if (digits === 0) return withSpaces(Math.round(n));
    const [a, b] = n.toFixed(digits).split(".");
    return `${withSpaces(a)},${b}`;
  };
  const fmtDelta = (n, digits = 2) => {
    const sign = n > 0 ? "+" : n < 0 ? "-" : "";
    return `${sign}${fmt(Math.abs(n), digits)}`;
  };

  function paintSection(section, rate) {
    const valueEl = section.querySelector('[data-role="value"]');
    const deltaEl = section.querySelector('[data-role="delta"]');
    const metaEl = section.querySelector('[data-role="meta"]');
    const unitEl = section.querySelector('[data-role="unit"]');
    if (!valueEl || !rate) return;

    const isBtc = rate.code === "BTC";
    const digits = isBtc ? 0 : 2;
    valueEl.textContent = rate.display || fmt(rate.value, digits);
    valueEl.classList.toggle("rate--dense", Boolean(rate.dense || isBtc));

    if (unitEl && rate.unit) unitEl.textContent = rate.unit;

    if (deltaEl) {
      deltaEl.classList.remove("up", "down");
      if (rate.delta > 0) deltaEl.classList.add("up");
      if (rate.delta < 0) deltaEl.classList.add("down");
      const arrow = rate.delta > 0 ? "▲" : rate.delta < 0 ? "▼" : "●";
      const suffix = isBtc ? "за 24ч" : "к предыдущему";
      deltaEl.textContent = `${arrow} ${rate.delta_display || fmtDelta(rate.delta, digits)} ₽ ${suffix}`;
    }

    if (metaEl) {
      metaEl.textContent =
        rate.meta ||
        (isBtc ? `CoinGecko · ${rate.date}` : `ЦБ РФ · обновлено ${rate.date}`);
    }
  }

  async function refresh() {
    try {
      const res = await fetch("/api/rates", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      for (const rate of data.sections || []) {
        const el = board.querySelector(`[data-code="${String(rate.code).toLowerCase()}"]`);
        if (el) paintSection(el, rate);
      }
    } catch {
      /* keep last good values */
    }
  }

  window.setInterval(refresh, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });
})();
