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
  const pingAllBtn = $("#ping-all-btn");
  const filterBtn = $("#filter-btn");
  const filterBar = $("#filter-bar");
  const filterBarText = $("#filter-bar-text");
  const filterClearBtn = $("#filter-clear-btn");
  const filterDialog = $("#filter-dialog");
  const filterUserList = $("#filter-user-list");
  const filterApplyBtn = $("#filter-apply-btn");
  const filterCancelBtn = $("#filter-cancel-btn");
  const notifyBtn = $("#notify-btn");
  const replyToast = $("#reply-toast");
  const replyToastBody = $("#reply-toast-body");
  const replyToastTitle = $("#reply-toast-title");
  const replyToastText = $("#reply-toast-text");
  const replyToastClose = $("#reply-toast-close");
  const adminDialog = $("#admin-dialog");
  const adminForm = $("#admin-form");
  const adminPassword = $("#admin-password");
  const adminError = $("#admin-error");
  const lightbox = $("#lightbox");
  const lightboxImg = $("#lightbox-img");

  const socket = io({ autoConnect: true });
  const NAME_KEY = "komnata_name";
  const NOTIFY_KEY = "komnata_notify";
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
  const myMessageIds = new Set();
  /** @type {Set<string>} */
  let filterNames = new Set();
  let lastState = { messages: [], pinned: [] };
  let pinCycleIndex = 0;
  let pinHoldTimer = null;
  let pinHoldOpened = false;
  let pinHoldStart = null;
  const PIN_HOLD_MS = 420;
  const PIN_HOLD_MOVE_PX = 12;
  let notifyEnabled = false;
  let replyToastTimer = null;
  let audioCtx = null;
  let toastTargetId = null;
  let initialStateSynced = false;
  let lastSeenMsgMs = 0;
  const notifiedReplyIds = new Set();
  const BASE_TITLE = "Сарафан — открытый чат";
  let swReg = null;
  const isIos =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

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

  function loadNotifyPref() {
    try {
      return localStorage.getItem(NOTIFY_KEY) !== "0";
    } catch {
      return true;
    }
  }

  function saveNotifyPref(on) {
    try {
      localStorage.setItem(NOTIFY_KEY, on ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function updateNotifyButton() {
    if (!notifyBtn) return;
    notifyBtn.classList.toggle("notify-on", notifyEnabled);
    notifyBtn.classList.toggle("notify-off", !notifyEnabled);
    notifyBtn.textContent = notifyEnabled ? "🔔" : "🔕";
    notifyBtn.title = notifyEnabled
      ? "Уведомления об ответах включены"
      : "Уведомления об ответах выключены";
  }

  function unlockAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === "suspended") void audioCtx.resume();
    } catch {
      /* ignore */
    }
  }

  function playNotifySound() {
    try {
      unlockAudio();
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.05, audioCtx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.22);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.24);
    } catch {
      /* ignore */
    }
  }

  function hideReplyToast() {
    if (replyToastTimer) {
      clearTimeout(replyToastTimer);
      replyToastTimer = null;
    }
    if (replyToast) replyToast.hidden = true;
    toastTargetId = null;
    if (document.visibilityState === "visible") {
      document.title = BASE_TITLE;
    }
  }

  function scrollToMessageId(id) {
    if (!id) return;
    const el = feed.querySelector(`[data-id="${id}"]`);
    if (!el) {
      composerHint.textContent = "Сообщение не в текущей ленте (фильтр?)";
      return;
    }
    el.classList.add("pin-flash");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => el.classList.remove("pin-flash"), 1200);
  }

  function showReplyToast(msg) {
    if (!replyToast) return;
    toastTargetId = msg.id;
    replyToastTitle.textContent = `${msg.name} ответил вам`;
    replyToastText.textContent = (msg.text || (msg.imageUrl ? "📷 Фото" : "Сообщение"))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140);
    replyToast.hidden = false;
    replyToast.classList.remove("pulse");
    void replyToast.offsetWidth;
    replyToast.classList.add("pulse");
    if (replyToastTimer) clearTimeout(replyToastTimer);
    replyToastTimer = setTimeout(hideReplyToast, 9000);
  }

  function showPingToast(text) {
    if (!replyToast) return;
    toastTargetId = null;
    replyToastTitle.textContent = "Сарафан";
    replyToastText.textContent = text || "Заходите в чат";
    replyToast.hidden = false;
    replyToast.classList.remove("pulse");
    void replyToast.offsetWidth;
    replyToast.classList.add("pulse");
    if (replyToastTimer) clearTimeout(replyToastTimer);
    replyToastTimer = setTimeout(hideReplyToast, 9000);
    playNotifySound();
    document.title = "💬 Сарафан";
  }

  function flashDocumentTitle(msg) {
    document.title = `💬 ${msg.name} ответил`;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function ensureServiceWorker() {
    if (!("serviceWorker" in navigator)) return null;
    try {
      swReg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      return swReg;
    } catch {
      return null;
    }
  }

  async function syncPushSubscription() {
    if (!notifyEnabled) return false;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
    if (!("PushManager" in window)) return false;
    const reg = swReg || (await ensureServiceWorker());
    if (!reg) return false;
    try {
      const keyRes = await fetch("/api/vapid-public-key");
      const keyData = await keyRes.json();
      if (!keyData?.publicKey) return false;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
        });
      }
      await fetch("/api/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          name: myName || "",
        }),
      });
      return true;
    } catch (err) {
      console.warn("push subscribe failed", err);
      return false;
    }
  }

  async function showSystemReplyNotification(msg) {
    const title = `${msg.name} ответил вам`;
    const body = (msg.text || (msg.imageUrl ? "Фото" : "Сообщение"))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    const tag = `sarafan-reply-${msg.id}`;
    const payload = {
      type: "reply-notify",
      title,
      body,
      tag,
      id: msg.id,
      url: "/",
    };

    try {
      const reg = swReg || (await ensureServiceWorker());
      if (reg && typeof Notification !== "undefined" && Notification.permission === "granted") {
        await reg.showNotification(title, {
          body,
          tag,
          renotify: true,
          data: { id: msg.id, url: "/" },
        });
        return;
      }
      if (reg?.active) {
        reg.active.postMessage(payload);
        return;
      }
    } catch {
      /* fall through */
    }

    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    try {
      const note = new Notification(title, { body, tag, renotify: true });
      note.onclick = () => {
        window.focus();
        scrollToMessageId(msg.id);
        note.close();
      };
    } catch {
      /* ignore */
    }
  }

  function isReplyToMe(msg) {
    if (!myName || !msg?.reply) return false;
    if (msg.name === myName) return false;
    if (myMessageIds.has(msg.reply.id)) return true;
    return msg.reply.name === myName;
  }

  function messageTimeMs(msg) {
    const t = Date.parse(msg?.createdAt || "");
    return Number.isFinite(t) ? t : 0;
  }

  function markHistoryCaughtUp(messages) {
    let maxT = lastSeenMsgMs;
    for (const msg of messages || []) {
      const t = messageTimeMs(msg);
      if (t > maxT) maxT = t;
      if (isReplyToMe(msg)) notifiedReplyIds.add(msg.id);
    }
    lastSeenMsgMs = maxT || Date.now();
    initialStateSynced = true;
  }

  function notifyReply(msg, { forceSystem = false } = {}) {
    if (!notifyEnabled) return;
    if (!isReplyToMe(msg)) return;
    if (notifiedReplyIds.has(msg.id)) return;
    notifiedReplyIds.add(msg.id);
    const t = messageTimeMs(msg);
    if (t > lastSeenMsgMs) lastSeenMsgMs = t;

    showReplyToast(msg);
    playNotifySound();
    flashDocumentTitle(msg);
    try {
      navigator.vibrate?.(40);
    } catch {
      /* ignore */
    }

    const pageHidden = document.visibilityState === "hidden" || document.hidden;
    if (forceSystem || pageHidden || isStandalone) {
      void showSystemReplyNotification(msg);
    } else if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      // Still try SW path on iOS even if page looks "visible".
      if (isIos) void showSystemReplyNotification(msg);
    }
  }

  function scanMessagesForReplyNotifications(messages) {
    if (!notifyEnabled || !myName || !initialStateSynced) return;
    const list = [...(messages || [])].sort((a, b) => messageTimeMs(a) - messageTimeMs(b));
    for (const msg of list) {
      if (notifiedReplyIds.has(msg.id)) continue;
      const t = messageTimeMs(msg);
      if (t && t <= lastSeenMsgMs) continue;
      notifyReply(msg, { forceSystem: document.visibilityState === "hidden" || isIos });
    }
  }

  function iosNotifyHint() {
    if (!isIos) return "Уведомления об ответах включены";
    if (isStandalone) {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        return "Уведомления включены";
      }
      return "Разрешите уведомления в настройках iOS для Комнаты";
    }
    return "На iPhone: Поделиться → На экран «Домой», откройте ярлык и нажмите 🔔";
  }

  async function enableNotifications() {
    unlockAudio();
    notifyEnabled = true;
    saveNotifyPref(true);
    updateNotifyButton();
    await ensureServiceWorker();

    if (typeof Notification === "undefined") {
      composerHint.textContent = isIos
        ? "Откройте ярлык с Домой (не Safari) и снова нажмите 🔔"
        : "Тосты в чате включены";
      return;
    }

    if (Notification.permission === "denied") {
      composerHint.textContent = isIos
        ? "Уведомления запрещены. Настройки → Сарафан → Уведомления"
        : "Разрешите уведомления в настройках браузера";
      return;
    }

    if (Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        /* ignore */
      }
    }

    const pushed = await syncPushSubscription();
    if (Notification.permission === "granted" && pushed) {
      composerHint.textContent = "Уведомления включены (в т.ч. когда чат закрыт)";
    } else if (Notification.permission === "granted") {
      composerHint.textContent = iosNotifyHint();
    } else {
      composerHint.textContent = iosNotifyHint();
    }
  }

  function disableNotifications() {
    notifyEnabled = false;
    saveNotifyPref(false);
    updateNotifyButton();
    hideReplyToast();
    document.title = BASE_TITLE;
    composerHint.textContent = "Уведомления об ответах выключены";
  }

  async function toggleNotifications() {
    unlockAudio();
    if (notifyEnabled) disableNotifications();
    else await enableNotifications();
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
    const focused =
      document.activeElement === messageInput ||
      document.activeElement === nameInput ||
      document.activeElement?.tagName === "TEXTAREA" ||
      document.activeElement?.tagName === "INPUT";

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

  function setAdminUi(on) {
    isAdmin = on;
    document.body.classList.toggle("admin-on", on);
    adminBtn.textContent = on ? "Админ ✓" : "Админ";
    if (pingAllBtn) pingAllBtn.hidden = !on;
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
      if (owner && m.parentElement !== owner) owner.appendChild(m);
    });
    document.querySelectorAll(".msg-react-wrap.open").forEach((w) => {
      w.classList.remove("open");
    });
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

    const nearBottom = isNearBottom(80);

    feed.replaceChildren();
    knownIds.clear();
    myMessageIds.clear();
    for (const msg of messages) {
      knownIds.add(msg.id);
      if (msg.name === myName) myMessageIds.add(msg.id);
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
    if (msg.name === myName) myMessageIds.add(msg.id);
    lastState.messages = [...(lastState.messages || []), msg];
    if (!passesFilter(msg)) {
      notifyReply(msg);
      return;
    }
    const nearBottom = isNearBottom(120);
    feed.append(renderMessage(msg));
    if (nearBottom || msg.name === myName) {
      scrollFeedToBottom(false);
    } else {
      updateJumpBottom();
    }
    notifyReply(msg);
  }

  function enterChat(name) {
    myName = name;
    saveName(name);
    gate.hidden = true;
    app.hidden = false;
    renameBtn.title = `Сейчас: ${myName}`;
    unlockAudio();
    void ensureServiceWorker();
    if (notifyEnabled) void syncPushSubscription();
    syncViewportHeight();
    if (notifyEnabled) {
      setTimeout(() => {
        if (!notifyEnabled) return;
        if (isIos && !isStandalone) {
          composerHint.textContent =
            "iPhone: Поделиться → На экран «Домой», откройте ярлык и нажмите 🔔";
        } else if (typeof Notification !== "undefined" && Notification.permission === "default") {
          composerHint.textContent = "Нажмите 🔔, чтобы разрешить уведомления";
        }
      }, 600);
    }
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
      if (notifyEnabled) void syncPushSubscription();
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

  notifyBtn?.addEventListener("click", () => {
    void toggleNotifications();
  });
  replyToastBody?.addEventListener("click", () => {
    const id = toastTargetId;
    hideReplyToast();
    scrollToMessageId(id);
  });
  replyToastClose?.addEventListener("click", hideReplyToast);

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
  renameInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyRename();
    }
  });

  pingAllBtn?.addEventListener("click", () => {
    if (!isAdmin) return;
    const text = prompt("Текст для всех (можно пусто)", "Заходите в Сарафан");
    if (text == null) return;
    socket.emit("admin:ping-all", { text }, (res) => {
      if (!res?.ok) {
        composerHint.textContent = res?.error || "Не удалось позвать";
        return;
      }
      composerHint.textContent = `Приглашение отправлено (${res.sent}/${res.subscribers})`;
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
    if (!initialStateSynced) {
      markHistoryCaughtUp(state.messages || []);
    } else {
      scanMessagesForReplyNotifications(state.messages || []);
    }
  });

  socket.on("chat:message", (msg) => {
    appendMessage(msg);
  });

  socket.on("chat:reply-notify", (msg) => {
    if (msg?.id && !knownIds.has(msg.id)) appendMessage(msg);
    notifyReply(msg, { forceSystem: true });
  });

  socket.on("chat:admin-ping", (payload) => {
    if (!notifyEnabled) return;
    showPingToast(payload?.body || "Заходите в чат");
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

  document.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".msg-react-wrap") || e.target.closest(".msg-react-menu")) return;
    closeAllReactMenus();
  });
  window.addEventListener("resize", closeAllReactMenus);
  feed.addEventListener("scroll", closeAllReactMenus, { passive: true });

  notifyEnabled = loadNotifyPref();
  updateNotifyButton();
  void ensureServiceWorker();

  document.addEventListener(
    "pointerdown",
    () => {
      unlockAudio();
    },
    { passive: true, once: true }
  );

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      document.title = BASE_TITLE;
      if (lastState?.messages) scanMessagesForReplyNotifications(lastState.messages);
    }
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "open-reply") {
        scrollToMessageId(event.data.id);
      }
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
