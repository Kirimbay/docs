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

  function paintSection(section, rate) {
    const valueEl = section.querySelector('[data-role="value"]');
    if (!valueEl || !rate) return;
    const digits = rate.code === "BTC" ? 0 : 2;
    valueEl.textContent = rate.display || fmt(rate.value, digits);
  }

  function paintFooter(data) {
    const fiatEl = document.querySelector('[data-role="fiat-source"]');
    const btcEl = document.querySelector('[data-role="btc-source"]');
    if (data.footer?.fiat && fiatEl) fiatEl.textContent = data.footer.fiat;
    if (data.footer?.btc && btcEl) btcEl.textContent = data.footer.btc;
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
      paintFooter(data);
    } catch {
      /* keep last good values */
    }
  }

  window.setInterval(refresh, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });
})();
