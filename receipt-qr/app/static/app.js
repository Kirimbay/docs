(() => {
  const drop = document.getElementById("dropzone");
  const input = document.getElementById("file-input");
  const status = document.getElementById("status");
  const stepUpload = document.getElementById("step-upload");
  const stepEdit = document.getElementById("step-edit");
  const form = document.getElementById("fields-form");
  const hintsEl = document.getElementById("hints");
  const qrFrame = document.getElementById("qr-frame");
  const btnAgain = document.getElementById("btn-again");

  const overlay = document.getElementById("progress-overlay");
  const progressFill = document.getElementById("progress-fill");
  const progressPct = document.getElementById("progress-pct");
  const progressLabel = document.getElementById("progress-label");
  const progressTrack = document.getElementById("progress-track");

  const FIELD_NAMES = [
    "name", "personal_acc", "bank_name", "bic", "corresp_acc",
    "payee_inn", "kpp", "sum_rub", "purpose", "cbc", "oktmo", "pers_acc",
  ];

  // Пустые поля после OCR — красным; для рукописи — отдельная пометка
  const HAND_FIELDS = new Set(["purpose", "sum_rub"]);
  const MARK_IF_EMPTY = [
    "name", "personal_acc", "bank_name", "bic", "corresp_acc",
    "payee_inn", "kpp", "sum_rub", "purpose",
  ];

  let displayPct = 0;
  let floorPct = 0;
  let ceilingPct = 12;
  let rafId = 0;
  let qrTimer = 0;

  function setStatus(msg) {
    status.textContent = msg || "";
  }

  function ensureManualNote(label, hand) {
    let note = label.querySelector(".manual-note");
    if (!note) {
      note = document.createElement("span");
      note.className = "manual-note";
      label.appendChild(note);
    }
    note.textContent = hand
      ? "введите вручную — рукопись не распознана"
      : "введите вручную";
  }

  function clearManualNote(label) {
    label.querySelector(".manual-note")?.remove();
  }

  function fillForm(fields) {
    for (const name of FIELD_NAMES) {
      const el = form.elements.namedItem(name);
      if (el) el.value = fields[name] || "";
    }
    markMissingFields(fields || {});
  }

  function markMissingFields(fields) {
    for (const name of FIELD_NAMES) {
      const el = form.elements.namedItem(name);
      if (!el) continue;
      const label = el.closest("label");
      if (!label) continue;
      const empty = !(fields[name] || "").trim();
      const shouldMark = empty && MARK_IF_EMPTY.includes(name);
      label.classList.toggle("needs-input", shouldMark);
      if (shouldMark) ensureManualNote(label, HAND_FIELDS.has(name));
      else clearManualNote(label);
    }
  }

  function clearMissingMark(el) {
    const label = el.closest("label");
    if (label && el.value.trim()) {
      label.classList.remove("needs-input");
      clearManualNote(label);
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

  function showQr(dataUrl, errorMsg) {
    if (dataUrl) {
      qrFrame.innerHTML = "";
      const img = document.createElement("img");
      img.src = dataUrl;
      img.alt = "Банковский QR";
      qrFrame.appendChild(img);
      return;
    }
    qrFrame.innerHTML = `<p class="qr-placeholder">${
      errorMsg || "Заполните отмеченные поля — QR обновится сам"
    }</p>`;
  }

  function paintProgress() {
    const rounded = Math.max(1, Math.min(100, Math.round(displayPct)));
    progressFill.style.width = `${rounded}%`;
    progressPct.textContent = String(rounded);
    progressTrack.setAttribute("aria-valuenow", String(rounded));
  }

  function tickProgress() {
    if (floorPct < 100 && displayPct < ceilingPct - 0.35) {
      displayPct += 0.28;
    }
    paintProgress();
    if (floorPct < 100) rafId = requestAnimationFrame(tickProgress);
  }

  function setStage(pct, label) {
    const next = Number(pct) || 0;
    floorPct = next;
    displayPct = Math.max(displayPct, next);
    if (next >= 100) {
      ceilingPct = 100;
      displayPct = 100;
    } else if (next >= 94) {
      ceilingPct = 99;
    } else if (next >= 82) {
      ceilingPct = 93;
    } else if (next >= 70) {
      ceilingPct = 81;
    } else if (next >= 28) {
      ceilingPct = 68;
    } else if (next >= 22) {
      ceilingPct = 27;
    } else if (next >= 12) {
      ceilingPct = 21;
    } else {
      ceilingPct = Math.max(next + 8, ceilingPct);
    }
    if (label) progressLabel.textContent = label;
    paintProgress();
  }

  function showOverlay() {
    displayPct = 1;
    floorPct = 1;
    ceilingPct = 12;
    progressLabel.textContent = "Загрузка…";
    overlay.classList.remove("hidden");
    document.body.classList.add("is-processing");
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tickProgress);
    paintProgress();
  }

  function hideOverlay() {
    cancelAnimationFrame(rafId);
    displayPct = 100;
    floorPct = 100;
    ceilingPct = 100;
    paintProgress();
    window.setTimeout(() => {
      overlay.classList.add("hidden");
      document.body.classList.remove("is-processing");
    }, 280);
  }

  async function rebuildQr() {
    try {
      const res = await fetch("/api/qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(readForm()),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showQr("", data.detail || "Заполните обязательные поля");
        return;
      }
      showQr(data.data_url);
    } catch (err) {
      showQr("", err.message || String(err));
    }
  }

  function scheduleQrRebuild() {
    window.clearTimeout(qrTimer);
    qrTimer = window.setTimeout(rebuildQr, 400);
  }

  async function processFile(file) {
    showOverlay();
    progressLabel.textContent = "Загрузка…";
    paintProgress();

    return new Promise((resolve, reject) => {
      const body = new FormData();
      body.append("file", file);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/process");
      xhr.responseType = "text";

      let processedUntil = 0;
      let settled = false;

      function handleLine(line) {
        line = line.trim();
        if (!line) return;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }

        if (msg.pct != null || msg.label) {
          setStage(Number(msg.pct) || floorPct, msg.label || "");
        }

        if ((msg.stage === "parsed" || msg.stage === "done") && msg.fields) {
          fillForm(msg.fields);
          showHints(msg.hints || []);
        }

        if (msg.stage === "done") {
          settled = true;
          stepUpload.classList.add("hidden");
          stepEdit.classList.remove("hidden");
          showQr(msg.data_url, msg.qr_error);
          hideOverlay();
          const purposeEl = form.elements.namedItem("purpose");
          if (purposeEl && !(msg.fields?.purpose || "").trim()) {
            purposeEl.focus();
          }
          resolve(msg);
        }

        if (msg.stage === "error") {
          settled = true;
          hideOverlay();
          reject(new Error(msg.error || "Ошибка обработки"));
        }
      }

      function consume() {
        const text = xhr.responseText || "";
        let start = processedUntil;
        while (true) {
          const nl = text.indexOf("\n", start);
          if (nl === -1) break;
          handleLine(text.slice(start, nl));
          start = nl + 1;
        }
        processedUntil = start;
      }

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const up = 1 + Math.round((e.loaded / Math.max(e.total, 1)) * 10);
        floorPct = Math.max(floorPct, Math.min(11, up));
        displayPct = Math.max(displayPct, floorPct);
        ceilingPct = 12;
        progressLabel.textContent = "Загрузка…";
        paintProgress();
      };

      xhr.onprogress = consume;

      xhr.onload = () => {
        consume();
        if (processedUntil < (xhr.responseText || "").length) {
          handleLine(xhr.responseText.slice(processedUntil));
        }
        if (settled) return;
        if (xhr.status >= 400) {
          let detail = "Ошибка обработки";
          try {
            detail = JSON.parse(xhr.responseText).detail || detail;
          } catch {
            /* ignore */
          }
          hideOverlay();
          reject(new Error(detail));
          return;
        }
        hideOverlay();
        reject(new Error("Поток оборвался"));
      };

      xhr.onerror = () => {
        if (settled) return;
        hideOverlay();
        reject(new Error("Сеть: не удалось обработать файл"));
      };

      xhr.send(body);
    });
  }

  async function onFile(file) {
    if (!file) return;
    try {
      setStatus("");
      await processFile(file);
    } catch (err) {
      hideOverlay();
      setStatus(err.message || String(err));
    }
  }

  drop.addEventListener("click", () => input.click());
  drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });
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

  form.addEventListener("input", (e) => {
    if (e.target && e.target.name) clearMissingMark(e.target);
    scheduleQrRebuild();
  });
  form.addEventListener("change", scheduleQrRebuild);

  btnAgain.addEventListener("click", () => {
    stepEdit.classList.add("hidden");
    stepUpload.classList.remove("hidden");
    input.value = "";
    setStatus("");
    showQr("", "Загрузите фото");
    for (const name of FIELD_NAMES) {
      const el = form.elements.namedItem(name);
      if (el) {
        el.value = "";
        const label = el.closest("label");
        label?.classList.remove("needs-input");
        label?.querySelector(".manual-note")?.remove();
      }
    }
    showHints([]);
  });
})();
