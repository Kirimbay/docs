(() => {
  const drop = document.getElementById("dropzone");
  const input = document.getElementById("file-input");
  const status = document.getElementById("status");
  const stepUpload = document.getElementById("step-upload");
  const stepEdit = document.getElementById("step-edit");
  const form = document.getElementById("fields-form");
  const hintsEl = document.getElementById("hints");
  const qrFrame = document.getElementById("qr-frame");
  const btnDownload = document.getElementById("btn-download");
  const payloadText = document.getElementById("payload-text");
  const btnAgain = document.getElementById("btn-again");

  const FIELD_NAMES = [
    "name", "personal_acc", "bank_name", "bic", "corresp_acc",
    "payee_inn", "kpp", "sum_rub", "purpose", "cbc", "oktmo", "pers_acc",
  ];

  function setStatus(msg) {
    status.textContent = msg || "";
  }

  function fillForm(fields) {
    for (const name of FIELD_NAMES) {
      const el = form.elements.namedItem(name);
      if (el) el.value = fields[name] || "";
    }
  }

  function readForm() {
    const data = {};
    for (const name of FIELD_NAMES) {
      const el = form.elements.namedItem(name);
      data[name] = el ? el.value.trim() : "";
    }
    return data;
  }

  function showHints(list) {
    hintsEl.innerHTML = "";
    (list || []).forEach((t) => {
      const li = document.createElement("li");
      li.textContent = t;
      hintsEl.appendChild(li);
    });
  }

  async function parseFile(file) {
    setStatus("Распознаю квитанцию…");
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/parse", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Ошибка распознавания");

    fillForm(data.fields || {});
    showHints(data.hints || []);
    stepUpload.classList.add("hidden");
    stepEdit.classList.remove("hidden");
    setStatus("");
    qrFrame.innerHTML = '<p class="qr-placeholder">Проверьте поля и нажмите «Сделать QR»</p>';
    btnDownload.classList.add("hidden");
    payloadText.textContent = "";
  }

  async function onFile(file) {
    if (!file) return;
    try {
      await parseFile(file);
    } catch (err) {
      setStatus(err.message || String(err));
    }
  }

  drop.addEventListener("click", () => input.click());
  input.addEventListener("change", () => onFile(input.files?.[0]));

  ["dragenter", "dragover"].forEach((ev) => {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove("dragover");
    });
  });
  drop.addEventListener("drop", (e) => {
    onFile(e.dataTransfer?.files?.[0]);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("btn-qr");
    btn.disabled = true;
    btn.textContent = "Собираю…";
    try {
      const res = await fetch("/api/qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(readForm()),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Не удалось собрать QR");
      qrFrame.innerHTML = "";
      const img = document.createElement("img");
      img.src = data.data_url;
      img.alt = "Банковский QR";
      qrFrame.appendChild(img);
      btnDownload.href = data.data_url;
      btnDownload.classList.remove("hidden");
      payloadText.textContent = data.payload || "";
    } catch (err) {
      qrFrame.innerHTML = `<p class="qr-placeholder">${err.message || err}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "Сделать QR";
    }
  });

  btnAgain.addEventListener("click", () => {
    stepEdit.classList.add("hidden");
    stepUpload.classList.remove("hidden");
    input.value = "";
    setStatus("");
  });
})();
