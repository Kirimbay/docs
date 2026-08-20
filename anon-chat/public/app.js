(() => {
  const $ = (sel) => document.querySelector(sel);

  const gate = $("#gate");
  const app = $("#app");
  const nameInput = $("#name-input");
  const randomBtn = $("#random-btn");
  const joinBtn = $("#join-btn");
  const gateError = $("#gate-error");
  const feed = $("#feed");
  const jumpBottomBtn = $("#jump-bottom");
  const pins = $("#pins");
  const pinBarLabel = $("#pin-bar-label");
  const pinBarPreview = $("#pin-bar-preview");
  const pinBarMeta = $("#pin-bar-meta");
  const pinsDialog = $("#pins-dialog");
  const pinsList = $("#pins-list");
  const pinsCloseBtn = $("#pins-close-btn");
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
  const renameDialog = $("#rename-dialog");
  const renameInput = $("#rename-input");
  const renameRandomBtn = $("#rename-random-btn");
  const renameCancelBtn = $("#rename-cancel-btn");
  const renameApplyBtn = $("#rename-apply-btn");
  const adminBtn = $("#admin-btn");
  const dmBtn = $("#dm-btn");
  const dmBar = $("#dm-bar");
  const dmBarCode = $("#dm-bar-code");
  const dmBarPresence = $("#dm-bar-presence");
  const dmCopyBtn = $("#dm-copy-btn");
  const dmLeaveBtn = $("#dm-leave-btn");
  const dmDialog = $("#dm-dialog");
  const dmCreateBtn = $("#dm-create-btn");
  const dmJoinBtn = $("#dm-join-btn");
  const dmCodeInput = $("#dm-code-input");
  const dmDialogError = $("#dm-dialog-error");
  const dmDialogClose = $("#dm-dialog-close");
  const dmCreatedBox = $("#dm-created-box");
  const dmCreatedCode = $("#dm-created-code");
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
  const DM_CODE_KEY = "sarafan_dm_code";
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
  let publicStateBackup = null;
  let dmCode = null;
  let pinCycleIndex = 0;
  let pinHoldTimer = null;
  let pinHoldOpened = false;
  let pinHoldStart = null;
  const PIN_HOLD_MS = 420;
  const PIN_HOLD_MOVE_PX = 12;
  let deleteArmedId = null;
  let deleteArmedTimer = null;

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

  function loadDmCode() {
    try {
      return (localStorage.getItem(DM_CODE_KEY) || "").trim().toUpperCase();
    } catch {
      return "";
    }
  }

  function saveDmCode(code) {
    try {
      if (code) localStorage.setItem(DM_CODE_KEY, code);
      else localStorage.removeItem(DM_CODE_KEY);
    } catch {
      /* ignore */
    }
  }

  function showDmDialogError(text) {
    if (!dmDialogError) return;
    dmDialogError.hidden = !text;
    dmDialogError.textContent = text || "";
  }

  function updateDmPresence({ count, names } = {}) {
    if (!dmBarPresence) return;
    const n = Number(count) || 0;
    const sample = (names || []).filter((x) => x && x !== myName).slice(0, 2).join(", ");
    dmBarPresence.textContent = sample ? `${n}/2 · ${sample}` : `${n}/2`;
  }

  function enterDmMode(res) {
    if (!res?.ok || !res.code) return;
    if (!dmCode) publicStateBackup = { messages: [...(lastState.messages || [])], pinned: [...(lastState.pinned || [])] };
    dmCode = res.code;
    saveDmCode(res.code);
    document.body.classList.add("dm-on");
    if (dmBar) dmBar.hidden = false;
    if (dmBarCode) dmBarCode.textContent = res.code;
    if (dmCreatedBox && dmCreatedCode) {
      dmCreatedBox.hidden = false;
      dmCreatedCode.textContent = res.code;
    }
    clearReply();
    clearFilter();
    filterNames = new Set();
    updateFilterChrome();
    renderAll({ messages: res.messages || [], pinned: [] });
    updateDmPresence(res);
    if (messageInput) messageInput.placeholder = "Сообщение вдвоём…";
    composerHint.textContent = `Комната ${res.code} · передайте код второму`;
  }

  function leaveDmMode() {
    const prev = dmCode;
    dmCode = null;
    saveDmCode("");
    document.body.classList.remove("dm-on");
    if (dmBar) dmBar.hidden = true;
    if (messageInput) messageInput.placeholder = "Написать сообщение…";
    clearReply();
    socket.emit("dm:leave", {}, () => {
      /* chat:state follows from server */
    });
    if (prev) composerHint.textContent = "Снова общий чат";
  }

  function openDmDialog() {
    if (!dmDialog) return;
    showDmDialogError("");
    if (dmCreatedBox) dmCreatedBox.hidden = true;
    if (dmCodeInput) {
      dmCodeInput.value = loadDmCode() || "";
      keepDialogAboveKeyboard(dmDialog, dmCodeInput);
    }
    dmDialog.showModal();
    dmCodeInput?.focus();
  }

  async function fetchRandomName(targetInput = nameInput) {
    const res = await fetch("/api/random-name");
    const data = await res.json();
    if (targetInput && data?.name) targetInput.value = data.name;
    return data?.name || "";
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

  function appendLinkedText(container, raw) {
    const text = String(raw || "");
    if (!text) return;

    // Collect every http(s)/www start, then take each run until whitespace
    // or the next URL start (so multiple links in one message all become <a>).
    const starts = [];
    const startRe = /https?:\/\/|www\./gi;
    let sm;
    while ((sm = startRe.exec(text)) !== null) {
      starts.push(sm.index);
    }
    if (!starts.length) {
      container.append(document.createTextNode(text));
      return;
    }

    let last = 0;
    for (let i = 0; i < starts.length; i += 1) {
      const start = starts[i];
      if (start < last) continue;
      if (start > last) {
        container.append(document.createTextNode(text.slice(last, start)));
      }

      const limit = i + 1 < starts.length ? starts[i + 1] : text.length;
      let end = start;
      while (end < limit && !/[\s<>"']/.test(text.charAt(end))) {
        end += 1;
      }

      let url = text.slice(start, end);
      let trailing = "";
      while (url.length > 1 && /[.,;:!?)"'\]»]/u.test(url)) {
        trailing = url.slice(-1) + trailing;
        url = url.slice(0, -1);
      }

      const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      let linked = false;
      try {
        const parsed = new URL(href);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          const a = document.createElement("a");
          a.className = "msg-link";
          a.href = parsed.href;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = url;
          container.append(a);
          linked = true;
        }
      } catch {
        /* fall through */
      }
      if (!linked) container.append(document.createTextNode(text.slice(start, end)));
      else if (trailing) container.append(document.createTextNode(trailing));

      last = linked ? start + url.length + trailing.length : end;
      // Prefer advancing to the scanned end so we never stall.
      if (last < end) last = end;
    }

    if (last < text.length) {
      container.append(document.createTextNode(text.slice(last)));
    }
  }

  function isNearBottom(threshold = 120) {
    return feed.scrollHeight - feed.scrollTop - feed.clientHeight < threshold;
  }

  function updateJumpBottom() {
    jumpBottomBtn.hidden = isNearBottom(180);
  }

  function scrollFeedToBottom(smooth = true) {
    feed.scrollTo({
      top: feed.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
    jumpBottomBtn.hidden = true;
  }

  function lockPageScroll() {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }

  function syncViewportHeight() {
    const vv = window.visualViewport;
    const active = document.activeElement;
    const focused =
      active === messageInput ||
      active === nameInput ||
      active === renameInput ||
      active === adminPassword ||
      active?.tagName === "TEXTAREA" ||
      active?.tagName === "INPUT";

    let height = window.innerHeight;
    let inset = 0;
    if (vv) {
      height = Math.round(vv.height);
      // Only treat large viewport shrink as keyboard while typing.
      const rawInset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      inset = focused && rawInset > 60 ? rawInset : 0;
      // Anchor layout to visual viewport top (standalone iOS).
      document.documentElement.style.setProperty("--vv-top", `${Math.round(vv.offsetTop || 0)}px`);
    } else {
      document.documentElement.style.setProperty("--vv-top", "0px");
    }

    document.documentElement.style.setProperty("--app-height", `${height}px`);
    document.documentElement.style.setProperty("--kb-inset", `${inset}px`);
    document.body.classList.toggle("keyboard-open", inset > 80);
    lockPageScroll();
  }

  function keepDialogAboveKeyboard(dialog, focusEl) {
    if (!dialog) return;
    const bump = () => {
      syncViewportHeight();
      if (focusEl && typeof focusEl.scrollIntoView === "function") {
        try {
          focusEl.scrollIntoView({ block: "nearest", inline: "nearest" });
        } catch {
          /* ignore */
        }
      }
    };
    bump();
    requestAnimationFrame(bump);
    setTimeout(bump, 80);
    setTimeout(bump, 280);
    setTimeout(bump, 500);
  }

  function autoSize() {
    messageInput.style.height = "auto";
    const visible = window.visualViewport?.height || window.innerHeight;
    const narrow = window.matchMedia("(max-width: 640px)").matches;
    const minH = narrow ? 28 : 44;
    const cap = Math.min(narrow ? 58 : 88, Math.round(visible * (narrow ? 0.12 : 0.18)));
    messageInput.style.height = `${Math.min(messageInput.scrollHeight, Math.max(minH, cap))}px`;
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

  function setAdminUi(on, name) {
    isAdmin = on;
    document.body.classList.toggle("admin-on", on);
    adminBtn.textContent = on ? "Админ ✓" : "Админ";
    if (on && name) {
      myName = name;
      saveName(name);
      renameBtn.title = `Сейчас: ${myName}`;
    }
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
      closePinsList();
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
      pinBarMeta.textContent = "удерж.";
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

  function closePinsList() {
    if (pinsDialog.open) pinsDialog.close();
  }

  function openPinsList() {
    const list = visiblePins();
    if (!list.length) return;
    pinsList.replaceChildren();
    list.forEach((msg, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "pins-picker-item" + (index === pinCycleIndex ? " current" : "");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", index === pinCycleIndex ? "true" : "false");

      const name = document.createElement("span");
      name.className = "pins-picker-name";
      name.textContent = msg.name;

      const preview = document.createElement("span");
      preview.className = "pins-picker-preview";
      preview.textContent = pinPreviewText(msg);

      const meta = document.createElement("span");
      meta.className = "pins-picker-meta";
      meta.textContent = formatTime(msg.createdAt);

      item.append(name, preview, meta);
      item.addEventListener("click", () => {
        pinCycleIndex = index;
        updatePinBar();
        closePinsList();
        scrollToPinnedMessage(msg);
      });
      pinsList.append(item);
    });
    if (!pinsDialog.open) pinsDialog.showModal();
  }

  function clearPinHold() {
    if (pinHoldTimer) {
      clearTimeout(pinHoldTimer);
      pinHoldTimer = null;
    }
    pinHoldStart = null;
  }

  function onPinBarClick(e) {
    if (pinHoldOpened) {
      e.preventDefault();
      pinHoldOpened = false;
      return;
    }
    const list = visiblePins();
    if (!list.length) return;
    const current = list[pinCycleIndex];
    scrollToPinnedMessage(current);
    if (list.length > 1) {
      pinCycleIndex = (pinCycleIndex + 1) % list.length;
      updatePinBar();
    }
  }

  function closeAllReactMenus() {
    document.querySelectorAll(".msg-react-menu").forEach((m) => {
      m.hidden = true;
      m.classList.remove("fixed-open");
      m.style.left = "";
      m.style.top = "";
      const owner = m._ownerWrap;
      if (owner && owner.isConnected && m.parentElement !== owner) {
        owner.appendChild(m);
      } else if (!owner || !owner.isConnected) {
        m.remove();
      }
    });
    document.querySelectorAll(".msg-react-wrap.open").forEach((w) => {
      w.classList.remove("open");
    });
  }

  function removeMessageById(id) {
    if (!id) return;
    closeAllReactMenus();
    knownIds.delete(id);
    lastState.messages = (lastState.messages || []).filter((m) => m.id !== id);
    lastState.pinned = (lastState.pinned || []).filter((m) => m.id !== id);
    const el = feed.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (el) el.remove();
    // Orphan reaction menus were moved to <body> — drop them so they don't leave a hole.
    document.querySelectorAll("body > .msg-react-menu").forEach((m) => m.remove());
    if (deleteArmedId === id) {
      deleteArmedId = null;
      if (deleteArmedTimer) {
        clearTimeout(deleteArmedTimer);
        deleteArmedTimer = null;
      }
    }
    updatePinBar();
    updateJumpBottom();
  }

  function openReactMenu(menu, wrap, toggle) {
    closeAllReactMenus();
    menu._ownerWrap = wrap;
    document.body.appendChild(menu);
    menu.hidden = false;
    wrap.classList.add("open");
    menu.classList.add("fixed-open");
    requestAnimationFrame(() => {
      const rect = toggle.getBoundingClientRect();
      const mw = menu.offsetWidth || 180;
      const mh = menu.offsetHeight || 44;
      let left = rect.left;
      left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
      let top = rect.top - mh - 8;
      if (top < 8) top = Math.min(window.innerHeight - mh - 8, rect.bottom + 8);
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;
    });
  }

  function applyReaction(msgId, emoji) {
    closeAllReactMenus();
    socket.emit("chat:react", { id: msgId, emoji }, (res) => {
      if (!res?.ok) composerHint.textContent = res?.error || "Ошибка реакции";
    });
  }

  function renderMessage(msg) {
    const el = document.createElement("article");
    el.className = "msg";
    el.dataset.id = msg.id;
    el.dataset.name = msg.name;
    if (msg.name === myName) el.classList.add("mine");
    if (msg.pinned) el.classList.add("pinned-item");
    if (msg.admin || msg.name === "АДМИН") el.classList.add("admin");

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
    meta.append(nameBtn);
    if (msg.pinned) {
      const badge = document.createElement("span");
      badge.className = "msg-pin-badge";
      badge.textContent = "закреплено";
      meta.append(badge);
    }
    meta.append(time);

    el.append(meta);

    if (msg.reply) {
      const quote = document.createElement("button");
      quote.type = "button";
      quote.className = "msg-quote";
      quote.title = "Перейти к сообщению";
      const qLabel = document.createElement("span");
      qLabel.className = "msg-quote-label";
      qLabel.textContent = "ответ";
      const qName = document.createElement("span");
      qName.className = "msg-quote-name";
      qName.textContent = msg.reply.name;
      const qText = document.createElement("span");
      qText.className = "msg-quote-text";
      qText.textContent = msg.reply.text || "Сообщение";
      quote.append(qLabel, qName, qText);
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
      appendLinkedText(text, msg.text);
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

    const activeWrap = document.createElement("div");
    activeWrap.className = "msg-reacts-active";
    for (const { emoji, title } of REACTIONS) {
      const reactors = Array.isArray(msg.reactions?.[emoji]) ? msg.reactions[emoji] : [];
      if (!reactors.length) continue;
      const mine = reactors.includes(myName);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "msg-react-chip" + (mine ? " mine" : "");
      chip.title = title;
      chip.textContent = reactors.length > 1 ? `${emoji}${reactors.length}` : emoji;
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        applyReaction(msg.id, emoji);
      });
      activeWrap.append(chip);
    }
    if (activeWrap.childElementCount) actions.append(activeWrap);

    const reactWrap = document.createElement("div");
    reactWrap.className = "msg-react-wrap";

    const reactToggle = document.createElement("button");
    reactToggle.type = "button";
    reactToggle.className = "msg-reply msg-react-toggle";
    reactToggle.textContent = "реакция";
    reactToggle.title = "Добавить реакцию";

    const reactMenu = document.createElement("div");
    reactMenu.className = "msg-react-menu";
    reactMenu.hidden = true;
    for (const { emoji, title } of REACTIONS) {
      const reactors = Array.isArray(msg.reactions?.[emoji]) ? msg.reactions[emoji] : [];
      const mine = reactors.includes(myName);
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "msg-react-opt" + (mine ? " mine" : "");
      opt.title = title;
      opt.textContent = emoji;
      const pick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        applyReaction(msg.id, emoji);
      };
      opt.addEventListener("click", pick);
      reactMenu.append(opt);
    }

    reactToggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (reactMenu.hidden) openReactMenu(reactMenu, reactWrap, reactToggle);
      else closeAllReactMenus();
    });

    reactWrap.append(reactToggle, reactMenu);
    actions.append(reactWrap);

    const replyBtn = document.createElement("button");
    replyBtn.type = "button";
    replyBtn.className = "msg-reply";
    replyBtn.textContent = "ответить";
    replyBtn.addEventListener("click", () => setReplyTarget(msg));
    actions.append(replyBtn);

    if (isAdmin && !dmCode) {
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
      actions.append(pinBtn);
    }

    if (isAdmin) {
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "msg-admin-icon danger msg-delete";
      delBtn.textContent = "✕";
      delBtn.title = "Нажмите дважды, чтобы удалить";
      delBtn.setAttribute("aria-label", "Удалить сообщение");
      if (deleteArmedId === msg.id) delBtn.classList.add("armed");
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (deleteArmedId === msg.id) {
          deleteArmedId = null;
          if (deleteArmedTimer) {
            clearTimeout(deleteArmedTimer);
            deleteArmedTimer = null;
          }
          delBtn.classList.remove("armed");
          socket.emit("admin:delete", { id: msg.id }, (res) => {
            if (!res?.ok) {
              composerHint.textContent = res?.error || "Ошибка";
              return;
            }
            removeMessageById(msg.id);
            if (composerHint.textContent.includes("✕")) composerHint.textContent = "";
          });
          return;
        }
        deleteArmedId = msg.id;
        delBtn.classList.add("armed");
        delBtn.title = "Ещё раз — удалить";
        composerHint.textContent = "Нажмите ✕ ещё раз, чтобы удалить";
        if (deleteArmedTimer) clearTimeout(deleteArmedTimer);
        deleteArmedTimer = setTimeout(() => {
          if (deleteArmedId !== msg.id) return;
          deleteArmedId = null;
          deleteArmedTimer = null;
          delBtn.classList.remove("armed");
          delBtn.title = "Нажмите дважды, чтобы удалить";
          if (composerHint.textContent.includes("✕")) composerHint.textContent = "";
        }, 2500);
      });
      actions.append(delBtn);
    }

    el.append(actions);
    return el;
  }

  function renderAll(state) {
    closeAllReactMenus();
    document.querySelectorAll("body > .msg-react-menu").forEach((m) => m.remove());
    lastState = state || lastState;
    const { messages = [] } = lastState;

    updatePinBar();

    const nearBottom = isNearBottom(80);

    feed.replaceChildren();
    knownIds.clear();
    for (const msg of messages) {
      knownIds.add(msg.id);
      if (!passesFilter(msg)) continue;
      feed.append(renderMessage(msg));
    }

    if (nearBottom) {
      scrollFeedToBottom(false);
    } else {
      updateJumpBottom();
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
    const nearBottom = isNearBottom(120);
    feed.append(renderMessage(msg));
    if (nearBottom || msg.name === myName) {
      scrollFeedToBottom(false);
    } else {
      updateJumpBottom();
    }
  }

  function enterChat(name) {
    myName = name;
    saveName(name);
    gate.hidden = true;
    app.hidden = false;
    renameBtn.title = `Сейчас: ${myName}`;
    syncViewportHeight();
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
      const glyph = document.createElement("span");
      glyph.className = "emoji-glyph";
      glyph.textContent = emoji;
      btn.append(glyph);
      // Prevent focus steal / keyboard open on iOS.
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        btn.classList.add("is-pressed");
      });
      btn.addEventListener("pointerup", () => btn.classList.remove("is-pressed"));
      btn.addEventListener("pointercancel", () => btn.classList.remove("is-pressed"));
      btn.addEventListener("pointerleave", () => btn.classList.remove("is-pressed"));
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
    fetchRandomName(nameInput).catch(() => {
      const fallback = ["Барс", "Лис", "Сокол", "Туман", "Искра", "Парус", "Неон"];
      nameInput.value = fallback[Math.floor(Math.random() * fallback.length)];
    });
  });

  function openRenameDialog() {
    if (!renameDialog || !renameInput) return;
    renameInput.value = myName || "";
    renameDialog.showModal();
    renameInput.focus();
    renameInput.select();
    keepDialogAboveKeyboard(renameDialog, renameInput);
  }

  function applyRename() {
    const next = (renameInput?.value || "").trim();
    if (!next) {
      composerHint.textContent = "Введите имя";
      return;
    }
    socket.emit("chat:rename", { name: next }, (res) => {
      if (!res?.ok) {
        composerHint.textContent = res?.error || "Не сменилось";
        return;
      }
      myName = res.name;
      saveName(myName);
      renameBtn.title = `Сейчас: ${myName}`;
      renameDialog?.close();
      renderAll(lastState);
    });
  }

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
      if (isNearBottom(160)) scrollFeedToBottom(false);
      else updateJumpBottom();
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

  jumpBottomBtn.addEventListener("click", () => {
    scrollFeedToBottom(true);
  });
  feed.addEventListener(
    "scroll",
    () => {
      updateJumpBottom();
    },
    { passive: true }
  );

  previewClear.addEventListener("click", clearPreview);

  filterBtn.addEventListener("click", openFilterDialog);
  filterApplyBtn.addEventListener("click", applyFilterFromDialog);
  filterCancelBtn.addEventListener("click", () => filterDialog.close());
  filterClearBtn.addEventListener("click", clearFilter);
  pinsCloseBtn.addEventListener("click", closePinsList);
  pinsDialog.addEventListener("click", (e) => {
    if (e.target === pinsDialog) closePinsList();
  });

  pins.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    clearPinHold();
    pinHoldOpened = false;
    pinHoldStart = { x: e.clientX, y: e.clientY };
    try {
      pins.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    pinHoldTimer = setTimeout(() => {
      pinHoldTimer = null;
      pinHoldOpened = true;
      openPinsList();
    }, PIN_HOLD_MS);
  });
  pins.addEventListener("pointermove", (e) => {
    if (!pinHoldStart || !pinHoldTimer) return;
    const dx = Math.abs(e.clientX - pinHoldStart.x);
    const dy = Math.abs(e.clientY - pinHoldStart.y);
    if (dx > PIN_HOLD_MOVE_PX || dy > PIN_HOLD_MOVE_PX) clearPinHold();
  });
  pins.addEventListener("pointerup", clearPinHold);
  pins.addEventListener("pointercancel", clearPinHold);
  pins.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    clearPinHold();
    pinHoldOpened = true;
    openPinsList();
  });
  pins.addEventListener("click", onPinBarClick);

  renameBtn.addEventListener("click", openRenameDialog);
  renameRandomBtn?.addEventListener("click", () => {
    fetchRandomName(renameInput).catch(() => {
      const fallback = ["Барс", "Лис", "Сокол", "Туман", "Искра", "Парус", "Неон"];
      renameInput.value = fallback[Math.floor(Math.random() * fallback.length)];
    });
  });
  renameCancelBtn?.addEventListener("click", () => renameDialog?.close());
  renameApplyBtn?.addEventListener("click", applyRename);
  renameInput?.addEventListener("focus", () => keepDialogAboveKeyboard(renameDialog, renameInput));
  renameInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyRename();
    }
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
    keepDialogAboveKeyboard(adminDialog, adminPassword);
  });

  adminPassword?.addEventListener("focus", () => keepDialogAboveKeyboard(adminDialog, adminPassword));

  function joinDmFromInput() {
    showDmDialogError("");
    const code = (dmCodeInput?.value || "").trim();
    if (!code) {
      showDmDialogError("Введите код");
      return;
    }
    socket.emit("dm:join", { code }, (res) => {
      if (!res?.ok) {
        showDmDialogError(res?.error || "Не удалось войти");
        return;
      }
      enterDmMode(res);
      dmDialog?.close();
    });
  }

  dmBtn?.addEventListener("click", () => {
    if (dmCode) {
      composerHint.textContent = `Вы уже в комнате ${dmCode}`;
      return;
    }
    openDmDialog();
  });
  dmDialogClose?.addEventListener("click", () => dmDialog?.close());
  dmCreateBtn?.addEventListener("click", () => {
    showDmDialogError("");
    socket.emit("dm:create", {}, (res) => {
      if (!res?.ok) {
        showDmDialogError(res?.error || "Не создалось");
        return;
      }
      enterDmMode(res);
      if (dmCodeInput) dmCodeInput.value = res.code;
      // Keep dialog open briefly so the code is visible, or close — bar shows code.
      dmDialog?.close();
      composerHint.textContent = `Код ${res.code} — передайте второму человеку`;
    });
  });
  dmJoinBtn?.addEventListener("click", joinDmFromInput);
  dmCodeInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      joinDmFromInput();
    }
  });
  dmCodeInput?.addEventListener("focus", () => keepDialogAboveKeyboard(dmDialog, dmCodeInput));
  dmLeaveBtn?.addEventListener("click", () => leaveDmMode());
  dmCopyBtn?.addEventListener("click", async () => {
    if (!dmCode) return;
    try {
      await navigator.clipboard.writeText(dmCode);
      composerHint.textContent = `Код ${dmCode} скопирован`;
    } catch {
      composerHint.textContent = `Код: ${dmCode}`;
    }
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
      setAdminUi(true, res.name || "АДМИН");
      adminDialog.close();
      composerHint.textContent = "Режим админа · ник АДМИН";
    });
  });

  socket.on("chat:state", (state) => {
    if (dmCode) return;
    renderAll(state);
  });

  socket.on("chat:message-removed", ({ id } = {}) => {
    removeMessageById(id);
  });

  socket.on("chat:message", (msg) => {
    if (dmCode) return;
    appendMessage(msg);
  });

  socket.on("dm:message", (msg) => {
    if (!dmCode) return;
    appendMessage(msg);
  });

  socket.on("dm:message-update", (msg) => {
    if (!dmCode) return;
    patchMessage(msg);
  });

  socket.on("dm:presence", (payload = {}) => {
    if (!dmCode || payload.code !== dmCode) return;
    updateDmPresence(payload);
  });

  socket.on("chat:message-update", (msg) => {
    if (dmCode) return;
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

  document.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".msg-react-wrap") || e.target.closest(".msg-react-menu")) return;
    closeAllReactMenus();
  });
  window.addEventListener("resize", closeAllReactMenus);
  feed.addEventListener("scroll", closeAllReactMenus, { passive: true });

  // Drop legacy push/notification service workers from older builds.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      for (const reg of regs) void reg.unregister();
    });
  }

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
