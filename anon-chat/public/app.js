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
  const replyBar = $("#reply-bar");
  const replyBarLabel = $("#reply-bar-label");
  const replyBarPreview = $("#reply-bar-preview");
  const replyCancelBtn = $("#reply-cancel-btn");
  const emojiBtn = $("#emoji-btn");
  const emojiPanel = $("#emoji-panel");
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
  const NAME_KEY = "komnata_name";
  const EMOJIS = ["😀", "😂", "😍", "😎", "🤔", "😢", "👍", "❤️", "🔥", "🎉"];
  const REACTIONS = [
    { emoji: "😊", title: "смайл" },
    { emoji: "❤️", title: "любовь" },
    { emoji: "😢", title: "грусть" },
    { emoji: "💩", title: "говно" },
    { emoji: "🔥", title: "огонь" },
  ];

  let myName = "";
  let isAdmin = false;
  let pendingImageUrl = null;
  let uploading = false;
  let pendingReply = null;
  const knownIds = new Set();
  /** @type {Set<string>} */
  let filterNames = new Set();
  let lastState = { messages: [], pinned: [] };
  let pinCycleIndex = 0;

  function loadSavedName() {
    try {
      return (localStorage.getItem(NAME_KEY) || "").trim().slice(0, 24);
    } catch {
      return "";
    }
  }

  function saveName(name) {
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* ignore */
    }
  }

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

    if (msg.reply) {
      const quote = document.createElement("button");
      quote.type = "button";
      quote.className = "msg-quote";
      quote.title = "Перейти к сообщению";
      const qName = document.createElement("span");
      qName.className = "msg-quote-name";
      qName.textContent = msg.reply.name;
      const qText = document.createElement("span");
      qText.className = "msg-quote-text";
      qText.textContent = msg.reply.text || "Сообщение";
      quote.append(qName, qText);
      quote.addEventListener("click", () => {
        const target = feed.querySelector(`[data-id="${msg.reply.id}"]`);
        if (!target) return;
        target.classList.add("pin-flash");
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => target.classList.remove("pin-flash"), 1200);
      });
      el.append(quote);
    }

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

    const actions = document.createElement("div");
    actions.className = "msg-actions";

    for (const { emoji, title } of REACTIONS) {
      const reactors = Array.isArray(msg.reactions?.[emoji]) ? msg.reactions[emoji] : [];
      const mine = reactors.includes(myName);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "msg-react" + (mine ? " mine" : "") + (reactors.length ? " on" : "");
      btn.title = title;
      btn.textContent = reactors.length ? `${emoji}${reactors.length}` : emoji;
      btn.addEventListener("click", () => {
        socket.emit("chat:react", { id: msg.id, emoji }, (res) => {
          if (!res?.ok) composerHint.textContent = res?.error || "Ошибка реакции";
        });
      });
      actions.append(btn);
    }

    const replyBtn = document.createElement("button");
    replyBtn.type = "button";
    replyBtn.className = "msg-reply";
    replyBtn.textContent = "ответить";
    replyBtn.addEventListener("click", () => setReplyTarget(msg));
    actions.append(replyBtn);

    if (isAdmin) {
      const pinBtn = document.createElement("button");
      pinBtn.type = "button";
      pinBtn.textContent = "📌";
      pinBtn.title = msg.pinned ? "Открепить" : "Закрепить";
      pinBtn.className = "msg-admin-icon";
      pinBtn.addEventListener("click", () => {
        const event = msg.pinned ? "admin:unpin" : "admin:pin";
        socket.emit(event, { id: msg.id }, (res) => {
          if (!res?.ok) composerHint.textContent = res?.error || "Ошибка";
        });
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "msg-admin-icon danger";
      delBtn.textContent = "✕";
      delBtn.title = "Удалить";
      delBtn.addEventListener("click", () => {
        if (!confirm("Удалить сообщение?")) return;
        socket.emit("admin:delete", { id: msg.id }, (res) => {
          if (!res?.ok) composerHint.textContent = res?.error || "Ошибка";
        });
      });

      actions.append(pinBtn, delBtn);
    }

    el.append(actions);
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

  function patchMessage(updated) {
    if (!updated?.id) return;
    const idx = (lastState.messages || []).findIndex((m) => m.id === updated.id);
    if (idx >= 0) lastState.messages[idx] = updated;
    const pinIdx = (lastState.pinned || []).findIndex((m) => m.id === updated.id);
    if (pinIdx >= 0) lastState.pinned[pinIdx] = updated;
    const el = feed.querySelector(`[data-id="${updated.id}"]`);
    if (!el) return;
    const next = renderMessage(updated);
    el.replaceWith(next);
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
    saveName(name);
    gate.hidden = true;
    app.hidden = false;
    renameBtn.title = `Сейчас: ${myName}`;
    messageInput.focus();
  }

  function join(nameOverride) {
    showGateError("");
    const name = (nameOverride ?? nameInput.value).trim();
    socket.emit("chat:join", { name }, (res) => {
      if (!res?.ok) {
        showGateError(res?.error || "Не удалось войти");
        return;
      }
      enterChat(res.name);
    });
  }

  function setReplyTarget(msg) {
    pendingReply = {
      id: msg.id,
      name: msg.name,
      text: (msg.text || (msg.imageUrl ? "📷 Фото" : "Сообщение")).replace(/\s+/g, " ").trim().slice(0, 120),
    };
    replyBar.hidden = false;
    replyBarLabel.textContent = `Ответ · ${pendingReply.name}`;
    replyBarPreview.textContent = pendingReply.text;
    messageInput.focus();
  }

  function clearReply() {
    pendingReply = null;
    replyBar.hidden = true;
  }

  function insertEmoji(emoji) {
    const start = messageInput.selectionStart ?? messageInput.value.length;
    const end = messageInput.selectionEnd ?? messageInput.value.length;
    const value = messageInput.value;
    messageInput.value = value.slice(0, start) + emoji + value.slice(end);
    const pos = start + emoji.length;
    // Keep selection for the next emoji without focusing (no iOS keyboard).
    try {
      messageInput.setSelectionRange(pos, pos);
    } catch {
      /* ignore */
    }
    autoSize();
  }

  function closeEmojiPanel() {
    emojiPanel.hidden = true;
    emojiBtn.classList.remove("active");
  }

  function openEmojiPanel() {
    // Close keyboard first so the strip is not buried under iOS keyboard.
    messageInput.blur();
    emojiPanel.hidden = false;
    emojiBtn.classList.add("active");
    setTimeout(() => {
      lockPageScroll();
      syncViewportHeight();
    }, 50);
  }

  function buildEmojiPanel() {
    emojiPanel.replaceChildren();
    for (const emoji of EMOJIS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "emoji-btn-item";
      btn.textContent = emoji;
      // Prevent focus steal / keyboard open on iOS.
      btn.addEventListener("pointerdown", (e) => e.preventDefault());
      btn.addEventListener("click", () => {
        insertEmoji(emoji);
        // Leave the strip open for more picks; do not focus the textarea.
      });
      emojiPanel.append(btn);
    }
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

    const payload = {
      text,
      imageUrl: pendingImageUrl,
      replyToId: pendingReply?.id || null,
    };
    socket.emit("chat:message", payload, (res) => {
      if (!res?.ok) {
        composerHint.textContent = res?.error || "Не отправилось";
        return;
      }
      messageInput.value = "";
      autoSize();
      clearPreview();
      clearReply();
      closeEmojiPanel();
      composerHint.textContent = "";
    });
  }

  randomBtn.addEventListener("click", () => {
    fetchRandomName().catch(() => {
      nameInput.value = `Гость${Math.floor(Math.random() * 90) + 10}`;
    });
  });

  joinBtn.addEventListener("click", () => join());
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      join();
    }
  });

  sendBtn.addEventListener("click", send);
  replyCancelBtn.addEventListener("click", clearReply);
  emojiBtn.addEventListener("pointerdown", (e) => e.preventDefault());
  emojiBtn.addEventListener("click", () => {
    if (emojiPanel.hidden) openEmojiPanel();
    else closeEmojiPanel();
  });
  buildEmojiPanel();

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
      saveName(myName);
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

  socket.on("chat:message-update", (msg) => {
    patchMessage(msg);
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
        if (res?.ok) {
          myName = res.name;
          saveName(myName);
        }
      });
    }
  });

  const savedName = loadSavedName();
  if (savedName) {
    nameInput.value = savedName;
    // Auto-enter with cached nick after socket is up.
    const tryAutoJoin = () => {
      if (myName) return;
      join(savedName);
    };
    if (socket.connected) tryAutoJoin();
    else socket.once("connect", tryAutoJoin);
  } else {
    fetchRandomName().catch(() => {});
  }
})();
