(() => {
  const $ = (sel) => document.querySelector(sel);

  const gate = $("#gate");
  const app = $("#app");
  const nameInput = $("#name-input");
  const randomBtn = $("#random-btn");
  const joinBtn = $("#join-btn");
  const gateError = $("#gate-error");
  const feed = $("#feed");
  const pins = $("#pins");
  const pinBarLabel = $("#pin-bar-label");
  const pinBarPreview = $("#pin-bar-preview");
  const pinBarMeta = $("#pin-bar-meta");
  const presence = $("#presence");
  const messageInput = $("#message-input");
  const sendBtn = $("#send-btn");
  const photoInput = $("#photo-input");
  const preview = $("#preview");
  const previewImg = $("#preview-img");
  const previewClear = $("#preview-clear");
  const composerHint = $("#composer-hint");
  const renameBtn = $("#rename-btn");
  const adminBtn = $("#admin-btn");
  const filterBtn = $("#filter-btn");
  const filterBar = $("#filter-bar");
  const filterBarText = $("#filter-bar-text");
  const filterClearBtn = $("#filter-clear-btn");
  const filterDialog = $("#filter-dialog");
  const filterUserList = $("#filter-user-list");
  const filterApplyBtn = $("#filter-apply-btn");
  const filterCancelBtn = $("#filter-cancel-btn");
  const adminDialog = $("#admin-dialog");
  const adminForm = $("#admin-form");
  const adminPassword = $("#admin-password");
  const adminError = $("#admin-error");
  const lightbox = $("#lightbox");
  const lightboxImg = $("#lightbox-img");

  const socket = io({ autoConnect: true });

  let myName = "";
  let isAdmin = false;
  let pendingImageUrl = null;
  let uploading = false;
  const knownIds = new Set();
  /** @type {Set<string>} */
  let filterNames = new Set();
  let lastState = { messages: [], pinned: [] };
  let pinCycleIndex = 0;

  async function fetchRandomName() {
    const res = await fetch("/api/random-name");
    const data = await res.json();
    nameInput.value = data.name;
  }

  function showGateError(text) {
    gateError.hidden = !text;
    gateError.textContent = text || "";
  }

  function formatTime(iso) {
    try {
      return new Intl.DateTimeFormat("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(iso));
    } catch {
      return "";
    }
  }

  function lockPageScroll() {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }

  function syncViewportHeight() {
    const vv = window.visualViewport;
    let inset = 0;
    if (vv) {
      inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    }
    document.documentElement.style.setProperty("--kb-inset", `${inset}px`);
    document.body.classList.toggle("keyboard-open", inset > 80);
    lockPageScroll();
  }

  function autoSize() {
    messageInput.style.height = "auto";
    const visible = window.visualViewport?.height || window.innerHeight;
    const cap = Math.min(88, Math.round(visible * 0.18));
    messageInput.style.height = `${Math.min(messageInput.scrollHeight, Math.max(44, cap))}px`;
  }

  syncViewportHeight();
  window.addEventListener("resize", syncViewportHeight);
  window.addEventListener("orientationchange", () => {
    setTimeout(syncViewportHeight, 150);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncViewportHeight);
    window.visualViewport.addEventListener("scroll", syncViewportHeight);
  }

  function setAdminUi(on) {
    isAdmin = on;
    document.body.classList.toggle("admin-on", on);
    adminBtn.textContent = on ? "Админ ✓" : "Админ";
    renderAll(lastState);
  }

  function passesFilter(msg) {
    if (!filterNames.size) return true;
    return filterNames.has(msg.name);
  }

  function uniqueAuthors() {
    const names = new Set();
    for (const msg of lastState.messages || []) names.add(msg.name);
    for (const msg of lastState.pinned || []) names.add(msg.name);
    return [...names].sort((a, b) => a.localeCompare(b, "ru"));
  }

  function updateFilterChrome() {
    const active = filterNames.size > 0;
    filterBtn.classList.toggle("active", active);
    filterBtn.textContent = active ? `Фильтр (${filterNames.size})` : "Фильтр";
    if (active) {
      filterBar.hidden = false;
      const list = [...filterNames];
      filterBarText.textContent =
        list.length === 1
          ? `Только: ${list[0]}`
          : `Только: ${list.slice(0, 3).join(", ")}${list.length > 3 ? "…" : ""}`;
    } else {
      filterBar.hidden = true;
    }
  }

  function openFilterDialog() {
    const authors = uniqueAuthors();
    filterUserList.replaceChildren();
    if (!authors.length) {
      const empty = document.createElement("p");
      empty.className = "user-list-empty";
      empty.textContent = "Пока нет участников в истории";
      filterUserList.append(empty);
    } else {
      for (const name of authors) {
        const row = document.createElement("label");
        row.className = "user-row";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = name;
        input.checked = filterNames.has(name);
        const span = document.createElement("span");
        span.textContent = name;
        row.append(input, span);
        filterUserList.append(row);
      }
    }
    filterDialog.showModal();
  }

  function applyFilterFromDialog() {
    const next = new Set();
    filterUserList.querySelectorAll('input[type="checkbox"]:checked').forEach((el) => {
      next.add(el.value);
    });
    filterNames = next;
    updateFilterChrome();
    filterDialog.close();
    renderAll(lastState);
  }

  function clearFilter() {
    filterNames = new Set();
    updateFilterChrome();
    renderAll(lastState);
  }

  function filterOnlyUser(name) {
    filterNames = new Set([name]);
    updateFilterChrome();
    renderAll(lastState);
  }

  function pinPreviewText(msg) {
    if (msg.text && msg.text.trim()) {
      return msg.text.replace(/\s+/g, " ").trim();
    }
    if (msg.imageUrl) return "📷 Фото";
    return "Сообщение";
  }

  function visiblePins() {
    return (lastState.pinned || []).filter(passesFilter);
  }

  function updatePinBar() {
    const list = visiblePins();
    if (!list.length) {
      pins.hidden = true;
      pinCycleIndex = 0;
      return;
    }
    if (pinCycleIndex >= list.length) pinCycleIndex = 0;
    const current = list[pinCycleIndex];
    pins.hidden = false;
    pinBarLabel.textContent =
      list.length === 1 ? "Закреплённое сообщение" : `Закреплённые · ${pinCycleIndex + 1}/${list.length}`;
    pinBarPreview.textContent = `${current.name}: ${pinPreviewText(current)}`;
    if (list.length > 1) {
      pinBarMeta.hidden = false;
      pinBarMeta.textContent = "далее";
    } else {
      pinBarMeta.hidden = true;
    }
  }

  function scrollToPinnedMessage(msg) {
    const el = feed.querySelector(`[data-id="${msg.id}"]`);
    if (!el) {
      composerHint.textContent = "Сообщение не в текущей ленте (фильтр?)";
      return;
    }
    el.classList.add("pin-flash");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => el.classList.remove("pin-flash"), 1200);
  }

  function onPinBarClick() {
    const list = visiblePins();
    if (!list.length) return;
    const current = list[pinCycleIndex];
    scrollToPinnedMessage(current);
    if (list.length > 1) {
      pinCycleIndex = (pinCycleIndex + 1) % list.length;
      updatePinBar();
    }
  }

  function renderMessage(msg) {
    const el = document.createElement("article");
    el.className = "msg";
    el.dataset.id = msg.id;
    el.dataset.name = msg.name;
    if (msg.name === myName) el.classList.add("mine");
    if (msg.pinned) el.classList.add("pinned-item");

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    const nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "msg-name";
    nameBtn.textContent = msg.name;
    nameBtn.title = "Показать только этого участника";
    nameBtn.addEventListener("click", () => filterOnlyUser(msg.name));
    const time = document.createElement("span");
    time.className = "msg-time";
    time.textContent = formatTime(msg.createdAt);
    meta.append(nameBtn, time);

    el.append(meta);

    if (msg.text) {
      const text = document.createElement("p");
      text.className = "msg-text";
      text.textContent = msg.text;
      el.append(text);
    }

    if (msg.imageUrl) {
      const img = document.createElement("img");
      img.className = "msg-photo";
      img.src = msg.imageUrl;
      img.alt = `Фото от ${msg.name}`;
      img.loading = "lazy";
      img.addEventListener("click", () => {
        lightboxImg.src = msg.imageUrl;
        lightbox.showModal();
      });
      el.append(img);
    }

    if (isAdmin) {
      const actions = document.createElement("div");
      actions.className = "msg-actions";

      const pinBtn = document.createElement("button");
      pinBtn.type = "button";
      pinBtn.textContent = msg.pinned ? "Открепить" : "Закрепить";
      pinBtn.addEventListener("click", () => {
        const event = msg.pinned ? "admin:unpin" : "admin:pin";
        socket.emit(event, { id: msg.id }, (res) => {
          if (!res?.ok) composerHint.textContent = res?.error || "Ошибка";
        });
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "danger";
      delBtn.textContent = "Удалить";
      delBtn.addEventListener("click", () => {
        if (!confirm("Удалить сообщение?")) return;
        socket.emit("admin:delete", { id: msg.id }, (res) => {
          if (!res?.ok) composerHint.textContent = res?.error || "Ошибка";
        });
      });

      actions.append(pinBtn, delBtn);
      el.append(actions);
    }

    return el;
  }

  function renderAll(state) {
    lastState = state || lastState;
    const { messages = [] } = lastState;

    updatePinBar();

    const nearBottom =
      feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;

    feed.replaceChildren();
    knownIds.clear();
    for (const msg of messages) {
      knownIds.add(msg.id);
      if (!passesFilter(msg)) continue;
      feed.append(renderMessage(msg));
    }

    if (nearBottom) {
      feed.scrollTop = feed.scrollHeight;
    }
    updateFilterChrome();
  }

  function appendMessage(msg) {
    if (knownIds.has(msg.id)) return;
    knownIds.add(msg.id);
    lastState.messages = [...(lastState.messages || []), msg];
    if (!passesFilter(msg)) return;
    const nearBottom =
      feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120;
    feed.append(renderMessage(msg));
    if (nearBottom || msg.name === myName) {
      feed.scrollTop = feed.scrollHeight;
    }
  }

  function enterChat(name) {
    myName = name;
    gate.hidden = true;
    app.hidden = false;
    renameBtn.title = `Сейчас: ${myName}`;
    messageInput.focus();
  }

  function join() {
    showGateError("");
    const name = nameInput.value.trim();
    socket.emit("chat:join", { name }, (res) => {
      if (!res?.ok) {
        showGateError(res?.error || "Не удалось войти");
        return;
      }
      enterChat(res.name);
    });
  }

  async function uploadPhoto(file) {
    uploading = true;
    composerHint.textContent = "Загрузка фото…";
    sendBtn.disabled = true;
    try {
      const body = new FormData();
      body.append("photo", file);
      const res = await fetch("/api/upload", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
      pendingImageUrl = data.imageUrl;
      previewImg.src = data.imageUrl;
      preview.hidden = false;
      composerHint.textContent = "Фото готово к отправке";
    } catch (err) {
      composerHint.textContent = err.message || "Не удалось загрузить фото";
      pendingImageUrl = null;
      preview.hidden = true;
    } finally {
      uploading = false;
      sendBtn.disabled = false;
    }
  }

  function clearPreview() {
    pendingImageUrl = null;
    preview.hidden = true;
    previewImg.removeAttribute("src");
    photoInput.value = "";
    if (composerHint.textContent.includes("Фото")) composerHint.textContent = "";
  }

  function send() {
    if (uploading) return;
    const text = messageInput.value.trim();
    if (!text && !pendingImageUrl) return;

    const payload = { text, imageUrl: pendingImageUrl };
    socket.emit("chat:message", payload, (res) => {
      if (!res?.ok) {
        composerHint.textContent = res?.error || "Не отправилось";
        return;
      }
      messageInput.value = "";
      autoSize();
      clearPreview();
      composerHint.textContent = "";
    });
  }

  randomBtn.addEventListener("click", () => {
    fetchRandomName().catch(() => {
      nameInput.value = `Гость${Math.floor(Math.random() * 90) + 10}`;
    });
  });

  joinBtn.addEventListener("click", join);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      join();
    }
  });

  sendBtn.addEventListener("click", send);
  messageInput.addEventListener("input", autoSize);
  messageInput.addEventListener("focus", () => {
    setTimeout(() => {
      lockPageScroll();
      syncViewportHeight();
      feed.scrollTop = feed.scrollHeight;
    }, 50);
    setTimeout(() => {
      lockPageScroll();
      syncViewportHeight();
    }, 300);
  });
  messageInput.addEventListener("blur", () => {
    setTimeout(() => {
      lockPageScroll();
      syncViewportHeight();
    }, 100);
  });
  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  photoInput.addEventListener("change", () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      composerHint.textContent = "Можно только изображения";
      return;
    }
    uploadPhoto(file);
  });

  previewClear.addEventListener("click", clearPreview);

  filterBtn.addEventListener("click", openFilterDialog);
  filterApplyBtn.addEventListener("click", applyFilterFromDialog);
  filterCancelBtn.addEventListener("click", () => filterDialog.close());
  filterClearBtn.addEventListener("click", clearFilter);
  pins.addEventListener("click", onPinBarClick);

  renameBtn.addEventListener("click", () => {
    const next = prompt("Новое имя", myName);
    if (next == null) return;
    socket.emit("chat:rename", { name: next }, (res) => {
      if (!res?.ok) {
        composerHint.textContent = res?.error || "Не сменилось";
        return;
      }
      myName = res.name;
      renameBtn.title = `Сейчас: ${myName}`;
      renderAll(lastState);
    });
  });

  adminBtn.addEventListener("click", () => {
    if (isAdmin) {
      composerHint.textContent = "Вы уже админ в этой сессии";
      return;
    }
    adminError.hidden = true;
    adminPassword.value = "";
    adminDialog.showModal();
    adminPassword.focus();
  });

  adminForm.addEventListener("submit", (e) => {
    const submitter = e.submitter;
    if (submitter?.value === "cancel") return;
    e.preventDefault();
    socket.emit("admin:login", { password: adminPassword.value }, (res) => {
      if (!res?.ok) {
        adminError.hidden = false;
        adminError.textContent = res?.error || "Ошибка";
        return;
      }
      setAdminUi(true);
      adminDialog.close();
      composerHint.textContent = "Режим админа включён";
    });
  });

  socket.on("chat:state", (state) => {
    renderAll(state);
  });

  socket.on("chat:message", (msg) => {
    appendMessage(msg);
  });

  socket.on("chat:presence", ({ count, names }) => {
    const sample = (names || []).slice(0, 4).join(", ");
    presence.textContent =
      count === 1
        ? `онлайн 1${sample ? ` · ${sample}` : ""}`
        : `онлайн ${count}${sample ? ` · ${sample}` : ""}`;
  });

  socket.on("connect", () => {
    if (myName) {
      socket.emit("chat:join", { name: myName }, (res) => {
        if (res?.ok) myName = res.name;
      });
    }
  });

  fetchRandomName().catch(() => {});
})();
